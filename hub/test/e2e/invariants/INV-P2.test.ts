/**
 * INV-P2 — Only `submitted` proposals are reviewable.
 *
 * workflow-registry.md §7.2 flagged this as the gap-surfacing ratchet:
 * pre-mission-41 the proposal-policy had NO status guard on
 * `create_proposal_review` — any proposal in any state could be reviewed.
 *
 * This task (Mission-41 Wave 2 T3 / task-331) **closes** the gap: the
 * policy guard at `proposal-policy.ts:createProposalReview` rejects
 * non-submitted proposals with "Invalid state transition" error text.
 *
 * Mission-41 kickoff-decisions §Decision 1 ratified the bundled atomic
 * scope (test + policy fix in one commit) — ratchet closes here.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestOrchestrator } from "../orchestrator.js";
import { assertInvP2 } from "../invariant-helpers.js";

describe("INV-P2 — only submitted proposals are reviewable", () => {
  let orch: TestOrchestrator;

  beforeEach(() => {
    orch = TestOrchestrator.create();
  });

  it("helper coverage: assertInvP2 all modes pass (ratchet now GREEN post-guard)", async () => {
    // Before Wave 2 T3: this would throw on `negativeReject` mode because
    // the policy accepted re-reviews. Post-guard: all modes pass.
    await expect(assertInvP2(orch, "all")).resolves.toBeUndefined();
  });

  it("review on submitted proposal succeeds (positive)", async () => {
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();

    await eng.createProposal("P2 positive", "summary", "body");
    const result = await arch.call("create_proposal_review", {
      proposalId: "prop-1", decision: "approved", feedback: "LGTM",
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.decision).toBe("approved");
    // Verify the proposal's status flipped via a direct read.
    const stored = await orch.stores.proposal.getProposal("prop-1");
    expect(stored?.status).toBe("approved");
  });

  it("review on approved proposal is rejected", async () => {
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();

    await eng.createProposal("P2 approved-reject", "summary", "body");
    await arch.call("create_proposal_review", {
      proposalId: "prop-1", decision: "approved", feedback: "first",
    });
    // Proposal is now `approved`. Second review should be rejected by the guard.
    const second = await arch.call("create_proposal_review", {
      proposalId: "prop-1", decision: "rejected", feedback: "second",
    });
    expect(second.isError).toBe(true);
    const parsed = JSON.parse(second.content[0].text);
    expect(parsed.error).toMatch(/Invalid state transition/);
    expect(parsed.error).toMatch(/approved/);
    expect(parsed.error).toMatch(/submitted/);
  });

  it("review on rejected proposal is rejected", async () => {
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();

    await eng.createProposal("P2 rejected-reject", "summary", "body");
    await arch.call("create_proposal_review", {
      proposalId: "prop-1", decision: "rejected", feedback: "first",
    });
    // Proposal is now `rejected`. Second review blocked.
    const second = await arch.call("create_proposal_review", {
      proposalId: "prop-1", decision: "approved", feedback: "should block",
    });
    expect(second.isError).toBe(true);
    const parsed = JSON.parse(second.content[0].text);
    expect(parsed.error).toMatch(/Invalid state transition/);
    expect(parsed.error).toMatch(/rejected/);
  });

  it("review on changes_requested proposal is rejected", async () => {
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();

    await eng.createProposal("P2 changes-requested-reject", "summary", "body");
    await arch.call("create_proposal_review", {
      proposalId: "prop-1", decision: "changes_requested", feedback: "revise",
    });
    // Proposal is now `changes_requested`. Second review blocked.
    const second = await arch.call("create_proposal_review", {
      proposalId: "prop-1", decision: "approved", feedback: "should block",
    });
    expect(second.isError).toBe(true);
    const parsed = JSON.parse(second.content[0].text);
    expect(parsed.error).toMatch(/Invalid state transition/);
    expect(parsed.error).toMatch(/changes_requested/);
  });

  it("review on implemented proposal is rejected", async () => {
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();

    await eng.createProposal("P2 implemented-reject", "summary", "body");
    await arch.call("create_proposal_review", {
      proposalId: "prop-1", decision: "approved", feedback: "approve",
    });
    await eng.call("close_proposal", { proposalId: "prop-1" });
    // Proposal is now `implemented`. Review blocked.
    const second = await arch.call("create_proposal_review", {
      proposalId: "prop-1", decision: "rejected", feedback: "should block",
    });
    expect(second.isError).toBe(true);
    const parsed = JSON.parse(second.content[0].text);
    expect(parsed.error).toMatch(/Invalid state transition/);
    expect(parsed.error).toMatch(/implemented/);
  });
});
