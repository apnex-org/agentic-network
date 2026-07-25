// bug-371 / work-512 — THE MODEL MUST NOT LAG THE ENGINE.
//
// `PHASES` and `TERMINAL_PHASES` were hand-maintained literal arrays. When the engine's
// `WorkItemPhase` gained `failed_sealed`, the TYPE changed and the ARRAYS did not — two
// representations of what the phases are, kept in sync by hand. That is the same defect class
// bug-371 exists to remove, sitting in the SIMULATOR, which is where we go to ask what the engine
// does.
//
// The exhaustive `Record<Phase, …>` on SPEC is what caught it: it failed to compile. The arrays
// would NOT have failed — they would have gone on silently narrowing every sweep that iterates
// them and reporting full coverage of a set they had quietly reduced. That asymmetry is the whole
// lesson: A PLAIN ARRAY OF A UNION TYPE IS NOT CHECKED, AN EXHAUSTIVE RECORD IS.
//
// Both are now DERIVED from SPEC. These cases pin that derivation, because a derivation that
// silently produces the wrong set is worse than the literal it replaced.
import { describe, expect, it } from "vitest";
import { PHASES, SPEC, SPEC_VERBS, TERMINAL_PHASES } from "../spec-table.js";

describe("bug-371 — the spec table covers every engine phase", () => {
  it("PHASES is exactly the SPEC keys, and contains the seal-failed terminal phase", () => {
    expect([...PHASES].sort()).toEqual(
      ["abandoned", "blocked", "claimed", "done", "failed_sealed", "in_progress", "paused", "ready", "review"],
    );
    expect([...PHASES].sort()).toEqual(Object.keys(SPEC).sort());
  });

  it("TERMINAL_PHASES is derived as `no legal move out`, not asserted separately", () => {
    // Terminality is a PROPERTY OF THE TABLE rather than a second list that can disagree with it.
    expect([...TERMINAL_PHASES].sort()).toEqual(["abandoned", "done", "failed_sealed"]);
    for (const p of TERMINAL_PHASES) {
      expect(SPEC_VERBS.every((v) => !SPEC[p][v].legal), `${p} must have no legal move out`).toBe(true);
    }
  });

  it("POSITIVE CONTROL: the derivation discriminates — non-terminal phases have legal moves", () => {
    // Without this, both cases above pass on a derivation that marks EVERYTHING terminal (or
    // returns an empty set and vacuously satisfies the for-loop).
    const nonTerminal = PHASES.filter((p) => !TERMINAL_PHASES.includes(p));
    expect(nonTerminal.length, "the model cannot be all-terminal").toBeGreaterThan(0);
    for (const p of nonTerminal) {
      expect(SPEC_VERBS.some((v) => SPEC[p][v].legal), `${p} must have at least one legal move`).toBe(true);
    }
  });

  it("every phase has a row for every verb — no undefined lookups in a sweep", () => {
    for (const p of PHASES) {
      for (const v of SPEC_VERBS) {
        expect(SPEC[p]?.[v], `SPEC[${p}][${v}] must be defined`).toBeDefined();
      }
    }
  });
});
