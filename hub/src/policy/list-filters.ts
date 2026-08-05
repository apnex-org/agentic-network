/**
 * Shared filter + pagination helpers for `list_*` policy handlers.
 *
 * Motivation (idea-70): every `list_*` tool returned unbounded result
 * sets by default, causing MCP payloads to exceed the 87k-char wire cap
 * on realistic backlogs. Standardising on `limit` / `offset` plus
 * optional label and tag filters makes every list tool paginated and
 * queryable without reworking per-entity filter logic.
 */

import { z } from "zod";
import { assertKnownFilterOps, hasImplementedFilterOp } from "../storage-substrate/types.js";

export const DEFAULT_LIST_LIMIT = 100;
export const MAX_LIST_LIMIT = 500;

/** Zod schema fragment — spread into any `list_*` tool registration. */
export const LIST_PAGINATION_SCHEMA = {
  limit: z.number().int().positive().max(MAX_LIST_LIMIT).optional()
    .describe(`Cap the result set size (max ${MAX_LIST_LIMIT}, default ${DEFAULT_LIST_LIMIT}).`),
  offset: z.number().int().nonnegative().optional()
    .describe("Skip the first N entries for pagination (default 0)."),
};

/**
 * work-640 (Director ruling: "Cap at 10 and disclose"): the SMALL default for
 * surfaces whose realistic result set can destroy a caller's context.
 * `list_messages` had NO cap at all (~10,108 rows, ~16MB, ~4M tokens measured);
 * `list_work` defaulted to 100.
 */
export const DEFAULT_SMALL_LIST_LIMIT = 10;

/** Pagination schema whose DESCRIBE states the tool's ACTUAL default.
 *  The shared LIST_PAGINATION_SCHEMA hard-codes "default 100"; a surface with a
 *  different default must not advertise that number (bug-391: deployed tool
 *  descriptions contradicting their implementations). */
export function listPaginationSchema(defaultLimit: number) {
  return {
    limit: z.number().int().positive().max(MAX_LIST_LIMIT).optional()
      .describe(`Cap the result set size (max ${MAX_LIST_LIMIT}, default ${defaultLimit}). An explicit higher value IS honoured up to the max.`),
    offset: z.number().int().nonnegative().optional()
      .describe("Skip the first N entries for pagination (default 0)."),
  };
}

/**
 * PAGE-LEVEL truncation disclosure — deliberately DISTINCT from a capped SCAN.
 *
 * `truncated` on these surfaces means "the substrate scan hit its row cap, so
 * matches may exist that we never saw". THIS says something different and
 * narrower: "of the matches we DID see, your page does not contain all of them".
 *
 * Both can be true at once and they are not interchangeable. Conflating them is
 * how a cap becomes silent: a caller told `truncated:false` while holding 10 of
 * 50 rows has been misled by a technically-true flag.
 *
 * `pageTruncated:false` is emitted EXPLICITLY rather than omitted, so a complete
 * result is machine-checkable as complete and "always report truncated" cannot
 * pass a negative control.
 */
export interface PageDisclosure {
  /** Always present, both ways — a complete result must be machine-checkable as complete. */
  pageTruncated: boolean;
  /** Present ONLY when pageTruncated — absent, never 0, when the result is whole. */
  omitted?: number;
  nextOffset?: number;
  pageTruncationNote?: string;
}

