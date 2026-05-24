/**
 * mission-88 W1 cluster-1 — Idea KindMigrationModule.
 *
 * Per cluster-1 Design v0.3 §3.1 (post thread-643 ratification). Substrate-truth
 * partition rules (Q2 drift-table resolution):
 *   - tags[] → metadata.labels{} (K8s-convention array → map transformation;
 *     each tag becomes key with empty-string value; preserves set semantics)
 *   - sourceThreadSummary → metadata.annotations["ois.io/sourceThreadSummary"]
 *     (K8s-convention vendor-namespaced annotation)
 *   - status (FSM) → status.phase (K8s-convention nested FSM)
 *   - missionId → status.missionId (observed; populated when incorporated)
 *   - Drops: revisionCount (doesn't exist in substrate — Design v0.2 was speculative)
 *
 * Idempotency: isEnvelopeShape probe at entry; module returns envelope-shape
 * unchanged on re-encode.
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "Idea";

export function createIdeaMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {
      status: "status.phase",
      missionId: "status.missionId",
    },
    partition: {
      metadata: [
        "createdAt",
        "createdBy",
        "sourceThreadId",
        "sourceActionId",
        "labels",
        "annotations",
        "updatedAt",
      ],
      spec: ["text"],
      status: [],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[Idea.migrateOne] input must be object, got ${typeof legacy}`);
      }
      const transformed = preTransform(legacy as Record<string, unknown>);
      return encodeEnvelope(transformed, schemaRef);
    },
  };
}

/**
 * Pre-transform legacy Idea: tags array → labels map; sourceThreadSummary →
 * annotations. Returns a NEW object with transformed shape ready for
 * encodeEnvelope.
 */
function preTransform(legacy: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...legacy };

  // tags[] → labels{}
  if (Array.isArray(out.tags)) {
    const labels: Record<string, string> = {};
    for (const tag of out.tags) {
      if (typeof tag === "string") labels[tag] = "";
    }
    out.labels = labels;
  }
  delete out.tags;

  // sourceThreadSummary → annotations["ois.io/sourceThreadSummary"]
  if (typeof out.sourceThreadSummary === "string" && out.sourceThreadSummary.length > 0) {
    out.annotations = { "ois.io/sourceThreadSummary": out.sourceThreadSummary };
  }
  delete out.sourceThreadSummary;

  return out;
}
