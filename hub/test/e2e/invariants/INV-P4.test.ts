/**
 * INV-P4 legacy Proposal implemented-terminal public surface retired by
 * proptool0.
 *
 * `close_proposal` is no longer LLM/MCP-callable. Proposal storage/history is
 * preserved and repository-level close semantics remain covered by substrate
 * tests; the public workflow cannot transition proposals to implemented.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestOrchestrator } from "../orchestrator.js";
import { assertInvP4 } from "../invariant-helpers.js";

describe("INV-P4 — public proposal close retired", () => {
  let orch: TestOrchestrator;

  beforeEach(() => {
    orch = TestOrchestrator.create();
  });

  it("helper coverage: assertInvP4 is retired/no-op", async () => {
    await expect(assertInvP4(orch, "all")).resolves.toBeUndefined();
  });

  it("close_proposal is absent from the public policy surface", async () => {
    const result = await orch.asEngineer().call("close_proposal", { proposalId: "prop-1" });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toMatch(/Unknown tool: close_proposal/);
  });
});
