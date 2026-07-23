import type { SchemaDef } from "../../../types.js";
import { createRevisionStorageMigrationModule } from "../shared/revision-storage-envelope.js";

export const createWorkGraphTopologyEdgeMigrationModule = (schema: SchemaDef) =>
  createRevisionStorageMigrationModule("WorkGraphTopologyEdge", schema, {
    metadata: [],
    spec: ["generation", "edgeClass", "sourceLogicalId", "targetLogicalId"],
    status: [],
  });
