/**
 * properties.test.ts — the idea-449 Phase B / B2 property battery. Each property is
 * checked on the REAL engine (green) AND its seeded-fault mutant must red-light it — so
 * a passing run proves both that the invariant holds and that the check is NON-VACUOUS.
 *
 * This increment: P3 no-deadlock · P8 state-timer sum-identity (open-span) · P9 bug-249
 * single-verifier deadlock. P1/P2/P4/P5/P6/P7 follow on this branch before the B2 PR.
 */
import { describe, it, expect } from "vitest";
import { runPropertyBattery } from "../src/properties.js";

describe("449_B P1-P9 property battery (B2) — property holds + mutant red-lights", () => {
  it("every property holds on the real engine and every mutant red-lights", async () => {
    const results = await runPropertyBattery();
    const failures = results.filter((r) => !r.pass);
    // Non-vacuity by construction: each property contributes a positive AND a mutant result.
    expect(results.length).toBeGreaterThanOrEqual(6);
    expect(
      failures,
      `\n${failures.map((f) => `  ✗ ${f.name}: ${f.detail}`).join("\n")}\n`,
    ).toEqual([]);
  }, 30_000);
});
