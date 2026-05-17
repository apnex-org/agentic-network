/**
 * PostgresStorageSubstrate — concrete implementation of HubStorageSubstrate.
 *
 * Per Design v1.1 §2.1 (interface) + §2.2 (storage layout) + §2.4 (LISTEN/NOTIFY).
 * mission-83 W1 substrate-shell — SKELETON only at this commit; CRUD + CAS + watch
 * implementation lands in subsequent W1 commits.
 *
 * Per Option Y (C2 fold-in): repositories internally compose this substrate
 * behind I*Store interfaces; handler call-sites unchanged.
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
} from "./types.js";

/**
 * Factory — returns a HubStorageSubstrate backed by a postgres connection.
 *
 * W1 substrate-shell module entry; CRUD + CAS + watch implementation lands
 * in subsequent W1 commits per per-wave handshake.
 *
 * @param connectionString postgres connection string (typically `HUB_PG_CONNECTION_STRING`)
 */
export function createPostgresStorageSubstrate(connectionString: string): HubStorageSubstrate {
  // W1 skeleton-stub — full pg-client wiring + per-method implementation lands at
  // W1.3 (CRUD + CAS + watch) commit. Returning a stub here lets downstream
  // module-graph + type-checking + module-export structure validate at W1.1.
  return new PostgresStorageSubstrate(connectionString);
}

/**
 * SKELETON IMPLEMENTATION — W1.3 fills in.
 *
 * All methods throw at W1.1 commit; CRUD + CAS + watch land per per-method
 * implementation in subsequent W1 commits.
 */
class PostgresStorageSubstrate implements HubStorageSubstrate {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(private readonly connectionString: string) {
    // W1.3: initialize pg.Client / pg.Pool from connectionString
  }

  // ── Schema management (W2 reconciler integration) ─────────────────────────

  async applySchema(_def: SchemaDef): Promise<void> {
    throw new Error("W1.3 not implemented — schema apply is W2 reconciler concern");
  }

  async listSchemas(): Promise<SchemaDef[]> {
    throw new Error("W1.3 not implemented — schema list is W2 reconciler concern");
  }

  async getSchema(_kind: string): Promise<SchemaDef | null> {
    throw new Error("W1.3 not implemented — schema get is W2 reconciler concern");
  }

  // ── Entity CRUD (W1.3 fills in) ───────────────────────────────────────────

  async get<T>(_kind: string, _id: string): Promise<T | null> {
    throw new Error("W1.3 not implemented — get(kind, id)");
  }

  async put<T>(_kind: string, _entity: T): Promise<{ id: string; resourceVersion: string }> {
    throw new Error("W1.3 not implemented — put(kind, entity)");
  }

  async delete(_kind: string, _id: string): Promise<void> {
    throw new Error("W1.3 not implemented — delete(kind, id)");
  }

  async list<T>(_kind: string, _opts?: ListOptions): Promise<{ items: T[]; snapshotRevision: string }> {
    throw new Error("W1.3 not implemented — list(kind, opts)");
  }

  // ── CAS primitives (W1.3 fills in; per C1 fold-in) ────────────────────────

  async createOnly<T>(_kind: string, _entity: T): Promise<CreateOnlyResult> {
    throw new Error("W1.3 not implemented — createOnly(kind, entity)");
  }

  async putIfMatch<T>(_kind: string, _entity: T, _expectedRevision: string): Promise<PutIfMatchResult> {
    throw new Error("W1.3 not implemented — putIfMatch(kind, entity, expectedRevision)");
  }

  // ── Watch / change-notification (W1.3 fills in; LISTEN/NOTIFY) ────────────

  async *watch<T = unknown>(_kind: string, _opts?: WatchOptions): AsyncIterable<ChangeEvent<T>> {
    throw new Error("W1.3 not implemented — watch(kind, opts)");
    // unreachable yield to satisfy AsyncIterable contract type
    yield undefined as never;
  }

  // ── Data-portability (W1.3 fills in; per §2.5) ────────────────────────────

  async snapshot(_targetPath: string): Promise<SnapshotRef> {
    throw new Error("W1.3 not implemented — snapshot(targetPath)");
  }

  async restore(_source: SnapshotRef): Promise<void> {
    throw new Error("W1.3 not implemented — restore(source)");
  }
}
