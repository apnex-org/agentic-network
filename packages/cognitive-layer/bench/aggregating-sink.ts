/**
 * AggregatingTelemetrySink — reference consumer for benchmark + dashboard use.
 *
 * Counts events + derives summary metrics from a raw TelemetryEvent
 * stream. No external deps. Suitable for in-process dashboards,
 * benchmarks, or as a reference for production telemetry consumers.
 *
 * NOT an LRU or windowed aggregator — Phase 2 could ship a
 * `WindowedAggregatingSink` for rolling time-series. This one is
 * cumulative since `reset()` (or instance creation).
 */

import type { TelemetryEvent } from "../src/middlewares/telemetry.js";

export interface AggregatedCounters {
  totalEvents: number;
  toolCalls: number;
  toolErrors: number;
  listTools: number;
  overflow: number;
  /** Phase 2a ckpt-C — Gemini / shim-LLM usage events */
  llmUsageEvents: number;

  // Volume & payload
  totalInputBytes: number;
  totalOutputBytes: number;
  totalInputTokensApprox: number;
  totalOutputTokensApprox: number;

  // Phase 2a — LLM-side token accounting (sum across llm_usage events)
  totalLlmPromptTokens: number;
  totalLlmCompletionTokens: number;
  totalLlmTotalTokens: number;

  // Phase 2a — Virtual Tokens Saved (ResponseSummarizer KPI)
  /** Sum of ctx.tags.virtualTokensSaved across all tool_call events */
  totalVirtualTokensSaved: number;
  /** Count of events that triggered ResponseSummarizer truncation */
  summarizedCallCount: number;

  // Duration (sum + count for mean derivation)
  totalDurationMs: number;
  durationCount: number;

  // Tag-derived counters
  cacheHits: number;
  cacheMisses: number;
  dedupFirst: number;
  dedupInFlight: number;
  dedupReplay: number;
  circuitBreakerFastFails: number;
  circuitBreakerProbes: number;

  // Per-tool breakdown
  toolCallsByTool: Record<string, number>;
  outputTokensByTool: Record<string, number>;

  // Error-message breakdown (first 40 chars for brevity)
  errorMessagesByPrefix: Record<string, number>;
}

export class AggregatingTelemetrySink {
  private counters: AggregatedCounters = emptyCounters();

  /** The sink callback — pass this directly to CognitiveTelemetry. */
  readonly sink = (event: TelemetryEvent): void => {
    this.ingest(event);
  };

  ingest(event: TelemetryEvent): void {
    const c = this.counters;
    c.totalEvents++;

    switch (event.kind) {
      case "tool_call":
        c.toolCalls++;
        break;
      case "tool_error":
        c.toolErrors++;
        break;
      case "list_tools":
        c.listTools++;
        break;
      case "telemetry_overflow":
        c.overflow++;
        return;
      case "llm_usage":
        c.llmUsageEvents++;
        if (typeof event.llmPromptTokens === "number") c.totalLlmPromptTokens += event.llmPromptTokens;
        if (typeof event.llmCompletionTokens === "number") c.totalLlmCompletionTokens += event.llmCompletionTokens;
        if (typeof event.llmTotalTokens === "number") c.totalLlmTotalTokens += event.llmTotalTokens;
        return;
    }

    if (typeof event.durationMs === "number") {
      c.totalDurationMs += event.durationMs;
      c.durationCount++;
    }

    if (typeof event.inputBytes === "number") c.totalInputBytes += event.inputBytes;
    if (typeof event.outputBytes === "number") c.totalOutputBytes += event.outputBytes;
    if (typeof event.inputTokensApprox === "number") c.totalInputTokensApprox += event.inputTokensApprox;
    if (typeof event.outputTokensApprox === "number") c.totalOutputTokensApprox += event.outputTokensApprox;

    if (event.tool) {
      c.toolCallsByTool[event.tool] = (c.toolCallsByTool[event.tool] ?? 0) + 1;
      if (typeof event.outputTokensApprox === "number") {
        c.outputTokensByTool[event.tool] =
          (c.outputTokensByTool[event.tool] ?? 0) + event.outputTokensApprox;
      }
    }

    const tags = event.tags ?? {};
    if (tags.cacheHit === "true") c.cacheHits++;
    if (tags.cacheHit === "false") c.cacheMisses++;
    if (tags.dedup === "first") c.dedupFirst++;
    if (tags.dedup === "in_flight") c.dedupInFlight++;
    if (tags.dedup === "replay") c.dedupReplay++;
    if (tags.circuitBreaker === "fast_fail_open" || tags.circuitBreaker === "fast_fail_half_open") {
      c.circuitBreakerFastFails++;
    }
    if (tags.circuitBreaker === "probe") c.circuitBreakerProbes++;

    // Phase 2a — Virtual Tokens Saved (architect-ratified primary KPI)
    if (tags.summarized === "true") {
      c.summarizedCallCount++;
      const vts = Number(tags.virtualTokensSaved);
      if (Number.isFinite(vts)) c.totalVirtualTokensSaved += vts;
    }

    if (event.errorMessage) {
      const prefix = event.errorMessage.slice(0, 40);
      c.errorMessagesByPrefix[prefix] = (c.errorMessagesByPrefix[prefix] ?? 0) + 1;
    }
  }

  snapshot(): AggregatedCounters {
    // Shallow clone; deep-clone the nested maps so downstream mutation doesn't corrupt us.
    const c = this.counters;
    return {
      ...c,
      toolCallsByTool: { ...c.toolCallsByTool },
      outputTokensByTool: { ...c.outputTokensByTool },
      errorMessagesByPrefix: { ...c.errorMessagesByPrefix },
    };
  }

  reset(): void {
    this.counters = emptyCounters();
  }

  // ── Derived metrics ──────────────────────────────────────────────

  cacheHitRate(): number {
    const total = this.counters.cacheHits + this.counters.cacheMisses;
    return total === 0 ? 0 : this.counters.cacheHits / total;
  }

  dedupPreventionRate(): number {
    // Prevented = in-flight + replay (the ones the cache would have let through)
    const prevented = this.counters.dedupInFlight + this.counters.dedupReplay;
    const total = this.counters.dedupFirst + prevented;
    return total === 0 ? 0 : prevented / total;
  }

  meanDurationMs(): number {
    return this.counters.durationCount === 0
      ? 0
      : this.counters.totalDurationMs / this.counters.durationCount;
  }

  errorRate(): number {
    const settled = this.counters.toolCalls + this.counters.toolErrors;
    return settled === 0 ? 0 : this.counters.toolErrors / settled;
  }
}

function emptyCounters(): AggregatedCounters {
  return {
    totalEvents: 0,
    toolCalls: 0,
    toolErrors: 0,
    listTools: 0,
    overflow: 0,
    llmUsageEvents: 0,
    totalInputBytes: 0,
    totalOutputBytes: 0,
    totalInputTokensApprox: 0,
    totalOutputTokensApprox: 0,
    totalLlmPromptTokens: 0,
    totalLlmCompletionTokens: 0,
    totalLlmTotalTokens: 0,
    totalVirtualTokensSaved: 0,
    summarizedCallCount: 0,
    totalDurationMs: 0,
    durationCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    dedupFirst: 0,
    dedupInFlight: 0,
    dedupReplay: 0,
    circuitBreakerFastFails: 0,
    circuitBreakerProbes: 0,
    toolCallsByTool: {},
    outputTokensByTool: {},
    errorMessagesByPrefix: {},
  };
}
