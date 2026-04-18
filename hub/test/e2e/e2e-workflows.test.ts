/**
 * E2E Workflow Tests — Complex Happy-Path Scenarios
 *
 * Validates multi-step, multi-actor workflows using the TestOrchestrator.
 * All tests run entirely in-memory with no transport layer.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestOrchestrator } from "./orchestrator.js";
import type { ActorFacade } from "./orchestrator.js";

describe("E2E Workflows", () => {
  let orch: TestOrchestrator;
  let arch: ActorFacade;
  let eng: ActorFacade;

  beforeEach(() => {
    orch = TestOrchestrator.create();
    arch = orch.asArchitect();
    eng = orch.asEngineer();
  });

  // ── Proposal Lifecycle ────────────────────────────────────────────

  describe("Proposal Lifecycle", () => {
    it("create → changes_requested → resubmit → approve → close", async () => {
      // 1. Engineer creates a proposal
      const proposal = await eng.createProposal(
        "Add caching layer",
        "Implement Redis caching for hot queries",
        "# Caching Layer\n\n## Motivation\nReduce latency on frequently accessed data.\n\n## Design\nUse Redis as a write-through cache."
      );
      expect(proposal.proposalId).toBeDefined();
      expect(proposal.status).toBe("submitted");

      // Event: proposal_submitted → architect
      orch.events.expectEventFor("proposal_submitted", "architect");
      const proposalId = proposal.proposalId as string;

      // 2. Architect reviews — requests changes
      orch.events.clear();
      const review1 = await arch.reviewProposal(proposalId, "changes_requested",
        "Good concept but needs cache invalidation strategy. Also specify TTL policy."
      );
      expect(review1.success).toBe(true);
      expect(review1.decision).toBe("changes_requested");

      // Event: proposal_decided → engineer
      orch.events.expectEventFor("proposal_decided", "engineer");
      const decidedEvent = orch.events.expectEvent("proposal_decided");
      expect(decidedEvent.data.decision).toBe("changes_requested");

      // 3. Engineer checks the decision
      const check1 = await eng.getProposal(proposalId);
      expect(check1.status).toBe("changes_requested");
      expect(check1.feedback).toContain("cache invalidation");

      // 4. Engineer creates an updated proposal (new submission)
      orch.events.clear();
      const proposal2 = await eng.createProposal(
        "Add caching layer (v2)",
        "Redis caching with write-through invalidation and 5min TTL",
        "# Caching Layer v2\n\nUpdated with invalidation strategy and TTL policy."
      );
      const proposalId2 = proposal2.proposalId as string;
      expect(proposal2.status).toBe("submitted");
      orch.events.expectEventFor("proposal_submitted", "architect");

      // 5. Architect approves v2
      orch.events.clear();
      const review2 = await arch.reviewProposal(proposalId2, "approved",
        "Excellent update. Cache invalidation strategy is sound. Approved."
      );
      expect(review2.decision).toBe("approved");
      orch.events.expectEventFor("proposal_decided", "engineer");

      // 6. Engineer closes after implementation
      const closed = await eng.closeProposal(proposalId2);
      expect(closed.success).toBe(true);
      expect(closed.status).toBe("implemented");

      // 7. Verify final states
      const final1 = await eng.getProposal(proposalId);
      expect(final1.status).toBe("changes_requested"); // original stays as-is

      const final2 = await eng.getProposal(proposalId2);
      expect(final2.status).toBe("implemented");
    });

    it("proposal rejection flow", async () => {
      const proposal = await eng.createProposal(
        "Use MongoDB",
        "Replace GCS with MongoDB",
        "Full proposal body"
      );
      const proposalId = proposal.proposalId as string;

      const review = await arch.reviewProposal(proposalId, "rejected",
        "GCS is our persistence layer. MongoDB adds unnecessary complexity."
      );
      expect(review.decision).toBe("rejected");

      const final = await eng.getProposal(proposalId);
      expect(final.status).toBe("rejected");
      expect(final.feedback).toContain("GCS is our persistence layer");
    });
  });

  // ── Mission Auto-Linkage ──────────────────────────────────────────

  describe("Mission Auto-Linkage", () => {
    it("tasks and ideas auto-link to mission via correlationId", async () => {
      // 1. Architect creates a mission
      const mission = await arch.call("create_mission", {
        title: "Platform Hardening",
        description: "Improve reliability and test coverage",
      });
      const missionParsed = JSON.parse(mission.content[0].text);
      const missionId = missionParsed.missionId as string;
      expect(missionId).toBe("mission-1");

      // 2. Architect creates a task linked to the mission
      const task = await arch.createTask(
        "Add retry logic",
        "Implement exponential backoff on all HTTP calls",
        { correlationId: missionId }
      );
      expect(task.taskId).toBeDefined();

      // 3. Verify the mission's tasks array was auto-populated
      const missionAfterTask = await arch.call("get_mission", { missionId });
      const m1 = JSON.parse(missionAfterTask.content[0].text);
      expect(m1.tasks).toContain(task.taskId);

      // 4. Engineer submits an idea
      const idea = await eng.call("create_idea", {
        text: "We should also add circuit breakers",
        tags: ["reliability"],
      });
      const ideaParsed = JSON.parse(idea.content[0].text);
      const ideaId = ideaParsed.ideaId as string;

      // 5. Architect incorporates the idea into the mission
      await arch.call("update_idea", {
        ideaId,
        missionId,
      });

      // 6. Verify the mission's ideas array was auto-populated
      const missionFinal = await arch.call("get_mission", { missionId });
      const m2 = JSON.parse(missionFinal.content[0].text);
      expect(m2.tasks).toContain(task.taskId);
      expect(m2.ideas).toContain(ideaId);
    });

    it("multiple tasks and ideas accumulate on mission", async () => {
      await arch.call("create_mission", {
        title: "Multi-link test",
        description: "Test multiple linkages",
      });

      // Create 3 tasks linked to mission-1
      await arch.createTask("Task A", "Desc A", { correlationId: "mission-1" });
      await arch.createTask("Task B", "Desc B", { correlationId: "mission-1" });
      await arch.createTask("Task C", "Desc C", { correlationId: "mission-1" });

      const mission = await arch.call("get_mission", { missionId: "mission-1" });
      const parsed = JSON.parse(mission.content[0].text);
      expect(parsed.tasks.length).toBe(3);
    });
  });

  // ── DAG Cascades ──────────────────────────────────────────────────

  describe("DAG Cascades", () => {
    it("reporting on parent does not unblock dependent child (cascade moved to review)", async () => {
      // 1. Create parent task
      const parent = await arch.createTask("Build foundation", "Create the base module");
      expect(parent.status).toBe("pending");
      const parentId = parent.taskId as string;

      // 2. Create child task dependent on parent
      const child = await arch.createTask("Build feature", "Feature on top of base", {
        dependsOn: [parentId],
      });
      expect(child.status).toBe("blocked");
      const childId = child.taskId as string;

      // 3. Engineer picks up and reports on parent
      const picked = await eng.getTask();
      expect(picked.taskId).toBe(parentId); // child is blocked, so parent is picked

      orch.events.clear();
      const report = await eng.createReport(parentId, "Foundation built. All tests pass.", "Completed");

      // 4. Parent should be in_review, not completed
      expect(report.status).toBe("in_review");

      // 5. Cascade does NOT fire on report — child remains blocked
      const unblockEvent = orch.events.forEvent("task_issued").find(
        (e) => e.data.taskId === childId
      );
      expect(unblockEvent).toBeUndefined();

      // NOTE: Cascade-on-review (unblocking child) will be tested in Mission-9 T3
    });

    it("cancelling parent cascades cancellation to blocked children", async () => {
      // Create parent and dependent child
      const parent = await arch.createTask("Parent task", "Will be cancelled");
      const child = await arch.createTask("Child task", "Depends on parent", {
        dependsOn: [parent.taskId as string],
      });
      expect(child.status).toBe("blocked");

      // Cancel parent
      orch.events.clear();
      await arch.cancelTask(parent.taskId as string);

      // Verify child was cascade-cancelled
      orch.events.expectEvent("task_cancelled");
      const cancelEvent = orch.events.forEvent("task_cancelled").find(
        (e) => e.data.taskId === child.taskId
      );
      expect(cancelEvent).toBeDefined();
    });

    it("three-level DAG: report does not cascade (moved to review)", async () => {
      // Create 3-level chain: A → B → C
      const a = await arch.createTask("Level A", "Base");
      const b = await arch.createTask("Level B", "Depends on A", {
        dependsOn: [a.taskId as string],
      });
      const c = await arch.createTask("Level C", "Depends on B", {
        dependsOn: [b.taskId as string],
      });

      expect(b.status).toBe("blocked");
      expect(c.status).toBe("blocked");

      // Report on A — cascade should NOT fire
      await eng.getTask(); // picks up A
      orch.events.clear();
      await eng.createReport(a.taskId as string, "A done", "OK");

      // B should still be blocked (no cascade on report)
      const bUnblock = orch.events.forEvent("task_issued").find(
        (e) => e.data.taskId === b.taskId
      );
      expect(bUnblock).toBeUndefined();

      // C should still be blocked
      const cUnblock = orch.events.forEvent("task_issued").find(
        (e) => e.data.taskId === c.taskId
      );
      expect(cUnblock).toBeUndefined();

      // NOTE: Cascade-on-review will be tested in Mission-9 T3
    });

    it("diamond DAG: report does not cascade (moved to review)", async () => {
      // Diamond: C depends on [A, B] — cascade moved to review approval
      const a = await arch.createTask("Diamond A", "Left branch");
      const b = await arch.createTask("Diamond B", "Right branch");
      const c = await arch.createTask("Diamond C", "Depends on both", {
        dependsOn: [a.taskId as string, b.taskId as string],
      });
      expect(c.status).toBe("blocked");

      // Pick up both A and B
      await eng.getTask(); // picks up A (or B — both pending)
      await eng.getTask(); // picks up the other

      // Report on both — cascade should NOT fire
      await eng.createReport(a.taskId as string, "A done", "OK");
      orch.events.clear();
      await eng.createReport(b.taskId as string, "B done", "OK");

      // C should still be blocked — no cascade on report
      const cUnblock = orch.events.forEvent("task_issued").find(
        (e) => e.data.taskId === c.taskId
      );
      expect(cUnblock).toBeUndefined();

      // NOTE: Cascade-on-review will be tested in Mission-9 T3
    });
  });
});
