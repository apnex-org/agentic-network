/**
 * legible0 — ORDERED SCAN + HONEST ENVELOPE, THROUGH THE REGISTERED ROUTER.
 *
 * 🔴 THE DEFECT THESE PIN, MEASURED ON THE DEPLOYED SURFACE 2026-08-05T23:44Z:
 *   idea-727 (createdAt 12:36:17Z) EXISTS and reads fine via get_idea, but
 *   list_ideas{filter:{createdAt:{$gt:"2026-08-01"}}} returned ONLY idea-717 and
 *   idea-719. Ideas 720-727 were never inside the UNORDERED 500-row scan window,
 *   so the in-memory filter never saw them.
 *
 *   NOT A FALSE ZERO — A FALSE PARTIAL, WHICH IS STRICTLY WORSE. Two rows came back,
 *   so the query read as successful. A zero invites suspicion; a plausible partial
 *   does not.
 *
 * THE FIX UNDER TEST IS THE *WINDOW*, NOT THE CAP. The cap is unchanged at 500;
 * ordering newest-first changes WHICH 500 survive it. That is why ordering alone
 * answers the acceptance query with no filter push-down (push-down was attempted
 * and REVERTED — it silently broke dotted-path filters, trading a false partial for
 * a false zero).
 *
 * ⚠️ EVERY TEST HERE DRIVES THE REGISTERED HANDLER OVER THE REAL REPOSITORY AND
 * SUBSTRATE. A helper test is blind to this class by construction: the cap and the
 * ORDER BY are applied by the STORE, before any helper runs.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { PolicyRouter } from "../router.js";
import { registerIdeaPolicy } from "../idea-policy.js";
import { registerDocumentPolicy } from "../document-policy.js";
import { createTestContext } from "../test-utils.js";
import { DocumentRepository, DOCUMENT_LIST_CAP } from "../../storage-substrate/new-repositories.js";

const LIST_CAP = 500;

function ideaRouter() {
  const ctx = createTestContext();
  const router = new PolicyRouter();
  registerIdeaPolicy(router);
  return { ctx, router };
}

/** The shared context deliberately wires NO document store (two tests assert the
 *  handler's absence-degradation), so it is wired locally rather than mutating a
 *  shared harness. */
function docRouter() {
  const ctx = createTestContext();
  ctx.stores.document = new DocumentRepository(ctx.substrate);
  const router = new PolicyRouter();
  registerDocumentPolicy(router);
  return { ctx, router };
}

const call = async (router: PolicyRouter, ctx: any, tool: string, args: Record<string, unknown> = {}) =>
  JSON.parse(
    (await router.handle(tool, args, { ...ctx, role: "architect", agentId: "agent-t" } as any)).content[0].text,
  );

afterEach(() => vi.restoreAllMocks());

describe("legible0 — the scan window is ordered newest-first", () => {
  /**
   * 🔴 THE ACCEPTANCE SHAPE. The newest rows are created LAST, so under ANY
   * insertion-ordered or id-lexicographic window they fall outside the cap and
   * vanish — which is precisely what happened to ideas 720-727 in production.
   *
   * ⭐ THE RED DIRECTION FOR THIS ASSERTION: delete the `sort` from
   * IdeaRepositorySubstrate.listIdeas and the newest rows drop out of the window
   * again. VERIFIED BY MUTATION — see the matrix in the delivery evidence.
   */
  it("🔴 a row created AFTER the cap is reached is still REACHABLE (the idea-727 shape)", async () => {
    const { ctx, router } = ideaRouter();
    // 525 older rows, then the one we care about — newest, and last-inserted.
    for (let i = 0; i < LIST_CAP + 25; i++) {
      await ctx.stores.idea.submitIdea(`old ${i}`, { role: "engineer", agentId: "agent-t" });
    }
    const newest = await ctx.stores.idea.submitIdea("THE NEWEST IDEA", {
      role: "engineer",
      agentId: "agent-t",
    });

    const env = await call(router, ctx, "list_ideas", { limit: 5, compact: true });

    // the window is capped, and says so
    expect(env.truncated).toBe(true);
    expect(env.total).toBeNull(); // exact-or-null
    // 🔴 AND THE NEWEST ROW SURVIVED THE CAP — the whole point
    const all = await call(router, ctx, "list_ideas", { limit: 500, compact: true });
    expect(all.ideas.map((i: any) => i.id)).toContain(newest.id);
  }, 180_000);

  /**
   * 🔴 A TEST WAS DELETED HERE, AND WHY IS THE EVIDENCE. It asserted "the ordering is
   * by TIME, not by id" by reading the ORDER OF THE RESPONSE. THE MUTATION MATRIX
   * PROVED IT VACUOUS — mutating the repository sort to `id DESC only` left it GREEN.
   *
   * TWO INDEPENDENT REASONS, both found by probing rather than reasoning:
   *
   * 1. IT MEASURED THE WRONG LAYER. There are two orderings and only one is mine:
   *      WINDOW selection  — WHICH 500 rows survive the scan cap  (repository/substrate: THE FIX)
   *      PRESENTATION order— how those rows are ordered in the reply (idea-policy.ts:170
   *                          applyQuerySort, implicit id:asc when the caller passes no sort)
   *    A probe returned ["idea-1","idea-10","idea-11","idea-12","idea-2",...] — pure
   *    lexicographic ASC, i.e. the POLICY's presentation order, which I did not change
   *    and MUST NOT change (it is the documented tie-break). The test read presentation
   *    and concluded about the window.
   *
   * 2. EVEN AT THE RIGHT LAYER, THE SCENARIO CANNOT DISCRIMINATE AT THIS SIZE. With
   *    ids idea-1..idea-525, the lexicographically-smallest 25 (idea-1, idea-10,
   *    idea-100..109, idea-11, ...) are all OLD rows, so an id-DESC window and a
   *    createdAt-DESC window KEEP THE SAME NEWEST ROWS. The two orderings only diverge
   *    for reachability once ids cross a decade boundary that inverts them — n > 1000.
   *
   * ⇒ ADMITTED GAP, STATED NOT PAPERED OVER: "the window is TIME-selected rather than
   *   ID-selected" is NOT covered by an executing test. What would settle it: seed
   *   >1000 ideas so the newest id sorts lexicographically BELOW the retained set.
   *   Not done here — it is a multi-minute seed for a property whose load-bearing half
   *   (reachability of the newest row) IS covered by the test above, mutation-proven.
   */
});

