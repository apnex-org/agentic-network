import type { KindMigrationModule, MigrationSchemaRef } from "../kinds/_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "./envelope.js";

/** Mission-140 preserve-not-inject envelope factory for revision-storage rows. */
export function createRevisionStorageMigrationModule(
  kind: string,
  schema: SchemaDef,
  partition: MigrationSchemaRef["partition"],
): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = { schema, renameMap: {}, partition };
  return {
    kind,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[${kind}.migrateOne] input must be object, got ${typeof legacy}`);
      }
      return encodeEnvelope(legacy as Record<string, unknown>, schemaRef);
    },
  };
}
