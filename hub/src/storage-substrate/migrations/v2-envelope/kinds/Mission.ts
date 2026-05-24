/**
 * mission-88 W1 cluster-1 — Mission KindMigrationModule.
 *
 * Per cluster-1 Design v0.3 §3.4 (post thread-643 ratification). Substrate-truth
 * partition rules (Q2 drift-table resolution):
 *   - Drops (don't exist in substrate): goal, sourceIdeaId, sourceProposalId,
 *     sliceTracking, synthetic issuedTaskIds[]
 *   - tasks[] + ideas[] → DROPPED (virtual-hydrated at repository.hydrate();
 *     not persisted; envelope omits)
 *   - sourceThreadSummary → metadata.annotations["ois.io/sourceThreadSummary"]
 *   - status (FSM) → status.phase (proposed/active/completed/abandoned per
 *     substrate-truth; Design v0.2 "cancelled" was wrong)
 *   - missionClass → spec (declared at Mission creation per mission-57 W1)
 *   - pulses → status.pulses MONOLITHIC per architect-ratified disposition
 *     (substrate-extension-minimum-disruption preserves MissionPulses interface;
 *     deferred-split to spec.pulses + status.pulseTracking is OPEN-ENDED for
 *     idea-200/idea-129 follow-on substrate-refactor cycle — Design §3.4 note)
 *   - plannedTasks[].issuedTaskId is INTRINSIC per-slot tracking (no synthetic
 *     issuedTaskIds[] envelope field)
 *
 * Idempotency: isEnvelopeShape probe at entry.
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "Mission";

export function createMissionMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {
      status: "status.phase",
    },
    partition: {
      metadata: [
        "createdAt",
        "createdBy",
        "sourceThreadId",
        "sourceActionId",
        "correlationId",
        "annotations",
        "updatedAt",
      ],
      spec: ["title", "description", "documentRef", "missionClass", "plannedTasks"],
      status: ["turnId", "pulses"],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[Mission.migrateOne] input must be object, got ${typeof legacy}`);
      }
      const transformed = preTransform(legacy as Record<string, unknown>);
      return encodeEnvelope(transformed, schemaRef);
    },
  };
}

function preTransform(legacy: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...legacy };

  // Virtual-hydrated fields — envelope omits (repository.hydrate() recomputes at read-time)
  delete out.tasks;
  delete out.ideas;

  // sourceThreadSummary → annotations
  if (typeof out.sourceThreadSummary === "string" && out.sourceThreadSummary.length > 0) {
    out.annotations = { "ois.io/sourceThreadSummary": out.sourceThreadSummary };
  }
  delete out.sourceThreadSummary;

  return out;
}