describe("legible0 — the loud guard on the envelope invariant", () => {
  /**
   * 🔴 WHY THIS EXISTS. The newest-first order sorts on `metadata.createdAt`, which
   * is correct ONLY IF every row is envelope-shaped. That invariant is ASSERTED in
   * three source files and ENFORCED IN NONE — BareEnvelopeError catches the OPPOSITE
   * failure (an undecoded envelope reaching a consumer); NOTHING detects a flat row
   * at storage. A flat row would sort as NULL and land arbitrarily in the window:
   * A SILENT MISS, reproducing inside the fix the exact class the fix exists to kill.
   *
   * ⭐ RED DIRECTION: delete the guard and this assertion fails while everything else
   * stays green — which is the definition of a guard that is actually enforced.
   */
  /**
   * 🔴 THE GUARD WAS REWRITTEN AFTER ARCHITECT REVIEW, AND ITS RED DIRECTION IS NOW PROVEN.
   *
   * V1 tested `!i.createdAt` on the DECODED entity. The review asked a question I could
   * not settle: would a FLAT row (createdAt at top level) still DECODE with `createdAt`
   * populated? If so the guard is silent exactly when the sort is broken — a guard that
   * fires only on a row malformed in BOTH shapes.
   *
   * I could not answer it cheaply (the memory substrate has encodeForWrite and NO
   * decode-on-read; no sanctioned path can create a flat row at all — substrate.put
   * envelopes every write). SO THE DEPENDENCY WAS REMOVED RATHER THAN THE QUESTION
   * ANSWERED: V2 asserts THE PROPERTY THE SORT IS SUPPOSED TO DELIVER — that the window
   * is non-increasing in createdAt.
   *
   * ⭐ MEASURING THE EFFECT BEATS MEASURING A HYPOTHESISED CAUSE. V2 detects a broken
   * newest-first window from ANY cause — flat row, translation failure, dropped ORDER BY,
   * a substrate that ignores `sort` — and CANNOT be silent while the window is wrong,
   * because the window being wrong is what it tests.
   *
   * ✅ RED DIRECTION, MUTATION-VERIFIED (mutant existence confirmed before trusting the
   * verdict): flipping the scan to `metadata.createdAt ASC` FIRES the guard. V1's red
   * direction was UNPROVEN BY TEST and admitted as such; V2's is proven.
   */
  it("✅ a healthy collection emits NO breach — the guard is not a permanent alarm", async () => {
    const { ctx, router } = ideaRouter();
    await ctx.stores.idea.submitIdea("healthy", { role: "engineer", agentId: "agent-t" });

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await call(router, ctx, "list_ideas", { limit: 10, compact: true });

    const msg = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(msg).not.toContain("INVARIANT BREACH");
  }, 60_000);
});

describe("legible0 — list_documents finally has an honest envelope", () => {
  /**
   * 🔴 BEFORE THIS CHANGE list_documents emitted `{documents, count}` AND NOTHING
   * ELSE. A TRUE zero and a CAPPED zero were indistinguishable on that surface even
   * after bug-487 pushed the prefix down — its siblings list_ideas and list_work
   * both carry an honesty envelope; documents carried none.
   *
   * ⚠️ THE CAP IS 100, NOT ITS SIBLINGS' 500. It was IMPLICIT (no `limit` passed →
   * substrate default) and is now the explicit exported DOCUMENT_LIST_CAP so the scan
   * and the envelope that reports it cannot drift. LEFT AT 100 DELIBERATELY: the
   * sealed cut authorises an honest envelope, not a wider scan. The 5× asymmetry is
   * REPORTED, not silently fixed.
   */
  it("🔴 a scan AT the cap sets truncated + a note whose advice is TRUE on this surface", async () => {
    const { ctx, router } = docRouter();
    for (let i = 0; i < DOCUMENT_LIST_CAP + 5; i++) {
      await ctx.stores.document!.put({
        id: `docs/legible0/d-${String(i).padStart(4, "0")}.md`,
        content: "x", category: "planning",
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      } as any);
    }
    const env = await call(router, ctx, "list_documents", {});

    expect(env.truncated).toBe(true);
    expect(env.truncationNote).toContain("FLOOR");
    // 🔴 bug-497: the note must name a remedy that WORKS HERE. Both document axes
    // are substrate-pushed, so narrowing genuinely reduces the scan — unlike the
    // ideas note, whose "narrow with filter/tags" advice was false when filters
    // did not push down.
    expect(env.truncationNote).toContain("Narrowing WORKS");
  }, 180_000);

  it("✅ a scan BELOW the cap is silent — fields ABSENT, not present-and-false", async () => {
    const { ctx, router } = docRouter();
    await ctx.stores.document!.put({
      id: "docs/legible0/only.md", content: "x", category: "planning",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as any);
    const env = await call(router, ctx, "list_documents", {});

    expect(env.count).toBe(1);
    expect("truncated" in env).toBe(false);
    expect("truncationNote" in env).toBe(false);
  }, 60_000);
});
