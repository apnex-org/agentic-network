/**
 * bug-112 — create_review must backfill reviewAssessment on a `completed`
 * task that was never reviewed.
 *
 * Mechanism (verified, not the bug's original filing): task-144 was force-
 * `completed` via an FSM-bypassing admin edit (gsutil, 2026-04-18). It never
 * travelled `in_review → completed` through submitReview, so `reviewAssessment`
 * was never written. `get_pending_actions` then counts such a task FOREVER —
 * its `unreadReports` + `unreviewedTasks` filters both match a task with a
 * terminal status + `report != null` + `!reviewAssessment`, so a single
 * unreviewed-`completed` task inflates `totalPending` by 2 (the phantom
 * "Pending actions: 2").
 *
 * Pre-fix, `create_review(approved)` on a `completed` task hit a pure no-op
 * idempotency branch — it never called submitReview, the only writer of
 * `reviewAssessment` — so there was no way to clear the phantom.
 *
 * These tests exercise the fix THROUGH the real `get_pending_actions`
 * computation (per architect review point 2): assert the task drops out of
 * `unreadReports` + `unreviewedTasks` and `totalPending` decrements.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../src/policy/router.js";
import { registerTaskPolicy } from "../src/policy/task-policy.js";
import { registerReviewPolicy } from "../src/policy/review-policy.js";
import { registerSystemPolicy } from "../src/policy/system-policy.js";
import { createTestContext, type TestPolicyContext } from "../src/policy/test-utils.js";

const noop = () => {};

function parse(result: { content: { text: string }[] }): any {
  return JSON.parse(result.content[0]!.text);
}

/**
 * Drive a task to `in_review` with a report (the normal flow), then seed the
 * FSM-bypassed shape — `status: completed` with `reviewAssessment` still
 * unset. That shape is unreachable through the public store API (submitReview
 * always writes `reviewAssessment` alongside `status: completed`), so it is
 * seeded directly via the substrate — exactly the task-144 anomaly.
 */
async function seedUnreviewedCompletedTask(
  router: PolicyRouter,
  ctx: TestPolicyContext,
): Promise<string> {
  await router.handle("create_task", { title: "task-144 shape", description: "FSM-bypassed completed task" }, ctx);
  const [created] = await ctx.stores.task.listTasks();
  const taskId = created!.id;

  // engineer picks it up (→ working) then reports (→ in_review, report set)
  const engCtx = createTestContext({ role: "engineer", stores: ctx.stores, sessionId: "test-eng" });
  await router.handle("get_task", {}, engCtx);
  await router.handle("create_report", { taskId, report: "work done", summary: "done" }, engCtx);

  // FSM-bypass: force `completed` while leaving reviewAssessment unset.
  const inReview = await ctx.stores.task.getTask(taskId);
  expect(inReview?.status).toBe("in_review");
  expect(inReview?.report).not.toBeNull();
  expect(inReview?.reviewAssessment ?? null).toBeNull();
  await ctx.substrate.put("Task", { ...inReview, status: "completed" });

  return taskId;
}

describe("bug-112 — create_review backfills reviewAssessment on an unreviewed completed task", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;

  beforeEach(() => {
    router = new PolicyRouter(noop);
    registerTaskPolicy(router);
    registerReviewPolicy(router);
    registerSystemPolicy(router);
    ctx = createTestContext();
  });

  it("clears the get_pending_actions phantom — task drops from unreadReports + unreviewedTasks", async () => {
    const taskId = await seedUnreviewedCompletedTask(router, ctx);

    // Before: the unreviewed `completed` task is the phantom — counted twice.
    const before = parse(await router.handle("get_pending_actions", {}, ctx));
    expect(before.unreadReports.map((r: any) => r.taskId)).toContain(taskId);
    expect(before.unreviewedTasks.map((t: any) => t.taskId)).toContain(taskId);
    expect(before.totalPending).toBe(2);

    // create_review(approved) must now backfill, not no-op.
    const review = parse(await router.handle("create_review", {
      taskId,
      assessment: "Retroactive approval — closing the bug-112 phantom.",
      decision: "approved",
    }, ctx));
    expect(review.success).toBe(true);
    expect(review.retroactive).toBe(true);
    expect(review.status).toBe("completed");

    // After: the task is gone from BOTH lists; totalPending decremented by 2.
    const after = parse(await router.handle("get_pending_actions", {}, ctx));
    expect(after.unreadReports.map((r: any) => r.taskId)).not.toContain(taskId);
    expect(after.unreviewedTasks.map((t: any) => t.taskId)).not.toContain(taskId);
    expect(after.totalPending).toBe(0);

    // The assessment was actually persisted on the entity.
    const task = await ctx.stores.task.getTask(taskId);
    expect(task?.reviewAssessment).toBe("Retroactive approval — closing the bug-112 phantom.");
    expect(task?.status).toBe("completed");
  });

  it("is idempotent on re-run — second create_review is a no-op, not a re-backfill", async () => {
    const taskId = await seedUnreviewedCompletedTask(router, ctx);

    const first = parse(await router.handle("create_review", { taskId, assessment: "first", decision: "approved" }, ctx));
    expect(first.retroactive).toBe(true);

    // Second call: the task now HAS a reviewAssessment → genuine idempotent no-op.
    const second = parse(await router.handle("create_review", { taskId, assessment: "second", decision: "approved" }, ctx));
    expect(second.success).toBe(true);
    expect(second.idempotent).toBe(true);
    expect(second.retroactive).toBeUndefined();

    // The no-op did NOT overwrite the first assessment.
    const task = await ctx.stores.task.getTask(taskId);
    expect(task?.reviewAssessment).toBe("first");

    const pending = parse(await router.handle("get_pending_actions", {}, ctx));
    expect(pending.totalPending).toBe(0);
  });
});
