/**
 * bug-53 — assertHostWiringComplete + PollBackstop firstTimerEnabled tests.
 *
 * These tests pin the §6.4-equivalent boot-time gate that prevents bug-53
 * class regressions (host adapters silently shipping without pollBackstop
 * opt-in, causing lastHeartbeatAt to freeze indefinitely).
 *
 * Coverage:
 *   - assertHostWiringComplete throws when pollBackstop is undefined and
 *     no TRANSPORT_HEARTBEAT_ENABLED=false opt-out is set
 *   - assertHostWiringComplete returns silently when pollBackstop is set
 *   - assertHostWiringComplete logs + returns when explicit opt-out env is set
 *   - PollBackstop honors firstTimerEnabled=false (skip first timer; heartbeat-
 *     only mode for SSE-driven hosts)
 *   - PollBackstop default firstTimerEnabled=true (backwards-compat)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { assertHostWiringComplete } from "../../src/tool-manager/orchestrator/dispatcher.js";
import { PollBackstop } from "../../src/kernel/poll-backstop.js";

describe("bug-53 — assertHostWiringComplete", () => {
  const originalEnv = process.env.TRANSPORT_HEARTBEAT_ENABLED;

  beforeEach(() => {
    delete process.env.TRANSPORT_HEARTBEAT_ENABLED;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.TRANSPORT_HEARTBEAT_ENABLED;
    else process.env.TRANSPORT_HEARTBEAT_ENABLED = originalEnv;
  });

  it("throws when pollBackstop is undefined and no opt-out is set (boot-time fail-fast)", () => {
    const dispatcher = { pollBackstop: undefined };
    const log = vi.fn();
    expect(() => assertHostWiringComplete(dispatcher, log)).toThrow(
      /HOST WIRING ERROR/,
    );
  });

  it("error message references bug-53 closure + mission-75 §3.3 + opt-out path", () => {
    const dispatcher = { pollBackstop: undefined };
    let thrown: Error | null = null;
    try {
      assertHostWiringComplete(dispatcher);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.message).toContain("Transport heartbeat will not fire");
    expect(thrown!.message).toContain("bug-53 closure");
    expect(thrown!.message).toContain("TRANSPORT_HEARTBEAT_ENABLED=false");
  });

  it("returns silently when pollBackstop is set (wiring complete)", () => {
    const fakeBackstop = {} as PollBackstop;
    const dispatcher = { pollBackstop: fakeBackstop };
    const log = vi.fn();
    expect(() => assertHostWiringComplete(dispatcher, log)).not.toThrow();
    // No log emitted on the happy path.
    expect(log).not.toHaveBeenCalled();
  });

  it("returns + logs info when TRANSPORT_HEARTBEAT_ENABLED=false (explicit opt-out)", () => {
    process.env.TRANSPORT_HEARTBEAT_ENABLED = "false";
    const dispatcher = { pollBackstop: undefined };
    const log = vi.fn();
    expect(() => assertHostWiringComplete(dispatcher, log)).not.toThrow();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("intentionally disabled"),
    );
  });

  it("does not opt out for unrecognized TRANSPORT_HEARTBEAT_ENABLED values (only literal 'false' opts out)", () => {
    process.env.TRANSPORT_HEARTBEAT_ENABLED = "no";
    const dispatcher = { pollBackstop: undefined };
    expect(() => assertHostWiringComplete(dispatcher)).toThrow(
      /HOST WIRING ERROR/,
    );
  });
});

describe("bug-53 — PollBackstop firstTimerEnabled (heartbeat-only mode for SSE-driven hosts)", () => {
  // We test by inspecting the timer fields after start(); the actual MCP
  // calls aren't fired because no real getAgent is supplied (returns null →
  // tick early-returns). This is sufficient to verify timer scheduling.

  it("schedules BOTH timers when firstTimerEnabled is omitted (default true; backwards-compat)", () => {
    const backstop = new PollBackstop({
      role: "engineer",
      onPolledMessage: () => {},
      heartbeatEnabled: true,
      heartbeatIntervalMs: 30_000,
    });
    backstop.start(() => null);
    // Inspect private fields via cast — both timers should be set.
    const internal = backstop as unknown as {
      timer: NodeJS.Timeout | null;
      heartbeatTimer: NodeJS.Timeout | null;
    };
    expect(internal.timer).not.toBeNull();
    expect(internal.heartbeatTimer).not.toBeNull();
    backstop.stop();
  });

  it("skips first timer when firstTimerEnabled=false (heartbeat-only mode)", () => {
    const backstop = new PollBackstop({
      role: "engineer",
      firstTimerEnabled: false,
      heartbeatEnabled: true,
      heartbeatIntervalMs: 30_000,
    });
    backstop.start(() => null);
    const internal = backstop as unknown as {
      timer: NodeJS.Timeout | null;
      heartbeatTimer: NodeJS.Timeout | null;
    };
    // First timer NOT scheduled.
    expect(internal.timer).toBeNull();
    // Heartbeat timer IS scheduled.
    expect(internal.heartbeatTimer).not.toBeNull();
    backstop.stop();
  });

  it("skips both timers when both flags disabled (no-op start; idempotent)", () => {
    const backstop = new PollBackstop({
      role: "engineer",
      firstTimerEnabled: false,
      heartbeatEnabled: false,
    });
    backstop.start(() => null);
    const internal = backstop as unknown as {
      timer: NodeJS.Timeout | null;
      heartbeatTimer: NodeJS.Timeout | null;
    };
    expect(internal.timer).toBeNull();
    expect(internal.heartbeatTimer).toBeNull();
    backstop.stop();
  });

  it("start() is idempotent across heartbeat-only invocations (bug-53 idempotency-guard fold)", () => {
    const backstop = new PollBackstop({
      role: "engineer",
      firstTimerEnabled: false,
      heartbeatEnabled: true,
      heartbeatIntervalMs: 30_000,
    });
    backstop.start(() => null);
    const internal = backstop as unknown as {
      heartbeatTimer: NodeJS.Timeout | null;
    };
    const firstHandle = internal.heartbeatTimer;
    expect(firstHandle).not.toBeNull();
    // Second start() call should NOT re-schedule (would leak the prior timer).
    backstop.start(() => null);
    expect(internal.heartbeatTimer).toBe(firstHandle);
    backstop.stop();
  });

  it("onPolledMessage is optional when firstTimerEnabled=false (heartbeat-only hosts don't need it)", () => {
    expect(() => {
      const backstop = new PollBackstop({
        role: "engineer",
        firstTimerEnabled: false,
        // No onPolledMessage supplied; constructor must not throw.
        heartbeatEnabled: true,
        heartbeatIntervalMs: 30_000,
      });
      backstop.start(() => null);
      backstop.stop();
    }).not.toThrow();
  });
});