export function pageDisclosure(page: {
  count: number;
  total: number;
  offset: number;
  limit: number;
}): PageDisclosure {
  const seen = page.offset + page.count;
  if (seen >= page.total) return { pageTruncated: false };
  return {
    pageTruncated: true,
    omitted: page.total - seen,
    nextOffset: seen,
    // The note must not attribute the limit to a "default" it cannot know was
    // defaulted, and must not advise raising a limit already at the ceiling.
    pageTruncationNote:
      `showing ${page.count} of ${page.total} matched rows (limit ${page.limit}); ` +
      `re-call with offset=${seen}` +
      (page.limit < MAX_LIST_LIMIT ? `, or raise limit (max ${MAX_LIST_LIMIT}),` : ``) +
      ` to retrieve the rest.`,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * THE READ-ENVELOPE KERNEL  (work-644/work-645, docs/design/read-envelope-honesty-primitive.md)
 *
 * ONE entry point — `paginated()`. A verb handler expresses its pagination in a
 * single call and merges one result. Adding verb 35 is that call and nothing else.
 *
 * 🔴 THERE ARE THREE INDEPENDENT BOUNDARIES AND THEY ARE NOT INTERCHANGEABLE.
 * Satisfying one NEVER implies the others. Read this before touching a field:
 *
 *   SCAN  — did the STORE stop before seeing everything?   `truncated` / `truncationNote`
 *           The rows it never saw are invisible to EVERY downstream count,
 *           including `total`. offset/limit CANNOT reach them.
 *   PAGE  — did limit/offset exclude rows the scan DID see? `pageTruncated` / `pageTruncationNote`
 *           These rows ARE retrievable — `nextOffset` reaches them.
 *
 * A caller told "your page is incomplete" and NOT told "the scan was capped"
 * has been misled by a true statement. That was bug-484.
 *
 * 🔴 `complete` IS THE PRIMITIVE; the notes are explanation, not competing claims.
 * It DEFAULTS FALSE and is earned only when every boundary is known to have
 * excluded nothing — so a handler wired by someone who has read none of this
 * still cannot claim completeness it does not have.
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface ReadEnvelope<T> {
  items: T[];
  count: number;
  /** 🔴 The TRUE match count, or NULL when the scan was capped and the real count
   *  is unknowable without the full read the cap exists to prevent. NEVER a
   *  known-partial number: a scan floor in `total` is exactly bug-484. */
  total: number | null;
  offset: number;
  limit: number;
  /** THE primitive: is this the whole answer? False unless every boundary is clear. */
  complete: boolean;
  /** How many rows the store actually saw — present only when that is NOT `total`. */
  scanned?: number;
  // ── SCAN boundary ──
  truncated: boolean;
  truncationNote?: string;
  // ── PAGE boundary ──
  pageTruncated: boolean;
  omitted?: number;
  nextOffset?: number;
  pageTruncationNote?: string;
}

export interface PaginateOptions {
  /** This surface's default page size when the caller supplies none. */
  defaultLimit?: number;
  /** Did the STORE cap its scan? Omitted ⇒ false ⇒ `total` is trusted as exact. */
  scanCapped?: boolean;
  /** The store's scan cap, for the note. */
  scanCap?: number;
  /** Filters to suggest when the scan is capped (offset cannot help there). */
  narrowBy?: string;
}

/**
 * THE KERNEL. Defaulting, clamping, page assembly and BOTH boundary disclosures.
 * Handlers call this and merge the result; they re-implement nothing.
 */
export function paginated<T>(
  rows: T[],
  args: Record<string, unknown>,
  opts: PaginateOptions = {},
): ReadEnvelope<T> {
  const { defaultLimit = DEFAULT_LIST_LIMIT, scanCapped = false, scanCap, narrowBy } = opts;
  const page = paginate(rows, { ...args, limit: (args.limit as number | undefined) ?? defaultLimit });
  const disclosure = pageDisclosure(page);
  const seen = page.offset + page.count;

  // 🔴 A capped scan makes the true count UNKNOWABLE. `rows.length` is a floor,
  // and a floor in `total` is the defect this kernel exists to make impossible.
  const total = scanCapped ? null : page.total;

  // Earned, never assumed: both boundaries must be clear.
  const complete = !scanCapped && seen >= page.total;

  return {
    items: page.items,
    count: page.count,
    total,
    offset: page.offset,
    limit: page.limit,
    complete,
    ...(scanCapped ? { scanned: page.total } : {}),
    truncated: scanCapped,
    ...(scanCapped
      ? {
          truncationNote:
            `the scan hit the ${scanCap ?? page.total}-row cap — result is INCOMPLETE and ` +
            `\`total\` is UNKNOWN (null), not ${page.total}; rows beyond the cap were never seen and ` +
            `🔴 PAGING WITH offset CANNOT REACH THEM` +
            (narrowBy ? `; narrow with ${narrowBy} to bring them inside the scan.` : `.`),
        }
      : {}),
    pageTruncated: disclosure.pageTruncated,
    ...(disclosure.pageTruncated
      ? {
          omitted: disclosure.omitted,
          nextOffset: disclosure.nextOffset,
          // 🔴 Must be correct at BOTH boundaries at once. When the scan is capped,
          // offset retrieves the rest OF WHAT WAS SEEN — never "the rest".
          pageTruncationNote: scanCapped
            ? `showing ${page.count} of the ${page.total} SCANNED rows (limit ${page.limit}); ` +
              `offset=${seen} retrieves more OF THE SCANNED SET ONLY — it is NOT the rest of the collection.`
            : disclosure.pageTruncationNote,
        }
      : {}),
  };
}

/** Compact-projection flag — spread into a `list_*` registration whose handler maps
 *  each item through a per-entity compact projection. bug-196: fat list payloads pushed
 *  agents to many per-item get_* calls (steve surveying the ledger), overrunning the
 *  concurrency=1 proxy = the 2026-06-28 429 storm. Compact = the scannable bulk-survey
 *  shape; full objects remain available (omit/false). */
export const LIST_COMPACT_SCHEMA = {
  compact: z.boolean().optional()
    .describe("Return a COMPACT scannable projection per item (id + key fields; OMITS long-text bodies — description/text/details/fixRevision). Use for bulk ledger surveys to avoid per-item get_* calls. Full objects when omitted/false."),
};

/** Label-match-all filter — use on entities with `labels: Record<string, string>`. */
export const LIST_LABELS_SCHEMA = {
  labels: z.record(z.string(), z.string()).optional()
    .describe("Match-all label filter: only entries whose labels include every provided key=value pair."),
};

/** Tag-match-any filter — use on entities with `tags: string[]`. */
export const LIST_TAGS_SCHEMA = {
  tags: z.array(z.string()).optional()
    .describe("Match-any tag filter: only entries whose tags include at least one of the provided tags."),
};

/** bug-198: some adapters (opencode) serialize an UNSET optional as "" / [] / null
 *  instead of omitting it. Treat those as UNSET — NOT an exact-empty filter that ANDs
 *  to zero matches. (The get_bug-overrun root: list_bugs(status=resolved) with severity/
 *  class/tags unset returned _ois_query_unmatched from opencode but worked from claude.) */
export function unsetIfEmpty<T>(v: T | undefined | null): T | undefined {
  if (v === undefined || v === null || (v as unknown) === "") return undefined;
  if (Array.isArray(v) && v.length === 0) return undefined;
  return v;
}

/** Drop empty-string / empty-array / null / undefined values from a filter object
 *  (bug-198), so an adapter-serialized empty optional inside a `filter` object doesn't
 *  AND to zero either. */
export function omitEmptyValues(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (unsetIfEmpty(v) !== undefined) out[k] = v;
  }
  return out;
}

/** General additive-tag merge (idea-363 / work-59). Union `addTags` onto an
 *  existing tag list, preserving order (existing first, then new) and dropping
 *  duplicates + empty strings. The reusable primitive behind update_idea's
 *  `addTags` mode — pairs with the update_bug tag-REPLACE-clobber sibling
 *  (the same clobber footgun: a bare `tags = newTags` wipes prior tags, so an
 *  additive stamp — e.g. a triage pass adding `audit:value:high` — must
 *  read-merge-write). Pass a fresh `base` (e.g. an explicit `tags` replacement)
 *  to union onto that instead of the current set. */
export function mergeTags(existing: readonly string[] | undefined, addTags: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...(existing ?? []), ...(addTags ?? [])]) {
    if (typeof t !== "string" || t === "" || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export function applyLabelFilter<T extends { labels?: Record<string, string> }>(
  items: T[],
  labels?: Record<string, string>,
): T[] {
  if (!labels || Object.keys(labels).length === 0) return items;
  return items.filter((item) => {
    const have = item.labels ?? {};
    for (const [k, v] of Object.entries(labels)) {
      if (have[k] !== v) return false;
    }
    return true;
  });
}

export function applyTagFilter<T extends { tags?: string[] }>(
  items: T[],
  tags?: string[],
): T[] {
  if (!tags || tags.length === 0) return items;
  return items.filter((item) => {
    const have = item.tags ?? [];
    return tags.some((t) => have.includes(t));
  });
}

export interface PaginatedResult<T> {
  items: T[];
  count: number;
  total: number;
  offset: number;
  limit: number;
}

export function paginate<T>(items: T[], args: Record<string, unknown>): PaginatedResult<T> {
  const total = items.length;
  const rawOffset = args.offset as number | undefined;
  const rawLimit = args.limit as number | undefined;
  const offset = Math.max(0, rawOffset ?? 0);
  const limit = Math.min(MAX_LIST_LIMIT, rawLimit ?? DEFAULT_LIST_LIMIT);
  const sliced = items.slice(offset, offset + limit);
  return { items: sliced, count: sliced.length, total, offset, limit };
}

// ── M-QueryShape Phase 1 (idea-119, task-302) ─────────────────────────
//
// Strict Mongo-ish filter + ordered-tuple sort for list_* tools.
// Architect-ratified via thread-222. Operator allowlist (Phase 1):
//   - Implicit equality (and implicit AND across top-level keys)
//   - $in
//   - $gt / $lt / $gte / $lte  (dates + numbers only, never strings)
//
// Forbidden in Phase 1 (rejected by Zod strict mode):
//   - $regex / $where / $expr  (ReDoS / arbitrary code exec risk)
//   - $or / $and / $not        (logical composition; defer to Phase 3+)
//
// Phase C (task-306, Mission-24) extended the adoption to list_ideas,
// list_threads, list_missions + added nested path support through
// dotted-key field names + FieldAccessor-computed virtual fields
// (e.g., `createdBy.id` = `${role}:${agentId}`). Per-entity field specs
// live in each *-policy.ts; the shared helpers here stayed unchanged —
// dotted keys pass through Zod's object schema as opaque property names.

/**
 * Field type descriptors — control which operators a filterable field
 * accepts. "string" = implicit eq + $in; "date" = all operators on
 * ISO-8601 strings; "number" = all operators on numbers; "enum" = same
 * as string but with a `values` allowlist for additional client-side
 * diagnostics (not enforced by Zod — a typo on an enum value returns
 * empty-match, not a Zod error, which keeps the reject-with-hint
 * surface narrow). "array" (C1-R2) = a stored array field, queried by
 * `$contains` array-membership ONLY (the stored array CONTAINS the scalar;
 * the inverse of $in) — no implicit-equality on an array field.
 */
export type QueryableFieldType = "string" | "date" | "number" | "enum" | "array";

export interface QueryableField {
  type: QueryableFieldType;
  /** For enum-typed fields: the set of valid values (diagnostic only). */
  values?: readonly string[];
}

export type QueryableFieldSpec = Record<string, QueryableField>;

/**
 * Build the Zod schema for the `filter` parameter of a list_* tool.
 * Returns a ZodObject-ish union: each declared field accepts either
 * a scalar (implicit equality) or a strict operator object.
 *
 * The returned schema is `.strict()` at the top level: unknown field
 * names are rejected with a Zod error that names the permitted fields.
 * Unknown operators within a field's object shape are rejected the
 * same way because each field schema is also `.strict()`.
 */
export function buildQueryFilterSchema(fields: QueryableFieldSpec): z.ZodTypeAny {
  const entries: Record<string, z.ZodTypeAny> = {};
  for (const [name, spec] of Object.entries(fields)) {
    entries[name] = fieldFilterSchema(spec).optional();
  }
  // Top-level object: permitted field-name allowlist; unknown keys
  // rejected by .strict().
  return z.object(entries).strict();
}

function fieldFilterSchema(spec: QueryableField): z.ZodTypeAny {
  if (spec.type === "number") {
    return z.union([
      z.number(),
      z.object({
        $in: z.array(z.number()).nonempty().optional(),
        $gt: z.number().optional(),
        $lt: z.number().optional(),
        $gte: z.number().optional(),
        $lte: z.number().optional(),
      }).strict(),
    ]);
  }
  if (spec.type === "date") {
    const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}T/, "must be ISO-8601 date-time");
    return z.union([
      iso,
      z.object({
        $in: z.array(iso).nonempty().optional(),
        $gt: iso.optional(),
        $lt: iso.optional(),
        $gte: iso.optional(),
        $lte: iso.optional(),
      }).strict(),
    ]);
  }
  if (spec.type === "array") {
    // C1-R2: array-membership ONLY — `{$contains: scalar}` (the stored array
    // CONTAINS the scalar). No implicit-equality form: an array field is never
    // compared by whole-value equality at the filter surface.
    return z.object({
      $contains: z.union([z.string(), z.number(), z.boolean()]),
    }).strict();
  }
  // "string" and "enum": implicit eq or $in only (no range semantics)
  return z.union([
    z.string(),
    z.object({
      $in: z.array(z.string()).nonempty().optional(),
    }).strict(),
  ]);
}

