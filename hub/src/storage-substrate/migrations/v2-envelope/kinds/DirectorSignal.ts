/**
 * mission-102 P3-B4 — DirectorSignal KindMigrationModule (WRITE-side envelope
 * authority; design §1.3). An IMMUTABLE Hub-stamped capture: everything lands in
 * spec (nothing lifecycles), timestamps in metadata. No renameMap — the kind has
 * no `status` field and no filtered queries (get-by-id only).
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "DirectorSignal";

export function createDirectorSignalMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {},
    partition: {
      metadata: ["createdAt", "updatedAt"],
      spec: ["confirmationId", "channel", "rawIngressRef", "rawContentHash", "answer", "capturedAt", "capturedBy", "capturedBySurface", "confidence", "replyable"],
      status: [],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[DirectorSignal.migrateOne] input must be object, got ${typeof legacy}`);
      }
      return encodeEnvelope(legacy as Record<string, unknown>, schemaRef);
    },
  };
}
