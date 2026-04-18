/**
 * FSM Enforcement Tests — Negative Path Validation
 *
 * These tests explicitly attempt INVALID state transitions and verify
 * the PolicyRouter correctly rejects them. Derived from the Workflow
 * Registry (specs/workflow-registry.md) FSM declarations.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestOrchestrator } from "./orchestrator.js";
import type { ActorFacade } from "./orchestrator.js";

describe("FSM Enforcement", () => {
  let orch: TestOrchestrator;
  let arch: ActorFacade;
  let eng: ActorFacade;

  beforeEach(() => {
    orch = TestOrchestrator.create();
    arch = orch.asArchitect();
    eng = orch.asEngineer();
  });

  // ── Task FSM ──────────────────────────────────────────────────────

  describe("Task FSM", () => {
    it("rejects report on pending task (must be working)", async () => {
      await arch.createTask("Pending task", "Not yet picked up");

      // Task is pending — engineer tries to report without picking up
      await expect(
        eng.createReport("task-1", "Done", "Completed")
      ).rejects.toThrow(/Invalid state transition.*pending.*must be.*working/);
    });

    it("rejects report on in_review task (already reported)", async () => {
      await arch.createTask("Will complete", "Do it");
      await eng.getTask();
      await eng.createReport("task-1", "Done", "OK");

      // Task is now in_review — try to report again
      await expect(
        eng.createReport("task-1", "Done again", "Double report")
      ).rejects.toThrow(/Invalid state transition.*in_review/);
    });

    it("rejects report on cancelled task (terminal state)", async () => {
      await arch.createTask("Will cancel", "Cancel this");
      await arch.cancelTask("task-1");

      // Task is cancelled — try to report
      await expect(
        eng.createReport("task-1", "Done", "Can't report cancelled")
      ).rejects.toThrow(/Invalid state transition.*cancelled/);
    });

    it("rejects report on blocked task", async () => {
      await arch.createTask("Parent", "Parent task");
      await arch.createTask("Blocked child", "Depends on parent", {
        dependsOn: ["task-1"],
      });

      // task-2 is blocked — try to report on it
      await expect(
        eng.createReport("task-2", "Done", "Can't report blocked")
      ).rejects.toThrow(/Invalid state transition.*blocked/);
    });

    it("rejects report on input_required task (must resolve clarification first)", async () => {
      await arch.createTask("Needs clarification", "Unclear");
      await eng.getTask();
      await eng.requestClarification("task-1", "What should I do?");

      // Task is input_required — try to report
      await expect(
        eng.createReport("task-1", "Done", "Can't report while awaiting clarification")
      ).rejects.toThrow(/Invalid state transition.*input_required/);
    });

    it("permits cancel on working task (stewardship for stranded work — thread-131 widening)", async () => {
      await arch.createTask("Working task", "Being worked on");
      await eng.getTask();

      // Working is cancellable for stewardship (engineer went offline,
      // task needs to be reclaimed). Previously pending-only; widened
      // in the thread-131 fix-up after 3 kate-stranded tasks could not
      // be cancelled by Architect.
      const result = await arch.cancelTask("task-1");
      expect(result).toBeTruthy();
    });

    it("in_review rejects cancel and clarification", async () => {
      await arch.createTask("Terminal test", "Complete it");
      await eng.getTask();
      await eng.createReport("task-1", "Done", "OK");

      // Task is now in_review — try to cancel
      await expect(arch.cancelTask("task-1")).rejects.toThrow();

      // Try to request clarification on an in_review task
      await expect(eng.requestClarification("task-1", "Question?")).rejects.toThrow();
    });
  });

  // ── Idea FSM ──────────────────────────────────────────────────────

  describe("Idea FSM", () => {
    it("rejects incorporated → triaged (incorporated is near-terminal)", async () => {
      await eng.call("create_idea", { text: "Test idea" });
      // Incorporate it
      await arch.call("update_idea", { ideaId: "idea-1", status: "incorporated" });

      // Try to move back to triaged
      const result = await arch.call("update_idea", { ideaId: "idea-1", status: "triaged" });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("Invalid state transition");
      expect(parsed.error).toContain("incorporated");
      expect(parsed.error).toContain("triaged");
    });

    it("rejects incorporated → open", async () => {
      await eng.call("create_idea", { text: "Test idea" });
      await arch.call("update_idea", { ideaId: "idea-1", status: "incorporated" });

      const result = await arch.call("update_idea", { ideaId: "idea-1", status: "open" });
      expect(result.isError).toBe(true);
    });

    it("allows open → triaged (valid transition)", async () => {
      await eng.call("create_idea", { text: "Test idea" });

      const result = await arch.call("update_idea", { ideaId: "idea-1", status: "triaged" });
      expect(result.isError).toBeUndefined();
    });

    it("allows open → dismissed (valid transition)", async () => {
      await eng.call("create_idea", { text: "Bad idea" });

      const result = await arch.call("update_idea", { ideaId: "idea-1", status: "dismissed" });
      expect(result.isError).toBeUndefined();
    });

    it("allows dismissed → open (re-opening)", async () => {
      await eng.call("create_idea", { text: "Reconsidered idea" });
      await arch.call("update_idea", { ideaId: "idea-1", status: "dismissed" });

      const result = await arch.call("update_idea", { ideaId: "idea-1", status: "open" });
      expect(result.isError).toBeUndefined();
    });

    it("rejects dismissed → triaged (must re-open first)", async () => {
      await eng.call("create_idea", { text: "Dismissed idea" });
      await arch.call("update_idea", { ideaId: "idea-1", status: "dismissed" });

      const result = await arch.call("update_idea", { ideaId: "idea-1", status: "triaged" });
      expect(result.isError).toBe(true);
    });
  });

  // ── Mission FSM ───────────────────────────────────────────────────

  describe("Mission FSM", () => {
    it("rejects completed → active (terminal state)", async () => {
      await arch.call("create_mission", { title: "M", description: "D" });
      await arch.call("update_mission", { missionId: "mission-1", status: "active" });
      await arch.call("update_mission", { missionId: "mission-1", status: "completed" });

      // Try to reactivate
      const result = await arch.call("update_mission", { missionId: "mission-1", status: "active" });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("Invalid state transition");
      expect(parsed.error).toContain("completed");
    });

    it("rejects abandoned → active (terminal state)", async () => {
      await arch.call("create_mission", { title: "M", description: "D" });
      await arch.call("update_mission", { missionId: "mission-1", status: "abandoned" });

      const result = await arch.call("update_mission", { missionId: "mission-1", status: "active" });
      expect(result.isError).toBe(true);
    });

    it("rejects proposed → completed (must activate first)", async () => {
      await arch.call("create_mission", { title: "M", description: "D" });

      const result = await arch.call("update_mission", { missionId: "mission-1", status: "completed" });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("proposed");
      expect(parsed.error).toContain("completed");
    });

    it("allows proposed → active → completed (valid path)", async () => {
      await arch.call("create_mission", { title: "M", description: "D" });

      const r1 = await arch.call("update_mission", { missionId: "mission-1", status: "active" });
      expect(r1.isError).toBeUndefined();

      const r2 = await arch.call("update_mission", { missionId: "mission-1", status: "completed" });
      expect(r2.isError).toBeUndefined();
    });

    it("allows proposed → abandoned (shortcut)", async () => {
      await arch.call("create_mission", { title: "M", description: "D" });

      const r = await arch.call("update_mission", { missionId: "mission-1", status: "abandoned" });
      expect(r.isError).toBeUndefined();
    });
  });

  // ── Turn FSM ──────────────────────────────────────────────────────

  describe("Turn FSM", () => {
    it("rejects completed → planning (terminal state)", async () => {
      await arch.call("create_turn", { title: "T", scope: "S" });
      await arch.call("update_turn", { turnId: "turn-1", status: "active" });
      await arch.call("update_turn", { turnId: "turn-1", status: "completed" });

      const result = await arch.call("update_turn", { turnId: "turn-1", status: "planning" });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("Invalid state transition");
    });

    it("rejects planning → completed (must activate first)", async () => {
      await arch.call("create_turn", { title: "T", scope: "S" });

      const result = await arch.call("update_turn", { turnId: "turn-1", status: "completed" });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("planning");
      expect(parsed.error).toContain("completed");
    });

    it("allows planning → active → completed (valid path)", async () => {
      await arch.call("create_turn", { title: "T", scope: "S" });

      const r1 = await arch.call("update_turn", { turnId: "turn-1", status: "active" });
      expect(r1.isError).toBeUndefined();

      const r2 = await arch.call("update_turn", { turnId: "turn-1", status: "completed" });
      expect(r2.isError).toBeUndefined();
    });

    it("rejects active → planning (no backward transitions)", async () => {
      await arch.call("create_turn", { title: "T", scope: "S" });
      await arch.call("update_turn", { turnId: "turn-1", status: "active" });

      const result = await arch.call("update_turn", { turnId: "turn-1", status: "planning" });
      expect(result.isError).toBe(true);
    });
  });
});
