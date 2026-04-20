/**
 * ResponseSummarizer middleware (ADR-018 Phase 2a — thread-160 ratified).
 *
 * Intercepts oversized tool-call results and truncates large arrays with
 * an architect-ratified pagination-hint structure, teaching the LLM
 * that (a) its view is partial and (b) how to fetch more.
 *
 * Positioned AFTER ToolResultCache in the standard pipeline — cached
 * results are stored in their summarized form, so a cache hit
 * re-delivers the summarized payload without re-running the
 * summarization step.
 *
 * Heuristic targets:
 *   1. Top-level arrays longer than `maxItems`
 *   2. Top-level objects whose largest array property exceeds `maxItems`
 *   (Deeply-nested arrays are not summarized — first-cut boundary to
 *   avoid mangling non-obvious result shapes.)
 *
 * Contract (architect-ratified, thread-160 round 2):
 *
 *   Input:  [item1, item2, ..., item150]  (top-level array)
 *   Output: {
 *     "_ois_pagination": {
 *       "total": 150,
 *       "count": 10,
 *       "next_offset": 10,
 *       "hint": "Use offset=10 to retrieve more results"
 *     },
 *     "items": [item1, ..., item10]
 *   }
 *
 *   Input:  { ideas: [150 items], status: "ok" }
 *   Output: {
 *     "_ois_pagination": { ... },
 *     "ideas": [first 10 items],
 *     "status": "ok"
 *   }
 *
 * Tags `ctx.tags.virtualTokensSaved` with the delta between raw and
 * summarized payload token-approximations. Consumed by
 * CognitiveTelemetry as the Phase 2 primary KPI.
 */

import type {
  CognitiveMiddleware,
  ToolCallContext,
} from "../contract.js";

export interface ResponseSummarizerConfig {
  /**
   * Max items to include before truncation. Default: 10.
   * The LLM sees this many items + a pagination hint for the rest.
   */
  maxItems?: number;
  /**
   * Byte-length threshold for "oversized" — if raw result exceeds
   * this, summarize. Set to `Infinity` to defer entirely to array-
   * length heuristic. Default: 2000.
   */
  maxBytes?: number;
  /**
   * Per-tool override for `maxItems`. Null means don't summarize that
   * tool. Useful for tools with small but high-signal results.
   */
  perToolMaxItems?: Record<string, number | null>;
  /**
   * Summarization predicate override. Receives tool name + raw result;
   * returns true if summarization should be applied. Default heuristic
   * applies to read-verb tools with an oversized array shape.
   */
  shouldSummarize?: (tool: string, result: unknown) => boolean;
}

const DEFAULT_MAX_ITEMS = 10;
const DEFAULT_MAX_BYTES = 2000;

function defaultShouldSummarize(
  tool: string,
  result: unknown,
  maxBytes: number,
  maxItems: number,
): boolean {
  // Only summarize read tools — writes are typically small + structural
  if (!tool.startsWith("get_") && !tool.startsWith("list_")) return false;
  if (result === null || typeof result !== "object") return false;

  // Heuristic 1: oversized serialized byte-length
  let bytes = 0;
  try {
    bytes = JSON.stringify(result).length;
  } catch {
    return false; // non-serializable — leave alone
  }
  if (bytes > maxBytes) return true;

  // Heuristic 2: top-level array is bigger than maxItems
  if (Array.isArray(result) && result.length > maxItems) return true;

  // Heuristic 3: object with a single array property bigger than maxItems
  if (!Array.isArray(result)) {
    const entries = Object.entries(result as Record<string, unknown>);
    for (const [, value] of entries) {
      if (Array.isArray(value) && value.length > maxItems) return true;
    }
  }

  return false;
}

export function buildPaginationHint(
  total: number,
  count: number,
  nextOffset: number,
): {
  total: number;
  count: number;
  next_offset: number;
  hint: string;
} {
  return {
    total,
    count,
    next_offset: nextOffset,
    hint: `Use offset=${nextOffset} to retrieve more results`,
  };
}

