import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { PolicyRouter } from "../src/policy/router.js";
import { registerSystemPolicy } from "../src/policy/system-policy.js";
import { isValidTransition } from "../src/policy/types.js";
import { createTestContext, type TestPolicyContext } from "../src/policy/test-utils.js";
import type { PolicyResult, DomainEvent } from "../src/policy/types.js";

// Suppress console.log during tests
const noop = () => {};

describe("PolicyRouter", () => {
  let router: PolicyRouter;

  beforeEach(() => {
    router = new PolicyRouter(noop);
  });

  it("registers and dispatches a tool", async () => {
    router.register("echo", "Echo tool", {
      message: z.string(),
    }, async (args) => ({
      content: [{ type: "text", text: args.message as string }],
    }));

    const ctx = createTestContext();
    const result = await router.handle("echo", { message: "hello" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe("hello");
  });

  it("returns error for unknown tool", async () => {
    const ctx = createTestContext();
    const result = await router.handle("nonexistent", {}, ctx);

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("Unknown tool");
  });

  it("drains internal events via cascade handlers", async () => {
    const cascadeLog: string[] = [];

    router.register("trigger", "Trigger tool", {}, async (_args, ctx) => {
      ctx.internalEvents.push({ type: "test_event", payload: { value: 42 } });
      return { content: [{ type: "text", text: "ok" }] };
    });

    router.onInternalEvent("test_event", async (event) => {
      cascadeLog.push(`handled: ${event.payload.value}`);
    });

    const ctx = createTestContext();
    await router.handle("trigger", {}, ctx);

    expect(cascadeLog).toEqual(["handled: 42"]);
    expect(ctx.internalEvents).toHaveLength(0);
  });

  it("emits cascade_failure notification when cascade handler throws", async () => {
    router.register("trigger_fail", "Trigger tool", {}, async (_args, ctx) => {
      ctx.internalEvents.push({ type: "bad_event", payload: {} });
      return { content: [{ type: "text", text: "ok" }] };
    });

    router.onInternalEvent("bad_event", async () => {
      throw new Error("cascade boom");
    });

    const ctx = createTestContext();
    const result = await router.handle("trigger_fail", {}, ctx);

    // Primary result should succeed
    expect(result.content[0].text).toBe("ok");

    // cascade_failure notification emitted
    const cascadeFailure = ctx.emittedEvents.find(e => e.event === "cascade_failure");
    expect(cascadeFailure).toBeDefined();
    expect(cascadeFailure!.data.originalTool).toBe("trigger_fail");
    expect(cascadeFailure!.data.failedEvent).toBe("bad_event");
    expect(cascadeFailure!.targetRoles).toEqual(["architect"]);
  });

  it("registers aliases correctly", () => {
    router.register("canonical", "Canonical tool", {}, async () => ({
      content: [{ type: "text", text: "canonical" }],
    }));
    router.registerAlias("alias", "canonical");

    expect(router.has("alias")).toBe(true);
    expect(router.getRegisteredTools()).toEqual(["canonical"]);
    expect(router.getAllToolNames()).toContain("alias");
    expect(router.size).toBe(2);
  });

  it("throws when creating alias for non-existent canonical tool", () => {
    expect(() => router.registerAlias("bad_alias", "missing")).toThrow(
      "Cannot create alias 'bad_alias': canonical tool 'missing' not registered"
    );
  });

  describe("RBAC role parsing + multi-role tags (Phase 2x P2-6)", () => {
    // Bind a session to a role directly on the in-memory registry —
    // bypasses session-policy since we only want to exercise the
    // router's RBAC enforcement here, not the full handshake.
    async function bindRole(ctx: TestPolicyContext, role: "architect" | "engineer" | "director" | "verifier"): Promise<void> {
      await ctx.stores.engineerRegistry.registerAgent(
        ctx.sessionId,
        role,
        {
          name: `test-gid-${ctx.sessionId}-${role}`,
          proxyName: "test",
          proxyVersion: "0",
          clientName: "test",
          clientVersion: "0",
        } as any,
      );
    }

    it("single-role tag [Architect] permits architect, rejects engineer", async () => {
      router.register("arch_only", "[Architect] Architect-only tool", {}, async () => ({
        content: [{ type: "text", text: "ok" }],
      }));

      const archCtx = createTestContext({ role: "architect" });
      await bindRole(archCtx, "architect");
      expect((await router.handle("arch_only", {}, archCtx)).isError).toBeUndefined();

      const engCtx = createTestContext({ role: "engineer", stores: archCtx.stores });
      await bindRole(engCtx, "engineer");
      const engResult = await router.handle("arch_only", {}, engCtx);
      expect(engResult.isError).toBe(true);
      const parsed = JSON.parse(engResult.content[0].text);
      expect(parsed.error).toMatch(/requires role 'architect'/);
    });

    it("composite tag [Architect|Director] permits both, rejects engineer", async () => {
      router.register("admin_tool", "[Architect|Director] Admin-shared tool", {}, async () => ({
        content: [{ type: "text", text: "ok" }],
      }));

      const archCtx = createTestContext({ role: "architect" });
      await bindRole(archCtx, "architect");
      expect((await router.handle("admin_tool", {}, archCtx)).isError).toBeUndefined();

      const dirCtx = createTestContext({ role: "director", stores: archCtx.stores });
      await bindRole(dirCtx, "director");
      expect((await router.handle("admin_tool", {}, dirCtx)).isError).toBeUndefined();

      const engCtx = createTestContext({ role: "engineer", stores: archCtx.stores });
      await bindRole(engCtx, "engineer");
      const engResult = await router.handle("admin_tool", {}, engCtx);
      expect(engResult.isError).toBe(true);
      const parsed = JSON.parse(engResult.content[0].text);
      // Error message must list both permitted roles so the caller knows
      // why their engineer session can't use an admin tool.
      expect(parsed.error).toMatch(/architect/);
      expect(parsed.error).toMatch(/director/);
    });

    it("[Any] tag permits all registered roles", async () => {
      router.register("anyone_tool", "[Any] Anyone tool", {}, async () => ({
        content: [{ type: "text", text: "ok" }],
      }));
      for (const role of ["architect", "engineer", "director", "verifier"] as const) {
        const c = createTestContext({ role });
        await bindRole(c, role);
        expect((await router.handle("anyone_tool", {}, c)).isError).toBeUndefined();
      }
    });

    // ── mission-93: verifier role RBAC (verifier-role.md v1.0 §2.3) ──
    // Refute-not-produce. GRANT = read + finding-surfacing ([Any] tools,
    // covered above, + the explicitly tagged [Architect|Verifier]
    // create_audit_entry / get_metrics). DENY = the produce surface — the
    // [Architect]/[Engineer] tools the verifier must NOT be able to drive.
    it("[Architect|Verifier] permits verifier + architect, rejects engineer (create_audit_entry/get_metrics grant)", async () => {
      router.register("verdict_tool", "[Architect|Verifier] Verifier verdict-record tool", {}, async () => ({
        content: [{ type: "text", text: "ok" }],
      }));
      const verCtx = createTestContext({ role: "verifier" });
      await bindRole(verCtx, "verifier");
      expect((await router.handle("verdict_tool", {}, verCtx)).isError).toBeUndefined();

      const archCtx = createTestContext({ role: "architect", stores: verCtx.stores });
      await bindRole(archCtx, "architect");
      expect((await router.handle("verdict_tool", {}, archCtx)).isError).toBeUndefined();

      const engCtx = createTestContext({ role: "engineer", stores: verCtx.stores });
      await bindRole(engCtx, "engineer");
      expect((await router.handle("verdict_tool", {}, engCtx)).isError).toBe(true);
    });

    it("verifier is DENIED the produce surface: [Architect] + [Engineer] tools reject verifier", async () => {
      router.register("produce_arch", "[Architect] Produce tool (e.g. create_mission/create_task/update_mission)", {}, async () => ({
        content: [{ type: "text", text: "ok" }],
      }));
      router.register("produce_eng", "[Engineer] Produce tool (e.g. create_proposal)", {}, async () => ({
        content: [{ type: "text", text: "ok" }],
      }));
      const verCtx = createTestContext({ role: "verifier" });
      await bindRole(verCtx, "verifier");

      const r1 = await router.handle("produce_arch", {}, verCtx);
      expect(r1.isError).toBe(true);
      expect(JSON.parse(r1.content[0].text).error).toMatch(/architect/);

      const r2 = await router.handle("produce_eng", {}, verCtx);
      expect(r2.isError).toBe(true);
      expect(JSON.parse(r2.content[0].text).error).toMatch(/engineer/);
    });

    it("missing/unknown role tag falls back to [Any]", async () => {
      router.register("untagged", "No tag here", {}, async () => ({
        content: [{ type: "text", text: "ok" }],
      }));
      const c = createTestContext({ role: "engineer" });
      await bindRole(c, "engineer");
      expect((await router.handle("untagged", {}, c)).isError).toBeUndefined();
    });
  });
});

// work-162 (A1): the "FSM validation" (TASK_FSM) + "TaskPolicy" describe blocks
// are retired with the Task subsystem (create/get/list/cancel_task, create_report,
// task claim/review/dependency lifecycle).
