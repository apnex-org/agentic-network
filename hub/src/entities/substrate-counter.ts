/**
 * mission-83 W4 + mission-88 W3 — SubstrateCounter (bug-97 W5.5 fix + envelope shape)
 *
 * Substrate-API equivalent of StorageBackedCounter (counter.ts). Reads + writes
 * the single-row Counter entity (kind='Counter', id='counter') containing all
 * counter-domain values (taskCounter, proposalCounter, ideaCounter, missionCounter,
 * turnCounter, teleCounter, bugCounter, etc.) per W2.3 Counter SchemaDef.
 *
 * Per Design v1.3 §3.4.1: Counter is special — single-row meta entity; no
 * per-row index; watchable: false (bookkeeping-only writes). Used by 11
 * existing-substrate-version repositories for ID generation.
 *
 * **bug-97 W5.5 fix** (post-cutover surface; 2026-05-17):
 *   - Original W4 spike-quality used get+put pattern with race-window between
 *     read + write. Concurrent register_role flows hit this in first ~60s of
 *     substrate-mode production traffic: both callers read same N → both write
 *     same N (one CAS-clobbers via substrate.put unconditional overwrite) →
 *     both attempt createOnly("Audit", id="audit-N") → one succeeds, OTHER
 *     ENTITY IS DROPPED (createOnly conflict-on-existing).
 *   - Fix: proper CAS via Design v1.4 getWithRevision + putIfMatch; on
 *     revision-mismatch retry from re-read; on first-write (counter row
 *     absent) use createOnly + retry-on-conflict.
 *   - Race-free per substrate-boundary CAS contract.
 *
 * **mission-88 W3 envelope-shape ship** (atomic with Counter migration per A1):
 *   - Post-W3 Counter entity is envelope-shape: `{id, kind, apiVersion, metadata,
 *     spec, status: {counters: {<domain>: <value>}, phase: "active"}}` per
 *     cluster-3 Design v0.3 §2.4 Option (a) K8s ConfigMap precedent.
 *   - Read-tolerance: handles BOTH envelope-shape (post-migration) AND legacy
 *     flat-shape (pre-migration; SUBSTRATE_ENVELOPE_TOLERANT-mode dual-shape window).
 *     If envelope-shape present, reads `status.counters[domain]`; otherwise
 *     reads legacy flat `[domain]` at top-level.
 *   - Write: ALWAYS writes envelope-shape post-W3. Existing envelope-shape
 *     entity fields (metadata, spec, status.phase) preserved + status.counters
 *     mutated.
 *   - First-write path: createOnly emits envelope-shape `{id, kind, apiVersion,
 *     metadata: {}, spec: {}, status: {counters: {[domain]: 1}, phase: "active"}}`.
 *   - Race-free CAS preserved via substrate's getWithRevision + putIfMatch contract;
 *     envelope-shape change doesn't affect resource_version semantics.
 */

import type { HubStorageSubstrate } from "../storage-substrate/index.js";
import { LOCK_CLASS, withAdvisoryLock } from "../storage-substrate/advisory-lock.js";

const COUNTER_KIND = "Counter";
const COUNTER_ID = "counter";
// mission-89 Phase 3: lock-serialized same-domain callers means the W5.5 retry-
// loop now only handles CROSS-domain races on the shared Counter row. Budget
// retained at 50 — under the lock, intra-domain callers don't iterate; cross-
// domain races resolve in a few retries even at high concurrency.
const MAX_CAS_RETRIES = 50;
const COUNTER_API_VERSION = "core.ois/v1";

export type CounterDomain = string;  // e.g., "bugCounter", "ideaCounter", "missionCounter"

/**
 * Envelope-shape Counter entity (post-mission-88 W3 cluster-3 ship).
 *
 * Per cluster-3 Design v0.3 §2.4 Option (a) embedded-map-in-status (K8s
 * ConfigMap `.data: {key: value}` precedent).
 */
