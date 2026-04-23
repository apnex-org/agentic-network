/**
 * INV-P4 — Proposal `implemented` is a terminal state with no outbound
 * transitions.
 *
 * workflow-registry.md §7.2. Ratified Wave-2 subset per
 * `docs/missions/mission-41-kickoff-decisions.md` §Decision 1.
 *
 * Mission-41 Wave 2 — task-332.
 *
 * Note: `close_proposal` is the FSM gate from approved/rejected/changes_requested
 * to `implemented` (see `MemoryProposalStore.closeProposal` at state.ts:1438).
 * Post-T3 (task-331), `create_proposal_review` also rejects non-submitted
 * proposals, so "implemented → review" now has a SECOND layer of protection
 * (the INV-P2 status guard) in addition to any INV-P4-specific rejection.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestOrchestrator } from "../orchestrator.js";
import { assertInvP4 } from "../invariant-helpers.js";

describe("INV-P4 — proposal implemented is terminal", () => {
  let orch: TestOrchestrator;

  beforeEach(() => {
    orch = TestOrchestrator.create();
  });

  it("helper coverage: assertInvP4 all modes pass", async () => {
    await expect(assertInvP4(orch, "all")).resolves.toBeUndefined();
  });

  it("close_proposal reaches implemented from approved", async () => {
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();

    await eng.createProposal("P4 reach", "summary", "body");
    await arch.call("create_proposal_review", {
      proposalId: "prop-1", decision: "approved", feedback: "ok",
    });
    const close = await eng.call("close_proposal", { proposalId: "prop-1" });
    expect(close.isError).toBeFalsy();
    const parsed = JSON.parse(close.content[0].text);
    expect(parsed.status).toBe("implemented");

    // Confirm store state.
    const stored = await orch.stores.proposal.getProposal("prop-1");
    expect(stored?.status).toBe("implemented");
  });

  it("implemented → close_proposal rejected (no self-terminal re-transition)", async () => {
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();

    await eng.createProposal("P4 double-close", "summary", "body");
    await arch.call("create_proposal_review", {
      proposalId: "prop-1", decision: "approved", feedback: "ok",
    });
    await eng.call("close_proposal", { proposalId: "prop-1" });
    // Proposal is now implemented.
    const second = await eng.call("close_proposal", { proposalId: "prop-1" });
    expect(second.isError).toBe(true);
    const parsed = JSON.parse(second.content[0].text);
    expect(parsed.error).toMatch(/not found or not in a reviewable state/);
  });

  it("implemented → create_proposal_review rejected (INV-P2 status guard catches this too)", async () => {
    // Post-T3 (INV-P2 bundled fix), the status guard also protects this
    // path — review on implemented returns "Invalid state transition"
    // with `implemented` named. This test pins that operator-diagnosable
    // text shape so future guard refactors surface here.
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();

    await eng.createProposal("P4 review-after-implement", "summary", "body");
    await arch.call("create_proposal_review", {
      proposalId: "prop-1", decision: "approved", feedback: "ok",
    });
    await eng.call("close_proposal", { proposalId: "prop-1" });
    // Attempt review on implemented proposal.
    const reReview = await arch.call("create_proposal_review", {
      proposalId: "prop-1", decision: "rejected", feedback: "should block",
    });
    expect(reReview.isError).toBe(true);
    const parsed = JSON.parse(reReview.content[0].text);
    expect(parsed.error).toMatch(/Invalid state transition/);
    expect(parsed.error).toMatch(/implemented/);
    expect(parsed.error).toMatch(/submitted/);
  });
});
