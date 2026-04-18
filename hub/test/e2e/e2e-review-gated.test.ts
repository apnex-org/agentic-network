/**
 * Review-Gated DAG Cascade & FSM Validation Tests
 *
 * Tests the review decision logic (approved/rejected), DAG cascades
 * on review approval, revision loops, and static FSM graph validation.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestOrchestrator } from "./orchestrator.js";
import type { ActorFacade } from "./orchestrator.js";
import { TASK_FSM } from "../../src/policy/task-policy.js";
import { IDEA_FSM } from "../../src/policy/idea-policy.js";
import { MISSION_FSM } from "../../src/policy/mission-policy.js";
import { TURN_FSM } from "../../src/policy/turn-policy.js";
import type { FsmTransitionTable } from "../../src/policy/types.js";

// ── Static FSM Graph Validation ─────────────────────────────────────

describe("Static FSM Graph Validation", () => {
  function getOutboundTransitions(fsm: FsmTransitionTable, state: string): string[] {
    return fsm.filter((t) => t.from === state).map((t) => t.to);
  }

  function getAllStates(fsm: FsmTransitionTable): Set<string> {
    const states = new Set<string>();
    for (const t of fsm) {
      states.add(t.from);
      states.add(t.to);
    }
    return states;
  }

  it("TASK_FSM: every non-terminal state has at least one outbound transition", () => {
    const terminalStates = new Set(["completed", "failed", "escalated", "cancelled"]);
    const allStates = getAllStates(TASK_FSM);

    for (const state of allStates) {
      if (terminalStates.has(state)) continue;
      const outbound = getOutboundTransitions(TASK_FSM, state);
      expect(outbound.length, `State '${state}' has no outbound transitions — sink state detected!`).toBeGreaterThan(0);
    }
  });

  it("TASK_FSM: terminal states have zero outbound transitions", () => {
    const terminalStates = ["completed", "failed", "escalated", "cancelled"];
    for (const state of terminalStates) {
      const outbound = getOutboundTransitions(TASK_FSM, state);
      expect(outbound.length, `Terminal state '${state}' has outbound transitions!`).toBe(0);
    }
  });

  it("TASK_FSM: in_review is reachable and not a sink", () => {
    const inbound = TASK_FSM.filter((t) => t.to === "in_review");
    const outbound = TASK_FSM.filter((t) => t.from === "in_review");
    expect(inbound.length, "in_review has no inbound transitions").toBeGreaterThan(0);
    expect(outbound.length, "in_review has no outbound transitions — SINK STATE").toBeGreaterThan(0);
  });

  it("IDEA_FSM: every non-terminal state has outbound transitions", () => {
    const terminalStates = new Set(["incorporated"]);
    const allStates = getAllStates(IDEA_FSM);
    for (const state of allStates) {
      if (terminalStates.has(state)) continue;
      const outbound = getOutboundTransitions(IDEA_FSM, state);
      expect(outbound.length, `Idea state '${state}' is a sink`).toBeGreaterThan(0);
    }
  });

  it("MISSION_FSM: every non-terminal state has outbound transitions", () => {
    const terminalStates = new Set(["completed", "abandoned"]);
    const allStates = getAllStates(MISSION_FSM);
    for (const state of allStates) {
      if (terminalStates.has(state)) continue;
      const outbound = getOutboundTransitions(MISSION_FSM, state);
      expect(outbound.length, `Mission state '${state}' is a sink`).toBeGreaterThan(0);
    }
  });

  it("TURN_FSM: every non-terminal state has outbound transitions", () => {
    const terminalStates = new Set(["completed"]);
    const allStates = getAllStates(TURN_FSM);
    for (const state of allStates) {
      if (terminalStates.has(state)) continue;
      const outbound = getOutboundTransitions(TURN_FSM, state);
      expect(outbound.length, `Turn state '${state}' is a sink`).toBeGreaterThan(0);
    }
  });
});

// ── Review-Gated DAG Cascade ────────────────────────────────────────

describe("Review-Gated DAG Cascade", () => {
  let orch: TestOrchestrator;
  let arch: ActorFacade;
  let eng: ActorFacade;

  beforeEach(() => {
    orch = TestOrchestrator.create();
    arch = orch.asArchitect();
    eng = orch.asEngineer();
  });

  it("review approval transitions in_review → completed and triggers cascade", async () => {
    // Create parent + child DAG
    const parent = await arch.createTask("Parent", "Do parent work");
    const child = await arch.createTask("Child", "Depends on parent", {
      dependsOn: [parent.taskId as string],
    });
    expect(child.status).toBe("blocked");

    // Engineer picks up and reports on parent
    await eng.getTask();
    const report = await eng.createReport(parent.taskId as string, "Parent done", "OK");
    expect(report.status).toBe("in_review");

    // Child should STILL be blocked (no cascade on report)
    orch.events.clear();

    // Architect approves the review
    const reviewResult = await arch.call("create_review", {
      taskId: parent.taskId,
      assessment: "Good work",
      decision: "approved",
    });
    const reviewParsed = JSON.parse(reviewResult.content[0].text);

    // Parent should be completed
    expect(reviewParsed.status).toBe("completed");
    expect(reviewParsed.decision).toBe("approved");

    // DAG cascade should have fired — child unblocked
    const directiveEvents = orch.events.forEvent("task_issued");
    const childUnblock = directiveEvents.find((e) => e.data.taskId === child.taskId);
    expect(childUnblock).toBeDefined();

    // Child should now be pickable
    const pickedChild = await eng.getTask();
    expect(pickedChild.taskId).toBe(child.taskId);
  });

  it("review rejection transitions in_review → working for revision", async () => {
    await arch.createTask("Revisable", "Will be rejected");
    await eng.getTask();
    await eng.createReport("task-1", "Bad work", "Needs fixing");

    orch.events.clear();
    const result = await arch.call("create_review", {
      taskId: "task-1",
      assessment: "This is wrong. Fix the error handling.",
      decision: "rejected",
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe("working");
    expect(parsed.decision).toBe("rejected");
    expect(parsed.revisionCount).toBe(1);

    // revision_required event should target engineer
    orch.events.expectEventFor("revision_required", "engineer");
    const revEvent = orch.events.expectEvent("revision_required");
    expect(revEvent.data.taskId).toBe("task-1");
    expect(revEvent.data.previousReportRef).toBeDefined();

    // Engineer can re-report
    const reReport = await eng.createReport("task-1", "Fixed work", "Fixed");
    expect(reReport.status).toBe("in_review");
  });

  it("revision loop: report → reject → re-report → approve", async () => {
    await arch.createTask("Iterative", "Will need revisions");
    await eng.getTask();

    // Round 1: report → rejected
    await eng.createReport("task-1", "First attempt", "V1");
    await arch.call("create_review", { taskId: "task-1", assessment: "Needs work", decision: "rejected" });

    // Round 2: re-report → approved
    await eng.createReport("task-1", "Second attempt", "V2");
    const result = await arch.call("create_review", { taskId: "task-1", assessment: "Much better", decision: "approved" });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe("completed");
    expect(parsed.decision).toBe("approved");
  });

  it("circuit breaker: 4th rejection escalates the task", async () => {
    await arch.createTask("Endless revisions", "Will escalate");
    await eng.getTask();

    // 3 rejection cycles (revisionCount goes to 3)
    for (let i = 0; i < 3; i++) {
      await eng.createReport("task-1", `Attempt ${i + 1}`, `V${i + 1}`);
      await arch.call("create_review", { taskId: "task-1", assessment: "Still wrong", decision: "rejected" });
    }

    // 4th report + rejection should trigger escalation
    await eng.createReport("task-1", "Attempt 4", "V4");
    orch.events.clear();
    const result = await arch.call("create_review", { taskId: "task-1", assessment: "Giving up", decision: "rejected" });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe("escalated");
    expect(parsed.message).toContain("escalated");

    // director_attention_required emitted
    orch.events.expectEventFor("director_attention_required", "architect");

    // Engineer cannot report on escalated task
    await expect(
      eng.createReport("task-1", "Can't report", "Blocked")
    ).rejects.toThrow(/Invalid state transition/);
  });

  it("review without decision defaults to approved (backward compat)", async () => {
    await arch.createTask("Legacy review", "No decision field");
    await eng.getTask();
    await eng.createReport("task-1", "Done", "OK");

    // Call createReview without decision (uses facade which doesn't pass decision)
    const review = await arch.createReview("task-1", "Looks good");
    expect(review.status).toBe("completed");
  });
});