interface CounterEnvelope {
  id: string;
  name?: string;
  kind?: string;
  apiVersion?: string;
  metadata?: Record<string, unknown>;
  spec?: Record<string, unknown>;
  status?: {
    counters?: Record<string, number>;
    phase?: string;
  };
}

/**
 * Read the current value for a counter-domain. mission-90 W8: envelope-only —
 * Counter rows are `status.counters` maps (verified live: 0 legacy-flat; all
 * writes envelope). The legacy top-level-key branch is retired.
 */
function readDomainValue(entity: Record<string, unknown>, domain: string): number {
  const status = entity.status as { counters?: Record<string, number> } | undefined;
  return status?.counters?.[domain] ?? 0;
}

/**
 * Build the envelope-shape Counter to write back, preserving existing envelope
 * fields + mutating only `status.counters[domain]` to nextValue. mission-90 W8:
 * envelope-only — the legacy top-level numeric-sweep is retired.
 */
function buildEnvelopeWrite(
  existing: Record<string, unknown> | undefined,
  domain: string,
  nextValue: number,
): CounterEnvelope {
  const existingStatus = existing?.status as Record<string, unknown> | undefined;
  const counters: Record<string, number> = {
    ...((existingStatus?.counters ?? {}) as Record<string, number>),
  };
  counters[domain] = nextValue;

  return {
    ...((existing ?? {}) as Record<string, unknown>),
    id: COUNTER_ID,
    kind: COUNTER_KIND,
    apiVersion: COUNTER_API_VERSION,
    metadata: (existing as { metadata?: Record<string, unknown> } | undefined)?.metadata ?? {},
    spec: (existing as { spec?: Record<string, unknown> } | undefined)?.spec ?? {},
    status: { counters, phase: "active" },
  };
}

export class SubstrateCounter {
  constructor(private readonly substrate: HubStorageSubstrate) {}

  /**
   * Allocate the next value for the given counter-domain. Returns the new value.
   *
   * mission-89 Phase 3 (bug-97 retroactively-systemic close): wraps the
   * getWithRevision + putIfMatch CAS retry loop in `withAdvisoryLock(LOCK_CLASS.
   * Counter, domain, ...)`. Same-domain concurrent callers serialize through
   * the lock — eliminates the bug-97 surface (concurrent callers racing on
   * same-domain N). CROSS-domain concurrent callers still race on the shared
   * Counter row (single-row entity with all domains as keys); the retry-loop
   * handles those (rare; resolves in 1-2 iterations).
   *
   * Envelope-shape per mission-88 W3 atomic-ship (A1): reads tolerate both
   * envelope + legacy-flat shapes; writes always emit envelope-shape.
   */
  async next(domain: CounterDomain): Promise<number> {
    return await withAdvisoryLock(this.substrate, LOCK_CLASS.Counter, domain, async () => {
      for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
        const existing = await this.substrate.getWithRevision<Record<string, unknown>>(COUNTER_KIND, COUNTER_ID);

        if (!existing) {
          // First-write: counter row absent → use createOnly with envelope-shape entity
          const firstWrite = buildEnvelopeWrite(undefined, domain, 1);
          const result = await this.substrate.createOnly(COUNTER_KIND, firstWrite);
          if (result.ok) return 1;
          // createOnly conflict — concurrent first-creator (other domain) beat us; retry
          continue;
        }

        // Subsequent writes: row exists → use putIfMatch with current resource_version
        const currentValue = readDomainValue(existing.entity, domain);
        const nextValue = currentValue + 1;
        const updated = buildEnvelopeWrite(existing.entity, domain, nextValue);
        const result = await this.substrate.putIfMatch(COUNTER_KIND, updated, existing.resourceVersion);
        if (result.ok) return nextValue;
        // revision-mismatch: cross-domain concurrent writer advanced row; retry from re-read
      }
      throw new Error(`[SubstrateCounter] next exhausted ${MAX_CAS_RETRIES} retries on domain=${domain}`);
    });
  }
}
