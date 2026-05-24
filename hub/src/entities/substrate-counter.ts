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

const COUNTER_KIND = "Counter";
const COUNTER_ID = "counter";
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
 * Probe whether the entity has envelope-shape (post-migration) vs legacy-flat
 * (pre-migration). Loose check — only requires `status.counters` map present.
 */
function isEnvelopeShape(entity: Record<string, unknown>): boolean {
  const status = entity.status as Record<string, unknown> | undefined;
  return typeof status === "object" && status !== null && typeof status.counters === "object";
}

/**
 * Read the current value for a counter-domain, tolerating both envelope-shape
 * (post-W3) and legacy-flat (pre-W3) entity shapes.
 */
function readDomainValue(entity: Record<string, unknown>, domain: string): number {
  if (isEnvelopeShape(entity)) {
    const counters = ((entity.status as Record<string, unknown>).counters
      ?? {}) as Record<string, number>;
    return counters[domain] ?? 0;
  }
  // Legacy-flat shape: domain values are top-level keys
  const value = entity[domain];
  return typeof value === "number" ? value : 0;
}

/**
 * Build the envelope-shape Counter to write back, preserving existing envelope
 * fields when present + mutating only `status.counters[domain]` to nextValue.
 */
function buildEnvelopeWrite(
  existing: Record<string, unknown> | undefined,
  domain: string,
  nextValue: number,
): CounterEnvelope {
  // Extract existing counters map (envelope or legacy)
  let counters: Record<string, number> = {};
  if (existing) {
    if (isEnvelopeShape(existing)) {
      const status = existing.status as Record<string, unknown>;
      counters = { ...((status.counters ?? {}) as Record<string, number>) };
    } else {
      // Legacy-flat: sweep all numeric top-level keys (except id)
      for (const [k, v] of Object.entries(existing)) {
        if (k === "id") continue;
        if (typeof v === "number") counters[k] = v;
      }
    }
  }
  counters[domain] = nextValue;

  // Preserve existing envelope fields if entity already envelope-shaped
  const existingEnvelope = existing && isEnvelopeShape(existing) ? existing : {};
  return {
    ...(existingEnvelope as Record<string, unknown>),
    id: COUNTER_ID,
    kind: COUNTER_KIND,
    apiVersion: COUNTER_API_VERSION,
    metadata: (existingEnvelope as { metadata?: Record<string, unknown> }).metadata ?? {},
    spec: (existingEnvelope as { spec?: Record<string, unknown> }).spec ?? {},
    status: { counters, phase: "active" },
  };
}

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
   *
   * Envelope-shape per mission-88 W3 atomic-ship (A1): reads tolerate both
   * envelope + legacy-flat shapes; writes always emit envelope-shape.
   */
  async next(domain: CounterDomain): Promise<number> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<Record<string, unknown>>(COUNTER_KIND, COUNTER_ID);

      if (!existing) {
        // First-write: counter row absent → use createOnly with envelope-shape entity
        const firstWrite = buildEnvelopeWrite(undefined, domain, 1);
        const result = await this.substrate.createOnly(COUNTER_KIND, firstWrite);
        if (result.ok) return 1;
        // createOnly conflict — concurrent first-creator beat us; retry from re-read
        continue;
      }

      // Subsequent writes: row exists → use putIfMatch with current resource_version
      const currentValue = readDomainValue(existing.entity, domain);
      const nextValue = currentValue + 1;
      const updated = buildEnvelopeWrite(existing.entity, domain, nextValue);
      const result = await this.substrate.putIfMatch(COUNTER_KIND, updated, existing.resourceVersion);
      if (result.ok) return nextValue;
      // revision-mismatch: concurrent writer advanced counter; retry from re-read
    }
    throw new Error(`[SubstrateCounter] next exhausted ${MAX_CAS_RETRIES} retries on domain=${domain}`);
  }
}
