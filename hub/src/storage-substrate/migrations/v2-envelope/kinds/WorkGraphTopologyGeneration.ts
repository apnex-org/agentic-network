import type { SchemaDef } from "../../../types.js";
import { createRevisionStorageMigrationModule } from "../shared/revision-storage-envelope.js";

export const createWorkGraphTopologyGenerationMigrationModule = (schema: SchemaDef) =>
  createRevisionStorageMigrationModule("WorkGraphTopologyGeneration", schema, {
    metadata: ["createdAt"],
    spec: [
      "schemaVersion", "generation", "previousGeneration", "bindings", "dependsOn",
      "completionDependsOn", "reverseDependsOn", "reverseCompletionDependsOn",
      "topologyHash", "manifestHash", "operationId", "requestHash",
      "notificationIntentIds", "shardHashes",
    ],
    status: [],
  });
