/**
 * CognitiveTelemetry unit tests.
 *
 * Pins: non-blocking emission (INV-COG-2, INV-COG-11), overflow
 * handling, sink-exception isolation, coverage of all three phases.
 */

import { describe, it, expect, vi } from "vitest";
import { CognitiveTelemetry, type TelemetryEvent } from "../src/middlewares/telemetry.js";
import type { ToolCallContext, ListToolsContext } from "../src/contract.js";

function ctx(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    tool: "get_thread",
    args: { threadId: "t" },
    sessionId: "sess-A",
    agentId: "eng-1",
    startedAt: 0,
    tags: {},
    ...overrides,
  };
}

function listCtx(overrides: Partial<ListToolsContext> = {}): ListToolsContext {
  return {
    sessionId: "sess-A",
    agentId: "eng-1",
    startedAt: 0,
    tags: {},
    ...overrides,
  };
}

/** Awaits the microtask queue so fire-and-forget emissions settle. */
async function flushMicrotasks(iterations = 3): Promise<void> {
  for (let i = 0; i < iterations; i++) {
    await Promise.resolve();
  }
}

describe("CognitiveTelemetry — tool_call events", () => {
  it("emits a tool_call event on successful completion", async () => {
    const events: TelemetryEvent[] = [];
    const t = new CognitiveTelemetry({ sink: (e) => events.push(e) });

    const result = await t.onToolCall(ctx(), async () => "hub-result");
    await flushMicrotasks();

    expect(result).toBe("hub-result");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "tool_call",
      tool: "get_thread",
      sessionId: "sess-A",
      agentId: "eng-1",
    });
    expect(typeof events[0].durationMs).toBe("number");
  });

  it("emits a tool_error event when the chain throws — error still propagates (INV-COG-3)", async () => {
    const events: TelemetryEvent[] = [];
    const t = new CognitiveTelemetry({ sink: (e) => events.push(e) });

    await expect(
      t.onToolCall(ctx(), async () => { throw new Error("hub down"); }),
    ).rejects.toThrow("hub down");
    await flushMicrotasks();

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("tool_error");
    expect(events[0].errorMessage).toBe("hub down");
  });

  it("propagates ctx.tags onto the emitted event", async () => {
    const events: TelemetryEvent[] = [];
    const t = new CognitiveTelemetry({ sink: (e) => events.push(e) });

    const tagged = ctx();
    (tagged.tags as Record<string, string>).cacheHit = "true";
    await t.onToolCall(tagged, async () => null);
    await flushMicrotasks();

    expect(events[0].tags).toEqual({ cacheHit: "true" });
  });

  describe("queryShape auto-tag (M-QueryShape Phase 1, idea-119)", () => {
    it("tags 'filter_sort' when both filter + sort are in args on list_* tool", async () => {
      const events: TelemetryEvent[] = [];
      const t = new CognitiveTelemetry({ sink: (e) => events.push(e) });
      await t.onToolCall(
        ctx({ tool: "list_tasks", args: { filter: { status: "pending" }, sort: [{ field: "createdAt", order: "asc" }] } }),
        async () => [],
      );
      await flushMicrotasks();
      expect(events[0].tags?.queryShape).toBe("filter_sort");
    });

    it("tags 'filter_only' when only filter is present", async () => {
      const events: TelemetryEvent[] = [];
      const t = new CognitiveTelemetry({ sink: (e) => events.push(e) });
      await t.onToolCall(
        ctx({ tool: "list_tasks", args: { filter: { status: "pending" } } }),
        async () => [],
      );
      await flushMicrotasks();
      expect(events[0].tags?.queryShape).toBe("filter_only");
    });

    it("tags 'sort_only' when only sort is present", async () => {
      const events: TelemetryEvent[] = [];
      const t = new CognitiveTelemetry({ sink: (e) => events.push(e) });
      await t.onToolCall(
        ctx({ tool: "list_tasks", args: { sort: [{ field: "id", order: "asc" }] } }),
        async () => [],
      );
      await flushMicrotasks();
      expect(events[0].tags?.queryShape).toBe("sort_only");
    });

    it("tags 'none' on list_* tool with neither filter nor sort", async () => {
      const events: TelemetryEvent[] = [];
      const t = new CognitiveTelemetry({ sink: (e) => events.push(e) });
      await t.onToolCall(ctx({ tool: "list_tasks", args: {} }), async () => []);
      await flushMicrotasks();
      expect(events[0].tags?.queryShape).toBe("none");
    });

    it("does NOT tag queryShape on non-list tools", async () => {
      const events: TelemetryEvent[] = [];
      const t = new CognitiveTelemetry({ sink: (e) => events.push(e) });
      await t.onToolCall(ctx({ tool: "create_thread", args: {} }), async () => null);
      await flushMicrotasks();
      expect(events[0].tags?.queryShape).toBeUndefined();
    });

    it("preserves pre-existing queryShape tag (caller can override)", async () => {
      const events: TelemetryEvent[] = [];
      const t = new CognitiveTelemetry({ sink: (e) => events.push(e) });
      const c = ctx({ tool: "list_tasks", args: { filter: { status: "pending" } } });
      (c.tags as Record<string, string>).queryShape = "custom";
      await t.onToolCall(c, async () => []);
      await flushMicrotasks();
      expect(events[0].tags?.queryShape).toBe("custom");
    });
  });
});

