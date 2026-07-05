/**
 * mission-102 P3-B3 — ClassGrant KindMigrationModule (WRITE-side envelope
 * authority; design §1.2). Constraint fields are IMMUTABLE per row (spec);
 * lifecycle (state/supersededBy) is status. Filterable: state → status.state,
 * class → spec.class (mirrored in the all-schemas renameMap; W1 sentinel-probe
 * asserts agreement).
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "ClassGrant";

export function createClassGrantMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {
      state: "status.state",
    },
    partition: {
      metadata: ["createdAt", "updatedAt"],
      spec: ["version", "class", "allowedActions", "reversibleOnly", "parentKinds", "excludedRefs", "excludedClasses", "issuer", "ratificationRef", "representationDue", "supersedes"],
      status: ["supersededBy"],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[ClassGrant.migrateOne] input must be object, got ${typeof legacy}`);
      }
      return encodeEnvelope(legacy as Record<string, unknown>, schemaRef);
    },
  };
}