/**
 * Build the Zod schema for the `sort` parameter of a list_* tool.
 * Ordered tuple; stable-sort semantics are applied by `applyQuerySort`
 * via an appended implicit `id: asc` tie-breaker.
 */
export function buildQuerySortSchema(sortableFields: readonly string[]): z.ZodTypeAny {
  if (sortableFields.length === 0) {
    return z.array(z.never()).optional();
  }
  return z.array(
    z.object({
      field: z.enum(sortableFields as [string, ...string[]]),
      order: z.enum(["asc", "desc"]),
    }).strict(),
  ).optional();
}

export type QueryFilter = Record<string, unknown>;
export type QuerySort = ReadonlyArray<{ field: string; order: "asc" | "desc" }>;

/** Per-field value accessor — returned value fed into the filter predicate. */
export type FieldAccessor<T> = (item: T) => unknown;
export type FieldAccessors<T> = Record<string, FieldAccessor<T>>;

/**
 * Apply a filter object to an item collection. Implicit AND across
 * all top-level keys; implicit eq for scalar values; operator objects
 * resolved per `fieldFilterSchema` semantics.
 *
 * Unrecognised operators are rejected at the Zod layer before reaching
 * this function; at runtime we assume a validated filter. An operator
 * that slips through is ignored (defensive; Zod is the gate).
 */
