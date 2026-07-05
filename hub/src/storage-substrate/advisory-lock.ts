/**
 * mission-89 Phase 1 — withAdvisoryLock substrate-primitive orchestrator.
 *
 * Per Design v1.0 §2 Q1 (idea-322 M-Substrate-OCC-Primitive). Free-function
 * facade over `HubStorageSubstrate.withAdvisoryLock` that:
 *
 *   - Provides typed `LockClass` namespace via `LOCK_CLASS` const-map
 *     (2-arg form `pg_try_advisory_lock(int4 class, int4 key)` — per-class
 *     namespace isolation; assertIdentity:fingerprint cannot collide with
 *     Counter:kind structurally per engineer Q2 sub-disposition)
 *   - Hashes caller-supplied string key → int32 via FNV-1a-32 (deterministic;
 *     intra-class collision rate ~3e-10 for sparse keyspaces per Q2 JSDoc)
 *   - Exposes `LockAcquisitionTimeoutError` for distinct caller recovery
 *     vs fn-throws-in-callback (engineer Q1 sub-disposition)
 *
 * Substrate-impl ownership (see HubStorageSubstrate.withAdvisoryLock JSDoc):
 *   - Postgres: pinned pool-connection across acquire+fn+release (session-
 *     scoped lock semantics require single-connection pinning)
 *   - Memory: in-process Map-based serialization for incidental-lock support
 *     in unit tests (NOT a substitute for testcontainer pg contention testing
 *     per Design §4.2 Observation 1)
 *
 * Replaces W10-ext per-callsite 8-attempt retry-budget pattern (bug-127) +
 * mission-83 W5.4 Counter retry-loop pattern (bug-97 sibling).
 */

import type { HubStorageSubstrate } from "./types.js";

/**
 * Reserved int4-class namespaces for the 2-arg `pg_try_advisory_lock` form.
 *
 * Each callsite category that uses the primitive gets a distinct class so
 * intra-class hash collisions cannot bleed across categories. Add new entries
 * here when introducing new primitive consumers; reserve up to int32 max.
 */
export const LOCK_CLASS = {
  assertIdentity: 1,
  Counter: 2,
  // C1-R2 (mission-94): per-agent WorkItem claim serialization — count(held leases)
  // + the ready→claimed CAS run INSIDE this lock (keyed on agentId) so the WIP cap
  // is a hard integrity invariant, not a TOCTOU soft-cap.
  workItemWip: 3,
  // mission-102 P3-B3 (PR #488 review finding 2): grant-use serialization — a
  // class-grant-backed resolve and a revoke/supersede of the SAME grant take this
  // lock (keyed on grantId), so "a revoked grant authorizes nothing new" is a hard
  // serialization invariant, not a TOCTOU claim.
  classGrant: 4,
  // Reserve future classes here (5, 6, ...; keep this list authoritative).
} as const;
export type LockClass = typeof LOCK_CLASS[keyof typeof LOCK_CLASS];

/**
 * Thrown by `withAdvisoryLock` when `opts.timeoutMs` is configured and the
 * lock cannot be acquired within the budget. Distinct from errors thrown by
 * the wrapped `fn` so callers can disambiguate (retry-vs-surface decisions).
 */
export class LockAcquisitionTimeoutError extends Error {
  constructor(
    public readonly lockClass: number,
    public readonly lockKey: string,
    public readonly elapsedMs: number,
  ) {
    super(
      `pg_advisory_lock acquisition timeout after ${elapsedMs}ms ` +
        `(class=${lockClass}, key=${lockKey})`,
    );
    this.name = "LockAcquisitionTimeoutError";
  }
}

/**
 * FNV-1a 32-bit string hash. Returns a SIGNED int32 (postgres int4 range) via
 * `| 0` reinterpretation. Deterministic; same input → same output across
 * runtime restarts. Birthday-collision for n keys in 2^32 space:
 *
 *   P(collision) ≈ 1 - exp(-n² / (2 * 2^32))
 *     n=1000  → 1.16e-4
 *     n=10000 → 1.16e-2
 *     n=100000 → ~0.69 (collision near-certain — but this is INTRA-CLASS and
 *                       still namespace-isolated from other LockClass values)
 *
 * Per Design v1.0 §2 Q1 namespace-split rationale: intra-class collisions
 * cause spurious serialization (caller A waits on caller B's lock for an
 * unrelated key) — performance hit, NOT correctness violation. Acceptable
 * trade-off for sparse keyspaces (assertIdentity: ~10s of fingerprints in
 * practice; Counter: ~20 kinds).
 */
export function hashToInt32(key: string): number {
  let h = 2166136261; // FNV-1a 32-bit offset basis
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619); // FNV-1a 32-bit prime
  }
  return h | 0; // reinterpret as signed int32 (pg int4 range)
}

export interface WithAdvisoryLockOptions {
  /**
   * Max wall-time (ms) waiting to acquire the lock. Throws
   * `LockAcquisitionTimeoutError` on timeout. Default: undefined (wait
   * indefinitely; matches retry-loop replacement semantics for bug-127).
   */
  timeoutMs?: number;
  /**
   * Acquire-latency threshold (ms) above which a `console.warn` is emitted.
   * Default: 100. Set `Infinity` to disable.
   *
   * Replaces W10-ext per-callsite retry-budget-counter observability that
   * was retired by the primitive (per engineer Q1 sub-disposition).
   */
  latencyWarnMs?: number;
}

/**
 * Run `fn` while holding a substrate-level advisory lock identified by
 * (lockClass, lockKey). Releases on `fn` completion OR throw.
 *
 * @example assertIdentity migration (Phase 2):
 *   return await withAdvisoryLock(substrate, LOCK_CLASS.assertIdentity, fingerprint, async () => {
 *     // single-attempt lookup + putIfMatch under exclusive access
 *   });
 *
 * @example Counter migration (Phase 3):
 *   return await withAdvisoryLock(substrate, LOCK_CLASS.Counter, kind, async () => {
 *     // counter-issue + createOnly under exclusive access
 *   });
 */
export async function withAdvisoryLock<T>(
  substrate: HubStorageSubstrate,
  lockClass: LockClass,
  lockKey: string,
  fn: () => Promise<T>,
  opts?: WithAdvisoryLockOptions,
): Promise<T> {
  const numericKey = hashToInt32(lockKey);
  return substrate.withAdvisoryLock(lockClass, numericKey, fn, opts);
}
