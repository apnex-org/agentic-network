/**
 * INV-P1 — Only the Architect can review proposals. Enforced at the
 * PolicyRouter RBAC gate via `create_proposal_review`'s [Architect] role
 * tag (see `hub/src/policy/router.ts:119-128`).
 *
 * workflow-registry.md §7.2. Ratified Wave-2 subset per
 * `docs/missions/mission-41-kickoff-decisions.md` §Decision 1.
 *
 * Mission-41 Wave 2 — task-330.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestOrchestrator } from "../orchestrator.js";
import { assertInvP1 } from "../invariant-helpers.js";

describe("INV-P1 — architect-only proposal review (RBAC)", () => {
  let orch: TestOrchestrator;

  beforeEach(() => {
    orch = TestOrchestrator.create();
  });

  it("helper coverage: assertInvP1 all modes pass", async () => {
    await expect(assertInvP1(orch, "all")).resolves.toBeUndefined();
  });

  it("Authorization-denied error shape names both caller and permitted roles", async () => {
    // This test pins the specific error-text shape from router.ts:125 so
    // future RBAC-error refactors (e.g. structured error codes, i18n)
    // surface via a failing invariant test rather than by downstream
    // diagnosis confusion. Required fields: caller role, permitted role
    // name, "Authorization denied" prefix.
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();

    await eng.createProposal("P1 shape", "summary", "body");
    const result = await eng.call("create_proposal_review", {
      proposalId: "prop-1",
      decision: "approved",
      feedback: "should be blocked",
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toMatch(/^Authorization denied:/);
    expect(parsed.error).toMatch(/create_proposal_review/);
    expect(parsed.error).toMatch(/architect/);
    expect(parsed.error).toMatch(/engineer/);

    // Conversely, architect call succeeds (positive-path confirmation of
    // the same RBAC boundary).
    const archResult = await arch.call("create_proposal_review", {
      proposalId: "prop-1",
      decision: "approved",
      feedback: "LGTM",
    });
    expect(archResult.isError).toBeFalsy();
  });

  it("unregistered-session bypass: RBAC allows 'unknown' role through (backward compat)", async () => {
    // router.ts:120 — `tool.roles.has("any") || callerRole === "unknown"`
    // short-circuits the RBAC check. This pins the back-compat carve-out
    // so a future "tighten RBAC" refactor surfaces here rather than
    // silently breaking legacy adapters.
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();

    // Setup: architect creates a proposal via engineer (proposals are
    // engineer-initiated). Architect registers itself first so the
    // unregistered-session bypass test uses a genuinely-unregistered
    // session.
    await eng.createProposal("P1 bypass", "summary", "body");
    await arch.listTasks(); // ensure architect is registered
    // Register_role on a fresh session would register it; we want an
    // unregistered session. Use router.handle directly with a session
    // that's never been through register_role.
    const unknownResult = await orch.router.handle(
      "create_proposal_review",
      { proposalId: "prop-1", decision: "approved", feedback: "unknown-role path" },
      {
        stores: orch.stores,
        emit: async () => {},
        dispatch: async () => {},
        sessionId: "session-never-registered",
        clientIp: "127.0.0.1",
        role: "unknown",
        internalEvents: [],
        config: { storageBackend: "memory", gcsBucket: "" },
        metrics: orch.metrics,
      },
    );
    // RBAC bypass → handler runs. Outcome depends on proposal state, but
    // the KEY assertion is: no "Authorization denied" error — the gate let
    // the unknown-role caller through.
    if (unknownResult.isError) {
      const parsed = JSON.parse(unknownResult.content[0].text);
      expect(parsed.error ?? "").not.toMatch(/Authorization denied/);
    }
  });
});
