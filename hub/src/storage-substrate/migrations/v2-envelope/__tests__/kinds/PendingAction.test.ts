/**
 * mission-88 W2 cluster-2 — PendingAction migration module unit tests.
 *
 * Per cluster-2 Design v0.3 §2.2. Asserts:
 *   - Substrate-truth FSM: 6-state enum (enqueued/receipt_acked/completion_acked/
 *     escalated/errored/continuation_required)
 *   - enqueuedAt → metadata.createdAt rename (envelope-uniformity per A1 R2)
 *   - naturalKey path-move to metadata (SchemaDef v2.0 derived-field framing
 *     forward-looking per A2 R2; treated as regular metadata field at W2)
 *   - spec partition carries declared-with-controlled-mutation deadlines
 *     (LeaseSpec.acquireTime K8s precedent)
 *   - status carries observed FSM-mutated counters + continuationState (task-314)
 *   - Idempotency reference-equality
 */

import { describe, it, expect } from "vitest";
import { createPendingActionMigrationModule } from "../../kinds/PendingAction.js";
import { isEnvelopeShape, DEFAULT_API_VERSION, type EnvelopeShape } from "../../shared/envelope.js";
import type { SchemaDef } from "../../../../types.js";

const paSchema: SchemaDef = { kind: "PendingAction", version: 2, fields: [], indexes: [], watchable: true };

function legacyPA(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "pa-2026-05-24T03-30-00-000Z-1",
    targetAgentId: "agent-greg",
    dispatchType: "thread_message",
    entityRef: "thread-644",
    naturalKey: "agent-greg:thread-644:thread_message",
    payload: { messageId: "msg-1" },
    enqueuedAt: "2026-05-24T03:30:00Z",
    receiptDeadline: "2026-05-24T03:30:30Z",
    completionDeadline: "2026-05-24T03:35:00Z",
    receiptAckedAt: null,
    completionAckedAt: null,
    attemptCount: 0,
    lastAttemptAt: null,
    state: "enqueued",
    escalationReason: null,
    createdBy: { role: "architect", agentId: "agent-arch" },
    ...overrides,
  };
}

describe("PendingAction migration module", () => {
  const module = createPendingActionMigrationModule(paSchema);

  it("declares kind=PendingAction", () => {
    expect(module.kind).toBe("PendingAction");
  });

  it("encodes legacy PendingAction to envelope shape", () => {
    const env = module.migrateOne(legacyPA()) as EnvelopeShape;
    expect(isEnvelopeShape(env)).toBe(true);
    expect(env.kind).toBe("PendingAction");
    expect(env.id).toBe("pa-2026-05-24T03-30-00-000Z-1");
    expect(env.apiVersion).toBe(DEFAULT_API_VERSION);
  });

  it("enqueuedAt → metadata.createdAt (A1 rename via renameMap)", () => {
    const env = module.migrateOne(legacyPA()) as EnvelopeShape;
    expect(env.metadata.createdAt).toBe("2026-05-24T03:30:00Z");
    // No envelope-level enqueuedAt field
    expect((env as unknown as Record<string, unknown>).enqueuedAt).toBeUndefined();
    expect(env.metadata.enqueuedAt).toBeUndefined();
  });

  it("naturalKey path-move to metadata", () => {
    const env = module.migrateOne(legacyPA()) as EnvelopeShape;
    expect(env.metadata.naturalKey).toBe("agent-greg:thread-644:thread_message");
  });

  it("spec carries declared dispatch parameters + deadlines", () => {
    const env = module.migrateOne(legacyPA()) as EnvelopeShape;
    expect(env.spec.targetAgentId).toBe("agent-greg");
    expect(env.spec.dispatchType).toBe("thread_message");
    expect(env.spec.entityRef).toBe("thread-644");
    expect(env.spec.payload).toEqual({ messageId: "msg-1" });
    expect(env.spec.receiptDeadline).toBe("2026-05-24T03:30:30Z");
    expect(env.spec.completionDeadline).toBe("2026-05-24T03:35:00Z");
  });

  it("status carries FSM phase + observed counters + acked timestamps", () => {
    const env = module.migrateOne(legacyPA({
      state: "completion_acked",
      receiptAckedAt: "2026-05-24T03:30:10Z",
      completionAckedAt: "2026-05-24T03:32:00Z",
      attemptCount: 1,
      lastAttemptAt: "2026-05-24T03:31:00Z",
    })) as EnvelopeShape;
    expect(env.status.phase).toBe("completion_acked");
    expect(env.status.receiptAckedAt).toBe("2026-05-24T03:30:10Z");
    expect(env.status.completionAckedAt).toBe("2026-05-24T03:32:00Z");
    expect(env.status.attemptCount).toBe(1);
    expect(env.status.lastAttemptAt).toBe("2026-05-24T03:31:00Z");
  });

  it("continuationState (task-314) → status.continuationState", () => {
    const env = module.migrateOne(legacyPA({
      state: "continuation_required",
      continuationState: { kind: "llm_state", snapshot: "...", currentRound: 5 },
      continuationSavedAt: "2026-05-24T03:33:00Z",
    })) as EnvelopeShape;
    expect(env.status.phase).toBe("continuation_required");
    expect(env.status.continuationState).toEqual({ kind: "llm_state", snapshot: "...", currentRound: 5 });
    expect(env.status.continuationSavedAt).toBe("2026-05-24T03:33:00Z");
  });

  it("FSM substrate-truth: all 6 states map to status.phase", () => {
    const states = ["enqueued", "receipt_acked", "completion_acked", "escalated", "errored", "continuation_required"];
    for (const s of states) {
      const env = module.migrateOne(legacyPA({ state: s })) as EnvelopeShape;
      expect(env.status.phase).toBe(s);
    }
  });

  it("idempotent: re-encoding envelope returns the SAME REFERENCE", () => {
    const env1 = module.migrateOne(legacyPA()) as EnvelopeShape;
    const env2 = module.migrateOne(env1);
    expect(env2).toBe(env1);
  });
});
