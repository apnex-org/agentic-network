/**
 * INV-M4 — Mission `completed` and `abandoned` are terminal states with
 * no outbound transitions.
 *
 * workflow-registry.md §7.2. Mission FSM per `hub/src/entities/mission.ts`:
 *   proposed → active → completed
 *                    → abandoned
 *
 * Both `completed` and `abandoned` reject every outbound status
 * transition attempt.
 *
 * Ratified Wave-2 subset per
 * `docs/missions/mission-41-kickoff-decisions.md` §Decision 1.
 *
 * Mission-41 Wave 2 — task-336.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestOrchestrator } from "../orchestrator.js";
import { assertInvM4 } from "../invariant-helpers.js";

describe("INV-M4 — mission completed/abandoned are terminal", () => {
  let orch: TestOrchestrator;

  beforeEach(() => {
    orch = TestOrchestrator.create();
  });

  it("helper coverage: assertInvM4 all modes pass", async () => {
    await expect(assertInvM4(orch, "all")).resolves.toBeUndefined();
  });

  async function createActiveMission(title: string): Promise<string> {
    const arch = orch.asArchitect();
    const createResult = await arch.call("create_mission", {
      title, description: "INV-M4 coverage", documentRef: `docs/test/${title}.md`,
    });
    const missionId = JSON.parse(createResult.content[0].text).missionId as string;
    await arch.call("update_mission", { missionId, status: "active" });
    return missionId;
  }

  describe("completed is terminal — all outbound transitions rejected", () => {
    const TARGETS = ["proposed", "active", "abandoned"] as const;

    for (const target of TARGETS) {
      it(`completed → ${target} rejected`, async () => {
        const arch = orch.asArchitect();
        const missionId = await createActiveMission(`M4-completed-to-${target}`);
        await arch.call("update_mission", { missionId, status: "completed" });

        const result = await arch.call("update_mission", { missionId, status: target });
        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toMatch(/Invalid state transition/);
        expect(parsed.error).toMatch(/completed/);
        expect(parsed.error).toMatch(target);
      });
    }
  });

  describe("abandoned is terminal — all outbound transitions rejected", () => {
    const TARGETS = ["proposed", "active", "completed"] as const;

    for (const target of TARGETS) {
      it(`abandoned → ${target} rejected`, async () => {
        const arch = orch.asArchitect();
        const missionId = await createActiveMission(`M4-abandoned-to-${target}`);
        await arch.call("update_mission", { missionId, status: "abandoned" });

        const result = await arch.call("update_mission", { missionId, status: target });
        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toMatch(/Invalid state transition/);
        expect(parsed.error).toMatch(/abandoned/);
        expect(parsed.error).toMatch(target);
      });
    }
  });

  it("terminal-to-terminal transitions also rejected (completed ↔ abandoned)", async () => {
    // Documented separately because both directions exercise cross-terminal
    // rejection; the parametrized describe blocks above cover both
    // directions already, but this test pins the specific "completed →
    // abandoned" path that a careless caller might attempt (assuming
    // abandonment is a superset of completion).
    const arch = orch.asArchitect();
    const missionId = await createActiveMission("M4-completed-abandon");
    await arch.call("update_mission", { missionId, status: "completed" });

    const result = await arch.call("update_mission", { missionId, status: "abandoned" });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toMatch(/Invalid state transition/);
    expect(parsed.error).toMatch(/completed/);
    expect(parsed.error).toMatch(/abandoned/);
  });

  it("non-status fields on completed missions: policy behavior (description/documentRef pass-through)", async () => {
    // INV-M4 is about status-transition rejection. Non-status updates on
    // terminal missions (description, documentRef, plannedTasks) are a
    // separate policy concern. Pinning current behavior: attempting a
    // non-status update on completed passes through as a no-status-change
    // update. This test documents the boundary; if a future mission adds a
    // "terminal-is-frozen-entirely" invariant, it would land separately.
    const arch = orch.asArchitect();
    const missionId = await createActiveMission("M4-completed-desc-update");
    await arch.call("update_mission", { missionId, status: "completed" });

    const descUpdate = await arch.call("update_mission", {
      missionId, description: "updated-after-terminal",
    });
    // Current behavior: non-status update on terminal permitted. If it's
    // rejected, INV-M4 is over-reaching into non-status scope. Assert it
    // doesn't produce an "Invalid state transition" error (that's
    // status-specific).
    if (descUpdate.isError) {
      const parsed = JSON.parse(descUpdate.content[0].text);
      expect(parsed.error).not.toMatch(/Invalid state transition/);
    }
  });
});
