/**
 * mission-103 P3-S1 — OrgCharter KindMigrationModule (WRITE-side envelope
 * authority; decision-17 design §1). The Hub-native org layer of the T1
 * two-layer constitutional stack: versioned APPEND-ONLY rows (createOnly is
 * the only write; no update path exists anywhere). The version lineage
 * (charterVersion/supersedes) and the rail-proofed content (bindings with
 * per-binding {ratifiedBy, proofRef}, vision, directorProfile) are spec —
 * a charter row never mutates, so nothing is status beyond the constant
 * phase. Get-by-id + tiny full-kind scans — no renameMap, no indexes.
 * Born-envelope kind: migrateOne exists for contract-uniformity.
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "OrgCharter";

export function createOrgCharterMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {},
    partition: {
      metadata: ["createdAt", "updatedAt"],
      spec: ["charterVersion", "supersedes", "bindings", "vision", "directorProfile"],
      status: [],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[OrgCharter.migrateOne] input must be object, got ${typeof legacy}`);
      }
      return encodeEnvelope(legacy as Record<string, unknown>, schemaRef);
    },
  };
}
