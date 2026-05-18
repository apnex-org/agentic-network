/**
 * Mission-19 — Selector engine semantics.
 *
 * Covers: labelsMatch AND-equality, role OR × label AND, agentId pin,
 * empty-selector matches-all, empty-labels matches empty-selector only.
 *
 * Registry invariants: INV-SYS-L01..L04, INV-AG3.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  labelsMatch,
  type RegisterAgentPayload,
  type AgentClientMetadata,
  type AgentLabels,
  type AgentRole,
} from "../../src/state.js";
import { AgentRepositorySubstrate as AgentRepository } from "../../src/entities/agent-repository-substrate.js";
import { createMemoryStorageSubstrate } from "../../src/storage-substrate/index.js";

const CLIENT: AgentClientMetadata = {
  clientName: "claude-code",
  clientVersion: "0.1.0",
  proxyName: "@apnex/claude-plugin",
  proxyVersion: "1.0.0",
};

function makePayload(instanceId: string, role: AgentRole, labels?: AgentLabels): RegisterAgentPayload {
  return {
    name: instanceId,
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
  let reg: AgentRepository;

  beforeEach(async () => {
    reg = new AgentRepository(createMemoryStorageSubstrate());
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
    const agentIds = prod.map((a) => a.id).sort();
    expect(agentIds).toEqual(prod.map((a) => a.id).sort());
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

  it("agentId pin overrides pool selection (INV-SYS-L04)", async () => {
    const ab = await reg.selectAgents({ roles: ["engineer"] });
    expect(ab).toHaveLength(2);
    const target = ab[0];

    const pinned = await reg.selectAgents({ agentId: target.id });
    expect(pinned).toHaveLength(1);
    expect(pinned[0].id).toBe(target.id);
  });

  it("agentId + matchLabels: the pinned agent must also satisfy the label filter", async () => {
    const engineers = await reg.selectAgents({ roles: ["engineer"] });
    const engA = engineers.find((a) => a.labels.env === "prod")!;
    const engB = engineers.find((a) => a.labels.env === "staging")!;

    // Prod pin + prod label → hit
    const hit = await reg.selectAgents({
      agentId: engA.id,
      matchLabels: { env: "prod" },
    });
    expect(hit).toHaveLength(1);

    // Staging pin + prod label → miss (the pin is valid but the labels don't match)
    const miss = await reg.selectAgents({
      agentId: engB.id,
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

  it("stale/unknown agentId returns zero matches (INV-SYS-L05)", async () => {
    const miss = await reg.selectAgents({ agentId: "eng-does-not-exist" });
    expect(miss).toHaveLength(0);
  });

  // ── Mission-21 Phase 1 (INV-TH16): agentIds pool ─────────────────

  it("agentIds selects the exact set and nothing else", async () => {
    const all = await reg.listAgents();
    const engA = all.find((a) => a.labels.env === "prod" && a.role === "engineer")!;
    const arch = all.find((a) => a.role === "architect")!;

    const matched = await reg.selectAgents({
      agentIds: [engA.id, arch.id],
    });
    const ids = matched.map((a) => a.id).sort();
    expect(ids).toEqual([engA.id, arch.id].sort());
  });

  it("agentIds with a single element behaves like a pinpoint", async () => {
    const all = await reg.listAgents();
    const engA = all.find((a) => a.labels.env === "prod" && a.role === "engineer")!;
    const matched = await reg.selectAgents({ agentIds: [engA.id] });
    expect(matched).toHaveLength(1);
    expect(matched[0].id).toBe(engA.id);
  });

  it("agentIds empty array falls through (same as not-supplied)", async () => {
    const matched = await reg.selectAgents({ agentIds: [] });
    expect(matched).toHaveLength(3); // all three online agents
  });

  it("agentIds unknown ids silently miss (no error)", async () => {
    const matched = await reg.selectAgents({ agentIds: ["eng-nope-1", "eng-nope-2"] });
    expect(matched).toHaveLength(0);
  });

  it("agentIds AND-combines with matchLabels", async () => {
    const all = await reg.listAgents();
    const engA = all.find((a) => a.labels.env === "prod" && a.role === "engineer")!;
    const engB = all.find((a) => a.labels.env === "staging" && a.role === "engineer")!;

    // Both engineers in the pool, but matchLabels filters to prod only.
    const matched = await reg.selectAgents({
      agentIds: [engA.id, engB.id],
      matchLabels: { env: "prod" },
    });
    expect(matched).toHaveLength(1);
    expect(matched[0].id).toBe(engA.id);
  });
});

// bug-35 → bug-56 evolution: presence-projection filter at the routing layer
// has been REVISED. bug-35 originally chose lastSeenAt because lastHeartbeatAt
// reflected queue-drain cadence at that time (unreliable). Post-bug-53 wired
// the transport_heartbeat host integration (every 30s reliably) + post-bug-55
// decoupled cognitive (lastSeenAt) from transport heartbeats — making
// lastHeartbeatAt the genuine TRANSPORT-tier reachability signal. Per
// mission-225 v1.0 §3.3 cognitive-vs-transport invariant, routing decisions
// = transport-tier (can-we-deliver), so selectAgents now uses
// `isAgentReachable` (lastHeartbeatAt-based) rather than `isPeerPresent`
// (lastSeenAt-based / cognitive-tier). The bug-35 invariant ("fresh tool-call
// + stale heartbeat = reachable") no longer fires in the post-bug-53 world
// because heartbeats are reliable. Tests below cover the post-bug-56
// transport-tier routing predicate.
describe("Mission-19 Selector — bug-56 transport-tier presence projection (post-bug-53/55)", () => {
  let reg: AgentRepository;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T00:00:00.000Z"));
    reg = new AgentRepository(createMemoryStorageSubstrate());
    await reg.registerAgent("sess-eng", "engineer",
      makePayload("inst-eng", "engineer", { env: "prod" }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("includes idle agent with stale lastSeenAt but fresh lastHeartbeatAt (bug-56 invariant)", async () => {
    // Post-bug-55 cognitive-vs-transport separation: lastSeenAt drifts when
    // agent is cognitively idle (only heartbeat traffic). lastHeartbeatAt
    // stays fresh via 30s transport_heartbeat. Routing must remain available.
    vi.advanceTimersByTime(5 * 60 * 1000); // T+5min — lastSeenAt now 5min stale
    // Simulate transport heartbeat firing post-bug-55 (refreshHeartbeat bumps
    // lastHeartbeatAt; bypass keeps lastSeenAt unchanged per Tier 2 fix).
    {
      const all = await reg.listAgents();
      await reg.refreshHeartbeat(all[0].id);
    }

    // Pre-bug-56 the routing-tier filter (isPeerPresent on lastSeenAt) would
    // drop this agent. Post-bug-56 fix uses isAgentReachable on
    // lastHeartbeatAt → idle-but-online agent remains reachable.
    const peers = await reg.selectAgents({ roles: ["engineer"] });
    expect(peers).toHaveLength(1);
    expect(peers[0].id).toMatch(/^agent-/); // idea-251 D-prime Phase 1: unified prefix
  });

  it("excludes agent with stale lastHeartbeatAt (transport presence aged out)", async () => {
    // Advance past the presence window (60s) WITHOUT any heartbeat refresh.
    // Transport is genuinely stale → unreachable.
    vi.advanceTimersByTime(2 * 60 * 1000); // T+2min — both fields stale
    const peers = await reg.selectAgents({ roles: ["engineer"] });
    expect(peers).toHaveLength(0);
  });

  it("preserves explicit teardown — markAgentOffline still excludes", async () => {
    await reg.markAgentOffline("sess-eng");
    // Even if lastHeartbeatAt is recent, livenessState==="offline" sticky
    // check guards against returning a torn-down agent.
    const peers = await reg.selectAgents({ roles: ["engineer"] });
    expect(peers).toHaveLength(0);
  });

  it("agentIds pin path also honours transport-tier projection (bug-56)", async () => {
    const all = await reg.listAgents();
    const target = all[0];

    // Idle agent: stale lastSeenAt, fresh lastHeartbeatAt (post-bug-55 cycle).
    vi.advanceTimersByTime(5 * 60 * 1000);
    {
      const all = await reg.listAgents();
      await reg.refreshHeartbeat(all[0].id);
    }

    const pinnedActive = await reg.selectAgents({ agentIds: [target.id] });
    expect(pinnedActive).toHaveLength(1);

    // Now let lastHeartbeatAt age out without refresh → genuinely unreachable.
    vi.advanceTimersByTime(5 * 60 * 1000);
    const pinnedStale = await reg.selectAgents({ agentIds: [target.id] });
    expect(pinnedStale).toHaveLength(0);
  });

  it("single-agentId fast path also honours transport-tier projection (bug-56)", async () => {
    const all = await reg.listAgents();
    const target = all[0];

    vi.advanceTimersByTime(5 * 60 * 1000);
    {
      const all = await reg.listAgents();
      await reg.refreshHeartbeat(all[0].id);
    }

    const fast = await reg.selectAgents({ agentId: target.id });
    expect(fast).toHaveLength(1);

    vi.advanceTimersByTime(5 * 60 * 1000);
    const fastStale = await reg.selectAgents({ agentId: target.id });
    expect(fastStale).toHaveLength(0);
  });
});
