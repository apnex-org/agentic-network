/**
 * mission-88 W1 cluster-1 — Thread migration module unit tests.
 *
 * Per Q3 + cluster-1 Design v0.3 §3.3. Asserts:
 *   - FSM enum substrate-truth: round_limit + cascade_failed present, expired absent
 *   - cascade-pending bookkeeping → status (Q2 drift-table resolution)
 *   - messages[] → status.messages[] STAGED-INSIDE-ENVELOPE (idea-200 W2 follow-on)
 *   - labels:Record<string,string> already-shaped (no tags-array transform)
 *   - Idempotency reference-equality
 */

import { describe, it, expect } from "vitest";
import { createThreadMigrationModule } from "../../kinds/Thread.js";
import { isEnvelopeShape, DEFAULT_API_VERSION, type EnvelopeShape } from "../../shared/envelope.js";
import type { SchemaDef } from "../../../../types.js";

const threadSchema: SchemaDef = {
  kind: "Thread",
  version: 2,
  fields: [],
  indexes: [],
  watchable: true,
};

function legacyThread(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "thread-1",
    title: "Test thread",
    status: "active",
    routingMode: "unicast",
    context: null,
    idleExpiryMs: null,
    createdBy: { role: "engineer", agentId: "agent-greg" },
    currentTurn: "architect",
    currentTurnAgentId: "agent-arch",
    roundCount: 1,
    maxRounds: 10,
    outstandingIntent: null,
    currentSemanticIntent: null,
    correlationId: "mission-88",
    convergenceActions: [],
    summary: "",
    participants: [{ role: "engineer", agentId: "agent-greg", joinedAt: "2026-05-24T00:00:00Z", lastActiveAt: "2026-05-24T00:00:00Z" }],
    recipientAgentId: "agent-arch",
    messages: [{ author: "engineer", authorAgentId: "agent-greg", text: "hello", timestamp: "2026-05-24T00:00:00Z", converged: false, intent: null, semanticIntent: null }],
    labels: { env: "prod" },
    lastMessageConverged: false,
    createdAt: "2026-05-24T00:00:00Z",
    updatedAt: "2026-05-24T00:00:00Z",
    ...overrides,
  };
}

describe("Thread migration module", () => {
  const module = createThreadMigrationModule(threadSchema);

  it("declares kind=Thread", () => {
    expect(module.kind).toBe("Thread");
  });

  it("encodes legacy Thread to envelope shape", () => {
    const env = module.migrateOne(legacyThread()) as EnvelopeShape;
    expect(isEnvelopeShape(env)).toBe(true);
    expect(env.kind).toBe("Thread");
    expect(env.id).toBe("thread-1");
    expect(env.apiVersion).toBe(DEFAULT_API_VERSION);
  });

  it("metadata carries identity + provenance + labels", () => {
    const env = module.migrateOne(legacyThread()) as EnvelopeShape;
    expect(env.metadata.createdAt).toBe("2026-05-24T00:00:00Z");
    expect(env.metadata.updatedAt).toBe("2026-05-24T00:00:00Z");
    expect(env.metadata.correlationId).toBe("mission-88");
    expect(env.metadata.labels).toEqual({ env: "prod" });
  });

  it("spec carries thread configuration", () => {
    const env = module.migrateOne(legacyThread()) as EnvelopeShape;
    expect(env.spec.title).toBe("Test thread");
    expect(env.spec.routingMode).toBe("unicast");
    expect(env.spec.recipientAgentId).toBe("agent-arch");
    expect(env.spec.maxRounds).toBe(10);
  });

  it("status carries FSM phase + observed state + cascade bookkeeping", () => {
    const env = module.migrateOne(legacyThread()) as EnvelopeShape;
    expect(env.status.phase).toBe("active");
    expect(env.status.roundCount).toBe(1);
    expect(env.status.currentTurn).toBe("architect");
    expect(env.status.lastMessageConverged).toBe(false);
    expect(env.status.messages).toBeInstanceOf(Array);
    expect((env.status.messages as unknown[]).length).toBe(1);
  });

  it("FSM substrate-truth: round_limit phase", () => {
    const env = module.migrateOne(legacyThread({ status: "round_limit" })) as EnvelopeShape;
    expect(env.status.phase).toBe("round_limit");
  });

  it("FSM substrate-truth: cascade_failed phase", () => {
    const env = module.migrateOne(legacyThread({ status: "cascade_failed" })) as EnvelopeShape;
    expect(env.status.phase).toBe("cascade_failed");
  });

  it("cascade-pending bookkeeping fields → status (Q2 drift resolution)", () => {
    const env = module.migrateOne(legacyThread({
      cascadePending: true,
      cascadePendingActionCount: 2,
      cascadePendingStartedAt: "2026-05-24T01:00:00Z",
    })) as EnvelopeShape;
    expect(env.status.cascadePending).toBe(true);
    expect(env.status.cascadePendingActionCount).toBe(2);
    expect(env.status.cascadePendingStartedAt).toBe("2026-05-24T01:00:00Z");
  });

  it("lastMessageProjectedAt → status", () => {
    const env = module.migrateOne(legacyThread({ lastMessageProjectedAt: "2026-05-24T02:00:00Z" })) as EnvelopeShape;
    expect(env.status.lastMessageProjectedAt).toBe("2026-05-24T02:00:00Z");
  });

  it("idempotent: re-encoding envelope returns the SAME REFERENCE", () => {
    const env1 = module.migrateOne(legacyThread()) as EnvelopeShape;
    const env2 = module.migrateOne(env1);
    expect(env2).toBe(env1);
  });
});
