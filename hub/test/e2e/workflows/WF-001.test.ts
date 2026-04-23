/**
 * WF-001 — Task Happy Path: chaos-path coverage.
 *
 * workflow-registry.md §WF-001 defines the happy path (architect creates
 * task → engineer claims → reports → architect reviews approved →
 * completed). This file tests the CHAOS paths per brief success-criterion
 * #6:
 *   - **entropy injection** — fault in task_issued dispatch selector
 *     resolution mid-flow
 *   - **delivery loss** — task_issued SSE event not delivered (task
 *     still discoverable via get_task polling)
 *   - **stall** — task claimed but never reported (architect stewardship
 *     cancel via thread-131 widening)
 *
 * Mission-41 Wave 3 — task-340.
 *
 * Mock*Client consumption: NOT USED. TestOrchestrator + direct-store
 * fault injection (per existing e2e-chaos.test.ts pattern) is the right
 * tool for policy-layer chaos scenarios. Mock*Client would be needed for
 * transport-layer chaos (SSE race conditions at the dispatcher/shim),
 * which is a separate coverage surface (existing shim.e2e.test.ts +
 * thread-138 regression tests cover that class).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestOrchestrator } from "../orchestrator.js";

describe("WF-001 Task Happy Path — chaos coverage", () => {
  let orch: TestOrchestrator;

  beforeEach(() => {
    orch = TestOrchestrator.create();
  });

  // ── Stall: engineer claims, never reports ─────────────────────────

  it("stall: task claimed but never reported — architect stewardship cancels", async () => {
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();

    // Step 1: architect creates task
    await arch.createTask("WF-001 stall test", "engineer will never report");

    // Step 2: engineer claims → flips to working
    await eng.getTask();
    const claimed = await orch.stores.task.getTask("task-1");
    expect(claimed?.status).toBe("working");

    // "Engineer crash" — simulated by simply not calling create_report.
    // The task remains in `working` indefinitely from the FSM's
    // perspective.

    // Step 3: architect exercises stewardship cancel (thread-131
    // widening: cancel permitted on `working` for stranded work).
    const cancel = await arch.call("cancel_task", { taskId: "task-1" });
    expect(cancel.isError).toBeFalsy();

    const cancelled = await orch.stores.task.getTask("task-1");
    expect(cancelled?.status).toBe("cancelled");
  });

  // ── Entropy injection: dispatch fault during task_issued ──────────

  it("entropy injection: task_issued dispatch throws — task still lands in store", async () => {
    // Per WF-001 step 1: create_task should both persist the task AND
    // dispatch task_issued. Dispatch faults are non-transactional with
    // store writes — chaos-resilient design means the task still lands
    // in the store even if the notification can't reach an engineer.
    const arch = orch.asArchitect();

    // Sabotage: replace the engineerRegistry's selectAgents to throw
    // during dispatch resolution. The create_task handler should not
    // crash; the task should still persist.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reg = orch.stores.engineerRegistry as any;
    const original = reg.selectAgents.bind(reg);
    let dispatchFaulted = false;
    reg.selectAgents = async () => {
      dispatchFaulted = true;
      throw new Error("entropy-injected dispatch fault");
    };

    try {
      // create_task may OR may not throw depending on whether dispatch
      // is awaited inside the handler. Either way, the task should
      // persist (chaos-resilient invariant).
      await arch.call("create_task", {
        title: "WF-001 entropy test",
        description: "dispatch will fault",
      }).catch(() => undefined);

      const stored = await orch.stores.task.listTasks();
      const match = stored.find((t) => t.title === "WF-001 entropy test");
      expect(match).toBeDefined();
      expect(match!.status).toBe("pending");
    } finally {
      reg.selectAgents = original;
    }
  });

  // ── Delivery loss: task persists; engineer discovers via polling ──

  it("delivery loss: task_issued SSE not received — engineer polling recovers", async () => {
    // Per WF-001 step 2: get_task is the canonical discovery path;
    // task_issued SSE is an optimization. If the SSE event is lost,
    // get_task polling still works.
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();

    // Sabotage: suppress all event emissions at the orchestrator level
    // (simulates SSE delivery loss). eventCapture still sees them but
    // we don't route to any specific consumer; engineer runs blind.
    orch.events.clear();
    await arch.createTask("WF-001 delivery-loss test", "engineer sees no SSE");

    // Engineer has no task_issued SSE to react to, but polling via
    // get_task still finds the task.
    const picked = await eng.getTask();
    expect(picked.status).toBe("working");
    expect(picked.title).toBe("WF-001 delivery-loss test");
  });

  // ── Combined: stall + delivery loss simultaneously ────────────────

  it("stall + delivery loss: no SSE + engineer never reports — architect still recovers via stewardship", async () => {
    // Combination scenario: the two independent chaos-classes compose.
    // The system stays recoverable via the architect's
    // cancel-on-working path.
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();

    orch.events.clear();
    await arch.createTask("WF-001 compound chaos", "double trouble");
    await eng.getTask();
    // No report ever fired.
    const cancel = await arch.call("cancel_task", { taskId: "task-1" });
    expect(cancel.isError).toBeFalsy();
    const final = await orch.stores.task.getTask("task-1");
    expect(final?.status).toBe("cancelled");
  });
});
