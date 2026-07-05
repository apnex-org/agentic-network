/**
 * mission-102 P3-B2 — CurationRecord KindMigrationModule (WRITE-side envelope
 * authority; design §2). APPEND-ONLY kind: everything is immutable capture in
 * spec; no mutable status fields exist. No renameMap (get + paged id-ordered
 * scans only; no filtered queries).
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "CurationRecord";

export function createCurationRecordMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {},
    partition: {
      metadata: ["createdAt", "updatedAt"],
      spec: ["decisionId", "act", "changes", "curator", "basis", "sourceRawIds", "grantCitation"],
      status: [],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[CurationRecord.migrateOne] input must be object, got ${typeof legacy}`);
      }
      return encodeEnvelope(legacy as Record<string, unknown>, schemaRef);
    },
  };
}