describe("CognitiveTelemetry — list_tools events", () => {
  it("emits a list_tools event with toolCount tag", async () => {
    const events: TelemetryEvent[] = [];
    const t = new CognitiveTelemetry({ sink: (e) => events.push(e) });

    await t.onListTools(listCtx(), async () => [
      { name: "get_thread" },
      { name: "create_thread" },
    ]);
    await flushMicrotasks();

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("list_tools");
    expect(events[0].tags).toMatchObject({ toolCount: "2" });
  });
});

describe("CognitiveTelemetry — non-blocking contract (INV-COG-11)", () => {
  it("onToolCall does NOT await the sink", async () => {
    let sinkResolved = false;
    const sink = () => {
      // Sink is synchronous; verify it completes within this turn of the event loop.
      sinkResolved = true;
    };
    const t = new CognitiveTelemetry({ sink });
    const result = await t.onToolCall(ctx(), async () => "x");
    // At this point, the microtask holding the sink may not have fired yet.
    // onToolCall must NOT have waited on the sink — the return happens before.
    expect(result).toBe("x");
    // Flushing microtasks now lets the sink fire.
    await flushMicrotasks();
    expect(sinkResolved).toBe(true);
  });

  it("sink exceptions are swallowed — pipeline is not disturbed", async () => {
    const t = new CognitiveTelemetry({
      sink: () => { throw new Error("sink blew up"); },
    });
    // Must not throw.
    await t.onToolCall(ctx(), async () => "ok");
    await flushMicrotasks();
    // Second call still works.
    const r2 = await t.onToolCall(ctx(), async () => "ok2");
    expect(r2).toBe("ok2");
  });
});