export function applyQueryFilter<T>(
  items: T[],
  filter: QueryFilter,
  accessors: FieldAccessors<T>,
): T[] {
  const fields = Object.keys(filter);
  if (fields.length === 0) return items;
  // C1-R2 (audit-4054): FAIL-LOUD before matching — an operator the zod accepted
  // but matchField doesn't implement must THROW, never silently match every item
  // (the silent-no-op class, tele-4). Kills the class, not just this instance.
  for (const name of fields) {
    const pred = filter[name];
    if (pred !== null && typeof pred === "object" && !Array.isArray(pred)) {
      assertKnownFilterOps(pred as Record<string, unknown>, name);
    }
  }
  return items.filter((item) =>
    fields.every((name) => matchField(item, filter[name], accessors[name])),
  );
}

function matchField<T>(
  item: T,
  predicate: unknown,
  accessor: FieldAccessor<T> | undefined,
): boolean {
  if (!accessor) return false; // field not in accessor map — treat as no-match
  const value = accessor(item);
  if (predicate === null || typeof predicate !== "object") {
    return value === predicate;
  }
  const p = predicate as Record<string, unknown>;
  // FAIL-CLOSED backstop (audit-4070 / C1-R2-FORBIDDEN-FALLTHROUGH): a predicate
  // with NO implemented operator (a forbidden-only op like $regex that bypassed
  // Zod, or an empty {}) is UNEVALUABLE → match NOTHING, never match-everything
  // (the prior `return true` tail was the fail-OPEN hole). Zod/MCP is the primary
  // rejection; genuinely-unknown ops still THROW via assertKnownFilterOps in
  // applyQueryFilter (runs before this).
  if (!hasImplementedFilterOp(p)) return false;
  if ("$in" in p && Array.isArray(p.$in)) {
    if (!(p.$in as unknown[]).includes(value)) return false;
  }
  // C1-R2: $contains = TYPED array-membership — the stored array `value` CONTAINS
  // the scalar (SameValueZero; [3] does NOT match "3"). Parity with JSONB `@>`.
  if ("$contains" in p) {
    if (!Array.isArray(value) || !(value as unknown[]).includes(p.$contains)) return false;
  }
  if ("$gt" in p) {
    if (!(comparable(value) && comparable(p.$gt) && (value as any) > (p.$gt as any))) return false;
  }
  if ("$lt" in p) {
    if (!(comparable(value) && comparable(p.$lt) && (value as any) < (p.$lt as any))) return false;
  }
  if ("$gte" in p) {
    if (!(comparable(value) && comparable(p.$gte) && (value as any) >= (p.$gte as any))) return false;
  }
  if ("$lte" in p) {
    if (!(comparable(value) && comparable(p.$lte) && (value as any) <= (p.$lte as any))) return false;
  }
  return true;
}

