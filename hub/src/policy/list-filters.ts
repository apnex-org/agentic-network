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

export const DEFAULT_LIST_LIMIT = 100;
export const MAX_LIST_LIMIT = 500;

/** Zod schema fragment — spread into any `list_*` tool registration. */
export const LIST_PAGINATION_SCHEMA = {
  limit: z.number().int().positive().max(MAX_LIST_LIMIT).optional()
    .describe(`Cap the result set size (max ${MAX_LIST_LIMIT}, default ${DEFAULT_LIST_LIMIT}).`),
  offset: z.number().int().nonnegative().optional()
    .describe("Skip the first N entries for pagination (default 0)."),
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
// Shared helpers so list_ideas / list_threads (Phase 2) can adopt the
// same shape without redeclaring schemas. See docs/audits/phase-2x-
// closing.md for the measurement that produced this design.

/**
 * Field type descriptors — control which operators a filterable field
 * accepts. "string" = implicit eq + $in; "date" = all operators on
 * ISO-8601 strings; "number" = all operators on numbers; "enum" = same
 * as string but with a `values` allowlist for additional client-side
 * diagnostics (not enforced by Zod — a typo on an enum value returns
 * empty-match, not a Zod error, which keeps the reject-with-hint
 * surface narrow).
 */
export type QueryableFieldType = "string" | "date" | "number" | "enum";

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
  if ("$in" in p && Array.isArray(p.$in)) {
    if (!(p.$in as unknown[]).includes(value)) return false;
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
