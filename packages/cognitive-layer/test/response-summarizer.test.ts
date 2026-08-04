/**
 * ResponseSummarizer unit tests (Phase 2a / thread-160).
 *
 * Pins: architect-ratified `_ois_pagination` shape, top-level array
 * + object-with-array-property heuristics, Virtual Tokens Saved
 * tag emission, per-tool overrides, shouldSummarize predicate.
 */

import { describe, it, expect, vi } from "vitest";
import {
  ResponseSummarizer,
  summarizeResult,
  buildTruncationDisclosure,
} from "../src/middlewares/response-summarizer.js";
import type { ToolCallContext } from "../src/contract.js";
import { INTERNAL_CALL_TAG } from "../src/contract.js";

function ctx(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    tool: "list_ideas",
    args: {},
    sessionId: "sess-A",
    startedAt: 0,
    tags: {},
    ...overrides,
  };
}

// ── buildTruncationDisclosure — truthretr0 honest shape ────────────
// Supersedes the thread-160 `buildPaginationHint` shape, whose
// unconditional "Use offset=N" fabricated an affordance for tools with
// no paging parameter (bug-232 / bug-263 / bug-339 / bug-476).

describe("buildTruncationDisclosure — truthretr0", () => {
  it("NAMES a paging parameter only when one is declared", () => {
    expect(buildTruncationDisclosure("items", 150, 10, "offset")).toEqual({
      truncated: true,
      field: "items",
      total: 150,
      count: 10,
      omitted: 140,
      reason:
        "client-side summarisation by cognitive-layer response-summarizer (not the tool)",
      next_offset: 10,
      hint: "Re-call with offset=10 to retrieve the next page.",
    });
  });

  it("🔴 FABRICATES NO PARAMETER when the tool has none declared", () => {
    const d = buildTruncationDisclosure("tags", 19, 10);
    expect(d.truncated).toBe(true);
    expect(d.field).toBe("tags");
    expect(d.omitted).toBe(9);
    // The regression that matters: no invented offset affordance.
    expect(d.next_offset).toBeNull();
    expect(d.hint).not.toMatch(/offset=\d/);
    expect(d.hint).toContain("NO declared paging parameter");
  });
});

// ── summarizeResult — pure helper ──────────────────────────────────

describe("summarizeResult (pure)", () => {
  it("passes through arrays shorter than maxItems unchanged", () => {
    const arr = [1, 2, 3];
    expect(summarizeResult(arr, 10)).toBe(arr);
  });

  it("truncates top-level arrays longer than maxItems with an honest envelope", () => {
    const arr = Array.from({ length: 50 }, (_, i) => ({ id: i }));
    const out = summarizeResult(arr, 10, "offset") as {
      _ois_pagination: { truncated: boolean; field: string; total: number; count: number; omitted: number; next_offset: number | null; hint: string };
      items: unknown[];
    };
    expect(out._ois_pagination.truncated).toBe(true);
    expect(out._ois_pagination.field).toBe("items");
    expect(out._ois_pagination.total).toBe(50);
    expect(out._ois_pagination.count).toBe(10);
    expect(out._ois_pagination.omitted).toBe(40);
    expect(out._ois_pagination.next_offset).toBe(10);
    expect(out._ois_pagination.hint).toContain("offset=10");
    expect(out.items).toHaveLength(10);
    expect(out.items[0]).toEqual({ id: 0 });
    expect(out.items[9]).toEqual({ id: 9 });
  });

  it("truncates object's largest array property in-place, keeps other fields", () => {
    const result = {
      ideas: Array.from({ length: 50 }, (_, i) => ({ id: i })),
      status: "ok",
      count: 50,
    };
    const out = summarizeResult(result, 5) as {
      _ois_pagination: { total: number; count: number; field: string };
      ideas: unknown[];
      status: string;
      count: number;
    };
    expect(out._ois_pagination.total).toBe(50);
    expect(out._ois_pagination.count).toBe(5);
    // truthretr0: the envelope NAMES the truncated field.
    expect(out._ois_pagination.field).toBe("ideas");
    expect(out.ideas).toHaveLength(5);
    expect(out.status).toBe("ok");
    expect(out.count).toBe(50); // original scalar field unchanged
  });

  it("picks the largest of multiple array properties", () => {
    const result = {
      small: Array.from({ length: 3 }, (_, i) => i),
      big: Array.from({ length: 100 }, (_, i) => i),
      huge: Array.from({ length: 500 }, (_, i) => i),
    };
    const out = summarizeResult(result, 10) as {
      _ois_pagination: { total: number; field: string };
      small: unknown[];
      big: unknown[];
      huge: unknown[];
    };
    expect(out._ois_pagination.total).toBe(500); // picked huge
    expect(out._ois_pagination.field).toBe("huge");
    expect(out.huge).toHaveLength(10);
    expect(out.big).toHaveLength(100); // untouched — only largest truncated
    expect(out.small).toHaveLength(3);
  });

  it("non-array / non-object results pass through", () => {
    expect(summarizeResult("a string", 10)).toBe("a string");
    expect(summarizeResult(42, 10)).toBe(42);
    expect(summarizeResult(null, 10)).toBeNull();
  });

  it("objects without oversized arrays pass through", () => {
    const result = { status: "ok", total: 5, items: [1, 2, 3] };
    expect(summarizeResult(result, 10)).toBe(result);
  });
});

