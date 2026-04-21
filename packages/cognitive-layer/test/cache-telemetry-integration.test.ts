/**
 * M-Hypervisor-Adapter-Mitigations Task 2 (task-311) — end-to-end
 * validation of the thread-state cache + write-action invalidation
 * contract, wiring CognitiveTelemetry + ToolResultCache through a
 * real CognitivePipeline.
 *
 * The observable promise of Task 2:
 *   1. get_thread cached → subsequent get_thread with identical
 *      args short-circuits (cache hit).
 *   2. create_thread_reply (write) invalidates the session's cache
 *      BEFORE its own execution.
 *   3. get_thread after the write is a miss (cache cleared).
 *   4. Each stage is observable via the first-class `cacheHit` /
 *      `cacheFlushed` fields on the tool_call telemetry events —
 *      no string-parsing of `tags` required.
 */

import { describe, it, expect } from "vitest";
import { CognitivePipeline } from "../src/pipeline.js";
import type { TelemetryEvent } from "../src/middlewares/telemetry.js";
import type { ToolCallContext } from "../src/contract.js";

async function flushMicrotasks(iterations = 3): Promise<void> {
  for (let i = 0; i < iterations; i++) await Promise.resolve();
}

function ctx(tool: string, args: Record<string, unknown>, sessionId = "sess-1"): ToolCallContext {
  return {
    tool,
    args,
    sessionId,
    startedAt: Date.now(),
    tags: {},
  };
}

