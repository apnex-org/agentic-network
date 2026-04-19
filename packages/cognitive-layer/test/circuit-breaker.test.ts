/**
 * CircuitBreaker unit tests.
 *
 * Pins the full CLOSED → OPEN → HALF_OPEN state machine, session
 * isolation, transport-fault classification, and INV-COG-6 (OPEN
 * non-retryable fail-fast).
 */

import { describe, it, expect, vi } from "vitest";
import {
  CircuitBreaker,
  HubUnavailableError,
  type CircuitStateChange,
} from "../src/middlewares/circuit-breaker.js";
import type { ToolCallContext } from "../src/contract.js";

function ctx(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    tool: "get_thread",
    args: {},
    sessionId: "sess-A",
    startedAt: 0,
    tags: {},
    ...overrides,
  };
}

function makeClock(initial = 1_000_000) {
  const state = { now: initial };
  return { state, read: () => state.now };
}

function transportError(msg = "fetch failed"): Error {
  return new Error(msg);
}

describe("CircuitBreaker — CLOSED state", () => {
  it("passes through successes without state change", async () => {
    const changes: CircuitStateChange[] = [];
    const cb = new CircuitBreaker({ onStateChange: (c) => changes.push(c) });

    const result = await cb.onToolCall(ctx(), async () => "ok");
    expect(result).toBe("ok");
    expect(cb.getScopeStatus("sess-A")).toBe("CLOSED");
    expect(changes).toHaveLength(0);
  });

  it("ignores non-transport errors — does not count toward threshold", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2 });

    // Fire 5 application-level (Zod) errors: must NOT trip
    for (let i = 0; i < 5; i++) {
      await expect(
        cb.onToolCall(ctx(), async () => {
          throw new Error("Zod validation failed: expected string");
        }),
      ).rejects.toThrow("Zod validation failed");
    }
    expect(cb.getScopeStatus("sess-A")).toBe("CLOSED");
  });

  it("trips to OPEN after threshold transport faults in window", async () => {
    const clock = makeClock();
    const changes: CircuitStateChange[] = [];
    const cb = new CircuitBreaker({
      failureThreshold: 3,
      observationWindowMs: 10_000,
      cooldownMs: 5_000,
      onStateChange: (c) => changes.push(c),
      now: clock.read,
    });

    for (let i = 0; i < 3; i++) {
      await expect(
        cb.onToolCall(ctx(), async () => { throw transportError(); }),
      ).rejects.toThrow("fetch failed");
      clock.state.now += 100;
    }

    expect(cb.getScopeStatus("sess-A")).toBe("OPEN");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      scope: "sess-A",
      from: "CLOSED",
      to: "OPEN",
    });
  });

  it("stale failures outside the rolling window are evicted", async () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({
      failureThreshold: 3,
      observationWindowMs: 5_000,
      cooldownMs: 30_000,
      now: clock.read,
    });

    // 2 failures at t=0, t=100
    for (let i = 0; i < 2; i++) {
      await expect(
        cb.onToolCall(ctx(), async () => { throw transportError(); }),
      ).rejects.toThrow();
      clock.state.now += 100;
    }

    // Jump past the observation window — stale failures should drop off
    clock.state.now += 10_000;

    // One more fault: should NOT trip since window is empty again
    await expect(
      cb.onToolCall(ctx(), async () => { throw transportError(); }),
    ).rejects.toThrow();
    expect(cb.getScopeStatus("sess-A")).toBe("CLOSED");
  });
});

