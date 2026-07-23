/**
 * mission-103 P3-S1 — ConstitutionSnapshot KindMigrationModule (WRITE-side
 * envelope authority; decision-17 design §1). The singleton read-serve mirror
 * of the git-canonical axiom set: the corpus (files + manifest) and its
 * content provenance (sha/syncedAt/manifestHash) is spec (what bytes the sync
 * committed); mutable verification health (lastVerifiedAt) is status. Get-by-id
 * only (`current` + `snap-<sha>`
 * history rows) — no renameMap, no filtered queries. Born-envelope kind:
 * migrateOne exists for contract-uniformity, not for legacy rows.
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "ConstitutionSnapshot";

export function createConstitutionSnapshotMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {},
    partition: {
      metadata: ["createdAt", "updatedAt"],
      spec: ["sha", "syncedAt", "manifestHash", "files", "manifest"],
      status: ["status", "lastVerifiedAt"],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[ConstitutionSnapshot.migrateOne] input must be object, got ${typeof legacy}`);
      }
      return encodeEnvelope(legacy as Record<string, unknown>, schemaRef);
    },
  };
}
