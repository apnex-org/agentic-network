import { describe, it, expect } from "vitest";
import {
  emitLivenessLostSignal,
  resolveSentinelPath,
  WEDGED_RESTART_EXIT_CODE,
  DEFAULT_LIVENESS_SENTINEL,
} from "../../src/kernel/liveness-signal.js";

/**
 * Liveness-lost signal-contract (the kernel->supervisor seam) tests.
 * P1c EMITS the sentinel; P1e's PID-1 supervisor consumes it. (Design §4 P1c.)
 */
describe("liveness-signal (kernel->supervisor seam)", () => {
  it("writes the wedged-restart sentinel with the contract payload + distinct exit code", () => {
    const writes: Array<{ path: string; data: string }> = [];
    const payload = emitLivenessLostSignal({
      sentinelPath: "/tmp/x-wedged",
      consecutiveFailures: 3,
      lastError: new Error("Session not found"),
      now: () => "2026-06-29T23:00:00Z",
      writeFile: (path, data) => writes.push({ path, data }),
    });
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe("/tmp/x-wedged");
    const written = JSON.parse(writes[0].data);
    expect(written.reason).toBe("session-wedged");
    expect(written.exitCode).toBe(WEDGED_RESTART_EXIT_CODE); // 75 / EX_TEMPFAIL — the CONTAINER exit code, not the shim's
    expect(written.consecutiveFailures).toBe(3);
    expect(String(written.lastError)).toContain("Session not found");
    expect(written.emittedAt).toBe("2026-06-29T23:00:00Z");
    expect(typeof written.pid).toBe("number");
    expect(payload.exitCode).toBe(75);
  });

  it("resolves the sentinel path: explicit > env > default", () => {
    const prev = process.env.OIS_LIVENESS_SENTINEL;
    delete process.env.OIS_LIVENESS_SENTINEL;
    expect(resolveSentinelPath("/explicit")).toBe("/explicit");
    expect(resolveSentinelPath()).toBe(DEFAULT_LIVENESS_SENTINEL);
    process.env.OIS_LIVENESS_SENTINEL = "/env-path";
    expect(resolveSentinelPath()).toBe("/env-path");
    expect(resolveSentinelPath("/explicit")).toBe("/explicit"); // explicit still wins
    if (prev === undefined) delete process.env.OIS_LIVENESS_SENTINEL;
    else process.env.OIS_LIVENESS_SENTINEL = prev;
  });

  it("never throws out on a write failure (self-exit must still proceed; L3 is the backstop)", () => {
    const logs: string[] = [];
    const payload = emitLivenessLostSignal({
      consecutiveFailures: 2,
      sentinelPath: "/tmp/y",
      writeFile: () => {
        throw new Error("EACCES");
      },
      log: (m) => logs.push(m),
    });
    expect(payload.reason).toBe("session-wedged");
    expect(logs.some((l) => l.includes("FAILED to write sentinel"))).toBe(true);
  });
});