describe("CircuitBreaker — OPEN state", () => {
  it("fails fast during cooldown without invoking next (INV-COG-6)", async () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 30_000,
      now: clock.read,
    });

    // Trip it
    for (let i = 0; i < 2; i++) {
      await expect(
        cb.onToolCall(ctx(), async () => { throw transportError(); }),
      ).rejects.toThrow();
    }
    expect(cb.getScopeStatus("sess-A")).toBe("OPEN");

    // Next call must fail-fast with HubUnavailableError, without invoking next
    const next = vi.fn();
    await expect(cb.onToolCall(ctx(), next)).rejects.toBeInstanceOf(HubUnavailableError);
    expect(next).not.toHaveBeenCalled();
  });

  it("HubUnavailableError carries retry-after and scope", async () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 15_000,
      now: clock.read,
    });

    await expect(
      cb.onToolCall(ctx(), async () => { throw transportError(); }),
    ).rejects.toThrow();

    try {
      await cb.onToolCall(ctx(), async () => "unreachable");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HubUnavailableError);
      const hub = err as HubUnavailableError;
      expect(hub.scope).toBe("sess-A");
      expect(hub.retryAfterMs).toBeGreaterThan(0);
      expect(hub.retryAfterMs).toBeLessThanOrEqual(15_000);
      expect(hub.message).toContain("sess-A");
    }
  });

  it("tags ToolCallContext with fast_fail_open on fast-fail", async () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 30_000,
      now: clock.read,
    });

    await expect(
      cb.onToolCall(ctx(), async () => { throw transportError(); }),
    ).rejects.toThrow();

    const tagged = ctx();
    await expect(cb.onToolCall(tagged, async () => "x")).rejects.toThrow();
    expect(tagged.tags.circuitBreaker).toBe("fast_fail_open");
  });
});

describe("CircuitBreaker — HALF_OPEN state", () => {
  it("transitions from OPEN → HALF_OPEN after cooldown elapses", async () => {
    const clock = makeClock();
    const changes: CircuitStateChange[] = [];
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 5_000,
      onStateChange: (c) => changes.push(c),
      now: clock.read,
    });

    await expect(
      cb.onToolCall(ctx(), async () => { throw transportError(); }),
    ).rejects.toThrow();
    expect(cb.getScopeStatus("sess-A")).toBe("OPEN");

    // Advance past cooldown
    clock.state.now += 6_000;

    // Next call should probe — admit and succeed → CLOSED
    await cb.onToolCall(ctx(), async () => "probe-ok");
    expect(cb.getScopeStatus("sess-A")).toBe("CLOSED");

    const transitions = changes.map((c) => `${c.from}→${c.to}`);
    expect(transitions).toEqual(["CLOSED→OPEN", "OPEN→HALF_OPEN", "HALF_OPEN→CLOSED"]);
  });

  it("HALF_OPEN probe failure re-opens with fresh cooldown", async () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 5_000,
      now: clock.read,
    });

    await expect(
      cb.onToolCall(ctx(), async () => { throw transportError(); }),
    ).rejects.toThrow();
    clock.state.now += 6_000;

    // Probe fails → back to OPEN
    await expect(
      cb.onToolCall(ctx(), async () => { throw transportError("500 internal"); }),
    ).rejects.toThrow();
    expect(cb.getScopeStatus("sess-A")).toBe("OPEN");

    // Another call within fresh cooldown fails fast
    const next = vi.fn();
    await expect(cb.onToolCall(ctx(), next)).rejects.toBeInstanceOf(HubUnavailableError);
    expect(next).not.toHaveBeenCalled();
  });

  it("blocks concurrent calls while probe in-flight", async () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 1_000,
      now: clock.read,
    });

    await expect(
      cb.onToolCall(ctx(), async () => { throw transportError(); }),
    ).rejects.toThrow();
    clock.state.now += 2_000;

    // Probe held open via manual resolver
    let resolveProbe: (value: string) => void = () => {};
    const probePromise = cb.onToolCall(ctx(), () => new Promise<string>((res) => {
      resolveProbe = res;
    }));

    // Concurrent call must fast-fail
    await expect(cb.onToolCall(ctx(), async () => "unreachable")).rejects.toBeInstanceOf(
      HubUnavailableError,
    );

    // Release the probe to unblock the test harness
    resolveProbe("ok");
    await probePromise;
    expect(cb.getScopeStatus("sess-A")).toBe("CLOSED");
  });
});

