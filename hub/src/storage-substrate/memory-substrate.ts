/**
 * MemoryHubStorageSubstrate — in-process implementation of HubStorageSubstrate.
 *
 * Per Design v1.0 §2.1 (mission-84 M-Hub-Storage-FS-Retirement-And-MemoryHubStorageSubstrate).
 *
 * Purpose: test backend for any code-surface that operates over HubStorageSubstrate
 * (entity repositories; repo-event-bridge cursor + dedupe; Document MCP tools).
 * Replaces the FS-version-repo + MemoryStorageProvider test pattern from mission-47 era.
 *
 * Interface contract: binary-identical to PostgresStorageSubstrate per the
 * HubStorageSubstrate interface at ./types.ts. Both factories pass the
 * SubstrateConformanceSuite (W1; PORT-then-EXTEND from mission-47 conformance.ts).
 *
 * Restart-safety: N/A by design — in-process; data lost on process exit.
 * Conformance-suite restart-safety tests gate this impl as `skip` per §2.3.
 *
 * Watch-primitive semantic: synchronous EventEmitter-style dispatch on put/delete;
 * subscribers receive {op, kind, id, entity, resourceVersion} ChangeEvent identical
 * to postgres LISTEN/NOTIFY payload shape.
 *
 * CAS semantic: putIfMatch checks current resourceVersion matches expectedRevision;
 * returns {ok: false, conflict: "revision-mismatch", actualRevision} on mismatch.
 * createOnly returns {ok: false, conflict: "existing"} when kind+id already present.
 *
 * Resource-version semantic: substrate-wide monotonic counter (mirrors postgres
 * entities_rv_seq); advances on every put / createOnly / putIfMatch / delete.
 * Per-id revisions are NOT per-kind-isolated (matches postgres semantic).
 */

import type {
  HubStorageSubstrate,
  SchemaDef,
  ListOptions,
  WatchOptions,
  ChangeEvent,
  CreateOnlyResult,
  PutIfMatchResult,
  SnapshotRef,
  Filter,
  FilterValue,
} from "./types.js";
import type { WriteEncoder } from "./postgres-substrate.js";
import { buildEnvelopeWriteEncoder } from "./migrations/v2-envelope/write-encoder.js";
import { ALL_SCHEMAS } from "./schemas/all-schemas.js";
import { assertKnownFilterOps, hasImplementedFilterOp } from "./types.js";

type EntityRow = { data: unknown; resourceVersion: number };

// mission-90 W4 (N1/N2): static renameMap authority for the reconciler-less
// memory backend — mirrors all-schemas.ts (the same authority the postgres
// reconciler builds getFieldTranslation from in W2). Built once at module load.
const MEMORY_RENAME_MAP = new Map<string, Record<string, string>>(
  ALL_SCHEMAS.filter((s) => s.renameMap).map((s) => [s.kind, s.renameMap as Record<string, string>]),
);
function memoryTranslateKey(kind: string, bareKey: string): string {
  return MEMORY_RENAME_MAP.get(kind)?.[bareKey] ?? bareKey;
}
type WatchCallback<T = unknown> = (event: ChangeEvent<T>) => void;

/**
 * Factory — returns a HubStorageSubstrate backed by in-process Maps.
 *
 * Each call returns a fresh substrate instance with empty state; no global state
 * leakage between instances. Use one factory call per test for full isolation.
 */
/**
 * mission-90 W8: memory parity with PostgresSubstrate's write-encoder hook, so
 * test harnesses (createTestContext, e2e orchestrator) can wire setWriteEncoder
 * and store ENVELOPE shape — matching prod (all writes envelope via the W4
 * encoder), validating the real envelope-only path rather than a legacy-flat
 * fixture artifact.
 */
export interface MemorySubstrate extends HubStorageSubstrate {
  setWriteEncoder(encoder: WriteEncoder | null): void;
}

