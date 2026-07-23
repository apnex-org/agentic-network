import type { SchemaDef } from "../../../types.js";
import { createRevisionStorageMigrationModule } from "../shared/revision-storage-envelope.js";

export const createWorkGraphTopologyShardMigrationModule = (schema: SchemaDef) =>
  createRevisionStorageMigrationModule("WorkGraphTopologyShard", schema, {
    metadata: ["createdAt"],
    spec: [
      "generation", "shardIndex", "logicalIds", "bindings", "dependsOn",
      "completionDependsOn", "reverseDependsOn", "reverseCompletionDependsOn", "shardHash",
    ],
    status: [],
  });
