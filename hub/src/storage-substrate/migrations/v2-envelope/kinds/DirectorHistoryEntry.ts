/**
 * mission-88 W5 cluster-5 — DirectorHistoryEntry KindMigrationModule.
 *
 * Per cluster-5 Design v0.3 §2.3 (substrate-currency-ratified at thread-647 R2;
 * ZERO drift; production-substrate-verified — 200 dh-N entries; LLM chat archive).
 * Substrate-truth partition rules:
 *   - id (dh-N; counter-allocated) preserved
 *   - timestamp → metadata.createdAt (uniformity rename)
 *   - role (user/model — LLM conversation role) + text → spec (declared content
 *     at log-time; spec.role semantically distinct from metadata.createdBy.role
 *     identity per OQ8 engineer disposition)
 *   - status.phase: "logged" constant (append-only-log uniformity)
 *   - NO updatedAt (append-only immutable-content)
 *   - name OMITTED
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "DirectorHistoryEntry";

export function createDirectorHistoryEntryMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {
      timestamp: "metadata.createdAt",
    },
    partition: {
      metadata: [],
      spec: ["role", "text"],
      status: [],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[DirectorHistoryEntry.migrateOne] input must be object, got ${typeof legacy}`);
      }
      const transformed = preTransform(legacy as Record<string, unknown>);
      return encodeEnvelope(transformed, schemaRef);
    },
  };
}

function preTransform(legacy: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...legacy };
  out["status.phase"] = "logged";
  return out;
}