// ── Middleware — shouldSummarize heuristic ──────────────────────────

describe("ResponseSummarizer — default shouldSummarize heuristic", () => {
  it("summarizes read-verb tools with oversized arrays", async () => {
    const summarizer = new ResponseSummarizer({ maxItems: 5 });
    const next = vi.fn().mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => ({ id: i })),
    );
    const context = ctx({ tool: "list_ideas" });
    const result = await summarizer.onToolCall(context, next) as { _ois_pagination: unknown; items: unknown[] };
    expect(result._ois_pagination).toBeDefined();
    expect(result.items).toHaveLength(5);
  });

  it("does NOT summarize write-verb tools", async () => {
    const summarizer = new ResponseSummarizer({ maxItems: 5 });
    const largeResult = Array.from({ length: 50 }, (_, i) => ({ id: i }));
    const next = vi.fn().mockResolvedValue(largeResult);
    const context = ctx({ tool: "create_thread" });
    const result = await summarizer.onToolCall(context, next);
    expect(result).toBe(largeResult); // reference-equal — not rewritten
  });

  it("summarizes read-verb results that exceed byte threshold even if array is short", async () => {
    const summarizer = new ResponseSummarizer({ maxItems: 5, maxBytes: 100 });
    const heavy = {
      agents: "x".repeat(500), // single large string, no array
      items: [1, 2], // array is tiny — but we also check byte threshold
    };
    const next = vi.fn().mockResolvedValue(heavy);
    const context = ctx({ tool: "get_agents" });
    const result = await summarizer.onToolCall(context, next);
    // Heuristic: oversized byte count should trigger, but there's
    // no eligible array to truncate → falls through to pass-through
    // inside summarizeResult (object had no oversized array prop).
    expect(result).toBe(heavy);
  });

  it("does NOT summarize internal-machinery calls (bug-106)", async () => {
    const summarizer = new ResponseSummarizer({ maxItems: 5 });
    // A read-verb result that WOULD be summarized for an LLM tool-call...
    const largeResult = Array.from({ length: 50 }, (_, i) => ({ id: i }));
    const next = vi.fn().mockResolvedValue(largeResult);
    // ...but the call is tagged internal-machinery (poll-backstop / heartbeat) —
    // machinery needs the full raw result; the summarizer must skip it.
    const context = ctx({ tool: "list_messages", tags: { [INTERNAL_CALL_TAG]: "true" } });
    const result = await summarizer.onToolCall(context, next);
    expect(result).toBe(largeResult); // reference-equal — full raw result, untouched
    expect(context.tags.summarized).toBeUndefined();
  });
});

// ── Virtual Tokens Saved KPI ───────────────────────────────────────

