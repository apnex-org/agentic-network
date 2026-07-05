/**
 * idea-353 — render templates for the two new wake/stall event types.
 * Verifies the digest + stall-prompt surface the right LLM-facing content +
 * the correct host-namespaced tool verbs (the wake is only useful if the agent
 * is told exactly which tool to call next).
 */

import { describe, it, expect } from "vitest";
import { buildPromptText, getActionText } from "../../src/index.js";

const CFG = { toolPrefix: "mcp__plugin_agent-adapter_proxy__" };

describe("prompt-format — idea-353 work_claimable_digest (W1 inbound)", () => {
  it("renders the claimable count, role, and the list_ready_work → claim_work path", () => {
    const text = buildPromptText(
      "work_claimable_digest",
      { role: "engineer", count: 3, newCount: 2 },
      CFG,
    );
    expect(text).toContain("3 items");
    expect(text).toContain("engineer");
    expect(text).toContain("2 new");
    expect(text).toContain("mcp__plugin_agent-adapter_proxy__list_ready_work");
    expect(text).toContain("mcp__plugin_agent-adapter_proxy__claim_work");
  });

  it("singularizes for a single claimable item and omits the (new) clause when all are new", () => {
    const text = buildPromptText(
      "work_claimable_digest",
      { role: "verifier", count: 1, newCount: 1 },
      CFG,
    );
    expect(text).toContain("1 item ");
    expect(text).not.toContain("new)");
  });

  it("bug-226: the level-triggered marker renders the idle-entry basis; edge keeps the original", () => {
    const level = buildPromptText(
      "work_claimable_digest",
      { role: "engineer", count: 2, newCount: 2, trigger: "level" },
      CFG,
    );
    expect(level).toContain("surfaced on idle-entry");
    expect(level).toContain("already claimable while you were busy");
    const edge = buildPromptText(
      "work_claimable_digest",
      { role: "engineer", count: 2, newCount: 2, trigger: "edge" },
      CFG,
    );
    expect(edge).toContain("newly-claimable work appeared");
  });

  it("getActionText gives a short hint for the digest", () => {
    expect(getActionText("work_claimable_digest", { count: 2, role: "engineer" })).toContain(
      "list_ready_work",
    );
  });
});

describe("prompt-format — idea-353 work_lease_stall (W2 outbound)", () => {
  it("renders the workId, minutes-left, and the renew/block/abandon verbs", () => {
    const text = buildPromptText(
      "work_lease_stall",
      { workId: "work-7", msUntilExpiry: 5 * 60_000 },
      CFG,
    );
    expect(text).toContain("work-7");
    expect(text).toContain("~5m");
    expect(text).toContain("mcp__plugin_agent-adapter_proxy__renew_lease");
    expect(text).toContain("mcp__plugin_agent-adapter_proxy__block_work");
    expect(text).toContain("mcp__plugin_agent-adapter_proxy__abandon_work");
  });

  it("getActionText gives a short hint for the stall-prompt", () => {
    expect(getActionText("work_lease_stall", { workId: "work-7" })).toContain("work-7");
  });
});