function comparable(v: unknown): boolean {
  return typeof v === "number" || typeof v === "string";
}

/**
 * Apply an ordered-tuple sort with stable tie-breaker semantics.
 * Trailing `id: asc` is appended implicitly so pagination is
 * deterministic even when the caller's sort keys produce ties.
 */
export function applyQuerySort<T>(
  items: T[],
  sort: QuerySort | undefined,
  accessors: FieldAccessors<T>,
): T[] {
  const effective: Array<{ field: string; order: "asc" | "desc" }> =
    sort && sort.length > 0 ? [...sort] : [];
  // Implicit id:asc tie-breaker (only if caller didn't already include id)
  if (!effective.some((s) => s.field === "id")) {
    effective.push({ field: "id", order: "asc" });
  }
  // JS's Array.prototype.sort is stable (TC39). Still apply explicitly
  // because the last criterion is our tie-breaker.
  return [...items].sort((a, b) => {
    for (const { field, order } of effective) {
      const accessor = accessors[field];
      if (!accessor) continue;
      const va = accessor(a);
      const vb = accessor(b);
      if (va === vb) continue;
      // null sorts after real values in both asc + desc (prevents nulls
      // from breaking date comparisons on entities with unset fields).
      if (va == null) return 1;
      if (vb == null) return -1;
      if ((va as any) < (vb as any)) return order === "asc" ? -1 : 1;
      if ((va as any) > (vb as any)) return order === "asc" ? 1 : -1;
    }
    return 0;
  });
}

/**
 * Classify a caller's args into a queryShape category for telemetry.
 * Values: "none" | "filter_only" | "sort_only" | "filter_sort".
 * Used by cognitive-layer CognitiveTelemetry to auto-tag tool_call
 * events; architect-side harness then measures adoption.
 */
export function detectQueryShape(args: Record<string, unknown>): "none" | "filter_only" | "sort_only" | "filter_sort" {
  const hasFilter =
    args.filter != null &&
    typeof args.filter === "object" &&
    !Array.isArray(args.filter) &&
    Object.keys(args.filter as Record<string, unknown>).length > 0;
  const hasSort =
    Array.isArray(args.sort) && args.sort.length > 0;
  if (hasFilter && hasSort) return "filter_sort";
  if (hasFilter) return "filter_only";
  if (hasSort) return "sort_only";
  return "none";
}
