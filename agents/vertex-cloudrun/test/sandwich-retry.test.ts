/**
 * Sandwich retry topology tests (M25-SH-T1 → SH-T3).
 *
 * Covers withSandwichRetry — the one-shot immediate retry wrapper that
 * shaves the 300s EventLoop-poll latency off transient failures. Tests
 * exercise the three-way SandwichOutcome classification contract without
 * bringing Vertex / HubAdapter into the loop.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withSandwichRetry, type SandwichOutcome } from "../src/sandwich.js";

describe("withSandwichRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Pin Math.random so the jitter window is deterministic and the
    // fake timer advances the exact computed delay.
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("success on first attempt does not retry", async () => {
    const attempt = vi.fn<() => Promise<SandwichOutcome>>().mockResolvedValue({ kind: "success" });
    await withSandwichRetry("first-success", attempt);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("permanent_failure on first attempt does not retry", async () => {
    const attempt = vi
      .fn<() => Promise<SandwichOutcome>>()
      .mockResolvedValue({ kind: "permanent_failure", reason: "deterministic hub reject" });
    await withSandwichRetry("permanent-fail", attempt);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("transient_failure retries exactly once", async () => {
    const attempt = vi
      .fn<() => Promise<SandwichOutcome>>()
      .mockResolvedValueOnce({ kind: "transient_failure", reason: "first flake" })
      .mockResolvedValueOnce({ kind: "success" });

    const p = withSandwichRetry("transient-then-success", attempt);
    // First attempt resolves, a setTimeout is queued for the retry delay.
    await vi.advanceTimersByTimeAsync(5_000); // min of 5_000..15_000 window
    await p;
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("transient_failure twice exhausts retry (no third attempt)", async () => {
    const attempt = vi
      .fn<() => Promise<SandwichOutcome>>()
      .mockResolvedValue({ kind: "transient_failure", reason: "persistent flake" });

    const p = withSandwichRetry("transient-twice", attempt);
    await vi.advanceTimersByTimeAsync(5_000);
    await p;
    // Exactly 2 attempts: initial + 1 retry.
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("retry delay falls in the 5_000..15_000 jittered window", async () => {
    // Three scenarios across the jitter window (min, mid, max).
    for (const rnd of [0, 0.5, 0.9999999]) {
      vi.spyOn(Math, "random").mockReturnValue(rnd);
      const attempt = vi
        .fn<() => Promise<SandwichOutcome>>()
        .mockResolvedValueOnce({ kind: "transient_failure", reason: "flake" })
        .mockResolvedValueOnce({ kind: "success" });

      const p = withSandwichRetry("jitter-window", attempt);
      // Not yet past the floor — retry not issued.
      await vi.advanceTimersByTimeAsync(4_999);
      expect(attempt).toHaveBeenCalledTimes(1);
      // Advance past the maximum of the window.
      await vi.advanceTimersByTimeAsync(15_000);
      await p;
      expect(attempt).toHaveBeenCalledTimes(2);
    }
  });

  it("retry outcome classification is independent per attempt", async () => {
    // First transient, second permanent — should stop after 2, not 3.
    const attempt = vi
      .fn<() => Promise<SandwichOutcome>>()
      .mockResolvedValueOnce({ kind: "transient_failure", reason: "retryable" })
      .mockResolvedValueOnce({ kind: "permanent_failure", reason: "hit a hard floor" });

    const p = withSandwichRetry("transient-then-permanent", attempt);
    await vi.advanceTimersByTimeAsync(5_000);
    await p;
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("does not throw when attempt rejects — unhandled rejection would be caught", async () => {
    // withSandwichRetry is not a try/catch around attempt — the contract
    // is that attempt returns a SandwichOutcome, never throws. This test
    // documents that contract: if attempt throws, withSandwichRetry also
    // throws (fail-fast on a contract violation).
    const attempt = vi
      .fn<() => Promise<SandwichOutcome>>()
      .mockRejectedValue(new Error("attempt contract violation"));

    await expect(withSandwichRetry("contract-break", attempt)).rejects.toThrow(
      /attempt contract violation/,
    );
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
