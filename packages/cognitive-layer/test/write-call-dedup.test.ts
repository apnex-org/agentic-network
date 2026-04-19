/**
 * WriteCallDedup unit tests.
 *
 * Pins: Promise-based idempotency per {tool, args-hash, sessionId};
 * IN-FLIGHT → SETTLED → EXPIRED state machine; INV-COG-5 (distinct
 * from cache); INV-COG-8 (TTL starts at settlement); read-tool
 * pass-through; session isolation; argument-hash distinctness;
 * maxInflightMs timeout on duplicate only.
 */

import { describe, it, expect, vi } from "vitest";
import {
  WriteCallDedup,
  DedupTimeoutError,
} from "../src/middlewares/write-call-dedup.js";
import type { ToolCallContext } from "../src/contract.js";

function ctx(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    tool: "create_thread",
    args: { title: "t", message: "m" },
    sessionId: "sess-A",
    startedAt: 0,
    tags: {},
    ...overrides,
  };
}

/** Minimal manual-scheduled timer for tests. */
class FakeTimers {
  private readonly jobs = new Map<symbol, { cb: () => void; at: number }>();
  private nowMs = 0;
  now = () => this.nowMs;
  setTimer = (cb: () => void, ms: number): unknown => {
    const handle = Symbol("timer");
    this.jobs.set(handle, { cb, at: this.nowMs + ms });
    return handle;
  };
  clearTimer = (handle: unknown): void => {
    this.jobs.delete(handle as symbol);
  };
  advance(ms: number): void {
    this.nowMs += ms;
    for (const [h, job] of [...this.jobs.entries()]) {
      if (job.at <= this.nowMs) {
        this.jobs.delete(h);
        job.cb();
      }
    }
  }
}

describe("WriteCallDedup — read-tool pass-through", () => {
  it("does not intercept get_* tools", async () => {
    const dedup = new WriteCallDedup();
    const next = vi.fn().mockResolvedValue("ok");
    await dedup.onToolCall(ctx({ tool: "get_thread", args: { threadId: "t" } }), next);
    await dedup.onToolCall(ctx({ tool: "get_thread", args: { threadId: "t" } }), next);
    expect(next).toHaveBeenCalledTimes(2); // both passthrough, no dedup
  });

  it("does not intercept list_* tools", async () => {
    const dedup = new WriteCallDedup();
    const next = vi.fn().mockResolvedValue("ok");
    await dedup.onToolCall(ctx({ tool: "list_ideas", args: {} }), next);
    await dedup.onToolCall(ctx({ tool: "list_ideas", args: {} }), next);
    expect(next).toHaveBeenCalledTimes(2);
  });
});

