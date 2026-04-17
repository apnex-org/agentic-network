/**
 * Mission-19 — Selector engine semantics.
 *
 * Covers: labelsMatch AND-equality, role OR × label AND, engineerId pin,
 * empty-selector matches-all, empty-labels matches empty-selector only.
 *
 * Registry invariants: INV-SYS-L01..L04, INV-AG3.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  MemoryEngineerRegistry,
  labelsMatch,
  type RegisterAgentPayload,
  type AgentClientMetadata,
  type AgentLabels,
  type AgentRole,
} from "../../src/state.js";

const CLIENT: AgentClientMetadata = {
  clientName: "claude-code",
  clientVersion: "0.1.0",
  proxyName: "@ois/claude-plugin",
  proxyVersion: "1.0.0",
};

function makePayload(instanceId: string, role: AgentRole, labels?: AgentLabels): RegisterAgentPayload {
  return {
    globalInstanceId: instanceId,
    role,
    clientMetadata: CLIENT,
    labels,
  };
}

describe("Mission-19 Selector — labelsMatch helper", () => {
  it("AND-equality: every key/value in matchLabels must appear on the agent", () => {
    const agent: AgentLabels = { team: "platform", env: "prod" };
    expect(labelsMatch(agent, { team: "platform" })).toBe(true);
    expect(labelsMatch(agent, { team: "platform", env: "prod" })).toBe(true);
    expect(labelsMatch(agent, { team: "platform", env: "staging" })).toBe(false);
    expect(labelsMatch(agent, { missing: "x" })).toBe(false);
  });

  it("empty or absent matchLabels does not restrict (INV-AG3)", () => {
    expect(labelsMatch({}, {})).toBe(true);
    expect(labelsMatch({}, undefined)).toBe(true);
    expect(labelsMatch({ team: "x" }, {})).toBe(true);
    expect(labelsMatch({ team: "x" }, undefined)).toBe(true);
  });

  it("empty agent labels cannot satisfy a non-empty matchLabels", () => {
    expect(labelsMatch({}, { team: "platform" })).toBe(false);
  });

  it("value mismatch on a present key is a miss", () => {
    expect(labelsMatch({ team: "platform" }, { team: "network" })).toBe(false);
  });
});

describe("Mission-19 Selector — selectAgents", () => {
  let reg: MemoryEngineerRegistry;

  beforeEach(async () => {
    reg = new MemoryEngineerRegistry();
    // Three agents with varied roles and labels.
    await reg.registerAgent("sess-eng-a", "engineer",
      makePayload("inst-eng-a", "engineer", { team: "platform", env: "prod" }));
    await reg.registerAgent("sess-eng-b", "engineer",
      makePayload("inst-eng-b", "engineer", { team: "platform", env: "staging" }));
    await reg.registerAgent("sess-arch", "architect",
      makePayload("inst-arch", "architect", { team: "platform", env: "prod" }));
  });

  it("empty selector matches every online agent (INV-AG3 corollary)", async () => {
    const matched = await reg.selectAgents({});
    expect(matched).toHaveLength(3);
  });

  it("roles-only selector filters by role (OR across roles)", async () => {
    const engineers = await reg.selectAgents({ roles: ["engineer"] });
    expect(engineers).toHaveLength(2);
    expect(engineers.every((a) => a.role === "engineer")).toBe(true);

    const both = await reg.selectAgents({ roles: ["engineer", "architect"] });
    expect(both).toHaveLength(3);
  });

  it("matchLabels-only filters by AND-equality on labels (INV-SYS-L02)", async () => {
    const prod = await reg.selectAgents({ matchLabels: { env: "prod" } });
    expect(prod).toHaveLength(2); // eng-a + arch
    const engineerIds = prod.map((a) => a.engineerId).sort();
    expect(engineerIds).toEqual(prod.map((a) => a.engineerId).sort());
    expect(prod.every((a) => a.labels.env === "prod")).toBe(true);
  });

  it("roles + matchLabels combine with AND (INV-SYS-L03)", async () => {
    const matched = await reg.selectAgents({
      roles: ["engineer"],
      matchLabels: { env: "prod" },
    });
    expect(matched).toHaveLength(1);
    expect(matched[0].role).toBe("engineer");
    expect(matched[0].labels.env).toBe("prod");
  });

  it("roles + matchLabels with no overlap yields zero matches", async () => {
    const matched = await reg.selectAgents({
      roles: ["architect"],
      matchLabels: { env: "staging" },
    });
    expect(matched).toHaveLength(0);
  });

  it("engineerId pin overrides pool selection (INV-SYS-L04)", async () => {
    const ab = await reg.selectAgents({ roles: ["engineer"] });
    expect(ab).toHaveLength(2);
    const target = ab[0];

    const pinned = await reg.selectAgents({ engineerId: target.engineerId });
    expect(pinned).toHaveLength(1);
    expect(pinned[0].engineerId).toBe(target.engineerId);
  });

  it("engineerId + matchLabels: the pinned agent must also satisfy the label filter", async () => {
    const engineers = await reg.selectAgents({ roles: ["engineer"] });
    const engA = engineers.find((a) => a.labels.env === "prod")!;
    const engB = engineers.find((a) => a.labels.env === "staging")!;

    // Prod pin + prod label → hit
    const hit = await reg.selectAgents({
      engineerId: engA.engineerId,
      matchLabels: { env: "prod" },
    });
    expect(hit).toHaveLength(1);

    // Staging pin + prod label → miss (the pin is valid but the labels don't match)
    const miss = await reg.selectAgents({
      engineerId: engB.engineerId,
      matchLabels: { env: "prod" },
    });
    expect(miss).toHaveLength(0);
  });

  it("offline and archived agents are excluded from selection", async () => {
    const all = await reg.listAgents();
    const victim = all.find((a) => a.labels.env === "staging")!;
    await reg.markAgentOffline(victim.currentSessionId!);

    const prodOrStaging = await reg.selectAgents({ roles: ["engineer"] });
    expect(prodOrStaging).toHaveLength(1); // only eng-a (prod) remains online
    expect(prodOrStaging[0].labels.env).toBe("prod");
  });

  it("stale/unknown engineerId returns zero matches (INV-SYS-L05)", async () => {
    const miss = await reg.selectAgents({ engineerId: "eng-does-not-exist" });
    expect(miss).toHaveLength(0);
  });
});
