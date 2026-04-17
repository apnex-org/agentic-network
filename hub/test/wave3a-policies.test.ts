/**
 * Wave 3a Policy Tests — Clarification, Review
 *
 * Tests the stateful FSM domain policies extracted in
 * The Great Decoupling T4. These modify task state.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../src/policy/router.js";
import { registerTaskPolicy } from "../src/policy/task-policy.js";
import { registerClarificationPolicy } from "../src/policy/clarification-policy.js";
import { registerReviewPolicy } from "../src/policy/review-policy.js";
import { createTestContext } from "../src/policy/test-utils.js";
import type { IPolicyContext } from "../src/policy/types.js";

const noop = () => {};

// Helper: create a task and pick it up (working state)
async function createWorkingTask(router: PolicyRouter, ctx: IPolicyContext): Promise<string> {
  await router.handle("create_task", {
    title: "Test task",
    description: "A task for testing",
  }, ctx);

  const engCtx = createTestContext({ role: "engineer", stores: ctx.stores, sessionId: "test-eng-session" });
  await router.handle("get_task", {}, engCtx);
  return "task-1";
}

// Helper: create a completed task (with report)
async function createCompletedTask(router: PolicyRouter, ctx: IPolicyContext): Promise<string> {
  const taskId = await createWorkingTask(router, ctx);
  const reportCtx = createTestContext({ role: "engineer", stores: ctx.stores, sessionId: "test-eng-session" });
  await router.handle("create_report", {
    taskId,
    report: "Done",
    summary: "Completed",
  }, reportCtx);
  return taskId;
}

// ── Clarification Policy ────────────────────────────────────────────

describe("ClarificationPolicy", () => {
  let router: PolicyRouter;
  let ctx: IPolicyContext;

  beforeEach(() => {
    router = new PolicyRouter(noop);
    registerTaskPolicy(router);
    registerClarificationPolicy(router);
    ctx = createTestContext();
  });

  it("registers all clarification tools", () => {
    expect(router.has("create_clarification")).toBe(true);
    expect(router.has("resolve_clarification")).toBe(true);
    expect(router.has("get_clarification")).toBe(true);
  });

  it("create_clarification transitions task to input_required", async () => {
    const taskId = await createWorkingTask(router, ctx);

    const clarCtx = createTestContext({ role: "engineer", stores: ctx.stores });
    const result = await router.handle("create_clarification", {
      taskId,
      question: "What format should the output be?",
    }, clarCtx);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.status).toBe("input_required");

    const emitted = (clarCtx as any).dispatchedEvents.find((e: any) => e.event === "clarification_requested");
    expect(emitted).toBeDefined();
    expect(emitted.selector.roles).toEqual(["architect"]);
  });

  it("create_clarification fails for non-working task", async () => {
    // task-999 doesn't exist
    const result = await router.handle("create_clarification", {
      taskId: "task-999",
      question: "Any question",
    }, ctx);
    expect(result.isError).toBe(true);
  });

  it("resolve_clarification transitions task back to working", async () => {
    const taskId = await createWorkingTask(router, ctx);

    // Request clarification (as engineer)
    const clarCtx = createTestContext({ role: "engineer", stores: ctx.stores, sessionId: "test-eng-session" });
    await router.handle("create_clarification", {
      taskId,
      question: "Which API?",
    }, clarCtx);

    // Resolve it (as architect — distinct session)
    const resolveCtx = createTestContext({ stores: ctx.stores, sessionId: "test-arch-session" });
    const result = await router.handle("resolve_clarification", {
      taskId,
      answer: "Use the REST API v2",
    }, resolveCtx);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.status).toBe("working");

    const emitted = (resolveCtx as any).dispatchedEvents.find((e: any) => e.event === "clarification_answered");
    expect(emitted).toBeDefined();
    expect(emitted.selector.roles).toEqual(["engineer"]);
  });

  it("resolve_clarification fails for non-input_required task", async () => {
    const result = await router.handle("resolve_clarification", {
      taskId: "task-999",
      answer: "Answer",
    }, ctx);
    expect(result.isError).toBe(true);
  });

  it("get_clarification returns question and answer", async () => {
    const taskId = await createWorkingTask(router, ctx);

    // Request clarification (as engineer)
    const clarCtx = createTestContext({ role: "engineer", stores: ctx.stores, sessionId: "test-eng-session" });
    await router.handle("create_clarification", {
      taskId,
      question: "How many retries?",
    }, clarCtx);

    // Check before answer (as engineer)
    const beforeCtx = createTestContext({ stores: ctx.stores, sessionId: "test-eng-session" });
    const before = await router.handle("get_clarification", { taskId }, beforeCtx);
    const beforeParsed = JSON.parse(before.content[0].text);
    expect(beforeParsed.question).toBe("How many retries?");
    expect(beforeParsed.answered).toBe(false);

    // Answer (as architect)
    const resolveCtx = createTestContext({ stores: ctx.stores, sessionId: "test-arch-session" });
    await router.handle("resolve_clarification", {
      taskId,
      answer: "3 retries",
    }, resolveCtx);

    // Check after answer (as engineer)
    const afterCtx = createTestContext({ stores: ctx.stores, sessionId: "test-eng-session" });
    const after = await router.handle("get_clarification", { taskId }, afterCtx);
    const afterParsed = JSON.parse(after.content[0].text);
    expect(afterParsed.answered).toBe(true);
    expect(afterParsed.answer).toBe("3 retries");
  });

  it("get_clarification returns error for non-existent task", async () => {
    const result = await router.handle("get_clarification", { taskId: "task-999" }, ctx);
    expect(result.isError).toBe(true);
  });
});

// ── Review Policy ───────────────────────────────────────────────────

describe("ReviewPolicy", () => {
  let router: PolicyRouter;
  let ctx: IPolicyContext;

  beforeEach(() => {
    router = new PolicyRouter(noop);
    registerTaskPolicy(router);
    registerReviewPolicy(router);
    ctx = createTestContext();
  });

  it("registers all review tools", () => {
    expect(router.has("create_review")).toBe(true);
    expect(router.has("get_review")).toBe(true);
  });

  it("create_review stores assessment and emits review_completed", async () => {
    const taskId = await createCompletedTask(router, ctx);

    const reviewCtx = createTestContext({ stores: ctx.stores, sessionId: "test-arch-session" });
    const result = await router.handle("create_review", {
      taskId,
      assessment: "Excellent work. All requirements met.",
    }, reviewCtx);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.reviewRef).toContain(taskId);

    const emitted = (reviewCtx as any).dispatchedEvents.find((e: any) => e.event === "review_completed");
    expect(emitted).toBeDefined();
    expect(emitted.selector.roles).toEqual(["engineer"]);
  });

  it("create_review fails for non-existent task", async () => {
    const result = await router.handle("create_review", {
      taskId: "task-999",
      assessment: "Review",
    }, ctx);
    expect(result.isError).toBe(true);
  });

  it("get_review returns stored assessment", async () => {
    const taskId = await createCompletedTask(router, ctx);

    // Store review (as architect)
    const reviewCtx = createTestContext({ stores: ctx.stores, sessionId: "test-arch-session" });
    await router.handle("create_review", {
      taskId,
      assessment: "Good work",
    }, reviewCtx);

    // Retrieve review (any role — get_review is [Any])
    const getCtx = createTestContext({ stores: ctx.stores, sessionId: "test-any-session" });
    const result = await router.handle("get_review", { taskId }, getCtx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.reviewed).toBe(true);
    expect(parsed.assessment).toBe("Good work");
  });

  it("get_review returns not-reviewed for unreviewed task", async () => {
    const result = await router.handle("get_review", { taskId: "task-999" }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.reviewed).toBe(false);
  });
});
