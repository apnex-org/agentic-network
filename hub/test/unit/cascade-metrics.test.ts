import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { runCascade, MAX_CASCADE_DEPTH } from "../../src/policy/cascade.js";
import {
  registerActionSpec,
  unregisterActionSpec,
  getActionSpec,
  type ActionSpec,
} from "../../src/policy/cascade-spec.js";
import { createTestContext } from "../../src/policy/test-utils.js";
import { createMetricsCounter } from "../../src/observability/metrics.js";
import type { Thread, StagedAction } from "../../src/state.js";

/**
 * Phase 2d CP1 — cascade-failure-type metrics integration tests.
 *
 * Exercises the cascade runner directly against synthetic ActionSpecs
 * to verify each failure-taxonomy bucket increments correctly.
 */

const TEST_TYPE = "create_clarification" as const; // audit_only, safe to swap

function makeThread(id = "thread-metrics-test"): Thread {
  return {
    id,
    title: "metrics test",
    status: "active",
    routingMode: "broadcast",
    context: null,
    idleExpiryMs: null,
    initiatedBy: "engineer",
    currentTurn: "architect",
    currentTurnAgentId: null,
    roundCount: 1,
    maxRounds: 10,
    outstandingIntent: null,
    currentSemanticIntent: null,
    correlationId: null,
    convergenceActions: [],
    summary: "",
    participants: [],
    recipientAgentId: null,
    messages: [],
    labels: {},
    lastMessageConverged: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as Thread;
}

function makeAction(id = "action-1", type: string = TEST_TYPE): StagedAction {
  return {
    id,
    type: type as StagedAction["type"],
    status: "committed",
    proposer: { role: "engineer", agentId: null },
    timestamp: new Date().toISOString(),
    payload: { question: "q", context: "c" },
  } as unknown as StagedAction;
}

describe("cascade-failure-type metrics", () => {
  let priorSpec: ActionSpec | undefined;

  beforeEach(() => {
    priorSpec = getActionSpec(TEST_TYPE);
  });
  afterEach(() => {
    unregisterActionSpec(TEST_TYPE);
    if (priorSpec) registerActionSpec(priorSpec);
  });

  it("increments cascade_fail.execute_threw when handler throws", async () => {
    registerActionSpec({
      type: TEST_TYPE,
      kind: "audit_only",
      payloadSchema: z.object({ question: z.string(), context: z.string() }),
      auditAction: "test_execute_threw",
      execute: async () => {
        throw new Error("simulated execute failure");
      },
    });

    const ctx = createTestContext();
    ctx.metrics = createMetricsCounter();
    const thread = makeThread();
    const action = makeAction();

    const result = await runCascade(ctx, thread, [action], "summary");

    expect(result.failedCount).toBe(1);
    expect(ctx.metrics.snapshot()["cascade_fail.execute_threw"]).toBe(1);
    const recent = ctx.metrics.recentDetails("cascade_fail.execute_threw");
    expect(recent[0].details).toMatchObject({
      threadId: thread.id,
      actionId: action.id,
      type: TEST_TYPE,
      error: "simulated execute failure",
    });
  });

  it("increments cascade_fail.unknown_spec when no spec is registered", async () => {
    // Do NOT re-register; ensure the spec is absent.
    unregisterActionSpec(TEST_TYPE);

    const ctx = createTestContext();
    ctx.metrics = createMetricsCounter();
    const thread = makeThread();
    const action = makeAction();

    const result = await runCascade(ctx, thread, [action], "summary");

    expect(result.failedCount).toBe(1);
    expect(ctx.metrics.snapshot()["cascade_fail.unknown_spec"]).toBe(1);
  });

  it("increments cascade_fail.depth_exhausted at MAX_CASCADE_DEPTH", async () => {
    registerActionSpec({
      type: TEST_TYPE,
      kind: "audit_only",
      payloadSchema: z.object({ question: z.string(), context: z.string() }),
      auditAction: "test_depth",
      execute: async () => null,
    });

    const ctx = createTestContext();
    ctx.metrics = createMetricsCounter();
    const thread = makeThread();
    const action = makeAction();

    const result = await runCascade(ctx, thread, [action], "summary", MAX_CASCADE_DEPTH);

    expect(result.anyFailure).toBe(true);
    expect(ctx.metrics.snapshot()["cascade_fail.depth_exhausted"]).toBe(1);
    // INV-TH25 shadow breach also fires at the same site (from C2).
    expect(ctx.metrics.snapshot()["inv_th25.shadow_breach"]).toBe(1);
  });

  it("emits INV-TH25 near_miss at depth = MAX - 1 (no depth_exhausted yet)", async () => {
    registerActionSpec({
      type: TEST_TYPE,
      kind: "audit_only",
      payloadSchema: z.object({ question: z.string(), context: z.string() }),
      auditAction: "test_near_miss",
      execute: async () => null,
    });

    const ctx = createTestContext();
    ctx.metrics = createMetricsCounter();
    const thread = makeThread();
    const action = makeAction();

    await runCascade(ctx, thread, [action], "summary", MAX_CASCADE_DEPTH - 1);

    expect(ctx.metrics.snapshot()["inv_th25.near_miss"]).toBe(1);
    expect(ctx.metrics.snapshot()["cascade_fail.depth_exhausted"]).toBeUndefined();
  });
});
