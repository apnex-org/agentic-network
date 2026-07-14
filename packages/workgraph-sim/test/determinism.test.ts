/**
 * determinism.test.ts — the idea-449 VirtualClock re-seal. This is the sim-side half of
 * the 449-A-gate `delta=0` determinism assertion: driving the REAL substrate through the
 * harness under a VirtualClock yields byte-identical timestamps across runs (non-vacuously
 * — the system clock differs), and the idea-525 get_now read-verb reports that same clock.
 */
import { describe, it, expect } from "vitest";
import { runDeterminismOracles } from "../src/determinism.js";

describe("VirtualClock re-seal (idea-449 clock / idea-525) — the 449-A-gate delta=0 assertion", () => {
  it("substrate time is deterministic under a VirtualClock, non-vacuously, and get_now tracks it", async () => {
    const results = await runDeterminismOracles();
    const failures = results.filter((r) => !r.pass);
    expect(results.length).toBe(3);
    expect(
      failures,
      `\n${failures.map((f) => `  ✗ ${f.name}: ${f.detail}`).join("\n")}\n`,
    ).toEqual([]);
  }, 30_000);
});
