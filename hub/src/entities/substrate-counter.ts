/**
 * mission-83 W4 — SubstrateCounter (bug-97 W5.5 fix)
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
 * bug-97 W5.5 fix (post-cutover surface; 2026-05-17):
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
 */

import type { HubStorageSubstrate } from "../storage-substrate/index.js";

const COUNTER_KIND = "Counter";
const COUNTER_ID = "counter";
const MAX_CAS_RETRIES = 50;

export type CounterDomain = string;  // e.g., "bugCounter", "ideaCounter", "missionCounter"

export class SubstrateCounter {
  constructor(private readonly substrate: HubStorageSubstrate) {}

  /**
   * Allocate the next value for the given counter-domain. Returns the new value.
   *
   * Uses Design v1.4 getWithRevision + putIfMatch CAS retry loop. Race-free
   * under concurrent callers — postgres-level CAS via resource_version. On
   * revision-mismatch (concurrent winner advanced counter), re-read + retry
   * with fresh N. On first-write (counter row absent), use createOnly +
   * retry-on-conflict (concurrent first-create race).
   */
  async next(domain: CounterDomain): Promise<number> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<Record<string, number>>(COUNTER_KIND, COUNTER_ID);

      if (!existing) {
        // First-write: counter row absent → use createOnly (concurrent first-
        // create race protected by createOnly's conflict-on-existing semantics)
        const nextValue = 1;  // first allocation in domain
        const result = await this.substrate.createOnly(COUNTER_KIND, { id: COUNTER_ID, [domain]: nextValue });
        if (result.ok) return nextValue;
        // createOnly conflict — concurrent first-creator beat us; retry from re-read
        continue;
      }

      // Subsequent writes: row exists → use putIfMatch with current resource_version
      const currentMap = existing.entity ?? {};
      const currentValue = currentMap[domain] ?? 0;
      const nextValue = currentValue + 1;
      const updated = { ...currentMap, id: COUNTER_ID, [domain]: nextValue };
      const result = await this.substrate.putIfMatch(COUNTER_KIND, updated, existing.resourceVersion);
      if (result.ok) return nextValue;
      // revision-mismatch: concurrent writer advanced counter; retry from re-read
    }
    throw new Error(`[SubstrateCounter] next exhausted ${MAX_CAS_RETRIES} retries on domain=${domain}`);
  }
}
