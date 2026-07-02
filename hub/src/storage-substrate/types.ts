/**
 * HubStorageSubstrate — substrate-level type contracts.
 *
 * Per Design v1.1 §2.1 (interface surface) + §2.2 (storage layout) + §2.3 (SchemaDef)
 * + §2.4 (LISTEN/NOTIFY watch primitive). All types are substrate-internal —
 * repositories compose this substrate behind I*Store interfaces per Option Y
 * (Design v1.1 §5.1) and surface entity-specific shapes to handlers unchanged.
 *
 * mission-83 W1 substrate-shell.
 */

// ─── Schema management (CRD-equivalent per Design §2.3) ─────────────────────

/**
 * Per-kind field-translation map: bare legacy field-key ("status") → envelope
 * JSONB dotted-path ("status.phase"). Target paths root at metadata/spec/status.
 *
 * mission-90 W1 promotion (Design §2.1): single runtime declaration — the
 * migration layer's kinds/_contract.ts re-exports this type (no duplicate).
 */
export type RenameMap = Record<string, string>;

/**
 * mission-90 W2 (Design §2.3): the substrate's filter/sort key-translation hook.
 * Maps a bare legacy filter/sort key for a kind to its envelope JSONB dotted-path,
 * or null/undefined for non-renamed keys (caller passes the bare key through).
 * Implemented by SchemaReconciler.getFieldTranslation; late-bound into the
 * substrate via setFieldTranslator to break the substrate↔reconciler construction
 * cycle (the reconciler is constructed with the substrate, then injected back).
 */
export type FieldTranslator = (kind: string, bareKey: string) => string | null;

export interface SchemaDef {
  /** Entity kind this defines (e.g., "Message"). */
  kind: string;
  /** Bump on shape change; reconciler reads latest. */
  version: number;
  /** Declared field schema (validation-only, not column-promote since Flavor A). */
  fields: FieldDef[];
  /** Hot fields that get per-kind expression indexes. */
  indexes: IndexDef[];
  /** Whether to wire a NOTIFY trigger for this kind (default true; substrate-internal-events excluded). */
  watchable: boolean;
  /**
   * mission-88 W7 (bug-123 fix): regex (as serializable string) matching index
   * names this SchemaDef OWNS. `SchemaReconciler.reconcileIndexes` hard-drops any
   * postgres index matching this pattern but NOT in `indexes[]` (handles index
   * renames during envelope migration — e.g. `thread_status_idx` →
   * `thread_status_phase_idx`). Indexes NOT matching the pattern are FOREIGN
   * (ad-hoc operator-created; left alone). Per W7 Q3 refinement: hard-drop
   * owned-deprecated + leave-foreign. Example: `"^thread_"` for Thread-owned.
   * Optional — kinds without index-rename activity can omit.
   */
  indexOwnershipPattern?: string;
  /**
   * mission-90 W1 (Design §2.1): runtime field-translation contract, promoted
   * from migration-only MigrationSchemaRef.renameMap. Generic for ANY key /
   * ANY kind — FSM-phase (status→status.phase), field-collision
   * (Message.kind→metadata.messageKind), opaque-state (body→status.cursor),
   * K8s-name + timestamp relocations all covered. The SchemaReconciler builds
   * its per-kind reverse-translation cache from this field (§2.2); consumed
   * by substrate.list filter/sort translation at W2+. Optional — kinds
   * without renames omit it. AUTHORITATIVE population: schemas/all-schemas.ts;
   * migration modules carry a secondary copy for migration encapsulation
   * (Design §2.7 dual-source discipline).
   */
  renameMap?: RenameMap;
}

export interface FieldDef {
  /** Dotted path into the entity (e.g., "status", "metadata.labels.env"). */
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  required: boolean;
  /** Optional enum constraint (validated at put()). */
  enum?: string[];
}

export interface IndexDef {
  /** Human-readable index name (substrate-prefixed at DDL emission). */
  name: string;
  /** Dotted-path fields participating in the index. */
  fields: string[];
  /**
   * Index method. Default "btree" (text-extracted expression index, the existing
   * behavior). "gin" (C1-R2) emits a GIN index over the JSON-extracted path
   * (`data#>'{path}' jsonb_path_ops`) for the `$contains` (`@>`) array-membership
   * operator — required for an INDEXED containment filter (e.g. roleEligibility[]).
   * GIN is single-field only.
   */
  type?: "btree" | "gin";
  /** Optional partial-index predicate (substrate-translated to JSONB syntax). */
  where?: string;
}

