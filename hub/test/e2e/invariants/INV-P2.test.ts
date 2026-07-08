/**
 * INV-P2 legacy Proposal status guard retired by proptool0.
 *
 * Public Proposal creation/review is no longer an active workflow surface.
 * Historical Proposal repository status semantics remain covered by repository
 * tests; public calls fail before any Proposal FSM transition can occur.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestOrchestrator } from "../orchestrator.js";
import { assertInvP2 } from "../invariant-helpers.js";

describe("INV-P2 — public proposal review status surface retired", () => {
  let orch: TestOrchestrator;

  beforeEach(() => {
    orch = TestOrchestrator.create();
  });

  it("helper coverage: assertInvP2 is retired/no-op", async () => {
    await expect(assertInvP2(orch, "all")).resolves.toBeUndefined();
  });

  it("create_proposal and create_proposal_review are absent with no store mutation", async () => {
    const eng = orch.asEngineer();
    const arch = orch.asArchitect();

    const create = await eng.call("create_proposal", { title: "P2", summary: "s", body: "b" });
    const review = await arch.call("create_proposal_review", {
      proposalId: "prop-1", decision: "approved", feedback: "blocked",
    });

    expect(create.isError).toBe(true);
    expect(JSON.parse(create.content[0].text).error).toMatch(/Unknown tool: create_proposal/);
    expect(review.isError).toBe(true);
    expect(JSON.parse(review.content[0].text).error).toMatch(/Unknown tool: create_proposal_review/);
    expect(await orch.stores.proposal.getProposals()).toHaveLength(0);
  });
});
