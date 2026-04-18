/**
 * E2E Thread Convergence Auto-Spawn Tests
 *
 * Validates the convergenceAction feature: when a thread converges
 * with a convergenceAction, the Hub automatically spawns the
 * requested entity (task or proposal) and closes the thread.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestOrchestrator } from "./orchestrator.js";
import type { ActorFacade } from "./orchestrator.js";

describe("E2E Convergence Auto-Spawn", () => {
  let orch: TestOrchestrator;
  let arch: ActorFacade;
  let eng: ActorFacade;

  beforeEach(() => {
    orch = TestOrchestrator.create();
    arch = orch.asArchitect();
    eng = orch.asEngineer();
  });

  it("convergence with create_task action spawns a task", async () => {
    // Architect opens thread
    const thread = await arch.createThread("Build caching layer", "Should we add Redis?");
    const threadId = thread.threadId as string;

    // Engineer replies with convergence + action
    orch.events.clear();
    await eng.replyToThread(threadId, "Yes, Redis is the right choice", {
      converged: true,
      convergenceAction: {
        type: "create_task",
        templateData: {
          title: "Implement Redis caching",
          description: "Add Redis as a write-through cache for hot queries",
        },
      },
    });

    // Architect converges (triggers the cascade)
    orch.events.clear();
    await arch.replyToThread(threadId, "Agreed. Proceed.", { converged: true });

    // Task should have been auto-spawned
    orch.events.expectEventFor("task_issued", "engineer");
    const directive = orch.events.expectEvent("task_issued");
    expect(directive.data.sourceThreadId).toBe(threadId);

    // Thread should be auto-closed
    const closedThread = await arch.getThread(threadId);
    expect(closedThread.status).toBe("closed");

    // Task should exist in the store
    const tasks = await arch.listTasks();
    const taskList = (tasks as any).tasks;
    const spawned = taskList.find((t: any) => t.title === "Implement Redis caching");
    expect(spawned).toBeDefined();
    expect(spawned.description).toBe("Add Redis as a write-through cache for hot queries");
  });

  it("convergence with create_proposal action spawns a proposal", async () => {
    // Architect opens thread
    const thread = await arch.createThread("Architecture change", "Should we refactor the store layer?");
    const threadId = thread.threadId as string;

    // Engineer replies with convergence + proposal action
    await eng.replyToThread(threadId, "Yes, let's formalize it", {
      converged: true,
      convergenceAction: {
        type: "create_proposal",
        templateData: {
          title: "Store Layer Refactoring",
          description: "Refactor the store layer to use repository pattern with dependency injection",
        },
      },
    });

    // Architect converges
    orch.events.clear();
    await arch.replyToThread(threadId, "Agreed", { converged: true });

    // Proposal should have been auto-spawned
    orch.events.expectEventFor("proposal_submitted", "architect");
    const propEvent = orch.events.expectEvent("proposal_submitted");
    expect(propEvent.data.sourceThreadId).toBe(threadId);

    // Thread should be auto-closed
    const closedThread = await arch.getThread(threadId);
    expect(closedThread.status).toBe("closed");
  });

  it("convergence without action fires thread_converged (backward compat)", async () => {
    const thread = await arch.createThread("Simple discussion", "Just talking");
    const threadId = thread.threadId as string;

    await eng.replyToThread(threadId, "Agreed", { converged: true });

    orch.events.clear();
    await arch.replyToThread(threadId, "Confirmed", { converged: true });

    // thread_converged event should fire (for sandwich handler)
    orch.events.expectEvent("thread_converged");

    // No task_issued or proposal_submitted — no action
    orch.events.expectNoEvent("task_issued");
    orch.events.expectNoEvent("proposal_submitted");

    // Thread should be converged but NOT auto-closed (no action to trigger close)
    const convergedThread = await arch.getThread(threadId);
    expect(convergedThread.status).toBe("converged");
  });

  it("auto-spawned task closes the originating thread", async () => {
    const thread = await arch.createThread("Close test", "Will auto-close");
    const threadId = thread.threadId as string;

    await eng.replyToThread(threadId, "Do it", {
      converged: true,
      convergenceAction: {
        type: "create_task",
        templateData: { title: "Auto-close test task", description: "Testing auto-close" },
      },
    });

    await arch.replyToThread(threadId, "OK", { converged: true });

    // Verify thread was closed by the cascade handler
    const t = await arch.getThread(threadId);
    expect(t.status).toBe("closed");
  });

  it("convergenceAction attached by the converging party (late-binding)", async () => {
    const thread = await arch.createThread("Late binding", "Discussion");
    const threadId = thread.threadId as string;

    // Engineer replies normally (no convergence)
    await eng.replyToThread(threadId, "I have thoughts");

    // Architect replies with convergence + action (late-binding)
    await arch.replyToThread(threadId, "Let's do it", {
      converged: true,
      convergenceAction: {
        type: "create_task",
        templateData: { title: "Late-bound task", description: "Bound at convergence time" },
      },
    });

    // Engineer converges (triggers the cascade with Architect's action)
    orch.events.clear();
    await eng.replyToThread(threadId, "Agreed", { converged: true });

    // Task should have been spawned
    orch.events.expectEventFor("task_issued", "engineer");

    const tasks = await arch.listTasks();
    const taskList = (tasks as any).tasks;
    const spawned = taskList.find((t: any) => t.title === "Late-bound task");
    expect(spawned).toBeDefined();
  });
});
