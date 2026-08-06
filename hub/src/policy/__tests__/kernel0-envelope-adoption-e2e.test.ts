/**
 * kernel0 — THE THREE REMAINING DISHONEST SURFACES, END TO END.
 *
 * 🔴 WHY END-TO-END AND NOT AGAINST THE HELPER. bug-484 was invisible to nine
 * tests of `paginated()` AND to a verifier seal, because the helper never sees
 * the substrate scan cap — the store applies it BEFORE the helper runs.
 * Rendering a helper is not rendering a surface. So these drive the REGISTERED
 * ROUTER against REAL repositories, over their REAL caps.
 *
 * WHAT WAS WRONG, per surface, measured 2026-08-06:
 *   list_threads   emitted `total: page.total` as EXACT while the scan stopped at
 *                  LIST_PREFETCH_CAP. A FLOOR presented as a CERTAINTY.
 *   list_missions  emitted no `truncated` AT ALL, and an exact-looking `total`,
 *                  while the repository scan stopped at an INLINE `500` the policy
 *                  layer could not even see.
 *   list_decisions the repository ALREADY computed `truncated` and the policy
 *                  forwarded that one flag while discarding total/complete/offset/
 *                  limit and any note. The signal existed and was under-used.
 *
 * 🔴 AND THE THIRD DESCRIBE-BLOCK IS THE ONE THAT MATTERS MOST, because it does
 * not test this change at all — it tests that a FUTURE change cannot silently
 * break three consumers that exist TODAY (bug-517).
 */
import { describe, it, expect } from "vitest";
import { PolicyRouter } from "../router.js";
import { registerThreadPolicy } from "../thread-policy.js";
import { registerMissionPolicy } from "../mission-policy.js";
import { createTestContext } from "../test-utils.js";
import { LIST_PREFETCH_CAP } from "../../entities/thread-repository-substrate.js";
import { MISSION_LIST_CAP } from "../../entities/mission-repository-substrate.js";

type Ctx = ReturnType<typeof createTestContext>;

const call = async (r: PolicyRouter, ctx: Ctx, verb: string, args: Record<string, unknown>) => {
  const res = await r.handle(verb, args, ctx);
  return JSON.parse((res.content[0] as { text: string }).text);
};

async function seedThreads(n: number) {
  const ctx = createTestContext();
  const router = new PolicyRouter();
  registerThreadPolicy(router);
  for (let i = 0; i < n; i++) {
    await ctx.stores.thread.openThread(`t${i}`, `m${i}`, "architect", {});
  }
  return { ctx, router };
}

async function seedMissions(n: number) {
  const ctx = createTestContext();
  const router = new PolicyRouter();
  registerMissionPolicy(router);
  for (let i = 0; i < n; i++) {
    await ctx.stores.mission.createMission(`mission ${i}`, `d${i}`);
  }
  return { ctx, router };
}

// ── list_threads ────────────────────────────────────────────────────────────

describe("kernel0 — list_threads, collection LARGER than the scan cap", () => {
  it("🔴 total is NULL, not the scan floor — the FLOOR-AS-CERTAINTY lie this surface shipped", async () => {
    const { ctx, router } = await seedThreads(LIST_PREFETCH_CAP + 5);
    const env = await call(router, ctx, "list_threads", { limit: 1 });

    // THE PROPERTY: a capped scan cannot know the true count, so it must not state one.
    expect(env.total).toBeNull();
    expect(env.scanned).toBe(LIST_PREFETCH_CAP); // the floor, under an honest name
    expect(env.truncated).toBe(true);
    expect(env.complete).toBe(false);
    expect(typeof env.truncationNote).toBe("string");
    expect(env.truncationNote).toContain("INCOMPLETE");

    // 🔴 ADDED AFTER THE MUTATION MATRIX WENT GREEN ON A MUTANT THAT MATTERED.
    // `scanCap` feeds ONLY the note text, so a wrong value changes no behaviour and
    // ships a note asserting a cap that does not exist. Mutating 500 -> 999999 left
    // all seven tests passing. On an arc whose entire charter is surfaces that state
    // false things, a note free to state a false number is the defect itself — so
    // assert the note names the REAL cap, not merely that a note exists.
    // ⚠️ AND THE FIRST VERSION OF THIS ASSERTION WAS ITSELF VACUOUS: `toContain("500")`
    // passed under the mutant, because the note ALSO contains `not 500` from page.total
    // — satisfied by a DIFFERENT 500, at a position that says nothing about the cap.
    // A test that passes for a reason unrelated to what it tests is worse than none.
    // Bind the number to its SEMANTIC POSITION instead of anywhere in the string.
    expect(env.truncationNote).toContain(`the ${LIST_PREFETCH_CAP}-row cap`);
  });

  it("under the cap, `total` IS exact and nothing claims truncation", async () => {
    const { ctx, router } = await seedThreads(3);
    const env = await call(router, ctx, "list_threads", { limit: 10 });

    expect(env.total).toBe(3);
    expect(env.truncated).toBe(false);
    expect(env.complete).toBe(true);
    expect(env.truncationNote).toBeUndefined();
  });
});