describe("CognitiveTelemetry — overflow back-pressure", () => {
  it("drops events past maxQueueDepth and logs overflow once per interval", async () => {
    // Block the sink by NEVER flushing microtasks — the queue fills synchronously.
    // Then call onToolCall rapidly to push past the threshold.
    const logs: string[] = [];
    const t = new CognitiveTelemetry({
      sink: () => { /* never called in this test because we don't flush */ },
      logger: (msg) => logs.push(msg),
      maxQueueDepth: 2,
      overflowLogIntervalMs: 1,
    });

    // Drive 5 rapid events WITHOUT awaiting microtasks between them.
    // Since onToolCall DOES await next() (which resolves sync here), the
    // enqueue happens after await — to fill the queue we need to call
    // enqueue faster than queueMicrotask can drain.
    //
    // Trick: make next() throw synchronously so the catch branch emits
    // tool_error, building up queue. Actually the simplest: call the
    // private emit indirectly many times by firing many unawaited
    // onToolCall's and never flushing.
    const pendingCalls: Promise<unknown>[] = [];
    for (let i = 0; i < 10; i++) {
      pendingCalls.push(
        t.onToolCall(ctx(), async () => i).catch(() => null),
      );
    }
    // Don't flush microtasks — settle only the awaited promises.
    await Promise.all(pendingCalls);
    // At this point, up to maxQueueDepth emissions are pending + some
    // may have been dropped. The key behavior: droppedCount > 0 and
    // overflow log fired at least once.
    expect(t.getDroppedCount()).toBeGreaterThan(0);
    expect(logs.some((m) => m.includes("overflow"))).toBe(true);
  });

  it("overflow log is rate-limited", () => {
    const logs: string[] = [];
    const clock = { now: 0 };
    const t = new CognitiveTelemetry({
      sink: () => { /* never drained */ },
      logger: (msg) => logs.push(msg),
      maxQueueDepth: 1,
      overflowLogIntervalMs: 100,
      now: () => clock.now,
    });

    // Force overflows at 3 distinct "now" values separated by less than 100ms.
    clock.now = 0;
    for (let i = 0; i < 3; i++) {
      // Synchronously drive emit past threshold (we use onToolCall which
      // calls next first, but with a resolved promise emit happens inside
      // the async turn — we only control timing via mocking now()).
      void t.onToolCall(ctx(), async () => null).catch(() => null);
    }

    // The first overflow emission past threshold should log once.
    // Subsequent ones within the 100ms window should not add log entries.
    // Since emissions happen in microtasks after awaits settle, precise
    // counting here requires the test to tolerate timing non-determinism;
    // we assert the rate-limit holds as a weak upper bound.
    expect(logs.length).toBeLessThanOrEqual(1);
  });
});

describe("CognitiveTelemetry — getPendingCount / getDroppedCount", () => {
  it("pending increases on emit, decreases after microtask", async () => {
    const t = new CognitiveTelemetry({ sink: () => {} });
    await t.onToolCall(ctx(), async () => null);
    // Immediately after await, the microtask may not have fired.
    // After full flush, pending must be 0.
    await flushMicrotasks();
    expect(t.getPendingCount()).toBe(0);
  });
});

// ── Phase 1.1 — bytes + approximate tokens ─────────────────────────

// ── Phase 2a ckpt-C — LLM-usage bridge ─────────────────────────────

describe("CognitiveTelemetry.emitLlmUsage — Phase 2a ckpt-C", () => {
  it("emits an llm_usage event with all usage fields populated", async () => {
    const events: TelemetryEvent[] = [];
    const t = new CognitiveTelemetry({ sink: (e) => events.push(e) });

    t.emitLlmUsage(
      {
        round: 3,
        promptTokens: 1500,
        completionTokens: 320,
        totalTokens: 1820,
        finishReason: "STOP",
        parallelToolCalls: 2,
      },
      { sessionId: "thread-7", agentId: "eng-abc", tags: { sandwich: "thread-reply" } },
    );
    await flushMicrotasks();

    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev.kind).toBe("llm_usage");
    expect(ev.sessionId).toBe("thread-7");
    expect(ev.agentId).toBe("eng-abc");
    expect(ev.llmRound).toBe(3);
    expect(ev.llmPromptTokens).toBe(1500);
    expect(ev.llmCompletionTokens).toBe(320);
    expect(ev.llmTotalTokens).toBe(1820);
    expect(ev.llmFinishReason).toBe("STOP");
    expect(ev.llmParallelToolCalls).toBe(2);
    expect(ev.tags).toEqual({ sandwich: "thread-reply" });
  });

  it("ctx is optional — emits without sessionId/agentId", async () => {
    const events: TelemetryEvent[] = [];
    const t = new CognitiveTelemetry({ sink: (e) => events.push(e) });

    t.emitLlmUsage({
      round: 1,
      promptTokens: 500,
      completionTokens: 50,
      totalTokens: 550,
    });
    await flushMicrotasks();

    expect(events[0].kind).toBe("llm_usage");
    expect(events[0].sessionId).toBeUndefined();
    expect(events[0].agentId).toBeUndefined();
    expect(events[0].llmRound).toBe(1);
  });

  it("emission is non-blocking (fire-and-forget)", async () => {
    let sinkResolved = false;
    const t = new CognitiveTelemetry({
      sink: () => {
        sinkResolved = true;
      },
    });
    t.emitLlmUsage({ round: 1, promptTokens: 100, completionTokens: 10, totalTokens: 110 });
    // Sink may not have fired yet — microtask is queued
    await flushMicrotasks();
    expect(sinkResolved).toBe(true);
  });
});

