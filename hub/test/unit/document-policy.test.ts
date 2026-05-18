/**
 * mission-84 W6 — Document MCP policy smoke test (substrate-backed re-introduction).
 *
 * Tests the 3 re-introduced tools (create_document / get_document / list_documents)
 * against an in-process MemoryHubStorageSubstrate. Per architect dispatch §1.5:
 * smoke-test covers create_document → get_document round-trip + list_documents
 * filter coverage.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../../src/policy/router.js";
import { registerDocumentPolicy } from "../../src/policy/document-policy.js";
import { createTestContext, type TestPolicyContext } from "../../src/policy/test-utils.js";
import { DocumentRepository } from "../../src/storage-substrate/new-repositories.js";
import { createMemoryStorageSubstrate } from "../../src/storage-substrate/index.js";

const noop = () => {};

function makeFixture(): { router: PolicyRouter; ctx: TestPolicyContext } {
  const router = new PolicyRouter(noop);
  registerDocumentPolicy(router);
  // Start with default test-utils context (provides all required stores), then
  // mutate stores.document in-place to inject DocumentRepository for this test.
  const ctx = createTestContext();
  const substrate = createMemoryStorageSubstrate();
  ctx.stores.document = new DocumentRepository(substrate);
  return { router, ctx };
}

describe("document-policy (mission-84 W6 substrate-backed re-introduction)", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;

  beforeEach(() => {
    ({ router, ctx } = makeFixture());
  });

  describe("registration", () => {
    it("registers all 3 document tools", () => {
      expect(router.has("create_document")).toBe(true);
      expect(router.has("get_document")).toBe(true);
      expect(router.has("list_documents")).toBe(true);
    });
  });

  describe("create_document → get_document round-trip", () => {
    it("creates a document under docs/ + retrieves the content verbatim", async () => {
      const createResult = await router.handle(
        "create_document",
        { path: "docs/planning/foo.md", content: "# Hello\n\nWorld." },
        ctx,
      );
      expect(createResult.isError).toBeFalsy();
      const created = JSON.parse(createResult.content[0]!.text);
      expect(created.success).toBe(true);
      expect(created.path).toBe("docs/planning/foo.md");
      expect(created.size).toBe(15);
      expect(created.resourceVersion).toMatch(/^\d+$/);

      const getResult = await router.handle(
        "get_document",
        { path: "docs/planning/foo.md" },
        ctx,
      );
      expect(getResult.isError).toBeFalsy();
      expect(getResult.content[0]!.text).toBe("# Hello\n\nWorld.");
    });

    it("rejects path outside docs/ prefix", async () => {
      const r = await router.handle(
        "create_document",
        { path: "reports/foo.md", content: "x" },
        ctx,
      );
      expect(r.isError).toBe(true);
      expect(JSON.parse(r.content[0]!.text).error).toMatch(/must start with 'docs\//);
    });

    it("get_document on absent path returns not-found error", async () => {
      const r = await router.handle("get_document", { path: "docs/absent.md" }, ctx);
      expect(r.isError).toBe(true);
      expect(JSON.parse(r.content[0]!.text).error).toMatch(/Document not found/);
    });

    it("create_document on existing path updates content + preserves createdAt", async () => {
      await router.handle("create_document", { path: "docs/x.md", content: "v1" }, ctx);
      const r1 = await ctx.stores.document!.get("docs/x.md");
      const createdAt1 = r1!.createdAt;

      // tiny delay so updatedAt differs from createdAt
      await new Promise(r => setTimeout(r, 5));

      await router.handle("create_document", { path: "docs/x.md", content: "v2" }, ctx);
      const r2 = await ctx.stores.document!.get("docs/x.md");
      expect(r2!.content).toBe("v2");
      expect(r2!.createdAt).toBe(createdAt1);
      expect(r2!.updatedAt).not.toBe(createdAt1);
    });
  });

  describe("list_documents filter coverage", () => {
    beforeEach(async () => {
      await router.handle("create_document", { path: "docs/planning/a.md", content: "A", category: "planning" }, ctx);
      await router.handle("create_document", { path: "docs/planning/b.md", content: "B", category: "planning" }, ctx);
      await router.handle("create_document", { path: "docs/design/c.md", content: "C", category: "design" }, ctx);
    });

    it("lists all documents without filter", async () => {
      const r = await router.handle("list_documents", {}, ctx);
      const parsed = JSON.parse(r.content[0]!.text);
      expect(parsed.count).toBe(3);
    });

    it("filters by category (substrate-side)", async () => {
      const r = await router.handle("list_documents", { category: "planning" }, ctx);
      const parsed = JSON.parse(r.content[0]!.text);
      expect(parsed.count).toBe(2);
      expect(parsed.documents.map((d: { path: string }) => d.path).sort()).toEqual([
        "docs/planning/a.md",
        "docs/planning/b.md",
      ]);
    });

    it("filters by prefix (client-side)", async () => {
      const r = await router.handle("list_documents", { prefix: "docs/design/" }, ctx);
      const parsed = JSON.parse(r.content[0]!.text);
      expect(parsed.count).toBe(1);
      expect(parsed.documents[0].path).toBe("docs/design/c.md");
    });

    it("combines prefix + category filters", async () => {
      const r = await router.handle("list_documents", { prefix: "docs/planning/", category: "planning" }, ctx);
      const parsed = JSON.parse(r.content[0]!.text);
      expect(parsed.count).toBe(2);
    });

    it("returns summary shape (path/size/category/timestamps)", async () => {
      const r = await router.handle("list_documents", { category: "design" }, ctx);
      const parsed = JSON.parse(r.content[0]!.text);
      const doc = parsed.documents[0];
      expect(doc.path).toBe("docs/design/c.md");
      expect(doc.size).toBe(1);
      expect(doc.category).toBe("design");
      expect(doc.createdAt).toMatch(/T/);
      expect(doc.updatedAt).toMatch(/T/);
    });
  });

  describe("graceful degradation when document store not configured", () => {
    it("returns clear error if ctx.stores.document is absent", async () => {
      // Use plain test-utils context (no document store)
      const router2 = new PolicyRouter(noop);
      registerDocumentPolicy(router2);
      const ctx2 = createTestContext();
      const r = await router2.handle("get_document", { path: "docs/x.md" }, ctx2);
      expect(r.isError).toBe(true);
      expect(JSON.parse(r.content[0]!.text).error).toMatch(/Document store not configured/);
    });
  });
});