/**
 * mission-90 W8: a memory substrate stores ENVELOPE shape BY DEFAULT — faithful to
 * prod, where the W4 envelope write-encoder is wired at Hub boot. This removes the
 * test footgun (build a memory substrate, forget setWriteEncoder, silently store
 * legacy-flat → the envelope-only filters/decoders then mismatch). `rawWrites: true`
 * opts out for substrate-PRIMITIVE / migration / encoder tests that assert raw
 * round-trip (they exercise the storage layer BELOW the envelope contract).
 */
export function createMemoryStorageSubstrate(opts?: { rawWrites?: boolean }): MemorySubstrate {
  const substrate = new MemoryStorageSubstrate();
  if (!opts?.rawWrites) {
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
  }
  return substrate;
}

class MemoryStorageSubstrate implements MemorySubstrate {
  // ─── State ────────────────────────────────────────────────────────────────
  private readonly entities = new Map<string, Map<string, EntityRow>>();
  private revisionCounter = 0;
  private readonly watchers = new Map<string, Set<WatchCallback>>();

  // mission-90 W8: write-side envelope encoder (parity with PostgresSubstrate).
  // Late-bound via setWriteEncoder; null → writes pass through as-given (no-op).
  private writeEncoder: WriteEncoder | null = null;

  setWriteEncoder(encoder: WriteEncoder | null): void {
    this.writeEncoder = encoder;
  }

  /** Encode an entity for storage (envelope-shape) via the injected encoder; no-op if unwired. */
  private encodeForWrite<T>(kind: string, entity: T): T {
    return (this.writeEncoder ? this.writeEncoder(kind, entity) : entity) as T;
  }

  // ─── Schema management ────────────────────────────────────────────────────
  // Schema-defs are stored as entities of kind="SchemaDef" (matches reconciler
  // bootstrap pattern). The applySchema/listSchemas/getSchema convenience
  // wrappers throw to match PostgresStorageSubstrate behavior — production
  // reconciler uses substrate.put("SchemaDef", ...) directly.

  async applySchema(_def: SchemaDef): Promise<void> {
    throw new Error("MemoryHubStorageSubstrate — applySchema convenience-wrapper not implemented; use put(\"SchemaDef\", def) directly (matches PostgresHubStorageSubstrate contract)");
  }

  async listSchemas(): Promise<SchemaDef[]> {
    throw new Error("MemoryHubStorageSubstrate — listSchemas convenience-wrapper not implemented; use list(\"SchemaDef\") directly (matches PostgresHubStorageSubstrate contract)");
  }

  async getSchema(_kind: string): Promise<SchemaDef | null> {
    throw new Error("MemoryHubStorageSubstrate — getSchema convenience-wrapper not implemented; use get(\"SchemaDef\", kind) directly (matches PostgresHubStorageSubstrate contract)");
  }

  // ─── Entity CRUD ──────────────────────────────────────────────────────────

  async get<T>(kind: string, id: string): Promise<T | null> {
    const row = this.entities.get(kind)?.get(id);
    if (!row) return null;
    return cloneEntity(row.data) as T;
  }

  async getWithRevision<T>(kind: string, id: string): Promise<{ entity: T; resourceVersion: string } | null> {
    const row = this.entities.get(kind)?.get(id);
    if (!row) return null;
    return {
      entity: cloneEntity(row.data) as T,
      resourceVersion: String(row.resourceVersion),
    };
  }

  async put<T>(kind: string, entity: T): Promise<{ id: string; resourceVersion: string }> {
    const stored = this.encodeForWrite(kind, entity); // mission-90 W8: envelope-encode (idempotent)
    const id = extractId(stored, kind);
    const rv = ++this.revisionCounter;
    const store = this.getKindStore(kind);
    store.set(id, { data: cloneEntity(stored), resourceVersion: rv });
    this.emit({
      op: "put",
      kind,
      id,
      entity: cloneEntity(stored) as unknown,
      resourceVersion: String(rv),
    });
    return { id, resourceVersion: String(rv) };
  }

  async delete(kind: string, id: string): Promise<void> {
    const store = this.entities.get(kind);
    if (!store || !store.has(id)) return;
    store.delete(id);
    const rv = ++this.revisionCounter;
    this.emit({
      op: "delete",
      kind,
      id,
      resourceVersion: String(rv),
    });
  }

