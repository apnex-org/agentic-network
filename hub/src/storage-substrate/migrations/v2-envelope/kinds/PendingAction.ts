/**
 * mission-88 W2 cluster-2 — PendingAction KindMigrationModule.
 *
 * Per cluster-2 Design v0.2 §2.2 (substrate-currency-ratified at thread-644 R2;
 * ZERO drift). Substrate-truth partition rules:
 *   - state (6-state FSM) → status.phase (K8s nested FSM)
 *   - enqueuedAt → metadata.createdAt (envelope-uniformity rename per Design §2.2 +
 *     thread-644 A1 architect-ratified)
 *   - naturalKey path-move to metadata (forward-looking SchemaDef v2.0
 *     "derived":true framing per thread-644 A2; for W2 envelope-migration treated
 *     as regular metadata field — substrate-current stores it post-enqueue())
 *   - spec: targetAgentId / dispatchType / entityRef / payload + deadlines
 *     (declared-with-controlled-mutation per K8s LeaseSpec.acquireTime precedent)
 *   - status: ackedAt timestamps + attempt counters + continuationState (task-314)
 *
 * Pure queue-state kind per §2.2 rationale (state-classified analog of cluster-1
 * content-classified): `name` OMITTED (defaults to id `pa-YYYY-MM-DDTHH-MM-SS-...`
 * which is itself the identifying handle).
 *
 * Idempotency: isEnvelopeShape probe at entry.
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "PendingAction";

export function createPendingActionMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {
      state: "status.phase",
      enqueuedAt: "metadata.createdAt",
    },
    partition: {
      metadata: ["createdBy", "naturalKey"],
      spec: [
        "targetAgentId",
        "dispatchType",
        "entityRef",
        "payload",
        "receiptDeadline",
        "completionDeadline",
      ],
      status: [
        "receiptAckedAt",
        "completionAckedAt",
        "attemptCount",
        "lastAttemptAt",
        "escalationReason",
        "continuationState",
        "continuationSavedAt",
      ],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[PendingAction.migrateOne] input must be object, got ${typeof legacy}`);
      }
      return encodeEnvelope(legacy, schemaRef);
    },
  };
}
