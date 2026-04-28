/**
 * Mission-62 W1+W2 — Pass-11 partial tests covering Pass 1-5 scope.
 *
 * Per Design v1.0 §11.* decisions; thread-387 ratification.
 * Pass 6/7/9/Pass-11-finish ship in PR #112 (followup).
 *
 * Pass 1 — additive Agent schema + auto-clamp invariant
 * Pass 2 — activity FSM transition handlers on AgentRepository
 * Pass 3 — signal_working_* + signal_quota_* MCP tools
 * Pass 4 — get_agents pull primitive
 * Pass 5 — agent_state_changed SSE event dispatch
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../../src/policy/router.js";
import { registerSessionPolicy } from "../../src/policy/session-policy.js";
import { createTestContext, type TestPolicyContext } from "../../src/policy/test-utils.js";

const noop = () => {};

const engineerHandshake = {
  role: "engineer",
  globalInstanceId: "test-gid-mission-62-engineer",
  clientMetadata: {
    clientName: "test-client",
    clientVersion: "0.0.0",
    proxyName: "@ois/test-plugin",
    proxyVersion: "0.0.0",
    sdkVersion: "@ois/network-adapter@2.1.0",
  },
};

async function setupEngineer(router: PolicyRouter, ctx: TestPolicyContext): Promise<string> {
  await router.handle("register_role", engineerHandshake, ctx);
  const claim = await router.handle("claim_session", {}, ctx);
  const claimParsed = JSON.parse(claim.content[0].text);
  // mission-63 W1+W2: canonical envelope per Design §3.2 — agent.id under
  // `agent` (was top-level agentId pre-mission-63).
  return claimParsed.agent.id as string;
}

describe("Mission-62 W1+W2 Pass 1 — additive Agent schema + auto-clamp invariant", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;

  beforeEach(() => {
    router = new PolicyRouter(noop);
    registerSessionPolicy(router);
    ctx = createTestContext();
  });

  it("post-register+claim populates new fields per Pass-1+claim semantics", async () => {
    const eid = await setupEngineer(router, ctx);
    const agent = await ctx.stores.engineerRegistry.getAgent(eid);
    expect(agent).not.toBeNull();
    if (!agent) return;
    // Mission-62 W3: name now populated from globalInstanceId (the
    // OIS_INSTANCE_ID env value carried through the M18 handshake).
    expect(agent.name).toBe("test-gid-mission-62-engineer");
    expect(agent.adapterVersion).toBe("@ois/network-adapter@2.1.0");
    // claimSession promotes activityState + stamps sessionStartedAt + idleSince
    expect(agent.activityState).toBe("online_idle");
    expect(agent.sessionStartedAt).not.toBeNull();
    expect(agent.idleSince).not.toBeNull();
    // Tool-call telemetry not yet populated (no signal_working_* fired)
    expect(agent.lastToolCallAt).toBeNull();
    expect(agent.lastToolCallName).toBeNull();
    expect(agent.workingSince).toBeNull();
    expect(agent.quotaBlockedUntil).toBeNull();
    expect(agent.ipAddress).toBeNull();
    // restartCount = 1 (single sessionEpoch bump from claim within 24h window)
    expect(agent.restartCount).toBe(1);
    expect(agent.restartHistoryMs.length).toBe(1);
    expect(agent.recentErrors).toEqual([]);
  });

  it("auto-clamp invariant — livenessState=offline forces activityState=offline on read", async () => {
    const eid = await setupEngineer(router, ctx);
    // Set activityState=online_working directly
    await ctx.stores.engineerRegistry.recordToolCallStart(eid, "test_tool");
    let agent = await ctx.stores.engineerRegistry.getAgent(eid);
    expect(agent?.activityState).toBe("online_working");
    // Force livenessState=offline; auto-clamp on subsequent read
    await ctx.stores.engineerRegistry.setLivenessState(eid, "offline");
    agent = await ctx.stores.engineerRegistry.getAgent(eid);
    expect(agent?.livenessState).toBe("offline");
    expect(agent?.activityState).toBe("offline");
  });
});

describe("Mission-62 W1+W2 Pass 2 — activity FSM transition handlers", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;

  beforeEach(() => {
    router = new PolicyRouter(noop);
    registerSessionPolicy(router);
    ctx = createTestContext();
  });

  it("recordToolCallStart sets activityState=online_working + lastToolCall* + workingSince; clears idleSince", async () => {
    const eid = await setupEngineer(router, ctx);
    await ctx.stores.engineerRegistry.recordToolCallStart(eid, "create_thread_reply");
    const agent = await ctx.stores.engineerRegistry.getAgent(eid);
    expect(agent?.activityState).toBe("online_working");
    expect(agent?.lastToolCallAt).not.toBeNull();
    expect(agent?.lastToolCallName).toBe("create_thread_reply");
    expect(agent?.workingSince).not.toBeNull();
    expect(agent?.idleSince).toBeNull();
  });

  it("recordToolCallComplete sets activityState=online_idle + idleSince; clears workingSince", async () => {
    const eid = await setupEngineer(router, ctx);
    await ctx.stores.engineerRegistry.recordToolCallStart(eid, "test_tool");
    await ctx.stores.engineerRegistry.recordToolCallComplete(eid);
    const agent = await ctx.stores.engineerRegistry.getAgent(eid);
    expect(agent?.activityState).toBe("online_idle");
    expect(agent?.idleSince).not.toBeNull();
    expect(agent?.workingSince).toBeNull();
  });

  it("recordQuotaBlocked sets activityState=online_quota_blocked + quotaBlockedUntil", async () => {
    const eid = await setupEngineer(router, ctx);
    const before = Date.now();
    await ctx.stores.engineerRegistry.recordQuotaBlocked(eid, 60);
    const agent = await ctx.stores.engineerRegistry.getAgent(eid);
    expect(agent?.activityState).toBe("online_quota_blocked");
    expect(agent?.quotaBlockedUntil).not.toBeNull();
    const untilMs = Date.parse(agent?.quotaBlockedUntil ?? "");
    expect(untilMs).toBeGreaterThanOrEqual(before + 60_000 - 100);
    expect(untilMs).toBeLessThanOrEqual(before + 60_000 + 5000);
  });

  it("recordQuotaRecovered sets activityState=online_idle + clears quotaBlockedUntil", async () => {
    const eid = await setupEngineer(router, ctx);
    await ctx.stores.engineerRegistry.recordQuotaBlocked(eid, 60);
    await ctx.stores.engineerRegistry.recordQuotaRecovered(eid);
    const agent = await ctx.stores.engineerRegistry.getAgent(eid);
    expect(agent?.activityState).toBe("online_idle");
    expect(agent?.quotaBlockedUntil).toBeNull();
    expect(agent?.idleSince).not.toBeNull();
  });

  it("recordAgentError appends to recentErrors; FIFO eviction at cap=10", async () => {
    const eid = await setupEngineer(router, ctx);
    for (let i = 0; i < 15; i++) {
      await ctx.stores.engineerRegistry.recordAgentError(eid, {
        at: new Date().toISOString(),
        toolCall: `tool_${i}`,
        errorClass: "test",
        message: `err ${i}`,
      });
    }
    const agent = await ctx.stores.engineerRegistry.getAgent(eid);
    expect(agent?.recentErrors.length).toBe(10);
    // FIFO: oldest 5 evicted; tool_5 through tool_14 remain.
    expect(agent?.recentErrors[0].toolCall).toBe("tool_5");
    expect(agent?.recentErrors[9].toolCall).toBe("tool_14");
  });
});

describe("Mission-62 W1+W2 Pass 3 — signal_working_* + signal_quota_* MCP tools", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;

  beforeEach(() => {
    router = new PolicyRouter(noop);
    registerSessionPolicy(router);
    ctx = createTestContext();
  });

  it("signal_working_started returns ok + activityState=online_working", async () => {
    const eid = await setupEngineer(router, ctx);
    const result = await router.handle("signal_working_started", { toolName: "test_tool" }, ctx);
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.agentId).toBe(eid);
    expect(parsed.activityState).toBe("online_working");
    expect(parsed.toolName).toBe("test_tool");
  });

  it("signal_working_started without toolName returns invalid_args", async () => {
    await setupEngineer(router, ctx);
    const result = await router.handle("signal_working_started", {}, ctx);
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe("invalid_args");
  });

  it("signal_working_completed returns ok + activityState=online_idle", async () => {
    await setupEngineer(router, ctx);
    await router.handle("signal_working_started", { toolName: "x" }, ctx);
    const result = await router.handle("signal_working_completed", {}, ctx);
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.activityState).toBe("online_idle");
  });

  it("signal_quota_blocked returns ok with retryAfterSeconds echoed", async () => {
    await setupEngineer(router, ctx);
    const result = await router.handle("signal_quota_blocked", { retryAfterSeconds: 30 }, ctx);
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.activityState).toBe("online_quota_blocked");
    expect(parsed.retryAfterSeconds).toBe(30);
  });

  it("signal_quota_recovered returns ok + activityState=online_idle", async () => {
    await setupEngineer(router, ctx);
    await router.handle("signal_quota_blocked", { retryAfterSeconds: 60 }, ctx);
    const result = await router.handle("signal_quota_recovered", {}, ctx);
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.activityState).toBe("online_idle");
  });

  it("signal_working_started with no session identity returns no_session_identity", async () => {
    // No register_role called; sessionId has no agent binding.
    const result = await router.handle("signal_working_started", { toolName: "x" }, ctx);
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("no_session_identity");
  });
});

describe("mission-63 W1+W2 — get_agents canonical AgentProjection", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;

  beforeEach(() => {
    router = new PolicyRouter(noop);
    registerSessionPolicy(router);
    ctx = createTestContext();
  });

  it("get_agents returns canonical AgentProjection per Design §3.3 + §2.1", async () => {
    const eid = await setupEngineer(router, ctx);
    const result = await router.handle("get_agents", {}, ctx);
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    // mission-63 W1+W2: { agents: AgentProjection[] } per Design §3.3.
    // No `count` field (anti-goal §8.1 clean cutover; callers compute
    // from .length). No field-groups; canonical projection only.
    expect(parsed.count).toBeUndefined();
    expect(parsed.agents.length).toBe(1);
    const agent = parsed.agents[0];
    // Required canonical fields per §2.1
    expect(agent.id).toBe(eid);
    expect(agent.name).toBe("test-gid-mission-62-engineer");
    expect(agent.role).toBe("engineer");
    expect(agent.livenessState).toBeDefined();
    expect(agent.activityState).toBeDefined();
    expect(agent.labels).toBeDefined();
    // Optional fields surface when present (clientMetadata + advisoryTags)
    expect(agent.clientMetadata).toBeDefined();
    expect(agent.advisoryTags).toBeDefined();
    // Internal fields stay OFF wire per Design §2.3 (idea-220 Phase 2
    // territory): no fingerprint, currentSessionId, lastSeenAt, etc.
    expect(agent.fingerprint).toBeUndefined();
    expect(agent.currentSessionId).toBeUndefined();
    expect(agent.sessionId).toBeUndefined();
    expect(agent.sessionEpoch).toBeUndefined();
    expect(agent.firstSeenAt).toBeUndefined();
    expect(agent.lastSeenAt).toBeUndefined();
    expect(agent.adapterVersion).toBeUndefined();
    expect(agent.ipAddress).toBeUndefined();
    expect(agent.recentErrors).toBeUndefined();
    expect(agent.restartCount).toBeUndefined();
    expect(agent.workingSince).toBeUndefined();
    expect(agent.idleSince).toBeUndefined();
    expect(agent.lastToolCallAt).toBeUndefined();
  });

  it("get_agents filter.activityState filters correctly", async () => {
    const eid = await setupEngineer(router, ctx);
    await ctx.stores.engineerRegistry.recordToolCallStart(eid, "x");
    // Working state
    let result = await router.handle("get_agents", { filter: { activityState: "online_working" } }, ctx);
    expect(JSON.parse(result.content[0].text).agents.length).toBe(1);
    // Idle state — should not match
    result = await router.handle("get_agents", { filter: { activityState: "online_idle" } }, ctx);
    expect(JSON.parse(result.content[0].text).agents.length).toBe(0);
  });

  it("get_agents filter.role filters by single + array", async () => {
    await setupEngineer(router, ctx);
    let result = await router.handle("get_agents", { filter: { role: "engineer" } }, ctx);
    expect(JSON.parse(result.content[0].text).agents.length).toBe(1);
    result = await router.handle("get_agents", { filter: { role: "architect" } }, ctx);
    expect(JSON.parse(result.content[0].text).agents.length).toBe(0);
    result = await router.handle("get_agents", { filter: { role: ["engineer", "architect"] } }, ctx);
    expect(JSON.parse(result.content[0].text).agents.length).toBe(1);
  });

  it("get_agents filter.agentId pins to specific agent", async () => {
    const eid = await setupEngineer(router, ctx);
    let result = await router.handle("get_agents", { filter: { agentId: eid } }, ctx);
    expect(JSON.parse(result.content[0].text).agents.length).toBe(1);
    result = await router.handle("get_agents", { filter: { agentId: "eng-nonexistent" } }, ctx);
    expect(JSON.parse(result.content[0].text).agents.length).toBe(0);
  });
});

describe("mission-63 W1+W2 — agent_state_changed canonical payload (Design §3.4)", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;

  beforeEach(() => {
    router = new PolicyRouter(noop);
    registerSessionPolicy(router);
    ctx = createTestContext();
  });

  it("signal_working_started dispatches canonical {agent, previous, changed, cause, at}", async () => {
    const eid = await setupEngineer(router, ctx);
    ctx.dispatchedEvents.length = 0;
    await router.handle("signal_working_started", { toolName: "test" }, ctx);
    const dispatched = ctx.dispatchedEvents.find((e) => e.event === "agent_state_changed");
    expect(dispatched).toBeDefined();
    const payload = dispatched?.data as Record<string, any>;
    // mission-63 W1+W2: canonical envelope per Design §3.4 — agent under
    // `agent` (full new state); `previous` carries prior values for fields
    // that changed; `changed[]` lists field names; `cause` names the FSM
    // transition trigger; `at` is the ISO timestamp.
    expect(payload.event).toBe("agent_state_changed");
    expect(payload.agent.id).toBe(eid);
    expect(payload.agent.activityState).toBe("online_working");
    expect(payload.previous.activityState).toBe("online_idle");
    expect(payload.changed).toContain("activityState");
    expect(payload.cause).toBe("signal_working_started");
    expect(payload.at).toBeDefined();
    expect(typeof payload.at).toBe("string");
    expect(dispatched?.selector.roles).toEqual(["architect", "engineer"]);
  });

  it("agent_state_changed.previous OMITS unchanged fields (round-2 audit JSON absent semantics)", async () => {
    // Round-2 audit observation: `previous` uses TS optional-key semantics
    // — fields are absent (NOT explicitly undefined) in JSON when unchanged.
    // signal_working_started transitions activityState only; livenessState
    // stays "online" unchanged → previous.livenessState should be ABSENT
    // from the JSON, not surface as null/undefined-key.
    const eid = await setupEngineer(router, ctx);
    ctx.dispatchedEvents.length = 0;
    await router.handle("signal_working_started", { toolName: "test" }, ctx);
    const dispatched = ctx.dispatchedEvents.find((e) => e.event === "agent_state_changed");
    expect(dispatched).toBeDefined();
    const payload = dispatched?.data as Record<string, any>;
    void eid;
    // activityState changed → present in previous
    expect("activityState" in payload.previous).toBe(true);
    expect(payload.previous.activityState).toBe("online_idle");
    // livenessState UNCHANGED → ABSENT from previous (no key at all)
    expect("livenessState" in payload.previous).toBe(false);
    // changed[] reflects this asymmetry — only activityState listed
    expect(payload.changed).toContain("activityState");
    expect(payload.changed).not.toContain("livenessState");

    // Verify JSON round-trip preserves absent semantics (catches drift
    // across SSE-event subscribers parsing JSON differently).
    const json = JSON.stringify(payload);
    const reparsed = JSON.parse(json);
    expect("activityState" in reparsed.previous).toBe(true);
    expect("livenessState" in reparsed.previous).toBe(false);
  });

  it("signal_quota_blocked dispatches canonical with cause=signal_quota_blocked + quotaBlockedUntil in changed[]", async () => {
    await setupEngineer(router, ctx);
    ctx.dispatchedEvents.length = 0;
    await router.handle("signal_quota_blocked", { retryAfterSeconds: 30 }, ctx);
    const dispatched = ctx.dispatchedEvents.find((e) => e.event === "agent_state_changed");
    expect(dispatched).toBeDefined();
    const payload = dispatched?.data as Record<string, any>;
    expect(payload.agent.activityState).toBe("online_quota_blocked");
    expect(payload.previous.activityState).toBe("online_idle");
    expect(payload.changed).toContain("activityState");
    expect(payload.changed).toContain("quotaBlockedUntil");
    expect(payload.cause).toBe("signal_quota_blocked");
  });

  it("signal_working_completed dispatches canonical with cause=signal_working_completed", async () => {
    await setupEngineer(router, ctx);
    await router.handle("signal_working_started", { toolName: "x" }, ctx);
    ctx.dispatchedEvents.length = 0;
    await router.handle("signal_working_completed", {}, ctx);
    const dispatched = ctx.dispatchedEvents.find((e) => e.event === "agent_state_changed");
    expect(dispatched).toBeDefined();
    const payload = dispatched?.data as Record<string, any>;
    expect(payload.agent.activityState).toBe("online_idle");
    expect(payload.previous.activityState).toBe("online_working");
    expect(payload.cause).toBe("signal_working_completed");
  });

  it("signal_quota_recovered dispatches canonical with cause=signal_quota_recovered", async () => {
    await setupEngineer(router, ctx);
    await router.handle("signal_quota_blocked", { retryAfterSeconds: 60 }, ctx);
    ctx.dispatchedEvents.length = 0;
    await router.handle("signal_quota_recovered", {}, ctx);
    const dispatched = ctx.dispatchedEvents.find((e) => e.event === "agent_state_changed");
    expect(dispatched).toBeDefined();
    const payload = dispatched?.data as Record<string, any>;
    expect(payload.agent.activityState).toBe("online_idle");
    expect(payload.previous.activityState).toBe("online_quota_blocked");
    expect(payload.cause).toBe("signal_quota_recovered");
  });
});
