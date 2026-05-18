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

const { Pool, Client } = pg;

/**
 * Factory — returns a HubStorageSubstrate backed by a postgres connection-pool.
 */
export function createPostgresStorageSubstrate(connectionString: string): HubStorageSubstrate {
  return new PostgresStorageSubstrate(connectionString);
}

class PostgresStorageSubstrate implements HubStorageSubstrate {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
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
    const r = await this.pool.query<{ data: T }>(
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
    const r = await this.pool.query<{ data: T; resource_version: string }>(
      `SELECT data, resource_version FROM entities WHERE kind = $1 AND id = $2`,
      [kind, id],
    );
    const row = r.rows[0];
    if (!row) return null;
    return { entity: row.data, resourceVersion: String(row.resource_version) };
  }

  async put<T>(kind: string, entity: T): Promise<{ id: string; resourceVersion: string }> {
    const id = extractId(entity, kind);
    const r = await this.pool.query<{ resource_version: string }>(
      `INSERT INTO entities (kind, id, data, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (kind, id) DO UPDATE
         SET data = EXCLUDED.data,
             updated_at = NOW(),
             resource_version = nextval('entities_rv_seq')
       RETURNING resource_version`,
      [kind, id, entity as object],
    );
    return { id, resourceVersion: String(r.rows[0]!.resource_version) };
  }

  async delete(kind: string, id: string): Promise<void> {
    await this.pool.query(`DELETE FROM entities WHERE kind = $1 AND id = $2`, [kind, id]);
  }

  async list<T>(kind: string, opts: ListOptions = {}): Promise<{ items: T[]; snapshotRevision: string }> {
    const { filter, sort, limit, offset } = opts;
    const where: string[] = ["kind = $1"];
    const params: unknown[] = [kind];
    let p = 2;

    // Filter translation per FilterValue discriminated union (per Design v1.1 §2.1 N1)
    if (filter) {
      for (const [field, value] of Object.entries(filter)) {
        const clause = translateFilterClause(field, value, p, params);
        where.push(clause.sql);
        p = clause.nextParamIndex;
      }
    }

    // Sort translation: dotted-path field → JSONB extract
    let orderSql = "";
    if (sort && sort.length > 0) {
      const parts = sort.map(s => `${jsonbField(s.field)} ${s.order === "desc" ? "DESC" : "ASC"}`);
      orderSql = ` ORDER BY ${parts.join(", ")}`;
    }

    const limitClamped = Math.min(limit ?? 100, 500);
    const limitSql = ` LIMIT ${limitClamped}`;
    const offsetSql = offset !== undefined ? ` OFFSET ${Number(offset)}` : "";

    // CTE: capture snapshot resource_version then SELECT items
    // (Single round-trip; snapshotRevision = max(resource_version) over selected set
    //  OR substrate-wide-max for empty results — gives gap-free watch resume)
    const sql = `
      WITH snapshot AS (SELECT COALESCE(MAX(resource_version), 0) AS rv FROM entities),
           items AS (
             SELECT data, resource_version FROM entities
             WHERE ${where.join(" AND ")}
             ${orderSql} ${limitSql} ${offsetSql}
           )
      SELECT (SELECT rv FROM snapshot) AS snapshot_rv,
             (SELECT json_agg(items.data) FROM items) AS items_json`;
    const r = await this.pool.query<{ snapshot_rv: string; items_json: T[] | null }>(sql, params);
    const row = r.rows[0]!;
    return {
      items: row.items_json ?? [],
      snapshotRevision: String(row.snapshot_rv),
    };
  }

  // ── CAS primitives (per C1 fold-in; preserve v0 race-protection) ──────────

  async createOnly<T>(kind: string, entity: T): Promise<CreateOnlyResult> {
    const id = extractId(entity, kind);
    const r = await this.pool.query<{ resource_version: string }>(
      `INSERT INTO entities (kind, id, data, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (kind, id) DO NOTHING
       RETURNING resource_version`,
      [kind, id, entity as object],
    );
    if (r.rowCount === 0) {
      return { ok: false, conflict: "existing" };
    }
    return { ok: true, id, resourceVersion: String(r.rows[0]!.resource_version) };
  }

