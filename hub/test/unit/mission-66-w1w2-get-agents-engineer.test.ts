/**
 * Mission-66 W1+W2 commit 3 — engineer-pool symmetric callability of get_agents.
 *
 * Closes calibration #21 (engineer Agent-record read-surface gap; OPEN since
 * mission-62-W4). Hub `get_agents` is declared `[Any]` role-callable at the
 * MCP tool surface (session-policy.ts:684); RBAC bypasses for `[Any]`-tagged
 * tools at policy-router.ts:120. This test asserts the closure structurally:
 *
 *   1. get_agents tool registration parses `roles: Set("any")` from the [Any]
 *      role-tag prefix
 *   2. Engineer-role caller (resolved via engineerRegistry.getRole(sessionId)
 *      after register_role) successfully invokes get_agents — no Authorization
 *      denied error
 *   3. Architect-role caller likewise — symmetric callability proven
 *
 * Per Design §2.1.1 v0.2 fold (engineer round-1 audit Q1; thread-422):
 * scope is engineer-adapter-dispatcher-inclusion + e2e — Hub-side change is
 * conditional on discovery of a quiet role-gate. This test confirms NO Hub-side
 * change is needed; PolicyRouter `[Any]` bypass already serves engineer-pool
 * symmetrically.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../../src/policy/router.js";
import { registerSessionPolicy } from "../../src/policy/session-policy.js";
import { createTestContext, type TestPolicyContext } from "../../src/policy/test-utils.js";

const noop = () => {};

const engineerHandshake = {
  role: "engineer",
  globalInstanceId: "test-gid-mission-66-engineer",
  clientMetadata: {
    clientName: "test-client",
    clientVersion: "0.0.0",
    proxyName: "@apnex/test-plugin",
    proxyVersion: "0.0.0",
    sdkVersion: "@apnex/network-adapter@test",
  },
};

const architectHandshake = {
  role: "architect",
  globalInstanceId: "test-gid-mission-66-architect",
  clientMetadata: {
    clientName: "test-client",
    clientVersion: "0.0.0",
    proxyName: "@apnex/test-plugin",
    proxyVersion: "0.0.0",
    sdkVersion: "@apnex/network-adapter@test",
  },
};

async function setupAndClaim(
  router: PolicyRouter,
  ctx: TestPolicyContext,
  handshake: Record<string, unknown>,
): Promise<string> {
  await router.handle("register_role", handshake, ctx);
  const claim = await router.handle("claim_session", {}, ctx);
  const claimParsed = JSON.parse(claim.content[0].text);
  return claimParsed.agent.id as string;
}

describe("Mission-66 W1+W2 commit 3 — engineer-pool symmetric callability of get_agents (closes #21)", () => {
  let router: PolicyRouter;

  beforeEach(() => {
    router = new PolicyRouter(noop);
    registerSessionPolicy(router);
  });

  it("get_agents tool registration parses [Any] role-tag → roles Set contains 'any' sentinel", () => {
    const tool = router.getToolRegistration("get_agents");
    expect(tool).toBeDefined();
    expect(tool!.roles.has("any")).toBe(true);
  });

  it("engineer-role caller invokes get_agents successfully (RBAC bypass via [Any] tag)", async () => {
    const ctx = createTestContext({ role: "engineer" });
    const eid = await setupAndClaim(router, ctx, engineerHandshake);

    const result = await router.handle("get_agents", {}, ctx);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeUndefined();
    expect(parsed.agents).toBeDefined();
    expect(Array.isArray(parsed.agents)).toBe(true);
    expect(parsed.agents.length).toBe(1);
    expect(parsed.agents[0].id).toBe(eid);
    expect(parsed.agents[0].role).toBe("engineer");
  });

  it("architect-role caller invokes get_agents successfully (symmetric callability)", async () => {
    const ctx = createTestContext({ role: "architect" });
    const aid = await setupAndClaim(router, ctx, architectHandshake);

    const result = await router.handle("get_agents", {}, ctx);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeUndefined();
    expect(parsed.agents).toBeDefined();
    expect(parsed.agents.length).toBe(1);
    expect(parsed.agents[0].id).toBe(aid);
    expect(parsed.agents[0].role).toBe("architect");
  });

  it("engineer + architect see identical projection shape (symmetric AgentProjection)", async () => {
    const engCtx = createTestContext({ role: "engineer" });
    await setupAndClaim(router, engCtx, engineerHandshake);
    const engResult = await router.handle("get_agents", {}, engCtx);
    const engProjection = JSON.parse(engResult.content[0].text).agents[0];

    const archCtx = createTestContext({ role: "architect" });
    await setupAndClaim(router, archCtx, architectHandshake);
    const archResult = await router.handle("get_agents", {}, archCtx);
    const archProjection = JSON.parse(archResult.content[0].text).agents[0];

    // Field-set identity: engineer + architect projections expose the same
    // canonical AgentProjection field set (mission-63 ADR-028 substrate).
    const engKeys = Object.keys(engProjection).sort();
    const archKeys = Object.keys(archProjection).sort();
    expect(engKeys).toEqual(archKeys);
  });
});
