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
  buildPaginationHint,
} from "../src/middlewares/response-summarizer.js";
import type { ToolCallContext } from "../src/contract.js";

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

// ── buildPaginationHint — architect-ratified shape ─────────────────

describe("buildPaginationHint — architect-ratified shape (thread-160)", () => {
  it("emits the exact contract shape", () => {
    const hint = buildPaginationHint(150, 10, 10);
    expect(hint).toEqual({
      total: 150,
      count: 10,
      next_offset: 10,
      hint: "Use offset=10 to retrieve more results",
    });
  });
});

// ── summarizeResult — pure helper ──────────────────────────────────

describe("summarizeResult (pure)", () => {
  it("passes through arrays shorter than maxItems unchanged", () => {
    const arr = [1, 2, 3];
    expect(summarizeResult(arr, 10)).toBe(arr);
  });

  it("truncates top-level arrays longer than maxItems with pagination envelope", () => {
    const arr = Array.from({ length: 50 }, (_, i) => ({ id: i }));
    const out = summarizeResult(arr, 10) as {
      _ois_pagination: { total: number; count: number; next_offset: number; hint: string };
      items: unknown[];
    };
    expect(out._ois_pagination.total).toBe(50);
    expect(out._ois_pagination.count).toBe(10);
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
      _ois_pagination: { total: number; count: number };
      ideas: unknown[];
      status: string;
      count: number;
    };
    expect(out._ois_pagination.total).toBe(50);
    expect(out._ois_pagination.count).toBe(5);
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
      _ois_pagination: { total: number };
      small: unknown[];
      big: unknown[];
      huge: unknown[];
    };
    expect(out._ois_pagination.total).toBe(500); // picked huge
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
      tele: "x".repeat(500), // single large string, no array
      items: [1, 2], // array is tiny — but we also check byte threshold
    };
    const next = vi.fn().mockResolvedValue(heavy);
    const context = ctx({ tool: "list_tele" });
    const result = await summarizer.onToolCall(context, next);
    // Heuristic: oversized byte count should trigger, but there's
    // no eligible array to truncate → falls through to pass-through
    // inside summarizeResult (object had no oversized array prop).
    expect(result).toBe(heavy);
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

  it("summarizes when args.limit > maxItems (caller asked for more than we'd ship)", async () => {
    const summarizer = new ResponseSummarizer({ maxItems: 5 });
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const next = vi.fn().mockResolvedValue(items);
    // Caller asked for 50 items; summarizer caps at 5
    const context = ctx({ tool: "list_tasks", args: { limit: 50 } });
    const result = await summarizer.onToolCall(context, next) as { _ois_pagination: unknown; items: unknown[] };
    expect(result._ois_pagination).toBeDefined();
    expect(result.items).toHaveLength(5);
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
      perToolMaxItems: { list_tele: null },
    });
    const big = Array.from({ length: 50 }, (_, i) => i);
    const next = vi.fn().mockResolvedValue(big);
    const context = ctx({ tool: "list_tele" });
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