describe("ResponseSummarizer — respects caller's `limit` (M-QueryShape Phase 1, idea-119)", () => {
  it("skips summarization when args.limit ≤ maxItems", async () => {
    // Caller explicitly asked for a bounded subset that's smaller than
    // the summarizer threshold; don't second-guess by truncating further.
    const summarizer = new ResponseSummarizer({ maxItems: 10 });
    const items = Array.from({ length: 3 }, (_, i) => ({ id: i }));
    const next = vi.fn().mockResolvedValue(items);
    const context = ctx({ tool: "list_tasks", args: { limit: 3 } });
    const result = await summarizer.onToolCall(context, next);
    // Result passed through reference-equal — no _ois_pagination wrap
    expect(result).toBe(items);
    expect(context.tags.summarized).toBeUndefined();
  });

  it("bug-117: honors args.limit > maxItems — raises the cap to the caller's limit, not the default", async () => {
    const summarizer = new ResponseSummarizer({ maxItems: 5 });
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const next = vi.fn().mockResolvedValue(items);
    // Caller explicitly asked for 50; the OLD code truncated to maxItems=5
    // (the bug-117 silent cap). Now the cap is RAISED to the caller's 50.
    const context = ctx({ tool: "list_tasks", args: { limit: 50 } });
    const result = await summarizer.onToolCall(context, next) as {
      _ois_pagination: { total: number; count: number };
      items: unknown[];
    };
    expect(result.items).toHaveLength(50); // the caller's limit, not 5
    expect(result._ois_pagination.total).toBe(100);
    expect(result._ois_pagination.count).toBe(50);
  });

  it("bug-117: an explicit limit > default (10) returns > 10 items (the reported regression)", async () => {
    // The exact evidence case: DEFAULT maxItems (10), caller asks for 25.
    const summarizer = new ResponseSummarizer(); // DEFAULT_MAX_ITEMS = 10
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const next = vi.fn().mockResolvedValue(items);
    const context = ctx({ tool: "list_bugs", args: { limit: 25 } });
    const result = await summarizer.onToolCall(context, next) as {
      _ois_pagination: { count: number };
      items: unknown[];
    };
    expect(result.items.length).toBeGreaterThan(10);
    expect(result.items).toHaveLength(25);
    expect(result._ois_pagination.count).toBe(25);
  });

  it("bug-117: a limit larger than the result set returns the FULL set unwrapped (zero-loss, tele-4)", async () => {
    // Caller raised the limit and the list fits under it → no truncation,
    // no pagination envelope.
    const summarizer = new ResponseSummarizer({ maxItems: 5 });
    const items = Array.from({ length: 30 }, (_, i) => ({ id: i }));
    const next = vi.fn().mockResolvedValue(items);
    const context = ctx({ tool: "list_tasks", args: { limit: 50 } });
    const result = await summarizer.onToolCall(context, next);
    expect(result).toBe(items); // reference-equal — full set, no envelope
    expect(context.tags.summarized).toBeUndefined();
  });

  it("summarizes when args.limit is absent (legacy behaviour preserved)", async () => {
    const summarizer = new ResponseSummarizer({ maxItems: 5 });
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const next = vi.fn().mockResolvedValue(items);
    const context = ctx({ tool: "list_tasks", args: {} });
    const result = await summarizer.onToolCall(context, next) as { _ois_pagination: unknown };
    expect(result._ois_pagination).toBeDefined();
  });

  it("ignores non-numeric or non-positive `limit`", async () => {
    const summarizer = new ResponseSummarizer({ maxItems: 5 });
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const next = vi.fn().mockResolvedValue(items);
    const context = ctx({ tool: "list_tasks", args: { limit: "three" } });
    const result = await summarizer.onToolCall(context, next) as { _ois_pagination: unknown };
    // Non-numeric limit doesn't trigger the skip path → normal summarization
    expect(result._ois_pagination).toBeDefined();
  });
});

describe("ResponseSummarizer — Virtual Tokens Saved tag", () => {
  it("tags ctx.tags.virtualTokensSaved + summarized=true on truncation", async () => {
    const summarizer = new ResponseSummarizer({ maxItems: 3 });
    const big = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      data: "x".repeat(20),
    }));
    const next = vi.fn().mockResolvedValue(big);
    const context = ctx();
    await summarizer.onToolCall(context, next);

    expect(context.tags.summarized).toBe("true");
    expect(context.tags.virtualTokensSaved).toBeDefined();
    const saved = Number(context.tags.virtualTokensSaved);
    expect(saved).toBeGreaterThan(0);
  });

  it("does NOT tag when nothing is truncated", async () => {
    const summarizer = new ResponseSummarizer({ maxItems: 10 });
    const small = [1, 2, 3];
    const next = vi.fn().mockResolvedValue(small);
    const context = ctx();
    await summarizer.onToolCall(context, next);

    expect(context.tags.virtualTokensSaved).toBeUndefined();
    expect(context.tags.summarized).toBeUndefined();
  });
});

// ── Per-tool overrides ─────────────────────────────────────────────

