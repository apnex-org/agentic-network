/**
 * work-645 / bug-484 — THE LIVE TOOL PATH, END TO END.
 *
 * 🔴 WHY THIS FILE EXISTS SEPARATELY FROM work-644's KERNEL TESTS.
 * Those import `paginated` from list-filters.js and exercise THE HELPER. bug-484
 * was invisible to nine such tests AND to a verifier seal, because the helper
 * never sees the substrate scan cap — the store applies it BEFORE the helper runs.
 * Rendering a helper is not rendering a surface.
 *
 * So this drives `list_messages` through the REGISTERED ROUTER against the REAL
 * MessageRepositorySubstrate, whose own LIST_PREFETCH_CAP=500 is the cap that lied.
 * Nothing here is stubbed: real repository, real handler, real cap.
 */
import { describe, it, expect } from "vitest";
import { PolicyRouter } from "../router.js";
import { registerMessagePolicy } from "../message-policy.js";
import { createTestContext } from "../test-utils.js";

const SCAN_CAP = 500;

async function seed(count: number) {
  const ctx = createTestContext();
  const router = new PolicyRouter();
  registerMessagePolicy(router);
  for (let i = 0; i < count; i++) {
    await ctx.stores.message.createMessage({
      kind: "note",
      authorRole: "system",
      authorAgentId: "hub",
      target: { role: "engineer" },
      delivery: "push-immediate",
      payload: { body: `m${i}` },
    });
  }
  return { ctx, router };
}

const call = async (
  r: PolicyRouter,
  ctx: ReturnType<typeof createTestContext>,
  args: Record<string, unknown>,
) => {
  const res = await r.handle("list_messages", args, ctx);
  return JSON.parse((res.content[0] as { text: string }).text);
};

describe("work-645 — list_messages END TO END, collection LARGER than the scan cap", () => {
  it("🔴 total is NULL, not the scan floor — the exact bug-484 defect, through the real path", async () => {
    const { ctx, router } = await seed(SCAN_CAP + 25); // 525 > cap
    const env = await call(router, ctx, { targetRole: "engineer", limit: 1 });

    expect(env.total).toBeNull();          // NOT 500. The lie that shipped.
    expect(env.scanned).toBe(SCAN_CAP);    // the floor, under an honest name
    expect(env.complete).toBe(false);
    expect(env.truncated).toBe(true);      // SCAN boundary
    expect(env.pageTruncated).toBe(true);  // PAGE boundary, independently
  }, 60_000);

  it("🔴 the page note does NOT promise 'the rest' when offset cannot reach it", async () => {
    const { ctx, router } = await seed(SCAN_CAP + 25);
    const env = await call(router, ctx, { targetRole: "engineer", limit: 1 });

    expect(env.pageTruncationNote).not.toContain("to retrieve the rest");
    expect(env.pageTruncationNote).toContain("SCANNED SET ONLY");
    expect(env.truncationNote).toContain("CANNOT REACH THEM");
    expect(env.truncationNote).toContain("UNKNOWN (null)");
  }, 60_000);
});

describe("work-645 — NEGATIVE CONTROL, collection SMALLER than the scan cap", () => {
  it("an unsaturated scan reports the EXACT total and earns complete:true", async () => {
    const { ctx, router } = await seed(3);
    const env = await call(router, ctx, { targetRole: "engineer", limit: 10 });

    expect(env.count).toBe(3);
    expect(env.total).toBe(3);        // exact — the scan saw everything
    expect(env.complete).toBe(true);  // the earned-true case
    expect(env.truncated).toBe(false);
    expect(env.pageTruncated).toBe(false);
    expect(env.scanned).toBeUndefined();
    expect(env.truncationNote).toBeUndefined();
    expect(env.pageTruncationNote).toBeUndefined();
  }, 60_000);

  it("🔴 BOUNDARY: a page cap WITHOUT a scan cap still offers followable continuation", async () => {
    const { ctx, router } = await seed(20);
    const env = await call(router, ctx, { targetRole: "engineer", limit: 5 });

    expect(env.total).toBe(20);            // exact
    expect(env.truncated).toBe(false);     // scan clear
    expect(env.pageTruncated).toBe(true);  // page capped
    expect(env.complete).toBe(false);
    expect(env.pageTruncationNote).toContain("retrieve the rest"); // TRUE here
  }, 60_000);
});
