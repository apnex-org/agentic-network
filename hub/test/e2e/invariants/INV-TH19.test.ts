/**
 * INV-TH19 — Cascade atomicity via validate-then-execute at the gate.
 *
 * - Every staged action's validator runs before `staged→committed` promotion.
 * - Any validator failure rejects the whole convergence; thread stays `active`;
 *   no partial commit.
 * - Post-gate execute-phase infrastructure failures route the thread to
 *   `cascade_failed` terminal; committed state is NOT reverted.
 *
 * workflow-registry.md §7.2 (ratified thread-125). Phase-2 gate enforcement:
 * `hub/src/policy/staged-action-payloads.ts:validateStagedActions` → called
 * from state.ts around line 1611-1628 → throws `ThreadConvergenceGateError`
 * with detailed per-action error list.
 *
 * Mission-41 Wave 2 — task-338. FINAL Wave 2 task.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestOrchestrator } from "../orchestrator.js";
import { assertInvTH19 } from "../invariant-helpers.js";

describe("INV-TH19 — cascade validate-then-execute atomicity", () => {
  let orch: TestOrchestrator;

  beforeEach(() => {
    orch = TestOrchestrator.create();
  });

  it("helper coverage: assertInvTH19 all modes pass", async () => {
    await expect(assertInvTH19(orch, "all")).resolves.toBeUndefined();
  });

  describe("positive — bilateral convergence with valid staged actions commits atomically", () => {
    it("single close_no_action: committed + thread flips to closed", async () => {
      const arch = orch.asArchitect();
      const eng = orch.asEngineer();
      await eng.listTasks();
      const thread = await arch.createThread("TH19 positive close", "open", { routingMode: "broadcast" });
      const threadId = thread.threadId as string;

      await eng.replyToThread(threadId, "agreed", {
        converged: true,
        summary: "close_no_action canonical",
        stagedActions: [{ kind: "stage", type: "close_no_action", payload: { reason: "no action needed" } }],
      });
      orch.events.clear();
      await arch.replyToThread(threadId, "agreed", { converged: true });

      const finalized = orch.events.expectEvent("thread_convergence_finalized");
      expect(finalized.data.committedActionCount).toBe(1);
      expect(finalized.data.executedCount).toBe(1);
      expect(finalized.data.threadTerminal).toBe("closed");

      const stored = await orch.stores.thread.getThread(threadId);
      expect(stored?.status).toBe("closed");
      // All staged → committed (or equivalent terminal action state).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const actions = (stored as any).convergenceActions as Array<{ status: string }>;
      for (const a of actions) {
        expect(["committed", "skipped"]).toContain(a.status);
      }
    });

    it("multi-action convergence: all actions committed atomically", async () => {
      const arch = orch.asArchitect();
      const eng = orch.asEngineer();
      await eng.listTasks();
      const thread = await arch.createThread("TH19 positive multi", "open", { routingMode: "broadcast" });
      const threadId = thread.threadId as string;

      await eng.replyToThread(threadId, "agreed", {
        converged: true,
        summary: "multi-action atomic commit",
        stagedActions: [
          { kind: "stage", type: "create_task", payload: { title: "t1", description: "first" } },
          { kind: "stage", type: "create_task", payload: { title: "t2", description: "second" } },
        ],
      });
      orch.events.clear();
      await arch.replyToThread(threadId, "agreed", { converged: true });

      const finalized = orch.events.expectEvent("thread_convergence_finalized");
      expect(finalized.data.committedActionCount).toBe(2);
      expect(finalized.data.executedCount).toBe(2);

      // Both tasks spawned.
      const tasks = await orch.stores.task.listTasks();
      const t1 = tasks.find((t) => t.title === "t1");
      const t2 = tasks.find((t) => t.title === "t2");
      expect(t1).toBeDefined();
      expect(t2).toBeDefined();
      // Back-link metadata populated for both.
      expect(t1!.sourceThreadId).toBe(threadId);
      expect(t2!.sourceThreadId).toBe(threadId);
    });
  });

  describe("negativeReject — invalid staged action rejects WHOLE convergence", () => {
    it("create_task missing description: convergence rejected; thread stays active; no commit", async () => {
      const arch = orch.asArchitect();
      const eng = orch.asEngineer();
      await eng.listTasks();
      const thread = await arch.createThread("TH19 invalid create_task", "open", { routingMode: "broadcast" });
      const threadId = thread.threadId as string;

      await eng.replyToThread(threadId, "staging invalid", {
        converged: true,
        summary: "invalid create_task",
        stagedActions: [{ kind: "stage", type: "create_task", payload: { title: "no-description" } }],
      });
      const archResult = await arch.call("create_thread_reply", {
        threadId, message: "attempting to converge", converged: true,
      });
      expect(archResult.isError).toBe(true);
      const parsed = JSON.parse(archResult.content[0].text);
      expect(parsed.error).toMatch(/Thread convergence rejected/);
      expect(parsed.error).toMatch(/staged action validation failed/);

      const stored = await orch.stores.thread.getThread(threadId);
      expect(stored?.status).toBe("active");
      // No commit.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const actions = (stored as any).convergenceActions as Array<{ status: string }>;
      expect(actions.every((a) => a.status !== "committed")).toBe(true);
      // No task was spawned (ensures execute phase didn't partially run).
      const tasks = await orch.stores.task.listTasks();
      expect(tasks.find((t) => t.title === "no-description")).toBeUndefined();
    });

    it("atomicity: one valid + one invalid → BOTH rejected (no partial commit of the valid one)", async () => {
      const arch = orch.asArchitect();
      const eng = orch.asEngineer();
      await eng.listTasks();
      const thread = await arch.createThread("TH19 mixed validity", "open", { routingMode: "broadcast" });
      const threadId = thread.threadId as string;

      await eng.replyToThread(threadId, "staging mixed", {
        converged: true,
        summary: "one valid one invalid",
        stagedActions: [
          { kind: "stage", type: "create_task", payload: { title: "valid", description: "has description" } },
          { kind: "stage", type: "create_task", payload: { title: "invalid-missing-description" } },
        ],
      });
      const archResult = await arch.call("create_thread_reply", {
        threadId, message: "attempting to converge", converged: true,
      });
      expect(archResult.isError).toBe(true);

      // Critical: the valid one must NOT have spawned. All-or-nothing.
      const tasks = await orch.stores.task.listTasks();
      expect(tasks.find((t) => t.title === "valid")).toBeUndefined();

      // Thread stays active.
      const stored = await orch.stores.thread.getThread(threadId);
      expect(stored?.status).toBe("active");
    });

    it("unknown action type: convergence rejected with named type in error", async () => {
      const arch = orch.asArchitect();
      const eng = orch.asEngineer();
      await eng.listTasks();
      const thread = await arch.createThread("TH19 unknown type", "open", { routingMode: "broadcast" });
      const threadId = thread.threadId as string;

      await eng.replyToThread(threadId, "staging bogus type", {
        converged: true,
        summary: "unknown action type",
        stagedActions: [{ kind: "stage", type: "not_a_real_type", payload: { foo: "bar" } }],
      });
      const archResult = await arch.call("create_thread_reply", {
        threadId, message: "attempting to converge", converged: true,
      });
      expect(archResult.isError).toBe(true);
      const parsed = JSON.parse(archResult.content[0].text);
      // Error surface should name the unknown type for operator diagnosability.
      expect(parsed.error).toMatch(/not_a_real_type|unknown autonomous action type/);
    });
  });

  describe("edge — post-gate execute-phase failures route to cascade_failed", () => {
    it("documented coverage: edge mode is not directly reproducible at TestOrchestrator level", () => {
      // Post-gate execute-phase failure requires injecting a fault into
      // the cascade handler execute path — there's no test-only hook for
      // this. The cascade-failure terminal is covered by existing tests
      // in hub/test/e2e/e2e-chaos.test.ts + thread-truncation.test.ts
      // that exercise real cascade-handler failure modes. For INV-TH19
      // specifically, positive + negativeReject cover the
      // validate-then-execute atomicity gate itself — which is the
      // load-bearing half of the invariant.
      expect(true).toBe(true);
    });
  });
});
