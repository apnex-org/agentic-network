/**
 * StorageBackedCounter — monotonic ID generator layered over a
 * `StorageProvider`. Mission-47 W1 (repository-layer counter helper per
 * ADR-024 §2.5 "repository layer owns ID generation").
 *
 * Replaces the GCS-specific `getAndIncrementCounter` helper from
 * `gcs-state.ts` with a provider-agnostic CAS loop:
 *   get → parse → compute-next → putIfMatch → retry-on-conflict
 *
 * Blob layout: `meta/counter.json` — a single JSON object with per-
 * entity fields (taskCounter, teleCounter, ...). Matches the historical
 * GCS layout exactly so mission-47 can roll out wave-by-wave without
 * renumbering existing entities.
 *
 * Concurrency:
 *   - `cas:true + concurrent:true` providers (GCS) get distributed
 *     CAS via `putIfMatch` on the counter object's token. Separate
 *     writers from separate processes both retry correctly.
 *   - `cas:true + concurrent:false` providers (local-fs, memory) use
 *     the same CAS loop; within a single process the sequence is
 *     linearized by JS's single-threaded execution model.
 *   - In-process concurrent callers (two awaits against the same
 *     counter at the same time) serialize via a per-instance Mutex
 *     queue — matches the historical behavior of `counterLock` in
 *     `gcs-state.ts`.
 */

import type { StorageProvider } from "@ois/storage-provider";
import { hasGetWithToken, StoragePathNotFoundError } from "@ois/storage-provider";

/**
 * All-entity counter object layout. Matches the existing
 * `Counters` interface in `hub/src/gcs-state.ts` — counter file is a
 * single blob containing each entity's monotonic counter field.
 */
export interface Counters {
  taskCounter: number;
  proposalCounter: number;
  engineerCounter: number;
  threadCounter: number;
  /** Mission-56 W5: Notification entity removed. Field retained for
   *  backward-compat with existing meta/counter.json blobs (legacy
   *  values remain on disk; nothing increments this going forward). */
  notificationCounter: number;
  ideaCounter: number;
  missionCounter: number;
  turnCounter: number;
  teleCounter: number;
  bugCounter: number;
  pendingActionCounter: number;
  /** Mission-56 W5: DirectorNotification entity removed. Field retained
   *  for backward-compat with existing meta/counter.json blobs. */
  directorNotificationCounter: number;
  auditCounter: number;
}

export type CounterField = keyof Counters;

const COUNTER_PATH = "meta/counter.json";
const MAX_CAS_RETRIES = 50;

function zeroCounters(): Counters {
  return {
    taskCounter: 0,
    proposalCounter: 0,
    engineerCounter: 0,
    threadCounter: 0,
    notificationCounter: 0,
    ideaCounter: 0,
    missionCounter: 0,
    turnCounter: 0,
    teleCounter: 0,
    bugCounter: 0,
    pendingActionCounter: 0,
    directorNotificationCounter: 0,
    auditCounter: 0,
  };
}

function sanitize(raw: Partial<Counters> | null): Counters {
  const out = zeroCounters();
  if (!raw) return out;
  for (const key of Object.keys(out) as CounterField[]) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      out[key] = v;
    }
  }
  return out;
}

/**
 * Tiny in-process Mutex — serializes in-flight `next()` callers against
 * the same counter instance. Without this, two concurrent-in-process
 * `await repository.create()` calls would both read the same token
 * and one would retry; the mutex makes the happy path a single CAS
 * round-trip rather than two.
 */
class Mutex {
  private waiters: Array<() => void> = [];
  private held = false;

  async acquire(): Promise<void> {
    if (!this.held) {
      this.held = true;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.held = false;
  }
}

export class StorageBackedCounter {
  private readonly lock = new Mutex();

  constructor(private readonly provider: StorageProvider) {
    if (!hasGetWithToken(provider)) {
      throw new Error(
        "StorageBackedCounter requires a StorageProvider with atomic read-with-token support",
      );
    }
  }

  /**
   * Atomically increment the named counter field and return the new
   * value. Under concurrent-writer storage (GCS), multiple writers
   * retry safely via CAS. Initial-state bootstrap creates the counter
   * blob atomically via `createOnly` — no read-then-write race on
   * first call to any counter.
   */
  async next(field: CounterField): Promise<number> {
    await this.lock.acquire();
    try {
      for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
        // Cast OK per constructor guard — hasGetWithToken was verified
        // at construction time. Double-cast via `unknown` because the
        // StorageProvider interface doesn't statically guarantee the
        // augmentation; the guard is runtime-only.
        const read = await (this.provider as unknown as {
          getWithToken(path: string): Promise<{ data: Uint8Array; token: string } | null>;
        }).getWithToken(COUNTER_PATH);

        if (read === null) {
          // Counter blob doesn't exist yet — bootstrap atomically.
          const bootstrapped = zeroCounters();
          bootstrapped[field] = 1;
          const result = await this.provider.createOnly(
            COUNTER_PATH,
            encodeJson(bootstrapped),
          );
          if (result.ok) return 1;
          // Someone else bootstrapped concurrently — retry via the
          // get-path on the next iteration.
          continue;
        }

        let current: Counters;
        try {
          const raw = JSON.parse(new TextDecoder().decode(read.data)) as Partial<Counters>;
          current = sanitize(raw);
        } catch {
          // Corrupt counter blob — bail rather than silently zeroing.
          // An operator needs to inspect + fix meta/counter.json.
          throw new Error(
            `StorageBackedCounter: ${COUNTER_PATH} is not valid JSON; refusing to clobber`,
          );
        }

        const next: Counters = { ...current, [field]: current[field] + 1 };
        try {
          const result = await this.provider.putIfMatch(
            COUNTER_PATH,
            encodeJson(next),
            read.token,
          );
          if (result.ok) return next[field];
          // Token stale — loop retries with fresh read.
        } catch (err) {
          if (err instanceof StoragePathNotFoundError) {
            // Counter blob got deleted between our read and our write —
            // treat like null-read on the next iteration.
            continue;
          }
          throw err;
        }
      }
      throw new Error(
        `StorageBackedCounter: exhausted ${MAX_CAS_RETRIES} CAS retries on ${COUNTER_PATH} for field ${field}`,
      );
    } finally {
      this.lock.release();
    }
  }
}

function encodeJson(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj, null, 2));
}