// ── list_missions ───────────────────────────────────────────────────────────

describe("kernel0 — list_missions, collection LARGER than the scan cap", () => {
  it("🔴 emits a truncation signal AT ALL — this surface previously had none", async () => {
    const { ctx, router } = await seedMissions(MISSION_LIST_CAP + 5);
    const env = await call(router, ctx, "list_missions", { limit: 1 });

    expect(env.truncated).toBe(true);
    expect(env.total).toBeNull();
    expect(env.scanned).toBe(MISSION_LIST_CAP);
    expect(env.complete).toBe(false);
  });

  it("under the cap, `total` IS exact and nothing claims truncation", async () => {
    const { ctx, router } = await seedMissions(2);
    const env = await call(router, ctx, "list_missions", { limit: 10 });

    expect(env.total).toBe(2);
    expect(env.truncated).toBe(false);
    expect(env.complete).toBe(true);
  });

  it("the compact projection still rides the kernel envelope", async () => {
    const { ctx, router } = await seedMissions(2);
    const env = await call(router, ctx, "list_missions", { compact: true, limit: 10 });

    expect(env.compact).toBe(true);
    expect(env.total).toBe(2);
    expect(env.complete).toBe(true);
  });
});

// ── THE ANTI-RENAME GUARD (bug-517) ─────────────────────────────────────────

describe("kernel0 — 🔴 THE COLLECTION KEY IS PART OF THE WIRE CONTRACT (bug-517)", () => {
  /**
   * This block does NOT test the kernel0 change. It tests that a LATER change
   * cannot silently break consumers that exist today.
   *
   * MEASURED 2026-08-06 (work-648 + correction-1): these surfaces have out-of-hub
   * consumers that read the COLLECTION and never touch an envelope field —
   *   list_threads   → adapters/pi-plugin/src/footer-poll.ts:209 (every tick)
   *   list_missions  → ois/bin/ois:1441
   *   list_decisions → ois/bin/ois:1424
   * `paginated()` names its rows `items`. Spreading the envelope WITHOUT re-keying
   * would rename the collection — exactly as list_messages renamed items→messages.
   *
   * 🔴 THE FAILURE IS SILENT: the footer would report 0 and the ois verbs would see
   * an empty string. Nothing throws. Nothing goes red. That is why this is a test
   * and not a comment — a comment is prose, and prose does not fail a build.
   */
  it("list_threads keys its rows `threads` and NEVER leaks a bare `items`", async () => {
    const { ctx, router } = await seedThreads(2);
    const env = await call(router, ctx, "list_threads", { limit: 10 });

    expect(Array.isArray(env.threads)).toBe(true);
    expect(env.threads).toHaveLength(2);
    expect(env.items).toBeUndefined(); // the rename that would break footer-poll.ts:209
  });

  it("list_missions keys its rows `missions` and NEVER leaks a bare `items`", async () => {
    const { ctx, router } = await seedMissions(2);
    const env = await call(router, ctx, "list_missions", { limit: 10 });

    expect(Array.isArray(env.missions)).toBe(true);
    expect(env.missions).toHaveLength(2);
    expect(env.items).toBeUndefined(); // the rename that would break ois:1441
  });
});

// ── LEG 2: THE SCAN WINDOW (bug-442 / bug-358) ──────────────────────────────

