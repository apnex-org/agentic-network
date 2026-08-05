/**
 * PostgresStorageSubstrate — concrete implementation of HubStorageSubstrate.
 *
 * Per Design v1.1 §2.1 (interface) + §2.2 (storage layout) + §2.4 (LISTEN/NOTIFY).
 * mission-83 W1 substrate-shell. CRUD + CAS + watch ALL implemented at W1.3
 * (this commit); unit tests via testcontainers harness land at W1.4.
 *
 * Per Option Y (C2 fold-in): repositories internally compose this substrate
 * behind I*Store interfaces; handler call-sites unchanged.
 *
 * pg client wiring uses connection-pool for CRUD + dedicated LISTEN-client for
 * watch (LISTEN must run on its own connection per postgres protocol).
 */

import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { attachPgErrorHandler } from "./pg-error-handler.js";
import type {
  HubStorageSubstrate,
  SchemaDef,
  ListOptions,
  WatchOptions,
  ChangeEvent,
  CreateOnlyResult,
  PutIfMatchResult,
  BatchCreateOnlyResult,
  BatchPutIfMatchEntry,
  BatchPutIfMatchResult,
  SnapshotRef,
  Filter,
  FilterValue,
  FieldTranslator,
} from "./types.js";
import { translateKeyOrThrow } from "./filter-translation-error.js";
import { assertKnownFilterOps, hasImplementedFilterOp } from "./types.js";
import { AdmissionGate, type AdmissionGateSnapshot } from "./admission-gate.js";

const { Pool, Client } = pg;

/** mission-90 W4: write-side envelope encoder — `(kind, entity) => envelopeRow`. */
export type WriteEncoder = (kind: string, entity: unknown) => unknown;

/**
 * Postgres substrate handle. Extends HubStorageSubstrate with two late-bound
 * injection points — kept OFF the HubStorageSubstrate interface so the memory
 * substrate (and its consumers) are unaffected:
 *   - setFieldTranslator (W2): READ-side bare-key → envelope-path translation.
 *   - setWriteEncoder (W4): WRITE-side bare → envelope encoding at put/createOnly/
 *     putIfMatch (idea-324 close-all-bare-writers). Symmetric declarative authorities.
 *   - setPartitionedKindCheck (C3-R4b): the known-partitioned-kind oracle that arms
 *     FilterTranslationGapError at the filter-translate path.
 */
export interface PostgresSubstrate extends HubStorageSubstrate {
  setFieldTranslator(translator: FieldTranslator | null): void;
  setWriteEncoder(encoder: WriteEncoder | null): void;
  setPartitionedKindCheck(check: ((kind: string) => boolean) | null): void;
  /** bug-343 successor: observed, phase-resettable list-admission telemetry. */
  getListAdmissionSnapshot(): AdmissionGateSnapshot;
  resetListAdmissionObservations(): void;
}

/** Per-instance pool tuning (C1-R2 audit-4103). Both fall back to env / defaults when
 *  omitted — existing callers pass connStr only (unchanged). Lets tests parametrize the
 *  pool to assert the starvation regression guard. */
export interface PostgresSubstrateOptions {
  /** node-pg pool max connections (default env POSTGRES_POOL_MAX ?? 25, floor 2). */
  max?: number;
  /** ms a query waits for a free connection before erroring (default env
   *  POSTGRES_CONNECTION_TIMEOUT_MS, else undefined = wait indefinitely — prod unchanged). */
  connectionTimeoutMillis?: number;
  /** Maximum concurrent substrate.list queries (default env POSTGRES_LIST_MAX_CONCURRENCY ?? 8). */
  listMaxConcurrency?: number;
  /** Maximum list callers queued behind the admission gate (default env POSTGRES_LIST_MAX_QUEUED ?? 128). */
  listMaxQueued?: number;
  /** Maximum queue wait before loud backpressure (default env POSTGRES_LIST_ADMISSION_TIMEOUT_MS ?? 30s). */
  listAdmissionTimeoutMs?: number;
}

/**
 * Factory — returns a PostgresSubstrate backed by a postgres connection-pool.
 */
export function createPostgresStorageSubstrate(connectionString: string, opts?: PostgresSubstrateOptions): PostgresSubstrate {
  return new PostgresStorageSubstrate(connectionString, opts);
}

interface LockedPgSession {
  client: pg.PoolClient;
  /** node-postgres permits one active query per client; serialize Promise.all callers. */
  tail: Promise<void>;
}

class PostgresStorageSubstrate implements PostgresSubstrate {
  private readonly pool: pg.Pool;
  /** Every bounded CRUD/CAS/list query inside withAdvisoryLock uses the lock-owning session. */
  private readonly lockClientContext = new AsyncLocalStorage<LockedPgSession>();
  /**
   * bug-343: server-wide (per Hub process) admission boundary in front of list
   * work. pg.Pool bounds connections but not its waiter queue; reconnect storms
   * could therefore enqueue an unbounded number of scan-shaped requests. The
   * gate is deliberately below repositories so list_missions, pending-action,
   * agent/session rehydration, and every future reconnect read share one bound.
   */
  private readonly listAdmission: AdmissionGate;

  private query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<T>> {
    const session = this.lockClientContext.getStore();
    if (!session) return this.pool.query<T>(text, values);
    const query = session.tail.then(() => session.client.query<T>(text, values));
    session.tail = query.then(() => undefined, () => undefined);
    return query;
  }

  /**
   * mission-90 W2 (Design §2.3): bare-key → envelope-JSONB-path translator,
   * late-bound via setFieldTranslator AFTER the reconciler is constructed +
   * started (breaks the substrate↔reconciler construction cycle). null until
   * wired (tests + memory-parity dev paths) → list() is a pure no-op passthrough.
   */
  private fieldTranslator: FieldTranslator | null = null;

