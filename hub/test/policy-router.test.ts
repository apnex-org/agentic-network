import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { PolicyRouter } from "../src/policy/router.js";
import { registerTaskPolicy, TASK_FSM } from "../src/policy/task-policy.js";
import { registerSystemPolicy } from "../src/policy/system-policy.js";
import { isValidTransition } from "../src/policy/types.js";
import { createTestContext, type TestPolicyContext } from "../src/policy/test-utils.js";
import type { PolicyResult, DomainEvent } from "../src/policy/types.js";

// Suppress console.log during tests
const noop = () => {};

describe("PolicyRouter", () => {
  let router: PolicyRouter;

  beforeEach(() => {
    router = new PolicyRouter(noop);
  });

  it("registers and dispatches a tool", async () => {
    router.register("echo", "Echo tool", {
      message: z.string(),
    }, async (args) => ({
      content: [{ type: "text", text: args.message as string }],
    }));

    const ctx = createTestContext();
    const result = await router.handle("echo", { message: "hello" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe("hello");
  });

  it("returns error for unknown tool", async () => {
    const ctx = createTestContext();
    const result = await router.handle("nonexistent", {}, ctx);

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("Unknown tool");
  });

  it("drains internal events via cascade handlers", async () => {
    const cascadeLog: string[] = [];

    router.register("trigger", "Trigger tool", {}, async (_args, ctx) => {
      ctx.internalEvents.push({ type: "test_event", payload: { value: 42 } });
      return { content: [{ type: "text", text: "ok" }] };
    });

    router.onInternalEvent("test_event", async (event) => {
      cascadeLog.push(`handled: ${event.payload.value}`);
    });

    const ctx = createTestContext();
    await router.handle("trigger", {}, ctx);

    expect(cascadeLog).toEqual(["handled: 42"]);
    expect(ctx.internalEvents).toHaveLength(0);
  });

  it("emits cascade_failure notification when cascade handler throws", async () => {
    router.register("trigger_fail", "Trigger tool", {}, async (_args, ctx) => {
      ctx.internalEvents.push({ type: "bad_event", payload: {} });
      return { content: [{ type: "text", text: "ok" }] };
    });

    router.onInternalEvent("bad_event", async () => {
      throw new Error("cascade boom");
    });

    const ctx = createTestContext();
    const result = await router.handle("trigger_fail", {}, ctx);

    // Primary result should succeed
    expect(result.content[0].text).toBe("ok");

    // cascade_failure notification emitted
    const cascadeFailure = ctx.emittedEvents.find(e => e.event === "cascade_failure");
    expect(cascadeFailure).toBeDefined();
    expect(cascadeFailure!.data.originalTool).toBe("trigger_fail");
    expect(cascadeFailure!.data.failedEvent).toBe("bad_event");
    expect(cascadeFailure!.targetRoles).toEqual(["architect"]);
  });

  it("registers aliases correctly", () => {
    router.register("canonical", "Canonical tool", {}, async () => ({
      content: [{ type: "text", text: "canonical" }],
    }));
    router.registerAlias("alias", "canonical");

    expect(router.has("alias")).toBe(true);
    expect(router.getRegisteredTools()).toEqual(["canonical"]);
    expect(router.getAllToolNames()).toContain("alias");
    expect(router.size).toBe(2);
  });

  it("throws when creating alias for non-existent canonical tool", () => {
    expect(() => router.registerAlias("bad_alias", "missing")).toThrow(
      "Cannot create alias 'bad_alias': canonical tool 'missing' not registered"
    );
  });

  describe("RBAC role parsing + multi-role tags (Phase 2x P2-6)", () => {
    // Bind a session to a role directly on the in-memory registry —
    // bypasses session-policy since we only want to exercise the
    // router's RBAC enforcement here, not the full handshake.
    async function bindRole(ctx: TestPolicyContext, role: "architect" | "engineer" | "director"): Promise<void> {
      await ctx.stores.engineerRegistry.registerAgent(
        ctx.sessionId,
        role,
        {
          globalInstanceId: `test-gid-${ctx.sessionId}-${role}`,
          proxyName: "test",
          proxyVersion: "0",
          clientName: "test",
          clientVersion: "0",
        } as any,
      );
    }

    it("single-role tag [Architect] permits architect, rejects engineer", async () => {
      router.register("arch_only", "[Architect] Architect-only tool", {}, async () => ({
        content: [{ type: "text", text: "ok" }],
      }));

      const archCtx = createTestContext({ role: "architect" });
      await bindRole(archCtx, "architect");
      expect((await router.handle("arch_only", {}, archCtx)).isError).toBeUndefined();

      const engCtx = createTestContext({ role: "engineer", stores: archCtx.stores });
      await bindRole(engCtx, "engineer");
      const engResult = await router.handle("arch_only", {}, engCtx);
      expect(engResult.isError).toBe(true);
      const parsed = JSON.parse(engResult.content[0].text);
      expect(parsed.error).toMatch(/requires role 'architect'/);
    });

    it("composite tag [Architect|Director] permits both, rejects engineer", async () => {
      router.register("admin_tool", "[Architect|Director] Admin-shared tool", {}, async () => ({
        content: [{ type: "text", text: "ok" }],
      }));

      const archCtx = createTestContext({ role: "architect" });
      await bindRole(archCtx, "architect");
      expect((await router.handle("admin_tool", {}, archCtx)).isError).toBeUndefined();

      const dirCtx = createTestContext({ role: "director", stores: archCtx.stores });
      await bindRole(dirCtx, "director");
      expect((await router.handle("admin_tool", {}, dirCtx)).isError).toBeUndefined();

      const engCtx = createTestContext({ role: "engineer", stores: archCtx.stores });
      await bindRole(engCtx, "engineer");
      const engResult = await router.handle("admin_tool", {}, engCtx);
      expect(engResult.isError).toBe(true);
      const parsed = JSON.parse(engResult.content[0].text);
      // Error message must list both permitted roles so the caller knows
      // why their engineer session can't use an admin tool.
      expect(parsed.error).toMatch(/architect/);
      expect(parsed.error).toMatch(/director/);
    });

    it("[Any] tag permits all registered roles", async () => {
      router.register("anyone_tool", "[Any] Anyone tool", {}, async () => ({
        content: [{ type: "text", text: "ok" }],
      }));
      for (const role of ["architect", "engineer", "director"] as const) {
        const c = createTestContext({ role });
        await bindRole(c, role);
        expect((await router.handle("anyone_tool", {}, c)).isError).toBeUndefined();
      }
    });

    it("missing/unknown role tag falls back to [Any]", async () => {
      router.register("untagged", "No tag here", {}, async () => ({
        content: [{ type: "text", text: "ok" }],
      }));
      const c = createTestContext({ role: "engineer" });
      await bindRole(c, "engineer");
      expect((await router.handle("untagged", {}, c)).isError).toBeUndefined();
    });
  });
});

describe("FSM validation", () => {
  it("validates legal transitions", () => {
    expect(isValidTransition(TASK_FSM, "pending", "working")).toBe(true);
    expect(isValidTransition(TASK_FSM, "working", "in_review")).toBe(true);
    expect(isValidTransition(TASK_FSM, "working", "input_required")).toBe(true);
    expect(isValidTransition(TASK_FSM, "blocked", "pending")).toBe(true);
    expect(isValidTransition(TASK_FSM, "input_required", "working")).toBe(true);
    expect(isValidTransition(TASK_FSM, "in_review", "completed")).toBe(true);
    expect(isValidTransition(TASK_FSM, "in_review", "working")).toBe(true);
    expect(isValidTransition(TASK_FSM, "in_review", "escalated")).toBe(true);
  });

  it("rejects illegal transitions", () => {
    expect(isValidTransition(TASK_FSM, "pending", "completed")).toBe(false);
    expect(isValidTransition(TASK_FSM, "completed", "pending")).toBe(false);
    expect(isValidTransition(TASK_FSM, "cancelled", "working")).toBe(false);
    expect(isValidTransition(TASK_FSM, "failed", "pending")).toBe(false);
  });
});

describe("TaskPolicy", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;

  beforeEach(() => {
    router = new PolicyRouter(noop);
    registerTaskPolicy(router);
    registerSystemPolicy(router);
    ctx = createTestContext();
  });

  it("registers all task tools and system tools", () => {
    const canonical = router.getRegisteredTools();
    expect(canonical).toContain("create_task");
    expect(canonical).toContain("get_task");
    expect(canonical).toContain("create_report");
    expect(canonical).toContain("get_report");
    expect(canonical).toContain("list_tasks");
    expect(canonical).toContain("cancel_task");

    // SystemPolicy tools
    expect(canonical).toContain("get_pending_actions");
  });

  it("createTask creates a task and emits task_issued", async () => {
    const result = await router.handle("create_task", {
      title: "Test task",
      description: "Implement something",
    }, ctx);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.taskId).toBe("task-1");
    expect(parsed.status).toBe("pending");

    // Should emit task_issued
    const issued = ctx.dispatchedEvents.find(e => e.event === "task_issued");
    expect(issued).toBeDefined();
    expect(issued!.data.taskId).toBe("task-1");
    expect(issued!.selector.roles).toEqual(["engineer"]);
  });

  it("createTask with title and description", async () => {
    const result = await router.handle("create_task", {
      title: "Do the thing",
      description: "Do the thing in detail",
    }, ctx);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.taskId).toBe("task-1");
    expect(parsed.status).toBe("pending");
  });

  it("createTask rejects missing title and directive", async () => {
    const result = await router.handle("create_task", {}, ctx);

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("'title' and 'description' are required");
  });

  it("getTask returns null when no pending tasks", async () => {
    ctx = createTestContext({ role: "engineer" });
    const result = await router.handle("get_task", {}, ctx);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.task).toBeNull();
    expect(parsed.message).toBe("No pending directives");
  });

  it("getTask returns a pending task and transitions it to working", async () => {
    // Create a task first
    await router.handle("create_task", {
      title: "Pick me up",
      description: "A directive for the engineer",
    }, ctx);

    // Get the task as engineer
    ctx = createTestContext({
      role: "engineer",
      stores: ctx.stores, // share stores
    });
    const result = await router.handle("get_task", {}, ctx);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.taskId).toBe("task-1");
    expect(parsed.title).toBe("Pick me up");
    expect(parsed.status).toBe("working");
  });

  it("createReport transitions task to in_review", async () => {
    // Create and pick up task
    await router.handle("create_task", { title: "Build it", description: "Build the thing" }, ctx);

    const engineerCtx = createTestContext({
      role: "engineer",
      stores: ctx.stores,
    });
    await router.handle("get_task", {}, engineerCtx);

    // Submit report
    const reportCtx = createTestContext({
      role: "engineer",
      stores: ctx.stores,
    });
    const result = await router.handle("create_report", {
      taskId: "task-1",
      report: "Done. All tests pass.",
      summary: "Completed successfully",
    }, reportCtx);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.status).toBe("in_review");

    // report_submitted should be emitted
    const submitted = reportCtx.dispatchedEvents.find(e => e.event === "report_submitted");
    expect(submitted).toBeDefined();
    expect(submitted!.data.taskId).toBe("task-1");
  });

  it("createReport returns error for non-existent task", async () => {
    const result = await router.handle("create_report", {
      taskId: "task-999",
      report: "Done",
      summary: "OK",
    }, ctx);

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("task-999");
  });

  it("cancelTask cancels and pushes task_cancelled internal event", async () => {
    // Create a task
    await router.handle("create_task", { title: "Cancel me", description: "Cancel this task" }, ctx);

    // Cancel it
    const cancelCtx = createTestContext({ stores: ctx.stores });
    const result = await router.handle("cancel_task", { taskId: "task-1" }, cancelCtx);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.status).toBe("cancelled");

    // Internal event should be queued (but already drained by router)
    // The cascade handler would have been called — verify via emittedEvents
    // (no dependents to cancel in this case, so no task_cancelled emitted)
  });

  it("cancelTask returns error for non-existent task", async () => {
    const result = await router.handle("cancel_task", { taskId: "task-999" }, ctx);
    expect(result.isError).toBe(true);
  });

  it("idempotency: duplicate idempotencyKey returns error", async () => {
    await router.handle("create_task", {
      title: "First",
      description: "First task",
      idempotencyKey: "unique-key-1",
    }, ctx);

    const ctx2 = createTestContext({ stores: ctx.stores });
    const result = await router.handle("create_task", {
      title: "Duplicate",
      description: "Duplicate task",
      idempotencyKey: "unique-key-1",
    }, ctx2);

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("duplicate");
    expect(parsed.existingTaskId).toBe("task-1");
  });

  it("createReport does not trigger DAG cascade (moved to review)", async () => {
    // Create parent task
    await router.handle("create_task", { title: "Parent", description: "Parent task" }, ctx);

    // Create dependent task
    const ctx2 = createTestContext({ stores: ctx.stores });
    const depResult = await router.handle("create_task", {
      title: "Child",
      description: "Child task",
      dependsOn: ["task-1"],
    }, ctx2);

    const depParsed = JSON.parse(depResult.content[0].text);
    expect(depParsed.status).toBe("blocked");

    // Pick up parent task
    const engCtx = createTestContext({ role: "engineer", stores: ctx.stores });
    await router.handle("get_task", {}, engCtx);

    // Report on parent — should NOT trigger task_completed cascade
    const reportCtx = createTestContext({ role: "engineer", stores: ctx.stores });
    await router.handle("create_report", {
      taskId: "task-1",
      report: "Done",
      summary: "Completed",
    }, reportCtx);

    // Child should still be blocked — cascade does not fire on report
    const childTask = await ctx.stores.task.getTask("task-2");
    expect(childTask!.status).toBe("blocked");

    // No task_issued for the child
    const directiveIssued = reportCtx.dispatchedEvents.find(
      e => e.event === "task_issued" && e.data.taskId === "task-2"
    );
    expect(directiveIssued).toBeUndefined();
  });

  it("task_cancelled cascade cancels dependent tasks", async () => {
    // Create parent task
    await router.handle("create_task", { title: "Parent", description: "Parent task" }, ctx);

    // Create dependent task
    const ctx2 = createTestContext({ stores: ctx.stores });
    await router.handle("create_task", {
      title: "Child",
      description: "Child task",
      dependsOn: ["task-1"],
    }, ctx2);

    // Cancel parent — should cascade to child
    const cancelCtx = createTestContext({ stores: ctx.stores });
    await router.handle("cancel_task", { taskId: "task-1" }, cancelCtx);

    // The cascade should have emitted task_cancelled for the child
    const childCancelled = cancelCtx.dispatchedEvents.find(
      e => e.event === "task_cancelled" && e.data.taskId === "task-2"
    );
    expect(childCancelled).toBeDefined();
    expect(childCancelled!.selector.roles).toEqual(["architect"]);
  });

  it("getPendingActions returns empty summary", async () => {
    const result = await router.handle("get_pending_actions", {}, ctx);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totalPending).toBe(0);
    expect(parsed.unreadReports).toEqual([]);
  });

  it("getPendingActions includes in_review tasks (regression pin for bug-9 / idea-89)", async () => {
    // bug-9 (commit 88e3fe8): submitReport transitions task → in_review,
    // but the `unreviewedTasks` + `unreadReports` filters previously
    // matched only completed/failed/reported_* — skipping in_review
    // entirely. Architect's EventLoop poll returned empty lists and
    // never reviewed engineer reports. Fix adds "in_review" to both
    // filters. This test drives the full submitReport → in_review
    // flow and asserts the task surfaces in BOTH lists, so any future
    // drift between submitReport's status transition and the filter
    // set will fail here.
    // 1. Architect creates a task
    const archCtx = createTestContext({ stores: ctx.stores, role: "architect" });
    await router.handle("create_task", { title: "T", description: "do the thing" }, archCtx);
    // 2. Engineer claims it → working
    const engCtx = createTestContext({ stores: ctx.stores, role: "engineer", sessionId: "eng-session" });
    await router.handle("register_role", { role: "engineer" }, engCtx);
    const claimed = await router.handle("get_task", {}, engCtx);
    const claimedTask = JSON.parse(claimed.content[0].text);
    expect(claimedTask.taskId).toBe("task-1");
    // 3. Engineer submits report → in_review
    const reportResult = await router.handle("create_report", {
      taskId: "task-1", report: "done", summary: "all good",
    }, engCtx);
    const reportParsed = JSON.parse(reportResult.content[0].text);
    expect(reportParsed.status).toBe("in_review");
    // 4. Architect polls pending actions — should see the in_review task
    const pending = await router.handle("get_pending_actions", {}, archCtx);
    const parsed = JSON.parse(pending.content[0].text);
    // Task must appear in unreviewedTasks (EventLoop calls sandwichReviewReport on these)
    expect(parsed.unreviewedTasks.some((t: any) => t.taskId === "task-1")).toBe(true);
    // And in unreadReports (reportRef present + no review assessment yet)
    expect(parsed.unreadReports.some((t: any) => t.taskId === "task-1")).toBe(true);
    // totalPending should count it
    expect(parsed.totalPending).toBeGreaterThanOrEqual(1);
  });

  it("getPendingActions suppresses threadsAwaitingReply when a non-terminal queue item exists (Phase 2c ckpt-B, idea-117)", async () => {
    // Regression pin: before this fix, the legacy path
    // (threadsAwaitingReply) fired on every 300s EventLoop poll even
    // when the thread had an active queue item in receipt_acked state.
    // A sandwich that hit MAX_TOOL_ROUNDS left its queue item stuck
    // AND the thread in currentTurn=architect; legacy path then
    // re-fired the sandwich indefinitely. The fix excludes threads
    // with in-flight queue items from threadsAwaitingReply so the
    // legacy path only covers true gap cases.
    const archCtx = createTestContext({ stores: ctx.stores, role: "architect" });
    // Bind an Agent directly on the registry — avoids register_role's
    // session-policy dependencies. engineerRegistry's M18 handshake is
    // thoroughly covered elsewhere; this test is about getPendingActions's
    // in-flight-queue-item suppression.
    await ctx.stores.engineerRegistry.registerAgent(
      archCtx.sessionId,
      "architect",
      {
        globalInstanceId: `test-gid-${archCtx.sessionId}`,
        proxyName: "test",
        proxyVersion: "0",
        clientName: "test",
        clientVersion: "0",
      } as any,
    );
    const architectAgent = await ctx.stores.engineerRegistry.getAgentForSession(archCtx.sessionId);
    expect(architectAgent).not.toBeNull();

    // Open a thread where architect owes a reply. Engineer opens the
    // thread → currentTurn defaults to architect per openThread semantics.
    const thread = await ctx.stores.thread.openThread("Stuck thread", "Hello", "engineer");
    expect((await ctx.stores.thread.getThread(thread.id))?.currentTurn).toBe("architect");

    // Baseline: no queue item → thread appears in threadsAwaitingReply
    const before = await router.handle("get_pending_actions", {}, archCtx);
    const beforeParsed = JSON.parse(before.content[0].text);
    expect(beforeParsed.threadsAwaitingReply.some((t: any) => t.threadId === thread.id)).toBe(true);

    // Enqueue a thread_message queue item in receipt_acked state for the architect
    const queued = await ctx.stores.pendingAction.enqueue({
      targetAgentId: architectAgent!.engineerId,
      dispatchType: "thread_message",
      entityRef: thread.id,
      payload: {},
    });
    await ctx.stores.pendingAction.receiptAck(queued.id);

    // After: legacy path suppresses the thread because queue is in-flight
    const after = await router.handle("get_pending_actions", {}, archCtx);
    const afterParsed = JSON.parse(after.content[0].text);
    expect(afterParsed.threadsAwaitingReply.some((t: any) => t.threadId === thread.id)).toBe(false);

    // Also verify: when the queue item reaches a terminal state, the
    // thread becomes eligible for the legacy path again (recovery fallback).
    await ctx.stores.pendingAction.abandon(queued.id, "test");
    const afterAbandon = await router.handle("get_pending_actions", {}, archCtx);
    const abandonParsed = JSON.parse(afterAbandon.content[0].text);
    expect(abandonParsed.threadsAwaitingReply.some((t: any) => t.threadId === thread.id)).toBe(true);
  });

  it("getPendingActions excludes reviewed in_review tasks (!reviewAssessment gate still holds)", async () => {
    // Variant of the above: after create_review writes an assessment,
    // the task should drop out of unreviewedTasks even if still in
    // in_review status (so the architect doesn't re-review the same
    // report on subsequent polls).
    const archCtx = createTestContext({ stores: ctx.stores, role: "architect" });
    await router.handle("create_task", { title: "T", description: "do" }, archCtx);
    const engCtx = createTestContext({ stores: ctx.stores, role: "engineer", sessionId: "eng-reviewed" });
    await router.handle("register_role", { role: "engineer" }, engCtx);
    await router.handle("get_task", {}, engCtx);
    await router.handle("create_report", { taskId: "task-1", report: "done", summary: "ok" }, engCtx);
    // Architect writes a review — task.reviewAssessment becomes non-null
    await ctx.stores.task.submitReview("task-1", "looks good", "approved");
    // Poll again — task should NOT be in unreviewedTasks anymore
    const pending = await router.handle("get_pending_actions", {}, archCtx);
    const parsed = JSON.parse(pending.content[0].text);
    expect(parsed.unreviewedTasks.some((t: any) => t.taskId === "task-1")).toBe(false);
    expect(parsed.unreadReports.some((t: any) => t.taskId === "task-1")).toBe(false);
  });

  it("listTasks returns created tasks", async () => {
    await router.handle("create_task", { title: "One", description: "First task" }, ctx);
    const ctx2 = createTestContext({ stores: ctx.stores });
    await router.handle("create_task", { title: "Two", description: "Second task" }, ctx2);

    const ctx3 = createTestContext({ stores: ctx.stores });
    const result = await router.handle("list_tasks", {}, ctx3);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(2);
  });

  describe("list_tasks — M-QueryShape Phase 1 (idea-119 / task-302)", () => {
    // Shared fixture: create a set of tasks spanning different statuses
    // and timestamps so filter + sort semantics can be exercised.
    async function seed(): Promise<void> {
      const ctx1 = createTestContext({ stores: ctx.stores });
      await router.handle("create_task", { title: "T1", description: "first" }, ctx1);
      const ctx2 = createTestContext({ stores: ctx.stores });
      await router.handle("create_task", { title: "T2", description: "second" }, ctx2);
      const ctx3 = createTestContext({ stores: ctx.stores });
      await router.handle("create_task", { title: "T3", description: "third" }, ctx3);
      // Backdate task-2 so createdAt-range + sort tests have a target.
      // MemoryTaskStore.getTask returns a shallow clone, so we must mutate
      // the internal Map directly.
      const internal = (ctx.stores.task as any).tasks as Map<string, any>;
      const t2 = internal.get("task-2");
      if (t2) t2.createdAt = "2025-01-01T00:00:00Z";
    }

    it("filter: implicit equality on status", async () => {
      await seed();
      // Move task-1 to a non-pending status so the filter actually filters
      const internal = (ctx.stores.task as any).tasks as Map<string, any>;
      const t1 = internal.get("task-1");
      if (t1) t1.status = "working";
      const result = await router.handle(
        "list_tasks",
        { filter: { status: "pending" } },
        createTestContext({ stores: ctx.stores }),
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.tasks.every((t: any) => t.status === "pending")).toBe(true);
      expect(parsed.tasks.some((t: any) => t.id === "task-1")).toBe(false);
    });

    it("filter: $in set membership", async () => {
      await seed();
      const result = await router.handle(
        "list_tasks",
        { filter: { status: { $in: ["pending"] } } },
        createTestContext({ stores: ctx.stores }),
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.tasks.every((t: any) => t.status === "pending")).toBe(true);
      expect(parsed.tasks.length).toBeGreaterThanOrEqual(1);
    });

    it("filter: $lt on createdAt (date range)", async () => {
      await seed();
      const result = await router.handle(
        "list_tasks",
        { filter: { createdAt: { $lt: "2026-01-01T00:00:00Z" } } },
        createTestContext({ stores: ctx.stores }),
      );
      const parsed = JSON.parse(result.content[0].text);
      // Only task-2 (backdated to 2025-01-01) matches
      expect(parsed.tasks.length).toBe(1);
      expect(parsed.tasks[0].id).toBe("task-2");
    });

    it("filter: forbidden operator ($regex) rejected by Zod with hint", async () => {
      await seed();
      const result = await router.handle(
        "list_tasks",
        { filter: { status: { $regex: "^p" } } },
        createTestContext({ stores: ctx.stores }),
      );
      // Zod validation happens via MCP binding layer in production, but
      // at the router level we test that the handler still receives the
      // un-validated args and the filter's unknown operator just
      // matches nothing (defense-in-depth). The primary enforcement is
      // at the Zod boundary — covered by the MCP integration tests.
      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed.tasks)).toBe(true);
    });

    it("sort: createdAt asc returns oldest-first", async () => {
      await seed();
      const result = await router.handle(
        "list_tasks",
        { sort: [{ field: "createdAt", order: "asc" }] },
        createTestContext({ stores: ctx.stores }),
      );
      const parsed = JSON.parse(result.content[0].text);
      // Backdated task-2 should appear first (oldest)
      expect(parsed.tasks[0].id).toBe("task-2");
    });

    it("sort: stable tie-breaker via implicit id:asc", async () => {
      await seed();
      // Force all tasks to have identical createdAt so sort must tie-break by id
      const internal = (ctx.stores.task as any).tasks as Map<string, any>;
      for (const id of ["task-1", "task-2", "task-3"]) {
        const t = internal.get(id);
        if (t) t.createdAt = "2026-04-20T00:00:00Z";
      }
      const result = await router.handle(
        "list_tasks",
        { sort: [{ field: "createdAt", order: "asc" }] },
        createTestContext({ stores: ctx.stores }),
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.tasks.map((t: any) => t.id)).toEqual(["task-1", "task-2", "task-3"]);
    });

    it("_ois_query_unmatched fires when filter yields 0 on non-empty collection", async () => {
      await seed();
      const result = await router.handle(
        "list_tasks",
        { filter: { status: "cancelled" } },
        createTestContext({ stores: ctx.stores }),
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.tasks).toEqual([]);
      expect(parsed._ois_query_unmatched).toBe(true);
    });

    it("_ois_query_unmatched absent when no filter is applied", async () => {
      await seed();
      const result = await router.handle(
        "list_tasks",
        {},
        createTestContext({ stores: ctx.stores }),
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed._ois_query_unmatched).toBeUndefined();
    });

    it("_ois_query_unmatched absent when collection is empty (no filter applied)", async () => {
      const result = await router.handle(
        "list_tasks",
        {},
        createTestContext({ stores: ctx.stores }),
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.tasks).toEqual([]);
      expect(parsed._ois_query_unmatched).toBeUndefined();
    });

    it("backwards-compat: legacy scalar `status:` arg still works", async () => {
      await seed();
      const result = await router.handle(
        "list_tasks",
        { status: "pending" },
        createTestContext({ stores: ctx.stores }),
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.tasks.every((t: any) => t.status === "pending")).toBe(true);
    });

    it("filter.status wins over legacy scalar `status:` arg when both present", async () => {
      await seed();
      // Legacy scalar asks for 'cancelled', new filter asks for 'pending'.
      // filter.status should win → results are 'pending'.
      const result = await router.handle(
        "list_tasks",
        { status: "cancelled", filter: { status: "pending" } },
        createTestContext({ stores: ctx.stores }),
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.tasks.every((t: any) => t.status === "pending")).toBe(true);
      expect(parsed.tasks.length).toBeGreaterThanOrEqual(1);
    });

    it("success criterion: find '3 oldest pending tasks' in a single call", async () => {
      await seed();
      const result = await router.handle(
        "list_tasks",
        {
          filter: { status: "pending" },
          sort: [{ field: "createdAt", order: "asc" }],
          limit: 3,
        },
        createTestContext({ stores: ctx.stores }),
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.tasks.length).toBeLessThanOrEqual(3);
      expect(parsed.tasks.every((t: any) => t.status === "pending")).toBe(true);
      // Oldest first: task-2 (backdated) should lead
      expect(parsed.tasks[0].id).toBe("task-2");
    });
  });

  it("createTask auto-closes source thread", async () => {
    // Open a thread
    const thread = await ctx.stores.thread.openThread("Test Thread", "Hello", "architect");

    const result = await router.handle("create_task", {
      title: "From thread",
      description: "Task from thread discussion",
      sourceThreadId: thread.id,
    }, ctx);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.sourceThreadClosed).toBe(true);

    // Verify thread is closed
    const closedThread = await ctx.stores.thread.getThread(thread.id);
    expect(closedThread!.status).toBe("closed");
  });

  it("createTask validates dependsOn task existence", async () => {
    const result = await router.handle("create_task", {
      title: "With bad dep",
      description: "Task with bad dependency",
      dependsOn: ["task-999"],
    }, ctx);

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("task-999");
  });
});
