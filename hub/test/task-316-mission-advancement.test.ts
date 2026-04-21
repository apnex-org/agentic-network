/**
 * task-316 / idea-144 Path A — Mission advancement cascade tests.
 *
 * Covers the 4-cell review-outcome matrix ratified on thread-241 +
 * revision-loop FSMs ratified on thread-242:
 *
 *   | outcome             | mission-linked                | standalone                  |
 *   |---------------------|-------------------------------|-----------------------------|
 *   | approved            | advance next plannedTask      | dispatch review_available   |
 *   | revision_required   | dispatch address_feedback     | dispatch address_feedback   |
 *
 * Plus: schema extensions (Mission.plannedTasks, Review decision enum
 * alias); multi-task end-to-end traversal; revision-required remediation
 * loop; cascade_failed + Director notification on failure.
 *
 * Thread-241: https://... (Option X ratification; binary decision enum)
 * Thread-242: v1 FSMs (in_review→working on revision_required;
 *             report replace-on-resubmit; review mutate-in-place).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../src/policy/router.js";
import { registerTaskPolicy } from "../src/policy/task-policy.js";
import { registerReviewPolicy } from "../src/policy/review-policy.js";
import { registerMissionPolicy } from "../src/policy/mission-policy.js";
import { createTestContext } from "../src/policy/test-utils.js";
import { findNextUnissuedPlannedTask } from "../src/entities/mission.js";
import type { TestPolicyContext } from "../src/policy/test-utils.js";

const noop = () => {};

function makeRouter(): PolicyRouter {
  const router = new PolicyRouter(noop);
  registerTaskPolicy(router);
  registerReviewPolicy(router);
  registerMissionPolicy(router);
  return router;
}

function parse(result: { content: { text: string }[] }): Record<string, unknown> {
  return JSON.parse(result.content[0].text);
}

describe("task-316: Mission.plannedTasks schema", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;

  beforeEach(() => {
    router = makeRouter();
    ctx = createTestContext();
  });

  it("create_mission accepts plannedTasks + normalizes to unissued", async () => {
    const result = await router.handle("create_mission", {
      title: "Test mission",
      description: "Desc",
      plannedTasks: [
        { sequence: 1, title: "T1", description: "D1" },
        { sequence: 2, title: "T2", description: "D2" },
      ],
    }, ctx);
    expect(result.isError).toBeUndefined();
    const parsed = parse(result);
    expect(parsed.plannedTasks).toBeDefined();
    const pts = parsed.plannedTasks as Array<{ status: string; issuedTaskId: string | null }>;
    expect(pts).toHaveLength(2);
    expect(pts[0].status).toBe("unissued");
    expect(pts[1].status).toBe("unissued");
    expect(pts[0].issuedTaskId).toBeNull();
  });

  it("create_mission without plannedTasks leaves field undefined (pre-task-316 behavior)", async () => {
    const result = await router.handle("create_mission", {
      title: "Legacy mission",
      description: "No plan",
    }, ctx);
    const parsed = parse(result);
    expect(parsed.plannedTasks).toBeUndefined();
  });

  it("update_mission replaces plannedTasks wholesale with normalized values", async () => {
    const created = await router.handle("create_mission", { title: "M1", description: "D" }, ctx);
    const missionId = (parse(created) as { missionId: string }).missionId;
    const updated = await router.handle("update_mission", {
      missionId,
      plannedTasks: [{ sequence: 1, title: "NewT", description: "NewD" }],
    }, ctx);
    const parsed = parse(updated);
    const pts = parsed.plannedTasks as Array<{ status: string }>;
    expect(pts).toHaveLength(1);
    expect(pts[0].status).toBe("unissued");
  });

  it("normalizes caller-supplied issued/completed status back to unissued on input", async () => {
    // Callers shouldn't drive advancement bookkeeping via direct inputs;
    // the cascade owns that. If a caller attempts to pre-set "issued",
    // the normalizer clamps back to "unissued".
    const result = await router.handle("create_mission", {
      title: "M",
      description: "D",
      plannedTasks: [
        { sequence: 1, title: "T", description: "D", status: "completed", issuedTaskId: "task-99" },
      ],
    }, ctx);
    const pts = (parse(result).plannedTasks as Array<{ status: string; issuedTaskId: string | null }>);
    expect(pts[0].status).toBe("unissued");
    expect(pts[0].issuedTaskId).toBeNull();
  });
});

describe("task-316: findNextUnissuedPlannedTask pure helper", () => {
  it("returns null on missing or empty plannedTasks", () => {
    expect(findNextUnissuedPlannedTask(undefined)).toBeNull();
    expect(findNextUnissuedPlannedTask([])).toBeNull();
  });

  it("returns the lowest-sequence unissued slot", () => {
    const slots = [
      { sequence: 3, title: "C", description: "", status: "unissued" as const },
      { sequence: 1, title: "A", description: "", status: "issued" as const },
      { sequence: 2, title: "B", description: "", status: "unissued" as const },
    ];
    const next = findNextUnissuedPlannedTask(slots);
    expect(next?.sequence).toBe(2);
    expect(next?.title).toBe("B");
  });

  it("returns null when all slots are issued or completed", () => {
    const slots = [
      { sequence: 1, title: "A", description: "", status: "completed" as const },
      { sequence: 2, title: "B", description: "", status: "issued" as const },
    ];
    expect(findNextUnissuedPlannedTask(slots)).toBeNull();
  });
});

describe("task-316: store FSM transitions for plannedTasks", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;

  beforeEach(() => {
    router = makeRouter();
    ctx = createTestContext();
  });

  it("markPlannedTaskIssued flips unissued → issued exactly once (idempotent rejection on double-call)", async () => {
    const created = await router.handle("create_mission", {
      title: "M",
      description: "D",
      plannedTasks: [{ sequence: 1, title: "A", description: "Adesc" }],
    }, ctx);
    const missionId = (parse(created) as { missionId: string }).missionId;

    const first = await ctx.stores.mission.markPlannedTaskIssued(missionId, 1, "task-77");
    expect(first?.status).toBe("issued");
    expect(first?.issuedTaskId).toBe("task-77");

    // Second call on the same (already issued) slot returns null.
    const second = await ctx.stores.mission.markPlannedTaskIssued(missionId, 1, "task-88");
    expect(second).toBeNull();
  });

  it("markPlannedTaskCompleted flips issued → completed keyed on issuedTaskId", async () => {
    const created = await router.handle("create_mission", {
      title: "M",
      description: "D",
      plannedTasks: [{ sequence: 1, title: "A", description: "Adesc" }],
    }, ctx);
    const missionId = (parse(created) as { missionId: string }).missionId;
    await ctx.stores.mission.markPlannedTaskIssued(missionId, 1, "task-77");

    const completed = await ctx.stores.mission.markPlannedTaskCompleted(missionId, "task-77");
    expect(completed?.status).toBe("completed");
  });

  it("markPlannedTaskCompleted returns null for non-plannedTask taskIds (standalone)", async () => {
    const created = await router.handle("create_mission", {
      title: "M",
      description: "D",
      plannedTasks: [{ sequence: 1, title: "A", description: "Adesc" }],
    }, ctx);
    const missionId = (parse(created) as { missionId: string }).missionId;

    const result = await ctx.stores.mission.markPlannedTaskCompleted(missionId, "task-doesnt-exist");
    expect(result).toBeNull();
  });
});

describe("task-316: Review decision enum — revision_required alias", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;

  beforeEach(async () => {
    router = makeRouter();
    ctx = createTestContext();
    // Bootstrap a task in in_review state
    await router.handle("create_task", { title: "T", description: "D" }, ctx);
    // Internal mutation (test-pattern): bypass FSM to pre-stage "working"
    {
      const internal = (ctx.stores.task as unknown as { tasks: Map<string, { status: string }> }).tasks;
      const t = internal.get("task-1");
      if (t) t.status = "working";
    }
    await router.handle("create_report", { taskId: "task-1", report: "R", summary: "S" }, ctx);
  });

  it("accepts canonical 'revision_required' enum value", async () => {
    const result = await router.handle("create_review", {
      taskId: "task-1",
      assessment: "Needs revision",
      decision: "revision_required",
    }, ctx);
    expect(result.isError).toBeUndefined();
    const parsed = parse(result);
    expect(parsed.decision).toBe("rejected"); // internal alias
    expect(parsed.status).toBe("working");
  });

  it("still accepts legacy 'rejected' alias (backward-compat)", async () => {
    const result = await router.handle("create_review", {
      taskId: "task-1",
      assessment: "Needs revision",
      decision: "rejected",
    }, ctx);
    expect(result.isError).toBeUndefined();
    const parsed = parse(result);
    expect(parsed.status).toBe("working");
  });

  it("intent='address_feedback' on revision_required dispatch payload", async () => {
    await router.handle("create_review", {
      taskId: "task-1",
      assessment: "fix",
      decision: "revision_required",
    }, ctx);
    const revisionEvent = ctx.dispatchedEvents.find((e) => e.event === "revision_required");
    expect(revisionEvent).toBeDefined();
    expect(revisionEvent?.data.intent).toBe("address_feedback");
    expect(revisionEvent?.data.decision).toBe("revision_required");
  });

  it("intent='review_available' on approved review_completed dispatch", async () => {
    await router.handle("create_review", {
      taskId: "task-1",
      assessment: "ok",
      decision: "approved",
    }, ctx);
    const reviewEvent = ctx.dispatchedEvents.find((e) => e.event === "review_completed");
    expect(reviewEvent).toBeDefined();
    expect(reviewEvent?.data.intent).toBe("review_available");
  });
});

describe("task-316: 4-cell review-outcome cascade matrix", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;

  beforeEach(() => {
    router = makeRouter();
    ctx = createTestContext();
  });

  async function createMissionWithPlan(plan: Array<{ sequence: number; title: string; description: string }>): Promise<string> {
    const created = await router.handle("create_mission", {
      title: "M",
      description: "D",
      plannedTasks: plan,
    }, ctx);
    return (parse(created) as { missionId: string }).missionId;
  }

  async function spawnStandaloneTaskInReview(): Promise<string> {
    await router.handle("create_task", { title: "Standalone", description: "desc" }, ctx);
    const taskId = `task-${ctx.stores.task.listTasks().then((ts) => ts.length)}`; // best-effort; tests will use listTasks
    // Simpler — grab via listTasks
    const tasks = await ctx.stores.task.listTasks();
    const latest = tasks[tasks.length - 1];
    // Internal mutation (test-pattern): bypass FSM to pre-stage "working"
    const internal = (ctx.stores.task as unknown as { tasks: Map<string, { status: string }> }).tasks;
    const t = internal.get(latest.id);
    if (t) t.status = "working";
    await router.handle("create_report", { taskId: latest.id, report: "r", summary: "s" }, ctx);
    return latest.id;
  }

  async function spawnMissionLinkedTaskInReview(missionId: string, slotIndex = 0): Promise<string> {
    // Direct-spawn a task with correlationId=missionId AND attach it
    // to the plannedTask slot to mimic a cascade-issued directive.
    const missionBefore = await ctx.stores.mission.getMission(missionId);
    const slot = missionBefore?.plannedTasks?.[slotIndex];
    if (!slot) throw new Error("no plannedTask at slotIndex");
    const taskId = await ctx.stores.task.submitDirective(
      slot.description,
      missionId,
      undefined,
      slot.title,
      slot.description,
    );
    await ctx.stores.mission.markPlannedTaskIssued(missionId, slot.sequence, taskId);
    // Internal mutation (test-pattern): bypass FSM to pre-stage "working"
    {
      const internal = (ctx.stores.task as unknown as { tasks: Map<string, { status: string }> }).tasks;
      const t = internal.get(taskId);
      if (t) t.status = "working";
    }
    await router.handle("create_report", { taskId, report: "r", summary: "s" }, ctx);
    return taskId;
  }

  // ── Cell 1: approved + mission-linked → advancement fires ────────────
  it("cell 1 (approved + mission-linked) issues next plannedTask as new Task", async () => {
    const missionId = await createMissionWithPlan([
      { sequence: 1, title: "T1", description: "D1" },
      { sequence: 2, title: "T2", description: "D2" },
    ]);
    const firstTaskId = await spawnMissionLinkedTaskInReview(missionId);

    await router.handle("create_review", {
      taskId: firstTaskId,
      assessment: "good work",
      decision: "approved",
    }, ctx);

    // Assert: plannedTask[1] (the completed one) is completed
    const missionAfter = await ctx.stores.mission.getMission(missionId);
    const slot1 = missionAfter?.plannedTasks?.find((p) => p.sequence === 1);
    const slot2 = missionAfter?.plannedTasks?.find((p) => p.sequence === 2);
    expect(slot1?.status).toBe("completed");
    expect(slot2?.status).toBe("issued");
    expect(slot2?.issuedTaskId).toBeTruthy();

    // Assert: new Task was spawned with correlationId=mission.id
    const tasks = await ctx.stores.task.listTasks();
    const newTask = tasks.find((t) => t.id === slot2?.issuedTaskId);
    expect(newTask).toBeDefined();
    expect(newTask?.correlationId).toBe(missionId);
    expect(newTask?.title).toBe("T2");

    // Assert: task_issued dispatched for the new Task
    const issued = ctx.dispatchedEvents.find(
      (e) => e.event === "task_issued" && (e.data as { taskId: string }).taskId === slot2?.issuedTaskId,
    );
    expect(issued).toBeDefined();

    // Assert: mission_advancement_cascade audit
    const auditEntries = await ctx.stores.audit.listEntries();
    const cascadeAudit = auditEntries.find((a) => a.action === "mission_advancement_cascade");
    expect(cascadeAudit).toBeDefined();
    expect(cascadeAudit?.relatedEntity).toBe(missionId);
  });

  // ── Cell 2: approved + standalone → no advancement, review_available dispatch ──
  it("cell 2 (approved + standalone) dispatches review_available, no advancement", async () => {
    const taskId = await spawnStandaloneTaskInReview();

    await router.handle("create_review", {
      taskId,
      assessment: "good",
      decision: "approved",
    }, ctx);

    // Assert: no new Task spawned beyond the original
    const tasks = await ctx.stores.task.listTasks();
    const newTasks = tasks.filter((t) => t.id !== taskId);
    expect(newTasks).toHaveLength(0);

    // Assert: review_completed dispatched with review_available intent
    const reviewEvent = ctx.dispatchedEvents.find((e) => e.event === "review_completed");
    expect(reviewEvent).toBeDefined();
    expect(reviewEvent?.data.intent).toBe("review_available");

    // Assert: no mission_advancement_cascade audit (not mission-linked)
    const auditEntries = await ctx.stores.audit.listEntries();
    expect(auditEntries.find((a) => a.action === "mission_advancement_cascade")).toBeUndefined();
  });

  // ── Cell 3: revision_required + mission-linked → no advancement, address_feedback dispatch ──
  it("cell 3 (revision_required + mission-linked) blocks advancement, dispatches address_feedback", async () => {
    const missionId = await createMissionWithPlan([
      { sequence: 1, title: "T1", description: "D1" },
      { sequence: 2, title: "T2", description: "D2" },
    ]);
    const firstTaskId = await spawnMissionLinkedTaskInReview(missionId);

    await router.handle("create_review", {
      taskId: firstTaskId,
      assessment: "fix this",
      decision: "revision_required",
    }, ctx);

    // Assert: plannedTask slot 1 is still `issued`, not completed
    const missionAfter = await ctx.stores.mission.getMission(missionId);
    const slot1 = missionAfter?.plannedTasks?.find((p) => p.sequence === 1);
    const slot2 = missionAfter?.plannedTasks?.find((p) => p.sequence === 2);
    expect(slot1?.status).toBe("issued");
    expect(slot2?.status).toBe("unissued"); // second task NOT auto-issued

    // Assert: task flipped back to working
    const t = await ctx.stores.task.getTask(firstTaskId);
    expect(t?.status).toBe("working");

    // Assert: address_feedback dispatched
    const revision = ctx.dispatchedEvents.find((e) => e.event === "revision_required");
    expect(revision).toBeDefined();
    expect(revision?.data.intent).toBe("address_feedback");
  });

  // ── Cell 4: revision_required + standalone → no advancement, address_feedback dispatch ──
  it("cell 4 (revision_required + standalone) dispatches address_feedback, flips task to working", async () => {
    const taskId = await spawnStandaloneTaskInReview();

    await router.handle("create_review", {
      taskId,
      assessment: "fix",
      decision: "revision_required",
    }, ctx);

    const t = await ctx.stores.task.getTask(taskId);
    expect(t?.status).toBe("working");

    const revision = ctx.dispatchedEvents.find((e) => e.event === "revision_required");
    expect(revision).toBeDefined();
    expect(revision?.data.intent).toBe("address_feedback");
  });
});

describe("task-316: multi-task mission traversal (end-to-end)", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;

  beforeEach(() => {
    router = makeRouter();
    ctx = createTestContext();
  });

  it("3-task mission auto-traverses on sequential approved reviews, no nudges needed", async () => {
    const created = await router.handle("create_mission", {
      title: "Multi-task mission",
      description: "d",
      plannedTasks: [
        { sequence: 1, title: "Step A", description: "Do A" },
        { sequence: 2, title: "Step B", description: "Do B" },
        { sequence: 3, title: "Step C", description: "Do C" },
      ],
    }, ctx);
    const missionId = (parse(created) as { missionId: string }).missionId;

    // Issue the first task manually (as the architect would initially)
    const firstTaskId = await ctx.stores.task.submitDirective(
      "Do A",
      missionId,
      undefined,
      "Step A",
      "Do A",
    );
    await ctx.stores.mission.markPlannedTaskIssued(missionId, 1, firstTaskId);
    // Internal mutation (test-pattern): bypass FSM to pre-stage "working"
    {
      const internal = (ctx.stores.task as unknown as { tasks: Map<string, { status: string }> }).tasks;
      const t = internal.get(firstTaskId);
      if (t) t.status = "working";
    }
    await router.handle("create_report", { taskId: firstTaskId, report: "r", summary: "s" }, ctx);

    // Approve → cascade should spawn Step B
    await router.handle("create_review", { taskId: firstTaskId, assessment: "ok", decision: "approved" }, ctx);
    const missionAfterA = await ctx.stores.mission.getMission(missionId);
    const slotB = missionAfterA?.plannedTasks?.find((p) => p.sequence === 2);
    expect(slotB?.status).toBe("issued");
    const stepBTaskId = slotB!.issuedTaskId!;

    // Step B: report + approve → cascade spawns Step C
    // Internal mutation (test-pattern): bypass FSM to pre-stage "working"
    {
      const internal = (ctx.stores.task as unknown as { tasks: Map<string, { status: string }> }).tasks;
      const t = internal.get(stepBTaskId);
      if (t) t.status = "working";
    }
    await router.handle("create_report", { taskId: stepBTaskId, report: "r", summary: "s" }, ctx);
    await router.handle("create_review", { taskId: stepBTaskId, assessment: "ok", decision: "approved" }, ctx);
    const missionAfterB = await ctx.stores.mission.getMission(missionId);
    const slotC = missionAfterB?.plannedTasks?.find((p) => p.sequence === 3);
    expect(slotC?.status).toBe("issued");
    const stepCTaskId = slotC!.issuedTaskId!;

    // Step C: last task — approve, ensure no further spawn + no error
    // Internal mutation (test-pattern): bypass FSM to pre-stage "working"
    {
      const internal = (ctx.stores.task as unknown as { tasks: Map<string, { status: string }> }).tasks;
      const t = internal.get(stepCTaskId);
      if (t) t.status = "working";
    }
    await router.handle("create_report", { taskId: stepCTaskId, report: "r", summary: "s" }, ctx);
    await router.handle("create_review", { taskId: stepCTaskId, assessment: "ok", decision: "approved" }, ctx);

    const missionFinal = await ctx.stores.mission.getMission(missionId);
    expect(missionFinal?.plannedTasks?.every((p) => p.status === "completed")).toBe(true);

    // Count mission_advancement_cascade audits — should fire exactly twice
    // (on first→second spawn, second→third spawn). Third approval has no
    // next plannedTask so no advancement audit.
    const audits = await ctx.stores.audit.listEntries();
    const cascadeAudits = audits.filter((a) => a.action === "mission_advancement_cascade");
    expect(cascadeAudits).toHaveLength(2);
  });
});

describe("task-316: revision-required remediation loop", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;

  beforeEach(() => {
    router = makeRouter();
    ctx = createTestContext();
  });

  it("revision_required → replace report → approved cycles correctly with advancement at the end", async () => {
    const created = await router.handle("create_mission", {
      title: "M",
      description: "d",
      plannedTasks: [
        { sequence: 1, title: "A", description: "Adesc" },
        { sequence: 2, title: "B", description: "Bdesc" },
      ],
    }, ctx);
    const missionId = (parse(created) as { missionId: string }).missionId;

    const taskAId = await ctx.stores.task.submitDirective("Adesc", missionId, undefined, "A", "Adesc");
    await ctx.stores.mission.markPlannedTaskIssued(missionId, 1, taskAId);
    // Internal mutation (test-pattern): bypass FSM to pre-stage "working"
    {
      const internal = (ctx.stores.task as unknown as { tasks: Map<string, { status: string }> }).tasks;
      const t = internal.get(taskAId);
      if (t) t.status = "working";
    }
    await router.handle("create_report", { taskId: taskAId, report: "v1", summary: "s1" }, ctx);

    // First review: revision_required → task back to working, plannedTask[1] stays `issued`
    await router.handle("create_review", {
      taskId: taskAId,
      assessment: "fix",
      decision: "revision_required",
    }, ctx);
    let tA = await ctx.stores.task.getTask(taskAId);
    expect(tA?.status).toBe("working");
    expect(tA?.revisionCount).toBe(1);

    let missionDuring = await ctx.stores.mission.getMission(missionId);
    expect(missionDuring?.plannedTasks?.[0].status).toBe("issued");
    expect(missionDuring?.plannedTasks?.[1].status).toBe("unissued"); // NOT advanced

    // Engineer revises report → submitReport replaces on same taskId (FSM-2)
    await router.handle("create_report", { taskId: taskAId, report: "v2", summary: "s2-revised" }, ctx);
    tA = await ctx.stores.task.getTask(taskAId);
    expect(tA?.status).toBe("in_review");
    expect(tA?.reportSummary).toBe("s2-revised");

    // Second review: approved → advancement fires now
    await router.handle("create_review", {
      taskId: taskAId,
      assessment: "ok now",
      decision: "approved",
    }, ctx);
    const missionFinal = await ctx.stores.mission.getMission(missionId);
    expect(missionFinal?.plannedTasks?.[0].status).toBe("completed");
    expect(missionFinal?.plannedTasks?.[1].status).toBe("issued");
  });
});

describe("task-316: cascade_failed robustness", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;

  beforeEach(() => {
    router = makeRouter();
    ctx = createTestContext();
  });

  it("primary review approval succeeds even if advancement cascade throws; Director notified", async () => {
    const created = await router.handle("create_mission", {
      title: "M",
      description: "d",
      plannedTasks: [
        { sequence: 1, title: "A", description: "Ad" },
        { sequence: 2, title: "B", description: "Bd" },
      ],
    }, ctx);
    const missionId = (parse(created) as { missionId: string }).missionId;

    const taskAId = await ctx.stores.task.submitDirective("Ad", missionId, undefined, "A", "Ad");
    await ctx.stores.mission.markPlannedTaskIssued(missionId, 1, taskAId);
    // Internal mutation (test-pattern): bypass FSM to pre-stage "working"
    {
      const internal = (ctx.stores.task as unknown as { tasks: Map<string, { status: string }> }).tasks;
      const t = internal.get(taskAId);
      if (t) t.status = "working";
    }
    await router.handle("create_report", { taskId: taskAId, report: "r", summary: "s" }, ctx);

    // Inject a failure: stub submitDirective to throw on the cascade's
    // second call. The first call already happened above (setting up
    // taskA), so we swap the method now.
    const originalSubmit = ctx.stores.task.submitDirective.bind(ctx.stores.task);
    let cascadeCalled = false;
    (ctx.stores.task as unknown as { submitDirective: typeof originalSubmit }).submitDirective = async (...args: Parameters<typeof originalSubmit>) => {
      cascadeCalled = true;
      throw new Error("simulated cascade failure");
    };

    const result = await router.handle("create_review", {
      taskId: taskAId,
      assessment: "ok",
      decision: "approved",
    }, ctx);

    // Primary review succeeded (task is completed)
    expect(result.isError).toBeUndefined();
    const tA = await ctx.stores.task.getTask(taskAId);
    expect(tA?.status).toBe("completed");

    // Cascade was attempted
    expect(cascadeCalled).toBe(true);

    // Director notification fired with source=cascade_failed
    const notifications = await ctx.stores.directorNotification.list({});
    const cascadeFailed = notifications.find((n) => n.source === "cascade_failed" && n.sourceRef === taskAId);
    expect(cascadeFailed).toBeDefined();
    expect(cascadeFailed?.severity).toBe("warning");

    // Audit entry with action=cascade_failed
    const audits = await ctx.stores.audit.listEntries();
    const failedAudit = audits.find((a) => a.action === "cascade_failed" && a.relatedEntity === taskAId);
    expect(failedAudit).toBeDefined();

    // Restore
    (ctx.stores.task as unknown as { submitDirective: typeof originalSubmit }).submitDirective = originalSubmit;
  });

  it("approved review on mission without plannedTasks is a no-op cascade (no error, no spawn)", async () => {
    const created = await router.handle("create_mission", { title: "M", description: "d" }, ctx);
    const missionId = (parse(created) as { missionId: string }).missionId;

    const taskAId = await ctx.stores.task.submitDirective("d", missionId, undefined, "A", "d");
    // Internal mutation (test-pattern): bypass FSM to pre-stage "working"
    {
      const internal = (ctx.stores.task as unknown as { tasks: Map<string, { status: string }> }).tasks;
      const t = internal.get(taskAId);
      if (t) t.status = "working";
    }
    await router.handle("create_report", { taskId: taskAId, report: "r", summary: "s" }, ctx);

    const result = await router.handle("create_review", {
      taskId: taskAId,
      assessment: "ok",
      decision: "approved",
    }, ctx);
    expect(result.isError).toBeUndefined();

    // No cascade audit, no extra tasks
    const audits = await ctx.stores.audit.listEntries();
    expect(audits.find((a) => a.action === "mission_advancement_cascade")).toBeUndefined();
    const tasks = await ctx.stores.task.listTasks();
    expect(tasks).toHaveLength(1);
  });
});
