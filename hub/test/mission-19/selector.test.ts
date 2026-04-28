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
import { AgentRepository } from "../../src/entities/agent-repository.js";
import { MemoryStorageProvider } from "@apnex/storage-provider";

const CLIENT: AgentClientMetadata = {
  clientName: "claude-code",
  clientVersion: "0.1.0",
  proxyName: "@apnex/claude-plugin",
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
  let reg: AgentRepository;

  beforeEach(async () => {
    reg = new AgentRepository(new MemoryStorageProvider());
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

// bug-35 fix: presence-projection filter must gate on lastSeenAt (tool-call
// recency) rather than lastHeartbeatAt (queue-drain liveness FSM). Agents
// that are actively tool-calling but haven't drained their pending-actions
// queue recently must remain reachable for new dispatch.
describe("Mission-19 Selector — bug-35 lastSeenAt-vs-lastHeartbeatAt presence projection", () => {
  let reg: AgentRepository;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T00:00:00.000Z"));
    reg = new AgentRepository(new MemoryStorageProvider());
    await reg.registerAgent("sess-eng", "engineer",
      makePayload("inst-eng", "engineer", { env: "prod" }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("includes agent with stale lastHeartbeatAt but fresh lastSeenAt (regression: bug-35)", async () => {
    // Register set lastSeenAt + lastHeartbeatAt to T0. Advance past 2 * receiptSla
    // (default 60s → 120s threshold) so the FSM would demote livenessState
    // to "unresponsive" via computeLivenessState.
    vi.advanceTimersByTime(5 * 60 * 1000); // T+5min
    // Tool-call simulation: bump lastSeenAt without touching lastHeartbeatAt.
    // touchAgent is rate-limited via lastTouchAt; claimSession set it at T0,
    // 5min later we are well past AGENT_TOUCH_MIN_INTERVAL_MS (30s).
    await reg.touchAgent("sess-eng");

    // Pre-fix the recompute would demote status to "offline" (lastHeartbeatAt
    // 5min stale > 2*receiptSla=120s) and selectAgents drops the agent.
    // Post-fix selectAgents gates on lastSeenAt presence-window, so the
    // agent remains reachable.
    const peers = await reg.selectAgents({ roles: ["engineer"] });
    expect(peers).toHaveLength(1);
    expect(peers[0].id).toMatch(/^eng-/);
  });

  it("excludes agent with stale lastSeenAt (presence window aged out)", async () => {
    // Advance past the presence window (60s) without any tool-call activity.
    vi.advanceTimersByTime(2 * 60 * 1000); // T+2min — both heartbeat and lastSeenAt stale
    const peers = await reg.selectAgents({ roles: ["engineer"] });
    expect(peers).toHaveLength(0);
  });

  it("preserves explicit teardown — markAgentOffline still excludes regardless of lastSeenAt", async () => {
    await reg.markAgentOffline("sess-eng");
    // markAgentOffline bumps lastSeenAt, so a naive lastSeenAt-only filter
    // would incorrectly include the just-torn-down agent. The
    // livenessState==="offline" sticky check guards against that.
    const peers = await reg.selectAgents({ roles: ["engineer"] });
    expect(peers).toHaveLength(0);
  });

  it("agentIds pin path also honours the presence projection", async () => {
    // Bug-35 site: hub-networking dispatcher selector resolution uses
    // agentIds pin. Same projection contract as the broadcast path.
    const all = await reg.listAgents();
    const target = all[0];

    vi.advanceTimersByTime(5 * 60 * 1000);
    await reg.touchAgent("sess-eng");

    const pinnedActive = await reg.selectAgents({ agentIds: [target.id] });
    expect(pinnedActive).toHaveLength(1);

    // Now let lastSeenAt age out without touching, then verify pin returns empty.
    vi.advanceTimersByTime(5 * 60 * 1000);
    const pinnedStale = await reg.selectAgents({ agentIds: [target.id] });
    expect(pinnedStale).toHaveLength(0);
  });

  it("single-agentId fast path also honours the presence projection", async () => {
    const all = await reg.listAgents();
    const target = all[0];

    vi.advanceTimersByTime(5 * 60 * 1000);
    await reg.touchAgent("sess-eng");

    const fast = await reg.selectAgents({ agentId: target.id });
    expect(fast).toHaveLength(1);

    vi.advanceTimersByTime(5 * 60 * 1000);
    const fastStale = await reg.selectAgents({ agentId: target.id });
    expect(fastStale).toHaveLength(0);
  });
});
