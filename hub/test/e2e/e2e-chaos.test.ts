/**
 * E2E Chaos Tests — Failure Paths & Resilience
 *
 * Validates the PolicyRouter's error boundaries, concurrency behavior,
 * and cross-domain failure isolation.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { TestOrchestrator } from "./orchestrator.js";
import type { ActorFacade } from "./orchestrator.js";

describe("E2E Chaos", () => {
  let orch: TestOrchestrator;
  let arch: ActorFacade;
  let eng: ActorFacade;

  beforeEach(() => {
    orch = TestOrchestrator.create();
    arch = orch.asArchitect();
    eng = orch.asEngineer();
  });

  // ── Cascade Failure Boundary ──────────────────────────────────────

  // Cascade failure boundary tests will be re-enabled in Mission-9 T3
  // when cascade moves to create_review. Report no longer triggers cascade.
  describe("Cascade Failure Boundary", () => {
    it("report does not trigger cascade (no cascade_failure possible)", async () => {
      // Create parent task and blocked child (DAG)
      const parent = await arch.createTask("Parent", "Will complete");
      const child = await arch.createTask("Child", "Depends on parent", {
        dependsOn: [parent.taskId as string],
      });
      expect(child.status).toBe("blocked");

      // Pick up the parent
      await eng.getTask();

      // Report on parent — cascade does NOT fire (moved to review)
      orch.events.clear();
      const report = await eng.createReport(
        parent.taskId as string,
        "Done",
        "Completed"
      );

      // Primary operation succeeded, task is in_review
      expect(report.success).toBe(true);
      expect(report.status).toBe("in_review");

      // No cascade_failure since no cascade fires on report
      const cascadeFailure = orch.events.forEvent("cascade_failure");
      expect(cascadeFailure).toHaveLength(0);

      // No task_issued for the child
      const childDirective = orch.events.forEvent("task_issued").find(
        (e) => e.data.taskId === child.taskId
      );
      expect(childDirective).toBeUndefined();
    });

    it("no cascade events emitted on report even with sabotaged store", async () => {
      const parent = await arch.createTask("P", "Parent");
      await arch.createTask("C", "Child", {
        dependsOn: [parent.taskId as string],
      });
      await eng.getTask();

      // Sabotage — but it shouldn't matter since cascade doesn't fire
      const originalUnblock = orch.stores.task.unblockDependents;
      orch.stores.task.unblockDependents = async () => {
        throw new Error("KABOOM");
      };

      orch.events.clear();
      await eng.createReport(parent.taskId as string, "Done", "OK");

      // No cascade_failure since cascade doesn't fire on report
      const cascadeFailure = orch.events.forEvent("cascade_failure");
      expect(cascadeFailure).toHaveLength(0);

      // Restore
      orch.stores.task.unblockDependents = originalUnblock;
    });
  });

  // ── Concurrent Task Pickup ────────────────────────────────────────

  describe("Concurrent Task Pickup", () => {
    it("only one engineer gets the task when two race for it", async () => {
      // Create a single task
      await arch.createTask("Contested task", "Only one engineer should get this");

      // Two engineers race for it
      const eng1 = orch.asEngineer("racer-1");
      const eng2 = orch.asEngineer("racer-2");

      const [result1, result2] = await Promise.all([
        eng1.getTask(),
        eng2.getTask(),
      ]);

      // Exactly one should get the task, the other gets null
      const gotTask1 = result1.taskId !== undefined;
      const gotTask2 = result2.taskId !== undefined;

      // At least one got it
      expect(gotTask1 || gotTask2).toBe(true);

      // The one that didn't get it receives the "no pending" message
      if (gotTask1) {
        expect(result1.taskId).toBe("task-1");
        expect(result1.status).toBe("working");
        expect(result2.task).toBeNull();
      } else {
        expect(result2.taskId).toBe("task-1");
        expect(result2.status).toBe("working");
        expect(result1.task).toBeNull();
      }
    });

    it("three tasks distributed across two engineers", async () => {
      await arch.createTask("Task A", "First");
      await arch.createTask("Task B", "Second");
      await arch.createTask("Task C", "Third");

      const eng1 = orch.asEngineer("worker-1");
      const eng2 = orch.asEngineer("worker-2");

      // Each picks up sequentially
      const pick1 = await eng1.getTask();
      const pick2 = await eng2.getTask();
      const pick3 = await eng1.getTask();

      // All three tasks should be assigned
      const taskIds = [pick1.taskId, pick2.taskId, pick3.taskId];
      expect(taskIds).toContain("task-1");
      expect(taskIds).toContain("task-2");
      expect(taskIds).toContain("task-3");

      // No duplicates
      expect(new Set(taskIds).size).toBe(3);
    });

    it("no tasks available returns gracefully (not an error)", async () => {
      // No tasks created — getTask should return null, not throw
      const result = await eng.call("get_task", {});
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.task).toBeNull();
    });
  });

  // ── Cross-Domain Linkage Failure ──────────────────────────────────

  describe("Cross-Domain Linkage Failure", () => {
    it("task creation succeeds even with non-existent mission correlationId", async () => {
      // Create task linked to a mission that doesn't exist
      const task = await arch.createTask(
        "Orphan task",
        "This task references a non-existent mission",
        { correlationId: "mission-999" }
      );

      // Task should still be created successfully
      expect(task.taskId).toBeDefined();
      expect(task.status).toBe("pending");

      // Verify the task exists in the store
      const tasks = await arch.listTasks();
      expect((tasks as any).count).toBe(1);
    });

    it("task with non-mission correlationId skips auto-linkage entirely", async () => {
      // correlationId that doesn't match mission-\d+ pattern
      const task = await arch.createTask(
        "Custom correlation",
        "Not a mission link",
        { correlationId: "thread-42" }
      );

      expect(task.taskId).toBeDefined();
      expect(task.status).toBe("pending");
    });

    it("valid mission linkage still works after a failed one", async () => {
      // First: task with non-existent mission (fails silently)
      await arch.createTask("Orphan", "Bad link", { correlationId: "mission-999" });

      // Second: create a real mission and link a task to it
      await arch.call("create_mission", {
        title: "Real mission",
        description: "A real mission",
      });

      const task2 = await arch.createTask("Linked task", "Good link", {
        correlationId: "mission-1",
      });
      expect(task2.taskId).toBeDefined();

      // Verify the mission has the task linked
      const mission = await arch.call("get_mission", { missionId: "mission-1" });
      const parsed = JSON.parse(mission.content[0].text);
      expect(parsed.tasks).toContain(task2.taskId);
    });
  });

  // ── Additional Resilience Tests ───────────────────────────────────

  describe("Additional Resilience", () => {
    it("duplicate idempotency key rejected on second attempt", async () => {
      await arch.createTask("First", "Original task", { idempotencyKey: "unique-123" });

      await expect(
        arch.createTask("Duplicate", "Should fail", { idempotencyKey: "unique-123" })
      ).rejects.toThrow(/duplicate/);
    });

    it("cancelling a non-existent task throws E2EError", async () => {
      await expect(
        arch.cancelTask("task-nonexistent")
      ).rejects.toThrow();
    });

    it("reviewing a non-existent task throws E2EError", async () => {
      await expect(
        arch.createReview("task-nonexistent", "Review text")
      ).rejects.toThrow();
    });

    it("closing a non-existent proposal throws E2EError", async () => {
      await expect(
        eng.closeProposal("prop-nonexistent")
      ).rejects.toThrow();
    });
  });
});
