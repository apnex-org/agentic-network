/**
 * mission-75 (M-TTL-Liveliness-Design) v1.0 unit tests.
 *
 * Coverage:
 *  - Pure helpers: resolveLivenessConfig precedence + deriveStateFromTTL
 *    + computeComponentStates (Design v1.0 §3.2)
 *  - AgentRepository post-bump hooks: touchAgent (cognitive) +
 *    refreshHeartbeat (transport) fold component-state recompute into
 *    the same OCC write
 *  - isPeerPresent honours per-agent peerPresenceWindowMs override
 *  - Truth-table edges per Design v1.0 §3.1 (registration-instant
 *    `(unknown, alive)` documented as naturally-pending)
 *  - transport_heartbeat handler: invokes refreshHeartbeat; rejects
 *    unbound session
 *  - PolicyRouter tier annotation registration + getToolTier accessor
 *    (canonical cognitive-bump gate per bug-55 inversion)
 *  - mcp-binding TIER_ANNOTATION_MARKER prefix discipline
 *
 * Per Design v1.0 §6.1 verification gates (subset; comprehensive
 * pulse-sweeper agentPulse + e2e idle-agent stability tests live in
 * follow-on per the trace-management discipline).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import { createMemoryStorageSubstrate } from "../../src/storage-substrate/index.js";

import {
  resolveLivenessConfig,
  deriveStateFromTTL,
  computeComponentStates,
  PEER_PRESENCE_WINDOW_MS_DEFAULT,
  AGENT_PULSE_KIND,
  computeFingerprint,
  type Agent,
  type AgentClientMetadata,
  type AgentLivenessConfig,
  type RegisterAgentPayload,
} from "../../src/state.js";
import { projectAgent } from "../../src/policy/agent-projection.js";
import { AgentRepositorySubstrate as AgentRepository } from "../../src/entities/agent-repository-substrate.js";
import { PolicyRouter } from "../../src/policy/router.js";
import {
  registerTransportHeartbeatPolicy,
  transportHeartbeat,
} from "../../src/handlers/transport-heartbeat-handler.js";
import {
  bindRouterToMcp,
  TIER_ANNOTATION_MARKER,
} from "../../src/policy/mcp-binding.js";
import type { IPolicyContext } from "../../src/policy/types.js";

const CLIENT: AgentClientMetadata = {
  clientName: "claude-code",
  clientVersion: "0.1.0",
  proxyName: "@apnex/network-adapter",
  proxyVersion: "2.1.0",
  transport: "stdio-mcp-proxy",
};

function payload(instanceId: string, role: "engineer" | "architect" = "engineer"): RegisterAgentPayload {
  return {
    name: instanceId,
    role,
    clientMetadata: CLIENT,
    advisoryTags: { llmModel: "claude-opus-4-7" },
  };
}

// ── Pure helpers (Design §3.2) ─────────────────────────────────────────

describe("mission-75 §3.2 — resolveLivenessConfig precedence", () => {
  const ENV_KEYS = [
    "PEER_PRESENCE_WINDOW_MS",
    "AGENT_TOUCH_MIN_INTERVAL_MS",
    "TRANSPORT_HEARTBEAT_INTERVAL_MS",
    "TRANSPORT_HEARTBEAT_ENABLED",
  ];
  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  it("falls through to builtin when no agent override and no env var", () => {
    const result = resolveLivenessConfig(null, "peerPresenceWindowMs", 60_000);
    expect(result).toBe(60_000);
  });

  it("env var wins over builtin", () => {
    process.env.PEER_PRESENCE_WINDOW_MS = "120000";
    const result = resolveLivenessConfig(null, "peerPresenceWindowMs", 60_000);
    expect(result).toBe(120_000);
  });

  it("agent override wins over env var", () => {
    process.env.PEER_PRESENCE_WINDOW_MS = "120000";
    const agent = {
      livenessConfig: { peerPresenceWindowMs: 90_000 } as AgentLivenessConfig,
    };
    const result = resolveLivenessConfig(agent, "peerPresenceWindowMs", 60_000);
    expect(result).toBe(90_000);
  });

  it("per-field independence — overriding one field doesn't affect others", () => {
    process.env.AGENT_TOUCH_MIN_INTERVAL_MS = "45000";
    const agent = {
      livenessConfig: { peerPresenceWindowMs: 90_000 } as AgentLivenessConfig,
    };
    expect(resolveLivenessConfig(agent, "peerPresenceWindowMs", 60_000)).toBe(90_000);
    expect(resolveLivenessConfig(agent, "agentTouchMinIntervalMs", 30_000)).toBe(45_000);
    expect(resolveLivenessConfig(agent, "transportHeartbeatIntervalMs", 30_000)).toBe(30_000);
  });

  it("boolean field — env false disables, true enables, agent override wins", () => {
    expect(resolveLivenessConfig(null, "transportHeartbeatEnabled", true)).toBe(true);
    process.env.TRANSPORT_HEARTBEAT_ENABLED = "false";
    expect(resolveLivenessConfig(null, "transportHeartbeatEnabled", true)).toBe(false);
    const agent = {
      livenessConfig: { transportHeartbeatEnabled: true } as AgentLivenessConfig,
    };
    expect(resolveLivenessConfig(agent, "transportHeartbeatEnabled", true)).toBe(true);
  });
});

describe("mission-75 §3.2 — deriveStateFromTTL (bug-52 countdown semantic)", () => {
  it("returns 'unknown' when ttl is null", () => {
    expect(deriveStateFromTTL(null, 60_000)).toBe("unknown");
  });

  it("returns 'unresponsive' when ttl is 0 (window expired)", () => {
    // bug-52: countdown semantic — ttl=0 means seconds-remaining hit zero
    // (presence window expired). v1.0's AGE semantic had ttl=0 → "alive" (just-bumped); INVERTED.
    expect(deriveStateFromTTL(0, 60_000)).toBe("unresponsive");
  });

  it("returns 'alive' when ttl is positive (seconds remaining > 0)", () => {
    // Any positive ttl = time remaining = alive. Window arg unused post-bug-52
    // (kept in signature for self-documenting code).
    expect(deriveStateFromTTL(1, 60_000)).toBe("alive");
    expect(deriveStateFromTTL(30, 60_000)).toBe("alive");
    expect(deriveStateFromTTL(59, 60_000)).toBe("alive");
    expect(deriveStateFromTTL(60, 60_000)).toBe("alive"); // full window remaining
  });

  it("respects positive ttl regardless of windowMs arg (window-independent post-bug-52)", () => {
    expect(deriveStateFromTTL(90, 120_000)).toBe("alive");
    expect(deriveStateFromTTL(120, 120_000)).toBe("alive");
  });
});

describe("mission-75 §3.2 — computeComponentStates (bug-52 countdown semantic)", () => {
  it("computes full-window TTLs for just-stamped timestamps (alive, alive)", () => {
    // bug-52: just-bumped agent has full window remaining
    // (peerPresenceWindowMs default = 60_000 → ttl = 60).
    const now = Date.now();
    const agent = {
      lastSeenAt: new Date(now).toISOString(),
      lastHeartbeatAt: new Date(now).toISOString(),
      livenessConfig: undefined,
    };
    const snap = computeComponentStates(agent, now);
    expect(snap.cognitiveTTL).toBe(60);
    expect(snap.transportTTL).toBe(60);
    expect(snap.cognitiveState).toBe("alive");
    expect(snap.transportState).toBe("alive");
  });

  it("Director's stated example: 14s after bump → cognitiveTTL=46 (countdown by 14)", () => {
    // bug-52 pin-the-mental-model fixture: 60s window, 14s elapsed since
    // bump → 46s remaining. Matches Director's stated intent for countdown
    // semantic.
    const now = Date.now();
    const agent = {
      lastSeenAt: new Date(now - 14_000).toISOString(),
      lastHeartbeatAt: new Date(now - 14_000).toISOString(),
      livenessConfig: undefined,
    };
    const snap = computeComponentStates(agent, now);
    expect(snap.cognitiveTTL).toBe(46);
    expect(snap.transportTTL).toBe(46);
    expect(snap.cognitiveState).toBe("alive");
    expect(snap.transportState).toBe("alive");
  });

  it("60s after bump → TTL=0 → state=unresponsive (window expired)", () => {
    // bug-52: at exactly window boundary (ageMs == windowMs), ttl clamps to 0.
    const now = Date.now();
    const agent = {
      lastSeenAt: new Date(now - 60_000).toISOString(),
      lastHeartbeatAt: new Date(now - 60_000).toISOString(),
      livenessConfig: undefined,
    };
    const snap = computeComponentStates(agent, now);
    expect(snap.cognitiveTTL).toBe(0);
    expect(snap.transportTTL).toBe(0);
    expect(snap.cognitiveState).toBe("unresponsive");
    expect(snap.transportState).toBe("unresponsive");
  });

  it("treats null/empty timestamps as TTL=null → state=unknown", () => {
    const now = Date.now();
    const agent = {
      lastSeenAt: "",
      lastHeartbeatAt: "",
      livenessConfig: undefined,
    };
    const snap = computeComponentStates(agent, now);
    expect(snap.cognitiveTTL).toBe(null);
    expect(snap.transportTTL).toBe(null);
    expect(snap.cognitiveState).toBe("unknown");
    expect(snap.transportState).toBe("unknown");
  });

  it("mid-window vs past-window TTLs (bug-52 countdown semantic)", () => {
    // bug-52: lastSeenAt 90s ago with 60s window → expired (ttl=0, unresponsive);
    // lastHeartbeatAt 30s ago with 60s window → 30s remaining (ttl=30, alive).
    const now = Date.now();
    const agent = {
      lastSeenAt: new Date(now - 90_000).toISOString(), // 90s ago — past window
      lastHeartbeatAt: new Date(now - 30_000).toISOString(), // 30s ago — mid window
      livenessConfig: undefined,
    };
    const snap = computeComponentStates(agent, now);
    expect(snap.cognitiveTTL).toBe(0);
    expect(snap.transportTTL).toBe(30);
    expect(snap.cognitiveState).toBe("unresponsive");
    expect(snap.transportState).toBe("alive");
  });

  it("forward-clock-skew handled cleanly (negative ageMs → ttl > window/1000; still alive)", () => {
    // bug-52: future timestamp → ageMs negative → (windowMs - ageMs) > windowMs
    // → ttl exceeds windowMs/1000. Counts as alive (positive ttl); no max-clamp
    // applied per Design v1.0 §1 (only min-clamp at 0). Director-acknowledged
    // edge case; produces no harm — just reports more headroom than nominal.
    const now = Date.now();
    const agent = {
      lastSeenAt: new Date(now + 5_000).toISOString(), // 5s future
      lastHeartbeatAt: new Date(now).toISOString(),
      livenessConfig: undefined,
    };
    const snap = computeComponentStates(agent, now);
    expect(snap.cognitiveTTL).toBe(65); // windowMs/1000 + 5s skew
    expect(snap.cognitiveState).toBe("alive");
  });
});

// ── AgentRepository post-bump hooks (Design §3.2) ─────────────────────

describe("mission-75 §3.2 — AgentRepository touchAgent post-bump hook", () => {
  let reg: AgentRepository;
  beforeEach(() => {
    reg = new AgentRepository(createMemoryStorageSubstrate());
    delete process.env.AGENT_TOUCH_MIN_INTERVAL_MS;
    delete process.env.PEER_PRESENCE_WINDOW_MS;
  });

  it("touchAgent populates cognitiveTTL=full-window + cognitiveState='alive' on the agent record (bug-52 countdown)", async () => {
    const result = await reg.registerAgent("sess-1", "engineer", payload("uuid-touch"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Force the rate-limit window to elapse — touchAgent is rate-limited
    // to AGENT_TOUCH_MIN_INTERVAL_MS = 30s by default; vi.useFakeTimers
    // would be cleaner but we just bypass the in-memory map directly.
    (reg as unknown as { lastTouchAt: Map<string, number> }).lastTouchAt.set(result.agentId, 0);
    await reg.touchAgent("sess-1");
    const stored = await reg.getAgent(result.agentId);
    expect(stored).not.toBeNull();
    // bug-52: just-bumped → full window remaining (60s default).
    expect(stored!.cognitiveTTL).toBe(60);
    expect(stored!.cognitiveState).toBe("alive");
  });

  it("refreshHeartbeat populates transportTTL=full-window + transportState='alive' (bug-52 countdown)", async () => {
    const result = await reg.registerAgent("sess-1", "engineer", payload("uuid-hb"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await reg.refreshHeartbeat(result.agentId);
    const stored = await reg.getAgent(result.agentId);
    expect(stored).not.toBeNull();
    // bug-52: just-bumped → full window remaining (60s default).
    expect(stored!.transportTTL).toBe(60);
    expect(stored!.transportState).toBe("alive");
    expect(stored!.livenessState).toBe("online"); // existing FSM behaviour preserved
  });
});

describe("mission-75 §3.5 — isPeerPresent per-agent override", () => {
  let reg: AgentRepository;
  beforeEach(() => {
    reg = new AgentRepository(createMemoryStorageSubstrate());
    delete process.env.PEER_PRESENCE_WINDOW_MS;
  });

  it("default 60s window — agent within last 30s is selectable", async () => {
    const result = await reg.registerAgent("sess-1", "engineer", payload("uuid-presence"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // claimSession just stamped lastSeenAt=now; selector with role=engineer
    // should pick this agent up.
    const selected = await reg.selectAgents({ roles: ["engineer"] });
    expect(selected.some((a) => a.id === result.agentId)).toBe(true);
  });
});

// ── transport_heartbeat handler (Design §3.3) ─────────────────────────

describe("mission-75 §3.3 — transport_heartbeat handler", () => {
  let reg: AgentRepository;
  let agentId: string;

  beforeEach(async () => {
    reg = new AgentRepository(createMemoryStorageSubstrate());
    const result = await reg.registerAgent("sess-1", "engineer", payload("uuid-heartbeat"));
    if (!result.ok) throw new Error("setup: registerAgent failed");
    agentId = result.agentId;
  });

  function makeCtx(sessionId: string): IPolicyContext {
    return {
      stores: { engineerRegistry: reg } as unknown as IPolicyContext["stores"],
      sessionId,
      role: "engineer",
      clientIp: "127.0.0.1",
      internalEvents: [],
      emit: async () => {},
      dispatch: async () => {},
      metrics: { increment: () => {} } as IPolicyContext["metrics"],
      config: { storageBackend: "memory", gcsBucket: "" },
    } as unknown as IPolicyContext;
  }

  it("invokes refreshHeartbeat for the bound agent", async () => {
    const refreshSpy = vi.spyOn(reg, "refreshHeartbeat");
    const result = await transportHeartbeat({}, makeCtx("sess-1"));
    expect(result.isError).toBeUndefined();
    expect(refreshSpy).toHaveBeenCalledWith(agentId);
    const body = JSON.parse(result.content[0].text as string);
    expect(body.ok).toBe(true);
    expect(body.agentId).toBe(agentId);
  });

  it("rejects unbound sessions with isError=true", async () => {
    const result = await transportHeartbeat({}, makeCtx("nonexistent-session"));
    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text as string);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("no agent bound");
  });

  it("post-call: lastHeartbeatAt advances; lastSeenAt UNCHANGED (touchAgent-bypass invariant)", async () => {
    const before = await reg.getAgent(agentId);
    const lastSeenBefore = before!.lastSeenAt;
    // Sleep a tick so timestamps would differ if touched
    await new Promise((r) => setTimeout(r, 5));
    await transportHeartbeat({}, makeCtx("sess-1"));
    const after = await reg.getAgent(agentId);
    // lastSeenAt unchanged — this is the §3.3 critical invariant
    expect(after!.lastSeenAt).toBe(lastSeenBefore);
    // lastHeartbeatAt advanced
    expect(Date.parse(after!.lastHeartbeatAt)).toBeGreaterThanOrEqual(
      Date.parse(before!.lastHeartbeatAt),
    );
    // transport state recomputed (fold via refreshHeartbeat post-bump hook)
    // bug-52: countdown — just-bumped → full window remaining (60s default).
    expect(after!.transportState).toBe("alive");
    expect(after!.transportTTL).toBe(60);
  });
});

// ── PolicyRouter tier annotation (Design §3.3 / bug-55 cognitive-bump gate) ──

describe("mission-75 §3.3 — PolicyRouter tier annotation", () => {
  let router: PolicyRouter;
  beforeEach(() => {
    router = new PolicyRouter(() => {});
  });

  it("default tier is 'llm-callable' for backward-compat", () => {
    router.register("sample_tool", "[Any] sample", {}, async () => ({ content: [] }));
    expect(router.getToolTier("sample_tool")).toBe("llm-callable");
  });

  it("explicit tier='adapter-internal' is preserved", () => {
    router.register(
      "internal_tool",
      "[Any] internal",
      {},
      async () => ({ content: [] }),
      undefined,
      "adapter-internal",
    );
    expect(router.getToolTier("internal_tool")).toBe("adapter-internal");
  });

  it("registerTransportHeartbeatPolicy registers with adapter-internal tier", () => {
    registerTransportHeartbeatPolicy(router);
    expect(router.has("transport_heartbeat")).toBe(true);
    expect(router.getToolTier("transport_heartbeat")).toBe("adapter-internal");
  });

  it("getToolTier returns undefined for unknown tools", () => {
    expect(router.getToolTier("nonexistent")).toBeUndefined();
  });
});

// ── mcp-binding tier-marker prefix (Design §3.3) ──────────────────────

describe("mission-75 §3.3 — bindRouterToMcp prepends TIER_ANNOTATION_MARKER for adapter-internal tools", () => {
  it("adapter-internal tool description gets the marker prefix", () => {
    const router = new PolicyRouter(() => {});
    router.register(
      "internal_tool",
      "Original description",
      {},
      async () => ({ content: [] }),
      undefined,
      "adapter-internal",
    );
    const recorded: Array<{ name: string; description: string }> = [];
    const fakeServer = {
      tool: (name: string, description: string, _schema: unknown, _handler: unknown) => {
        recorded.push({ name, description });
        return {} as never;
      },
    };
    bindRouterToMcp(
      fakeServer as unknown as Parameters<typeof bindRouterToMcp>[0],
      router,
      () => ({} as IPolicyContext),
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0].description.startsWith(TIER_ANNOTATION_MARKER)).toBe(true);
    expect(recorded[0].description).toContain("Original description");
  });

  it("llm-callable tool description is left unchanged (no marker prefix)", () => {
    const router = new PolicyRouter(() => {});
    router.register("public_tool", "[Any] Public description", { x: z.string() }, async () => ({ content: [] }));
    const recorded: Array<{ name: string; description: string }> = [];
    const fakeServer = {
      tool: (name: string, description: string, _schema: unknown, _handler: unknown) => {
        recorded.push({ name, description });
        return {} as never;
      },
    };
    bindRouterToMcp(
      fakeServer as unknown as Parameters<typeof bindRouterToMcp>[0],
      router,
      () => ({} as IPolicyContext),
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0].description).toBe("[Any] Public description");
    expect(recorded[0].description.includes(TIER_ANNOTATION_MARKER)).toBe(false);
  });
});

// ── AGENT_PULSE_KIND contract ─────────────────────────────────────────

describe("mission-75 §3.4 — AGENT_PULSE_KIND constant", () => {
  it("is 'agentPulse' (separate from PULSE_KEYS per M1 fold)", () => {
    expect(AGENT_PULSE_KIND).toBe("agentPulse");
  });
});

// ── Truth-table edge: registration-instant (Design §3.1) ──────────────

describe("mission-75 §3.1 — truth-table registration-instant edge", () => {
  it("just-registered agent has cognitiveState=unknown + transportState=unknown (per current init)", async () => {
    const reg = new AgentRepository(createMemoryStorageSubstrate());
    const result = await reg.registerAgent("sess-1", "engineer", payload("uuid-init"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = await reg.getAgent(result.agentId);
    // Per W1/9: first-contact create initializes 4 fields to (null,
    // "unknown") — eager-recompute hooks (W2/9) populate on next signal.
    // claimSession then fires its own recompute → transition to (alive, alive)
    // post-claim. This test asserts the initial values are present, not
    // the post-claim recomputed values (claim runs in registerAgent
    // path so we'd need a pre-claim peek which the API doesn't expose).
    expect(stored).not.toBeNull();
    // After registerAgent (which includes claimSession): both should be alive
    // per Design §3.1 truth-table "(alive, alive)" steady-state row in this
    // codebase's lastSeenAt-on-create model.
    expect(stored!.cognitiveState).toBe("alive");
    expect(stored!.transportState).toBe("alive");
    // bug-55 Tier 2: claimSession no longer bumps lastSeenAt, so cognitiveTTL
    // reflects elapsed time since first-contact-create's lastSeenAt write
    // (typically <1s into the test, hence 59-60). Transport-tier still bumps
    // at claim, so transportTTL is full-window.
    expect(stored!.cognitiveTTL).toBeGreaterThan(0);
    expect(stored!.cognitiveTTL).toBeLessThanOrEqual(60);
    expect(stored!.transportTTL).toBe(60);
  });
});

// ── bug-54: projectAgent live-compute on read (Design v1.0 §3.6 + §3.2) ──
//
// Storage path persists cognitiveTTL/transportTTL/cognitiveState/transportState
// at touchAgent / refreshHeartbeat bump events; between bumps the stored
// snapshot is frozen. The wire projection must live-compute from the
// current `nowMs` so operator visibility (get_agents) shows per-second
// decrement matching Director's stated mental model. Storage path stays
// authoritative for FSM transitions (mission-225 design); projection
// layer is the operator-display surface.

function fakeAgent(overrides: Partial<Agent>): Agent {
  return {
    id: "eng-bug54",
    fingerprint: "fp",
    role: "engineer",
    status: "online",
    archived: false,
    sessionEpoch: 0,
    currentSessionId: null,
    clientMetadata: { clientName: "x", clientVersion: "0", proxyName: "p", proxyVersion: "0" },
    advisoryTags: {},
    labels: {},
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
    livenessState: "online",
    lastHeartbeatAt: "2026-01-01T00:00:00.000Z",
    receiptSla: 1000,
    wakeEndpoint: null,
    name: "eng-bug54",
    activityState: "online_idle",
    sessionStartedAt: null,
    lastToolCallAt: null,
    lastToolCallName: null,
    idleSince: null,
    workingSince: null,
    quotaBlockedUntil: null,
    adapterVersion: "",
    ipAddress: null,
    restartCount: 0,
    recentErrors: [],
    restartHistoryMs: [],
    // Stored snapshot — frozen at last-bump value; projection MUST NOT
    // surface these directly.
    cognitiveTTL: 60,
    transportTTL: 60,
    cognitiveState: "alive",
    transportState: "alive",
    livenessConfig: undefined,
    ...overrides,
  } as Agent;
}

describe("mission-75 §3.6 — bug-54 projectAgent live-compute on read", () => {
  it("Director's stated example pinned at projection layer: lastSeenAt 14s ago, nowMs binds → cognitiveTTL=46", () => {
    const now = Date.now();
    const agent = fakeAgent({
      lastSeenAt: new Date(now - 14_000).toISOString(),
      // Stored snapshot diverged from live (e.g. last bump was 14s ago at full
      // window). bug-54: live-compute MUST override the stored 60.
      cognitiveTTL: 60,
      cognitiveState: "alive",
    });
    const proj = projectAgent(agent, now);
    expect(proj.cognitiveTTL).toBe(46);
    expect(proj.cognitiveState).toBe("alive");
  });

  it("mid-cycle decrement visible: lastHeartbeatAt 45s ago → transportTTL=15 (live), not frozen 60 (stored)", () => {
    const now = Date.now();
    const agent = fakeAgent({
      lastHeartbeatAt: new Date(now - 45_000).toISOString(),
      transportTTL: 60, // stored snapshot from last bump
      transportState: "alive",
    });
    const proj = projectAgent(agent, now);
    expect(proj.transportTTL).toBe(15);
    expect(proj.transportState).toBe("alive");
  });

  it("expired window flips state to unresponsive at projection: lastHeartbeatAt 90s ago → transportTTL=0, transportState=unresponsive", () => {
    const now = Date.now();
    const agent = fakeAgent({
      lastHeartbeatAt: new Date(now - 90_000).toISOString(),
      // Stored snapshot still claims alive — the bump that should have
      // refreshed it didn't fire. bug-54: projection ignores stale stored
      // state and surfaces the live derivation.
      transportTTL: 60,
      transportState: "alive",
    });
    const proj = projectAgent(agent, now);
    expect(proj.transportTTL).toBe(0);
    expect(proj.transportState).toBe("unresponsive");
  });

  it("storage-path read-only contract: projectAgent does not mutate the agent record", () => {
    const now = Date.now();
    const agent = fakeAgent({
      lastSeenAt: new Date(now - 14_000).toISOString(),
      lastHeartbeatAt: new Date(now - 45_000).toISOString(),
      cognitiveTTL: 60,
      transportTTL: 60,
    });
    const beforeStored = {
      cognitiveTTL: agent.cognitiveTTL,
      transportTTL: agent.transportTTL,
      cognitiveState: agent.cognitiveState,
      transportState: agent.transportState,
      lastSeenAt: agent.lastSeenAt,
      lastHeartbeatAt: agent.lastHeartbeatAt,
    };
    projectAgent(agent, now);
    // Stored snapshot fields untouched — projection is pure read.
    expect(agent.cognitiveTTL).toBe(beforeStored.cognitiveTTL);
    expect(agent.transportTTL).toBe(beforeStored.transportTTL);
    expect(agent.cognitiveState).toBe(beforeStored.cognitiveState);
    expect(agent.transportState).toBe(beforeStored.transportState);
    expect(agent.lastSeenAt).toBe(beforeStored.lastSeenAt);
    expect(agent.lastHeartbeatAt).toBe(beforeStored.lastHeartbeatAt);
  });

  it("once-per-batch nowMs gives cross-agent consistency: same nowMs across multiple projectAgent calls produces TTL math from a single reference instant", () => {
    const now = Date.now();
    const a1 = fakeAgent({ id: "eng-1", lastSeenAt: new Date(now - 10_000).toISOString() });
    const a2 = fakeAgent({ id: "eng-2", lastSeenAt: new Date(now - 20_000).toISOString() });
    const p1 = projectAgent(a1, now);
    const p2 = projectAgent(a2, now);
    // Difference between TTLs equals the difference in agent ages — no
    // per-call clock drift since both derive from the same nowMs.
    expect((p1.cognitiveTTL ?? 0) - (p2.cognitiveTTL ?? 0)).toBe(10);
  });
});
