import { describe, it, expect, vi } from "vitest";
import { LivenessWatchdog } from "../../src/kernel/liveness-watchdog.js";

/**
 * L1.5 LivenessWatchdog unit tests (M-Adapter-Modernization P1c, Design §4).
 * Deterministic: drives `tick()` directly (no wall-clock timers).
 */
describe("LivenessWatchdog", () => {
  function make(probe: () => Promise<boolean>, failureBudget = 3) {
    const onLivenessLost = vi.fn();
    const wd = new LivenessWatchdog({
      probe,
      probeIntervalMs: 1000,
      failureBudget,
      onLivenessLost,
    });
    return { wd, onLivenessLost };
  }

  it("fires onLivenessLost exactly once after failureBudget consecutive failures", async () => {
    const { wd, onLivenessLost } = make(async () => false, 3);
    await wd.tick(); // 1
    await wd.tick(); // 2
    expect(onLivenessLost).not.toHaveBeenCalled(); // budget not yet reached
    await wd.tick(); // 3 -> fires
    expect(onLivenessLost).toHaveBeenCalledTimes(1);
    expect(onLivenessLost).toHaveBeenCalledWith({ consecutiveFailures: 3, lastError: undefined });
    expect(wd.hasFired).toBe(true);
  });

  it("BUDGET BOUNDARY (non-vacuous): does NOT fire at budget-1, fires exactly at budget", async () => {
    const { wd, onLivenessLost } = make(async () => false, 4);
    await wd.tick();
    await wd.tick();
    await wd.tick(); // 3 of 4
    expect(onLivenessLost).not.toHaveBeenCalled(); // would RED if the >= check were off-by-one
    await wd.tick(); // 4 of 4 -> fires
    expect(onLivenessLost).toHaveBeenCalledTimes(1);
  });

  it("resets the failure counter on a recovered probe (does NOT fight L1's self-heal)", async () => {
    let live = false;
    const { wd, onLivenessLost } = make(async () => live, 3);
    await wd.tick(); // fail 1
    await wd.tick(); // fail 2
    live = true;
    await wd.tick(); // success -> reset
    expect(wd.failures).toBe(0);
    live = false;
    await wd.tick(); // fail 1 again
    await wd.tick(); // fail 2
    expect(onLivenessLost).not.toHaveBeenCalled(); // never reached 3 consecutive
  });

  it("treats a REJECTING probe as a failure and captures lastError", async () => {
    const boom = new Error("Session not found");
    const { wd, onLivenessLost } = make(async () => {
      throw boom;
    }, 2);
    await wd.tick();
    await wd.tick();
    expect(onLivenessLost).toHaveBeenCalledTimes(1);
    expect(onLivenessLost.mock.calls[0][0].lastError).toBe(boom);
  });

  it("never double-fires and stops probing after firing", async () => {
    const probe = vi.fn(async () => false);
    const onLivenessLost = vi.fn();
    const wd = new LivenessWatchdog({ probe, probeIntervalMs: 1000, failureBudget: 1, onLivenessLost });
    await wd.tick(); // fires immediately (budget 1)
    const callsAfterFire = probe.mock.calls.length;
    await wd.tick(); // no-op (already fired)
    await wd.tick(); // no-op
    expect(onLivenessLost).toHaveBeenCalledTimes(1);
    expect(probe.mock.calls.length).toBe(callsAfterFire); // no further probing
  });

  it("rejects invalid construction params", () => {
    expect(() => new LivenessWatchdog({ probe: async () => true, probeIntervalMs: 0, failureBudget: 1, onLivenessLost: () => {} })).toThrow();
    expect(() => new LivenessWatchdog({ probe: async () => true, probeIntervalMs: 1000, failureBudget: 0, onLivenessLost: () => {} })).toThrow();
  });
});