describe("WriteCallDedup — IN-FLIGHT dedup", () => {
  it("duplicate in-flight call awaits the SAME Promise; Hub called once", async () => {
    const hubCalls = vi.fn();
    let resolveFirst: (v: unknown) => void = () => {};
    const next = (c: ToolCallContext) => {
      hubCalls(c);
      return new Promise<unknown>((res) => {
        if (!resolveFirst || resolveFirst.toString() === "() => {}") {
          resolveFirst = res;
        } else {
          res("should-not-happen");
        }
      });
    };

    const dedup = new WriteCallDedup();
    const a = dedup.onToolCall(ctx(), next);
    const b = dedup.onToolCall(ctx(), next);

    // Wait a tick so both start queuing
    await Promise.resolve();

    // Only one next() call despite two onToolCall invocations
    expect(hubCalls).toHaveBeenCalledTimes(1);

    // Settle the in-flight original
    resolveFirst("hub-result");
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe("hub-result");
    expect(rb).toBe("hub-result");
  });

  it("duplicate receives same rejection when original fails", async () => {
    const next = vi.fn().mockRejectedValue(new Error("hub failed"));
    const dedup = new WriteCallDedup();
    const a = dedup.onToolCall(ctx(), next);
    const b = dedup.onToolCall(ctx(), next);

    await expect(a).rejects.toThrow("hub failed");
    await expect(b).rejects.toThrow("hub failed");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("tags ctx.tags.dedup appropriately per caller", async () => {
    const dedup = new WriteCallDedup();
    let resolveFirst: (v: unknown) => void = () => {};
    const next = () => new Promise<unknown>((res) => { resolveFirst = res; });

    const first = ctx();
    const second = ctx();
    const pFirst = dedup.onToolCall(first, next);
    const pSecond = dedup.onToolCall(second, () => { throw new Error("should not execute"); });

    await Promise.resolve();
    expect(first.tags.dedup).toBe("first");
    expect(second.tags.dedup).toBe("in_flight");

    resolveFirst("done");
    await Promise.all([pFirst, pSecond]);
  });
});

describe("WriteCallDedup — SETTLED replay", () => {
  it("replays cached result within window", async () => {
    const timers = new FakeTimers();
    const next = vi.fn().mockResolvedValue("original-result");
    const dedup = new WriteCallDedup({
      windowMs: 5_000,
      now: timers.now,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    const first = await dedup.onToolCall(ctx(), next);
    expect(first).toBe("original-result");
    expect(next).toHaveBeenCalledTimes(1);

    // Second call within window — replayed
    const replayed = await dedup.onToolCall(ctx(), next);
    expect(replayed).toBe("original-result");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("evicts after windowMs elapses — third call hits Hub again (INV-COG-8)", async () => {
    const timers = new FakeTimers();
    const next = vi.fn().mockImplementation(() => Promise.resolve("x"));
    const dedup = new WriteCallDedup({
      windowMs: 5_000,
      now: timers.now,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    await dedup.onToolCall(ctx(), next);
    // Advance past window
    timers.advance(5_001);
    await dedup.onToolCall(ctx(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("replayed rejection keeps same error", async () => {
    const next = vi.fn().mockRejectedValue(new Error("boom"));
    const dedup = new WriteCallDedup();

    await expect(dedup.onToolCall(ctx(), next)).rejects.toThrow("boom");
    await expect(dedup.onToolCall(ctx(), next)).rejects.toThrow("boom");
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("WriteCallDedup — key distinctness", () => {
  it("different args produce distinct dedup keys", async () => {
    const next = vi.fn().mockResolvedValue("ok");
    const dedup = new WriteCallDedup();
    await dedup.onToolCall(ctx({ args: { a: 1 } }), next);
    await dedup.onToolCall(ctx({ args: { a: 2 } }), next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("same args in different key order hash identically", async () => {
    const next = vi.fn().mockResolvedValue("ok");
    const dedup = new WriteCallDedup();
    await dedup.onToolCall(ctx({ args: { a: 1, b: 2 } }), next);
    await dedup.onToolCall(ctx({ args: { b: 2, a: 1 } }), next);
    expect(next).toHaveBeenCalledTimes(1); // deduped — same canonical hash
  });

  it("different sessions produce distinct dedup keys", async () => {
    const next = vi.fn().mockResolvedValue("ok");
    const dedup = new WriteCallDedup();
    await dedup.onToolCall(ctx({ sessionId: "sess-A" }), next);
    await dedup.onToolCall(ctx({ sessionId: "sess-B" }), next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("different tools produce distinct dedup keys", async () => {
    const next = vi.fn().mockResolvedValue("ok");
    const dedup = new WriteCallDedup();
    await dedup.onToolCall(ctx({ tool: "create_thread", args: { x: 1 } }), next);
    await dedup.onToolCall(ctx({ tool: "update_thread", args: { x: 1 } }), next);
    expect(next).toHaveBeenCalledTimes(2);
  });
});

describe("WriteCallDedup — maxInflightMs timeout", () => {
  it("duplicate receives DedupTimeoutError when in-flight exceeds maxInflightMs; original completes normally", async () => {
    const timers = new FakeTimers();
    let resolveOriginal: (v: unknown) => void = () => {};
    const next = vi.fn().mockImplementation(
      () => new Promise<unknown>((res) => { resolveOriginal = res; }),
    );

    const dedup = new WriteCallDedup({
      windowMs: 10_000,
      maxInflightMs: 1_000,
      now: timers.now,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    const originalP = dedup.onToolCall(ctx(), next);
    // Duplicate starts waiting
    const duplicateP = dedup.onToolCall(ctx(), () => { throw new Error("should not run"); });
    await Promise.resolve();

    // Advance past maxInflightMs: duplicate should time out
    timers.advance(1_001);

    await expect(duplicateP).rejects.toBeInstanceOf(DedupTimeoutError);

    // Now resolve the original — it must still succeed
    resolveOriginal("eventually-ok");
    await expect(originalP).resolves.toBe("eventually-ok");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("maxInflightMs=0 disables the timeout — duplicate waits forever", async () => {
    const dedup = new WriteCallDedup({ maxInflightMs: 0 });
    let resolve: (v: unknown) => void = () => {};
    const next = vi.fn().mockImplementation(
      () => new Promise<unknown>((res) => { resolve = res; }),
    );

    const a = dedup.onToolCall(ctx(), next);
    const b = dedup.onToolCall(ctx(), () => { throw new Error("x"); });

    await Promise.resolve();
    // Neither has resolved yet.
    let settled = 0;
    a.then(() => settled++);
    b.then(() => settled++);
    await Promise.resolve();
    expect(settled).toBe(0);

    resolve("ok");
    await Promise.all([a, b]);
  });
});

describe("WriteCallDedup — configurable predicates", () => {
  it("custom isWriteTool predicate overrides default", async () => {
    const next = vi.fn().mockResolvedValue("ok");
    const dedup = new WriteCallDedup({
      isWriteTool: (tool) => tool === "my_special_write",
    });

    // get_thread is read in default; with custom predicate, it's NOT a
    // write → pass-through even though duplicate
    await dedup.onToolCall(ctx({ tool: "get_thread", args: { id: 1 } }), next);
    await dedup.onToolCall(ctx({ tool: "get_thread", args: { id: 1 } }), next);
    expect(next).toHaveBeenCalledTimes(2);

    // my_special_write IS a write → deduped
    next.mockClear();
    await dedup.onToolCall(ctx({ tool: "my_special_write", args: { id: 2 } }), next);
    await dedup.onToolCall(ctx({ tool: "my_special_write", args: { id: 2 } }), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("custom keyFor enables idempotency-key semantics", async () => {
    const next = vi.fn().mockResolvedValue("ok");
    const dedup = new WriteCallDedup({
      keyFor: (c) =>
        typeof c.args.idempotencyKey === "string" ? c.args.idempotencyKey : "_default",
    });

    await dedup.onToolCall(
      ctx({ tool: "create_thread", args: { idempotencyKey: "abc", other: 1 } }),
      next,
    );
    // Same key, different other → deduped
    await dedup.onToolCall(
      ctx({ tool: "create_thread", args: { idempotencyKey: "abc", other: 2 } }),
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("WriteCallDedup — .standard() integration", () => {
  it(".standard() composes WriteCallDedup after CircuitBreaker", async () => {
    const { CognitivePipeline } = await import("../src/pipeline.js");
    const p = CognitivePipeline.standard();
    const names = p.getMiddlewares().map((m) => m.name);
    expect(names).toEqual(["CognitiveTelemetry", "CircuitBreaker", "WriteCallDedup"]);
  });
});
