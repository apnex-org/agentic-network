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
    expect(env.total).toBe(LIST_CAP); // the floor — honestly labelled, not silently a "count"
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
  it("🔴 _ois_query_unmatched is SUPPRESSED when the scan was truncated (steve's #410 clause)", async () => {
    const { ctx, router } = await seed(LIST_CAP + 25);
    // a filter that matches nothing IN the window; over a capped scan a zero
    // result is NOT definitive, so the sentinel must NOT assert certainty.
    const env = await call(router, ctx, { filter: { status: "dismissed" }, limit: 5 });

    expect(env.count).toBe(0);
    expect(env.truncated).toBe(true);
    expect("_ois_query_unmatched" in env).toBe(false); // ← the clause under test
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
    expect(beyond.total).toBe(LIST_CAP);
    expect(beyond.truncated).toBe(true); // at least it now SAYS so
  }, 120_000);
});