  /**
   * C3-R4b (piece 1): "is this a known envelope-partitioned kind?" oracle,
   * late-bound via setPartitionedKindCheck at Hub boot (→ reconciler.hasTranslations).
   * Gates FilterTranslationGapError: a null translation is a GAP only for a known
   * partitioned kind. null until wired (tests/dev) → the gap-throw is inert.
   */
  private partitionedKindCheck: ((kind: string) => boolean) | null = null;

  /**
   * mission-90 W4 (idea-324): write-side envelope encoder, late-bound via
   * setWriteEncoder at Hub boot. Routes every put/createOnly/putIfMatch through
   * the single shape-authority (migration-module migrateOne) so ALL writes land
   * envelope-shape — complete-by-construction (no per-repo writer can be missed).
   * Idempotent (envelope rows pass through byte-identical). null until wired
   * (tests/dev that don't wire it write the entity as-given — no-op).
   */
  private writeEncoder: WriteEncoder | null = null;

  constructor(connectionString: string, opts?: PostgresSubstrateOptions) {
    // C1-R2 audit-4103 (construction HIGH): pool-starvation fix. withAdvisoryLock pins ONE
    // connection for the lock session while the inner list/CAS each need ANOTHER from the
    // pool — so each concurrent distinct-agent claim transiently needs ~2 connections. At
    // the pg default max=10 this DEADLOCKS at >=10 concurrent distinct claimers (the
    // lock-holders pin all 10 → the inner ops can't acquire → hang). Set an explicit max
    // sized for expected concurrency (env POSTGRES_POOL_MAX, default 25 — Steve's audit-4120
    // headroom formula 2·expected + reserve for ~10 distinct claimers, leaving room for the
    // schema/token/watch/sweeper/non-claim traffic that also draws on the pool). The
    // structural fix (inner ops reusing the pinned connection → 1-per-claim) is the
    // wide-adoption follow-on. connectionTimeoutMillis (opt/env) makes a starved query
    // fail-fast+loud instead of hanging — undefined by default (prod unchanged), settable
    // per-instance (the regression guard uses it).
    const max = Math.max(2, opts?.max ?? Number(process.env.POSTGRES_POOL_MAX ?? 25));
    const connectionTimeoutMillis = opts?.connectionTimeoutMillis
      ?? (process.env.POSTGRES_CONNECTION_TIMEOUT_MS ? Number(process.env.POSTGRES_CONNECTION_TIMEOUT_MS) : undefined);
    this.pool = new Pool({ connectionString, max, ...(connectionTimeoutMillis ? { connectionTimeoutMillis } : {}) });
    const boundedInteger = (candidate: number | undefined, fallback: number, minimum: number): number => {
      const value = candidate ?? fallback;
      return Number.isFinite(value) ? Math.max(minimum, Math.floor(value)) : fallback;
    };
    const listMaxConcurrency = boundedInteger(
      opts?.listMaxConcurrency ?? Number(process.env.POSTGRES_LIST_MAX_CONCURRENCY),
      8,
      1,
    );
    const listMaxQueued = boundedInteger(
      opts?.listMaxQueued ?? Number(process.env.POSTGRES_LIST_MAX_QUEUED),
      128,
      0,
    );
    const listAdmissionTimeoutMs = boundedInteger(
      opts?.listAdmissionTimeoutMs ?? Number(process.env.POSTGRES_LIST_ADMISSION_TIMEOUT_MS),
      30_000,
      1,
    );
    this.listAdmission = new AdmissionGate(listMaxConcurrency, listMaxQueued, listAdmissionTimeoutMs);
    // bug-110 — without an 'error' listener an idle-connection backend error
    // is an uncaught exception that crashes the process (pg contract).
    attachPgErrorHandler(this.pool, "PostgresStorageSubstrate pool");
  }

  /**
   * mission-90 W2 (Design §2.3): inject the reconciler's field-translation hook.
   * Called once at Hub boot after reconciler.start(); a null arg clears it.
   */
  setFieldTranslator(translator: FieldTranslator | null): void {
    this.fieldTranslator = translator;
  }

  /**
   * C3-R4b (piece 1): inject the known-partitioned-kind oracle
   * (→ reconciler.hasTranslations). Wired in production (index.ts) after
   * reconciler.start(); arms FilterTranslationGapError on the filter-translate
   * path. A null arg clears it (gap-throw inert — tests/dev).
   */
  setPartitionedKindCheck(check: ((kind: string) => boolean) | null): void {
    this.partitionedKindCheck = check;
  }

  /**
   * mission-90 W4 (idea-324): inject the write-side envelope encoder. Called once
   * at Hub boot. A null arg clears it (writes pass through unencoded).
   */
  setWriteEncoder(encoder: WriteEncoder | null): void {
    this.writeEncoder = encoder;
  }

  getListAdmissionSnapshot(): AdmissionGateSnapshot {
    return this.listAdmission.snapshot();
  }

  resetListAdmissionObservations(): void {
    this.listAdmission.resetObservations();
  }

  /** Encode an entity for storage (envelope-shape) via the injected write-encoder; no-op if unwired. */
  private encodeForWrite<T>(kind: string, entity: T): T {
    return (this.writeEncoder ? this.writeEncoder(kind, entity) : entity) as T;
  }

  /**
   * mission-90 W2 (Design §2.3): translate a single bare filter/sort key for a
   * kind to its envelope JSONB dotted-path. Pure no-op (returns the bare key)
   * when no translator is wired or the key carries no rename.
   *
   * PRECONDITION: rewrites to envelope paths → correct only against envelope-
   * shaped rows (post-W6 re-migration; W2 deploys batched with W6, never
   * standalone). Inert until setFieldTranslator is wired (tests/dev = no-op).
   */
  private translateKey(kind: string, bareKey: string): string {
    if (!this.fieldTranslator) return bareKey; // inert until wired (tests/dev)
    // C3-R4b (piece 1): fail-loud at filter-translate when a known partitioned
    // kind's domain key has no renameMap entry (the silent-miss gap, bug-138/
    // bug-170). Arms only when the partitioned-kind oracle is ALSO wired
    // (production); otherwise the bare key passes through, exactly as before.
    return translateKeyOrThrow(
      kind,
      bareKey,
      (k, b) => this.fieldTranslator!(k, b),
      (k) => this.partitionedKindCheck?.(k) ?? false,
    );
  }

