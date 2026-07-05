/**
 * mission-102 P3-B6 — NudgeReceipt KindMigrationModule (WRITE-side envelope
 * authority; design §1.4). Presenter-side delivery accounting — immutable
 * capture in spec, mutable markers/receipt state in status. No renameMap
 * (get-by-id + small capped lists; no filtered queries).
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "NudgeReceipt";

export function createNudgeReceiptMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {},
    partition: {
      metadata: ["createdAt", "updatedAt"],
      spec: ["decisionId", "level", "emittedRef", "emittedAt"],
      status: ["presentedInSnapshotId", "retryCount", "escalatedAt"],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[NudgeReceipt.migrateOne] input must be object, got ${typeof legacy}`);
      }
      return encodeEnvelope(legacy as Record<string, unknown>, schemaRef);
    },
  };
}