describe("ResponseSummarizer — perToolMaxItems overrides", () => {
  it("null override disables summarization for that tool", async () => {
    const summarizer = new ResponseSummarizer({
      maxItems: 5,
      perToolMaxItems: { get_agents: null },
    });
    const big = Array.from({ length: 50 }, (_, i) => i);
    const next = vi.fn().mockResolvedValue(big);
    const context = ctx({ tool: "get_agents" });
    const result = await summarizer.onToolCall(context, next);
    expect(result).toBe(big); // no truncation
    expect(context.tags.summarized).toBeUndefined();
  });

  it("numeric override sets a different maxItems for that tool", async () => {
    const summarizer = new ResponseSummarizer({
      maxItems: 5,
      perToolMaxItems: { list_ideas: 20 },
    });
    const big = Array.from({ length: 50 }, (_, i) => i);
    const next = vi.fn().mockResolvedValue(big);
    const context = ctx({ tool: "list_ideas" });
    const result = await summarizer.onToolCall(context, next) as { items: unknown[] };
    expect(result.items).toHaveLength(20);
  });
});

// ── Custom shouldSummarize predicate ───────────────────────────────

describe("ResponseSummarizer — custom shouldSummarize", () => {
  it("honors custom predicate overriding default heuristic", async () => {
    const summarizer = new ResponseSummarizer({
      maxItems: 3,
      shouldSummarize: (tool) => tool === "my_tool",
    });
    const big = Array.from({ length: 50 }, (_, i) => i);
    const next = vi.fn().mockResolvedValue(big);

    // Default read-verb wouldn't trigger, but custom allows my_tool only
    const c1 = ctx({ tool: "list_ideas" });
    const r1 = await summarizer.onToolCall(c1, next);
    expect(r1).toBe(big); // predicate said no

    const c2 = ctx({ tool: "my_tool" });
    const r2 = await summarizer.onToolCall(c2, next) as { items: unknown[] };
    expect(r2.items).toHaveLength(3);
  });
});

// ── Standard pipeline integration ───────────────────────────────────

describe("ResponseSummarizer — .standard() integration", () => {
  it(".standard() composes ResponseSummarizer after ToolResultCache", async () => {
    const { CognitivePipeline } = await import("../src/pipeline.js");
    const p = CognitivePipeline.standard();
    const names = p.getMiddlewares().map((m) => m.name);
    const cacheIdx = names.indexOf("ToolResultCache");
    const summarizerIdx = names.indexOf("ResponseSummarizer");
    expect(summarizerIdx).toBeGreaterThan(cacheIdx);
    expect(summarizerIdx).toBeGreaterThan(-1);
  });

  it("pipeline order: summarizer truncates BEFORE cache stores (cache-hit returns summarized)", async () => {
    const { CognitivePipeline } = await import("../src/pipeline.js");
    const { CognitiveTelemetry } = await import("../src/middlewares/telemetry.js");
    const { ToolResultCache } = await import("../src/middlewares/tool-result-cache.js");

    // Just telemetry + cache + summarizer — simpler pipeline for order verification.
    const summarizer = new ResponseSummarizer({ maxItems: 3 });
    const cache = new ToolResultCache({ ttlMs: 30_000 });
    const telemetry = new CognitiveTelemetry();
    const pipeline = new CognitivePipeline().use(telemetry).use(cache).use(summarizer);

    const big = Array.from({ length: 50 }, (_, i) => ({ id: i }));
    const terminal = vi.fn().mockResolvedValue(big);
    const c1 = ctx();
    const r1 = await pipeline.runToolCall(c1, terminal) as { items: unknown[] };
    expect(r1.items).toHaveLength(3);
    expect(terminal).toHaveBeenCalledTimes(1);

    // Second call with same args — cache hits. Result should already be summarized.
    const c2 = ctx();
    const r2 = await pipeline.runToolCall(c2, terminal) as { items: unknown[] };
    expect(r2.items).toHaveLength(3);
    expect(terminal).toHaveBeenCalledTimes(1); // cache hit — no re-fetch
    expect(c2.tags.cacheHit).toBe("true");
    // Note: since cache stored the summarized form, the summarizer does
    // NOT re-tag virtualTokensSaved on the hit (nothing to truncate).
  });
});

