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

});
