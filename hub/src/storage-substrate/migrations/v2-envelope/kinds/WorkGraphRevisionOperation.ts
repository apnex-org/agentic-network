import type { SchemaDef } from "../../../types.js";
import { createRevisionStorageMigrationModule } from "../shared/revision-storage-envelope.js";

export const createWorkGraphRevisionOperationMigrationModule = (schema: SchemaDef) =>
  createRevisionStorageMigrationModule("WorkGraphRevisionOperation", schema, {
    metadata: ["preparedAt"],
    spec: [
      "operationId", "requestHash", "generation", "previousGeneration",
      "topologyHash", "manifestId", "recommitSet",
    ],
    status: ["state", "committedAt"],
  });
