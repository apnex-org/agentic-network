/**
 * mission-88 W4 cluster-4 — Audit KindMigrationModule.
 *
 * Per cluster-4 Design v0.3 §2.2 (substrate-currency-ratified at thread-646 R2;
 * ZERO drift). Substrate-truth partition rules:
 *   - timestamp → metadata.createdAt (envelope-uniformity rename; audit-entry
 *     creation IS the timestamp; immutable post-create; no separate updatedAt)
 *   - actor → metadata (identity-shape; who logged the audit entry)
 *   - action / details / relatedEntity → spec (declared content; what happened +
 *     free-form description + which entity this audit relates to)
 *   - status.phase: "logged" constant (pre-transform injection; uniformity
 *     convention; Audit has no FSM — immutable post-create; sibling of cluster-3
 *     Tele "active" + Counter "active" patterns)
 *   - name OMITTED (content-classified per §1.5; system-emit; no human-facing handle)
 *
 * createOnly-write pattern preserved (audit-repository.ts:66); append-only semantic.
 *
 * Idempotency: isEnvelopeShape probe at entry.
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "Audit";

export function createAuditMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {
      timestamp: "metadata.createdAt",
    },
    partition: {
      metadata: ["actor"],
      spec: ["action", "details", "relatedEntity"],
      status: [],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[Audit.migrateOne] input must be object, got ${typeof legacy}`);
      }
      const transformed = preTransform(legacy as Record<string, unknown>);
      return encodeEnvelope(transformed, schemaRef);
    },
  };
}

/**
 * Pre-transform legacy Audit:
 *   - Inject status.phase: "logged" constant (Audit has no FSM; uniformity)
 *
 * Uses dotted-path encoding so encodeEnvelope's assignDottedPath routes to status bucket.
 */
function preTransform(legacy: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...legacy };
  out["status.phase"] = "logged";
  return out;
}
