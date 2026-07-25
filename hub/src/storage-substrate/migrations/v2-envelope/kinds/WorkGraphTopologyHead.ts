import type { SchemaDef } from "../../../types.js";
import { createRevisionStorageMigrationModule } from "../shared/revision-storage-envelope.js";

export const createWorkGraphTopologyHeadMigrationModule = (schema: SchemaDef) =>
  createRevisionStorageMigrationModule("WorkGraphTopologyHead", schema, {
    metadata: ["activatedAt"],
    spec: ["domain", "generation", "manifestId", "topologyHash", "operationId"],
    status: [],
  });
