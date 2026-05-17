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
 *   - $regex/$where/$expr/$or/$and/$not forbidden (substrate enforces; errors on use)
 *
 * SchemaDef.FieldDef.type drives narrowing at validation time.
 */
export type FilterValue =
  | string | number | boolean
  | { $in: Array<string | number | boolean> }
  | { $gt?: number | string; $lt?: number | string; $gte?: number | string; $lte?: number | string };

export type Filter = Record<string, FilterValue>;

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
}