describe("CircuitBreaker — session isolation", () => {
  it("failures in session A do not trip session B", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 30_000 });

    // Trip session A
    for (let i = 0; i < 2; i++) {
      await expect(
        cb.onToolCall(ctx({ sessionId: "sess-A" }), async () => {
          throw transportError();
        }),
      ).rejects.toThrow();
    }
    expect(cb.getScopeStatus("sess-A")).toBe("OPEN");

    // Session B unaffected
    const result = await cb.onToolCall(ctx({ sessionId: "sess-B" }), async () => "b-ok");
    expect(result).toBe("b-ok");
    expect(cb.getScopeStatus("sess-B")).toBe("CLOSED");
  });
});

describe("CircuitBreaker — fault classification", () => {
  it("default transport-fault heuristic classifies common patterns", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 30_000 });
    const patterns = [
      "503 Service Unavailable",
      "504 gateway timeout",
      "ECONNREFUSED",
      "ECONNRESET",
      "ENOTFOUND",
      "fetch failed",
      "Request timed out after 30000ms",
    ];

    for (const msg of patterns) {
      const fresh = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 30_000 });
      await expect(
        fresh.onToolCall(ctx(), async () => { throw new Error(msg); }),
      ).rejects.toThrow();
      expect(fresh.getScopeStatus("sess-A")).toBe("OPEN");
    }

    // Spot-check: application errors DO NOT trip
    const appErrs = [
      "Zod validation failed",
      "Unknown tool: foo",
      "Thread not found",
      "401 Unauthorized",
      "400 Bad Request",
    ];
    for (const msg of appErrs) {
      const fresh = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 30_000 });
      await expect(
        fresh.onToolCall(ctx(), async () => { throw new Error(msg); }),
      ).rejects.toThrow();
      expect(fresh.getScopeStatus("sess-A")).toBe("CLOSED");
    }
  });

  it("custom isTransportFault predicate overrides default", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 30_000,
      isTransportFault: (err) => err instanceof Error && err.message === "custom-fault",
    });

    // Default would NOT classify this as transport
    await expect(
      cb.onToolCall(ctx(), async () => { throw new Error("custom-fault"); }),
    ).rejects.toThrow();
    expect(cb.getScopeStatus("sess-A")).toBe("OPEN");
  });
});

describe("CircuitBreaker — state-change sink", () => {
  it("emits every transition synchronously with from/to/reason", async () => {
    const clock = makeClock();
    const changes: CircuitStateChange[] = [];
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 5_000,
      onStateChange: (c) => changes.push(c),
      now: clock.read,
    });

    await expect(
      cb.onToolCall(ctx(), async () => { throw transportError(); }),
    ).rejects.toThrow();
    clock.state.now += 6_000;
    await cb.onToolCall(ctx(), async () => "probe");

    expect(changes.map((c) => [c.from, c.to, c.reason])).toEqual([
      ["CLOSED", "OPEN", expect.stringContaining("threshold_1")],
      ["OPEN", "HALF_OPEN", "cooldown_elapsed"],
      ["HALF_OPEN", "CLOSED", "probe_succeeded"],
    ]);
  });

  it("sink exceptions are swallowed — pipeline is not disturbed", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 30_000,
      onStateChange: () => { throw new Error("sink failure"); },
    });

    // Trip — sink throws but circuit still transitions
    await expect(
      cb.onToolCall(ctx(), async () => { throw transportError(); }),
    ).rejects.toThrow("fetch failed");
    expect(cb.getScopeStatus("sess-A")).toBe("OPEN");
  });
});

describe("CircuitBreaker — .standard() integration", () => {
  it(".standard() composes CircuitBreaker after CognitiveTelemetry", async () => {
    const { CognitivePipeline } = await import("../src/pipeline.js");
    const p = CognitivePipeline.standard();
    const names = p.getMiddlewares().map((m) => m.name);
    // Assert relative ordering + presence rather than exact list, so
    // the test stays stable as subsequent checkpoints extend .standard().
    expect(names[0]).toBe("CognitiveTelemetry");
    expect(names.indexOf("CircuitBreaker")).toBe(1);
  });
});
