/**
 * Wave 1 Policy Tests — Tele, Audit, Document, Session
 *
 * Tests the stateless/simple domain policies extracted in
 * The Great Decoupling T2.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../src/policy/router.js";
import { registerTelePolicy } from "../src/policy/tele-policy.js";
import { registerAuditPolicy } from "../src/policy/audit-policy.js";
import { registerSessionPolicy } from "../src/policy/session-policy.js";
import { createTestContext } from "../src/policy/test-utils.js";
import type { IPolicyContext } from "../src/policy/types.js";

const noop = () => {};

// Mission-47 W7b: the legacy `MemoryEngineerRegistry.agents` Map was
// replaced by a StorageProvider-backed AgentRepository. Test fixtures
// that previously mutated `reg.agents.get(eid).<field>` now read-modify-
// write the `agents/<eid>.json` blob through the internal provider.
async function mutateAgentBlob(
  reg: any,
  engineerId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const provider = reg.provider;
  const path = `agents/${engineerId}.json`;
  const raw = await provider.get(path);
  if (!raw) throw new Error(`agent blob not found for ${engineerId}`);
  const blob = JSON.parse(new TextDecoder().decode(raw));
  Object.assign(blob, patch);
  await provider.put(path, new TextEncoder().encode(JSON.stringify(blob, null, 2)));
}

// ── Tele Policy ─────────────────────────────────────────────────────

describe("TelePolicy", () => {
  let router: PolicyRouter;
  let ctx: IPolicyContext;

  beforeEach(() => {
    router = new PolicyRouter(noop);
    registerTelePolicy(router);
    ctx = createTestContext();
  });

  it("registers all tele tools", () => {
    expect(router.has("create_tele")).toBe(true);
    expect(router.has("get_tele")).toBe(true);
    expect(router.has("list_tele")).toBe(true);
    expect(router.has("supersede_tele")).toBe(true);
    expect(router.has("retire_tele")).toBe(true);
    expect(router.size).toBe(5);
  });

  it("create_tele creates and emits tele_defined", async () => {
    const result = await router.handle("create_tele", {
      name: "Absolute State Fidelity",
      description: "All state changes are durable",
      successCriteria: "Zero data loss under any failure mode",
    }, ctx);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.teleId).toBeDefined();
    expect(parsed.name).toBe("Absolute State Fidelity");

    const emitted = (ctx as any).emittedEvents.find((e: any) => e.event === "tele_defined");
    expect(emitted).toBeDefined();
  });

  it("get_tele returns a created tele", async () => {
    const createResult = await router.handle("create_tele", {
      name: "Test",
      description: "Test tele",
      successCriteria: "Passes all tests",
    }, ctx);
    const { teleId } = JSON.parse(createResult.content[0].text);

    const result = await router.handle("get_tele", { teleId }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.name).toBe("Test");
  });

  it("get_tele returns error for non-existent tele", async () => {
    const result = await router.handle("get_tele", { teleId: "tele-999" }, ctx);
    expect(result.isError).toBe(true);
  });

  it("list_tele returns all teles", async () => {
    await router.handle("create_tele", {
      name: "T1", description: "D1", successCriteria: "S1",
    }, ctx);
    await router.handle("create_tele", {
      name: "T2", description: "D2", successCriteria: "S2",
    }, ctx);

    const result = await router.handle("list_tele", {}, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(2);
  });

  it("create_tele writes status=active by default", async () => {
    const createResult = await router.handle("create_tele", {
      name: "Lifecycle test", description: "D", successCriteria: "S",
    }, ctx);
    const { teleId } = JSON.parse(createResult.content[0].text);
    const getResult = await router.handle("get_tele", { teleId }, ctx);
    const parsed = JSON.parse(getResult.content[0].text);
    expect(parsed.status).toBe("active");
  });

  it("supersede_tele flips status + emits tele_superseded", async () => {
    const a = await router.handle("create_tele", { name: "A", description: "D", successCriteria: "S" }, ctx);
    const b = await router.handle("create_tele", { name: "B", description: "D", successCriteria: "S" }, ctx);
    const { teleId: aId } = JSON.parse(a.content[0].text);
    const { teleId: bId } = JSON.parse(b.content[0].text);

    const result = await router.handle("supersede_tele", { teleId: aId, successorId: bId }, ctx);
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("superseded");
    expect(parsed.supersededBy).toBe(bId);

    const emitted = (ctx as any).emittedEvents.find((e: any) => e.event === "tele_superseded");
    expect(emitted).toBeDefined();
  });

  it("supersede_tele errors when successor doesn't exist", async () => {
    const a = await router.handle("create_tele", { name: "A", description: "D", successCriteria: "S" }, ctx);
    const { teleId: aId } = JSON.parse(a.content[0].text);
    const result = await router.handle("supersede_tele", { teleId: aId, successorId: "tele-999" }, ctx);
    expect(result.isError).toBe(true);
  });

  it("retire_tele flips status + emits tele_retired", async () => {
    const a = await router.handle("create_tele", { name: "A", description: "D", successCriteria: "S" }, ctx);
    const { teleId: aId } = JSON.parse(a.content[0].text);

    const result = await router.handle("retire_tele", { teleId: aId }, ctx);
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("retired");
    expect(parsed.retiredAt).toBeDefined();

    const emitted = (ctx as any).emittedEvents.find((e: any) => e.event === "tele_retired");
    expect(emitted).toBeDefined();
  });

  it("retired tele cannot be superseded", async () => {
    const a = await router.handle("create_tele", { name: "A", description: "D", successCriteria: "S" }, ctx);
    const b = await router.handle("create_tele", { name: "B", description: "D", successCriteria: "S" }, ctx);
    const { teleId: aId } = JSON.parse(a.content[0].text);
    const { teleId: bId } = JSON.parse(b.content[0].text);

    await router.handle("retire_tele", { teleId: aId }, ctx);
    const result = await router.handle("supersede_tele", { teleId: aId, successorId: bId }, ctx);
    expect(result.isError).toBe(true);
  });

  it("list_tele excludes superseded + retired by default", async () => {
    const a = await router.handle("create_tele", { name: "A", description: "D", successCriteria: "S" }, ctx);
    const b = await router.handle("create_tele", { name: "B", description: "D", successCriteria: "S" }, ctx);
    const c = await router.handle("create_tele", { name: "C", description: "D", successCriteria: "S" }, ctx);
    const { teleId: aId } = JSON.parse(a.content[0].text);
    const { teleId: bId } = JSON.parse(b.content[0].text);
    const { teleId: cId } = JSON.parse(c.content[0].text);

    await router.handle("supersede_tele", { teleId: aId, successorId: cId }, ctx);
    await router.handle("retire_tele", { teleId: bId }, ctx);

    const defaultResult = await router.handle("list_tele", {}, ctx);
    const defaultParsed = JSON.parse(defaultResult.content[0].text);
    expect(defaultParsed.count).toBe(1);
    expect(defaultParsed.tele[0].id).toBe(cId);

    const withSuperseded = await router.handle("list_tele", { includeSuperseded: true }, ctx);
    expect(JSON.parse(withSuperseded.content[0].text).count).toBe(2);

    const withRetired = await router.handle("list_tele", { includeRetired: true }, ctx);
    expect(JSON.parse(withRetired.content[0].text).count).toBe(2);

    const withBoth = await router.handle("list_tele", { includeSuperseded: true, includeRetired: true }, ctx);
    expect(JSON.parse(withBoth.content[0].text).count).toBe(3);
  });
});

// ── Audit Policy ────────────────────────────────────────────────────

describe("AuditPolicy", () => {
  let router: PolicyRouter;
  let ctx: IPolicyContext;

  beforeEach(() => {
    router = new PolicyRouter(noop);
    registerAuditPolicy(router);
    ctx = createTestContext();
  });

  it("registers all audit tools", () => {
    expect(router.has("create_audit_entry")).toBe(true);
    expect(router.has("list_audit_entries")).toBe(true);
    expect(router.size).toBe(2);
  });

  it("create_audit_entry logs an entry", async () => {
    const result = await router.handle("create_audit_entry", {
      action: "auto_review",
      details: "Reviewed task-1",
      relatedEntity: "task-1",
    }, ctx);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.auditId).toBeDefined();
  });

  it("list_audit_entries returns logged entries", async () => {
    await router.handle("create_audit_entry", {
      action: "test_action",
      details: "Test details",
    }, ctx);

    const result = await router.handle("list_audit_entries", {}, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBeGreaterThanOrEqual(1);
  });

  it("list_audit_entries supports limit", async () => {
    for (let i = 0; i < 5; i++) {
      await router.handle("create_audit_entry", {
        action: `action_${i}`,
        details: `Details ${i}`,
      }, ctx);
    }

    const result = await router.handle("list_audit_entries", { limit: 3 }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBeLessThanOrEqual(3);
  });

  // ── CP2 C5 (task-307): _ois_query_unmatched sentinel ────────────
  it("list_audit_entries fires _ois_query_unmatched when actor filter yields zero on non-empty log", async () => {
    // Default ctx role is "architect"; seed an architect entry.
    await router.handle("create_audit_entry", { action: "test", details: "seed" }, ctx);
    // Filter for a different actor — log is non-empty but filter yields zero.
    const result = await router.handle("list_audit_entries", { actor: "engineer" }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(0);
    expect(parsed._ois_query_unmatched).toBe(true);
  });
});

// ── Session Policy ──────────────────────────────────────────────────

describe("SessionPolicy", () => {
  let router: PolicyRouter;
  let ctx: IPolicyContext;

  beforeEach(() => {
    router = new PolicyRouter(noop);
    registerSessionPolicy(router);
    ctx = createTestContext();
  });

  it("registers all session tools", () => {
    expect(router.has("register_role")).toBe(true);
    expect(router.has("get_engineer_status")).toBe(true);
    expect(router.has("list_available_peers")).toBe(true);
    expect(router.has("migrate_agent_queue")).toBe(true);
    // M-Session-Claim-Separation (mission-40) T2: claim_session added.
    expect(router.has("claim_session")).toBe(true);
    expect(router.size).toBe(5);
  });

  const engineerHandshake = {
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

  it("register_role as engineer (M18 handshake) asserts identity (T2: sessionClaimed=false, epoch unchanged)", async () => {
    const result = await router.handle("register_role", engineerHandshake, ctx);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.engineerId).toBeDefined();
    // M-Session-Claim-Separation (mission-40) T2: register_role now
    // ONLY asserts identity. sessionClaimed=false; sessionEpoch reflects
    // current value (0 for first-contact, NOT incremented). Callers must
    // explicitly call claim_session to bind the session as active.
    expect(parsed.sessionClaimed).toBe(false);
    expect(parsed.sessionEpoch).toBe(0);
  });

  it("claim_session after register_role binds the session and increments sessionEpoch (T2)", async () => {
    // First assert identity.
    const reg = await router.handle("register_role", engineerHandshake, ctx);
    const regParsed = JSON.parse(reg.content[0].text);
    expect(regParsed.sessionClaimed).toBe(false);
    expect(regParsed.sessionEpoch).toBe(0);

    // Then explicit claim.
    const claim = await router.handle("claim_session", {}, ctx);
    const claimParsed = JSON.parse(claim.content[0].text);
    expect(claimParsed.ok).toBe(true);
    expect(claimParsed.sessionClaimed).toBe(true);
    expect(claimParsed.sessionEpoch).toBe(1);
    expect(claimParsed.engineerId).toBe(regParsed.engineerId);
    expect(claimParsed.displacedPriorSession).toBeUndefined();
  });

  it("claim_session without prior register_role returns no_identity_asserted (T2)", async () => {
    const result = await router.handle("claim_session", {}, ctx);
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe("no_identity_asserted");
  });

  it("register_role as architect (legacy bare path) returns role confirmation", async () => {
    const result = await router.handle("register_role", { role: "architect" }, ctx);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.role).toBe("architect");
  });

  // ── M24-T10 Director integration (ADR-014 §77) ────────────────

  it("register_role as director (M18) mints an agentId with the director-* prefix", async () => {
    const directorHandshake = {
      role: "director",
      globalInstanceId: "test-gid-director-1",
      clientMetadata: {
        clientName: "director-chat",
        clientVersion: "0.0.0",
        proxyName: "@ois/director-plugin",
        proxyVersion: "0.0.0",
      },
    };
    const result = await router.handle("register_role", directorHandshake, ctx);
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.engineerId).toMatch(/^director-/);
    // Engineer + architect stay on the eng-* prefix for backward compatibility
    // with existing audit trails + label selectors.
    expect(parsed.engineerId).not.toMatch(/^eng-/);
  });

  it("registered director SessionRole is 'director' (not mapped to 'unknown')", async () => {
    const directorHandshake = {
      role: "director",
      globalInstanceId: "test-gid-director-2",
      clientMetadata: {
        clientName: "d", clientVersion: "0", proxyName: "@ois/d", proxyVersion: "0",
      },
    };
    await router.handle("register_role", directorHandshake, ctx);
    expect(ctx.stores.engineerRegistry.getRole(ctx.sessionId)).toBe("director");
  });

  it("director and engineer with same agent-name coexist without collision", async () => {
    // Different globalInstanceIds → different fingerprints → different agent IDs,
    // but both derive their prefix from their role declaration. Verifies that
    // the prefix selection is role-driven, not fingerprint-prefix-driven.
    const engResult = await router.handle("register_role", {
      role: "engineer", globalInstanceId: "gid-same-1",
      clientMetadata: { clientName: "c", clientVersion: "0", proxyName: "p", proxyVersion: "0" },
    }, createTestContext({ stores: ctx.stores, sessionId: "eng-session" }));

    const dirCtx = createTestContext({ stores: ctx.stores, sessionId: "dir-session" });
    const dirResult = await router.handle("register_role", {
      role: "director", globalInstanceId: "gid-same-2",
      clientMetadata: { clientName: "c", clientVersion: "0", proxyName: "p", proxyVersion: "0" },
    }, dirCtx);

    expect(JSON.parse(engResult.content[0].text).engineerId).toMatch(/^eng-/);
    expect(JSON.parse(dirResult.content[0].text).engineerId).toMatch(/^director-/);
  });

  it("touchAgent bumps lastSeenAt and flips drifted status back to online", async () => {
    await router.handle("register_role", engineerHandshake, ctx);
    // T2: claim session so the agent is online + has currentSessionId set.
    await router.handle("claim_session", {}, ctx);
    const reg = ctx.stores.engineerRegistry as any;
    const agents = await reg.listAgents();
    const eid = agents[0].engineerId;

    // Simulate drift: force lastTouchAt old and status offline
    reg.lastTouchAt.set(eid, 0);
    (await reg.getAgent(eid)); // noop — ensures agent exists
    await mutateAgentBlob(reg, eid, {
      status: "offline",
      lastSeenAt: "1970-01-01T00:00:00.000Z",
    });

    await reg.touchAgent(ctx.sessionId);

    const after = await reg.getAgent(eid);
    expect(after.status).toBe("online");
    expect(new Date(after.lastSeenAt).getTime()).toBeGreaterThan(0);
  });

  it("touchAgent is rate-limited (no-op within window)", async () => {
    await router.handle("register_role", engineerHandshake, ctx);
    // T2: claim session for parity with pre-T2 setup that established lastSeenAt + lastTouchAt.
    await router.handle("claim_session", {}, ctx);
    const reg = ctx.stores.engineerRegistry as any;
    const agents = await reg.listAgents();
    const eid = agents[0].engineerId;
    const firstSeen = (await reg.getAgent(eid)).lastSeenAt;

    // Second touch inside the window — should NOT update lastSeenAt.
    await new Promise((r) => setTimeout(r, 5));
    await reg.touchAgent(ctx.sessionId);
    const afterSeen = (await reg.getAgent(eid)).lastSeenAt;
    expect(afterSeen).toBe(firstSeen);
  });

  it("markAgentOffline flips status and only affects the owning session", async () => {
    await router.handle("register_role", engineerHandshake, ctx);
    // T2: claim session — markAgentOffline targets the session-owning agent,
    // which requires a session to be bound first.
    await router.handle("claim_session", {}, ctx);
    const reg = ctx.stores.engineerRegistry as any;
    const agents = await reg.listAgents();
    const eid = agents[0].engineerId;

    // Different (unrelated) session should NOT touch the agent.
    await reg.markAgentOffline("some-other-session");
    expect((await reg.getAgent(eid)).status).toBe("online");

    // Owning session should mark offline.
    await reg.markAgentOffline(ctx.sessionId);
    expect((await reg.getAgent(eid)).status).toBe("offline");
  });

  it("get_engineer_status projects from M18 Agents store", async () => {
    // Register + claim an engineer via M18 handshake so an Agent exists with claimed session
    await router.handle("register_role", engineerHandshake, ctx);
    await router.handle("claim_session", {}, ctx);

    // Call get_engineer_status from a separate session (now [Any], any role works)
    const archCtx = createTestContext({ stores: ctx.stores, sessionId: "test-arch-session" });
    await router.handle("register_role", { role: "architect" }, archCtx);
    const result = await router.handle("get_engineer_status", {}, archCtx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.engineers).toBeDefined();
    expect(parsed.engineers.length).toBeGreaterThanOrEqual(1);
    const eng = parsed.engineers[0];
    expect(eng.engineerId).toBeDefined();
    expect(eng.status).toBe("online");
    expect(eng.clientMetadata.proxyName).toBe("@ois/test-plugin");
    expect(eng.sessionEpoch).toBe(1);
  });

  // ── list_available_peers (M24-T8) ─────────────────────────────

  const architectHandshake = {
    role: "architect",
    globalInstanceId: "test-gid-architect",
    clientMetadata: {
      clientName: "test-arch-client",
      clientVersion: "0.0.0",
      proxyName: "@ois/test-plugin",
      proxyVersion: "0.0.0",
    },
  };

  it("list_available_peers returns pruned {agentId, role, labels} shape", async () => {
    // Register + claim one engineer with labels (T2: claim required for online status)
    await router.handle("register_role", {
      ...engineerHandshake,
      labels: { team: "billing", env: "prod" },
    }, ctx);
    await router.handle("claim_session", {}, ctx);

    // Caller: a separate session that'll list peers
    const callerCtx = createTestContext({ stores: ctx.stores, sessionId: "caller" });
    await router.handle("register_role", architectHandshake, callerCtx);

    const result = await router.handle("list_available_peers", {}, callerCtx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(1);
    const peer = parsed.peers[0];
    // Only {agentId, role, labels} — no sessionEpoch, clientMetadata,
    // lastSeenAt, or connection counts.
    expect(Object.keys(peer).sort()).toEqual(["agentId", "labels", "role"]);
    expect(peer.role).toBe("engineer");
    expect(peer.labels).toEqual({ team: "billing", env: "prod" });
  });

  it("list_available_peers filters by role", async () => {
    // T2: each agent needs claim_session to appear online in the peer list.
    await router.handle("register_role", engineerHandshake, ctx);
    await router.handle("claim_session", {}, ctx);

    const archCtx = createTestContext({ stores: ctx.stores, sessionId: "arch-session" });
    await router.handle("register_role", architectHandshake, archCtx);
    await router.handle("claim_session", {}, archCtx);

    const dirCtx = createTestContext({ stores: ctx.stores, sessionId: "dir-session" });
    await router.handle("register_role", {
      role: "director",
      globalInstanceId: "test-gid-director",
      clientMetadata: {
        clientName: "dir-client", clientVersion: "0",
        proxyName: "@ois/test-plugin", proxyVersion: "0",
      },
    }, dirCtx);
    await router.handle("claim_session", {}, dirCtx);

    // A fourth neutral caller session with no Agent entity.
    const caller = createTestContext({ stores: ctx.stores, sessionId: "caller" });

    const engOnly = JSON.parse(
      (await router.handle("list_available_peers", { role: "engineer" }, caller)).content[0].text
    );
    expect(engOnly.count).toBe(1);
    expect(engOnly.peers[0].role).toBe("engineer");

    const archOnly = JSON.parse(
      (await router.handle("list_available_peers", { role: "architect" }, caller)).content[0].text
    );
    expect(archOnly.count).toBe(1);
    expect(archOnly.peers[0].role).toBe("architect");

    const dirOnly = JSON.parse(
      (await router.handle("list_available_peers", { role: "director" }, caller)).content[0].text
    );
    expect(dirOnly.count).toBe(1);
    expect(dirOnly.peers[0].role).toBe("director");
  });

  it("list_available_peers honours matchLabels (subset equality)", async () => {
    await router.handle("register_role", {
      ...engineerHandshake,
      globalInstanceId: "gid-eng-a",
      labels: { team: "billing", env: "prod" },
    }, ctx);
    await router.handle("claim_session", {}, ctx);

    const eng2 = createTestContext({ stores: ctx.stores, sessionId: "eng2" });
    await router.handle("register_role", {
      ...engineerHandshake,
      globalInstanceId: "gid-eng-b",
      labels: { team: "shipping", env: "prod" },
    }, eng2);
    await router.handle("claim_session", {}, eng2);

    const caller = createTestContext({ stores: ctx.stores, sessionId: "caller" });
    const result = await router.handle("list_available_peers", {
      role: "engineer",
      matchLabels: { team: "billing" },
    }, caller);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(1);
    expect(parsed.peers[0].labels.team).toBe("billing");
  });

  it("list_available_peers excludes the caller's own agentId", async () => {
    await router.handle("register_role", engineerHandshake, ctx);
    await router.handle("claim_session", {}, ctx);
    const selfAgents = await ctx.stores.engineerRegistry.listAgents();
    const selfId = selfAgents[0].engineerId;

    // Register a second engineer in a separate session
    const otherCtx = createTestContext({ stores: ctx.stores, sessionId: "other" });
    await router.handle("register_role", {
      ...engineerHandshake,
      globalInstanceId: "gid-other",
    }, otherCtx);
    await router.handle("claim_session", {}, otherCtx);

    // Call from the original (self) session — should exclude self.
    const result = await router.handle("list_available_peers", { role: "engineer" }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.peers.every((p: { agentId: string }) => p.agentId !== selfId)).toBe(true);
    expect(parsed.count).toBe(1); // the other engineer
  });

  it("list_available_peers excludes offline agents", async () => {
    await router.handle("register_role", engineerHandshake, ctx);
    const reg = ctx.stores.engineerRegistry as any;
    const agents = await reg.listAgents();
    await mutateAgentBlob(reg, agents[0].engineerId, { status: "offline" });

    const caller = createTestContext({ stores: ctx.stores, sessionId: "caller" });
    const result = await router.handle("list_available_peers", {}, caller);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(0);
  });

  it("list_available_peers returns count=0 when no peers match", async () => {
    await router.handle("register_role", engineerHandshake, ctx);

    const caller = createTestContext({ stores: ctx.stores, sessionId: "caller" });
    const result = await router.handle("list_available_peers", {
      matchLabels: { team: "nonexistent" },
    }, caller);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(0);
    expect(parsed.peers).toEqual([]);
  });
});
