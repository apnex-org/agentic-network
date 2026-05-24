/**
 * mission-88 W2 cluster-2 — Task KindMigrationModule.
 *
 * Per cluster-2 Design v0.2 §2.1 (substrate-currency-ratified at thread-644 R2;
 * ZERO drift). Substrate-truth partition rules:
 *   - tags transformation: N/A (Task uses `labels: Record<string,string>` directly;
 *     no tags-array transform needed; already K8s map shape)
 *   - sourceThreadSummary → metadata.annotations["ois.io/sourceThreadSummary"]
 *   - status (9-state FSM) → status.phase (K8s nested FSM)
 *   - spec carries declared work intent (directive immutable post-submit) +
 *     declared-with-controlled-mutation fields (assignedAgentId per PodSpec.nodeName
 *     K8s precedent)
 *   - status carries observed FSM-mutated fields (report*, review*, clarification*)
 *
 * Content-classified per §1.5 (`spec.directive` is substantive content; `name`
 * OMITTED — defaults to `id`).
 *
 * Idempotency: isEnvelopeShape probe at entry.
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "Task";

export function createTaskMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {
      status: "status.phase",
    },
    partition: {
      metadata: [
        "createdAt",
        "updatedAt",
        "createdBy",
        "sourceThreadId",
        "sourceActionId",
        "correlationId",
        "idempotencyKey",
        "revisionCount",
        "turnId",
        "labels",
        "annotations",
      ],
      spec: ["directive", "title", "description", "dependsOn", "assignedAgentId"],
      status: [
        "report",
        "reportSummary",
        "reportRef",
        "verification",
        "reviewAssessment",
        "reviewRef",
        "clarificationQuestion",
        "clarificationAnswer",
      ],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[Task.migrateOne] input must be object, got ${typeof legacy}`);
      }
      const transformed = preTransform(legacy as Record<string, unknown>);
      return encodeEnvelope(transformed, schemaRef);
    },
  };
}

function preTransform(legacy: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...legacy };

  if (typeof out.sourceThreadSummary === "string" && out.sourceThreadSummary.length > 0) {
    out.annotations = { "ois.io/sourceThreadSummary": out.sourceThreadSummary };
  }
  delete out.sourceThreadSummary;

  return out;
}
