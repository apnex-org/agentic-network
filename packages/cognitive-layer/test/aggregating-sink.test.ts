/**
 * AggregatingTelemetrySink unit tests (Phase 2a ckpt-C coverage).
 *
 * Pins counters for: tool_call / tool_error / list_tools / llm_usage
 * events, byte/token totals, cache/dedup/circuit tags, and the new
 * Virtual Tokens Saved KPI derived from ctx.tags.virtualTokensSaved.
 */

import { describe, it, expect } from "vitest";
import { AggregatingTelemetrySink } from "../bench/aggregating-sink.js";
import type { TelemetryEvent } from "../src/middlewares/telemetry.js";

function now(): number {
  return Date.now();
}

describe("AggregatingTelemetrySink — kind counting", () => {
  it("counts tool_call / tool_error / list_tools / llm_usage independently", () => {
    const sink = new AggregatingTelemetrySink();

    sink.ingest({ kind: "tool_call", tool: "get_thread", timestamp: now() });
    sink.ingest({ kind: "tool_call", tool: "list_ideas", timestamp: now() });
    sink.ingest({ kind: "tool_error", tool: "bad_tool", errorMessage: "oops", timestamp: now() });
    sink.ingest({ kind: "list_tools", toolCount: "40", timestamp: now(), tags: { toolCount: "40" } } as TelemetryEvent);
    sink.ingest({
      kind: "llm_usage",
      llmRound: 1,
      llmPromptTokens: 1000,
      llmCompletionTokens: 100,
      llmTotalTokens: 1100,
      timestamp: now(),
    });

    const s = sink.snapshot();
    expect(s.totalEvents).toBe(5);
    expect(s.toolCalls).toBe(2);
    expect(s.toolErrors).toBe(1);
    expect(s.listTools).toBe(1);
    expect(s.llmUsageEvents).toBe(1);
  });
});

describe("AggregatingTelemetrySink — llm_usage accumulation", () => {
  it("sums prompt / completion / total tokens across events", () => {
    const sink = new AggregatingTelemetrySink();

    for (let i = 1; i <= 3; i++) {
      sink.ingest({
        kind: "llm_usage",
        llmRound: i,
        llmPromptTokens: 1000 * i,
        llmCompletionTokens: 100 * i,
        llmTotalTokens: 1100 * i,
        timestamp: now(),
      });
    }

    const s = sink.snapshot();
    expect(s.llmUsageEvents).toBe(3);
    expect(s.totalLlmPromptTokens).toBe(6000); // 1000+2000+3000
    expect(s.totalLlmCompletionTokens).toBe(600);
    expect(s.totalLlmTotalTokens).toBe(6600);
  });

  it("tolerates missing llm fields (defensive)", () => {
    const sink = new AggregatingTelemetrySink();
    sink.ingest({ kind: "llm_usage", llmRound: 1, timestamp: now() } as TelemetryEvent);
    const s = sink.snapshot();
    expect(s.llmUsageEvents).toBe(1);
    expect(s.totalLlmPromptTokens).toBe(0);
  });
});

describe("AggregatingTelemetrySink — Virtual Tokens Saved KPI", () => {
  it("counts summarized events + sums virtualTokensSaved from ctx.tags", () => {
    const sink = new AggregatingTelemetrySink();

    sink.ingest({
      kind: "tool_call",
      tool: "list_ideas",
      tags: { summarized: "true", virtualTokensSaved: "1250" },
      timestamp: now(),
    });
    sink.ingest({
      kind: "tool_call",
      tool: "list_tele",
      tags: { summarized: "true", virtualTokensSaved: "340" },
      timestamp: now(),
    });
    // Event without summarized tag — should NOT count
    sink.ingest({
      kind: "tool_call",
      tool: "get_thread",
      tags: {},
      timestamp: now(),
    });

    const s = sink.snapshot();
    expect(s.summarizedCallCount).toBe(2);
    expect(s.totalVirtualTokensSaved).toBe(1590); // 1250 + 340
  });

  it("ignores non-numeric virtualTokensSaved values", () => {
    const sink = new AggregatingTelemetrySink();
    sink.ingest({
      kind: "tool_call",
      tool: "x",
      tags: { summarized: "true", virtualTokensSaved: "not-a-number" },
      timestamp: now(),
    });
    const s = sink.snapshot();
    expect(s.summarizedCallCount).toBe(1);
    expect(s.totalVirtualTokensSaved).toBe(0);
  });
});

describe("AggregatingTelemetrySink — reset clears all counters", () => {
  it("reset returns to empty state", () => {
    const sink = new AggregatingTelemetrySink();
    sink.ingest({ kind: "tool_call", tool: "x", timestamp: now() });
    sink.ingest({
      kind: "llm_usage",
      llmPromptTokens: 500,
      llmCompletionTokens: 50,
      llmTotalTokens: 550,
      timestamp: now(),
    });
    sink.reset();
    const s = sink.snapshot();
    expect(s.totalEvents).toBe(0);
    expect(s.llmUsageEvents).toBe(0);
    expect(s.totalLlmPromptTokens).toBe(0);
    expect(s.totalVirtualTokensSaved).toBe(0);
  });
});

describe("AggregatingTelemetrySink — sink function wired", () => {
  it("sink arrow calls ingest", () => {
    const sink = new AggregatingTelemetrySink();
    sink.sink({ kind: "tool_call", tool: "via_sink_fn", timestamp: now() });
    expect(sink.snapshot().toolCalls).toBe(1);
  });
});
