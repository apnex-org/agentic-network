/**
 * bug-487 — PREFIX PUSHDOWN, END TO END THROUGH THE REGISTERED ROUTER.
 *
 * 🔴 WHY THIS DRIVES THE SURFACE, NOT A HELPER. bug-484 survived nine helper tests
 * and a verifier seal because the cap is applied by the STORE, before any helper
 * runs. The false zero here has the same shape: the prefix was applied in memory
 * AFTER a capped scan, so a document outside the window was reported as absent.
 * A helper test is blind to that by construction. This uses the real
 * DocumentRepository over the real substrate, through the registered handler.
 *
 * SEALED DESIGN UNDER TEST (docenum1): $prefix -> starts_with(), pushed to storage,
 * reserved-`id` targeting the canonical column, stable ORDER BY id.
 */
import { describe, it, expect } from "vitest";
import { PolicyRouter } from "../router.js";
import { registerDocumentPolicy } from "../document-policy.js";
import { createTestContext } from "../test-utils.js";
import { DocumentRepository } from "../../storage-substrate/new-repositories.js";

/** bug-487: the shared test context deliberately does NOT wire a document store —
 *  two existing tests assert the handler's absence-degradation and rely on that.
 *  So the store is wired HERE, locally, rather than changing a shared harness. The
 *  fact that list_documents had no router-level harness at all is itself part of why
 *  this defect survived; the fix is a local wire-up, not a global one. */
function ctxWithDocuments() {
  const ctx = createTestContext();
  ctx.stores.document = new DocumentRepository(ctx.substrate);
  return ctx;
}

const SCAN_CAP = 100; // substrate default when the repository passes no limit

async function seed(paths: string[]) {
  const ctx = ctxWithDocuments();
  const router = new PolicyRouter();
  registerDocumentPolicy(router);
  const now = new Date().toISOString();
  for (const p of paths) await ctx.stores.document!.put({ id: p, content: `body of ${p}`, createdAt: now, updatedAt: now });
  return { ctx, router };
}

const list = async (
  r: PolicyRouter,
  ctx: ReturnType<typeof createTestContext>,
  args: Record<string, unknown>,
) => JSON.parse(((await r.handle("list_documents", args, ctx)).content[0] as { text: string }).text);

/** The decoy set that separates a true prefix match from a byte-range or a LIKE. */
const DECOYS = [
  "docs/audits/a.md",       // ✅ true match
  "docs/audits/z.md",       // ✅ true match
  "docs/audits-extra/b.md", // ✗ '-' after the stem
  "docs/audits.md",         // ✗ '.' after the stem
  "docs/audits0/c.md",      // ✗ the range's upper-bound character
  "docs/auditsX/d.md",      // ✗ letter after the stem
  "docs/audit/e.md",        // ✗ shorter stem
  "docs/AUDITS/f.md",       // ✗ case differs
];

