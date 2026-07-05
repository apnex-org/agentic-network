/**
 * mission-102 P3-B3 (audit-9897) — GrantRatification KindMigrationModule.
 * The single-use ratification-consumption row: PK = the ratificationRef;
 * createOnly on this kind is the atomicity primitive for "one Director
 * ratification mints exactly one grant". Immutable once created — everything
 * is spec; no renameMap (get-by-id only, no filtered queries).
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "GrantRatification";

export function createGrantRatificationMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {},
    partition: {
      metadata: ["createdAt", "updatedAt"],
      spec: ["grantId", "consumedAt"],
      status: [],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[GrantRatification.migrateOne] input must be object, got ${typeof legacy}`);
      }
      return encodeEnvelope(legacy as Record<string, unknown>, schemaRef);
    },
  };
}
