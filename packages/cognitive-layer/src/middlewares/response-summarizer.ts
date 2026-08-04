/**
 * ResponseSummarizer middleware (ADR-018 Phase 2a — thread-160 ratified).
 *
 * Intercepts oversized tool-call results and truncates large arrays,
 * disclosing the truncation IN-BAND so the caller can distinguish a
 * partial view from a complete one.
 *
 * truthretr0 (bug-263 / bug-339 / bug-476 / bug-232): the pre-fix
 * envelope was DISHONEST IN TWO WAYS.
 *   1. It never said WHICH array was truncated. For an object result the
 *      caller saw total/count but had to GUESS the field — which is how
 *      bug-476 came to be filed against `get_bug` when the truncation is
 *      performed here, by this middleware, on whichever array is longest.
 *   2. It emitted `"Use offset=N to retrieve more results"` UNCONDITIONALLY,
 *      fabricating a paging affordance for tools that have none.
 *      `list_documents` accepts `prefix` + `category` ONLY — there is no
 *      offset to use, so the hint sent callers after data they could not
 *      reach by that route.
 *
 * A hint now names a paging parameter ONLY when one has been explicitly
 * declared for that tool via `perToolPagingParam`. Absent a declaration,
 * the disclosure says plainly that the omitted items are NOT reachable by
 * re-calling with an offset. The fabrication is unrepresentable rather
 * than discouraged: there is no code path that can invent a parameter name.
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
 *       "truncated": true,
 *       "field": "items",
 *       "total": 150,
 *       "count": 10,
 *       "omitted": 140,
 *       "reason": "client-side summarisation by cognitive-layer response-summarizer",
 *       "next_offset": null,
 *       "hint": "<no paging parameter declared for this tool> ..."
 *     },
 *     "items": [item1, ..., item10]
 *   }
 *
 *   Input:  { ideas: [150 items], status: "ok" }
 *   Output: {
 *     "_ois_pagination": { ..., "field": "ideas" },
 *     "ideas": [first 10 items],
 *     "status": "ok"
 *   }
 *
 * A COMPLETE result is returned reference-equal and carries NO
 * `_ois_pagination` key at all — absence of the envelope is the
 * negative control.
 *
 * Tags `ctx.tags.virtualTokensSaved` with the delta between raw and
 * summarized payload token-approximations. Consumed by
 * CognitiveTelemetry as the Phase 2 primary KPI.
 */

import type {
  CognitiveMiddleware,
  ToolCallContext,
} from "../contract.js";
import { isInternalCall } from "../contract.js";

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
   * truthretr0: tool name -> the name of the paging parameter that tool
   * ACTUALLY accepts (e.g. { list_bugs: "offset" }).
   *
   * A truncation disclosure names a parameter ONLY if it is declared here.
   * Undeclared tools get an explicit "no paging parameter" statement rather
   * than a fabricated one. This is the anti-fabrication mechanism: the
   * middleware cannot invent an affordance it was never told about.
   */
  perToolPagingParam?: Record<string, string>;
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

export interface TruncationDisclosure {
  /** Explicit, machine-checkable. Absent envelope == complete result. */
  truncated: true;
  /** WHICH array was truncated. Prevents the bug-476 mis-attribution class. */
  field: string;
  total: number;
  count: number;
  omitted: number;
  /** Names the layer responsible, so the defect is not attributed to the tool. */
  reason: string;
  /** Non-null ONLY when the tool has a declared paging parameter. */
  next_offset: number | null;
  hint: string;
}

/**
 * truthretr0: build an HONEST truncation disclosure.
 *
 * `pagingParam` is the name of a paging parameter the tool genuinely
 * accepts. When it is absent the disclosure states that the omitted items
 * are NOT retrievable by re-calling — it does NOT guess a parameter name.
 */
