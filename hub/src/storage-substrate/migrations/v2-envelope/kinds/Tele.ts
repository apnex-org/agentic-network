/**
 * mission-88 W3 cluster-3 — Tele KindMigrationModule.
 *
 * Per cluster-3 Design v0.3 §2.2 (substrate-currency-ratified at thread-645 R2;
 * ZERO drift). Substrate-truth partition rules:
 *   - status (3-state FSM: active/superseded/retired) → status.phase
 *   - name → metadata.name (handle-classified per §1.5)
 *   - description/successCriteria → spec (declared substantive content; immutable
 *     per Mission-43 zero-backfill discipline)
 *   - supersededBy/retiredAt → status (observed lineage + FSM-transition timestamp)
 *   - createdBy → metadata (cluster-1 §3.1 pattern)
 *
 * NO `updatedAt` field per A4 architect-ratified disposition: Tele is the FIRST
 * envelope kind to legitimately omit `updatedAt` (Mission-43 zero-backfill;
 * content immutable; only status/lineage fields mutate). Establishes precedent
 * for immutable-content kinds across clusters 4/5.
 *
 * Idempotency: isEnvelopeShape probe at entry.
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "Tele";

export function createTeleMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {
      status: "status.phase",
      name: "metadata.name",
    },
    partition: {
      metadata: [],
      spec: ["description", "successCriteria"],
      status: ["supersededBy", "retiredAt"],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[Tele.migrateOne] input must be object, got ${typeof legacy}`);
      }
      const transformed = preTransform(legacy as Record<string, unknown>);
      return encodeEnvelope(transformed, schemaRef);
    },
  };
}

function preTransform(legacy: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...legacy };

  // Tele.name is handle-classified per §1.5; preserve as envelope.name top-level
  // AND metadata.name (K8s-canonical handle). renameMap maps "name" → "metadata.name"
  // for the metadata bucket; envelope.name comes from src.name unchanged via
  // encodeEnvelope's local-var (envelopeReserved skip).
  // No-op needed: src.name already exists; encodeEnvelope picks it up.
  return out;
}
