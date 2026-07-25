/**
 * spec-table.ts — the INDEPENDENT hand-authored legal-move ground truth for the
 * WorkItem 9-phase FSM (idea-449 §2.3; bug-371 added `failed_sealed`). This is the A8-seal reference: the real
 * substrate's behaviour is checked AGAINST this table, NOT derived from
 * `getLegalMoves` (kept only as a consistency invariant; it has 2 documented
 * divergences — quarantine-blindness + renew-on-expired-unswept). Authoring this
 * by hand, from the spec rather than the code, is what lets the conformance oracle
 * catch a substrate↔spec drift instead of rubber-stamping the implementation.
 *
 * Scope: STRUCTURAL phase-gate legality — "does the FSM permit attempting this verb
 * from this phase, given a well-behaved holder?". Orthogonal guards (role eligibility,
 * dependsOn-done, evidence predicate, lease fencing, WIP cap, creator-only) are SEPARATE
 * and are exercised by the oracle catalog, not encoded as phase legality here.
 */
import type { WorkItemPhase } from "hub/dist/entities/work-item.js";

export type Phase = WorkItemPhase;
// PHASES and TERMINAL_PHASES are DERIVED from SPEC — see below the table. They were
// hand-maintained lists until bug-371, which is what let them drift from `WorkItemPhase`.

export type SpecVerb =
  | "claim_work"
  | "start_work"
  | "block_work"
  | "resume_work"
  | "release_work"
  | "renew_lease"
  | "abandon_work"
  | "complete_work"
  | "pause_work"
  | "unpause_work"
  | "attest_evidence";

export const SPEC_VERBS: readonly SpecVerb[] = [
  "claim_work",
  "start_work",
  "block_work",
  "resume_work",
  "release_work",
  "renew_lease",
  "abandon_work",
  "complete_work",
  "pause_work",
  "unpause_work",
  "attest_evidence",
];

export interface Move {
  readonly legal: boolean;
  /**
   * Resulting phase on a well-behaved success. `"same"` = no phase change (renew);
   * `"gate"` = review OR done, resolved by the completion-gate + evidence predicate.
   */
  readonly to?: Phase | "same" | "gate";
  readonly note?: string;
}

const NO: Move = { legal: false };

function allIllegal(): Record<SpecVerb, Move> {
  return Object.fromEntries(SPEC_VERBS.map((v) => [v, NO])) as Record<SpecVerb, Move>;
}
function row(legal: Partial<Record<SpecVerb, Move>>): Record<SpecVerb, Move> {
  return { ...allIllegal(), ...legal };
}

/** SPEC[fromPhase][verb] → the hand-authored expected move. */
export const SPEC: Record<Phase, Record<SpecVerb, Move>> = {
  ready: row({
    claim_work: { legal: true, to: "claimed" },
    pause_work: { legal: true, to: "paused" },
    abandon_work: { legal: true, to: "abandoned", note: "creator-only guard (separate)" },
  }),
  claimed: row({
    start_work: { legal: true, to: "in_progress" },
    pause_work: { legal: true, to: "paused", note: "architect/Director active recall; holder alone denied" },
    release_work: { legal: true, to: "ready" },
    abandon_work: { legal: true, to: "abandoned" },
    renew_lease: { legal: true, to: "same" },
  }),
  in_progress: row({
    block_work: { legal: true, to: "blocked" },
    pause_work: { legal: true, to: "paused", note: "architect/Director active recall; token invalidated" },
    complete_work: { legal: true, to: "gate", note: "review|done per completion-gate + evidence + explicit frictionReflection; missing friction persists valid evidence but stays same" },
    release_work: { legal: true, to: "ready" },
    abandon_work: { legal: true, to: "abandoned" },
    renew_lease: { legal: true, to: "same" },
  }),
  blocked: row({
    resume_work: { legal: true, to: "in_progress" },
    pause_work: { legal: true, to: "paused", note: "architect/Director active recall; blocker preserved in recall history" },
    release_work: { legal: true, to: "ready" },
    abandon_work: { legal: true, to: "abandoned" },
    renew_lease: { legal: true, to: "same" },
  }),
  paused: row({
    unpause_work: { legal: true, to: "ready" },
  }),
  review: row({
    complete_work: { legal: true, to: "gate", note: "→done once the gate is satisfied and explicit frictionReflection is present; missing friction persists valid evidence but stays same" },
    attest_evidence: { legal: true, to: "done", note: "verifier dual-edge advances review→done; self-attest guard is target-work-scoped (idea-528)" },
    renew_lease: { legal: true, to: "same" },
  }),
  done: allIllegal(),
  abandoned: allIllegal(),
  // bug-371 — terminal by verifier seal. EVERY verb illegal, matching `done`/`abandoned` and
  // matching production, where `isFailedGateSealed` refuses all ten lifecycle verbs and consults
  // the SEAL rather than the phase. Measured directly against the substrate (work-512 case (ii)):
  // all ten refuse, each with the seal-specific refusal rather than an incidental error.
  failed_sealed: allIllegal(),
};

/**
 * bug-371 — PHASES and TERMINAL_PHASES are now DERIVED FROM `SPEC`, not hand-maintained.
 *
 * WHY: they used to be literal arrays, and when `WorkItemPhase` gained `failed_sealed` the type
 * changed and the arrays did not. `SPEC` is an exhaustive `Record<Phase, …>`, so it FAILED TO
 * COMPILE and is the only reason the drift was caught — the arrays would have gone on silently
 * narrowing every sweep that iterates them, reporting full coverage of a set they had quietly
 * reduced. Deriving from the one structure the compiler already enforces means the next phase
 * added to the engine cannot leave the model behind: you cannot compile `SPEC` without it, and
 * everything else follows.
 *
 * This is the same "two representations kept in sync by hand" defect bug-371 exists to remove,
 * one package over — and here it had diverged in THE SIMULATOR, which is where we go to ask what
 * the engine does. The model must not encode an older implementation shape than the engine.
 */
export const PHASES: readonly Phase[] = Object.keys(SPEC) as Phase[];

/**
 * TERMINAL = NO LEGAL MOVE OUT. Derived from the table rather than listed, so terminality is a
 * PROPERTY OF THE MODEL rather than a second assertion about it that can disagree.
 *
 * MEASURED against the engine before adopting this definition (work-512 case (ii)): all ten
 * lifecycle verbs refuse on a seal-failed row, each with the seal-specific refusal. So
 * `failed_sealed` is genuinely terminal here and is not merely being labelled that way — which
 * matters, because this list drives the terminal-phase oracles and adding a phase to it CHANGES
 * WHAT THE SIMULATOR ASSERTS.
 */
export const TERMINAL_PHASES: readonly Phase[] = PHASES.filter(
  (p) => SPEC_VERBS.every((v) => !SPEC[p][v].legal),
);

/** Look up the hand-authored move for a (phase, verb) — defaults to illegal. */
export function specMove(from: Phase, verb: SpecVerb): Move {
  return SPEC[from]?.[verb] ?? NO;
}

/** Every (phase, verb) the spec marks LEGAL (for the conformance sweep). */
export function legalMoves(): ReadonlyArray<{ from: Phase; verb: SpecVerb; move: Move }> {
  const out: Array<{ from: Phase; verb: SpecVerb; move: Move }> = [];
  for (const from of PHASES) {
    for (const verb of SPEC_VERBS) {
      const move = SPEC[from][verb];
      if (move.legal) out.push({ from, verb, move });
    }
  }
  return out;
}
