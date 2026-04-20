import { describe, it, expect } from "vitest";
import { resolveCreatedBy, HUB_SYSTEM_PROVENANCE } from "../../src/policy/caller-identity.js";
import { createTestContext } from "../../src/policy/test-utils.js";

describe("resolveCreatedBy", () => {
  it("returns {role, agentId} when both session role and agent record are resolvable", async () => {
    const ctx = createTestContext();
    ctx.role = "architect";
    // Register an architect session so engineerRegistry.getAgentForSession resolves.
    await ctx.stores.engineerRegistry.registerAgent(ctx.sessionId, "architect", {
      globalInstanceId: "arch-test-1",
      transport: "stdio",
    } as any, "127.0.0.1");

    const prov = await resolveCreatedBy(ctx);
    expect(prov.role).toBe("architect");
    expect(prov.agentId).toMatch(/^eng-/); // resolved agent id
  });

  it("returns anonymous-<role> placeholder when role is set but no agent record exists", async () => {
    const ctx = createTestContext();
    ctx.role = "engineer";
    // No registerAgent call — session has role from ctx but no Agent record.
    const prov = await resolveCreatedBy(ctx);
    expect(prov).toEqual({ role: "engineer", agentId: "anonymous-engineer" });
  });

  it("returns {role: system, agentId: hub-system} when ctx has no role (Hub-internal)", async () => {
    const ctx = createTestContext();
    ctx.role = "unknown";
    const prov = await resolveCreatedBy(ctx);
    expect(prov).toEqual(HUB_SYSTEM_PROVENANCE);
  });

  it("returns system fallback when ctx.role is empty string", async () => {
    const ctx = createTestContext();
    ctx.role = "";
    const prov = await resolveCreatedBy(ctx);
    expect(prov).toEqual(HUB_SYSTEM_PROVENANCE);
  });

  it("swallows registry errors — returns role-only placeholder instead of throwing", async () => {
    const ctx = createTestContext();
    ctx.role = "engineer";
    // Monkey-patch registry to throw.
    (ctx.stores.engineerRegistry as any).getAgentForSession = async () => {
      throw new Error("simulated registry failure");
    };
    const prov = await resolveCreatedBy(ctx);
    expect(prov).toEqual({ role: "engineer", agentId: "anonymous-engineer" });
  });

  it("exports HUB_SYSTEM_PROVENANCE as a stable constant", () => {
    expect(HUB_SYSTEM_PROVENANCE).toEqual({ role: "system", agentId: "hub-system" });
  });

  it("propagates ctx.role verbatim (no enum lock)", async () => {
    const ctx = createTestContext();
    ctx.role = "director"; // not in the default test fixture
    const prov = await resolveCreatedBy(ctx);
    expect(prov.role).toBe("director");
    // No registered agent — placeholder agentId.
    expect(prov.agentId).toBe("anonymous-director");
  });
});
