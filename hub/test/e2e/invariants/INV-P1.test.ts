/**
 * INV-P1 legacy Proposal RBAC retired by proptool0.
 *
 * The public Proposal review tool is no longer an active PolicyRouter/MCP
 * surface. RBAC of historical storage internals is not LLM-callable; Decision
 * `approve(proposalRef)` remains covered separately through the internal bridge.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestOrchestrator } from "../orchestrator.js";
import { assertInvP1 } from "../invariant-helpers.js";

describe("INV-P1 — public proposal review retired", () => {
  let orch: TestOrchestrator;

  beforeEach(() => {
    orch = TestOrchestrator.create();
  });

  it("helper coverage: assertInvP1 is retired/no-op", async () => {
    await expect(assertInvP1(orch, "all")).resolves.toBeUndefined();
  });

  it("create_proposal_review is absent for engineer, architect, and unknown sessions", async () => {
    const engineerResult = await orch.asEngineer().call("create_proposal_review", {
      proposalId: "prop-1", decision: "approved", feedback: "blocked",
    });
    const architectResult = await orch.asArchitect().call("create_proposal_review", {
      proposalId: "prop-1", decision: "approved", feedback: "blocked",
    });
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
        metrics: orch.metrics,
      },
    );

    for (const result of [engineerResult, architectResult, unknownResult]) {
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error).toMatch(/Unknown tool: create_proposal_review/);
    }
  });
});