describe("Task 2 — cache + invalidation observability", () => {
  it("end-to-end: get_thread hit/miss + create_thread_reply flushes", async () => {
    const events: TelemetryEvent[] = [];
    const pipeline = CognitivePipeline.standard({
      telemetry: { sink: (e) => events.push(e) },
      toolResultCache: { ttlMs: 30_000 },
    });

    const threadResponse = { id: "thread-1", title: "T", status: "active" };
    let getThreadInvocations = 0;
    const terminal = async (c: ToolCallContext) => {
      if (c.tool === "get_thread") {
        getThreadInvocations++;
        return threadResponse;
      }
      if (c.tool === "create_thread_reply") return { success: true };
      return null;
    };

    // Call 1 — cold miss, caches.
    await pipeline.runToolCall(ctx("get_thread", { threadId: "thread-1" }), terminal);
    // Call 2 — warm hit; terminal should not run again.
    await pipeline.runToolCall(ctx("get_thread", { threadId: "thread-1" }), terminal);
    // Call 3 — write, flushes the session cache.
    await pipeline.runToolCall(ctx("create_thread_reply", { threadId: "thread-1", message: "ok" }), terminal);
    // Call 4 — post-flush get_thread, cold miss again; terminal runs.
    await pipeline.runToolCall(ctx("get_thread", { threadId: "thread-1" }), terminal);
    await flushMicrotasks();

    // Terminal ran 2x for get_thread (calls 1 + 4), not 3x — call 2 was a cache hit.
    expect(getThreadInvocations).toBe(2);

    // Events emitted in order: 4 tool_call events.
    const toolCalls = events.filter((e) => e.kind === "tool_call");
    expect(toolCalls).toHaveLength(4);

    // Call 1 — cold miss.
    expect(toolCalls[0].tool).toBe("get_thread");
    expect(toolCalls[0].cacheHit).toBe(false);
    expect(toolCalls[0].cacheFlushed).toBeUndefined();

    // Call 2 — warm hit.
    expect(toolCalls[1].tool).toBe("get_thread");
    expect(toolCalls[1].cacheHit).toBe(true);
    expect(toolCalls[1].cacheFlushed).toBeUndefined();

    // Call 3 — write triggers flush (cacheFlushed=true); not cacheable itself (no cacheHit).
    expect(toolCalls[2].tool).toBe("create_thread_reply");
    expect(toolCalls[2].cacheFlushed).toBe(true);
    expect(toolCalls[2].cacheHit).toBeUndefined();

    // Call 4 — post-flush cold miss.
    expect(toolCalls[3].tool).toBe("get_thread");
    expect(toolCalls[3].cacheHit).toBe(false);
  });

  it("create_thread_reply on an EMPTY session cache does not emit cacheFlushed", async () => {
    // cacheFlushed must measure REAL invalidation frequency, not the count of
    // every write call. If the session cache is empty, nothing was flushed.
    const events: TelemetryEvent[] = [];
    const pipeline = CognitivePipeline.standard({
      telemetry: { sink: (e) => events.push(e) },
      toolResultCache: { ttlMs: 30_000 },
    });
    const terminal = async () => ({ success: true });

    await pipeline.runToolCall(ctx("create_thread_reply", { threadId: "thread-1", message: "cold" }), terminal);
    await flushMicrotasks();

    const write = events.find((e) => e.kind === "tool_call" && e.tool === "create_thread_reply");
    expect(write).toBeDefined();
    expect(write!.cacheFlushed).toBeUndefined();
  });

  it("non-cacheable non-write tools (e.g. unknown tool) emit neither cacheHit nor cacheFlushed", async () => {
    const events: TelemetryEvent[] = [];
    const pipeline = CognitivePipeline.standard({
      telemetry: { sink: (e) => events.push(e) },
      toolResultCache: { ttlMs: 30_000 },
    });
    const terminal = async () => ({ ok: true });

    await pipeline.runToolCall(ctx("weird_tool_name", {}), terminal);
    await flushMicrotasks();

    const call = events.find((e) => e.kind === "tool_call" && e.tool === "weird_tool_name");
    expect(call).toBeDefined();
    expect(call!.cacheHit).toBeUndefined();
    expect(call!.cacheFlushed).toBeUndefined();
  });

  it("TTL expiry: a cached value becomes a miss after the TTL elapses", async () => {
    let clock = 0;
    const events: TelemetryEvent[] = [];
    const pipeline = CognitivePipeline.standard({
      telemetry: { sink: (e) => events.push(e), now: () => clock },
      toolResultCache: { ttlMs: 100, now: () => clock },
    });
    let invocations = 0;
    const terminal = async () => {
      invocations++;
      return { ok: true, n: invocations };
    };

    await pipeline.runToolCall(ctx("get_thread", { threadId: "thread-1" }), terminal);
    clock += 50;
    await pipeline.runToolCall(ctx("get_thread", { threadId: "thread-1" }), terminal); // hit (within TTL)
    clock += 60;
    await pipeline.runToolCall(ctx("get_thread", { threadId: "thread-1" }), terminal); // miss (TTL elapsed)
    await flushMicrotasks();

    expect(invocations).toBe(2);
    const getEvents = events.filter((e) => e.kind === "tool_call" && e.tool === "get_thread");
    expect(getEvents).toHaveLength(3);
    expect(getEvents[0].cacheHit).toBe(false);
    expect(getEvents[1].cacheHit).toBe(true);
    expect(getEvents[2].cacheHit).toBe(false);
  });

  it("per-session isolation: session A's write does NOT flush session B's cache (INV-COG-7)", async () => {
    const events: TelemetryEvent[] = [];
    const pipeline = CognitivePipeline.standard({
      telemetry: { sink: (e) => events.push(e) },
      toolResultCache: { ttlMs: 30_000 },
    });
    let invocations = 0;
    const terminal = async () => {
      invocations++;
      return { ok: true };
    };

    // Seed cache for session-a.
    await pipeline.runToolCall(ctx("get_thread", { threadId: "thread-1" }, "sess-a"), terminal);
    // Session-b writes — should NOT affect session-a's cache.
    await pipeline.runToolCall(ctx("create_thread_reply", { threadId: "thread-1" }, "sess-b"), terminal);
    // Session-a reads again — still a hit.
    await pipeline.runToolCall(ctx("get_thread", { threadId: "thread-1" }, "sess-a"), terminal);
    await flushMicrotasks();

    // Two non-cached-path invocations: seed-read + cross-session write. Second
    // session-a read should be a cache hit (terminal NOT called for it).
    expect(invocations).toBe(2);
    const sessAEvents = events.filter((e) => e.kind === "tool_call" && e.sessionId === "sess-a");
    expect(sessAEvents).toHaveLength(2);
    expect(sessAEvents[0].cacheHit).toBe(false);
    expect(sessAEvents[1].cacheHit).toBe(true);
  });
});
