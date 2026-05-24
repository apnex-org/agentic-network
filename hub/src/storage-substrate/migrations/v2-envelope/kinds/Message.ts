/**
 * mission-88 W4 cluster-4 — Message KindMigrationModule.
 *
 * Per cluster-4 Design v0.3 §2.1 (substrate-currency-ratified at thread-646 R2;
 * ZERO drift). Substrate-truth partition rules:
 *   - kind (legacy discriminator: reply/note/external-injection/amendment/urgency-flag)
 *     → metadata.messageKind (CANONICAL field-name-collision rename per §1.7;
 *     FIRST cross-cluster use of envelope library renameMap for true collision —
 *     W0 primitive design-driver case)
 *   - status (FSM 3-state: new/received/acked) → status.phase (K8s nested FSM)
 *   - authorRole / authorAgentId / threadId / sequenceInThread / migrationSourceId
 *     → metadata (identity-shape; substrate-derived sequence; provenance lineage)
 *   - target / delivery / payload / escalation / fireAt / precondition / maxRetries /
 *     intent / semanticIntent → spec (declared dispatch/scheduling config; immutable
 *     post-create OR declared-at-create)
 *   - claimedBy / scheduledState / retryCount / converged → status (observed FSM-
 *     mutated; multi-FSM per §1.6 — primary phase + secondary scheduledState)
 *   - name OMITTED (content-classified per §1.5; system-emit kind)
 *
 * Idempotency: isEnvelopeShape probe at entry.
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "Message";

export function createMessageMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {
      // CANONICAL field-name-collision per §1.7 — legacy Message.kind collides
      // with envelope kind="Message"; rename to metadata.messageKind
      kind: "metadata.messageKind",
      status: "status.phase",
    },
    partition: {
      metadata: [
        "authorRole",
        "authorAgentId",
        "threadId",
        "sequenceInThread",
        "migrationSourceId",
      ],
      spec: [
        "target",
        "delivery",
        "payload",
        "escalation",
        "fireAt",
        "precondition",
        "maxRetries",
        "intent",
        "semanticIntent",
      ],
      status: ["claimedBy", "scheduledState", "retryCount", "converged"],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[Message.migrateOne] input must be object, got ${typeof legacy}`);
      }
      return encodeEnvelope(legacy, schemaRef);
    },
  };
}
