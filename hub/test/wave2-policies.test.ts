/**
 * Wave 2 Policy Tests — Idea, Mission (work-162: Turn retired)
 *
 * Tests the CRUD + Events domain policies extracted in
 * The Great Decoupling T3.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../src/policy/router.js";
import { registerIdeaPolicy, computeBacklogHealth } from "../src/policy/idea-policy.js";
import { registerMissionPolicy } from "../src/policy/mission-policy.js";
import { createTestContext } from "../src/policy/test-utils.js";
import { AgentRepository } from "../src/entities/agent-repository.js";
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
    expect(router.has("get_idea")).toBe(true); // bug-45 / mission-69 W0: sister to get_bug, get_task, get_mission
  });

  // bug-45 / mission-69 W0: get_idea sister tool to get_bug / get_task / get_mission etc.
  describe("get_idea — bug-45 fix (sister to other get_X tools)", () => {
    it("returns idea by id (happy path)", async () => {
      const create = await router.handle("create_idea", {
        text: "Test idea for get_idea",
        tags: ["test"],
      }, ctx);
      const { ideaId } = JSON.parse(create.content[0].text);

      const get = await router.handle("get_idea", { ideaId }, ctx);
      expect(get.isError).toBeUndefined();
      const idea = JSON.parse(get.content[0].text);
      expect(idea.id).toBe(ideaId);
      expect(idea.text).toBe("Test idea for get_idea");
      expect(idea.status).toBe("open");
      expect(idea.tags).toEqual(["test"]);
    });

    it("returns isError for unknown ideaId (not-found path)", async () => {
      const get = await router.handle("get_idea", { ideaId: "idea-does-not-exist" }, ctx);
      expect(get.isError).toBe(true);
      const err = JSON.parse(get.content[0].text);
      expect(err.error).toContain("not found");
      expect(err.error).toContain("idea-does-not-exist");
    });
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

  it("bug-196 — list_ideas compact:true returns text→textPreview projection (omits the full body)", async () => {
    await router.handle("create_idea", { text: "A".repeat(200) + " trailing body", tags: ["t1"] }, ctx);
    const compact = JSON.parse((await router.handle("list_ideas", { compact: true }, ctx)).content[0].text);
    expect(compact.compact).toBe(true);
    const i = compact.ideas[0];
    expect(Object.keys(i).sort()).toEqual(["id", "missionId", "status", "tags", "textPreview", "updatedAt"]);
    expect(i.text).toBeUndefined();                       // full body OMITTED
    expect(i.textPreview.length).toBeLessThanOrEqual(141); // truncated (140 + ellipsis)
    // full mode preserves the body
    const full = JSON.parse((await router.handle("list_ideas", {}, ctx)).content[0].text);
    expect(full.ideas[0].text).toContain("trailing body");
  });

  it("bug-198 — list_ideas drops empty filter values (adapter empty-optional → UNSET, not a false zero)", async () => {
    await router.handle("create_idea", { text: "an open idea" }, ctx);
    // an empty value in the structured filter (opencode serializes UNSET as "") must be
    // dropped, not AND'd to zero matches.
    const parsed = JSON.parse((await router.handle("list_ideas", { filter: { missionId: "" } }, ctx)).content[0].text);
    expect(parsed._ois_query_unmatched).toBeUndefined();
    expect(parsed.count).toBeGreaterThanOrEqual(1);
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

  // ── update_idea addTags — additive-tag mode (idea-363 / work-59) ──
  describe("update_idea — addTags additive mode (idea-363)", () => {
    const tagsOf = async (ideaId: string) =>
      JSON.parse((await router.handle("get_idea", { ideaId }, ctx)).content[0].text).tags;

    it("unions addTags onto existing tags WITHOUT clobbering them", async () => {
      const c = await router.handle("create_idea", { text: "stamp me", tags: ["existing-a", "existing-b"] }, ctx);
      const { ideaId } = JSON.parse(c.content[0].text);
      const r = await router.handle("update_idea", { ideaId, addTags: ["audit:value:high"] }, ctx);
      expect(r.isError).toBeUndefined();
      // anti-regression (the clobber footgun): a replace would yield ["audit:value:high"] only.
      expect(await tagsOf(ideaId)).toEqual(["existing-a", "existing-b", "audit:value:high"]);
    });

    it("dedupes when addTags overlaps the existing set", async () => {
      const c = await router.handle("create_idea", { text: "dedupe", tags: ["x", "y"] }, ctx);
      const { ideaId } = JSON.parse(c.content[0].text);
      await router.handle("update_idea", { ideaId, addTags: ["y", "z"] }, ctx);
      expect(await tagsOf(ideaId)).toEqual(["x", "y", "z"]);
    });

    it("with both tags+addTags: tags replaces, then addTags unions onto it", async () => {
      const c = await router.handle("create_idea", { text: "both", tags: ["old"] }, ctx);
      const { ideaId } = JSON.parse(c.content[0].text);
      await router.handle("update_idea", { ideaId, tags: ["fresh"], addTags: ["extra"] }, ctx);
      expect(await tagsOf(ideaId)).toEqual(["fresh", "extra"]); // 'old' replaced out
    });

    it("seeds tags on a tagless idea", async () => {
      const c = await router.handle("create_idea", { text: "no tags" }, ctx);
      const { ideaId } = JSON.parse(c.content[0].text);
      await router.handle("update_idea", { ideaId, addTags: ["audit:effort:low"] }, ctx);
      expect(await tagsOf(ideaId)).toEqual(["audit:effort:low"]);
    });

    it("empty addTags is a no-op (does not wipe existing tags)", async () => {
      const c = await router.handle("create_idea", { text: "keep", tags: ["keep-me"] }, ctx);
      const { ideaId } = JSON.parse(c.content[0].text);
      await router.handle("update_idea", { ideaId, addTags: [] }, ctx);
      expect(await tagsOf(ideaId)).toEqual(["keep-me"]);
    });

    it("addTags on a non-existent idea returns isError", async () => {
      const r = await router.handle("update_idea", { ideaId: "idea-nope", addTags: ["x"] }, ctx);
      expect(r.isError).toBe(true);
    });
  });

  // ── get_backlog_health — idea-363 router integration ──────────────
  describe("get_backlog_health (idea-363)", () => {
    it("registers the tool", () => {
      expect(router.has("get_backlog_health")).toBe(true);
    });

    it("returns funnel + stuck readout over real ideas (asOf in the future = triaged idea stuck)", async () => {
      await router.handle("create_idea", { text: "open one" }, ctx);
      await router.handle("create_idea", { text: "open two" }, ctx);
      const t1 = JSON.parse((await router.handle("create_idea", { text: "triaged stuck" }, ctx)).content[0].text).ideaId;
      await router.handle("update_idea", { ideaId: t1, status: "triaged" }, ctx);
      const i1 = JSON.parse((await router.handle("create_idea", { text: "incorporate me" }, ctx)).content[0].text).ideaId;
      await router.handle("update_idea", { ideaId: i1, status: "incorporated" }, ctx);

      const future = new Date(Date.now() + 60 * 86400000).toISOString();
      const res = await router.handle("get_backlog_health", { asOf: future }, ctx);
      expect(res.isError).toBeUndefined();
      const h = JSON.parse(res.content[0].text);
      expect(h.funnel).toEqual({ open: 2, triaged: 1, dismissed: 0, incorporated: 1, total: 4 });
      expect(h.stuckInTriage.count).toBe(1);
      expect(h.stuckInTriage.ideaIds).toContain(t1);
      expect(h.incorporation).toEqual({ inFlight: 3, incorporated: 1, ratio: 3 });
      expect(h.truncated).toBe(false);
      expect(h.asOf).toBe(future);
    });

    it("a just-created triaged idea is NOT stuck at asOf=now", async () => {
      const t1 = JSON.parse((await router.handle("create_idea", { text: "fresh triaged" }, ctx)).content[0].text).ideaId;
      await router.handle("update_idea", { ideaId: t1, status: "triaged" }, ctx);
      const h = JSON.parse((await router.handle("get_backlog_health", {}, ctx)).content[0].text);
      expect(h.stuckInTriage.count).toBe(0);
    });
  });

  // ── Engineer RBAC (idea-49 / -52) ────────────────────────────────
  describe("Engineer role RBAC", () => {
    const asEngineer = (c: IPolicyContext) => {
      (c.stores.engineerRegistry as AgentRepository).setSessionRole(c.sessionId, "engineer");
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

// ── computeBacklogHealth — idea-363 pure logic (truncation + age buckets
//    are testable without 500 real ideas) ────────────────────────────────
describe("computeBacklogHealth (idea-363 pure logic)", () => {
  const T0 = Date.parse("2026-01-01T00:00:00Z");
  const ago = (days: number) => new Date(T0 - days * 86400000).toISOString();
  const mk = (id: string, daysOld: number, missionId: string | null = null): any =>
    ({ id, createdAt: ago(daysOld), missionId, tags: [], status: "open" });
  const empty = { open: [], triaged: [], dismissed: [], incorporated: [] };

  it("funnel counts each status bucket + total", () => {
    const h = computeBacklogHealth({
      open: [mk("idea-1", 1), mk("idea-2", 2)],
      triaged: [mk("idea-3", 1)],
      dismissed: [mk("idea-4", 1)],
      incorporated: [mk("idea-5", 1), mk("idea-6", 1), mk("idea-7", 1)],
    }, { asOfMs: T0, staleWeeks: 3 });
    expect(h.funnel).toEqual({ open: 2, triaged: 1, dismissed: 1, incorporated: 3, total: 7 });
  });

  it("open age histogram buckets by createdAt vs asOf", () => {
    const h = computeBacklogHealth({
      ...empty,
      open: [mk("a", 3), mk("b", 14), mk("c", 45), mk("d", 120)], // <1w | 1-4w | 1-3mo | >3mo
    }, { asOfMs: T0, staleWeeks: 3 });
    expect(h.openAgeHistogram).toEqual({ lt1w: 1, "1to4w": 1, "1to3mo": 1, gt3mo: 1 });
    expect(h.oldestOpenAgeDays).toBe(120);
  });

  it("stuckInTriage = triaged + no mission + age>staleWeeks (excludes linked + young)", () => {
    const h = computeBacklogHealth({
      ...empty,
      triaged: [mk("stuck", 30), mk("young", 5), mk("linked", 30, "mission-9")],
    }, { asOfMs: T0, staleWeeks: 3 });
    expect(h.stuckInTriage.count).toBe(1);
    expect(h.stuckInTriage.ideaIds).toEqual(["stuck"]);
    expect(h.stuckInTriage.staleWeeks).toBe(3);
  });

  it("staleWeeks param shifts the stuck threshold", () => {
    const triaged = [mk("t", 10)]; // 10 days old
    expect(computeBacklogHealth({ ...empty, triaged }, { asOfMs: T0, staleWeeks: 1 }).stuckInTriage.count).toBe(1); // 10>7
    expect(computeBacklogHealth({ ...empty, triaged }, { asOfMs: T0, staleWeeks: 3 }).stuckInTriage.count).toBe(0); // 10<21
  });

  it("incorporation ratio = inFlight:incorporated; null when none incorporated", () => {
    const h = computeBacklogHealth({
      ...empty,
      open: [mk("a", 1), mk("b", 1)], triaged: [mk("c", 1)], incorporated: [mk("d", 1)],
    }, { asOfMs: T0, staleWeeks: 3 });
    expect(h.incorporation).toEqual({ inFlight: 3, incorporated: 1, ratio: 3 });
    const h2 = computeBacklogHealth({ ...empty, open: [mk("a", 1)] }, { asOfMs: T0, staleWeeks: 3 });
    expect(h2.incorporation.ratio).toBeNull();
  });

  it("truncation-honest: flags buckets that hit the cap (else truncated:false)", () => {
    const h = computeBacklogHealth(empty, { asOfMs: T0, staleWeeks: 3, truncatedStatuses: ["open"] });
    expect(h.truncated).toBe(true);
    expect(h.truncatedStatuses).toEqual(["open"]);
    expect(h.truncationNote).toContain("500");
    expect(computeBacklogHealth(empty, { asOfMs: T0, staleWeeks: 3 }).truncated).toBe(false);
  });
});

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

  it("bug-196 — list_missions compact:true collapses virtual arrays to counts + omits description", async () => {
    await router.handle("create_mission", { title: "M-compact", description: "a long mission description body" }, ctx);
    const compact = JSON.parse((await router.handle("list_missions", { compact: true }, ctx)).content[0].text);
    expect(compact.compact).toBe(true);
    const m = compact.missions[0];
    expect(m.title).toBe("M-compact");
    expect(m.tasksCount).toBe(0);            // virtual `tasks` array → count
    expect(m.ideasCount).toBe(0);            // virtual `ideas` array → count
    expect(m.description).toBeUndefined();   // long-text OMITTED
    expect(m.tasks).toBeUndefined();         // heavy virtual array NOT inlined
    expect(m.plannedTasks).toBeUndefined();  // per-task directive bodies OMITTED
    // steve's #406 catch: an unclassified mission's optional missionClass must be PRESENT
    // as null (NOT undefined-dropped by JSON.stringify) → consistent compact row shape.
    expect(Object.prototype.hasOwnProperty.call(m, "missionClass")).toBe(true);
    expect(m.missionClass).toBeNull();
    // full mode preserves description
    const full = JSON.parse((await router.handle("list_missions", {}, ctx)).content[0].text);
    expect(full.missions[0].description).toBe("a long mission description body");
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

// work-162 (A1): the TurnPolicy describe block (create/update/get/list_turn)
// is retired with the Turn subsystem.