  async putIfMatch<T>(kind: string, entity: T, expectedRevision: string): Promise<PutIfMatchResult> {
    const id = extractId(entity, kind);
    const r = await this.pool.query<{ resource_version: string }>(
      `UPDATE entities
         SET data = $3,
             updated_at = NOW(),
             resource_version = nextval('entities_rv_seq')
       WHERE kind = $1 AND id = $2 AND resource_version = $4
       RETURNING resource_version`,
      [kind, id, entity as object, expectedRevision],
    );
    if (r.rowCount === 0) {
      // Either row doesn't exist OR revision mismatch — fetch current for caller
      const cur = await this.pool.query<{ resource_version: string }>(
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

  // ── Watch / change-notification (per Design §2.4 LISTEN/NOTIFY) ───────────

  /**
   * Returns AsyncIterable<ChangeEvent>. Implements list-then-watch backfill
   * per OQ5 disposition: caller does substrate.list() → captures snapshotRevision
   * → substrate.watch({ sinceRevision }). Substrate replays events strictly
   * newer than that revision; no missed-events window.
   *
   * Uses a dedicated pg.Client for LISTEN (postgres protocol requires LISTEN
   * on its own connection; not shared via pool).
   */
  async *watch<T = unknown>(kind: string, opts: WatchOptions = {}): AsyncIterable<ChangeEvent<T>> {
    const { filter, sinceRevision, signal } = opts;

    // Step 1: replay events from sinceRevision (if provided) via SELECT
    if (sinceRevision) {
      const r = await this.pool.query<{ kind: string; id: string; data: T; resource_version: string }>(
        `SELECT kind, id, data, resource_version FROM entities
         WHERE kind = $1 AND resource_version > $2
         ORDER BY resource_version ASC`,
        [kind, sinceRevision],
      );
      for (const row of r.rows) {
        if (signal?.aborted) return;
        if (filter && !matchesFilter(row.data as Record<string, unknown>, filter)) continue;
        yield {
          op: "put",
          kind: row.kind,
          id: row.id,
          entity: row.data,
          resourceVersion: String(row.resource_version),
        };
      }
    }

    // Step 2: LISTEN on entities_change channel; yield notifications matching kind+filter
    const client = new Client({ connectionString: (this.pool as unknown as { options: { connectionString: string } }).options.connectionString });
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
      await client.query(`LISTEN entities_change`);

      // pg Client emits 'notification' events; we adapt to async-iterable
      const notifications: pg.Notification[] = [];
      let resolve: (() => void) | null = null;
      const ready = () => new Promise<void>((r) => { resolve = r; });

      client.on("notification", (n) => {
        notifications.push(n);
        if (resolve) {
          const r = resolve;
          resolve = null;
          r();
        }
      });

      // 'end' event resolves the ready() wait so the abort path returns cleanly
      client.on("end", () => {
        if (resolve) {
          const r = resolve;
          resolve = null;
          r();
        }
      });

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

          let entity: T | undefined;
          if (payload.op === "put") {
            const r = await this.pool.query<{ data: T }>(
              `SELECT data FROM entities WHERE kind = $1 AND id = $2`,
              [payload.kind, payload.id],
            );
            // entity MAY be undefined if post-NOTIFY fetch races concurrent delete
            // (per Design v1.2 §2.1 ChangeEvent race semantics — consumer-side stale-event)
            entity = r.rows[0]?.data;
            if (filter && entity && !matchesFilter(entity as Record<string, unknown>, filter)) continue;
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
 * Client-side filter match for watch-replay (when notification arrives + caller
 * provided a filter). Postgres-side filtering at notify-time would require
 * per-subscription filter SQL; client-side match is simpler + bounded since
 * replay is limited to events newer than sinceRevision.
 */
function matchesFilter(entity: Record<string, unknown>, filter: Filter): boolean {
  for (const [field, value] of Object.entries(filter)) {
    const parts = field.split(".");
    let v: unknown = entity;
    for (const p of parts) {
      if (v && typeof v === "object" && p in (v as object)) {
        v = (v as Record<string, unknown>)[p];
      } else {
        v = undefined;
        break;
      }
    }

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      if (String(v) !== String(value)) return false;
      continue;
    }
    if (typeof value === "object" && value !== null) {
      const op = value as Record<string, unknown>;
      if ("$in" in op && Array.isArray(op.$in) && !op.$in.map(String).includes(String(v))) return false;
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
