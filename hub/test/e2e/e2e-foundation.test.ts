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
      // work-162 (A1): Task (create/get/list/cancel_task, create/get_report),
      // Turn (create/get/list/update_turn), Clarification (create/resolve/
      // get_clarification), Review (create/get_review) verbs retired.
      // SEAL-C (idea-444): create_audit_entry + list_audit_entries retired (audit-verdict
      // authoring is now attest_evidence; the legacy Audit KIND stays read-only, fenced).
      const tools = orch.router.getAllToolNames().sort();
      expect(tools).toEqual([
        "ack_message",
        "claim_message",
        "claim_session",
        "close_proposal",
        "close_thread",
        // "create_document" REMOVED at mission-83 W6-narrowed (document-policy deleted; deferred to idea-300)
        "create_idea",
        "create_message",
        "create_mission",
        "create_proposal",
        "create_proposal_review",
        "create_thread",
        "create_thread_reply",
        "force_close_thread",
        "force_fire_pulse",
        "get_agents",
        "get_backlog_health", // idea-363 (work-59): incorporation-constraint readout
        // "get_document" REMOVED at mission-83 W6-narrowed (deferred to idea-300)
        // "get_engineer_status" HARD-REMOVED at idea-355 SLICE-4 (bug-184); get_agents is canonical
        "get_idea",
        "get_metrics",
        "get_mission",
        "get_pending_actions",
        "get_proposal",
        "get_thread",
        "leave_thread",
        // "list_audit_entries" RETIRED at SEAL-C (idea-444)
        // "list_documents" REMOVED at mission-83 W6-narrowed (deferred to idea-300)
        "list_ideas",
        "list_messages",
        "list_missions",
        "list_proposals",
        "list_threads",
        "migrate_agent_queue",
        "register_role",
        "signal_quota_blocked",
        "signal_quota_recovered",
        "signal_working_completed",
        "signal_working_started",
        "update_idea",
        "update_mission",
      ]);
    });

    it("EventCapture tracks correct event count", async () => {
      // work-162 (A1): re-pointed off create_task → create_idea (idea_submitted).
      expect(orch.events.count()).toBe(0);

      await arch.call("create_idea", { text: "Counted idea" });
      expect(orch.events.count()).toBeGreaterThan(0);
      expect(orch.events.count("idea_submitted")).toBe(1);
    });

    it("E2EError is thrown on policy errors", async () => {
      // work-162 (A1): re-pointed off create_report → create_proposal_review on
      // a non-existent proposal (still a policy error → E2EError).
      await expect(
        arch.reviewProposal("proposal-nonexistent", "approved", "fb")
      ).rejects.toThrow();
    });
  });
});
