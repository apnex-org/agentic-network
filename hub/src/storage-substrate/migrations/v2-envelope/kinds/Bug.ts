/**
 * mission-88 W1 cluster-1 — Bug KindMigrationModule.
 *
 * Per cluster-1 Design v0.3 §3.2 (post thread-643 ratification). Substrate-truth
 * partition rules:
 *   - tags[] → metadata.labels{} (K8s array → map transformation)
 *   - sourceThreadSummary → metadata.annotations["ois.io/sourceThreadSummary"]
 *   - status (FSM) → status.phase (K8s-convention nested FSM)
 *   - spec: title, description, severity, class (declared content at filing)
 *   - status (observed mutates): fixCommits, fixRevision, linkedTaskIds, linkedMissionId
 *
 * Idempotency: isEnvelopeShape probe at entry.
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "Bug";

export function createBugMigrationModule(schema: SchemaDef): KindMigrationModule {
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
        "sourceIdeaId",
        "surfacedBy",
        "labels",
        "annotations",
        "updatedAt",
      ],
      spec: ["title", "description", "severity", "class"],
      status: ["fixCommits", "fixRevision", "linkedTaskIds", "linkedMissionId"],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[Bug.migrateOne] input must be object, got ${typeof legacy}`);
      }
      const transformed = preTransform(legacy as Record<string, unknown>);
      return encodeEnvelope(transformed, schemaRef);
    },
  };
}

function preTransform(legacy: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...legacy };

  if (Array.isArray(out.tags)) {
    const labels: Record<string, string> = {};
    for (const tag of out.tags) {
      if (typeof tag === "string") labels[tag] = "";
    }
    out.labels = labels;
  }
  delete out.tags;

  if (typeof out.sourceThreadSummary === "string" && out.sourceThreadSummary.length > 0) {
    out.annotations = { "ois.io/sourceThreadSummary": out.sourceThreadSummary };
  }
  delete out.sourceThreadSummary;

  return out;
}