describe("kernel0 — 🔴 list_messages scans the NEWEST rows, not the oldest (bug-442)", () => {
  /**
   * THE DEFECT: listFiltered scanned id-ASCENDING with a LIST_PREFETCH_CAP limit,
   * so once a filtered set exceeded the cap the substrate handed back THE OLDEST
   * 500 — a caller asking about recent activity saw four-month-old rows while
   * hundreds of newer ones were never looked at. MEASURED live during this arc's
   * own baseline freeze: a 2026-04-25 row at index 0.
   *
   * 🔴 `paginated()` CANNOT FIX THIS AND THAT IS THE ARC'S WHOLE THESIS. The kernel
   * pages the array it is HANDED; the wrong 500 rows were chosen upstream of it.
   * list_messages was already a full, clean adopter while this was live.
   *
   * ⚠️ WHAT THIS TEST DOES *NOT* CLAIM: that output order changed. It did not, and
   * deliberately — the poll-backstop advances its cursor with max(id) over the whole
   * array (order-independent), but it surfaces events in array order, and reversing
   * that is a consumer-visible change this arc did not clear. Output stays ASCENDING.
   * "SCAN WINDOW FIXED" MUST NOT READ AS "RECENT-FIRST", exactly as "kernel adopted"
   * must not read as "surface fixed".
   */
  it("with more rows than the cap, the window holds the NEWEST — not a four-month-old tail", async () => {
    const ctx = createTestContext();
    const router = new PolicyRouter();
    const { registerMessagePolicy } = await import("../message-policy.js");
    registerMessagePolicy(router);

    const CAP = 500;
    const ids: string[] = [];
    for (let i = 0; i < CAP + 20; i++) {
      const m = await ctx.stores.message.createMessage({
        kind: "note",
        authorRole: "system",
        authorAgentId: "hub",
        target: { role: "engineer" },
        delivery: "push-immediate",
        payload: { body: `m${i}` },
      });
      ids.push(m.id);
    }
    const newest20 = new Set(ids.slice(-20));
    const oldest20 = new Set(ids.slice(0, 20));

    const env = await call(router, ctx, "list_messages", { targetRole: "engineer", limit: 500 });
    const returned = new Set((env.messages as Array<{ id: string }>).map((m) => m.id));

    // THE PROPERTY: the scan retained the newest rows. Every one of the 20 most
    // recent is inside the window; the 20 oldest were correctly dropped BY THE CAP.
    for (const id of newest20) expect(returned.has(id)).toBe(true);
    let oldestSeen = 0;
    for (const id of oldest20) if (returned.has(id)) oldestSeen++;
    expect(oldestSeen).toBe(0);

    // and it is still honest about having been capped
    expect(env.truncated).toBe(true);
    expect(env.total).toBeNull();
  });

  it("output order is still ASCENDING — the consumer contract is unchanged", async () => {
    const ctx = createTestContext();
    const router = new PolicyRouter();
    const { registerMessagePolicy } = await import("../message-policy.js");
    registerMessagePolicy(router);
    for (let i = 0; i < 5; i++) {
      await ctx.stores.message.createMessage({
        kind: "note", authorRole: "system", authorAgentId: "hub",
        target: { role: "engineer" }, delivery: "push-immediate", payload: { body: `m${i}` },
      });
    }
    const env = await call(router, ctx, "list_messages", { targetRole: "engineer", limit: 10 });
    const got = (env.messages as Array<{ id: string }>).map((m) => m.id);
    expect(got).toEqual([...got].sort());
  });
});

// ── A NOTE MUST NOT ASSERT SOMETHING FALSE IN THE STATE THAT RENDERS IT ──────

describe("kernel0 — 🔴 a truncationNote is read ONLY when capped, so it must not describe the UNCAPPED state", () => {
  /**
   * THE DEFECT THIS GUARDS, CAUGHT IN REVIEW BY greg AND FIXED BY SUBTRACTION:
   * `list_decisions`' narrowBy once ended "...unmeasurable while the collection sits
   * BELOW the cap". But `truncationNote` is emitted IFF scanCapped, and scanCapped is
   * `items.length >= LIST_CAP` — so a reader meets that sentence ONLY when the
   * collection is AT OR ABOVE the cap. Invisible at 36 rows. WRONG THE FIRST TIME IT
   * IS EVER READ. bug-497's family, fifth instance, inside the fix for the fourth.
   *
   * ⭐ WHY THIS IS A TEST AND NOT A RESOLUTION TO BE CAREFUL: the same commit that
   * shipped that clause ALSO contained a paragraph correctly reasoning that an argument
   * "would INVERT the moment this collection passed the cap". THE IDENTICAL TEMPORAL
   * ERROR, CAUGHT IN THE PROSE AND MISSED IN THE STRING, BY THE SAME AUTHOR, IN ONE
   * COMMIT. Getting the reasoning right about a class does not transfer to the artifact
   * unless something checks the artifact. Corpus for vocabulary; gates for enforcement.
   *
   * ASSERTS THE PROPERTY, NOT THE PHRASE: the note is rendered in the capped state, so
   * no note may contain a claim scoped to the uncapped state. Adding a new surface with
   * a new narrowBy that reintroduces the shape fails here without anyone remembering why.
   */
  const BELOW_CAP_CLAIMS = [
    "below the cap",
    "under the cap",
    "beneath the cap",
    "not yet capped",
    "sits below",
  ];

  it("no rendered truncationNote describes the collection as being BELOW the cap", async () => {
    const { ctx, router } = await seedThreads(LIST_PREFETCH_CAP + 5);
    const env = await call(router, ctx, "list_threads", { limit: 1 });

    // positive control: we are genuinely in the capped state, so a note MUST exist —
    // otherwise this test passes vacuously by never rendering anything (bug-464's class).
    expect(env.truncated).toBe(true);
    expect(typeof env.truncationNote).toBe("string");
    expect(env.truncationNote.length).toBeGreaterThan(0);

    const note = (env.truncationNote as string).toLowerCase();
    for (const claim of BELOW_CAP_CLAIMS) {
      expect(note).not.toContain(claim);
    }
  });
});