// ── truthretr0 — the four Root A surfaces, through the PRODUCTION path ──
// These execute ResponseSummarizer.onToolCall, not the pure helper, so a
// regression in the middleware wiring reddens them. Asserting envelope
// SHAPE alone would be the vacuous-guard class (bug-464): each case below
// asserts the DISCLOSURE CONTENT that was previously absent or false.

describe("truthretr0 — truncation honesty on the four Root A surfaces", () => {
  const run = async (tool: string, result: unknown, cfg = {}) => {
    const s = new ResponseSummarizer(cfg);
    return (await s.onToolCall(ctx({ tool }), async () => result)) as Record<
      string,
      { truncated: boolean; field: string; total: number; count: number; omitted: number; next_offset: number | null; hint: string }
    > & Record<string, unknown>;
  };

  it("bug-263 get_agents: 21 agents → discloses truncation, fabricates no offset", async () => {
    const out = await run("get_agents", {
      agents: Array.from({ length: 21 }, (_, i) => ({ id: `agent-${i}` })),
      count: 21,
    });
    const p = out._ois_pagination as unknown as { truncated: boolean; field: string; total: number; count: number; omitted: number; next_offset: number | null; hint: string };
    expect(p.truncated).toBe(true);
    expect(p.field).toBe("agents");
    expect(p.total).toBe(21);
    expect(p.omitted).toBe(11);
    expect(p.next_offset).toBeNull();
    expect(p.hint).not.toMatch(/offset=\d/);
  });

  it("bug-339 get_constitution: 15 axioms → names the field, no invented affordance", async () => {
    const out = await run("get_constitution", {
      axioms: Array.from({ length: 15 }, (_, i) => ({ id: `A${i}` })),
      charter: "v1",
    });
    const p = out._ois_pagination as unknown as { field: string; omitted: number; next_offset: number | null; hint: string };
    expect(p.field).toBe("axioms");
    expect(p.omitted).toBe(5);
    expect(p.next_offset).toBeNull();
    expect(p.hint).not.toMatch(/offset=\d/);
  });

  it("bug-476 get_bug: 19 tags → the envelope NAMES tags (the mis-attribution fix)", async () => {
    const out = await run("get_bug", {
      id: "bug-468",
      tags: Array.from({ length: 19 }, (_, i) => `tag-${i}`),
      severity: "critical",
    });
    const p = out._ois_pagination as unknown as { field: string; total: number; omitted: number };
    // Pre-fix the caller saw 10-of-19 with no indication WHICH array was cut,
    // which is how bug-476 was filed against get_bug instead of this middleware.
    expect(p.field).toBe("tags");
    expect(p.total).toBe(19);
    expect(p.omitted).toBe(9);
    expect(out.severity).toBe("critical"); // non-array fields survive
  });

  it("bug-232 list_documents: hint must NOT name offset (the schema has none)", async () => {
    const out = await run("list_documents", {
      documents: Array.from({ length: 100 }, (_, i) => ({ path: `docs/d${i}.md` })),
    });
    const p = out._ois_pagination as unknown as { next_offset: number | null; hint: string };
    expect(p.next_offset).toBeNull();
    // The bar is "must not name a parameter the tool does not accept" as a
    // USABLE instruction. Mentioning offset to say it will NOT work is the
    // opposite of the defect — it pre-empts the assumption the old hint created.
    expect(p.hint).not.toMatch(/offset=\d/);
    expect(p.hint).toMatch(/NOT retrievable by re-calling with an offset/);
    expect(p.hint).toContain("NO declared paging parameter");
  });

  it("declared paging param IS named — honesty is not blanket refusal", async () => {
    const out = await run(
      "list_bugs",
      { bugs: Array.from({ length: 50 }, (_, i) => ({ id: i })) },
      { perToolPagingParam: { list_bugs: "offset" } },
    );
    const p = out._ois_pagination as unknown as { next_offset: number | null; hint: string };
    expect(p.next_offset).toBe(10);
    expect(p.hint).toContain("offset=10");
  });

  it("🔴 NEGATIVE CONTROL: a COMPLETE result is not flagged and not wrapped", async () => {
    const complete = { agents: Array.from({ length: 4 }, (_, i) => ({ id: i })), count: 4 };
    const s = new ResponseSummarizer();
    const out = await s.onToolCall(ctx({ tool: "get_agents" }), async () => complete);
    expect(out).toBe(complete);                       // reference-equal
    expect((out as Record<string, unknown>)._ois_pagination).toBeUndefined();
  });
});
