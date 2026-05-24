/**
 * mission-88 W4 cluster-4 — RepoEventBridgeDedupe KindMigrationModule.
 *
 * Per cluster-4 Design v0.3 §2.4 (substrate-currency-ratified at thread-646 R2;
 * ZERO drift). Sibling of RepoEventBridgeCursor; same shape; same partition
 * rationale; only differing rename target: body → status.dedupe.
 *
 * Atomic-ship coordination: RepoEventBridgeSubstrateAdapter REWRITTEN in this
 * same PR per A1 architect-ratified disposition (shared rewrite covers both
 * Cursor + Dedupe).
 *
 * Idempotency: isEnvelopeShape probe at entry.
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "RepoEventBridgeDedupe";

export function createRepoEventBridgeDedupeMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {
      body: "status.dedupe",
    },
    partition: {
      metadata: [],
      spec: [],
      status: [],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[RepoEventBridgeDedupe.migrateOne] input must be object, got ${typeof legacy}`);
      }
      const transformed = preTransform(legacy as Record<string, unknown>);
      return encodeEnvelope(transformed, schemaRef);
    },
  };
}

function preTransform(legacy: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...legacy };
  out["status.phase"] = "active";
  return out;
}
