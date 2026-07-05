/**
 * mission-102 P3-B4 — DirectorConfirmation KindMigrationModule (WRITE-side
 * envelope authority; design §1.3). The hash-bound prompt-render token: the
 * binding contract (decisionId + three hashes + nonce + expiry) is spec; the
 * consume-exactly-once state (consumedAt/consumedBy) is status. No renameMap —
 * no `status` field name and no filtered queries (get-by-id only).
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "DirectorConfirmation";

export function createDirectorConfirmationMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {},
    partition: {
      metadata: ["createdAt", "updatedAt"],
      spec: ["decisionId", "promptHash", "proposedResolutionHash", "proposedAnswer", "executionPlanHash", "mintedBy", "nonce", "expiresAt"],
      status: ["answeredBySignalId", "consumedAt", "consumedBy"],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[DirectorConfirmation.migrateOne] input must be object, got ${typeof legacy}`);
      }
      return encodeEnvelope(legacy as Record<string, unknown>, schemaRef);
    },
  };
}
