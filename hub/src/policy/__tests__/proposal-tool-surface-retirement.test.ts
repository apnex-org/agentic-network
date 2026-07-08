import { describe, expect, it } from "vitest";
import { PolicyRouter } from "../router.js";
import { registerProposalPolicy, approveProposalForDecision } from "../proposal-policy.js";
import { getActionSpec } from "../cascade.js";
import { AUTONOMOUS_STAGED_ACTION_TYPES, validateStagedActions } from "../staged-action-payloads.js";
import { createTestContext } from "../test-utils.js";
// Side-effect import registers the active cascade specs; create_proposal should
// remain absent even after the normal thread-policy bootstrap path runs.
import "../thread-policy.js";

const RETIRED_PROPOSAL_TOOLS = [
  "create_proposal",
  "create_proposal_review",
  "close_proposal",
  "get_proposal",
  "list_proposals",
] as const;

describe("proptool0 Proposal tool-surface retirement", () => {
  it("does not register retired Proposal tools on the active PolicyRouter surface", async () => {
    const router = new PolicyRouter(() => { /* silent */ });
    registerProposalPolicy(router);

    for (const tool of RETIRED_PROPOSAL_TOOLS) {
      expect(router.getAllToolNames()).not.toContain(tool);
      expect(router.has(tool)).toBe(false);

      const result = await router.handle(tool, {}, createTestContext({ role: "architect" }));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(`Unknown tool: ${tool}`);
    }
  });

  it("removes create_proposal from thread convergence vocabulary and cascade specs", () => {
    expect(AUTONOMOUS_STAGED_ACTION_TYPES).not.toContain("create_proposal");
    expect(getActionSpec("create_proposal" as never)).toBeUndefined();

    const validation = validateStagedActions([
      {
        id: "action-1",
        type: "create_proposal",
        status: "staged",
        payload: { title: "legacy proposal", description: "body" },
      },
    ]);
    if (validation.ok) throw new Error("create_proposal unexpectedly validated");
    expect(validation.errors[0]?.error).toContain("unknown autonomous action type");
  });

  it("keeps Proposal approval available only as an internal Decision bridge", async () => {
    const ctx = createTestContext({ role: "architect" });
    const proposal = await ctx.stores.proposal.submitProposal("T", "S", "B", undefined, {
      missions: [{ idRef: "m1", title: "M", description: "D" }],
    });

    const result = await approveProposalForDecision(proposal.id, "approved by decision", ctx);
    expect(result.isError).toBeFalsy();

    const updated = await ctx.stores.proposal.getProposal(proposal.id);
    expect(updated?.status).toBe("approved");
    expect(updated?.scaffoldResult?.missions).toHaveLength(1);
    expect(updated?.scaffoldResult?.tasks).toHaveLength(0);
  });
});
