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
    expect(router.size).toBe(3);
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
    expect(router.size).toBe(4);
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

  it("register_role as engineer (M18 handshake) creates an Agent", async () => {
    const result = await router.handle("register_role", engineerHandshake, ctx);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.engineerId).toBeDefined();
    expect(parsed.sessionEpoch).toBe(1);
  });

  it("register_role as architect (legacy bare path) returns role confirmation", async () => {
    const result = await router.handle("register_role", { role: "architect" }, ctx);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.role).toBe("architect");
  });

  it("touchAgent bumps lastSeenAt and flips drifted status back to online", async () => {
    await router.handle("register_role", engineerHandshake, ctx);
    const reg = ctx.stores.engineerRegistry as any;
    const agents = await reg.listAgents();
    const eid = agents[0].engineerId;

    // Simulate drift: force lastTouchAt old and status offline
    reg.lastTouchAt.set(eid, 0);
    (await reg.getAgent(eid)); // noop — ensures agent exists
    reg.agents.get(eid).status = "offline";
    reg.agents.get(eid).lastSeenAt = "1970-01-01T00:00:00.000Z";

    await reg.touchAgent(ctx.sessionId);

    const after = await reg.getAgent(eid);
    expect(after.status).toBe("online");
    expect(new Date(after.lastSeenAt).getTime()).toBeGreaterThan(0);
  });

  it("touchAgent is rate-limited (no-op within window)", async () => {
    await router.handle("register_role", engineerHandshake, ctx);
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
    // Register an engineer via M18 handshake so an Agent exists
    await router.handle("register_role", engineerHandshake, ctx);

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
    // Register one engineer with labels
    await router.handle("register_role", {
      ...engineerHandshake,
      labels: { team: "billing", env: "prod" },
    }, ctx);

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
    await router.handle("register_role", engineerHandshake, ctx);

    const archCtx = createTestContext({ stores: ctx.stores, sessionId: "arch-session" });
    await router.handle("register_role", architectHandshake, archCtx);

    const dirCtx = createTestContext({ stores: ctx.stores, sessionId: "dir-session" });
    await router.handle("register_role", {
      role: "director",
      globalInstanceId: "test-gid-director",
      clientMetadata: {
        clientName: "dir-client", clientVersion: "0",
        proxyName: "@ois/test-plugin", proxyVersion: "0",
      },
    }, dirCtx);

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

    const eng2 = createTestContext({ stores: ctx.stores, sessionId: "eng2" });
    await router.handle("register_role", {
      ...engineerHandshake,
      globalInstanceId: "gid-eng-b",
      labels: { team: "shipping", env: "prod" },
    }, eng2);

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
    const selfAgents = await ctx.stores.engineerRegistry.listAgents();
    const selfId = selfAgents[0].engineerId;

    // Register a second engineer in a separate session
    const otherCtx = createTestContext({ stores: ctx.stores, sessionId: "other" });
    await router.handle("register_role", {
      ...engineerHandshake,
      globalInstanceId: "gid-other",
    }, otherCtx);

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
    reg.agents.get(agents[0].engineerId).status = "offline";

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