  // ── Schema management (W2 reconciler integration; stubbed at W1) ──────────

  async applySchema(_def: SchemaDef): Promise<void> {
    throw new Error("W2 reconciler — schema apply not implemented at W1 substrate-shell");
  }

  async listSchemas(): Promise<SchemaDef[]> {
    throw new Error("W2 reconciler — schema list not implemented at W1 substrate-shell");
  }

  async getSchema(_kind: string): Promise<SchemaDef | null> {
    throw new Error("W2 reconciler — schema get not implemented at W1 substrate-shell");
  }

  // ── Entity CRUD (per Design v1.1 §2.1) ────────────────────────────────────

  async get<T>(kind: string, id: string): Promise<T | null> {
    const r = await this.query<{ data: T }>(
      `SELECT data FROM entities WHERE kind = $1 AND id = $2`,
      [kind, id],
    );
    return r.rows[0]?.data ?? null;
  }

  /**
   * Design v1.4 fold-in — read-then-CAS read primitive. Single round-trip
   * SELECT of data + resource_version; pair with putIfMatch(..., resourceVersion)
   * for proper substrate-boundary CAS (vs spike-quality simple get+put with
   * race-window).
   */
  async getWithRevision<T>(kind: string, id: string): Promise<{ entity: T; resourceVersion: string } | null> {
    const r = await this.query<{ data: T; resource_version: string }>(
      `SELECT data, resource_version FROM entities WHERE kind = $1 AND id = $2`,
      [kind, id],
    );
    const row = r.rows[0];
    if (!row) return null;
    return { entity: row.data, resourceVersion: String(row.resource_version) };
  }

  async put<T>(kind: string, entity: T): Promise<{ id: string; resourceVersion: string }> {
    const stored = this.encodeForWrite(kind, entity); // mission-90 W4: envelope-encode (idempotent)
    const id = extractId(stored, kind);
    const r = await this.query<{ resource_version: string }>(
      `INSERT INTO entities (kind, id, data, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (kind, id) DO UPDATE
         SET data = EXCLUDED.data,
             updated_at = NOW(),
             resource_version = nextval('entities_rv_seq')
       RETURNING resource_version`,
      [kind, id, stored as object],
    );
    return { id, resourceVersion: String(r.rows[0]!.resource_version) };
  }

  async delete(kind: string, id: string): Promise<void> {
    await this.query(`DELETE FROM entities WHERE kind = $1 AND id = $2`, [kind, id]);
  }

  async list<T>(kind: string, opts: ListOptions = {}): Promise<{ items: T[]; snapshotRevision: string }> {
    const { filter, sort, limit, offset } = opts;
    const where: string[] = ["kind = $1"];
    const params: unknown[] = [kind];
    let p = 2;

    // mission-90 W2 (Design §2.3): translate each bare filter key → envelope JSONB
    // path INLINE (symmetric with the sort path below) so EACH original filter
    // entry yields its own clause — a per-entry translate can never collapse two
    // entries that map to the same path the way an object-rebuild would.
    // translateFilterClause/jsonbField stay unchanged (they receive the path name).
    // Filter translation per FilterValue discriminated union (per Design v1.1 §2.1 N1)
    if (filter) {
      for (const [field, value] of Object.entries(filter)) {
        const clause = translateFilterClause(this.translateKey(kind, field), value, p, params);
        where.push(clause.sql);
        p = clause.nextParamIndex;
      }
    }

    // Sort translation: bare key → envelope JSONB path (mission-90 W2, same hook),
    // then dotted-path field → JSONB extract. Reserved immutable `id` maps to
    // the canonical column so stable complete paging uses entities_pkey instead
    // of sorting on a JSON expression (bug-343 truncation-honesty successor).
    let orderSql = "";
    if (sort && sort.length > 0) {
      const parts = sort.map((s) => {
        const translated = this.translateKey(kind, s.field);
        const expression = translated === "id" ? "id" : jsonbField(translated);
        return `${expression} ${s.order === "desc" ? "DESC" : "ASC"}`;
      });
      orderSql = ` ORDER BY ${parts.join(", ")}`;
    }

    const limitClamped = Math.min(limit ?? 100, 500);
    const limitSql = ` LIMIT ${limitClamped}`;
    const offsetSql = offset !== undefined ? ` OFFSET ${Number(offset)}` : "";

    // bug-343: capture the substrate high-water mark through the existing
    // entities_rv_idx, never retain the planner-dependent MAX(resource_version)
    // aggregate shape seen scanning the heap in the production incident.
    // Concurrent reconnect state-sync multiplied that shape across
    // list_missions, get_pending_actions, drain_pending_actions, and session
    // rehydration. A backward LIMIT 1 on the monotonic rv index preserves the
    // same committed high-water semantics in one round-trip while making the
    // indexed O(log N) plan explicit.
    const sql = `
      WITH snapshot AS (
             SELECT COALESCE((
               SELECT resource_version FROM entities
               ORDER BY resource_version DESC LIMIT 1
             ), 0) AS rv
           ),
           items AS (
             SELECT data, resource_version FROM entities
             WHERE ${where.join(" AND ")}
             ${orderSql} ${limitSql} ${offsetSql}
           )
      SELECT (SELECT rv FROM snapshot) AS snapshot_rv,
             (SELECT json_agg(items.data) FROM items) AS items_json`;
    // bug-343: explicit bounded admission before pg.Pool's unbounded waiter
    // queue. Excess reconnect reads wait FIFO up to the configured bound, then
    // fail loud with StorageAdmissionError rather than stampeding PostgreSQL.
    // Route the admitted query through query() so a WorkGraph advisory-lock
    // transaction continues using the lock-owning PostgreSQL session.
    const r = await this.listAdmission.run(() =>
      this.query<{ snapshot_rv: string; items_json: T[] | null }>(sql, params),
    );
    const row = r.rows[0]!;
    return {
      items: row.items_json ?? [],
      snapshotRevision: String(row.snapshot_rv),
    };
  }

