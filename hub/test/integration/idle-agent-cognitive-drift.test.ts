/**
 * bug-55 closure tests — cognitive TTL leak (transport-only adapter
 * activity bumps lastSeenAt despite mission-225 §3.3 bypass).
 *
 * Closes the deferred §6.4 runtime-gate calibration #62 surface for
 * this defect class:
 *
 *  1. Tier 1 (cognitive-bump gate inversion) — `shouldTouchAgent`
 *     positive-list returns true iff body is tools/call to an
 *     `llm-callable`-tier tool. Wire-level methods (tools/list,
 *     initialize, notifications/*) and adapter-internal-tier tools
 *     are gated out.
 *  2. Tier 2 (assertIdentity + claimSession decoupling) — these
 *     transport-tier paths bump `lastHeartbeatAt` (transport presence)
 *     but NOT `lastSeenAt` (cognitive presence).
 *  3. End-to-end — an idle agent receiving only transport-tier
 *     traffic (heartbeat + reconnect-refresh) sees cognitiveTTL drift
 *     to 0 while transportTTL stays alive, matching the §3.3
 *     critical invariant.
 *  4. Positive-coverage regression guard — tools/call to an
 *     llm-callable tool DOES bump cognitiveTTL.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStorageSubstrate } from "../../src/storage-substrate/index.js";

import { shouldTouchAgent } from "../../src/hub-networking.js";
import { AgentRepositorySubstrate as AgentRepository } from "../../src/entities/agent-repository-substrate.js";
import { PolicyRouter } from "../../src/policy/router.js";
import {
  computeComponentStates,
  type AgentClientMetadata,
  type RegisterAgentPayload,
} from "../../src/state.js";

const CLIENT: AgentClientMetadata = {
  clientName: "claude-code",
  clientVersion: "0.1.0",
  proxyName: "@apnex/network-adapter",
  proxyVersion: "2.1.0",
  transport: "stdio-mcp-proxy",
};

function payload(name: string): RegisterAgentPayload {
  return {
    name,
    role: "engineer",
    clientMetadata: CLIENT,
    advisoryTags: { llmModel: "claude-opus-4-7" },
  };
}

// ── Tier 1: shouldTouchAgent positive-list predicate ────────────────────

describe("bug-55 §1 — shouldTouchAgent positive-list (tier-driven)", () => {
  let router: PolicyRouter;
  let tierLookup: (name: string) => ReturnType<PolicyRouter["getToolTier"]>;

  beforeEach(() => {
    router = new PolicyRouter(() => {});
    router.register("create_thread", "[Any] llm tool", {}, async () => ({ content: [] }));
    router.register(
      "transport_heartbeat",
      "[Any] adapter tool",
      {},
      async () => ({ content: [] }),
      undefined,
      "adapter-internal",
    );
    router.register(
      "register_role",
      "[Any] handshake tool",
      {},
      async () => ({ content: [] }),
      undefined,
      "adapter-internal",
    );
    tierLookup = (name: string) => router.getToolTier(name);
  });

  it("returns TRUE for tools/call to a llm-callable tool", () => {
    const body = { method: "tools/call", params: { name: "create_thread" } };
    expect(shouldTouchAgent(body, tierLookup)).toBe(true);
  });

  it("returns FALSE for tools/call to an adapter-internal tool (transport_heartbeat)", () => {
    const body = { method: "tools/call", params: { name: "transport_heartbeat" } };
    expect(shouldTouchAgent(body, tierLookup)).toBe(false);
  });

  it("returns FALSE for tools/call to an adapter-internal tool (register_role)", () => {
    const body = { method: "tools/call", params: { name: "register_role" } };
    expect(shouldTouchAgent(body, tierLookup)).toBe(false);
  });

  it("returns FALSE for tools/list (the bug-55 root-cause leak)", () => {
    const body = { method: "tools/list" };
    expect(shouldTouchAgent(body, tierLookup)).toBe(false);
  });

  it("returns FALSE for initialize", () => {
    const body = { method: "initialize" };
    expect(shouldTouchAgent(body, tierLookup)).toBe(false);
  });

  it("returns FALSE for notifications/*", () => {
    expect(shouldTouchAgent({ method: "notifications/initialized" }, tierLookup)).toBe(false);
    expect(shouldTouchAgent({ method: "notifications/cancelled" }, tierLookup)).toBe(false);
    expect(shouldTouchAgent({ method: "notifications/progress" }, tierLookup)).toBe(false);
  });

  it("returns FALSE for tools/call to unknown tool (not registered)", () => {
    const body = { method: "tools/call", params: { name: "nonexistent_tool" } };
    expect(shouldTouchAgent(body, tierLookup)).toBe(false);
  });

  it("returns FALSE for empty batch", () => {
    expect(shouldTouchAgent([], tierLookup)).toBe(false);
  });

  it("returns FALSE for non-object body", () => {
    expect(shouldTouchAgent(null, tierLookup)).toBe(false);
    expect(shouldTouchAgent("string", tierLookup)).toBe(false);
    expect(shouldTouchAgent(42, tierLookup)).toBe(false);
  });

  it("returns TRUE for batch of all-llm-callable tools/call", () => {
    router.register("create_message", "[Any] llm tool", {}, async () => ({ content: [] }));
    const body = [
      { method: "tools/call", params: { name: "create_thread" } },
      { method: "tools/call", params: { name: "create_message" } },
    ];
    expect(shouldTouchAgent(body, tierLookup)).toBe(true);
  });

  it("returns FALSE for mixed batch (any non-llm-callable element)", () => {
    const body = [
      { method: "tools/call", params: { name: "create_thread" } },
      { method: "tools/call", params: { name: "transport_heartbeat" } },
    ];
    expect(shouldTouchAgent(body, tierLookup)).toBe(false);
  });
});

// ── Tier 2: assertIdentity + claimSession decoupling ────────────────────

describe("bug-55 §2 — assertIdentity reconnect-refresh does NOT bump cognitive-tier", () => {
  let reg: AgentRepository;

  beforeEach(() => {
    reg = new AgentRepository(createMemoryStorageSubstrate());
    delete process.env.AGENT_TOUCH_MIN_INTERVAL_MS;
    delete process.env.PEER_PRESENCE_WINDOW_MS;
  });

  it("re-asserting identity bumps lastHeartbeatAt but leaves lastSeenAt unchanged", async () => {
    const first = await reg.assertIdentity(payload("uuid-asrt"), "sess-1");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const before = await reg.getAgent(first.agentId);
    expect(before).not.toBeNull();
    const lastSeenBefore = before!.lastSeenAt;
    const lastHbBefore = before!.lastHeartbeatAt;

    // Simulate elapsed time so timestamps would differ if touched.
    await new Promise((r) => setTimeout(r, 10));

    // Re-assert identity (reconnect-refresh path) — fires assertIdentity
    // line 515 path with existing agent record.
    const second = await reg.assertIdentity(payload("uuid-asrt"), "sess-2");
    expect(second.ok).toBe(true);

    const after = await reg.getAgent(first.agentId);
    expect(after).not.toBeNull();

    // bug-55 Tier 2 invariant: lastSeenAt unchanged across reconnect-refresh.
    expect(after!.lastSeenAt).toBe(lastSeenBefore);
    // lastHeartbeatAt advanced — transport-presence bump.
    expect(Date.parse(after!.lastHeartbeatAt)).toBeGreaterThan(Date.parse(lastHbBefore));
  });
});

describe("bug-55 §2 — claimSession does NOT bump cognitive-tier", () => {
  let reg: AgentRepository;

  beforeEach(() => {
    reg = new AgentRepository(createMemoryStorageSubstrate());
    delete process.env.AGENT_TOUCH_MIN_INTERVAL_MS;
    delete process.env.PEER_PRESENCE_WINDOW_MS;
  });

  it("explicit claim_session bumps lastHeartbeatAt but leaves lastSeenAt unchanged", async () => {
    const ident = await reg.assertIdentity(payload("uuid-claim"), "sess-1");
    expect(ident.ok).toBe(true);
    if (!ident.ok) return;
    const before = await reg.getAgent(ident.agentId);
    expect(before).not.toBeNull();
    const lastSeenBefore = before!.lastSeenAt;
    const lastHbBefore = before!.lastHeartbeatAt;

    await new Promise((r) => setTimeout(r, 10));

    const claimed = await reg.claimSession(ident.agentId, "sess-1", "explicit");
    expect(claimed.ok).toBe(true);

    const after = await reg.getAgent(ident.agentId);
    expect(after).not.toBeNull();

    // bug-55 Tier 2 invariant: claimSession is transport-tier.
    expect(after!.lastSeenAt).toBe(lastSeenBefore);
    expect(Date.parse(after!.lastHeartbeatAt)).toBeGreaterThan(Date.parse(lastHbBefore));
  });

  it("implicit auto-claim paths (sse_subscribe + first_tool_call) likewise bump only transport", async () => {
    const ident = await reg.assertIdentity(payload("uuid-implicit"), "sess-1");
    expect(ident.ok).toBe(true);
    if (!ident.ok) return;
    const before = await reg.getAgent(ident.agentId);
    const lastSeenBefore = before!.lastSeenAt;

    await new Promise((r) => setTimeout(r, 10));

    const sseClaim = await reg.claimSession(ident.agentId, "sess-2", "sse_subscribe");
    expect(sseClaim.ok).toBe(true);
    const afterSse = await reg.getAgent(ident.agentId);
    expect(afterSse!.lastSeenAt).toBe(lastSeenBefore);

    await new Promise((r) => setTimeout(r, 10));

    const fcClaim = await reg.claimSession(ident.agentId, "sess-3", "first_tool_call");
    expect(fcClaim.ok).toBe(true);
    const afterFc = await reg.getAgent(ident.agentId);
    expect(afterFc!.lastSeenAt).toBe(lastSeenBefore);
  });
});

// ── §3 End-to-end: idle agent's cognitiveTTL drifts to 0 ────────────────

describe("bug-55 §3 — idle agent receiving only transport-tier traffic drifts cognitive-tier to expiry", () => {
  let reg: AgentRepository;

  beforeEach(() => {
    reg = new AgentRepository(createMemoryStorageSubstrate());
    delete process.env.AGENT_TOUCH_MIN_INTERVAL_MS;
    delete process.env.PEER_PRESENCE_WINDOW_MS;
  });

  it("heartbeat + reconnect-refresh keep transportTTL alive while cognitiveTTL drifts to 0", async () => {
    // 1. register agent + bump cognitive once (initial touchAgent slot).
    const result = await reg.registerAgent("sess-1", "engineer", payload("uuid-drift"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    (reg as unknown as { lastTouchAt: Map<string, number> }).lastTouchAt.set(result.agentId, 0);
    await reg.touchAgent("sess-1");
    const initial = await reg.getAgent(result.agentId);
    expect(initial!.cognitiveState).toBe("alive");
    expect(initial!.cognitiveTTL).toBe(60); // full window

    // 2. simulate 90s elapsed (3× heartbeat cadence) by backdating the
    //    agent's lastSeenAt directly. We DON'T re-touch — the §3.3
    //    invariant under test: only LLM-meaningful work bumps
    //    lastSeenAt. Heartbeat traffic + reconnect-refresh do NOT.
    const back = await reg.getAgent(result.agentId);
    expect(back).not.toBeNull();
    const backdated = new Date(Date.now() - 90_000).toISOString();
    // Direct substrate write to backdate lastSeenAt — repository layer
    // doesn't expose a backdating API (correct: backdating shouldn't be
    // a normal mutation). mission-84 W2: substrate-API replaces FS-provider
    // path-based mutation; entity kind="Agent" id=<agentId>.
    const substrate = (reg as unknown as { substrate: { put: (kind: string, entity: unknown) => Promise<unknown> } }).substrate;
    const stored = { ...back!, lastSeenAt: backdated };
    await substrate.put("Agent", stored);

    // 3. fire transport-tier traffic during the drift window:
    //    refreshHeartbeat (the transport_heartbeat handler's effect) +
    //    a reconnect-refresh assertIdentity.
    await reg.refreshHeartbeat(result.agentId);
    await reg.assertIdentity(payload("uuid-drift"), "sess-2");

    // 4. assertions — recompute component states for current truth.
    const final = await reg.getAgent(result.agentId);
    expect(final).not.toBeNull();
    const snap = computeComponentStates(final!, Date.now());

    // bug-55 critical invariant: cognitive expired (idle ≥60s with no
    // LLM-meaningful work).
    expect(snap.cognitiveTTL).toBe(0);
    expect(snap.cognitiveState).toBe("unresponsive");

    // Transport alive: heartbeat + assertIdentity refreshed lastHeartbeatAt.
    expect(snap.transportTTL).toBeGreaterThan(0);
    expect(snap.transportState).toBe("alive");
  });
});

// ── §4 Positive-coverage regression guard ───────────────────────────────

describe("bug-55 §4 — tools/call to llm-callable tier DOES bump cognitive-tier (regression guard)", () => {
  let reg: AgentRepository;

  beforeEach(() => {
    reg = new AgentRepository(createMemoryStorageSubstrate());
    delete process.env.AGENT_TOUCH_MIN_INTERVAL_MS;
    delete process.env.PEER_PRESENCE_WINDOW_MS;
  });

  it("touchAgent (the path llm-callable tools/call reaches) bumps lastSeenAt + cognitiveTTL", async () => {
    const result = await reg.registerAgent("sess-1", "engineer", payload("uuid-pos"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const before = await reg.getAgent(result.agentId);
    expect(before).not.toBeNull();
    const lastSeenBefore = before!.lastSeenAt;

    // Force rate-limit window to elapse so touchAgent isn't dropped.
    (reg as unknown as { lastTouchAt: Map<string, number> }).lastTouchAt.set(result.agentId, 0);
    await new Promise((r) => setTimeout(r, 10));

    await reg.touchAgent("sess-1");

    const after = await reg.getAgent(result.agentId);
    expect(after).not.toBeNull();

    // Positive-coverage: cognitive bumps when llm-callable work flows.
    // Prevents accidental gate-inversion regression.
    expect(Date.parse(after!.lastSeenAt)).toBeGreaterThan(Date.parse(lastSeenBefore));
    expect(after!.cognitiveState).toBe("alive");
    expect(after!.cognitiveTTL).toBe(60);
  });
});
