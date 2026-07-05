/**
 * mission-103 P3-S2 — THE CONSTITUTIONAL FIDELITY SUITE (design §4 + §6 floor).
 *
 * Proves the 15 mission-kit axioms (A0..A14 @ a93e711) faithfully carry the 15
 * live teles (tele-1..tele-15) across 7 binary dimensions per pair. This is the
 * permanent contract-test-floor guard: it stays green after the S4b tele
 * tombstone because both corpora are vendored fixtures. The same engine emits the
 * proofRef matrix the S2 batch decision cites (scripts/emit-fidelity-proof.ts).
 *
 * Any red dimension here means a pair is NOT clean and must split to a contested
 * Director single per T3 — never laundered into the all-15 batch.
 */
import { describe, it, expect } from "vitest";
import { runSuite, DIMENSIONS } from "./constitution-fidelity-engine.js";

const result = runSuite();

describe("constitutional fidelity suite (mission-103 S2)", () => {
  it("D1 cardinality: 15 axioms ↔ 15 active teles, bijective over the §4 map", () => {
    expect(result.cardinality.axioms).toBe(15);
    expect(result.cardinality.activeTeles).toBe(15);
    expect(result.cardinality.pairs).toBe(15);
    expect(result.cardinality.bijection).toBe(true);
  });

  for (const pair of result.pairs) {
    describe(`${pair.axiom} ← ${pair.tele}${pair.umbrella ? " (umbrella)" : ""}`, () => {
      for (const dim of DIMENSIONS) {
        const r = pair.dims[dim];
        it(`${dim}: ${r.detail}`, () => {
          if (!r.pass) {
            throw new Error(`${pair.axiom}←${pair.tele} ${dim} FAILED: ${r.detail}${r.missing?.length ? " | missing: " + r.missing.join("; ") : ""}`);
          }
          expect(r.pass).toBe(true);
        });
      }
    });
  }

  it("SUITE: all 15 pairs pass all 7 dimensions (batch is clean, zero split-outs)", () => {
    const failed = result.pairs.filter((p) => !p.pass).map((p) => `${p.axiom}←${p.tele}`);
    expect(failed).toEqual([]);
    expect(result.pass).toBe(true);
  });
});
