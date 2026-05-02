/**
 * E2E Foundation Tests — Proof-of-Concept Scenarios
 *
 * Validates the TestOrchestrator harness by exercising the three
 * most important multi-actor FSM interactions entirely in-memory.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestOrchestrator } from "./orchestrator.js";
import type { ActorFacade } from "./orchestrator.js";

describe("E2E Foundation", () => {
  let orch: TestOrchestrator;
  let arch: ActorFacade;
  let eng: ActorFacade;

  beforeEach(() => {
    orch = TestOrchestrator.create();
    arch = orch.asArchitect();
    eng = orch.asEngineer();
  });

  // ── Scenario 1: Task Lifecycle (Happy Path) ─────────────────────

  describe("Task Lifecycle (Happy Path)", () => {
    it("Architect creates → Engineer picks up → reports → Architect reviews", async () => {
      // 1. Architect creates a task
      const task = await arch.createTask("Implement feature X", "Build the X feature with tests");
      expect(task.taskId).toBe("task-1");
      expect(task.status).toBe("pending");

      // Event: task_issued → engineer
      orch.events.expectEventFor("task_issued", "engineer");

      // 2. Engineer picks up the task
      const picked = await eng.getTask();
      expect(picked.taskId).toBe("task-1");
      expect(picked.status).toBe("working");

      // 3. Engineer submits a report — task transitions to in_review (not completed)
      const report = await eng.createReport("task-1", "Feature X implemented. All tests pass.", "Completed successfully");
      expect(report.success).toBe(true);
      expect(report.status).toBe("in_review");

      // Event: report_submitted → architect
      orch.events.expectEventFor("report_submitted", "architect");

      // 4. Architect reviews the report (stores assessment; task stays in_review until T3 adds decision)
      const review = await arch.createReview("task-1", "Excellent work. All requirements met.");
      expect(review.success).toBe(true);

      // Event: review_completed → engineer
      orch.events.expectEventFor("review_completed", "engineer");

      // Verify the full event sequence (no task_completed cascade on report)
      orch.events.expectEventSequence([
        "task_issued",
        "directive_acknowledged",
        "report_submitted",
        "review_completed",
      ]);
    });

    it("events target the correct roles throughout the lifecycle", async () => {
      await arch.createTask("Task for role check", "Description");
      await eng.getTask();
      await eng.createReport("task-1", "Done", "OK");
      await arch.createReview("task-1", "Good");

      // Verify role targeting
      const engineerEvents = orch.events.forRole("engineer");
      const architectEvents = orch.events.forRole("architect");

      // Engineer should receive: task_issued, review_completed
      expect(engineerEvents.some((e) => e.event === "task_issued")).toBe(true);
      expect(engineerEvents.some((e) => e.event === "review_completed")).toBe(true);

      // Architect should receive: directive_acknowledged, report_submitted
      expect(architectEvents.some((e) => e.event === "directive_acknowledged")).toBe(true);
      expect(architectEvents.some((e) => e.event === "report_submitted")).toBe(true);

      // Architect should NOT receive task_issued (that's for engineers)
      expect(architectEvents.some((e) => e.event === "task_issued")).toBe(false);
    });
  });

  // ── Scenario 2: Clarification Round-Trip ────────────────────────

  describe("Clarification Round-Trip", () => {
    it("working → input_required → working state transitions", async () => {
      // Setup: create and pick up a task
      await arch.createTask("Ambiguous task", "Do the thing");
      await eng.getTask();
      orch.events.clear(); // reset for clean assertions

      // 1. Engineer requests clarification
      const clarReq = await eng.requestClarification("task-1", "What format should the output be?");
      expect(clarReq.success).toBe(true);
      expect(clarReq.status).toBe("input_required");

      // Event: clarification_requested → architect
      orch.events.expectEventFor("clarification_requested", "architect");

      // 2. Engineer checks — not yet answered
      const before = await eng.getClarification("task-1");
      expect(before.answered).toBe(false);
      expect(before.question).toBe("What format should the output be?");
      expect(before.status).toBe("input_required");

      // 3. Architect answers
      const clarRes = await arch.resolveClarification("task-1", "Use JSON format with ISO timestamps");
      expect(clarRes.success).toBe(true);
      expect(clarRes.status).toBe("working");

      // Event: clarification_answered → engineer
      orch.events.expectEventFor("clarification_answered", "engineer");

      // 4. Engineer checks — now answered
      const after = await eng.getClarification("task-1");
      expect(after.answered).toBe(true);
      expect(after.answer).toBe("Use JSON format with ISO timestamps");
      expect(after.status).toBe("working");

      // Verify event sequence
      orch.events.expectEventSequence([
        "clarification_requested",
        "clarification_answered",
      ]);
    });

    it("clarification on non-working task throws E2EError", async () => {
      // Task doesn't exist
      await expect(
        eng.requestClarification("task-999", "Any question")
      ).rejects.toThrow(/not found or not in working/);
    });

    it("resolve on non-input_required task throws E2EError", async () => {
      // Task doesn't exist in input_required state
      await expect(
        arch.resolveClarification("task-999", "Any answer")
      ).rejects.toThrow(/not found or not in input_required/);
    });
  });

  // ── Scenario 3: Thread Convergence ──────────────────────────────

  describe("Thread Convergence", () => {
    it("both parties converge → thread status = converged", async () => {
      // 1. Architect opens a thread
      const thread = await arch.createThread("API Design", "Should we use REST or GraphQL?");
      expect(thread.threadId).toBeDefined();
      expect(thread.status).toBe("active");
      expect(thread.currentTurn).toBe("engineer"); // architect opened, engineer's turn

      // Event: thread_message → engineer
      orch.events.expectEventFor("thread_message", "engineer");

      // 2. Engineer replies with convergence signal. Mission-21 Phase 1:
      // gate requires committed action + non-empty summary on the
      // eventual convergence — stage them on the first converging reply.
      const reply1 = await eng.replyToThread(thread.threadId as string, "REST is better for our use case. Agreed.", {
        converged: true,
        intent: "implementation_ready",
        summary: "Agreed: REST over GraphQL for current use case.",
        stagedActions: [{ kind: "stage", type: "close_no_action", payload: { reason: "Decision logged; no further artifacts needed for this thread" } }],
      });
      expect(reply1.status).toBe("active"); // only one party converged so far
      expect(reply1.currentTurn).toBe("architect");

      // 3. Architect converges too
      const reply2 = await arch.replyToThread(thread.threadId as string, "Confirmed. REST it is.", {
        converged: true,
      });
      expect(reply2.status).toBe("converged");

      // Mission-24 Phase 2 (M24-T3): thread_convergence_finalized → architect
      // (merged event replaces the legacy thread_converged + thread_convergence_completed pair).
      orch.events.expectEvent("thread_convergence_finalized");
      const convergedEvent = orch.events.expectEventFor("thread_convergence_finalized", "architect");
      expect(convergedEvent.data.threadId).toBe(thread.threadId);
      expect(convergedEvent.data.committedActionCount).toBe(1);
      expect(convergedEvent.data.executedCount).toBe(1);
    });

    it("reply when not your turn throws E2EError", async () => {
      const thread = await arch.createThread("Turn test", "Opening");

      // Architect tries to reply again (engineer's turn)
      await expect(
        arch.replyToThread(thread.threadId as string, "Out of turn!")
      ).rejects.toThrow(/not found, not active, or not your turn/);
    });

    it("thread tracks turn alternation correctly", async () => {
      const thread = await arch.createThread("Turns", "Message 1");
      expect(thread.currentTurn).toBe("engineer");
      expect(thread.roundCount).toBe(1);

      const r1 = await eng.replyToThread(thread.threadId as string, "Message 2");
      expect(r1.currentTurn).toBe("architect");
      expect(r1.roundCount).toBe(2);

      const r2 = await arch.replyToThread(thread.threadId as string, "Message 3");
      expect(r2.currentTurn).toBe("engineer");
      expect(r2.roundCount).toBe(3);
    });
  });

  // ── Orchestrator Infrastructure ─────────────────────────────────

  describe("Orchestrator Infrastructure", () => {
    it("registers expected PolicyRouter tools", () => {
      // Structural snapshot test: tool additions must update the sorted list
      // below; tool removals fail with a clear array diff naming the missing
      // tool. Replaces the mission-by-mission count-anchored assertion
      // previously maintained here — calibration #60
      // (hub-mcp-tool-addition-audit-pattern) closure mechanism (b)
      // structural complement; mission-72 / idea-231.
      //
      // (pending-action-policy tools like `prune_stuck_queue_items` are NOT
      // registered on the orchestrator router — orchestrator skips
      // `registerPendingActionPolicy`.)
      const tools = orch.router.getAllToolNames().sort();
      expect(tools).toEqual([
        "ack_message",
        "cancel_task",
        "claim_message",
        "claim_session",
        "close_proposal",
        "close_thread",
        "create_audit_entry",
        "create_clarification",
        "create_document",
        "create_idea",
        "create_message",
        "create_mission",
        "create_proposal",
        "create_proposal_review",
        "create_report",
        "create_review",
        "create_task",
        "create_tele",
        "create_thread",
        "create_thread_reply",
        "create_turn",
        "force_close_thread",
        "force_fire_pulse",
        "get_agents",
        "get_clarification",
        "get_document",
        "get_engineer_status",
        "get_idea",
        "get_metrics",
        "get_mission",
        "get_pending_actions",
        "get_proposal",
        "get_report",
        "get_review",
        "get_task",
        "get_tele",
        "get_thread",
        "get_turn",
        "leave_thread",
        "list_audit_entries",
        "list_available_peers",
        "list_documents",
        "list_ideas",
        "list_messages",
        "list_missions",
        "list_proposals",
        "list_tasks",
        "list_tele",
        "list_threads",
        "list_turns",
        "migrate_agent_queue",
        "register_role",
        "resolve_clarification",
        "retire_tele",
        "signal_quota_blocked",
        "signal_quota_recovered",
        "signal_working_completed",
        "signal_working_started",
        "supersede_tele",
        "update_idea",
        "update_mission",
        "update_turn",
      ]);
    });

    it("multi-engineer support with distinct sessions", async () => {
      const eng1 = orch.asEngineer("eng-1");
      const eng2 = orch.asEngineer("eng-2");

      // Create two tasks
      await arch.createTask("Task 1", "For eng-1");
      await arch.createTask("Task 2", "For eng-2");

      // Each engineer picks up one
      const picked1 = await eng1.getTask();
      expect(picked1.taskId).toBe("task-1");

      const picked2 = await eng2.getTask();
      expect(picked2.taskId).toBe("task-2");
    });

    it("EventCapture tracks correct event count", async () => {
      expect(orch.events.count()).toBe(0);

      await arch.createTask("Counted task", "Description");
      expect(orch.events.count()).toBeGreaterThan(0);
      expect(orch.events.count("task_issued")).toBe(1);
    });

    it("E2EError is thrown on policy errors", async () => {
      await expect(
        eng.createReport("task-nonexistent", "Report", "Summary")
      ).rejects.toThrow();
    });
  });
});
