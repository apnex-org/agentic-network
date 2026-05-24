/**
 * mission-88 W5 cluster-5 — Document KindMigrationModule.
 *
 * Per cluster-5 Design v0.3 §2.1 (substrate-currency-ratified at thread-647 R2;
 * ZERO drift; production-substrate-verified at Phase 4 closure). Substrate-truth
 * partition rules:
 *   - id (free-form; file-stem; e.g., "policy-network-v1-draft") preserved
 *   - name = legacy.id (file-stem convention; handle-classified per §1.5; A2 disposition)
 *   - category → metadata.labels.category (CONTENT-classification axis per cluster-3
 *     §5 6th cumulative-pattern; FIRST instance of content-classification side;
 *     Agent.spec.labels was routing-intent first-instance; axis materially bilateral)
 *   - content → spec (declared substantive markdown body)
 *   - status.phase: "active" constant (mostly-static; no real FSM; uniformity per
 *     cluster-3 Counter/Tele "active" precedent — Q4 disposition)
 *   - Document MAY have updatedAt for forward-compat (Q5 disposition — content updates
 *     possible per OQ4 future)
 *
 * Idempotency: isEnvelopeShape probe at entry.
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "Document";

export function createDocumentMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    partition: {
      metadata: ["createdAt", "updatedAt", "labels"],
      spec: ["content"],
      status: [],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[Document.migrateOne] input must be object, got ${typeof legacy}`);
      }
      const transformed = preTransform(legacy as Record<string, unknown>);
      return encodeEnvelope(transformed, schemaRef);
    },
  };
}

/**
 * Pre-transform legacy Document:
 *   - name = legacy.id (file-stem convention per A2 architect-ratified)
 *   - category → metadata.labels.category (CONTENT-classification axis first-use)
 *   - status.phase: "active" constant injection (uniformity; Document mostly-static)
 */
function preTransform(legacy: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...legacy };

  // A2: handle-classified per §1.5; name = legacy.id (file-stem convention)
  if (typeof out.id === "string") {
    out.name = out.id;
  }

  // Q3: CONTENT-classification axis first-instance per cluster-3 §5 6th cumulative-pattern
  // category → metadata.labels.category (K8s ConfigMap metadata.labels precedent)
  if (typeof out.category === "string" && out.category.length > 0) {
    out.labels = { category: out.category };
  }
  delete out.category;

  // Q4: status.phase="active" constant injection (uniformity)
  out["status.phase"] = "active";

  return out;
}
