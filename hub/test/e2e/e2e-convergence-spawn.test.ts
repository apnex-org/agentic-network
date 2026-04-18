/**
 * E2E Thread Convergence Cascade Tests (Mission-24 Phase 2, ADR-014).
 *
 * Exercises the end-to-end path from thread convergence to cascade
 * completion: gate → validate → promote → execute → finalize. The
 * legacy Phase-1 convergenceAction singular shape was removed in the
 * Threads 2.0 clean cutover; these tests now drive the Phase-2
 * StagedActionOp API with the full autonomous vocabulary.
 *
 * Each test below corresponds to a Phase-2 handler + invariant
 * (see docs/decisions/014-threads-2-phase-2-architecture.md for
 * INV-TH16..23 definitions).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestOrchestrator } from "./orchestrator.js";
import type { ActorFacade } from "./orchestrator.js";

describe("E2E Convergence Cascade (Mission-24 Phase 2)", () => {
  let orch: TestOrchestrator;
  let arch: ActorFacade;
  let eng: ActorFacade;

  beforeEach(() => {
    orch = TestOrchestrator.create();
    arch = orch.asArchitect();
    eng = orch.asEngineer();
  });

  it("bilateral convergence with create_task action spawns a task (executed report entry)", async () => {
    const thread = await arch.createThread("Build caching layer", "Should we add Redis?");
    const threadId = thread.threadId as string;

    // Engineer stages + converges; summary authored here.
    await eng.replyToThread(threadId, "Yes — Redis as a write-through cache", {
      converged: true,
      intent: "implementation_ready",
      summary: "Agreed: Redis as write-through cache for hot queries.",
      stagedActions: [{
        kind: "stage", type: "create_task",
        payload: {
          title: "Implement Redis caching",
          description: "Add Redis as a write-through cache for hot queries",
        },
      }],
    });

    orch.events.clear();
    // Architect mirrors converge → gate fires → cascade executes.
    await arch.replyToThread(threadId, "Agreed. Proceed.", { converged: true });

    // Merged Phase-2 event carries the full ConvergenceReport
    const finalized = orch.events.expectEvent("thread_convergence_finalized");
    expect(finalized.data.committedActionCount).toBe(1);
    expect(finalized.data.executedCount).toBe(1);
    expect(finalized.data.warning).toBe(false);
    expect(finalized.data.threadTerminal).toBe("closed");
    const entry = (finalized.data.report as any[])[0];
    expect(entry.type).toBe("create_task");
    expect(entry.status).toBe("executed");
    expect(entry.entityId).toMatch(/^task-/);

    // Task was spawned with back-link metadata
    const tasks = await orch.stores.task.listTasks();
    const spawned = tasks.find((t) => t.title === "Implement Redis caching");
    expect(spawned).toBeDefined();
    expect(spawned!.sourceThreadId).toBe(threadId);
    expect(spawned!.sourceActionId).toBe(entry.actionId);
    expect(spawned!.sourceThreadSummary).toMatch(/Redis as write-through cache/);

    // Thread auto-closed by cascade
    const closed = await arch.getThread(threadId);
    expect(closed.status).toBe("closed");
  });

  it("bilateral convergence with create_proposal action spawns a proposal", async () => {
    const thread = await arch.createThread("Store refactor", "Repository pattern?");
    const threadId = thread.threadId as string;

    await eng.replyToThread(threadId, "Yes, let's formalise it", {
      converged: true,
      summary: "Agreed: refactor store layer to repository pattern.",
      stagedActions: [{
        kind: "stage", type: "create_proposal",
        payload: {
          title: "Store Layer Refactoring",
          description: "Refactor the store layer to use repository pattern with dependency injection",
        },
      }],
    });

    orch.events.clear();
    await arch.replyToThread(threadId, "Agreed", { converged: true });

    const finalized = orch.events.expectEvent("thread_convergence_finalized");
    const entry = (finalized.data.report as any[])[0];
    expect(entry.type).toBe("create_proposal");
    expect(entry.status).toBe("executed");
    expect(entry.entityId).toMatch(/^prop-/);

    const proposals = await orch.stores.proposal.getProposals();
    const spawned = proposals.find((p) => p.title === "Store Layer Refactoring");
    expect(spawned).toBeDefined();
    expect(spawned!.sourceThreadId).toBe(threadId);
    expect(spawned!.sourceThreadSummary).toMatch(/repository pattern/);
  });

  it("bilateral convergence with create_idea action spawns an idea", async () => {
    const thread = await arch.createThread("Idea capture", "Backlog item");
    const threadId = thread.threadId as string;

    await eng.replyToThread(threadId, "Record it for later", {
      converged: true,
      summary: "Captured for backlog; no action yet.",
      stagedActions: [{
        kind: "stage", type: "create_idea",
        payload: {
          title: "Rate-limiting metrics dashboard",
          description: "Surface request-rate p50/p95/p99 by tenant.",
          tags: ["observability", "backlog"],
        },
      }],
    });

    orch.events.clear();
    await arch.replyToThread(threadId, "Approved for backlog", { converged: true });

    const finalized = orch.events.expectEvent("thread_convergence_finalized");
    const entry = (finalized.data.report as any[])[0];
    expect(entry.type).toBe("create_idea");
    expect(entry.status).toBe("executed");

    const ideas = await orch.stores.idea.listIdeas();
    const spawned = ideas.find((i) => i.sourceThreadId === threadId);
    expect(spawned).toBeDefined();
    expect(spawned!.tags).toEqual(["observability", "backlog"]);
    expect(spawned!.sourceThreadSummary).toMatch(/backlog/);
  });

  it("close_no_action convergence fires finalized with no entity spawn", async () => {
    const thread = await arch.createThread("Simple chat", "No action needed");
    const threadId = thread.threadId as string;

    await eng.replyToThread(threadId, "Agreed — nothing to do.", {
      converged: true,
      summary: "Discussion logged; no follow-up.",
      stagedActions: [{
        kind: "stage", type: "close_no_action",
        payload: { reason: "discussion complete" },
      }],
    });

    orch.events.clear();
    await arch.replyToThread(threadId, "Confirmed.", { converged: true });

    const finalized = orch.events.expectEvent("thread_convergence_finalized");
    expect(finalized.data.committedActionCount).toBe(1);
    expect(finalized.data.executedCount).toBe(1);
    const entry = (finalized.data.report as any[])[0];
    expect(entry.type).toBe("close_no_action");
    expect(entry.entityId).toBeNull();

    // No task / proposal / idea spawned.
    const tasks = await orch.stores.task.listTasks();
    const proposals = await orch.stores.proposal.getProposals();
    const ideas = await orch.stores.idea.listIdeas();
    expect(tasks.filter((t) => t.sourceThreadId === threadId)).toHaveLength(0);
    expect(proposals.filter((p) => p.sourceThreadId === threadId)).toHaveLength(0);
    expect(ideas.filter((i) => i.sourceThreadId === threadId)).toHaveLength(0);

    // Thread auto-closed
    const closed = await arch.getThread(threadId);
    expect(closed.status).toBe("closed");
  });

  it("late-binding: converging party can author the stagedActions", async () => {
    const thread = await arch.createThread("Late bind", "Discuss");
    const threadId = thread.threadId as string;

    // Engineer replies without converging
    await eng.replyToThread(threadId, "I have thoughts");

    // Architect stages + converges
    await arch.replyToThread(threadId, "Let's do it", {
      converged: true,
      summary: "Architect proposed a late-bound task; Engineer to confirm.",
      stagedActions: [{
        kind: "stage", type: "create_task",
        payload: { title: "Late-bound task", description: "Bound by architect at converge time" },
      }],
    });

    orch.events.clear();
    // Engineer converges → gate fires
    await eng.replyToThread(threadId, "Agreed", { converged: true });

    const finalized = orch.events.expectEvent("thread_convergence_finalized");
    expect(finalized.data.executedCount).toBe(1);

    const tasks = await orch.stores.task.listTasks();
    const spawned = tasks.find((t) => t.title === "Late-bound task");
    expect(spawned).toBeDefined();
    expect(spawned!.sourceThreadId).toBe(threadId);
  });

  it("multi-action cascade: create_task + create_idea in one convergence, both execute", async () => {
    const thread = await arch.createThread("Multi", "Two outcomes");
    const threadId = thread.threadId as string;

    await eng.replyToThread(threadId, "Spawn both.", {
      converged: true,
      summary: "Agreed to spawn a task and a backlog idea.",
      stagedActions: [
        {
          kind: "stage", type: "create_task",
          payload: { title: "Task A", description: "desc A" },
        },
        {
          kind: "stage", type: "create_idea",
          payload: { title: "Idea A", description: "idea desc A", tags: ["followup"] },
        },
      ],
    });

    orch.events.clear();
    await arch.replyToThread(threadId, "OK.", { converged: true });

    const finalized = orch.events.expectEvent("thread_convergence_finalized");
    expect(finalized.data.committedActionCount).toBe(2);
    expect(finalized.data.executedCount).toBe(2);
    expect(finalized.data.warning).toBe(false);

    const tasks = await orch.stores.task.listTasks();
    const ideas = await orch.stores.idea.listIdeas();
    expect(tasks.filter((t) => t.sourceThreadId === threadId)).toHaveLength(1);
    expect(ideas.filter((i) => i.sourceThreadId === threadId)).toHaveLength(1);
  });

  it("idempotency: re-running cascade on same thread+action does not double-spawn", async () => {
    const thread = await arch.createThread("Idempotent", "Spawn once");
    const threadId = thread.threadId as string;

    await eng.replyToThread(threadId, "Spawn task", {
      converged: true,
      summary: "Spawn exactly one task.",
      stagedActions: [{
        kind: "stage", type: "create_task",
        payload: { title: "Once", description: "only once" },
      }],
    });
    await arch.replyToThread(threadId, "Confirmed", { converged: true });

    const tasksBefore = await orch.stores.task.listTasks();
    const spawnedBefore = tasksBefore.filter((t) => t.sourceThreadId === threadId);
    expect(spawnedBefore).toHaveLength(1);

    // Re-run the cascade directly against the same committed action.
    const { runCascade } = await import("../../src/policy/cascade.js");
    const threadRec = await orch.stores.thread.getThread(threadId);
    const action = threadRec!.convergenceActions.find((a) => a.type === "create_task")!;
    const result = await runCascade(
      (arch as any).ctx() ?? {
        stores: orch.stores,
        emit: async () => {},
        dispatch: async () => {},
        sessionId: "test", clientIp: "127.0.0.1", role: "architect",
        internalEvents: [], config: { storageBackend: "memory", gcsBucket: "" },
      },
      threadRec!,
      [action],
      "Spawn exactly one task.",
    );
    expect(result.report[0].status).toBe("skipped_idempotent");

    // Still only one spawned.
    const tasksAfter = await orch.stores.task.listTasks();
    expect(tasksAfter.filter((t) => t.sourceThreadId === threadId)).toHaveLength(1);
  });

  it("auto-close: thread transitions to 'closed' after successful cascade", async () => {
    const thread = await arch.createThread("Auto-close", "Will auto-close");
    const threadId = thread.threadId as string;

    await eng.replyToThread(threadId, "Do it", {
      converged: true,
      summary: "Spawn and close.",
      stagedActions: [{
        kind: "stage", type: "create_task",
        payload: { title: "Auto-close task", description: "test" },
      }],
    });
    await arch.replyToThread(threadId, "OK", { converged: true });

    const closed = await arch.getThread(threadId);
    expect(closed.status).toBe("closed");
  });
});
