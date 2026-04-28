/**
 * M-Session-Claim-Separation (mission-40) T2 — protocol cutover contract tests.
 *
 * Covers the load-bearing T2 contracts:
 *   1. register_role becomes pure identity assertion — sessionClaimed=false,
 *      sessionEpoch is as-observed (NOT incremented).
 *   2. claim_session does the explicit claim — sessionClaimed=true, epoch
 *      increments, displacement reported when evicting a prior session.
 *   3. Probe path (register_role + nothing else) emits ZERO session-claim
 *      audits — bug-26's structural resolution test.
 *   4. First-tools/call auto-claim hook fires when the caller has identity
 *      but no claim, with trigger=first_tool_call audit.
 *   5. Two adapters with same fingerprint can both register_role without
 *      displacing each other; only claim_session causes displacement.
 *   6. claim_session emits agent_session_claimed audit; auto-claim emits
 *      agent_session_implicit_claim with trigger field; displacement
 *      emits agent_session_displaced.
 *   7. register_role + claim_session twice from same session is a no-op
 *      rebind (no displacement audit emitted).
 *
 * The SSE-subscribe auto-claim hook lives in HubNetworking and requires
 * a full Express server to test end-to-end — covered indirectly via the
 * registry-level claimSession tests in t1-helpers.test.ts (the single
 * helper is exercised by all three trigger values).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../../src/policy/router.js";
import { registerSessionPolicy } from "../../src/policy/session-policy.js";
import { createTestContext } from "../../src/policy/test-utils.js";
import type { IPolicyContext } from "../../src/policy/types.js";

const ENGINEER_HANDSHAKE = {
  role: "engineer",
  globalInstanceId: "test-gid-engineer",
  clientMetadata: {
    clientName: "test-client",
    clientVersion: "0.0.0",
    proxyName: "@ois/test-plugin",
    proxyVersion: "0.0.0",
    transport: "stdio-mcp-proxy",
  },
};

interface AuditSnapshot {
  action: string;
  details: string;
  relatedEntity?: string;
}

async function snapshotAudits(ctx: IPolicyContext): Promise<AuditSnapshot[]> {
  const entries = await ctx.stores.audit.listEntries(500);
  return entries.map((e) => ({
    action: e.action,
    details: e.details,
    relatedEntity: e.relatedEntity,
  }));
}

describe("M-Session-Claim-Separation T2 — register_role cutover", () => {
  let router: PolicyRouter;
  let ctx: IPolicyContext;
  beforeEach(() => {
    router = new PolicyRouter(() => {});
    registerSessionPolicy(router);
    ctx = createTestContext();
  });

  it("register_role response carries session.claimed=false + session.epoch=0 on first contact (mission-63 canonical)", async () => {
    const result = await router.handle("register_role", ENGINEER_HANDSHAKE, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.session.claimed).toBe(false);
    expect(parsed.session.epoch).toBe(0);
    expect(parsed.agent.id).toBeDefined();
  });

  it("register_role does NOT emit session-claim audits — bug-26 probe-resolution test", async () => {
    await router.handle("register_role", ENGINEER_HANDSHAKE, ctx);
    const audits = await snapshotAudits(ctx);
    expect(audits.some((a) => a.action === "agent_session_claimed")).toBe(false);
    expect(audits.some((a) => a.action === "agent_session_implicit_claim")).toBe(false);
    expect(audits.some((a) => a.action === "agent_session_displaced")).toBe(false);
    // It DOES emit identity assertion (the sole audit on this path).
    expect(audits.some((a) => a.action === "agent_identity_asserted")).toBe(true);
  });

  it("repeated register_role calls do NOT bump session.epoch (idempotent identity)", async () => {
    const first = await router.handle("register_role", ENGINEER_HANDSHAKE, ctx);
    const firstParsed = JSON.parse(first.content[0].text);
    const second = await router.handle("register_role", ENGINEER_HANDSHAKE, ctx);
    const secondParsed = JSON.parse(second.content[0].text);
    expect(secondParsed.session.epoch).toBe(firstParsed.session.epoch);
    expect(secondParsed.session.claimed).toBe(false);
  });
});

describe("M-Session-Claim-Separation T2 — explicit claim_session", () => {
  let router: PolicyRouter;
  let ctx: IPolicyContext;
  beforeEach(() => {
    router = new PolicyRouter(() => {});
    registerSessionPolicy(router);
    ctx = createTestContext();
  });

  it("claim_session after register_role binds session + increments epoch (mission-63 canonical)", async () => {
    await router.handle("register_role", ENGINEER_HANDSHAKE, ctx);
    const claim = await router.handle("claim_session", {}, ctx);
    const parsed = JSON.parse(claim.content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.agent.id).toBeDefined();
    expect(parsed.session.claimed).toBe(true);
    expect(parsed.session.epoch).toBe(1);
    expect(parsed.session.trigger).toBe("explicit");
    expect(parsed.session.displacedPriorSession).toBeUndefined();
  });

  it("claim_session emits agent_session_claimed audit with trigger=explicit", async () => {
    await router.handle("register_role", ENGINEER_HANDSHAKE, ctx);
    await router.handle("claim_session", {}, ctx);
    const audits = await snapshotAudits(ctx);
    const explicit = audits.filter((a) => a.action === "agent_session_claimed");
    expect(explicit.length).toBe(1);
    expect(explicit[0].details).toMatch(/trigger=explicit/);
  });

  it("two claim_sessions from same session = no-op rebind (no displacement)", async () => {
    await router.handle("register_role", ENGINEER_HANDSHAKE, ctx);
    await router.handle("claim_session", {}, ctx);
    const second = await router.handle("claim_session", {}, ctx);
    const parsed = JSON.parse(second.content[0].text);
    expect(parsed.session.claimed).toBe(true);
    expect(parsed.session.displacedPriorSession).toBeUndefined();
    const audits = await snapshotAudits(ctx);
    expect(audits.filter((a) => a.action === "agent_session_displaced").length).toBe(0);
  });
});

describe("M-Session-Claim-Separation T2 — same-fingerprint two-adapter coexistence", () => {
  let router: PolicyRouter;
  let stores: ReturnType<typeof createTestContext>["stores"];
  beforeEach(() => {
    router = new PolicyRouter(() => {});
    registerSessionPolicy(router);
    stores = createTestContext().stores;
  });

  it("two register_role calls with same fingerprint do NOT displace each other", async () => {
    const ctxA = createTestContext({ stores, sessionId: "sess-A" });
    const ctxB = createTestContext({ stores, sessionId: "sess-B" });

    await router.handle("register_role", ENGINEER_HANDSHAKE, ctxA);
    await router.handle("register_role", ENGINEER_HANDSHAKE, ctxB);

    const audits = await stores.audit.listEntries(500);
    // Two identity assertions, ZERO displacements / claims.
    const idAsserted = audits.filter((a) => a.action === "agent_identity_asserted");
    const displaced = audits.filter((a) => a.action === "agent_session_displaced");
    const claimed = audits.filter((a) => a.action === "agent_session_claimed");
    const implicit = audits.filter((a) => a.action === "agent_session_implicit_claim");
    expect(idAsserted.length).toBe(2);
    expect(displaced.length).toBe(0);
    expect(claimed.length).toBe(0);
    expect(implicit.length).toBe(0);
  });

  it("claim_session from one adapter displaces the other's prior claim", async () => {
    const ctxA = createTestContext({ stores, sessionId: "sess-A" });
    const ctxB = createTestContext({ stores, sessionId: "sess-B" });

    await router.handle("register_role", ENGINEER_HANDSHAKE, ctxA);
    await router.handle("claim_session", {}, ctxA);
    await router.handle("register_role", ENGINEER_HANDSHAKE, ctxB);
    const claimB = await router.handle("claim_session", {}, ctxB);
    const parsedB = JSON.parse(claimB.content[0].text);
    expect(parsedB.session.claimed).toBe(true);
    expect(parsedB.session.epoch).toBe(2);
    expect(parsedB.session.trigger).toBe("explicit");
    expect(parsedB.session.displacedPriorSession).toEqual({ sessionId: "sess-A", epoch: 1 });

    const audits = await stores.audit.listEntries(500);
    const displaced = audits.filter((a) => a.action === "agent_session_displaced");
    expect(displaced.length).toBe(1);
    expect(displaced[0].details).toMatch(/trigger=explicit/);
    expect(displaced[0].details).toMatch(/priorSessionId=sess-A/);
  });
});

describe("M-Session-Claim-Separation T2 — first-tools/call auto-claim hook", () => {
  let router: PolicyRouter;
  let ctx: IPolicyContext;
  beforeEach(() => {
    router = new PolicyRouter(() => {});
    registerSessionPolicy(router);
    ctx = createTestContext();
  });

  it("first non-register_role tool after register_role triggers auto-claim with trigger=first_tool_call", async () => {
    await router.handle("register_role", ENGINEER_HANDSHAKE, ctx);
    // Sanity: agent is identity-asserted but not claimed yet.
    const before = await ctx.stores.engineerRegistry.getAgentForSession(ctx.sessionId);
    expect(before?.currentSessionId).toBeNull();
    expect(before?.sessionEpoch).toBe(0);

    // Call any non-register_role/claim_session tool. get_engineer_status is "Any" role.
    await router.handle("get_engineer_status", {}, ctx);

    // Agent should now be claimed by this session.
    const after = await ctx.stores.engineerRegistry.getAgentForSession(ctx.sessionId);
    expect(after?.currentSessionId).toBe(ctx.sessionId);
    expect(after?.sessionEpoch).toBe(1);

    const audits = await snapshotAudits(ctx);
    const implicit = audits.filter((a) => a.action === "agent_session_implicit_claim");
    expect(implicit.length).toBe(1);
    expect(implicit[0].details).toMatch(/trigger=first_tool_call/);
    expect(implicit[0].details).toMatch(/originatingTool=get_engineer_status/);
  });

  it("explicit claim_session does NOT trigger first-tools/call auto-claim (skip-list honored)", async () => {
    await router.handle("register_role", ENGINEER_HANDSHAKE, ctx);
    await router.handle("claim_session", {}, ctx);
    const audits = await snapshotAudits(ctx);
    // Should see exactly ONE explicit claim, ZERO implicit (no auto-claim fired).
    expect(audits.filter((a) => a.action === "agent_session_claimed").length).toBe(1);
    expect(audits.filter((a) => a.action === "agent_session_implicit_claim").length).toBe(0);
  });

  it("subsequent tool calls after auto-claim do NOT trigger another auto-claim", async () => {
    await router.handle("register_role", ENGINEER_HANDSHAKE, ctx);
    await router.handle("get_engineer_status", {}, ctx);   // triggers auto-claim
    await router.handle("get_engineer_status", {}, ctx);   // should NOT re-trigger
    await router.handle("get_engineer_status", {}, ctx);   // should NOT re-trigger
    const audits = await snapshotAudits(ctx);
    expect(audits.filter((a) => a.action === "agent_session_implicit_claim").length).toBe(1);
  });

  it("register_role twice + tool call: only one auto-claim fires", async () => {
    await router.handle("register_role", ENGINEER_HANDSHAKE, ctx);
    await router.handle("register_role", ENGINEER_HANDSHAKE, ctx);
    await router.handle("get_engineer_status", {}, ctx);
    const audits = await snapshotAudits(ctx);
    expect(audits.filter((a) => a.action === "agent_session_implicit_claim").length).toBe(1);
  });

  it("tool call WITHOUT prior register_role does not trigger auto-claim (no identity to claim)", async () => {
    // Caller never registered identity. get_engineer_status is "Any" role so it can run.
    await router.handle("get_engineer_status", {}, ctx);
    const audits = await snapshotAudits(ctx);
    expect(audits.filter((a) => a.action === "agent_session_implicit_claim").length).toBe(0);
    expect(audits.filter((a) => a.action === "agent_session_claimed").length).toBe(0);
  });
});

describe("M-Session-Claim-Separation T2 — pure-probe scenario (bug-26 structural resolution)", () => {
  let router: PolicyRouter;
  let ctx: IPolicyContext;
  beforeEach(() => {
    router = new PolicyRouter(() => {});
    registerSessionPolicy(router);
    ctx = createTestContext();
  });

  it("simulated probe (register_role only, then disconnect) leaves zero session-claim audits", async () => {
    // Probe = register_role and exit. No tools/call, no SSE subscribe,
    // no claim_session. This is what `claude mcp list` produces post-T2
    // (assuming the adapter has the sse-subscribe-only auto-claim hook;
    // probe never opens SSE so even that hook doesn't fire).
    await router.handle("register_role", ENGINEER_HANDSHAKE, ctx);

    const agent = await ctx.stores.engineerRegistry.getAgentForSession(ctx.sessionId);
    expect(agent?.sessionEpoch).toBe(0);
    expect(agent?.currentSessionId).toBeNull();
    expect(agent?.status).toBe("offline");

    const audits = await snapshotAudits(ctx);
    // Zero session-claim audits — the bug-26 structural resolution test.
    expect(audits.filter((a) => a.action === "agent_session_claimed").length).toBe(0);
    expect(audits.filter((a) => a.action === "agent_session_implicit_claim").length).toBe(0);
    expect(audits.filter((a) => a.action === "agent_session_displaced").length).toBe(0);
  });

  it("probe of new agent does NOT displace a live session of the same fingerprint", async () => {
    const ctxLive = createTestContext({ sessionId: "live-session" });
    const ctxProbe = createTestContext({ stores: ctxLive.stores, sessionId: "probe-session" });

    // Live agent: register + claim = active session.
    await router.handle("register_role", ENGINEER_HANDSHAKE, ctxLive);
    await router.handle("claim_session", {}, ctxLive);
    const liveAgent = await ctxLive.stores.engineerRegistry.getAgentForSession("live-session");
    const liveEpochBefore = liveAgent!.sessionEpoch;
    expect(liveAgent?.currentSessionId).toBe("live-session");

    // Probe spawns: register_role only, then exits.
    await router.handle("register_role", ENGINEER_HANDSHAKE, ctxProbe);

    // Live agent's session unchanged — probe did NOT displace.
    const liveAgentAfter = await ctxLive.stores.engineerRegistry.getAgentForSession("live-session");
    expect(liveAgentAfter?.currentSessionId).toBe("live-session");
    expect(liveAgentAfter?.sessionEpoch).toBe(liveEpochBefore);

    const audits = await ctxLive.stores.audit.listEntries(500);
    // ONE displacement-eligible audit at most: the live agent's own claim.
    // Probe did NOT generate any session-claim audit.
    expect(audits.filter((a) => a.action === "agent_session_displaced").length).toBe(0);
  });
});
