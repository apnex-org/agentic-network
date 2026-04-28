/**
 * mission-63 W1+W2 — canonical envelope unit tests
 *
 * Covers the projectAgent helper + canonical wire shape contracts at
 * the policy boundary. Companion to mission-62-w1-w2.test.ts (which
 * covers the per-tool dispatch behavior); this file focuses on the
 * AgentProjection internal-vs-wire allowlist + handshake response
 * envelope shape per Design v1.0 §2.1, §2.3, §3.1, §3.2.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../../src/policy/router.js";
import { registerSessionPolicy } from "../../src/policy/session-policy.js";
import { projectAgent } from "../../src/policy/agent-projection.js";
import { createTestContext, type TestPolicyContext } from "../../src/policy/test-utils.js";
import type { Agent } from "../../src/state.js";

const noop = () => {};

const handshake = {
  role: "engineer",
  globalInstanceId: "test-gid-mission-63-canonical",
  clientMetadata: {
    clientName: "test-client",
    clientVersion: "0.0.0",
    proxyName: "@apnex/test-plugin",
    proxyVersion: "0.0.0",
    sdkVersion: "@apnex/network-adapter@2.1.0",
  },
  advisoryTags: { llmModel: "claude-test-model" },
  labels: { env: "smoke-test", team: "billing" },
};

describe("projectAgent — canonical wire shape per Design §2.1 + §2.3", () => {
  it("surfaces the canonical fields and hides internal/operational fields", () => {
    const fakeAgent: Agent = {
      id: "eng-test123",
      fingerprint: "FINGERPRINT_SHOULD_NOT_LEAK",
      role: "engineer",
      status: "online",
      archived: false,
      sessionEpoch: 7,
      currentSessionId: "sess-leak",
      clientMetadata: {
        clientName: "x", clientVersion: "0", proxyName: "p", proxyVersion: "0",
      },
      advisoryTags: { llmModel: "test-model" },
      labels: { team: "test" },
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-02T00:00:00.000Z",
      livenessState: "online",
      lastHeartbeatAt: "2026-01-02T00:00:00.000Z",
      receiptSla: 1000,
      wakeEndpoint: null,
      name: "test-instance",
      activityState: "online_idle",
      sessionStartedAt: "2026-01-01T00:00:01.000Z",
      lastToolCallAt: null,
      lastToolCallName: null,
      idleSince: "2026-01-01T00:00:01.000Z",
      workingSince: null,
      quotaBlockedUntil: null,
      adapterVersion: "@apnex/network-adapter@2.1.0",
      ipAddress: "127.0.0.1",
      restartCount: 1,
      recentErrors: [],
      restartHistoryMs: [Date.now()],
    };
    const proj = projectAgent(fakeAgent);

    // Required canonical fields are present
    expect(proj.id).toBe("eng-test123");
    expect(proj.name).toBe("test-instance");
    expect(proj.role).toBe("engineer");
    expect(proj.livenessState).toBe("online");
    expect(proj.activityState).toBe("online_idle");
    expect(proj.labels).toEqual({ team: "test" });
    expect(proj.clientMetadata).toBeDefined();
    expect(proj.advisoryTags).toBeDefined();

    // Internal fields stay OFF wire (Design §2.3)
    const projAny = proj as Record<string, unknown>;
    expect(projAny.fingerprint).toBeUndefined();
    expect(projAny.currentSessionId).toBeUndefined();
    expect(projAny.sessionEpoch).toBeUndefined();
    expect(projAny.firstSeenAt).toBeUndefined();
    expect(projAny.lastSeenAt).toBeUndefined();
    expect(projAny.lastHeartbeatAt).toBeUndefined();
    expect(projAny.archived).toBeUndefined();
    expect(projAny.recentErrors).toBeUndefined();
    expect(projAny.restartHistoryMs).toBeUndefined();
    expect(projAny.restartCount).toBeUndefined();
    expect(projAny.sessionStartedAt).toBeUndefined();
    expect(projAny.lastToolCallAt).toBeUndefined();
    expect(projAny.lastToolCallName).toBeUndefined();
    expect(projAny.idleSince).toBeUndefined();
    expect(projAny.workingSince).toBeUndefined();
    expect(projAny.quotaBlockedUntil).toBeUndefined();
    expect(projAny.wakeEndpoint).toBeUndefined();
    expect(projAny.receiptSla).toBeUndefined();
    expect(projAny.adapterVersion).toBeUndefined();
    expect(projAny.ipAddress).toBeUndefined();
    expect(projAny.status).toBeUndefined();
  });

  it("clientMetadata + advisoryTags ABSENT when source is null (legacy record path)", () => {
    // Round-1 audit ask 7 — legacy records may have these as null.
    // Projection emits them as absent (omitted from JSON), not as
    // explicit-null which would surprise canonical-shape consumers.
    const legacyAgent = {
      id: "eng-legacy-1",
      fingerprint: "f1",
      role: "engineer",
      status: "online",
      archived: false,
      sessionEpoch: 0,
      currentSessionId: null,
      clientMetadata: null as unknown as Agent["clientMetadata"],
      advisoryTags: null as unknown as Agent["advisoryTags"],
      labels: {},
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      livenessState: "online" as const,
      lastHeartbeatAt: "2026-01-01T00:00:00.000Z",
      receiptSla: 1000,
      wakeEndpoint: null,
      name: "eng-legacy-1",
      activityState: "online_idle" as const,
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
    } as Agent;
    const proj = projectAgent(legacyAgent);

    // Canonical required fields populated; name fallback to id worked
    expect(proj.id).toBe("eng-legacy-1");
    expect(proj.name).toBe("eng-legacy-1");

    // Optional fields ABSENT (not present as undefined-typed key)
    const projObj = proj as Record<string, unknown>;
    expect("clientMetadata" in projObj).toBe(false);
    expect("advisoryTags" in projObj).toBe(false);

    // JSON round-trip preserves absent semantics (round-2 audit observation)
    const json = JSON.stringify(proj);
    const reparsed = JSON.parse(json);
    expect("clientMetadata" in reparsed).toBe(false);
    expect("advisoryTags" in reparsed).toBe(false);
  });

  it("labels defaults to {} when source labels is undefined/null", () => {
    const agent = {
      id: "eng-no-labels",
      fingerprint: "f", role: "engineer", status: "online", archived: false,
      sessionEpoch: 0, currentSessionId: null,
      clientMetadata: { clientName: "x", clientVersion: "0", proxyName: "p", proxyVersion: "0" },
      advisoryTags: {},
      labels: undefined as unknown as Agent["labels"],
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      livenessState: "online" as const,
      lastHeartbeatAt: "2026-01-01T00:00:00.000Z",
      receiptSla: 1000,
      wakeEndpoint: null,
      name: "eng-no-labels",
      activityState: "online_idle" as const,
      sessionStartedAt: null, lastToolCallAt: null, lastToolCallName: null,
      idleSince: null, workingSince: null, quotaBlockedUntil: null,
      adapterVersion: "", ipAddress: null,
      restartCount: 0, recentErrors: [], restartHistoryMs: [],
    } as Agent;
    const proj = projectAgent(agent);
    expect(proj.labels).toEqual({});
  });
});

describe("register_role canonical envelope (Design §3.1)", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;
  beforeEach(() => {
    router = new PolicyRouter(noop);
    registerSessionPolicy(router);
    ctx = createTestContext();
  });

  it("response shape: {ok, agent, session, wasCreated, message}", async () => {
    const result = await router.handle("register_role", handshake, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(true);
    // Top-level keys
    expect(parsed.agent).toBeDefined();
    expect(parsed.session).toBeDefined();
    expect(parsed.wasCreated).toBe(true);
    expect(parsed.message).toBeDefined();
    // Legacy flat fields are GONE (anti-goal §8.1 clean cutover)
    expect(parsed.agentId).toBeUndefined();
    expect(parsed.sessionEpoch).toBeUndefined();
    expect(parsed.sessionClaimed).toBeUndefined();
    expect(parsed.clientMetadata).toBeUndefined();
    expect(parsed.advisoryTags).toBeUndefined();
    expect(parsed.labels).toBeUndefined();
    // session.claimed must be false from register_role (claim_session
    // does the explicit-claim path).
    expect(parsed.session.claimed).toBe(false);
    expect(parsed.session.epoch).toBe(0);
    expect(parsed.session.trigger).toBeUndefined();
    // agent canonical projection
    expect(parsed.agent.id).toMatch(/^eng-/);
    expect(parsed.agent.name).toBe("test-gid-mission-63-canonical");
    expect(parsed.agent.role).toBe("engineer");
    expect(parsed.agent.labels).toEqual({ env: "smoke-test", team: "billing" });
    expect(parsed.agent.clientMetadata).toBeDefined();
    expect(parsed.agent.advisoryTags).toBeDefined();
    // Internal fields stay OFF wire
    expect(parsed.agent.fingerprint).toBeUndefined();
    expect(parsed.agent.currentSessionId).toBeUndefined();
    expect(parsed.agent.sessionEpoch).toBeUndefined();
  });
});

describe("claim_session canonical envelope (Design §3.2)", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;
  beforeEach(() => {
    router = new PolicyRouter(noop);
    registerSessionPolicy(router);
    ctx = createTestContext();
  });

  it("response shape: {ok, agent, session: {epoch, claimed:true, trigger, displacedPriorSession?}, message}", async () => {
    await router.handle("register_role", handshake, ctx);
    const result = await router.handle("claim_session", {}, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(true);
    // Top-level keys
    expect(parsed.agent).toBeDefined();
    expect(parsed.session).toBeDefined();
    expect(parsed.message).toBeDefined();
    // Legacy flat fields gone
    expect(parsed.agentId).toBeUndefined();
    expect(parsed.sessionEpoch).toBeUndefined();
    expect(parsed.sessionClaimed).toBeUndefined();
    expect(parsed.displacedPriorSession).toBeUndefined();
    // session.claimed=true; trigger=explicit
    expect(parsed.session.claimed).toBe(true);
    expect(parsed.session.epoch).toBe(1);
    expect(parsed.session.trigger).toBe("explicit");
    expect(parsed.session.displacedPriorSession).toBeUndefined();
    // agent canonical projection — internal off-wire
    expect(parsed.agent.fingerprint).toBeUndefined();
    expect(parsed.agent.currentSessionId).toBeUndefined();
    expect(parsed.agent.sessionEpoch).toBeUndefined();
  });

  it("session.displacedPriorSession surfaces under session, not at top level", async () => {
    const ctxA = createTestContext();
    const ctxB = createTestContext({ stores: ctxA.stores, sessionId: "sess-B" });
    await router.handle("register_role", handshake, ctxA);
    await router.handle("claim_session", {}, ctxA);
    await router.handle("register_role", handshake, ctxB);
    const claimB = await router.handle("claim_session", {}, ctxB);
    const parsed = JSON.parse(claimB.content[0].text);
    expect(parsed.session.displacedPriorSession).toBeDefined();
    expect(parsed.session.displacedPriorSession.sessionId).toBeDefined();
    expect(parsed.session.displacedPriorSession.epoch).toBeGreaterThanOrEqual(1);
    // Not at top level
    expect(parsed.displacedPriorSession).toBeUndefined();
  });
});