// ─── List / Watch options ────────────────────────────────────────────────────

export interface ListOptions {
  /** Mongo-ish filter; whitelisted fields per SchemaDef. */
  filter?: Filter;
  sort?: Array<{ field: string; order: "asc" | "desc" }>;
  /** Max 500 (clamped). */
  limit?: number;
  offset?: number;
}

/**
 * Watch-stream options.
 *
 * OQ5 disposition (per Design v1.1 §2.1 design notes): list-then-watch backfill
 * is the standard pattern (k8s informer). Caller does substrate.list() → captures
 * snapshotRevision → substrate.watch({ sinceRevision }). Substrate replays change-
 * events strictly newer than that revision; no missed-events window.
 */
export interface WatchOptions {
  filter?: Filter;
  /** Resume-from-position; opaque revision token from a prior list() result. */
  sinceRevision?: string;
  /**
   * Consumer-side cancellation. When aborted, the AsyncIterable's underlying
   * LISTEN connection is closed and the iterator returns. Standard Node pattern;
   * pairs with `for await` + `try { ... } finally { ac.abort() }` consumer shape.
   */
  signal?: AbortSignal;
}

// ─── Filter (per Design v1.1 §2.1 N1 narrowing per QueryableFieldType discipline) ─

/**
 * Filter operator values.
 *
 * Per round-1 audit N1 fold-in (Design v1.1 §2.1): operator-values match
 * M-QueryShape Phase 1 (idea-119 / task-302; hub/src/policy/list-filters.ts)
 * per-field QueryableFieldType discipline:
 *   - $gt/$lt/$gte/$lte permitted only on numeric + date fields
 *   - $in permitted on all scalar types
 *   - $contains permitted only on ARRAY fields (C1-R2: JSONB array-membership —
 *     "the stored array CONTAINS this scalar", `data#>'{path}' @> to_jsonb($v)`;
 *     the inverse of $in, which is "the stored scalar is one of these candidates")
 *   - $regex/$where/$expr/$or/$and/$not forbidden (substrate enforces; errors on use)
 *
 * SchemaDef.FieldDef.type drives narrowing at validation time.
 */
export type FilterValue =
  | string | number | boolean
  | { $in: Array<string | number | boolean> }
  | { $contains: string | number | boolean }
  | { $gt?: number | string; $lt?: number | string; $gte?: number | string; $lte?: number | string };

export type Filter = Record<string, FilterValue>;

/**
 * The operator keys a FilterValue object may legally carry. SINGLE SOURCE OF
 * TRUTH — every matcher (postgres SQL translateFilterClause, the postgres + memory
 * watch matchesFilter, the policy matchField) keys off this set.
 */
export const KNOWN_FILTER_OPERATORS = ["$in", "$contains", "$gt", "$lt", "$gte", "$lte"] as const;

/**
 * Security-rejected operators (ReDoS / arbitrary-code-exec / unbounded logical
 * composition): $regex/$where/$expr/$or/$and/$not. These are rejected at the
 * Zod/MCP validation boundary WITH a permitted-set hint — NOT by the runtime
 * matcher's fail-loud guard (C1-R2 audit-4064). The 3-class operator taxonomy:
 * IMPLEMENTED (KNOWN_FILTER_OPERATORS), FORBIDDEN (this set), UNKNOWN (neither).
 */
export const FORBIDDEN_FILTER_OPERATORS = ["$regex", "$where", "$expr", "$or", "$and", "$not"] as const;

/**
 * FAIL-LOUD guard (C1-R2 audit-4054, refined audit-4064): throw ONLY for a
 * GENUINELY-UNKNOWN operator (neither IMPLEMENTED nor FORBIDDEN) — killing the
 * silent-no-op CLASS (an operator accepted upstream but unimplemented must never
 * silently return the row; tele-4). FORBIDDEN ops are deliberately NOT thrown here:
 * their enforcement is the Zod/MCP forbidden-rejection-with-hint (running first);
 * at the un-Zod'd router level they fall through to the defense-in-depth
 * match-nothing. So: $regex → forbidden-rejection (Zod); a typo'd op → fail-loud.
 */
