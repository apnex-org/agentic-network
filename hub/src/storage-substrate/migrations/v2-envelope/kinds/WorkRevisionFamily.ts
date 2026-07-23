import type { SchemaDef } from "../../../types.js";
import { createRevisionStorageMigrationModule } from "../shared/revision-storage-envelope.js";

export const createWorkRevisionFamilyMigrationModule = (schema: SchemaDef) =>
  createRevisionStorageMigrationModule("WorkRevisionFamily", schema, {
    metadata: ["createdAt"],
    spec: ["logicalId", "originPhysicalId", "latestAllocatedRevision", "originalCreatedBy", "familyScope"],
    status: [],
  });
