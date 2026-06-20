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