export function assertKnownFilterOps(op: Record<string, unknown>, field: string): void {
  for (const k of Object.keys(op)) {
    if ((KNOWN_FILTER_OPERATORS as readonly string[]).includes(k)) continue; // IMPLEMENTED
    if ((FORBIDDEN_FILTER_OPERATORS as readonly string[]).includes(k)) continue; // FORBIDDEN → Zod-layer rejection, not here
    throw new Error(
      `[filter] unknown operator '${k}' on field '${field}' — neither implemented nor a recognized ` +
        `forbidden op (fail-loud; no silent-true). Implemented: ${KNOWN_FILTER_OPERATORS.join(", ")}.`,
    );
  }
}

/**
 * FAIL-CLOSED backstop (C1-R2 audit-4070): does this operator object carry at
 * least one IMPLEMENTED operator? A predicate with NONE — a forbidden-only op that
 * bypassed Zod (e.g. `{$regex}`), or an empty `{}` — is UNEVALUABLE, and every
 * matcher MUST treat it as match-NOTHING, never match-EVERYTHING (the fail-OPEN
 * hole: an un-Zod'd forbidden-only predicate would otherwise leak every row).
 *
 * Pairs with `assertKnownFilterOps` (which THROWS for a genuinely-unknown op);
 * this returns a boolean the matcher acts on (`if (!hasImplementedFilterOp(op))
 * return false`). Zod/MCP stays the PRIMARY rejection for forbidden ops; this is
 * the defense-in-depth backstop at the un-Zod'd matcher level, keyed off the same
 * single-source-of-truth KNOWN_FILTER_OPERATORS set so the three matchers (policy
 * matchField, memory + postgres watch matchesFilter) stay at parity.
 */
export function hasImplementedFilterOp(op: Record<string, unknown>): boolean {
  return Object.keys(op).some((k) => (KNOWN_FILTER_OPERATORS as readonly string[]).includes(k));
}

// ─── Change events (per Design §2.1) ─────────────────────────────────────────

export type ChangeEvent<T = unknown> = {
  op: "put" | "delete";
  kind: string;
  id: string;
  /** Present on 'put'; absent on 'delete'. */
  entity?: T;
  /**
   * Dual-purpose token per Design v1.1 §2.1 design notes:
   * (1) opaque monotonic ordering token for watch-stream replay-from-position;
   * (2) CAS token for putIfMatch (per C1 fold-in; substrate-level race-protection
   *     equivalent to mission-47 StorageProvider v1.0 contract).
   *
   * NOT k8s-style entity-versioning-as-API-field (that remains AG-1 /
   * M-Hub-Storage-ResourceVersion / idea-295 territory).
   */
  resourceVersion: string;
};

// ─── CAS result types (per Design v1.1 §2.1 C1 fold-in) ─────────────────────

export type CreateOnlyResult =
  | { ok: true; id: string; resourceVersion: string }
  | { ok: false; conflict: "existing" };

export type PutIfMatchResult =
  | { ok: true; resourceVersion: string }
  | { ok: false; conflict: "revision-mismatch"; actualRevision: string };

// ─── Snapshot / restore (per Design §2.5) ───────────────────────────────────

export type SnapshotRef = {
  path: string;
  sizeBytes: number;
  snapshotAt: string;
  schemaVersion: number;
  entityCount: number;
};

// ─── HubStorageSubstrate interface (the substrate-API surface) ──────────────

/**
 * The sovereign-composition state-backplane for the Hub.
 *
 * Per Design v1.1 §2.1. Above this boundary: PolicyEngine, handlers, sweepers,
 * tools — substrate-agnostic; use typed entities + structured filter API +
 * change-event subscriptions. Below this boundary: SQL, JSONB extraction,
 * index management, snapshot tooling — substrate-internal.
 *
 * Per Option Y (C2 fold-in / §5.1): repositories internally compose this
 * substrate behind existing I*Store interfaces; handler call-sites unchanged.
 */
export interface HubStorageSubstrate {
  // ── Schema management (CRD-equivalent) ────────────────────────────────────
  applySchema(def: SchemaDef): Promise<void>;
  listSchemas(): Promise<SchemaDef[]>;
  getSchema(kind: string): Promise<SchemaDef | null>;