/**
 * Core summarization step. Pure function — no middleware context
 * required. Exported for unit testing + consumer reuse (e.g., a
 * custom shouldSummarize predicate returning its own summarization
 * via this helper).
 */
export function summarizeResult(
  result: unknown,
  maxItems: number,
): unknown {
  // Top-level array
  if (Array.isArray(result)) {
    if (result.length <= maxItems) return result;
    return {
      _ois_pagination: buildPaginationHint(result.length, maxItems, maxItems),
      items: result.slice(0, maxItems),
    };
  }

  // Object with largest array property → truncate that one
  if (result !== null && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    let largestKey: string | null = null;
    let largestLen = 0;
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v) && v.length > largestLen) {
        largestKey = k;
        largestLen = v.length;
      }
    }

    if (largestKey && largestLen > maxItems) {
      const truncated: Record<string, unknown> = {
        _ois_pagination: buildPaginationHint(largestLen, maxItems, maxItems),
      };
      for (const [k, v] of Object.entries(obj)) {
        if (k === largestKey) {
          truncated[k] = (v as unknown[]).slice(0, maxItems);
        } else {
          truncated[k] = v;
        }
      }
      return truncated;
    }
  }

  return result;
}

export class ResponseSummarizer implements CognitiveMiddleware {
  readonly name = "ResponseSummarizer";

  private readonly maxItems: number;
  private readonly maxBytes: number;
  private readonly perToolMaxItems: Record<string, number | null>;
  private readonly shouldSummarize: (tool: string, result: unknown) => boolean;

  constructor(config: ResponseSummarizerConfig = {}) {
    this.maxItems = config.maxItems ?? DEFAULT_MAX_ITEMS;
    this.maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES;
    this.perToolMaxItems = { ...(config.perToolMaxItems ?? {}) };
    this.shouldSummarize =
      config.shouldSummarize ??
      ((tool, result) => defaultShouldSummarize(tool, result, this.maxBytes, this.maxItems));
  }

  async onToolCall(
    ctx: ToolCallContext,
    next: (ctx: ToolCallContext) => Promise<unknown>,
  ): Promise<unknown> {
    const result = await next(ctx);

    // Per-tool override: explicit null disables summarization; explicit
    // number overrides maxItems.
    const override = this.perToolMaxItems[ctx.tool];
    if (override === null) return result;
    const effectiveMaxItems = typeof override === "number" ? override : this.maxItems;

    // M-QueryShape Phase 1 (idea-119, task-302) — respect caller's
    // `limit` parameter. If the LLM explicitly asked for a bounded
    // subset AND the bound is ≤ our summarize threshold, the caller
    // got exactly what it asked for — don't second-guess by truncating
    // further. Applies when filter+sort produced the intended subset
    // directly, so the LLM doesn't need to chase paginated data it
    // already decided isn't needed. Only bypasses when `limit` is
    // present AND numeric AND within the summarizer's threshold.
    const callerLimit =
      ctx.args && typeof ctx.args === "object" && !Array.isArray(ctx.args)
        ? (ctx.args as Record<string, unknown>).limit
        : undefined;
    if (typeof callerLimit === "number" && callerLimit > 0 && callerLimit <= effectiveMaxItems) {
      return result;
    }

    if (!this.shouldSummarize(ctx.tool, result)) return result;

    const summarized = summarizeResult(result, effectiveMaxItems);

    // Virtual Tokens Saved — the Phase 2 primary KPI (thread-160).
    // Records the delta between raw and summarized token-approximation
    // on ctx.tags. CognitiveTelemetry picks it up and surfaces it.
    const rawBytes = byteLengthOf(result);
    const summarizedBytes = byteLengthOf(summarized);
    const savedBytes = Math.max(0, rawBytes - summarizedBytes);
    const virtualTokensSaved = Math.ceil(savedBytes / 4);
    if (virtualTokensSaved > 0) {
      ctx.tags.virtualTokensSaved = String(virtualTokensSaved);
      ctx.tags.summarized = "true";
    }

    return summarized;
  }
}

function byteLengthOf(value: unknown): number {
  if (value === null || value === undefined) return 0;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}
