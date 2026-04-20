/**
 * CognitiveTelemetry middleware (ADR-018).
 *
 * Outermost layer of the standard pipeline. Captures every tool call,
 * list-tools invocation, and error with timing + annotations. Emissions
 * are strictly non-blocking (INV-COG-2, INV-COG-11): event metadata is
 * captured synchronously on the hot path and delivered to the user-
 * provided sink via `queueMicrotask` — the pipeline never awaits the
 * sink.
 *
 * Back-pressure: a bounded internal queue caps at `maxQueueDepth`
 * pending emissions. When full, new events are dropped and a rate-
 * limited `telemetry_overflow` log entry surfaces via the diagnostic
 * `logger` callback. Sink exceptions are swallowed — telemetry failure
 * never propagates into agent code.
 */

import type {
  CognitiveMiddleware,
  ToolCallContext,
  ListToolsContext,
  ToolErrorContext,
  Tool,
} from "../contract.js";

export type TelemetryEventKind =
  | "tool_call"
  | "list_tools"
  | "tool_error"
  | "telemetry_overflow"
  /**
   * Per-LLM-round usage emitted by shims that own their LLM loop
   * (vertex-cloudrun). Carries Gemini-like `{promptTokenCount,
   * candidatesTokenCount}` in the new `llm*` fields. Flows through
   * the same sink as tool-call events so consumers can cross-
   * correlate LLM token spend with tool-surface token pressure.
   */
  | "llm_usage";

export interface TelemetryEvent {
  kind: TelemetryEventKind;
  sessionId?: string;
  agentId?: string;
  tool?: string;
  durationMs?: number;
  tags?: Record<string, string>;
  errorMessage?: string;
  droppedCount?: number;
  /**
   * Byte-length of the serialized tool-call arguments (request).
   * `JSON.stringify(args).length` — measures the outbound payload
   * size that flows from the LLM through the cognitive layer to the
   * Hub. Cheap proxy for "what this tool call costs to emit".
   */
  inputBytes?: number;
  /**
   * Byte-length of the serialized tool-call result (response).
   * Measured at settlement. Populated on `tool_call` events; omitted
   * on `tool_error` (result unavailable) and on `tool_call` events
   * where short-circuiting middlewares (cache hits, dedup replays)
   * returned a non-serializable value.
   */
  outputBytes?: number;
  /**
   * Approximate token count for `inputBytes`, using the industry-
   * standard `bytes / 4` heuristic. Suitable for order-of-magnitude
   * accounting; not a replacement for a real tokenizer. Consumers
   * that need exact per-model counts should wrap this sink with a
   * tokenizer pass.
   */
  inputTokensApprox?: number;
  /** Approximate token count for `outputBytes`. Same heuristic. */
  outputTokensApprox?: number;
  /**
   * LLM-usage fields (populated on `llm_usage` events). Carry the
   * shim-owned LLM's per-round token accounting into the same
   * telemetry sink as tool-call events. `llmRound` mirrors the
   * generateWithTools loop counter. See vertex-cloudrun's
   * `LlmRoundUsage` for the upstream type.
   */
  llmRound?: number;
  llmPromptTokens?: number;
  llmCompletionTokens?: number;
  llmTotalTokens?: number;
  llmFinishReason?: string;
  llmParallelToolCalls?: number;
  timestamp: number;
}

export interface CognitiveTelemetryConfig {
  /** User-provided event emitter. Called asynchronously via microtask. */
  sink?: (event: TelemetryEvent) => void;
  /** Diagnostic logger for overflow warnings. */
  logger?: (msg: string) => void;
  /** Internal bounded-queue depth before dropping. Default: 1000. */
  maxQueueDepth?: number;
  /** Rate limit for overflow-warning logs (ms). Default: 60_000. */
  overflowLogIntervalMs?: number;
  /** Clock override for tests. Default: `Date.now`. */
  now?: () => number;
}

const DEFAULT_MAX_QUEUE_DEPTH = 1000;
const DEFAULT_OVERFLOW_LOG_INTERVAL_MS = 60_000;

/**
 * Classify a caller's args into a queryShape category (M-QueryShape
 * Phase 1, idea-119). Mirrors the Hub-side `detectQueryShape` in
 * `list-filters.ts` — kept as a local copy so this package has no
 * dependency on `@ois/relay-hub`. Values: "none" | "filter_only" |
 * "sort_only" | "filter_sort".
 */
function detectQueryShape(args: unknown): "none" | "filter_only" | "sort_only" | "filter_sort" {
  if (args == null || typeof args !== "object" || Array.isArray(args)) return "none";
  const a = args as Record<string, unknown>;
  const hasFilter =
    a.filter != null &&
    typeof a.filter === "object" &&
    !Array.isArray(a.filter) &&
    Object.keys(a.filter as Record<string, unknown>).length > 0;
  const hasSort = Array.isArray(a.sort) && a.sort.length > 0;
  if (hasFilter && hasSort) return "filter_sort";
  if (hasFilter) return "filter_only";
  if (hasSort) return "sort_only";
  return "none";
}

/**
 * Byte-length of a serialized value. Uses `JSON.stringify` length as
 * a cheap proxy — single UTF-16 char ~= 1 byte for ASCII-dominant
 * payloads (which is the typical case for MCP tool args/results).
 * Non-serializable values (circular refs, BigInt) return 0 rather
 * than throw — telemetry must never disturb the hot path.
 */
