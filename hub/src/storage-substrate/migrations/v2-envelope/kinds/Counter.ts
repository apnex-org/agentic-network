/**
 * mission-88 W3 cluster-3 — Counter KindMigrationModule.
 *
 * Per cluster-3 Design v0.3 §2.4 (substrate-currency-ratified at thread-645 R2;
 * Option (a) embedded-map-in-status per K8s ConfigMap precedent). Substrate-truth
 * partition rules:
 *   - SINGLE-ROW meta-entity (id="counter" fixed)
 *   - Pre-transform STRUCTURAL TRANSFORMATION: sweep all `*Counter` top-level keys
 *     into `status.counters` embedded map; preserves bug-97 W5.5 race-free CAS pattern
 *     (envelope shape changes but resource_version-based CAS unchanged)
 *   - spec: {} (uniformity; Counter has no declared-intent fields)
 *   - status.phase: "active" constant (uniformity; Counter has no real FSM;
 *     matches Tele "active" + Audit "logged" + ArchitectDecision "logged" pattern)
 *   - watchable: false preserved (substrate-level config; not migrated)
 *   - name OMITTED (singleton-meta-entity; id="counter" IS the identifying handle)
 *
 * Atomic-ship coordination: SubstrateCounter primitive REWRITTEN in this same PR
 * per A1 architect-ratified disposition. Substrate-correctness: post-migration
 * SubstrateCounter MUST read/write `data->status->counters[domain]` (not flat
 * `data->>'<domain>'`) to prevent race-clobber. See substrate-counter.ts.
 *
 * Idempotency: isEnvelopeShape probe at entry.
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "Counter";

export function createCounterMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    partition: {
      metadata: [],
      spec: [],
      status: ["counters", "phase"],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[Counter.migrateOne] input must be object, got ${typeof legacy}`);
      }
      const transformed = preTransform(legacy as Record<string, unknown>);
      return encodeEnvelope(transformed, schemaRef);
    },
  };
}

/**
 * Pre-transform legacy Counter:
 *   - Sweep all top-level keys EXCEPT id into `status.counters` embedded map
 *     (taskCounter, ideaCounter, bugCounter, etc.)
 *   - Add status.phase: "active" constant (envelope uniformity)
 *
 * Per Design §2.4 Option (a) + K8s ConfigMap precedent.
 */
function preTransform(legacy: Record<string, unknown>): Record<string, unknown> {
  const RESERVED = new Set(["id", "name", "kind", "apiVersion", "metadata", "spec", "status"]);
  const counters: Record<string, number> = {};

  for (const [key, value] of Object.entries(legacy)) {
    if (RESERVED.has(key)) continue;
    if (typeof value === "number") counters[key] = value;
  }

  return {
    id: legacy.id ?? "counter",
    counters,
    phase: "active",
  };
}
