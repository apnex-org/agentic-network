/**
 * C1-R2 (mission-94) — WorkItem KindMigrationModule (the WRITE-side envelope
 * authority, peer to the all-schemas SchemaDef renameMap which is the READ-side
 * filter-translate authority).
 *
 * The encoder (buildEnvelopeWriteEncoder) is partition-driven per-kind: this
 * module's `partition` routes each flat domain field to its metadata/spec/status
 * bucket, and `renameMap` carries the leaf-rename (status→status.phase). The
 * placement here MUST agree with the all-schemas WorkItem renameMap — the W1
 * sentinel-probe oracle (renamemap-contract-w1.test.ts) asserts exactly that.
 *
 * No preTransform: WorkItem has no array→map (Bug.tags→labels) or
 * summary→annotations transform; roleEligibility/dependsOn stay K8s arrays in
 * spec, lease/evidence stay objects/arrays in status. (Born-under-governor:
 * reference-only WorkItem, lease = sole claim authority — design #355.)
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "WorkItem";

export function createWorkItemMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {
      status: "status.phase",
    },
    partition: {
      metadata: ["createdAt", "createdBy", "updatedAt"],
      // spec = declared intent (incl. the K8s arrays roleEligibility/dependsOn/
      // completionDependsOn + the evidenceRequirements/targetRef objects + the freeform
      // payload). work-88: completionDependsOn explicit (it backs a GIN index — don't rely
      // on default-routing for an indexed field).
      spec: ["type", "priority", "roleEligibility", "dependsOn", "completionDependsOn", "evidenceRequirements", "targetRef", "payload"],
      // status = lifecycle (phase via the rename above; lease = sole claim
      // authority; evidence accumulates; blockedOn + the per-item poison counter;
      // work-98 idea-384 Part A: the per-FSM-state wall-clock timers;
      // SEAL idea-444: the append-only attestationHistory + active attestations
      // projection — partitioned into status so EVERY write round-trips them by
      // construction (the structural preserve-not-inject; closes the un-partitioned→
      // spec resurrection trap in envelope.ts pickPartition).
      status: ["lease", "evidence", "blockedOn", "leaseExpiryCount", "enteredCurrentStateAt", "stateDurations", "attestationHistory", "attestations"],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[WorkItem.migrateOne] input must be object, got ${typeof legacy}`);
      }
      return encodeEnvelope(legacy as Record<string, unknown>, schemaRef);
    },
  };
}
