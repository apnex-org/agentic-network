import type { SchemaDef } from "../../../types.js";
import { createRevisionStorageMigrationModule } from "../shared/revision-storage-envelope.js";

export const createWorkGraphRevisionNoticeMigrationModule = (schema: SchemaDef) =>
  createRevisionStorageMigrationModule("WorkGraphRevisionNotice", schema, {
    metadata: ["createdAt"],
    spec: [
      "intentId", "operationId", "generation", "logicalId", "physicalId",
      "exactHolderAgentId", "payloadHash",
    ],
    status: ["projected", "projectedMessageId", "projectedAt"],
  });
