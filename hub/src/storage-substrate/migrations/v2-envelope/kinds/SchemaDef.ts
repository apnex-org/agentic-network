/**
 * mission-88 W3 cluster-3 — SchemaDef KindMigrationModule.
 *
 * Per cluster-3 Design v0.3 §2.3 (substrate-currency-ratified at thread-645 R2;
 * deliberate-extension acknowledged). Substrate-truth partition rules:
 *   - id = kind-name (per SchemaDef PK convention; preserved)
 *   - metadata.name = kind-name (handle-classified per §1.5; K8s CRD precedent)
 *   - version/fields[]/indexes[]/watchable → spec (declared schema configuration;
 *     immutable except via explicit version bump)
 *   - NEW status fields per OQ10 SUBSTANTIVE DEVIATION (architect-ratified):
 *     status.phase ∈ {"pending","applied","failed"} | status.lastReconciledAt
 *     | status.reconcileError | status.appliedVersion
 *   - Migration writes existing SchemaDefs as status.phase="applied" + appliedVersion
 *     mirroring spec.version (matches operational post-W4.x.10 cutover state)
 *
 * Per A2 architect-ratified: reconciler-side WRITES of status fields (going forward)
 * is DEFERRED to a follow-on PR (M-SchemaDef-Reconciler-Status-Write-Patch Idea filing
 * at W3 ship-close). W3 only writes existing SchemaDefs as status.phase="applied" at
 * migration time; future writes (new kind onboarding OR version-bumps post-W3) carry
 * stale status until reconciler patch lands — visible degradation NOT regression.
 *
 * Idempotency: isEnvelopeShape probe at entry.
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef as SchemaDefType } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "SchemaDef";

export function createSchemaDefMigrationModule(schema: SchemaDefType): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {
      kind: "metadata.name",
    },
    partition: {
      metadata: [],
      spec: ["version", "fields", "indexes", "watchable"],
      status: [],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[SchemaDef.migrateOne] input must be object, got ${typeof legacy}`);
      }
      const transformed = preTransform(legacy as Record<string, unknown>);
      return encodeEnvelope(transformed, schemaRef);
    },
  };
}

/**
 * Pre-transform legacy SchemaDef:
 *   - Map kind-name → envelope.name top-level (handle-classified) AND metadata.name
 *   - Inject status fields per OQ10 deviation (existing SchemaDefs = "applied")
 */
function preTransform(legacy: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...legacy };

  // legacy.kind is the kind-name (e.g., "Idea", "Bug"); same as legacy.id per
  // SchemaDef PK convention. Copy to envelope.name top-level (handle).
  if (typeof out.kind === "string") {
    out.name = out.kind;
  }

  // OQ10 deliberate-extension: inject status.* fields at migration time.
  // Existing SchemaDefs are operational (mission-83 W4.x.10 cutover); mark them
  // as "applied" with appliedVersion mirroring spec.version. Future reconciler
  // patch will maintain these fields going forward (A2 deferred).
  const version = typeof out.version === "number" ? out.version : 1;
  out["status.phase"] = "applied";
  out["status.lastReconciledAt"] = new Date().toISOString();
  out["status.reconcileError"] = null;
  out["status.appliedVersion"] = version;

  return out;
}
