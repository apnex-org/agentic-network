/**
 * canonical-fixtures.test.ts — proves the idea-414 fixture-fidelity guard.
 *
 * The factory's value is that a fixture built here CANNOT drift from the
 * canonical wire shape: it is produced by the real `projectAgent()`. These
 * tests pin the properties that make mission-99's self-exclusion bug class
 * un-reproducible with these fixtures.
 */

import { describe, it, expect } from "vitest";
import { projectAgent } from "../../src/policy/agent-projection.js";
import { makeAgent, makeAgentProjection, makeGetAgentsResponse } from "./canonical-fixtures.js";

describe("canonical-fixtures — idea-414 fixture-fidelity guard", () => {
  it("makeAgentProjection exposes canonical `id`, NEVER `agentId` (the mission-99 bug shape)", () => {
    const proj = makeAgentProjection({ id: "eng-abc" });
    expect(proj.id).toBe("eng-abc");
    // The exact self-confirming shape mission-99 shipped: a hand-authored
    // fixture with `agentId`. The canonical projection must not carry it.
    expect("agentId" in (proj as Record<string, unknown>)).toBe(false);
  });

  it("is canonical BY CONSTRUCTION — deep-equals a direct projectAgent() call", () => {
    // The fixture IS the projection function's output, so it can never
    // diverge from the real wire shape (unlike a hand-authored literal).
    const proj = makeAgentProjection();
    const direct = projectAgent(makeAgent(), 1_767_225_600_000);
    expect(proj).toEqual(direct);
  });

  it("only canonical fields surface — internal Agent fields stay off the wire", () => {
    const proj = makeAgentProjection() as Record<string, unknown>;
    for (const internal of [
      "fingerprint",
      "currentSessionId",
      "sessionEpoch",
      "archived",
      "recentErrors",
      "restartHistoryMs",
      "status",
    ]) {
      expect(internal in proj).toBe(false);
    }
  });

  it("agentOverrides propagate through the projection", () => {
    const proj = makeAgentProjection({ name: "steve", role: "verifier", livenessState: "degraded" });
    expect(proj.name).toBe("steve");
    expect(proj.role).toBe("verifier");
    expect(proj.livenessState).toBe("degraded");
  });

  it("makeGetAgentsResponse wraps projections in the get_agents envelope", () => {
    const env = makeGetAgentsResponse([
      makeAgentProjection({ id: "a1", name: "lily" }),
      makeAgentProjection({ id: "a2", name: "gus" }),
    ]);
    expect(env.agents.map((a) => a.name)).toEqual(["lily", "gus"]);
    expect(env.agents.every((a) => "id" in a && !("agentId" in a))).toBe(true);
  });

  it("fixtures are deterministic — no wall-clock dependence", () => {
    expect(makeAgentProjection()).toEqual(makeAgentProjection());
  });
});