export function buildTruncationDisclosure(
  field: string,
  total: number,
  count: number,
  pagingParam?: string,
): TruncationDisclosure {
  return {
    truncated: true,
    field,
    total,
    count,
    omitted: total - count,
    reason:
      "client-side summarisation by cognitive-layer response-summarizer (not the tool)",
    next_offset: pagingParam ? count : null,
    hint: pagingParam
      ? `Re-call with ${pagingParam}=${count} to retrieve the next page.`
      : `${total - count} of ${total} items in "${field}" were omitted by client-side summarisation. This tool has NO declared paging parameter, so the omitted items are NOT retrievable by re-calling with an offset — narrow the query, or use a compact/bulk projection if the surface offers one.`,
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
  pagingParam?: string,
): unknown {
  // Top-level array
  if (Array.isArray(result)) {
    if (result.length <= maxItems) return result;
    return {
      _ois_pagination: buildTruncationDisclosure(
        "items",
        result.length,
        maxItems,
        pagingParam,
      ),
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
        // truthretr0: name the field. Without this the caller cannot tell
        // WHICH array was cut and mis-attributes the defect to the tool.
        _ois_pagination: buildTruncationDisclosure(
          largestKey,
          largestLen,
          maxItems,
          pagingParam,
        ),
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
  private readonly perToolPagingParam: Record<string, string>;
  private readonly shouldSummarize: (tool: string, result: unknown) => boolean;

  constructor(config: ResponseSummarizerConfig = {}) {
    this.maxItems = config.maxItems ?? DEFAULT_MAX_ITEMS;
    this.maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES;
    this.perToolMaxItems = { ...(config.perToolMaxItems ?? {}) };
    this.perToolPagingParam = { ...(config.perToolPagingParam ?? {}) };
    this.shouldSummarize =
      config.shouldSummarize ??
      ((tool, result) => defaultShouldSummarize(tool, result, this.maxBytes, this.maxItems));
  }

  async onToolCall(
    ctx: ToolCallContext,
    next: (ctx: ToolCallContext) => Promise<unknown>,
  ): Promise<unknown> {
    const result = await next(ctx);

    // bug-106: internal-machinery calls (poll-backstop catch-up, heartbeat)
    // need the raw, full result — the summarizer exists for the LLM's
    // context budget, not for machinery. Skip the summarize step entirely.
    if (isInternalCall(ctx.tags)) return result;

    // Per-tool override: explicit null disables summarization; explicit
    // number overrides maxItems.
    const override = this.perToolMaxItems[ctx.tool];
    if (override === null) return result;
    let effectiveMaxItems = typeof override === "number" ? override : this.maxItems;

    // M-QueryShape Phase 1 (idea-119, task-302) + bug-117 — respect the
    // caller's explicit `limit`. Two cases, BOTH honoring the caller:
    //   DOWNWARD (limit ≤ threshold): the LLM asked for a bounded subset
    //     within our threshold — it got exactly what it asked for, so
    //     return as-is without second-guessing by truncating further.
    //   UPWARD (limit > threshold): the LLM explicitly asked for MORE than
    //     the default — RAISE the summarize cap to the caller's limit so an
    //     explicit larger ask isn't structurally truncated back to the
    //     default (bug-117: this silent 10-cap broke exhaustive list_*
    //     batch-pulls — cross-ref / audit / ledger-reconciliation had to
    //     paginate around it; tele-4 zero-loss-knowledge).
    // Only acts when `limit` is present AND numeric AND positive.
    const callerLimit =
      ctx.args && typeof ctx.args === "object" && !Array.isArray(ctx.args)
        ? (ctx.args as Record<string, unknown>).limit
        : undefined;
    if (typeof callerLimit === "number" && callerLimit > 0) {
      if (callerLimit <= effectiveMaxItems) return result;
      effectiveMaxItems = Math.max(effectiveMaxItems, callerLimit);
    }

    if (!this.shouldSummarize(ctx.tool, result)) return result;

    // truthretr0: a paging parameter is named ONLY if declared for this tool.
    const summarized = summarizeResult(
      result,
      effectiveMaxItems,
      this.perToolPagingParam[ctx.tool],
    );

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
