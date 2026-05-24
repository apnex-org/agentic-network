/**
 * mission-88 W4 cluster-4 — RepoEventBridgeCursor KindMigrationModule.
 *
 * Per cluster-4 Design v0.3 §2.3 (substrate-currency-ratified at thread-646 R2;
 * ZERO drift). Substrate-truth partition rules:
 *   - Per-repo plural meta-entity (id=`<owner>__<repo>` natural-key)
 *   - body → status.cursor (renameMap; opaque cursor-store-encoded-JSON preserved)
 *   - spec: {} (uniformity; no declared-intent fields)
 *   - status.phase: "active" constant (uniformity; bookkeeping kind; no FSM;
 *     sibling cluster-3 Counter/Tele "active" patterns)
 *   - watchable: false preserved (substrate-level config)
 *   - name OMITTED (per-repo plural bookkeeping; not handle-classified per §1.5
 *     binary axis disposition)
 *
 * Atomic-ship coordination: RepoEventBridgeSubstrateAdapter REWRITTEN in this
 * same PR per A1 architect-ratified disposition. Adapter post-rewrite reads
 * tolerant-dual-shape (envelope OR legacy-flat) + writes envelope-shape always.
 *
 * Idempotency: isEnvelopeShape probe at entry.
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "RepoEventBridgeCursor";

export function createRepoEventBridgeCursorMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {
      body: "status.cursor",
    },
    partition: {
      metadata: [],
      spec: [],
      status: [],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[RepoEventBridgeCursor.migrateOne] input must be object, got ${typeof legacy}`);
      }
      const transformed = preTransform(legacy as Record<string, unknown>);
      return encodeEnvelope(transformed, schemaRef);
    },
  };
}

function preTransform(legacy: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...legacy };
  // status.phase: "active" constant via dotted-path injection
  out["status.phase"] = "active";
  return out;
}
