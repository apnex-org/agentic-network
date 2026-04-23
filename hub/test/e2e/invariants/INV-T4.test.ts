/**
 * INV-T4 — Task terminal states (completed, failed, escalated, cancelled)
 * have no outbound transitions.
 *
 * workflow-registry.md §7.2. Ratified Wave-2 subset per
 * `docs/missions/mission-41-kickoff-decisions.md` §Decision 1.
 *
 * Mission-41 Wave 2 — task-329.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestOrchestrator } from "../orchestrator.js";
import { assertInvT4 } from "../invariant-helpers.js";

describe("INV-T4 — task terminal states have no outbound transitions", () => {
  let orch: TestOrchestrator;

  beforeEach(() => {
    orch = TestOrchestrator.create();
  });

  it("helper coverage (cancelled terminal): assertInvT4 all modes pass", async () => {
    await expect(assertInvT4(orch, "all")).resolves.toBeUndefined();
  });

  it("completed is terminal — can't re-report + can't cancel", async () => {
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();

    // Full lifecycle → completed.
    await arch.createTask("T4 completed-terminal", "lifecycle to completion");
    await eng.getTask();
    await eng.createReport("task-1", "done", "done");
    // Task is now in_review. Approve → completed.
    await arch.createReview("task-1", "LGTM", "approved");

    // Verify status reached completed.
    const task = await orch.stores.task.getTask("task-1");
    expect(task?.status).toBe("completed");

    // Attempt outbound transitions — each should be rejected by the FSM.
    const reReport = await eng.call("create_report", {
      taskId: "task-1", report: "second report", summary: "blocked",
    });
    expect(reReport.isError).toBe(true);

    const cancel = await arch.call("cancel_task", { taskId: "task-1" });
    expect(cancel.isError).toBe(true);
  });

  it("escalated is terminal — can't re-report + can't cancel", async () => {
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();

    // Drive through 3 full report→reject cycles, fourth reject hits
    // circuit-breaker and escalates (revisionCount >= 3 at time of 4th
    // decision). Each rejection takes task in_review → working; next
    // report puts it back in_review.
    await arch.createTask("T4 escalated-terminal", "three strikes");
    await eng.getTask();

    // Cycle 1: report → rejected (revisionCount 0 → 1)
    await eng.createReport("task-1", "v1", "v1");
    await arch.createReview("task-1", "needs revision 1", "rejected");

    // Cycle 2: report → rejected (1 → 2)
    await eng.createReport("task-1", "v2", "v2");
    await arch.createReview("task-1", "needs revision 2", "rejected");

    // Cycle 3: report → rejected (2 → 3)
    await eng.createReport("task-1", "v3", "v3");
    await arch.createReview("task-1", "needs revision 3", "rejected");

    // Cycle 4: report → rejected — revisionCount is now 3, so this
    // rejection triggers escalation (in_review → escalated).
    await eng.createReport("task-1", "v4", "v4");
    await arch.createReview("task-1", "exceeded revision budget", "rejected");

    const task = await orch.stores.task.getTask("task-1");
    expect(task?.status).toBe("escalated");

    // Attempt outbound transitions.
    const reReport = await eng.call("create_report", {
      taskId: "task-1", report: "retry", summary: "blocked",
    });
    expect(reReport.isError).toBe(true);

    const cancel = await arch.call("cancel_task", { taskId: "task-1" });
    expect(cancel.isError).toBe(true);
  });

  it("failed is terminal — can't re-report + can't cancel (direct-mutation setup)", async () => {
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();

    // `failed` is only reachable via cascade failure in production (see
    // hub/src/policy/cascade.ts:98 + siblings). No policy-router FSM
    // transition path exists, so test-only direct store mutation is the
    // pragmatic way to reach this terminal state for invariant coverage.
    await arch.createTask("T4 failed-terminal", "force failed state");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storeInternals = (orch.stores.task as any).tasks as Map<string, { status: string; updatedAt: string }>;
    const taskRec = storeInternals.get("task-1");
    expect(taskRec).toBeDefined();
    taskRec!.status = "failed";
    taskRec!.updatedAt = new Date().toISOString();

    // Verify terminal.
    const task = await orch.stores.task.getTask("task-1");
    expect(task?.status).toBe("failed");

    // Register engineer (get_task would try to pick up the task, but it's
    // in `failed` not `pending`, so it'd return null — we want to attempt
    // create_report directly).
    await eng.listTasks();
    const reReport = await eng.call("create_report", {
      taskId: "task-1", report: "retry on failed", summary: "blocked",
    });
    expect(reReport.isError).toBe(true);

    const cancel = await arch.call("cancel_task", { taskId: "task-1" });
    expect(cancel.isError).toBe(true);
  });

  it("cancelled is terminal — canonical coverage (complements helper's assertInvT4)", async () => {
    // The assertInvT4 helper already exercises cancel-on-pending (positive)
    // + report-on-cancelled (negativeReject) + double-cancel (edge). This
    // test pins the specific FSM-error text shape that operators read in
    // failure logs — so future error-message refactors surface via this
    // test rather than via downstream diagnosis confusion.
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();
    await arch.createTask("T4 cancelled shape", "operator-diagnosable");
    await arch.call("cancel_task", { taskId: "task-1" });

    const reReport = await eng.call("create_report", {
      taskId: "task-1", report: "after cancel", summary: "blocked",
    });
    expect(reReport.isError).toBe(true);
    const parsed = JSON.parse(reReport.content[0].text);
    expect(parsed.error).toMatch(/Invalid state transition/);
    expect(parsed.error).toMatch(/cancelled/);
  });
});
