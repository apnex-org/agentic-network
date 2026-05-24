/**
 * mission-88 W5 cluster-5 — ArchitectDecision KindMigrationModule.
 *
 * Per cluster-5 Design v0.3 §2.2 (substrate-currency-ratified at thread-647 R2;
 * ZERO drift; production-substrate-verified at Phase 4 closure — 28 ad-N entries).
 * Substrate-truth partition rules:
 *   - id (ad-N; counter-allocated) preserved
 *   - timestamp → metadata.createdAt (envelope-uniformity rename per cluster-4 Audit precedent)
 *   - decision + context → spec (declared substantive content)
 *   - status.phase: "logged" constant injection (append-only-log uniformity per
 *     cluster-4 Audit precedent; Q4 disposition)
 *   - NO updatedAt (append-only immutable-content per Q5 + Tele/Audit precedent — A4 W3)
 *   - name OMITTED (content-classified §1.5; system-emit; no human-facing handle)
 *
 * Idempotency: isEnvelopeShape probe at entry.
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "ArchitectDecision";

export function createArchitectDecisionMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {
      timestamp: "metadata.createdAt",
    },
    partition: {
      metadata: [],
      spec: ["decision", "context"],
      status: [],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[ArchitectDecision.migrateOne] input must be object, got ${typeof legacy}`);
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
