/**
 * mission-88 W5 cluster-5 — ReviewHistoryEntry KindMigrationModule.
 *
 * Per cluster-5 Design v0.3 §2.4 (substrate-currency-ratified at thread-647 R2;
 * ZERO drift; production-substrate-verified — 50 rh-N entries; FK to Task).
 * Substrate-truth partition rules:
 *   - id (rh-N; counter-allocated) preserved
 *   - timestamp → metadata.createdAt (uniformity rename)
 *   - taskId → metadata.taskId (FK pointer identity-shape; sibling Task.metadata.turnId
 *     precedent; idea-151 Relationship-kind extraction candidate post-cutover)
 *   - assessment → spec (declared substantive content)
 *   - status.phase: "logged" constant
 *   - NO updatedAt (append-only)
 *   - name OMITTED
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "ReviewHistoryEntry";

export function createReviewHistoryEntryMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {
      timestamp: "metadata.createdAt",
    },
    partition: {
      metadata: ["taskId"],
      spec: ["assessment"],
      status: [],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[ReviewHistoryEntry.migrateOne] input must be object, got ${typeof legacy}`);
      }
      const transformed = preTransform(legacy as Record<string, unknown>);
      return encodeEnvelope(transformed, schemaRef);
    },
  };
}

function preTransform(legacy: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...legacy };
  out["status.phase"] = "logged";
  return out;
}