export function byteLength(value: unknown): number {
  if (value === undefined || value === null) return 0;
  try {
    if (typeof value === "string") return value.length;
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

/**
 * Approximate token count from byte count, using the industry-standard
 * `bytes / 4` heuristic. Good for order-of-magnitude accounting.
 * Consumers needing per-model precision should wrap the telemetry
 * sink with a real tokenizer.
 */
export function approximateTokens(bytes: number): number {
  return Math.ceil(bytes / 4);
}

export class CognitiveTelemetry implements CognitiveMiddleware {
  readonly name = "CognitiveTelemetry";

  private readonly sink: (event: TelemetryEvent) => void;
  private readonly logger: (msg: string) => void;
  private readonly maxQueueDepth: number;
  private readonly overflowLogIntervalMs: number;
  private readonly now: () => number;

  /** Pending emissions awaiting microtask delivery. */
  private pending = 0;
  /** Count of events dropped since last overflow log. */
  private dropped = 0;
  /** Timestamp of last overflow log (throttling). */
  private lastOverflowLog = 0;

  constructor(config: CognitiveTelemetryConfig = {}) {
    this.sink = config.sink ?? (() => {});
    this.logger = config.logger ?? (() => {});
    this.maxQueueDepth = config.maxQueueDepth ?? DEFAULT_MAX_QUEUE_DEPTH;
    this.overflowLogIntervalMs =
      config.overflowLogIntervalMs ?? DEFAULT_OVERFLOW_LOG_INTERVAL_MS;
    this.now = config.now ?? Date.now;
  }

  async onToolCall(
    ctx: ToolCallContext,
    next: (ctx: ToolCallContext) => Promise<unknown>,
  ): Promise<unknown> {
    const started = this.now();
    const inputBytes = byteLength(ctx.args);

    // M-QueryShape Phase 1 (idea-119, task-302) — auto-tag queryShape
    // on list_* tool calls so the harness can measure adoption. Detects
    // the presence of filter / sort in ctx.args without the Hub needing
    // to reach into architect-side context. Values:
    //   "none" | "filter_only" | "sort_only" | "filter_sort"
    if (ctx.tool.startsWith("list_") && !ctx.tags.queryShape) {
      ctx.tags.queryShape = detectQueryShape(ctx.args);
    }

    try {
      const result = await next(ctx);
      const outputBytes = byteLength(result);
      this.emit({
        kind: "tool_call",
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        tool: ctx.tool,
        durationMs: this.now() - started,
        tags: { ...ctx.tags },
        inputBytes,
        inputTokensApprox: approximateTokens(inputBytes),
        outputBytes,
        outputTokensApprox: approximateTokens(outputBytes),
        timestamp: this.now(),
      });
      return result;
    } catch (err) {
      this.emit({
        kind: "tool_error",
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        tool: ctx.tool,
        durationMs: this.now() - started,
        tags: { ...ctx.tags },
        errorMessage: err instanceof Error ? err.message : String(err),
        inputBytes,
        inputTokensApprox: approximateTokens(inputBytes),
        // outputBytes intentionally omitted — next() threw; no result.
        timestamp: this.now(),
      });
      throw err;
    }
  }

  async onListTools(
    ctx: ListToolsContext,
    next: (ctx: ListToolsContext) => Promise<Tool[]>,
  ): Promise<Tool[]> {
    const started = this.now();
    const result = await next(ctx);
    const outputBytes = byteLength(result);
    this.emit({
      kind: "list_tools",
      sessionId: ctx.sessionId,
      agentId: ctx.agentId,
      durationMs: this.now() - started,
      tags: { ...ctx.tags, toolCount: String(result.length) },
      outputBytes,
      outputTokensApprox: approximateTokens(outputBytes),
      timestamp: this.now(),
    });
    return result;
  }

  /**
   * Exposed for diagnostics + tests. Runtime value of the in-flight
   * emission count (decremented once the microtask fires).
   */
  getPendingCount(): number {
    return this.pending;
  }

  /** Count of events dropped since last overflow log. */
  getDroppedCount(): number {
    return this.dropped;
  }

  /**
   * Emit an `llm_usage` telemetry event — called by shims that own
   * their LLM loop to surface per-round Gemini / Anthropic usage
   * through the same sink as tool-call events.
   *
   * @param usage  Per-round usage metadata (promptTokens, etc)
   * @param ctx    Optional call context carrying sessionId + agentId
   */
  emitLlmUsage(
    usage: {
      round: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      finishReason?: string;
      parallelToolCalls?: number;
    },
    ctx?: { sessionId?: string; agentId?: string; tags?: Record<string, string> },
  ): void {
    this.emit({
      kind: "llm_usage",
      sessionId: ctx?.sessionId,
      agentId: ctx?.agentId,
      tags: ctx?.tags ? { ...ctx.tags } : undefined,
      llmRound: usage.round,
      llmPromptTokens: usage.promptTokens,
      llmCompletionTokens: usage.completionTokens,
      llmTotalTokens: usage.totalTokens,
      llmFinishReason: usage.finishReason,
      llmParallelToolCalls: usage.parallelToolCalls,
      timestamp: this.now(),
    });
  }

  private emit(event: TelemetryEvent): void {
    if (this.pending >= this.maxQueueDepth) {
      this.dropped++;
      const now = this.now();
      if (now - this.lastOverflowLog >= this.overflowLogIntervalMs) {
        this.logger(
          `[CognitiveTelemetry] queue overflow: dropped ${this.dropped} events (queue depth ${this.maxQueueDepth})`,
        );
        this.lastOverflowLog = now;
      }
      return;
    }
    this.pending++;
    queueMicrotask(() => {
      try {
        this.sink(event);
      } catch {
        /* sink failure swallowed — telemetry never propagates errors */
      } finally {
        this.pending--;
      }
    });
  }
}
