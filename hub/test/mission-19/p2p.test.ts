/**
 * Mission-19 — P2P routing via assignedEngineerId for reviews & clarifications.
 *
 * Covers: reviews dispatch with {agentId} pin to the original claimant,
 * fallback to label-scoped pool when assignedEngineerId is null,
 * clarification_answered routes P2P, revision_required routes P2P.
 *
 * Registry invariants: INV-T15 (assignedEngineerId persisted), INV-AG2
 * (P2P via agentId, not sessionId), INV-SYS-L05 (stale pin falls through).
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { RegisterAgentPayload, AgentClientMetadata, AgentRole, AgentLabels } from "../../src/state.js";
import { PolicyRouter } from "../../src/policy/router.js";
import { registerTaskPolicy } from "../../src/policy/task-policy.js";
import { registerReviewPolicy } from "../../src/policy/review-policy.js";
import { registerClarificationPolicy } from "../../src/policy/clarification-policy.js";
import { registerSessionPolicy } from "../../src/policy/session-policy.js";
import { createTestContext, type TestPolicyContext } from "../../src/policy/test-utils.js";
import type { TaskRepository } from "../../src/entities/task-repository.js";

const noop = () => {};

const CLIENT: AgentClientMetadata = {
  clientName: "claude-code",
  clientVersion: "0.1.0",
  proxyName: "@apnex/claude-plugin",
  proxyVersion: "1.0.0",
};

function payload(instanceId: string, role: AgentRole, labels?: AgentLabels): RegisterAgentPayload {
  return { globalInstanceId: instanceId, role, clientMetadata: CLIENT, labels };
}

async function register(ctx: TestPolicyContext, role: AgentRole, labels: AgentLabels): Promise<string> {
  const result = await ctx.stores.engineerRegistry.registerAgent(
    ctx.sessionId,
    role,
    payload(`inst-${ctx.sessionId}`, role, labels),
  );
  if (!result.ok) throw new Error(`register failed: ${result.code}`);
  return result.agentId;
}

describe("Mission-19 P2P — Review routes to assignedEngineerId", () => {
  let router: PolicyRouter;
  let archCtx: TestPolicyContext;
  let engCtx: TestPolicyContext;
  let taskId: string;
  let agentId: string;

  beforeEach(async () => {
    router = new PolicyRouter(noop);
    registerTaskPolicy(router);
    registerReviewPolicy(router);
    registerSessionPolicy(router);

    archCtx = createTestContext({ sessionId: "sess-arch", role: "architect" });
    await register(archCtx, "architect", { team: "platform" });

    engCtx = createTestContext({
      stores: archCtx.stores,
      sessionId: "sess-eng",
      role: "engineer",
    });
    agentId = await register(engCtx, "engineer", { team: "platform" });

    // Architect creates a task; Engineer claims it.
    const created = await router.handle("create_task", { title: "T", description: "D" }, archCtx);
    taskId = JSON.parse(created.content[0].text).taskId;

    await router.handle("get_task", {}, engCtx);
    const task = await archCtx.stores.task.getTask(taskId);
    expect(task?.assignedEngineerId).toBe(agentId);

    // Engineer reports.
    await router.handle("create_report", {
      taskId,
      report: "Done",
      summary: "Ok",
    }, engCtx);
  });

  it("review_completed (approved) dispatches to the claimant's agentId (P2P)", async () => {
    const reviewCtx = createTestContext({ stores: archCtx.stores, sessionId: "sess-arch-2", role: "architect" });
    await register(reviewCtx, "architect", { team: "platform" });

    await router.handle("create_review", {
      taskId,
      assessment: "Great",
      decision: "approved",
    }, reviewCtx);

    const dispatched = reviewCtx.dispatchedEvents.find((e) => e.event === "review_completed");
    expect(dispatched).toBeDefined();
    // P2P: selector pins to the agentId, not to a role/label pool.
    expect(dispatched!.selector.agentId).toBe(agentId);
    expect(dispatched!.selector.roles).toBeUndefined();
    expect(dispatched!.selector.matchLabels).toBeUndefined();
  });

  it("revision_required (rejected, normal) also dispatches P2P to the same agentId", async () => {
    const reviewCtx = createTestContext({ stores: archCtx.stores, sessionId: "sess-arch-2", role: "architect" });
    await register(reviewCtx, "architect", { team: "platform" });

    await router.handle("create_review", {
      taskId,
      assessment: "Missing tests",
      decision: "rejected",
    }, reviewCtx);

    const dispatched = reviewCtx.dispatchedEvents.find((e) => e.event === "revision_required");
    expect(dispatched).toBeDefined();
    expect(dispatched!.selector.agentId).toBe(agentId);
  });

  it("director_attention_required (escalation) targets architects in the task's label scope, NOT P2P", async () => {
    // Force the task into a state where revisionCount >= 3.
    // revisionCount isn't user-facing, so mutate via the test-only escape hatch.
    await (archCtx.stores.task as TaskRepository).__debugSetTask(taskId, { revisionCount: 3 });

    const reviewCtx = createTestContext({ stores: archCtx.stores, sessionId: "sess-arch-2", role: "architect" });
    await register(reviewCtx, "architect", { team: "platform" });

    await router.handle("create_review", {
      taskId,
      assessment: "Too many attempts",
      decision: "rejected",
    }, reviewCtx);

    const dispatched = reviewCtx.dispatchedEvents.find((e) => e.event === "director_attention_required");
    expect(dispatched).toBeDefined();
    // Escalation broadcasts to architects in the label scope — not P2P.
    expect(dispatched!.selector.agentId).toBeUndefined();
    expect(dispatched!.selector.roles).toEqual(["architect"]);
    expect(dispatched!.selector.matchLabels).toEqual({ team: "platform" });
  });
});

describe("Mission-19 P2P — Clarification routes to assignedEngineerId", () => {
  let router: PolicyRouter;
  let archCtx: TestPolicyContext;
  let engCtx: TestPolicyContext;
  let taskId: string;
  let agentId: string;

  beforeEach(async () => {
    router = new PolicyRouter(noop);
    registerTaskPolicy(router);
    registerClarificationPolicy(router);
    registerSessionPolicy(router);

    archCtx = createTestContext({ sessionId: "sess-arch", role: "architect" });
    await register(archCtx, "architect", { team: "platform" });

    engCtx = createTestContext({
      stores: archCtx.stores,
      sessionId: "sess-eng",
      role: "engineer",
    });
    agentId = await register(engCtx, "engineer", { team: "platform" });

    const created = await router.handle("create_task", { title: "T", description: "D" }, archCtx);
    taskId = JSON.parse(created.content[0].text).taskId;
    await router.handle("get_task", {}, engCtx);

    // Engineer asks a clarification.
    await router.handle("create_clarification", {
      taskId,
      question: "Which API?",
    }, engCtx);
  });

  it("clarification_requested targets architects in the task's label scope (pool broadcast)", async () => {
    // Any architect in the scope should see it — we assert on the engCtx where it was dispatched.
    const requested = engCtx.dispatchedEvents.find((e) => e.event === "clarification_requested");
    expect(requested).toBeDefined();
    expect(requested!.selector.roles).toEqual(["architect"]);
    expect(requested!.selector.matchLabels).toEqual({ team: "platform" });
    expect(requested!.selector.agentId).toBeUndefined();
  });

  it("clarification_answered routes P2P back to the original asker", async () => {
    const answerCtx = createTestContext({ stores: archCtx.stores, sessionId: "sess-arch-2", role: "architect" });
    await register(answerCtx, "architect", { team: "platform" });

    await router.handle("resolve_clarification", {
      taskId,
      answer: "Use the REST API",
    }, answerCtx);

    const answered = answerCtx.dispatchedEvents.find((e) => e.event === "clarification_answered");
    expect(answered).toBeDefined();
    expect(answered!.selector.agentId).toBe(agentId);
  });
});

describe("Mission-19 P2P — Fallback when task has no assignedEngineerId", () => {
  let router: PolicyRouter;
  let archCtx: TestPolicyContext;

  beforeEach(async () => {
    router = new PolicyRouter(noop);
    registerTaskPolicy(router);
    registerReviewPolicy(router);
    registerSessionPolicy(router);

    archCtx = createTestContext({ sessionId: "sess-arch", role: "architect" });
    await register(archCtx, "architect", { team: "platform" });
  });

  it("review on a task that was never claimed through get_task falls back to label-scoped pool", async () => {
    // Direct store submission — no get_task, so assignedEngineerId stays null.
    const taskId = await archCtx.stores.task.submitDirective(
      "Done by hand",
      undefined, undefined, "T", "D", undefined,
      { team: "platform" },
    );
    // Move through the FSM manually: pending → working → in_review.
    await (archCtx.stores.task as TaskRepository).__debugSetTask(taskId, { status: "in_review" });
    // assignedEngineerId remains null.

    const reviewCtx = createTestContext({ stores: archCtx.stores, sessionId: "sess-arch-2", role: "architect" });
    await register(reviewCtx, "architect", { team: "platform" });

    await router.handle("create_review", {
      taskId,
      assessment: "Looks good",
      decision: "approved",
    }, reviewCtx);

    const dispatched = reviewCtx.dispatchedEvents.find((e) => e.event === "review_completed");
    expect(dispatched).toBeDefined();
    // No agentId pin — fell back to label-scoped pool.
    expect(dispatched!.selector.agentId).toBeUndefined();
    expect(dispatched!.selector.roles).toEqual(["engineer"]);
    expect(dispatched!.selector.matchLabels).toEqual({ team: "platform" });
  });
});