  // ── CAS primitives (per C1 fold-in; preserve v0 race-protection) ──────────

  async createOnly<T>(kind: string, entity: T): Promise<CreateOnlyResult> {
    const stored = this.encodeForWrite(kind, entity); // mission-90 W4: envelope-encode (idempotent)
    const id = extractId(stored, kind);
    const r = await this.query<{ resource_version: string }>(
      `INSERT INTO entities (kind, id, data, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (kind, id) DO NOTHING
       RETURNING resource_version`,
      [kind, id, stored as object],
    );
    if (r.rowCount === 0) {
      return { ok: false, conflict: "existing" };
    }
    return { ok: true, id, resourceVersion: String(r.rows[0]!.resource_version) };
  }

  async createBatchOnly(entries: readonly { kind: string; entity: unknown }[]): Promise<BatchCreateOnlyResult> {
    if (entries.length === 0) return { ok: true, resourceVersions: {} };
    const prepared = entries.map((entry) => {
      const stored = this.encodeForWrite(entry.kind, entry.entity);
      const id = extractId(stored, entry.kind);
      return { ...entry, stored, id, key: `${entry.kind}/${id}` };
    });
    if (new Set(prepared.map((entry) => entry.key)).size !== prepared.length) throw new Error("createBatchOnly rejects duplicate kind/id entries");
    const inherited = this.lockClientContext.getStore();
    const ownsConnection = !inherited;
    const client = inherited?.client ?? await this.pool.connect();
    try {
      if (inherited) await inherited.tail;
      await client.query("BEGIN");
      const existing: Array<{ kind: string; id: string }> = [];
      for (const entry of prepared) {
        const row = await client.query(`SELECT 1 FROM entities WHERE kind = $1 AND id = $2 FOR UPDATE`, [entry.kind, entry.id]);
        if (row.rowCount !== 0) existing.push({ kind: entry.kind, id: entry.id });
      }
      if (existing.length > 0) {
        await client.query("ROLLBACK");
        return { ok: false, conflict: "existing", existing };
      }
      const resourceVersions: Record<string, string> = {};
      for (const entry of prepared) {
        const inserted = await client.query<{ resource_version: string }>(
          `INSERT INTO entities (kind, id, data, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING resource_version`,
          [entry.kind, entry.id, entry.stored as object],
        );
        resourceVersions[entry.key] = String(inserted.rows[0]!.resource_version);
      }
      await client.query("COMMIT");
      return { ok: true, resourceVersions };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      if (ownsConnection) client.release();
    }
  }

  async putIfMatch<T>(kind: string, entity: T, expectedRevision: string): Promise<PutIfMatchResult> {
    const stored = this.encodeForWrite(kind, entity); // mission-90 W4: envelope-encode (idempotent)
    const id = extractId(stored, kind);
    const r = await this.query<{ resource_version: string }>(
      `UPDATE entities
         SET data = $3,
             updated_at = NOW(),
             resource_version = nextval('entities_rv_seq')
       WHERE kind = $1 AND id = $2 AND resource_version = $4
       RETURNING resource_version`,
      [kind, id, stored as object, expectedRevision],
    );
    if (r.rowCount === 0) {
      // Either row doesn't exist OR revision mismatch — fetch current for caller
      const cur = await this.query<{ resource_version: string }>(
        `SELECT resource_version FROM entities WHERE kind = $1 AND id = $2`,
        [kind, id],
      );
      if (cur.rowCount === 0) {
        throw new Error(`putIfMatch on absent entity: kind=${kind} id=${id}`);
      }
      return {
        ok: false,
        conflict: "revision-mismatch",
        actualRevision: String(cur.rows[0]!.resource_version),
      };
    }
    return { ok: true, resourceVersion: String(r.rows[0]!.resource_version) };
  }

  async putBatchIfMatch(entries: readonly BatchPutIfMatchEntry[]): Promise<BatchPutIfMatchResult> {
    if (entries.length === 0) return { ok: true, resourceVersions: {} };
    const prepared = entries.map((entry) => {
      const stored = this.encodeForWrite(entry.kind, entry.entity);
      const id = extractId(stored, entry.kind);
      return { ...entry, stored, id, key: `${entry.kind}/${id}` };
    });
    if (new Set(prepared.map((entry) => entry.key)).size !== prepared.length) {
      throw new Error("putBatchIfMatch rejects duplicate kind/id entries");
    }

    const inherited = this.lockClientContext.getStore();
    const ownsConnection = !inherited;
    const client = inherited?.client ?? await this.pool.connect();
    // All ordinary CRUD inside a WorkGraph writer fence already routes to this
    // client. The batch uses it directly so BEGIN/validation/CAS/COMMIT cannot
    // be split across pool sessions.
    try {
      if (inherited) await inherited.tail;
      await client.query("BEGIN");
      const conflicts: Array<{ kind: string; id: string; expectedRevision: string; actualRevision: string | null }> = [];
      for (const entry of prepared) {
        const row = await client.query<{ resource_version: string }>(
          `SELECT resource_version FROM entities WHERE kind = $1 AND id = $2 FOR UPDATE`,
          [entry.kind, entry.id],
        );
        const actualRevision = row.rowCount === 0 ? null : String(row.rows[0]!.resource_version);
        if (actualRevision !== entry.expectedRevision) {
          conflicts.push({ kind: entry.kind, id: entry.id, expectedRevision: entry.expectedRevision, actualRevision });
        }
      }
      if (conflicts.length > 0) {
        await client.query("ROLLBACK");
        return { ok: false, conflict: "revision-mismatch", conflicts };
      }
      const resourceVersions: Record<string, string> = {};
      for (const entry of prepared) {
        const updated = await client.query<{ resource_version: string }>(
          `UPDATE entities
             SET data = $3,
                 updated_at = NOW(),
                 resource_version = nextval('entities_rv_seq')
           WHERE kind = $1 AND id = $2 AND resource_version = $4
           RETURNING resource_version`,
          [entry.kind, entry.id, entry.stored as object, entry.expectedRevision],
        );
        if (updated.rowCount !== 1) throw new Error(`putBatchIfMatch lost locked row ${entry.key}`);
        resourceVersions[entry.key] = String(updated.rows[0]!.resource_version);
      }
      await client.query("COMMIT");
      return { ok: true, resourceVersions };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      if (ownsConnection) client.release();
    }
  }

