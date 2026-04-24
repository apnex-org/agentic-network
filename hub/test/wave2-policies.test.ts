/**
 * Wave 2 Policy Tests — Idea, Mission, Turn
 *
 * Tests the CRUD + Events domain policies extracted in
 * The Great Decoupling T3.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../src/policy/router.js";
import { registerIdeaPolicy } from "../src/policy/idea-policy.js";
import { registerMissionPolicy } from "../src/policy/mission-policy.js";
import { registerTurnPolicy } from "../src/policy/turn-policy.js";
import { createTestContext } from "../src/policy/test-utils.js";
import { MemoryEngineerRegistry } from "../src/state.js";
import type { IPolicyContext } from "../src/policy/types.js";

const noop = () => {};

// ── Idea Policy ─────────────────────────────────────────────────────

describe("IdeaPolicy", () => {
  let router: PolicyRouter;
  let ctx: IPolicyContext;

  beforeEach(() => {
    router = new PolicyRouter(noop);
    registerIdeaPolicy(router);
    registerMissionPolicy(router); // needed for auto-linkage tests
    ctx = createTestContext();
  });

  it("registers all idea tools", () => {
    expect(router.has("create_idea")).toBe(true);
    expect(router.has("list_ideas")).toBe(true);
    expect(router.has("update_idea")).toBe(true);
  });

  it("create_idea creates and emits idea_submitted", async () => {
    const result = await router.handle("create_idea", {
      text: "We should add dark mode",
      tags: ["ui", "feature"],
    }, ctx);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ideaId).toBeDefined();
    expect(parsed.status).toBe("open");

    const emitted = (ctx as any).emittedEvents.find((e: any) => e.event === "idea_submitted");
    expect(emitted).toBeDefined();
  });

  it("list_ideas returns ideas", async () => {
    await router.handle("create_idea", { text: "Idea 1" }, ctx);
    await router.handle("create_idea", { text: "Idea 2" }, ctx);

    const result = await router.handle("list_ideas", {}, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(2);
  });

  it("list_ideas filters by status", async () => {
    await router.handle("create_idea", { text: "Open idea" }, ctx);

    const result = await router.handle("list_ideas", { status: "triaged" }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(0);
  });

  // ── Phase C (task-306): createdBy.* nested paths ─────────────────
  describe("list_ideas — M-QueryShape Phase C (task-306)", () => {
    async function seedWithCreatedBy(): Promise<void> {
      // Mission-47 W2: Idea store is StorageProvider-backed — the
      // legacy internal `ideas` Map no longer exists. Submit ideas
      // directly through the store API with the desired createdBy
      // provenance instead of mutating internal state.
      await ctx.stores.idea.submitIdea(
        "Idea 1",
        { role: "architect", agentId: "eng-alpha" },
      );
      await ctx.stores.idea.submitIdea(
        "Idea 2",
        { role: "engineer", agentId: "eng-beta" },
      );
      await ctx.stores.idea.submitIdea(
        "Idea 3",
        { role: "architect", agentId: "eng-gamma" },
      );
    }

    it("filter: createdBy.role selects architect-created ideas only", async () => {
      await seedWithCreatedBy();
      const result = await router.handle(
        "list_ideas",
        { filter: { "createdBy.role": "architect" } },
        ctx,
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.ideas.length).toBe(2);
      expect(parsed.ideas.every((i: any) => i.createdBy.role === "architect")).toBe(true);
    });

    it("filter: createdBy.agentId selects a specific agent", async () => {
      await seedWithCreatedBy();
      const result = await router.handle(
        "list_ideas",
        { filter: { "createdBy.agentId": "eng-beta" } },
        ctx,
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.ideas.length).toBe(1);
      expect(parsed.ideas[0].id).toBe("idea-2");
    });

    it("filter: createdBy.id matches computed `${role}:${agentId}`", async () => {
      await seedWithCreatedBy();
      const result = await router.handle(
        "list_ideas",
        { filter: { "createdBy.id": "architect:eng-gamma" } },
        ctx,
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.ideas.length).toBe(1);
      expect(parsed.ideas[0].id).toBe("idea-3");
    });

    it("sort: createdBy.id asc orders by the `role:agentId` composite", async () => {
      await seedWithCreatedBy();
      const result = await router.handle(
        "list_ideas",
        { sort: [{ field: "createdBy.id", order: "asc" }] },
        ctx,
      );
      const parsed = JSON.parse(result.content[0].text);
      // Lexical: architect:eng-alpha < architect:eng-gamma < engineer:eng-beta
      expect(parsed.ideas.map((i: any) => i.id)).toEqual(["idea-1", "idea-3", "idea-2"]);
    });

    it("yields _ois_query_unmatched when filter matches nothing", async () => {
      await seedWithCreatedBy();
      const result = await router.handle(
        "list_ideas",
        { filter: { "createdBy.role": "director" } },
        ctx,
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.ideas.length).toBe(0);
      expect(parsed._ois_query_unmatched).toBe(true);
    });

    it("filter.status wins over legacy scalar status when both present", async () => {
      // Verifies backwards-compat legacy path still works post-rewrite
      await router.handle("create_idea", { text: "Open A" }, ctx);
      const createResult = await router.handle("create_idea", { text: "Open B" }, ctx);
      const { ideaId } = JSON.parse(createResult.content[0].text);
      await router.handle("update_idea", { ideaId, status: "triaged" }, ctx);

      const result = await router.handle(
        "list_ideas",
        { status: "open", filter: { status: "triaged" } },
        ctx,
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.ideas.length).toBe(1);
      expect(parsed.ideas[0].status).toBe("triaged");
    });
  });

  it("update_idea changes status", async () => {
    const createResult = await router.handle("create_idea", { text: "Update me" }, ctx);
    const { ideaId } = JSON.parse(createResult.content[0].text);

    const result = await router.handle("update_idea", {
      ideaId,
      status: "triaged",
    }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("triaged");
  });

  it("update_idea with missionId auto-incorporates and links", async () => {
    // Create a mission first
    const missionResult = await router.handle("create_mission", {
      title: "Test Mission",
      description: "A mission for testing",
    }, ctx);
    const { missionId } = JSON.parse(missionResult.content[0].text);

    // Create an idea
    const ideaResult = await router.handle("create_idea", { text: "Link me" }, ctx);
    const { ideaId } = JSON.parse(ideaResult.content[0].text);

    // Update with missionId — should auto-set status to incorporated
    const result = await router.handle("update_idea", {
      ideaId,
      missionId,
    }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("incorporated");
    expect(parsed.missionId).toBe(missionId);
  });

  it("update_idea returns error for non-existent idea", async () => {
    const result = await router.handle("update_idea", {
      ideaId: "idea-999",
      status: "triaged",
    }, ctx);
    expect(result.isError).toBe(true);
  });

  it("update_idea modifies text (closes idea-26)", async () => {
    const createResult = await router.handle("create_idea", { text: "Original" }, ctx);
    const { ideaId } = JSON.parse(createResult.content[0].text);

    await router.handle("update_idea", { ideaId, text: "Revised wording" }, ctx);
    const listResult = await router.handle("list_ideas", {}, ctx);
    const { ideas } = JSON.parse(listResult.content[0].text);
    const updated = ideas.find((i: any) => i.id === ideaId);
    expect(updated.text).toBe("Revised wording");
  });

  // ── Engineer RBAC (idea-49 / -52) ────────────────────────────────
  describe("Engineer role RBAC", () => {
    const asEngineer = (c: IPolicyContext) => {
      (c.stores.engineerRegistry as MemoryEngineerRegistry).setSessionRole(c.sessionId, "engineer");
      return c;
    };

    it("Engineer may edit text and tags", async () => {
      const createResult = await router.handle("create_idea", { text: "Needs edit" }, ctx);
      const { ideaId } = JSON.parse(createResult.content[0].text);
      asEngineer(ctx);

      const textResult = await router.handle("update_idea", { ideaId, text: "Edited by engineer" }, ctx);
      expect(textResult.isError).toBeUndefined();

      const tagsResult = await router.handle("update_idea", { ideaId, tags: ["bug", "fix"] }, ctx);
      expect(tagsResult.isError).toBeUndefined();
    });

    it("Engineer may transition status open → triaged", async () => {
      const createResult = await router.handle("create_idea", { text: "Triage me" }, ctx);
      const { ideaId } = JSON.parse(createResult.content[0].text);
      asEngineer(ctx);

      const result = await router.handle("update_idea", { ideaId, status: "triaged" }, ctx);
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe("triaged");
    });

    it("Engineer is rejected when setting status='dismissed'", async () => {
      const createResult = await router.handle("create_idea", { text: "Dismiss?" }, ctx);
      const { ideaId } = JSON.parse(createResult.content[0].text);
      asEngineer(ctx);

      const result = await router.handle("update_idea", { ideaId, status: "dismissed" }, ctx);
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toMatch(/only Architect may set idea status 'dismissed'/);
    });

    it("Engineer is rejected when setting status='incorporated'", async () => {
      const createResult = await router.handle("create_idea", { text: "Incorporate?" }, ctx);
      const { ideaId } = JSON.parse(createResult.content[0].text);
      asEngineer(ctx);

      const result = await router.handle("update_idea", { ideaId, status: "incorporated" }, ctx);
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toMatch(/only Architect may set idea status 'incorporated'/);
    });

    it("Engineer is rejected when setting missionId", async () => {
      const createResult = await router.handle("create_idea", { text: "Link?" }, ctx);
      const { ideaId } = JSON.parse(createResult.content[0].text);
      asEngineer(ctx);

      const result = await router.handle("update_idea", { ideaId, missionId: "mission-1" }, ctx);
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toMatch(/only Architect may link an idea to a mission/);
    });

    it("Architect retains full capability (dismiss + missionId)", async () => {
      const missionResult = await router.handle("create_mission", {
        title: "M",
        description: "d",
      }, ctx);
      const { missionId } = JSON.parse(missionResult.content[0].text);
      const createResult = await router.handle("create_idea", { text: "Arch can do all" }, ctx);
      const { ideaId } = JSON.parse(createResult.content[0].text);

      // Default ctx role is architect (registry returns "unknown" which
      // short-circuits the outer RBAC check; engineer-only gate in the
      // handler does not fire because callerRole !== "engineer").
      const linkResult = await router.handle("update_idea", { ideaId, missionId }, ctx);
      expect(linkResult.isError).toBeUndefined();

      const create2 = await router.handle("create_idea", { text: "To dismiss" }, ctx);
      const { ideaId: id2 } = JSON.parse(create2.content[0].text);
      const dismissResult = await router.handle("update_idea", { ideaId: id2, status: "dismissed" }, ctx);
      expect(dismissResult.isError).toBeUndefined();
    });
  });
});

// ── Mission Policy ──────────────────────────────────────────────────

describe("MissionPolicy", () => {
  let router: PolicyRouter;
  let ctx: IPolicyContext;

  beforeEach(() => {
    router = new PolicyRouter(noop);
    registerMissionPolicy(router);
    ctx = createTestContext();
  });

  it("registers all mission tools", () => {
    expect(router.has("create_mission")).toBe(true);
    expect(router.has("update_mission")).toBe(true);
    expect(router.has("get_mission")).toBe(true);
    expect(router.has("list_missions")).toBe(true);
  });

  it("create_mission creates and emits mission_created", async () => {
    const result = await router.handle("create_mission", {
      title: "Decoupling Phase 1",
      description: "Extract all policies",
    }, ctx);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.missionId).toBeDefined();
    expect(parsed.status).toBe("proposed");

    const emitted = (ctx as any).emittedEvents.find((e: any) => e.event === "mission_created");
    expect(emitted).toBeDefined();
  });

  it("update_mission to active emits mission_activated", async () => {
    const createResult = await router.handle("create_mission", {
      title: "Test", description: "Desc",
    }, ctx);
    const { missionId } = JSON.parse(createResult.content[0].text);

    const result = await router.handle("update_mission", {
      missionId,
      status: "active",
    }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("active");

    const emitted = (ctx as any).emittedEvents.find((e: any) => e.event === "mission_activated");
    expect(emitted).toBeDefined();
  });

  it("get_mission returns a created mission", async () => {
    const createResult = await router.handle("create_mission", {
      title: "Get me", description: "Desc",
    }, ctx);
    const { missionId } = JSON.parse(createResult.content[0].text);

    const result = await router.handle("get_mission", { missionId }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.title).toBe("Get me");
  });

  it("get_mission returns error for non-existent", async () => {
    const result = await router.handle("get_mission", { missionId: "mission-999" }, ctx);
    expect(result.isError).toBe(true);
  });

  it("list_missions filters by status", async () => {
    await router.handle("create_mission", { title: "M1", description: "D1" }, ctx);

    const result = await router.handle("list_missions", { status: "active" }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(0); // newly created missions are "proposed"
  });

  // ── Phase C (task-306): createdBy.* nested paths on list_missions ──
  describe("list_missions — M-QueryShape Phase C (task-306)", () => {
    async function seedMissionsWithCreatedBy(): Promise<void> {
      // Mission-47 W4: Mission store is StorageProvider-backed — the
      // legacy internal `missions` Map no longer exists. Create missions
      // directly through the store API with the desired createdBy
      // provenance instead of mutating internal state.
      await ctx.stores.mission.createMission(
        "M1", "D1", undefined, undefined,
        { role: "architect", agentId: "eng-alpha" },
      );
      await ctx.stores.mission.createMission(
        "M2", "D2", undefined, undefined,
        { role: "engineer", agentId: "eng-beta" },
      );
      await ctx.stores.mission.createMission(
        "M3", "D3", undefined, undefined,
        { role: "architect", agentId: "eng-gamma" },
      );
    }

    it("filter: createdBy.role selects architect-created missions only", async () => {
      await seedMissionsWithCreatedBy();
      const result = await router.handle(
        "list_missions",
        { filter: { "createdBy.role": "architect" } },
        ctx,
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.missions.length).toBe(2);
      expect(parsed.missions.every((m: any) => m.createdBy.role === "architect")).toBe(true);
    });

    it("filter: createdBy.agentId selects a specific agent", async () => {
      await seedMissionsWithCreatedBy();
      const result = await router.handle(
        "list_missions",
        { filter: { "createdBy.agentId": "eng-beta" } },
        ctx,
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.missions.length).toBe(1);
      expect(parsed.missions[0].id).toBe("mission-2");
    });

    it("filter: createdBy.id matches computed `${role}:${agentId}`", async () => {
      await seedMissionsWithCreatedBy();
      const result = await router.handle(
        "list_missions",
        { filter: { "createdBy.id": "architect:eng-gamma" } },
        ctx,
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.missions.length).toBe(1);
      expect(parsed.missions[0].id).toBe("mission-3");
    });

    it("sort: createdBy.id asc orders by `role:agentId` composite", async () => {
      await seedMissionsWithCreatedBy();
      const result = await router.handle(
        "list_missions",
        { sort: [{ field: "createdBy.id", order: "asc" }] },
        ctx,
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.missions.map((m: any) => m.id)).toEqual(["mission-1", "mission-3", "mission-2"]);
    });

    it("yields _ois_query_unmatched when filter matches nothing", async () => {
      await seedMissionsWithCreatedBy();
      const result = await router.handle(
        "list_missions",
        { filter: { "createdBy.role": "director" } },
        ctx,
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.missions.length).toBe(0);
      expect(parsed._ois_query_unmatched).toBe(true);
    });
  });
});

// ── Turn Policy ─────────────────────────────────────────────────────

describe("TurnPolicy", () => {
  let router: PolicyRouter;
  let ctx: IPolicyContext;

  beforeEach(() => {
    router = new PolicyRouter(noop);
    registerTurnPolicy(router);
    ctx = createTestContext();
  });

  it("registers all turn tools", () => {
    expect(router.has("create_turn")).toBe(true);
    expect(router.has("update_turn")).toBe(true);
    expect(router.has("get_turn")).toBe(true);
    expect(router.has("list_turns")).toBe(true);
  });

  it("create_turn creates and emits turn_created", async () => {
    const result = await router.handle("create_turn", {
      title: "Sprint 1",
      scope: "Build the core platform",
    }, ctx);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.turnId).toBeDefined();
    expect(parsed.status).toBe("planning");

    const emitted = (ctx as any).emittedEvents.find((e: any) => e.event === "turn_created");
    expect(emitted).toBeDefined();
  });

  it("update_turn changes status and emits turn_updated", async () => {
    const createResult = await router.handle("create_turn", {
      title: "Test Turn", scope: "Testing",
    }, ctx);
    const { turnId } = JSON.parse(createResult.content[0].text);

    const result = await router.handle("update_turn", {
      turnId,
      status: "active",
    }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("active");

    const emitted = (ctx as any).emittedEvents.find((e: any) => e.event === "turn_updated");
    expect(emitted).toBeDefined();
  });

  it("get_turn returns a created turn", async () => {
    const createResult = await router.handle("create_turn", {
      title: "Get me", scope: "Scope",
    }, ctx);
    const { turnId } = JSON.parse(createResult.content[0].text);

    const result = await router.handle("get_turn", { turnId }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.title).toBe("Get me");
  });

  it("get_turn returns error for non-existent", async () => {
    const result = await router.handle("get_turn", { turnId: "turn-999" }, ctx);
    expect(result.isError).toBe(true);
  });

  it("create_turn with tele IDs", async () => {
    const result = await router.handle("create_turn", {
      title: "Guided Turn",
      scope: "With goals",
      tele: ["tele-1", "tele-2"],
    }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.turnId).toBeDefined();
  });

  it("list_turns filters by status", async () => {
    await router.handle("create_turn", { title: "T1", scope: "S1" }, ctx);

    const result = await router.handle("list_turns", { status: "active" }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(0); // newly created turns are "planning"
  });
});