  // ── Entity CRUD (kind-uniform regardless of underlying storage layout) ────
  get<T>(kind: string, id: string): Promise<T | null>;
  /**
   * Design v1.4 fold-in (2026-05-17; architect-direct; engineer-surface caught
   * at W4 first-consumer-use via BugRepositorySubstrate.casUpdate). Returns the
   * entity AND its current resourceVersion in a single round-trip — required
   * for the read-then-CAS pattern at substrate-direct consumer boundary
   * (caller does getWithRevision → mutate → putIfMatch(expectedRevision)).
   * Without this, putIfMatch is unusable from substrate-direct consumers since
   * substrate.get returns T without revision; pattern was implicit-only via
   * watch-stream's ChangeEvent.resourceVersion.
   */
  getWithRevision<T>(kind: string, id: string): Promise<{ entity: T; resourceVersion: string } | null>;
  put<T>(kind: string, entity: T): Promise<{ id: string; resourceVersion: string }>;
  delete(kind: string, id: string): Promise<void>;
  /**
   * Returns items + snapshotRevision (consistent point-in-time the list-result
   * represents); subsequent watch({ sinceRevision }) is gap-free per Design §2.1.
   */
  list<T>(kind: string, opts?: ListOptions): Promise<{ items: T[]; snapshotRevision: string }>;

  // ── CAS primitives (preserve v0 race-protection; round-1 audit C1) ────────
  createOnly<T>(kind: string, entity: T): Promise<CreateOnlyResult>;
  putIfMatch<T>(kind: string, entity: T, expectedRevision: string): Promise<PutIfMatchResult>;

  // ── Watch / change-notification (per Design §2.4 LISTEN/NOTIFY) ───────────
  /**
   * AsyncIterable so handlers consume with for-await-of. Substrate handles
   * connection lifecycle + reconnect + resume-from-revision on transient failures.
   */
  watch<T = unknown>(kind: string, opts?: WatchOptions): AsyncIterable<ChangeEvent<T>>;

  // ── Data-portability (per Survey outcome 3 + Design §2.5) ─────────────────
  snapshot(targetPath: string): Promise<SnapshotRef>;
  restore(source: SnapshotRef): Promise<void>;

  // ── Advisory-lock primitive (mission-89 Phase 1; bug-127/bug-97 sibling) ──
  /**
   * Acquire a substrate-level advisory lock identified by (lockClass, lockKey),
   * run `fn`, then release the lock. Atomic try/finally semantics — lock is
   * released even if `fn` throws.
   *
   * Postgres impl: `pg_try_advisory_lock(int4, int4)` poll-loop on a pinned
   * pool-connection (session-scoped lock semantics require single-connection
   * pinning across acquire + work + release); 2-arg form gives per-class
   * namespace isolation (assertIdentity:fingerprint cannot collide with
   * Counter:kind structurally). Session auto-release on connection drop
   * eliminates orphan-lock risk.
   *
   * Memory impl: in-process Map<`${class}:${key}`, queue> for in-JS-process
   * serialization. NOT a substitute for real-pg contention testing — per
   * Design §4.2 Observation 1, tests verifying contention-correctness MUST
   * use testcontainer postgres; memory variant is incidental-lock support.
   *
   * Options:
   *   - `timeoutMs`: max wall-time waiting to acquire. Throws
   *     `LockAcquisitionTimeoutError` (from `./advisory-lock.ts`) on timeout.
   *     Default: undefined (wait indefinitely).
   *   - `latencyWarnMs`: emit `console.warn` if acquire-latency exceeds this.
   *     Default: 100. Set `Infinity` to disable.
   *
   * Callers SHOULD invoke via the `withAdvisoryLock()` helper in
   * `./advisory-lock.ts` which handles string→int hashing + typed LockClass.
   */
  withAdvisoryLock<T>(
    lockClass: number,
    lockKey: number,
    fn: () => Promise<T>,
    opts?: { timeoutMs?: number; latencyWarnMs?: number },
  ): Promise<T>;

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  /**
   * Release the substrate's connection resources (the postgres connection
   * pool). Call at Hub shutdown / test teardown. Callers must have completed
   * or aborted any active `watch()` iterators first — `close()` does not
   * force-terminate in-flight watch streams. In-memory substrate: no-op (no
   * connections to release). Promoted to the interface at bug-110 so teardown
   * is a typed call rather than an `as unknown`-cast optional-chain.
   */
  close(): Promise<void>;
}
