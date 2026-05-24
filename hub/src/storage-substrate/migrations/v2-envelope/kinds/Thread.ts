/**
 * mission-88 W1 cluster-1 — Thread KindMigrationModule.
 *
 * Per cluster-1 Design v0.3 §3.3 (post thread-643 ratification). Substrate-truth
 * partition rules (Q2 drift-table resolution):
 *   - phase enum: active/converged/round_limit/closed/abandoned/cascade_failed
 *     (substrate-truth; Design v0.2's "expired" doesn't exist)
 *   - cascadePending + cascadePendingActionCount + cascadePendingStartedAt +
 *     cascadeCompletedAt + lastMessageProjectedAt → status (cascade-execution
 *     bookkeeping; system-mutates during cascade)
 *   - messages[] → status.messages[] STAGED-INSIDE-ENVELOPE per Design §3.3;
 *     idea-200 W2 carves out to Message-store post-this-cutover
 *   - Thread already has labels: Record<string,string> (no tags-array
 *     transform needed)
 *   - Thread has NO sourceThreadSummary (no annotations transform needed)
 *
 * Idempotency: isEnvelopeShape probe at entry.
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "Thread";

export function createThreadMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {
      status: "status.phase",
    },
    partition: {
      metadata: [
        "createdAt",
        "createdBy",
        "updatedAt",
        "correlationId",
        "labels",
      ],
      spec: [
        "title",
        "routingMode",
        "recipientAgentId",
        "maxRounds",
        "semanticIntent",
        "context",
        "idleExpiryMs",
      ],
      status: [
        "roundCount",
        "currentTurn",
        "currentTurnAgentId",
        "currentSemanticIntent",
        "lastMessageConverged",
        "lastMessageProjectedAt",
        "outstandingIntent",
        "summary",
        "convergenceActions",
        "participants",
        "messages",
        "cascadePending",
        "cascadePendingActionCount",
        "cascadePendingStartedAt",
        "cascadeCompletedAt",
      ],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[Thread.migrateOne] input must be object, got ${typeof legacy}`);
      }
      return encodeEnvelope(legacy, schemaRef);
    },
  };
}