  async list<T>(kind: string, opts: ListOptions = {}): Promise<{ items: T[]; snapshotRevision: string }> {
    const { filter, sort, limit, offset } = opts;
    const store = this.entities.get(kind);
    const snapshotRevision = String(this.revisionCounter);

    if (!store) {
      return { items: [], snapshotRevision };
    }

    let items: unknown[] = Array.from(store.values()).map(r => r.data);

    if (filter) {
      items = items.filter(item => matchesFilter(item as Record<string, unknown>, filter, (k) => memoryTranslateKey(kind, k)));
    }

    if (sort && sort.length > 0) {
      items.sort((a, b) => {
        for (const s of sort) {
          const av = extractDotted(a, s.field);
          const bv = extractDotted(b, s.field);
          const cmp = compareValues(av, bv);
          if (cmp !== 0) return s.order === "desc" ? -cmp : cmp;
        }
        return 0;
      });
    }

    const off = offset ?? 0;
    const lim = Math.min(limit ?? 100, 500);
    items = items.slice(off, off + lim);

    return {
      items: items.map(i => cloneEntity(i)) as T[],
      snapshotRevision,
    };
  }

  // ─── CAS primitives ───────────────────────────────────────────────────────

  async createOnly<T>(kind: string, entity: T): Promise<CreateOnlyResult> {
    const stored = this.encodeForWrite(kind, entity); // mission-90 W8: envelope-encode (idempotent)
    const id = extractId(stored, kind);
    const store = this.getKindStore(kind);
    if (store.has(id)) {
      return { ok: false, conflict: "existing" };
    }
    const rv = ++this.revisionCounter;
    store.set(id, { data: cloneEntity(stored), resourceVersion: rv });
    this.emit({
      op: "put",
      kind,
      id,
      entity: cloneEntity(stored) as unknown,
      resourceVersion: String(rv),
    });
    return { ok: true, id, resourceVersion: String(rv) };
  }

  async putIfMatch<T>(kind: string, entity: T, expectedRevision: string): Promise<PutIfMatchResult> {
    const stored = this.encodeForWrite(kind, entity); // mission-90 W8: envelope-encode (idempotent)
    const id = extractId(stored, kind);
    const store = this.entities.get(kind);
    const row = store?.get(id);
    if (!row) {
      throw new Error(`putIfMatch on absent entity: kind=${kind} id=${id}`);
    }
    if (String(row.resourceVersion) !== expectedRevision) {
      return {
        ok: false,
        conflict: "revision-mismatch",
        actualRevision: String(row.resourceVersion),
      };
    }
    const rv = ++this.revisionCounter;
    store!.set(id, { data: cloneEntity(stored), resourceVersion: rv });
    this.emit({
      op: "put",
      kind,
      id,
      entity: cloneEntity(stored) as unknown,
      resourceVersion: String(rv),
    });
    return { ok: true, resourceVersion: String(rv) };
  }

  // ─── Watch / change-notification ──────────────────────────────────────────
  //
  // AsyncIterable<ChangeEvent>. Mirrors PostgresStorageSubstrate semantic:
  // Step 1 — if sinceRevision provided, replay events strictly newer than that
  //   (memory impl scans current entities for rv > sinceRevision; cannot replay
  //    deletes that happened pre-subscribe — same race as postgres LISTEN before-
  //    NOTIFY-delivers; consumers should subscribe-then-list per OQ5 backfill
  //    pattern OR accept the race window per ChangeEvent race semantics)
  // Step 2 — register watch-callback that pushes future events to local queue;
  //   yield events as they arrive
  // Step 3 — on AbortSignal abort, unsubscribe + return

