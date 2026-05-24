/**
 * mission-88 W2 cluster-2 — Turn KindMigrationModule.
 *
 * Per cluster-2 Design v0.2 §2.3 (substrate-currency-ratified at thread-644 R2;
 * ZERO drift). Substrate-truth partition rules:
 *   - status (3-state FSM) → status.phase (K8s nested FSM)
 *   - title → metadata.name (handle-classified per §1.5; **FIRST cluster-2 kind**
 *     to use metadata.name; signal for cluster-3 Agent + cluster-5 ArchitectDecision)
 *   - title ALSO populates envelope.name top-level (substrate-API ergonomic
 *     duplicate of K8s metadata.name canonical handle)
 *   - scope (free-text markdown) → spec.scope (substantive content; matches
 *     Mission.goal / Proposal.summary cluster-1 pattern)
 *   - tele[] → spec.tele (declared teleological references; idea-151 forward-only
 *     Relationship-kind extraction defers to follow-on)
 *   - missionIds[] + taskIds[] → DROPPED (virtual-hydrated per
 *     IMissionStore.list({turnId})/ITaskStore.list({turnId}); envelope omits per
 *     cluster-1 Mission.tasks/ideas precedent)
 *
 * Idempotency: isEnvelopeShape probe at entry.
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "Turn";

export function createTurnMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {
      status: "status.phase",
      title: "metadata.name",
    },
    partition: {
      metadata: ["createdAt", "updatedAt", "createdBy", "correlationId"],
      spec: ["scope", "tele"],
      status: [],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[Turn.migrateOne] input must be object, got ${typeof legacy}`);
      }
      const transformed = preTransform(legacy as Record<string, unknown>);
      return encodeEnvelope(transformed, schemaRef);
    },
  };
}

function preTransform(legacy: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...legacy };

  // missionIds + taskIds are virtual-hydrated at repository.hydrate() read-time;
  // envelope OMITS (cluster-1 Mission.tasks/ideas precedent)
  delete out.missionIds;
  delete out.taskIds;

  // title also populates envelope.name top-level for substrate-API ergonomic;
  // pre-transform copies legacy.title → legacy.name. renameMap then ALSO
  // assigns metadata.name = legacy.title (K8s-canonical handle per §1.5).
  if (typeof out.title === "string" && out.title.length > 0) {
    out.name = out.title;
  }

  return out;
}
