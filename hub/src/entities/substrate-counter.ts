/**
 * mission-83 W4 — SubstrateCounter
 *
 * Substrate-API equivalent of StorageBackedCounter (counter.ts). Reads + writes
 * the single-row Counter entity (kind='Counter', id='counter') containing all
 * counter-domain values (taskCounter, proposalCounter, ideaCounter, missionCounter,
 * turnCounter, teleCounter, bugCounter, etc.) per W2.3 Counter SchemaDef.
 *
 * Per Design v1.3 §3.4.1: Counter is special — single-row meta entity; no
 * per-row index; watchable: false (bookkeeping-only writes). Used by all 12
 * existing-substrate-version repositories for ID generation.
 *
 * mission-83 W4 — used by *-repository-substrate.ts siblings as ID-allocation
 * helper.
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
   * Uses get-then-put pattern. Spike-quality: race-window between get + put could
   * cause lost-update for concurrent allocations; bug-93 PR #203 30s throttle
   * bounds risk. W5+ may add substrate.putIfMatch CAS retry if higher-throughput
   * concurrent ID allocation becomes load-bearing.
   */
  async next(domain: CounterDomain): Promise<number> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      // Read current counter map
      const current = await this.substrate.get<Record<string, number>>(COUNTER_KIND, COUNTER_ID);
      const currentMap = current ?? {};
      const currentValue = currentMap[domain] ?? 0;
      const nextValue = currentValue + 1;
      const updated = { ...currentMap, [domain]: nextValue };

      // Write back. Spike-quality simple put; W5+ may use putIfMatch for CAS-safety
      try {
        await this.substrate.put(COUNTER_KIND, { id: COUNTER_ID, ...updated });
        return nextValue;
      } catch (err) {
        // Retry on conflict (extremely rare given Counter has watchable:false +
        // bookkeeping-only writes; safety net for unexpected concurrent paths)
        if (attempt === MAX_CAS_RETRIES - 1) throw err;
      }
    }
    throw new Error(`[SubstrateCounter] next exhausted ${MAX_CAS_RETRIES} retries on domain=${domain}`);
  }
}
