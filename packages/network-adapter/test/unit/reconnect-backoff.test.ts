/**
 * Unit tests for the SSE reconnect backoff curve.
 *
 * Layer:     L4 helper (pure function, extracted from McpTransport)
 * Invariants pinned (see docs/network/06-test-specification.md):
 *   G1  (was gap) — Consecutive SSE failures produce exponential backoff
 *       starting at `baseDelay`, doubling each failure, clamped at
 *       `maxDelay`. The reset-on-first-keepalive half of the invariant
 *       is an inspection property of `McpTransport.transition()` (one
 *       line: `if (to === "connected") this.consecutiveReconnects = 0`)
 *       and has no dedicated test.
 */

import { describe, it, expect } from "vitest";
import { computeReconnectBackoff } from "../../src/wire/mcp-transport.js";

describe("computeReconnectBackoff", () => {
  it("first attempt uses baseDelay unchanged", () => {
    expect(computeReconnectBackoff(0, 5_000)).toBe(5_000);
  });

  it("doubles on each consecutive failure", () => {
    expect(computeReconnectBackoff(1, 5_000)).toBe(10_000);
    expect(computeReconnectBackoff(2, 5_000)).toBe(20_000);
    expect(computeReconnectBackoff(3, 5_000)).toBe(40_000);
  });

  it("clamps at the default 60s cap", () => {
    // 5000 * 2^4 = 80000 → clamped to 60000
    expect(computeReconnectBackoff(4, 5_000)).toBe(60_000);
    // Further failures stay at the cap, not above.
    expect(computeReconnectBackoff(5, 5_000)).toBe(60_000);
    expect(computeReconnectBackoff(6, 5_000)).toBe(60_000);
    expect(computeReconnectBackoff(99, 5_000)).toBe(60_000);
  });

  it("respects a custom maxDelay override", () => {
    expect(computeReconnectBackoff(10, 5_000, 30_000)).toBe(30_000);
    expect(computeReconnectBackoff(1, 5_000, 30_000)).toBe(10_000);
  });

  it("treats negative consecutiveReconnects as zero", () => {
    expect(computeReconnectBackoff(-1, 5_000)).toBe(5_000);
  });

  it("scales with a different baseDelay", () => {
    expect(computeReconnectBackoff(0, 1_000)).toBe(1_000);
    expect(computeReconnectBackoff(2, 1_000)).toBe(4_000);
    expect(computeReconnectBackoff(10, 1_000)).toBe(60_000);
  });
});
