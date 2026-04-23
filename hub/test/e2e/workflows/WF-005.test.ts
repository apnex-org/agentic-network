/**
 * WF-005 — Thread Convergence: chaos-path coverage.
 *
 * workflow-registry.md §WF-005 (happy-path thread convergence) has two
 * sub-paths:
 *   - WF-005a — Architect LLM auto-directive path (thread_converged without action)
 *   - WF-005b — Hub cascade path (thread_converged with pre-declared action)
 *
 * This file tests the CHAOS paths per brief success-criterion #6:
 *   - **entropy injection** — cascade handler throws on execute phase →
 *     thread routes to `cascade_failed` (INV-TH19 post-gate-failure surface)
 *   - **delivery loss** — thread_convergence_finalized SSE not delivered;
 *     thread terminal state still correct on store read
 *   - **stall** — thread stuck with only unilateral convergence (one
 *     party converged=true; other never replies)
 *
 * Mission-41 Wave 3 — task-340.
 *
 * Mock*Client consumption: NOT USED. Thread convergence + cascade are
 * policy-layer; TestOrchestrator + direct-store fault injection mirrors
 * the existing e2e-chaos.test.ts cascade-boundary pattern. See WF-001
 * test-file docstring for the full rationale.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestOrchestrator } from "../orchestrator.js";

describe("WF-005 Thread Convergence — chaos coverage", () => {
  let orch: TestOrchestrator;

  beforeEach(() => {
    orch = TestOrchestrator.create();
  });

  // ── Stall: unilateral convergence — no cascade fires ──────────────

  it("stall: only one party converges — thread stays active; no partial cascade", async () => {
    // WF-005 cascade requires bilateral convergence (both parties
    // converged=true). If only one party converges, the thread stays
    // active and no cascade fires. This protects against partial-commit
    // on the validate-then-execute gate (INV-TH19).
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();
    await eng.listTasks();
    const thread = await arch.createThread("WF-005 unilateral", "open", {
      routingMode: "broadcast",
    });
    const threadId = thread.threadId as string;

    // Engineer stages + converges unilaterally.
    await eng.replyToThread(threadId, "one side", {
      converged: true,
      summary: "engineer-only converge",
      stagedActions: [
        { kind: "stage", type: "close_no_action", payload: { reason: "stall test" } },
      ],
    });
    // Architect NEVER replies. Thread remains active.
    const stored = await orch.stores.thread.getThread(threadId);
    expect(stored?.status).toBe("active");

    // No action promoted to committed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actions = (stored as any).convergenceActions as Array<{ status: string }>;
    expect(actions.every((a) => a.status !== "committed")).toBe(true);

    // No thread_convergence_finalized event fired (bilateral not achieved).
    const finalized = orch.events.forEvent("thread_convergence_finalized");
    expect(finalized).toHaveLength(0);
  });

  // ── Entropy injection: cascade handler throws on execute ──────────

  it("entropy injection: cascade handler throws on execute — thread routes to cascade_failed", async () => {
    // Sabotage the task store's submitDirective to throw during cascade
    // execute (after validate passes). The cascade handler for
    // create_task should catch the exception, surface it as an
    // action-level failure, and route the thread to cascade_failed
    // terminal per INV-TH19's post-gate-failure branch.
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();
    await eng.listTasks();
    const thread = await arch.createThread("WF-005 cascade fault", "open", {
      routingMode: "broadcast",
    });
    const threadId = thread.threadId as string;

    // Stage + bilateral-converge with a valid-payload action that the
    // sabotaged execute phase will fail on.
    await eng.replyToThread(threadId, "staging", {
      converged: true,
      summary: "action will fault on execute",
      stagedActions: [
        { kind: "stage", type: "create_task", payload: { title: "faulted", description: "will not spawn" } },
      ],
    });

    const taskStore = orch.stores.task;
    const originalSubmit = taskStore.submitDirective.bind(taskStore);
    taskStore.submitDirective = async () => {
      throw new Error("entropy-injected cascade-execute fault");
    };

    try {
      await arch.replyToThread(threadId, "agreed", { converged: true });
    } catch {
      // Thread-level convergence may or may not throw depending on
      // how deep the exception propagates. Key assertion is on thread
      // terminal state, not the reply call's outcome.
    } finally {
      taskStore.submitDirective = originalSubmit;
    }

    const stored = await orch.stores.thread.getThread(threadId);
    // INV-TH19: post-gate execute failure → cascade_failed terminal.
    // Thread should NOT be `active` (gate passed), nor `closed` (cascade
    // didn't complete cleanly).
    expect(stored?.status).toBe("cascade_failed");
  });

  // ── Delivery loss: thread convergence terminal still correct ─────

  it("delivery loss: thread_convergence_finalized SSE not observed — terminal state authoritative", async () => {
    // Per WF-005 design: the store's thread.status is the source of
    // truth. SSE events are notifications, not state. If the SSE is
    // lost, the thread's terminal status remains correct on direct
    // store read.
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();
    await eng.listTasks();
    const thread = await arch.createThread("WF-005 delivery loss", "open", {
      routingMode: "broadcast",
    });
    const threadId = thread.threadId as string;

    await eng.replyToThread(threadId, "staging", {
      converged: true,
      summary: "happy path; event capture then cleared",
      stagedActions: [
        { kind: "stage", type: "close_no_action", payload: { reason: "delivery loss test" } },
      ],
    });
    await arch.replyToThread(threadId, "agreed", { converged: true });

    // Simulate SSE delivery loss by clearing event capture after the
    // fact — the store's terminal state is unaffected.
    orch.events.clear();

    const stored = await orch.stores.thread.getThread(threadId);
    expect(stored?.status).toBe("closed");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actions = (stored as any).convergenceActions as Array<{ status: string }>;
    // Exactly the close_no_action fired.
    expect(actions.length).toBeGreaterThanOrEqual(1);
    const committed = actions.filter((a) => a.status === "committed");
    expect(committed.length).toBeGreaterThanOrEqual(1);
  });
});
