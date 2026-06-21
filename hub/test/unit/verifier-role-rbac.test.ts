/**
 * verifier-role-rbac.test.ts — mission-93 verifier role, REAL-handshake RBAC.
 *
 * #338 independent review (2026-06-21) caught a critical gap: the tag-level
 * allow/deny was correct, but the `register_role` zod enum still rejected
 * 'verifier' → the role could never BIND → getRole='unknown' → router RBAC
 * fails-open for unknown → the verifier session would reach the full produce +
 * gating surface (the inverse of the role).
 *
 * The policy-router.test.ts RBAC cases use bindRole() (inject the role directly
 * on the registry), which BYPASSES session-policy — so they exercised a BOUND
 * verifier, a state production could never reach. These tests drive the REAL
 * register_role handshake (schema-validate → coerceAgentRole → bind) so the
 * registration-enum class cannot regress silently.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { PolicyRouter } from "../../src/policy/router.js";
import { registerSessionPolicy } from "../../src/policy/session-policy.js";
import { createTestContext, type TestPolicyContext } from "../../src/policy/test-utils.js";

const noop = () => {};

describe("verifier role — real register_role handshake + RBAC (mission-93, #338 review)", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;

  beforeEach(() => {
    router = new PolicyRouter(noop);
    registerSessionPolicy(router);
    // A stub of the [Architect] produce surface (mirrors create_mission /
    // create_task / update_mission — the tools a verifier must NOT reach).
    router.register("produce_stub", "[Architect] stub produce/gating tool", {}, async () => ({
      content: [{ type: "text", text: "ok" }],
    }));
    ctx = createTestContext();
  });

  it("register_role schema ACCEPTS role='verifier' and binds the session (the enum fix — would THROW pre-fix)", async () => {
    const reg = router.getToolRegistration("register_role");
    // Pre-fix the register_role zod enum was ["engineer","architect","director"]
    // → this parse threw on 'verifier'. The fix admits it.
    const parsedArgs = z.object(reg!.schema).parse({ role: "verifier", name: "test-verifier" });
    const result = await router.handle("register_role", parsedArgs, ctx);
    expect(result.isError).toBeUndefined();
    // Shape-independent proof the role BOUND (register_role's bare/M18 response
    // shapes vary) — assert exactly what the RBAC gate reads (router.ts getRole).
    expect(ctx.stores.engineerRegistry.getRole(ctx.sessionId)).toBe("verifier");
  });

  it("a register_role-BOUND verifier is DENIED the [Architect] produce surface (real bind, not injected)", async () => {
    const reg = router.getToolRegistration("register_role");
    const parsedArgs = z.object(reg!.schema).parse({ role: "verifier", name: "test-verifier-2" });
    await router.handle("register_role", parsedArgs, ctx);

    // The session is now GENUINELY bound to verifier via the handshake — not
    // injected. Pre-fix it would have stayed 'unknown' and the router's
    // fail-open path would have ALLOWED produce. This asserts a real bound
    // verifier is RBAC-denied the produce/gating surface.
    const denied = await router.handle("produce_stub", {}, ctx);
    expect(denied.isError).toBe(true);
    expect(JSON.parse(denied.content[0].text).error).toMatch(/architect/);
  });
});

describe("verifier cutover — role-CHANGE boundary on an existing agent (mission-93 cutover incident regression guard)", () => {
  // The live cutover (2026-06-20) failed because Steve's agent record persisted
  // role=architect while the cutover registered role=verifier. assertIdentity's
  // role-immutability "hard security boundary" (agent-repository-substrate.ts
  // :489-496) rejected the CHANGE → role_mismatch → the agent never came online
  // as verifier. A fresh-register-only test passes while this real role-change
  // fails — that gap is exactly what masked the bug for an hour. This guards it:
  // we LOCK IN that an unsanctioned role change via re-register is rejected
  // (not silently accepted, not silently degraded). When the durable sanctioned
  // role-change path (1b) lands, add a sibling test that it ALLOWS the change.
  const HANDSHAKE = {
    clientMetadata: { clientName: "test", clientVersion: "0.0.0", proxyName: "@apnex/test", proxyVersion: "0.0.0" },
  };

  it("register_role REJECTS changing an existing agent's role (architect→verifier) with role_mismatch", async () => {
    const router = new PolicyRouter(noop);
    registerSessionPolicy(router);
    const reg = router.getToolRegistration("register_role");
    const parse = (args: Record<string, unknown>) => z.object(reg!.schema).parse(args);

    // Session 1: register name 'cutover-agent' as architect → creates the record.
    const ctxA = createTestContext({ role: "architect" });
    const r1 = await router.handle("register_role", parse({ role: "architect", name: "cutover-agent", ...HANDSHAKE }), ctxA);
    expect(JSON.parse(r1.content[0].text).ok).toBe(true); // agent record created as architect

    // Session 2: SAME registry + SAME name, role=verifier → the role CHANGE.
    // (Sharing stores via override; distinct sessionId so it's a genuine
    // second handshake against the same persisted agent.)
    const ctxB = createTestContext({ stores: ctxA.stores, substrate: ctxA.substrate, role: "verifier" });
    const r2 = await router.handle("register_role", parse({ role: "verifier", name: "cutover-agent", ...HANDSHAKE }), ctxB);
    const body2 = JSON.parse(r2.content[0].text);
    expect(body2.ok).toBe(false);
    expect(body2.code).toBe("role_mismatch");
    expect(body2.message).toMatch(/does not match persisted/i);

    // The persisted agent role stays architect (the change did NOT commit).
    const agent = await ctxA.stores.engineerRegistry.getAgentForSession(ctxA.sessionId);
    expect(agent?.role).toBe("architect");
  });

  it("register_role MATCHES + succeeds when persisted role already equals registered role (post-cutover steady state)", async () => {
    // The mirror of the rejection — and the path the live cutover took AFTER
    // the operator set the persisted role to verifier (the in-place UPDATE):
    // a verifier re-registering MATCHES (verifier===verifier) → assertIdentity
    // proceeds → online. (When the durable sanctioned role-change primitive
    // (1b) lands, a sibling test will drive that primitive end-to-end instead
    // of the already-verifier steady state.)
    const router = new PolicyRouter(noop);
    registerSessionPolicy(router);
    const reg = router.getToolRegistration("register_role");
    const parse = (args: Record<string, unknown>) => z.object(reg!.schema).parse(args);

    // Session 1: fresh-register as verifier → createOnly path.
    const ctxA = createTestContext({ role: "verifier" });
    const r1 = await router.handle("register_role", parse({ role: "verifier", name: "verifier-steady", ...HANDSHAKE }), ctxA);
    expect(JSON.parse(r1.content[0].text).ok).toBe(true);

    // Session 2: re-register SAME name + SAME role → MATCH (no role_mismatch).
    const ctxB = createTestContext({ stores: ctxA.stores, substrate: ctxA.substrate, role: "verifier" });
    const r2 = await router.handle("register_role", parse({ role: "verifier", name: "verifier-steady", ...HANDSHAKE }), ctxB);
    expect(JSON.parse(r2.content[0].text).ok).toBe(true);
    const agent = await ctxB.stores.engineerRegistry.getAgentForSession(ctxB.sessionId);
    expect(agent?.role).toBe("verifier");
  });
});
