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
import { createMetricsCounter } from "../../src/observability/metrics.js";

describe("E2E Convergence Cascade (Mission-24 Phase 2)", () => {
  let orch: TestOrchestrator;
  let arch: ActorFacade;
  let eng: ActorFacade;

  beforeEach(() => {
    orch = TestOrchestrator.create();
    arch = orch.asArchitect();
    eng = orch.asEngineer();
  });

  // work-162/proptool0: create_task and create_proposal convergence spawn
  // paths are retired. create_bug / create_idea spawn tests retain the
  // bilateral-convergence-cascade coverage.

  it("bilateral convergence with create_bug action spawns a bug", async () => {
    const thread = await arch.createThread("Bug capture", "Unexpected failure?");
    const threadId = thread.threadId as string;

    await eng.replyToThread(threadId, "Yes, let's formalise it", {
      converged: true,
      summary: "Agreed: capture the unexpected failure as a bug.",
      stagedActions: [{
        kind: "stage", type: "create_bug",
        payload: {
          title: "Unexpected failure",
          description: "Reproduction steps for the unexpected failure",
        },
      }],
    });

    orch.events.clear();
    await arch.replyToThread(threadId, "Agreed", { converged: true });

    const finalized = orch.events.expectEvent("thread_convergence_finalized");
    const entry = (finalized.data.report as any[])[0];
    expect(entry.type).toBe("create_bug");
    expect(entry.status).toBe("executed");
    expect(entry.entityId).toMatch(/^bug-/);

    const { items: bugs } = await orch.stores.bug.listBugs();
    const spawned = bugs.find((b) => b.title === "Unexpected failure");
    expect(spawned).toBeDefined();
    expect(spawned!.sourceThreadId).toBe(threadId);
    expect(spawned!.sourceThreadSummary).toMatch(/unexpected failure/);
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

    // work-162: no proposal / idea spawned (Task store retired).
    const proposals = await orch.stores.proposal.getProposals();
    const ideas = await orch.stores.idea.listIdeas();
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
      summary: "Architect proposed a late-bound idea; Engineer to confirm.",
      stagedActions: [{
        kind: "stage", type: "create_idea",
        payload: { title: "Late-bound idea", description: "Bound by architect at converge time" },
      }],
    });

    orch.events.clear();
    // Engineer converges → gate fires
    await eng.replyToThread(threadId, "Agreed", { converged: true });

    const finalized = orch.events.expectEvent("thread_convergence_finalized");
    expect(finalized.data.executedCount).toBe(1);

    // work-162: re-pointed off create_task → create_idea.
    const ideas = await orch.stores.idea.listIdeas();
    const spawned = ideas.find((i) => i.sourceThreadId === threadId);
    expect(spawned).toBeDefined();
  });

  it("multi-action cascade: create_bug + create_idea in one convergence, both execute", async () => {
    // work-162/proptool0: re-pointed off retired create_task/create_proposal.
    const thread = await arch.createThread("Multi", "Two outcomes");
    const threadId = thread.threadId as string;

    await eng.replyToThread(threadId, "Spawn both.", {
      converged: true,
      summary: "Agreed to spawn a bug and a backlog idea.",
      stagedActions: [
        {
          kind: "stage", type: "create_bug",
          payload: { title: "Bug A", description: "desc A" },
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

    const { items: bugs } = await orch.stores.bug.listBugs();
    const ideas = await orch.stores.idea.listIdeas();
    expect(bugs.filter((b) => b.sourceThreadId === threadId)).toHaveLength(1);
    expect(ideas.filter((i) => i.sourceThreadId === threadId)).toHaveLength(1);
  });

  it("idempotency: re-running cascade on same thread+action does not double-spawn", async () => {
    const thread = await arch.createThread("Idempotent", "Spawn once");
    const threadId = thread.threadId as string;

    await eng.replyToThread(threadId, "Spawn idea", {
      converged: true,
      summary: "Spawn exactly one idea.",
      stagedActions: [{
        kind: "stage", type: "create_idea",
        payload: { title: "Once", description: "only once" },
      }],
    });
    await arch.replyToThread(threadId, "Confirmed", { converged: true });

    // work-162: re-pointed off create_task → create_idea.
    const ideasBefore = await orch.stores.idea.listIdeas();
    const spawnedBefore = ideasBefore.filter((i) => i.sourceThreadId === threadId);
    expect(spawnedBefore).toHaveLength(1);

    // Re-run the cascade directly against the same committed action.
    const { runCascade } = await import("../../src/policy/cascade.js");
    const threadRec = await orch.stores.thread.getThread(threadId);
    const action = threadRec!.convergenceActions.find((a) => a.type === "create_idea")!;
    const result = await runCascade(
      (arch as any).ctx() ?? {
        stores: orch.stores,
        emit: async () => {},
        dispatch: async () => {},
        sessionId: "test", clientIp: "127.0.0.1", role: "architect",
        metrics: createMetricsCounter(),
      },
      threadRec!,
      [action],
      "Spawn exactly one task.",
    );
    expect(result.report[0].status).toBe("skipped_idempotent");

    // Still only one spawned.
    const ideasAfter = await orch.stores.idea.listIdeas();
    expect(ideasAfter.filter((i) => i.sourceThreadId === threadId)).toHaveLength(1);
  });

  it("auto-close: thread transitions to 'closed' after successful cascade", async () => {
    const thread = await arch.createThread("Auto-close", "Will auto-close");
    const threadId = thread.threadId as string;

    await eng.replyToThread(threadId, "Do it", {
      converged: true,
      summary: "Spawn and close.",
      stagedActions: [{
        kind: "stage", type: "create_idea",
        payload: { title: "Auto-close idea", description: "test" },
      }],
    });
    await arch.replyToThread(threadId, "OK", { converged: true });

    const closed = await arch.getThread(threadId);
    expect(closed.status).toBe("closed");
  });
});
