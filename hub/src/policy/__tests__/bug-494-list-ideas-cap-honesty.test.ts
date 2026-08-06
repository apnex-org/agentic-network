/**
 * bug-494 — list_ideas CAP HONESTY, END TO END THROUGH THE REGISTERED ROUTER.
 *
 * 🔴 WHY THIS DRIVES THE SURFACE AND NOT A HELPER. bug-484 was invisible to nine
 * helper tests AND to a verifier seal, because the cap is applied by the STORE,
 * before any helper runs. Rendering a helper is not rendering a surface. So this
 * uses the real IdeaRepositorySubstrate — whose listIdeas() passes limit:500 —
 * and the real registered handler. Nothing stubbed.
 *
 * PORTS bug-200's three clauses from bug-policy: the truncated flag, the
 * total-is-a-floor note, and suppression of the _ois_query_unmatched sentinel
 * when the scan was truncated (steve's #410 clause — a zero-result over a capped
 * window is NOT definitive).
 */
import { describe, it, expect } from "vitest";
import { PolicyRouter } from "../router.js";
import { registerIdeaPolicy } from "../idea-policy.js";
import { createTestContext } from "../test-utils.js";

const LIST_CAP = 500;

async function seed(count: number) {
  const ctx = createTestContext();
  const router = new PolicyRouter();
  registerIdeaPolicy(router);
  for (let i = 0; i < count; i++) {
    await ctx.stores.idea.submitIdea(`idea body ${i}`, { role: "engineer", agentId: "agent-test" }, undefined, ["seeded"]);
  }
  return { ctx, router };
}

const call = async (
  r: PolicyRouter,
  ctx: ReturnType<typeof createTestContext>,
  args: Record<string, unknown>,
) => {
  const res = await r.handle("list_ideas", args, ctx);
  return JSON.parse((res.content[0] as { text: string }).text);
};

describe("bug-494 — list_ideas cap honesty (ports bug-200)", () => {
  // ── NEGATIVE FIXTURE: MUST flag truncation ──────────────────────────────
  it("🔴 a scan AT the cap sets truncated + declares total a FLOOR", async () => {
    const { ctx, router } = await seed(LIST_CAP + 25); // 525 > cap
    const env = await call(router, ctx, { limit: 1 });

    expect(env.truncated).toBe(true);
    // 🔴 legible0 / steve's ruling SUPERSEDES bug-494's original contract.
    // bug-494 shipped `total: 500` as "the floor, honestly labelled". Measured
    // tonight, that still emits a bare exact-looking integer beside truncated:true,
    // and a reader takes the integer. RULING: total is an exact count or it is NULL,
    // matching list_work / list_ready_work, which already do this via paginated().
    // ⚠️ THIS TEST CHANGED BECAUSE AN EXTERNAL RULING CHANGED THE CONTRACT — not
    // because the implementation was inconvenient. The floor is still reported: it
    // moves to `scanned`/the note, where it cannot be mistaken for a count.
    expect(env.total).toBeNull();
    expect(env.truncationNote).toContain("FLOOR");
    // the reachability finding, in the surface the caller reads:
    expect(env.truncationNote).toContain("offset CANNOT REACH THEM");
  }, 120_000);

  // ── NEAR-MISS: MUST NOT flag ────────────────────────────────────────────
  it("✅ a scan BELOW the cap is silent — no truncated, no note, fields ABSENT not zeroed", async () => {
    const { ctx, router } = await seed(10);
    const env = await call(router, ctx, { limit: 5 });

    expect(env.total).toBe(10); // exact, and it IS the collection
    expect("truncated" in env).toBe(false);
    expect("truncationNote" in env).toBe(false);
  }, 60_000);

  // ── THE SUBTLE CLAUSE: sentinel suppression under truncation ────────────
  // 🔴 legible0 CONFIRMS THIS CLAUSE RATHER THAN RETIRING IT. An earlier revision of
  // this arc pushed the filter into the substrate, which made this scenario return a
  // DEFINITIVE zero — that push-down was REVERTED (it silently broke dotted-path
  // filters like createdBy.role → 0 rows, trading a false partial for a FALSE ZERO).
  // The scan is therefore still UNFILTERED: 525 seeded ideas cap at 500, the filter
  // runs in memory over that window, and a zero from it is NOT definitive.
  // ⭐ WHAT legible0 DID CHANGE HERE: the window is now ORDERED newest-first, so the
  // 500 rows are the NEWEST 500 rather than an arbitrary 500 — which is what makes
  // idea-727 reachable. The cap is unchanged; WHICH rows it keeps is the fix.
  it("🔴 _ois_query_unmatched is SUPPRESSED when the scan was truncated (steve's #410 clause)", async () => {
    const { ctx, router } = await seed(LIST_CAP + 25);
    const env = await call(router, ctx, { filter: { status: "dismissed" }, limit: 5 });

    expect(env.count).toBe(0);
    expect(env.truncated).toBe(true);
    expect(env.total).toBeNull(); // exact-or-null (steve's ruling)
    expect("_ois_query_unmatched" in env).toBe(false); // ← the clause under test
  }, 120_000);

  // ⚠️ THE SUPPRESSION CLAUSE ITSELF IS RETAINED IN PRODUCTION AND ITS REACHABILITY
  // NARROWED — recorded here rather than silently dropped. `truncated && count === 0`
  // now requires the substrate matcher and the in-memory belt matcher to DISAGREE
  // (substrate returns ≥500 rows, memory rejects all of them). That is the §9c
  // three-matcher divergence case, which is real but is NOT constructible through
  // this router-level harness. NOT TESTED HERE, AND NOT CLAIMED TESTED.
  it("✅ a filter matching MANY rows still truncates honestly and still reports a FLOOR", async () => {
    const { ctx, router } = await seed(LIST_CAP + 25);
    // every seeded idea carries this status, so the FILTERED scan itself hits the cap
    const env = await call(router, ctx, { filter: { status: "open" }, limit: 5 });

    expect(env.truncated).toBe(true);
    expect(env.total).toBeNull(); // exact-or-null (steve's ruling); the floor lives in the note
    expect("_ois_query_unmatched" in env).toBe(false); // non-zero result, sentinel irrelevant
  }, 120_000);

  it("✅ …but the sentinel STILL fires on an untruncated scan with a genuinely-empty filter", async () => {
    const { ctx, router } = await seed(10);
    const env = await call(router, ctx, { filter: { status: "dismissed" }, limit: 5 });

    expect(env.count).toBe(0);
    expect("truncated" in env).toBe(false);
    expect(env._ois_query_unmatched).toBe(true); // definitive here — the window saw everything
  }, 60_000);

  // ── THE MEASURED REACHABILITY FINDING, LOCKED AS A TEST ─────────────────
  it("🔴 offset CANNOT cross the cap — rows beyond it are unreachable by any limit/offset", async () => {
    const { ctx, router } = await seed(LIST_CAP + 25);
    const beyond = await call(router, ctx, { limit: 1, offset: LIST_CAP + 10 });

    expect(beyond.count).toBe(0);      // nothing — and 525 ideas exist
    expect(beyond.total).toBeNull(); // exact-or-null (steve's ruling)
    expect(beyond.truncated).toBe(true); // at least it now SAYS so
  }, 120_000);
});