  async *watch<T = unknown>(kind: string, opts: WatchOptions = {}): AsyncIterable<ChangeEvent<T>> {
    const { filter, sinceRevision, signal } = opts;

    // Local queue + wakeup promise for the consumer
    const queue: ChangeEvent<T>[] = [];
    let resolve: (() => void) | null = null;
    const ready = () => new Promise<void>((r) => { resolve = r; });

    const callback: WatchCallback = (event) => {
      // Type assertion: caller declared T; we accept any entity-type at runtime
      const typedEvent = event as ChangeEvent<T>;
      if (filter && typedEvent.entity && !matchesFilter(typedEvent.entity as Record<string, unknown>, filter, (k) => memoryTranslateKey(kind, k))) {
        return;
      }
      queue.push(typedEvent);
      if (resolve) {
        const r = resolve;
        resolve = null;
        r();
      }
    };

    // Subscribe BEFORE replay to avoid race-window (events fired during replay
    // get queued; deduped by resourceVersion ordering when consumer processes)
    this.subscribe(kind, callback);

    // AbortSignal hookup — when aborted, wake the consumer + unsubscribe
    const abortHandler = () => {
      if (resolve) {
        const r = resolve;
        resolve = null;
        r();
      }
    };
    if (signal) {
      if (signal.aborted) {
        this.unsubscribe(kind, callback);
        return;
      }
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    try {
      // Step 1 — replay current entities with rv > sinceRevision (best-effort
      // since memory has no event-log; delete events pre-subscribe are lost)
      if (sinceRevision !== undefined) {
        const sinceRv = Number(sinceRevision);
        const store = this.entities.get(kind);
        if (store) {
          const replayItems = Array.from(store.entries())
            .filter(([_, row]) => row.resourceVersion > sinceRv)
            .sort((a, b) => a[1].resourceVersion - b[1].resourceVersion);
          for (const [id, row] of replayItems) {
            if (signal?.aborted) return;
            if (filter && !matchesFilter(row.data as Record<string, unknown>, filter, (k) => memoryTranslateKey(kind, k))) continue;
            yield {
              op: "put",
              kind,
              id,
              entity: cloneEntity(row.data) as T,
              resourceVersion: String(row.resourceVersion),
            };
          }
        }
      }

      // Step 2 — drain queue + await wakeups
      while (true) {
        if (signal?.aborted) return;
        while (queue.length > 0) {
          if (signal?.aborted) return;
          yield queue.shift()!;
        }
        if (signal?.aborted) return;
        await ready();
      }
    } finally {
      signal?.removeEventListener("abort", abortHandler);
      this.unsubscribe(kind, callback);
    }
  }

  // ─── Data-portability ─────────────────────────────────────────────────────
  // Memory impl: no on-disk persistence; snapshot/restore stubbed identically
  // to PostgresStorageSubstrate v1 (W1 substrate-shell behavior).

  async snapshot(_targetPath: string): Promise<SnapshotRef> {
    throw new Error("MemoryHubStorageSubstrate — snapshot N/A by design (in-process; data lost on process exit)");
  }

  async restore(_source: SnapshotRef): Promise<void> {
    throw new Error("MemoryHubStorageSubstrate — restore N/A by design (in-process; data lost on process exit)");
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /** No-op — the in-memory substrate holds no connection resources to release. */
  async close(): Promise<void> {
    /* in-memory — nothing to release */
  }

  // ─── Advisory-lock (mission-89 Phase 1) ───────────────────────────────────
  //
  // In-process Map<`${class}:${key}`, Promise> chain. Each acquire awaits the
  // current chain-tail then becomes the new tail; release flips a single-shot
  // resolver so the next waiter unblocks. Provides JS-process serialization
  // semantics — adequate for unit tests where lock-presence is incidental;
  // NOT a substitute for testcontainer pg per Design §4.2 Observation 1.
  private readonly lockChain = new Map<string, Promise<void>>();

  async withAdvisoryLock<T>(
    lockClass: number,
    lockKey: number,
    fn: () => Promise<T>,
    opts?: { timeoutMs?: number; latencyWarnMs?: number },
  ): Promise<T> {
    const compositeKey = `${lockClass}:${lockKey}`;
    const startedAt = Date.now();
    const timeoutMs = opts?.timeoutMs;
    const latencyWarnMs = opts?.latencyWarnMs ?? 100;

    const prior = this.lockChain.get(compositeKey) ?? Promise.resolve();
    let releaseNext: () => void = () => {};
    const next = new Promise<void>((resolve) => { releaseNext = resolve; });
    this.lockChain.set(compositeKey, prior.then(() => next));

    try {
      if (timeoutMs !== undefined) {
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          prior,
          new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(async () => {
              const elapsed = Date.now() - startedAt;
              const { LockAcquisitionTimeoutError } = await import("./advisory-lock.js");
              reject(new LockAcquisitionTimeoutError(lockClass, String(lockKey), elapsed));
            }, timeoutMs);
          }),
        ]).finally(() => { if (timeoutHandle) clearTimeout(timeoutHandle); });
      } else {
        await prior;
      }