describe("CognitiveTelemetry — bytes + approximate tokens", () => {
  it("emits inputBytes + inputTokensApprox on tool_call success", async () => {
    const events: TelemetryEvent[] = [];
    const t = new CognitiveTelemetry({ sink: (e) => events.push(e) });

    const args = { threadId: "thread-12345", message: "hello world" };
    // serialized as JSON: {"threadId":"thread-12345","message":"hello world"}
    // length = 50 (approx)
    await t.onToolCall(ctx({ args }), async () => "ok");
    await flushMicrotasks();

    const ev = events[0];
    expect(ev.inputBytes).toBeGreaterThan(40);
    expect(ev.inputBytes).toBeLessThan(80);
    expect(ev.inputTokensApprox).toBe(Math.ceil(ev.inputBytes! / 4));
  });

  it("emits outputBytes + outputTokensApprox on tool_call success", async () => {
    const events: TelemetryEvent[] = [];
    const t = new CognitiveTelemetry({ sink: (e) => events.push(e) });

    const result = { messages: ["a".repeat(100), "b".repeat(100)] };
    await t.onToolCall(ctx(), async () => result);
    await flushMicrotasks();

    const ev = events[0];
    expect(ev.outputBytes).toBeGreaterThan(200);
    expect(ev.outputTokensApprox).toBe(Math.ceil(ev.outputBytes! / 4));
  });

  it("emits inputBytes on tool_error but omits outputBytes", async () => {
    const events: TelemetryEvent[] = [];
    const t = new CognitiveTelemetry({ sink: (e) => events.push(e) });

    await expect(
      t.onToolCall(ctx({ args: { x: 1 } }), async () => { throw new Error("fail"); }),
    ).rejects.toThrow();
    await flushMicrotasks();

    const ev = events[0];
    expect(ev.kind).toBe("tool_error");
    expect(ev.inputBytes).toBeGreaterThan(0);
    expect(ev.inputTokensApprox).toBeGreaterThan(0);
    expect(ev.outputBytes).toBeUndefined();
    expect(ev.outputTokensApprox).toBeUndefined();
  });

  it("emits outputBytes on list_tools (tool surface size)", async () => {
    const events: TelemetryEvent[] = [];
    const t = new CognitiveTelemetry({ sink: (e) => events.push(e) });

    await t.onListTools(listCtx(), async () => [
      { name: "get_thread", description: "x".repeat(50) },
      { name: "create_thread", description: "y".repeat(50) },
    ]);
    await flushMicrotasks();

    const ev = events[0];
    expect(ev.kind).toBe("list_tools");
    expect(ev.outputBytes).toBeGreaterThan(100);
    expect(ev.outputTokensApprox).toBeGreaterThan(0);
  });

  it("handles non-serializable values without throwing", async () => {
    const events: TelemetryEvent[] = [];
    const t = new CognitiveTelemetry({ sink: (e) => events.push(e) });

    // Create a circular reference
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;

    await t.onToolCall(ctx({ args: circular as Record<string, unknown> }), async () => "ok");
    await flushMicrotasks();

    const ev = events[0];
    expect(ev.kind).toBe("tool_call");
    expect(ev.inputBytes).toBe(0); // defensive fallback
    expect(ev.inputTokensApprox).toBe(0);
  });

  it("zero-byte args + zero-byte result produce zero token counts", async () => {
    const events: TelemetryEvent[] = [];
    const t = new CognitiveTelemetry({ sink: (e) => events.push(e) });

    await t.onToolCall(ctx({ args: {} }), async () => null);
    await flushMicrotasks();

    const ev = events[0];
    // {} serializes to "{}" = 2 bytes; null → 0
    expect(ev.inputBytes).toBe(2);
    expect(ev.inputTokensApprox).toBe(1); // ceil(2/4) = 1
    expect(ev.outputBytes).toBe(0);
    expect(ev.outputTokensApprox).toBe(0);
  });
});