describe("bug-487 — prefix pushdown through the real store", () => {
  it("🔴 THE FALSE ZERO: a document beyond the scan cap is FOUND by prefix", async () => {
    // 120 filler docs sort BEFORE the target and would fill a 100-row window.
    const filler = Array.from({ length: 120 }, (_, i) => `docs/aaa-filler/${String(i).padStart(3, "0")}.md`);
    const { ctx, router } = await seed([...filler, "docs/zzz-target/found.md"]);

    const env = await list(router, ctx, { prefix: "docs/zzz-target/" });

    // Pre-fix this returned count 0: the scan took its first N rows and the prefix
    // filtered THAT window, so the target — which exists — was reported as absent.
    expect(env.count).toBe(1);
    expect(env.documents[0].path).toBe("docs/zzz-target/found.md");
  }, 120_000);

  it("exact prefix semantics — the decoys are excluded", async () => {
    const { ctx, router } = await seed(DECOYS);
    const env = await list(router, ctx, { prefix: "docs/audits/" });

    expect(env.documents.map((d: { path: string }) => d.path)).toEqual([
      "docs/audits/a.md",
      "docs/audits/z.md",
    ]);
    expect(env.count).toBe(2);
  }, 60_000);

  it("🔴 a prefix containing LIKE METACHARACTERS does not over-match (starts_with, not LIKE)", async () => {
    // Measured on live postgres: naive `LIKE $1 || '%'` returns 3 here; truth is 2.
    const { ctx, router } = await seed([
      "docs/100%_report/a.md",
      "docs/100%_report/c.md",
      "docs/100XYreport/b.md", // matched by naive LIKE via % and _ as wildcards
    ]);
    const env = await list(router, ctx, { prefix: "docs/100%_report/" });

    expect(env.documents.map((d: { path: string }) => d.path)).toEqual([
      "docs/100%_report/a.md",
      "docs/100%_report/c.md",
    ]);
  }, 60_000);

  it("stable total order — results come back sorted by path", async () => {
    const { ctx, router } = await seed([
      "docs/o/c.md", "docs/o/a.md", "docs/o/b.md",
    ]);
    const env = await list(router, ctx, { prefix: "docs/o/" });
    expect(env.documents.map((d: { path: string }) => d.path)).toEqual([
      "docs/o/a.md", "docs/o/b.md", "docs/o/c.md",
    ]);
  }, 60_000);

  it("category still works, and composes with prefix", async () => {
    const ctx = ctxWithDocuments();
    const router = new PolicyRouter();
    registerDocumentPolicy(router);
    const now = new Date().toISOString();
    await ctx.stores.document!.put({ id: "docs/x/one.md", content: "b", category: "planning", createdAt: now, updatedAt: now });
    await ctx.stores.document!.put({ id: "docs/x/two.md", content: "b", category: "design", createdAt: now, updatedAt: now });
    await ctx.stores.document!.put({ id: "docs/y/three.md", content: "b", category: "planning", createdAt: now, updatedAt: now });

    expect((await list(router, ctx, { category: "planning" })).count).toBe(2);
    const both = await list(router, ctx, { prefix: "docs/x/", category: "planning" });
    expect(both.documents.map((d: { path: string }) => d.path)).toEqual(["docs/x/one.md"]);
  }, 60_000);

  it("a genuinely-absent prefix returns zero — the fix must not invent matches", async () => {
    const { ctx, router } = await seed(DECOYS);
    const env = await list(router, ctx, { prefix: "docs/nothing-here/" });
    expect(env.count).toBe(0);
    expect(env.documents).toEqual([]);
  }, 60_000);
});

/**
 * 🔴 THE COLLATION-INDEPENDENCE FIXTURE.
 *
 * HONEST DECOMPOSITION, STATED BECAUSE THE ALTERNATIVE IS A FALSE CLAIM:
 * the tests above run against the MEMORY substrate, which has no collation at all.
 * THEY CANNOT PROVE COLLATION-INDEPENDENCE and must not be read as doing so.
 *
 * Collation-independence is a property of the SQL the substrate EMITS. A range
 * (`>= p AND < p+1`) is collation-DEPENDENT — measured returning ZERO rows under
 * en_US.UTF-8 for data that exists. `starts_with()` is byte-wise and collation-
 * INDEPENDENT. So the invariant that must never regress is: THE PREFIX PREDICATE IS
 * EMITTED AS starts_with(), NEVER AS A RANGE. That is checkable here, in CI, with no
 * database — and it is the exact property a future "optimisation" to a range would
 * silently break.
 *
 * The behavioural half (running both predicates against real C and non-C instances)
 * is recorded in this node's collation_experiment evidence; it needs docker and does
 * not belong in the unit suite.
 */
describe("bug-487 — collation-independence invariant (SQL shape)", () => {
  it("🔴 $prefix emits starts_with(), NEVER a collation-dependent range", async () => {
    const { translateFilterClauseForTest } = await import("../../storage-substrate/postgres-substrate.js");
    const params: unknown[] = [];
    const out = translateFilterClauseForTest("id", { $prefix: "docs/audits/" }, 2, params);

    expect(out.sql).toBe("starts_with(id, $2)");
    expect(params).toEqual(["docs/audits/"]);
    // the regression this guards: a range would reintroduce the false zero
    expect(out.sql).not.toContain(">=");
    expect(out.sql).not.toContain("<");
    // and it must not be LIKE either — LIKE over-matches on % / _ in a path
    expect(out.sql.toUpperCase()).not.toContain("LIKE");
  });

  it("reserved `id` targets the canonical column, not a JSONB extract", async () => {
    const { translateFilterClauseForTest } = await import("../../storage-substrate/postgres-substrate.js");
    const a: unknown[] = [];
    expect(translateFilterClauseForTest("id", { $prefix: "p" }, 1, a).sql).toBe("starts_with(id, $1)");
    const b: unknown[] = [];
    // a non-reserved field still goes through the JSONB extract
    expect(translateFilterClauseForTest("category", { $prefix: "p" }, 1, b).sql)
      .toBe("starts_with(data->>'category', $1)");
  });
});
