/**
 * INV-I2 — Idea auto-linkage failure is non-fatal — the idea still
 * updates even when the linkage target cannot be resolved.
 *
 * workflow-registry.md §7.2. Graceful-degradation invariant (no
 * rejection semantic). The idea store intentionally trusts caller-supplied
 * linkage IDs without validation — the mission-linkage view is a virtual
 * projection over `idea.missionId` (see `idea-policy.ts:205-206`), so a
 * bad missionId just produces a dangling pointer that surfaces later via
 * list_ideas filters rather than blocking the update.
 *
 * Ratified Wave-2 subset per
 * `docs/missions/mission-41-kickoff-decisions.md` §Decision 1.
 *
 * Mission-41 Wave 2 — task-335.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestOrchestrator } from "../orchestrator.js";
import { assertInvI2 } from "../invariant-helpers.js";

describe("INV-I2 — idea auto-linkage failure is non-fatal", () => {
  let orch: TestOrchestrator;

  beforeEach(() => {
    orch = TestOrchestrator.create();
  });

  it("helper coverage: assertInvI2 positive mode passes", async () => {
    // Only positive mode is meaningful for this graceful-degradation
    // invariant (no rejection semantic to exercise in negativeReject/edge).
    await expect(assertInvI2(orch, "positive")).resolves.toBeUndefined();
  });

  it("create_idea with non-existent sourceThreadId succeeds + stores the dangling reference", async () => {
    const eng = orch.asEngineer();
    const result = await eng.call("create_idea", {
      text: "bad-thread-linkage test",
      sourceThreadId: "thread-nonexistent",
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ideaId).toMatch(/^idea-/);

    // Idea persisted with the dangling pointer (store intentionally
    // doesn't validate — operators can audit post-hoc via list_ideas).
    const stored = await orch.stores.idea.getIdea(parsed.ideaId);
    expect(stored?.sourceThreadId).toBe("thread-nonexistent");
  });

  it("update_idea with non-existent missionId succeeds + stores the dangling reference", async () => {
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();

    // Engineer creates idea.
    const createResult = await eng.call("create_idea", { text: "bad-mission-linkage test" });
    const ideaId = JSON.parse(createResult.content[0].text).ideaId;

    // Architect attempts to link to a non-existent mission. Per
    // updateIdea policy, this sets missionId = the bad value + flips
    // status to incorporated (no upstream validation of mission
    // existence).
    const updateResult = await arch.call("update_idea", {
      ideaId, missionId: "mission-nonexistent",
    });
    expect(updateResult.isError).toBeFalsy();
    const parsed = JSON.parse(updateResult.content[0].text);
    expect(parsed.missionId).toBe("mission-nonexistent");
    expect(parsed.status).toBe("incorporated");

    // Idea persisted with dangling pointer.
    const stored = await orch.stores.idea.getIdea(ideaId);
    expect(stored?.missionId).toBe("mission-nonexistent");
    expect(stored?.status).toBe("incorporated");
  });

  it("update_idea with real missionId also succeeds (contrast — invariant holds in happy path)", async () => {
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();

    // Create a real mission first.
    const missionResult = await arch.call("create_mission", {
      title: "I2 positive-linkage", description: "real mission", documentRef: "docs/test/I2.md",
    });
    const missionId = JSON.parse(missionResult.content[0].text).missionId;

    const ideaResult = await eng.call("create_idea", { text: "good-linkage test" });
    const ideaId = JSON.parse(ideaResult.content[0].text).ideaId;

    const linkResult = await arch.call("update_idea", { ideaId, missionId });
    expect(linkResult.isError).toBeFalsy();
    const parsed = JSON.parse(linkResult.content[0].text);
    expect(parsed.missionId).toBe(missionId);
    expect(parsed.status).toBe("incorporated");
  });

  it("multiple bad-linkage update in sequence — all succeed non-fatally", async () => {
    // Simulates operator error: multiple attempts with dangling
    // references. Invariant holds for every call.
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();

    const ideaResult = await eng.call("create_idea", {
      text: "multi-bad test",
      sourceThreadId: "thread-phantom-1",
    });
    const ideaId = JSON.parse(ideaResult.content[0].text).ideaId;

    // First: bad missionId.
    const r1 = await arch.call("update_idea", { ideaId, missionId: "mission-phantom-a" });
    expect(r1.isError).toBeFalsy();

    // Second: update with tags (no missionId change). Idea still updates.
    const r2 = await arch.call("update_idea", { ideaId, tags: ["phantom-tag"] });
    expect(r2.isError).toBeFalsy();

    // Final state: all caller-supplied values persisted; status was
    // flipped to incorporated on first update (r1) and remains so.
    const stored = await orch.stores.idea.getIdea(ideaId);
    expect(stored?.sourceThreadId).toBe("thread-phantom-1");
    expect(stored?.missionId).toBe("mission-phantom-a");
    expect(stored?.tags).toContain("phantom-tag");
    expect(stored?.status).toBe("incorporated");
  });
});