      const acquireLatencyMs = Date.now() - startedAt;
      if (acquireLatencyMs > latencyWarnMs && latencyWarnMs !== Infinity) {
        console.warn(
          `[advisory-lock] acquire latency ${acquireLatencyMs}ms exceeded ${latencyWarnMs}ms ` +
            `(class=${lockClass}, key=${lockKey})`,
        );
      }

      return await fn();
    } finally {
      releaseNext();
      // Clean up the chain entry if we're still the tail (best-effort GC).
      const currentTail = this.lockChain.get(compositeKey);
      // A waiter may have replaced the tail already; only drop the entry if
      // chain is fully drained (tail resolves to undefined after settle).
      if (currentTail) {
        currentTail.then(() => {
          if (this.lockChain.get(compositeKey) === currentTail) {
            this.lockChain.delete(compositeKey);
          }
        }).catch(() => {/* swallow chain errors here; caller saw fn-throw */});
      }
    }
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  private getKindStore(kind: string): Map<string, EntityRow> {
    let store = this.entities.get(kind);
    if (!store) {
      store = new Map();
      this.entities.set(kind, store);
    }
    return store;
  }

  private subscribe(kind: string, callback: WatchCallback): void {
    let subs = this.watchers.get(kind);
    if (!subs) {
      subs = new Set();
      this.watchers.set(kind, subs);
    }
    subs.add(callback);
  }

  private unsubscribe(kind: string, callback: WatchCallback): void {
    const subs = this.watchers.get(kind);
    if (!subs) return;
    subs.delete(callback);
    if (subs.size === 0) this.watchers.delete(kind);
  }

  private emit(event: ChangeEvent): void {
    const subs = this.watchers.get(event.kind);
    if (!subs) return;
    // Copy to array so concurrent unsubscribe-during-emit is safe
    for (const cb of Array.from(subs)) cb(event);
  }
}

// ─── Helpers (parallel postgres-substrate.ts) ────────────────────────────────

/**
 * Extract entity ID — same convention as PostgresStorageSubstrate:
 * - kind="Counter" uses fixed id "counter" (single-row meta entity)
 * - all other kinds require entity.id
 */
function extractId<T>(entity: T, kind: string): string {
  if (kind === "Counter") return "counter";
  const id = (entity as unknown as { id?: string }).id;
  if (!id) {
    throw new Error(`entity missing required 'id' field for kind=${kind}`);
  }
  return id;
}

/**
 * Defensive clone of entity body. Caller-side mutation of the returned entity
 * must not affect substrate state (and vice-versa). Uses structuredClone for
 * deep clone of JSON-shaped data; matches postgres-substrate's implicit
 * defensive-copy via JSONB round-trip.
 */
function cloneEntity(data: unknown): unknown {
  // structuredClone handles nested objects/arrays/primitives; rejects functions
  // (which entities never contain — JSONB-compatible only)
  return structuredClone(data);
}

/**
 * Extract dotted-path field value from object. Mirrors postgres-substrate's
 * jsonbField translation but operates on JS objects directly.
 *   "status"          → entity.status
 *   "metadata.env"    → entity.metadata?.env
 */