  // ── Watch / change-notification (per Design §2.4 LISTEN/NOTIFY) ───────────

  /**
   * bug-187 TEST SEAM (test-only; undefined in production). Awaited inside
   * watch() AFTER LISTEN is registered but BEFORE the replay SELECT, so a test
   * can deterministically commit a write into the (now-closed) LISTEN→replay
   * window and prove it surfaces EXACTLY once (gap-free replay + overlap dedup).
   * Cleared after firing once so it cannot perturb later watches.
   */
  public _watchTestHookAfterListen?: () => Promise<void>;

  /**
   * Returns AsyncIterable<ChangeEvent>. Implements list-then-watch backfill
   * per OQ5 disposition: caller does substrate.list() → captures snapshotRevision
   * → substrate.watch({ sinceRevision }). Substrate replays events strictly
   * newer than that revision; no missed-events window.
   *
   * bug-187 — subscribe-before-replay. The dedicated LISTEN client is connected
   * and LISTENing (buffering notifications) BEFORE the replay SELECT runs. The
   * OLD order (replay SELECT, THEN LISTEN) had a race: a write committing in the
   * SELECT→LISTEN window fired NOTIFY with no listener AND was absent from the
   * replay (it committed after the SELECT snapshot) → silently missed. Now the
   * overlap (a write visible to BOTH the buffered NOTIFY stream and the replay
   * SELECT) is de-duplicated by resource_version so it surfaces exactly once.
   * Mirrors MemoryHubStorageSubstrate's subscribe-before-replay, plus dedup.
   *
   * Uses a dedicated pg.Client for LISTEN (postgres protocol requires LISTEN
   * on its own connection; not shared via pool).
   */
  async *watch<T = unknown>(kind: string, opts: WatchOptions = {}): AsyncIterable<ChangeEvent<T>> {
    const { filter, sinceRevision, signal } = opts;

    // bug-187 Step 0: connect the dedicated LISTEN client FIRST (before replay).
    const client = new Client({ connectionString: (this.pool as unknown as { options: { connectionString: string } }).options.connectionString });
    // bug-110 — the dedicated LISTEN connection needs its own 'error' handler;
    // a backend error mid-watch would otherwise crash the process uncaught.
    attachPgErrorHandler(client, "watch LISTEN client");
    await client.connect();

    // AbortSignal hookup — when aborted, end the LISTEN client to break the ready() wait
    const abortHandler = () => {
      void client.end().catch(() => { /* swallow on already-ended */ });
    };
    if (signal) {
      if (signal.aborted) {
        await client.end();
        return;
      }
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    try {
      // pg Client emits 'notification' events; we buffer them. The handler is
      // attached BEFORE the LISTEN command so a NOTIFY arriving the instant LISTEN
      // takes effect cannot slip past an unattached handler.
      const notifications: pg.Notification[] = [];
      let resolve: (() => void) | null = null;
      const ready = () => new Promise<void>((r) => { resolve = r; });
      const wake = () => {
        if (resolve) {
          const r = resolve;
          resolve = null;
          r();
        }
      };
      // bug-100 work-41 (#4b real-pg): a LISTEN backend the SERVER terminates
      // (e.g. 57P01 admin-shutdown) must SETTLE this iterator so the consumer's
      // for-await ENDS → runtimeWatchSession returns "reconnect" → runtimeLoop
      // reconnects. The mock modeled generator-throw-on-end; real pg does NOT (the
      // SDK just fires 'end'/'error'). So mark `ended` on either + wake the parked
      // ready(); the live loop drains any buffered events then returns. Without
      // this the loop re-parks on ready() FOREVER (no more events) → the watch
      // never terminates → no reconnect (steve's audit-4533 finding 2).
      let ended = false;
      client.on("notification", (n) => { notifications.push(n); wake(); });
      // 'end'/'error' settle the iterator (non-abort termination → reconnect).
      // (attachPgErrorHandler also listens on 'error' to prevent an uncaught
      // crash; this second listener is additive — it just records + wakes.)
      client.on("end", () => { ended = true; wake(); });
      client.on("error", () => { ended = true; wake(); });

      await client.query(`LISTEN entities_change`);

      // bug-187 TEST SEAM — fires once, here in the (now-closed) LISTEN→replay
      // window so a test can commit a racing write and assert exactly-once
      // delivery. Undefined / no-op in production.
      if (this._watchTestHookAfterListen) {
        const hook = this._watchTestHookAfterListen;
        this._watchTestHookAfterListen = undefined;
        await hook();
      }

      // bug-187/work-41 Step 1 (AFTER LISTEN): replay events strictly newer than
      // sinceRevision via SELECT, tracking a MONOTONIC `cursor` = the max rv
      // yielded. The live drain then skips any event with rv <= cursor.
      //
      // The earlier exact-rv-Set dedup was WRONG (steve's audit-4533 finding 1):
      // when the SAME row is written twice in the LISTEN→replay overlap (rv 2 then
      // rv 4), the replay SELECT yields only the LATEST row state (rv4), but BOTH
      // NOTIFYs are buffered live — the set skipped only the exact rv4, so the
      // STALE rv2 leaked through AFTER rv4 → out-of-order delivery + the consumer
      // cursor REGRESSED 4→2 (his [4,2] probe). The monotonic cursor skips rv2
      // (≤4): in-order, no-regression, exactly-once. (Trade-off: an interleaved
      // delete whose rv ≤ a replayed put's rv is skipped — but the replay snapshot
      // already reflects that row's absence, delivering it would itself be
      // out-of-order, and the SchemaReconciler delete path is best-effort by
      // design. Acyclic correctness > a best-effort delete event.)
      let cursor = sinceRevision ? BigInt(sinceRevision) : 0n;
      if (sinceRevision) {
        const r = await this.pool.query<{ kind: string; id: string; data: T; resource_version: string }>(
          `SELECT kind, id, data, resource_version FROM entities
           WHERE kind = $1 AND resource_version > $2
           ORDER BY resource_version ASC`,
          [kind, sinceRevision],
        );
        for (const row of r.rows) {
          if (signal?.aborted) return;
          const rv = BigInt(row.resource_version);
          if (rv > cursor) cursor = rv;
          if (filter && !matchesFilter(row.data as Record<string, unknown>, filter, (k) => this.translateKey(kind, k))) continue;
          yield {
            op: "put",
            kind: row.kind,
            id: row.id,
            entity: row.data,
            resourceVersion: String(row.resource_version),
          };
        }
      }

      // bug-187/work-41 Step 2: live loop. Yield buffered notifications, skipping
      // any with rv <= the monotonic cursor (overlap dedup + no-regression).
      while (true) {
        if (signal?.aborted) return;

        while (notifications.length > 0) {
          if (signal?.aborted) return;
          const n = notifications.shift()!;
          if (!n.payload) continue;
          let payload: { op: "put" | "delete"; kind: string; id: string; resource_version: string };
          try {
            payload = JSON.parse(n.payload);
          } catch {
            continue;
          }
          if (payload.kind !== kind) continue;
          // work-41 monotonic dedup: already-surfaced or stale (rv ≤ cursor) → skip;
          // the cursor only advances, so a stale buffered NOTIFY can't regress it.
          const rv = BigInt(payload.resource_version);
          if (rv <= cursor) continue;
          cursor = rv;

          let entity: T | undefined;
          if (payload.op === "put") {
            const r = await this.pool.query<{ data: T }>(
              `SELECT data FROM entities WHERE kind = $1 AND id = $2`,
              [payload.kind, payload.id],
            );
            // entity MAY be undefined if post-NOTIFY fetch races concurrent delete
            // (per Design v1.2 §2.1 ChangeEvent race semantics — consumer-side stale-event)
            entity = r.rows[0]?.data;
            if (filter && entity && !matchesFilter(entity as Record<string, unknown>, filter, (k) => this.translateKey(kind, k))) continue;
          }

          yield {
            op: payload.op,
            kind: payload.kind,
            id: payload.id,
            entity,
            resourceVersion: String(payload.resource_version),
          };
        }
        if (signal?.aborted) return;
        // bug-100 work-41 (#4b): the LISTEN backend ended/errored (non-abort) —
        // all buffered events are now drained, so terminate the generator. The
        // consumer's for-await ends → runtimeWatchSession returns "reconnect" →
        // runtimeLoop reconnects with backoff. (Abort is handled by the guards
        // above; this is the SERVER-side termination path.)
        if (ended) return;
        await ready();
      }
    } finally {
      signal?.removeEventListener("abort", abortHandler);
      // Idempotent close — already-ended client throws; swallow
      await client.end().catch(() => { /* already ended */ });
    }
  }

  // ── Data-portability (per Design §2.5; stubbed at W1) ─────────────────────

  async snapshot(_targetPath: string): Promise<SnapshotRef> {
    throw new Error("W1 substrate-shell — snapshot/restore lands at W5+ canonical hub-snapshot.sh wrapper");
  }

  async restore(_source: SnapshotRef): Promise<void> {
    throw new Error("W1 substrate-shell — snapshot/restore lands at W5+ canonical hub-snapshot.sh wrapper");
  }

  // ── Advisory-lock primitive (mission-89 Phase 1; bug-127/bug-97 sibling) ──
  //
  // 2-arg form `pg_try_advisory_lock(int4, int4)` for namespace-split keyspace
  // per Design §2 Q1 v1.0. The HOLDER pins one pool-connection across acquire
  // + fn + release because pg_advisory_lock is SESSION-scoped — acquire on
  // conn-A, release on conn-B (different pool connections) breaks the
  // protocol. POLL-waiters release their connection between failed polls so a
  // K-concurrent-caller storm doesn't deadlock on a pool-size-K limit.
  //
  // Session auto-release on connection drop eliminates orphan-lock risk;
  // try/finally guarantees release on fn-throw.

  async withAdvisoryLock<T>(
    lockClass: number,
    lockKey: number,
    fn: () => Promise<T>,
    opts?: { timeoutMs?: number; latencyWarnMs?: number },
  ): Promise<T> {
    const startedAt = Date.now();
    const timeoutMs = opts?.timeoutMs;
    const latencyWarnMs = opts?.latencyWarnMs ?? 100;
    const inheritedSession = this.lockClientContext.getStore();
    const inheritedClient = inheritedSession?.client;

    // Nested locks MUST live on the inherited lock-owning session. This is
    // load-bearing for the WorkGraph global lock + per-agent WIP lock nesting:
    // every CRUD/CAS inside fn is routed by query() to this same session.
    let holderClient: pg.PoolClient | undefined;
    const ownsConnection = !inheritedClient;
    while (true) {
      const client = inheritedClient ?? await this.pool.connect();
      try {
        const r = await client.query<{ acquired: boolean }>(
          `SELECT pg_try_advisory_lock($1, $2) AS acquired`,
          [lockClass, lockKey],
        );
        if (r.rows[0]?.acquired === true) {
          holderClient = client;
          break;
        }
      } catch (e) {
        if (!inheritedClient) client.release();
        throw e;
      }
      if (!inheritedClient) client.release();
      const elapsed = Date.now() - startedAt;
      if (timeoutMs !== undefined && elapsed >= timeoutMs) {
        const { LockAcquisitionTimeoutError } = await import("./advisory-lock.js");
        throw new LockAcquisitionTimeoutError(lockClass, String(lockKey), elapsed);
      }
      await new Promise<void>((r) => setTimeout(r, 10));
    }

    const acquireLatencyMs = Date.now() - startedAt;
    if (acquireLatencyMs > latencyWarnMs && latencyWarnMs !== Infinity) {
      console.warn(
        `[advisory-lock] acquire latency ${acquireLatencyMs}ms exceeded ${latencyWarnMs}ms ` +
          `(class=${lockClass}, key=${lockKey})`,
      );
    }

    const session: LockedPgSession = inheritedSession ?? { client: holderClient, tail: Promise.resolve() };
    try {
      return await this.lockClientContext.run(session, fn);
    } finally {
      try {
        await holderClient.query(`SELECT pg_advisory_unlock($1, $2)`, [lockClass, lockKey]);
      } catch (e) {
        console.warn(`[advisory-lock] release error (class=${lockClass}, key=${lockKey}):`, e);
      }
      if (ownsConnection) holderClient.release();
    }
  }

  /** Close the connection-pool. Called at Hub-shutdown. */
  async close(): Promise<void> {
    await this.pool.end();
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract entity ID from a typed entity. Convention per repository pattern:
 * entity.id is the natural primary key. Special-case `Counter` kind (single-row
 * meta entity per entity-kinds.json v1.1) uses fixed id "counter".
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
 * Translate a single Filter clause to postgres SQL.
 *
 * Per Design v1.1 §2.1 FilterValue discriminated union:
 * - Scalar values → `data->>'field' = $value` (or = ANY for array fields)
 * - `$in` → `data->>'field' = ANY($values)`
 * - `$gt/$lt/$gte/$lte` → range operators (numeric + date only)
 *
 * Caller threads params through `params` accumulator + next-index pointer.
 */
function translateFilterClause(
  field: string,
  value: FilterValue,
  paramIndex: number,
  params: unknown[],
): { sql: string; nextParamIndex: number } {
  const fieldSql = jsonbField(field);

  // Scalar match (string | number | boolean)
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    params.push(String(value));
    return { sql: `${fieldSql} = $${paramIndex}`, nextParamIndex: paramIndex + 1 };
  }

  // Operator object: $in OR range operators ($gt/$lt/$gte/$lte)
  if (typeof value === "object" && value !== null) {
    const v = value as Record<string, unknown>;

    if ("$in" in v && Array.isArray(v.$in)) {
      params.push(v.$in.map(String));
      return { sql: `${fieldSql} = ANY($${paramIndex})`, nextParamIndex: paramIndex + 1 };
    }

    // $contains (C1-R2): JSONB array-membership — the stored ARRAY at `field`
    // CONTAINS the scalar (the inverse of $in). JSON-extract (`#>`, not text `#>>`)
    // + the `@>` containment operator; the param is the JSON-encoded scalar.
    // GIN-indexable (jsonb_path_ops) — see schema-reconciler buildCreateIndexSQL.
    if (
      "$contains" in v &&
      (typeof v.$contains === "string" || typeof v.$contains === "number" || typeof v.$contains === "boolean")
    ) {
      params.push(JSON.stringify(v.$contains));
      return { sql: `${jsonbFieldJson(field)} @> $${paramIndex}::jsonb`, nextParamIndex: paramIndex + 1 };
    }

    // $prefix (bug-487): STRING-PREFIX match, emitted as starts_with(), NOT as a range.
    // 🔴 WHY NOT A RANGE: measured on two ephemeral postgres instances differing only in
    // initdb --locale, `>= 'docs/audits/' AND < 'docs/audits0'` returned the correct 2
    // rows under lc_collate=C and ZERO ROWS under en_US.UTF-8 — a FALSE ZERO on data that
    // exists, which is bug-487's own defect class.
    // 🔴 WHY starts_with AND NOT `LIKE $n || '%'`: a prefix containing LIKE metacharacters
    // OVER-MATCHES. Measured on prefix 'docs/100%_report/' (truth: 2 rows), naive LIKE
    // returned 3. starts_with() has no wildcard semantics and needs no escaping.
    // Index use is IDENTICAL to LIKE (Index Only Scan on the byte-wise ~>=~/~<~ pattern
    // operators) when a text_pattern_ops index exists; without one the predicate is still
    // CORRECT and degrades to a filtered scan.
    if ("$prefix" in v && typeof v.$prefix === "string") {
      params.push(v.$prefix);
      // 🔴 THE CANONICAL-COLUMN SHORTCUT IS SCOPED TO $prefix ALONE, DELIBERATELY.
      // A blanket `field === "id" ? "id" : jsonbField(field)` in this function — which
      // is what the sort path does — CHANGES SEMANTICS FOR EVERY EXISTING id FILTER on
      // every kind. Measured: it breaks substrate-translate-w2's W2.4, which pins that
      // an unmoved top-level key passes through the bare data->>'id' path for Message.
      // $prefix is a NEW operator with no existing contract and is the only case that
      // needs the canonical column (a text_pattern_ops index cannot serve a JSONB
      // extract). So the shortcut lives HERE, not at the top of the function.
      const prefixTarget = field === "id" ? "id" : fieldSql;
      return { sql: `starts_with(${prefixTarget}, $${paramIndex})`, nextParamIndex: paramIndex + 1 };
    }

    // Range operators — all may co-exist on same field (e.g. {$gt: 5, $lt: 10})
    const parts: string[] = [];
    let p = paramIndex;
    if ("$gt" in v && v.$gt !== undefined) { params.push(v.$gt); parts.push(`${fieldSql} > $${p}`); p++; }
    if ("$lt" in v && v.$lt !== undefined) { params.push(v.$lt); parts.push(`${fieldSql} < $${p}`); p++; }
    if ("$gte" in v && v.$gte !== undefined) { params.push(v.$gte); parts.push(`${fieldSql} >= $${p}`); p++; }
    if ("$lte" in v && v.$lte !== undefined) { params.push(v.$lte); parts.push(`${fieldSql} <= $${p}`); p++; }

    if (parts.length === 0) {
      throw new Error(`unsupported filter operator on field '${field}': ${JSON.stringify(v)}`);
    }
    return { sql: `(${parts.join(" AND ")})`, nextParamIndex: p };
  }

  throw new Error(`unsupported filter value on field '${field}': ${JSON.stringify(value)}`);
}

/**
 * Translate a dotted-path field name to JSONB extract expression.
 * Examples:
 *   "status"          → "data->>'status'"
 *   "metadata.env"    → "data#>>'{metadata,env}'"
 */
function jsonbField(dottedPath: string): string {
  const parts = dottedPath.split(".");
  if (parts.length === 1) {
    return `data->>'${parts[0]}'`;
  }
  return `data#>>'{${parts.join(",")}}'`;
}

/**
 * JSON-extract variant of jsonbField — returns jsonb (`->`/`#>`), NOT text
 * (`->>`/`#>>`). Used by the `$contains` (`@>`) array-membership operator (C1-R2),
 * where the LHS must be jsonb for the containment comparison.
 *   "roleEligibility"      → "data->'roleEligibility'"
 *   "spec.roleEligibility" → "data#>'{spec,roleEligibility}'"
 */
function jsonbFieldJson(dottedPath: string): string {
  const parts = dottedPath.split(".");
  if (parts.length === 1) {
    return `data->'${parts[0]}'`;
  }
  return `data#>'{${parts.join(",")}}'`;
}

/**
 * Client-side filter match for watch-replay (when notification arrives + caller
 * provided a filter). Postgres-side filtering at notify-time would require
 * per-subscription filter SQL; client-side match is simpler + bounded since
 * replay is limited to events newer than sinceRevision.
 *
 * mission-90 W4 (N1): envelope-aware + DUAL-SHAPE tolerant. The watch path runs
 * continuously over MIXED rows during the migration straddle (envelope + bare
 * stragglers until W6), so each renamed/relocated key is read from its envelope
 * JSONB path (via the renameMap translator — the W2 complete authority) AND falls
 * back to the bare top-level path. Closes the bug-138 silent-miss on watch streams
 * without breaking bare rows. No translator / no-rename key → bare read only.
 */
function traversePath(entity: Record<string, unknown>, dottedPath: string): unknown {
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

function matchesFilter(entity: Record<string, unknown>, filter: Filter, translateKey?: (bareKey: string) => string): boolean {
  for (const [rawField, value] of Object.entries(filter)) {
    // mission-90 W8: envelope-only — read the translated envelope JSONB path; the
    // dual-shape bare-straggler fallback is retired (W6 proved 0 bare rows).
    const envField = translateKey ? translateKey(rawField) : rawField;
    const v = traversePath(entity, envField);

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      if (String(v) !== String(value)) return false;
      continue;
    }
    if (typeof value === "object" && value !== null) {
      const op = value as Record<string, unknown>;
      // C1-R2 (audit-4054): FAIL-LOUD — an operator validated upstream but not
      // implemented here is a silent-no-op (returns the row anyway), the exact
      // watch/list parity hole. Throw on any unknown operator (kills the CLASS,
      // tele-4), so a new FilterValue operator can never silently pass the watch.
      assertKnownFilterOps(op, rawField);
      // FAIL-CLOSED backstop (audit-4070): a predicate with NO implemented operator
      // (forbidden-only / empty) is UNEVALUABLE → match NOTHING, never fall through
      // to the `return true` tail (the fail-OPEN hole). Parity with policy matchField.
      if (!hasImplementedFilterOp(op)) return false;
      if ("$in" in op && Array.isArray(op.$in) && !op.$in.map(String).includes(String(v))) return false;
      // C1-R2: $contains = TYPED array-membership (SameValueZero; [3] does NOT
      // match "3") — parity with the typed JSONB `@>` in translateFilterClause.
      if ("$contains" in op && op.$contains !== undefined) {
        if (!Array.isArray(v) || !v.includes(op.$contains)) return false;
      }
      if ("$gt" in op && op.$gt !== undefined && !(numericCmp(v) > numericCmp(op.$gt))) return false;
      if ("$lt" in op && op.$lt !== undefined && !(numericCmp(v) < numericCmp(op.$lt))) return false;
      if ("$gte" in op && op.$gte !== undefined && !(numericCmp(v) >= numericCmp(op.$gte))) return false;
      if ("$lte" in op && op.$lte !== undefined && !(numericCmp(v) <= numericCmp(op.$lte))) return false;
    }
  }
  return true;
}

function numericCmp(x: unknown): number {
  if (typeof x === "number") return x;
  if (typeof x === "string") {
    // ISO-date comparison: convert to ms-epoch for numeric range
    const ms = Date.parse(x);
    if (Number.isFinite(ms)) return ms;
    const n = Number(x);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

/**
 * bug-487 TEST SEAM. `translateFilterClause` is module-private and the
 * collation-independence invariant lives in the SQL it emits, so the shape must be
 * assertable without a database. Exported for tests ONLY — no production caller.
 * The invariant guarded: $prefix emits starts_with(), never a range (a range is
 * collation-dependent and was MEASURED returning a false zero under en_US.UTF-8).
 */
export const translateFilterClauseForTest = translateFilterClause;