function extractDotted(entity: unknown, dottedPath: string): unknown {
  let v: unknown = entity;
  for (const p of dottedPath.split(".")) {
    if (v && typeof v === "object" && p in (v as object)) {
      v = (v as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return v;
}

/**
 * Compare two field-extracted values for sort. Matches postgres-substrate's
 * implicit JSONB-text-cast comparison ordering: undefined/null last, numeric
 * comparison for numeric-coercible strings, lexicographic otherwise.
 */
function compareValues(a: unknown, b: unknown): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const an = Number(a);
  const bn = Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) {
    return an < bn ? -1 : an > bn ? 1 : 0;
  }
  const as = String(a);
  const bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

/**
 * Client-side filter match for list + watch. Mirrors PostgresStorageSubstrate's
 * matchesFilter helper (used in watch-replay path); same semantics.
 *
 * Per Design v1.1 §2.1 FilterValue discriminated union:
 * - Scalar (string|number|boolean) → strict-equality on stringified value
 * - $in → array membership
 * - $gt/$lt/$gte/$lte → numeric/ISO-date comparison
 */
function matchesFilter(entity: Record<string, unknown>, filter: Filter, translateKey?: (bareKey: string) => string): boolean {
  for (const [rawField, value] of Object.entries(filter)) {
    // mission-90 W4 (N1/N2): envelope-aware — rewrite the bare filter key to its
    // envelope JSONB path via the renameMap authority (memory is reconciler-less →
    // caller supplies a static all-schemas translator) + read it. mission-90 W8:
    // the dual-shape bare-straggler fallback is retired (W6 proved 0 bare rows).
    const envField = translateKey ? translateKey(rawField) : rawField;
    const v = extractDotted(entity, envField);

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      if (String(v) !== String(value)) return false;
      continue;
    }
    if (typeof value === "object" && value !== null) {
      const op = value as Record<string, unknown>;
      // C1-R2 (audit-4054): FAIL-LOUD on any operator not implemented here — kills
      // the silent-no-op CLASS (tele-4), keeps memory at parity with the SQL path.
      assertKnownFilterOps(op, rawField);
      // FAIL-CLOSED backstop (audit-4070): a predicate with NO implemented operator
      // (forbidden-only / empty) is UNEVALUABLE → match NOTHING, never fall through
      // to the `return true` tail (the fail-OPEN hole). Parity with policy matchField.
      if (!hasImplementedFilterOp(op)) return false;
      if ("$in" in op && Array.isArray(op.$in) && !op.$in.map(String).includes(String(v))) return false;
      // $contains (C1-R2): TYPED array-membership (SameValueZero; [3] does NOT match
      // "3", ['true'] does NOT match true) — parity with the typed JSONB `@>`.
      if ("$contains" in op && op.$contains !== undefined) {
        if (!Array.isArray(v) || !v.includes(op.$contains)) return false;
      }
      // bug-104: range comparison — numeric when both sides coerce to a finite
      // number (numbers + ISO-dates), else lexical string comparison. This
      // mirrors postgres `data->>'field' > $param` text semantics, and is
      // required for the ULID `since` cursor (`{id: {$gt: <ulid>}}`): ULIDs
      // lex-sort = time-sort but are not numeric, so the prior numeric-only
      // `numericCmp` compare yielded NaN → rejected every row. Absent field
      // (v null/undefined) never matches a range filter.
      const rangeCmp = (operand: unknown): number => {
        const vn = numericCmp(v), on = numericCmp(operand);
        if (Number.isFinite(vn) && Number.isFinite(on)) return vn < on ? -1 : vn > on ? 1 : 0;
        const vs = String(v), os = String(operand);
        return vs < os ? -1 : vs > os ? 1 : 0;
      };
      if ("$gt" in op && op.$gt !== undefined && (v == null || rangeCmp(op.$gt) <= 0)) return false;
      if ("$lt" in op && op.$lt !== undefined && (v == null || rangeCmp(op.$lt) >= 0)) return false;
      if ("$gte" in op && op.$gte !== undefined && (v == null || rangeCmp(op.$gte) < 0)) return false;
      if ("$lte" in op && op.$lte !== undefined && (v == null || rangeCmp(op.$lte) > 0)) return false;
    }
  }
  return true;
}

function numericCmp(x: unknown): number {
  if (typeof x === "number") return x;
  if (typeof x === "string") {
    const ms = Date.parse(x);
    if (Number.isFinite(ms)) return ms;
    const n = Number(x);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

// Suppress unused-warning for FilterValue (re-exported via types.ts; symbol kept
// for parity with postgres-substrate.ts import block)
export type { FilterValue };
