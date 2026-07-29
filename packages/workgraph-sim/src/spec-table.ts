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
// 🔴 HAND-MAINTAINED, AND KNOWINGLY SO. These arrays are a SECOND representation of the phase set
// whose first representation is `WorkItemPhase`, imported as a TYPE from `hub/dist`. NOTHING
// ENFORCES THAT THEY AGREE. bug-371 added `failed_sealed` to the engine and these lists did not
// follow — the drift was caught only because `SPEC` below is an exhaustive `Record<Phase, …>` and
// failed to compile. THESE ARRAYS WOULD NOT HAVE FAILED: a plain array of a union type is not
// checked, so they would have gone on silently narrowing every sweep that iterates them and
// reporting full coverage of a set they had quietly reduced.
//
// THE UNDERLYING DEFECT IS NOT FIXED AND THE NEXT PHASE ADDITION WILL BREAK THIS AGAIN.
// Deriving these from `SPEC` closes it permanently and was built and then BACKED OUT under an
// explicit Director deferral: "workgraph-sim as a fully functioning component is unfinished and
// deferred, until more critical substrate fixes and this arc are implemented successfully."
// Only the minimum data update needed to stop the simulator misrepresenting the engine was kept.
export const PHASES: readonly Phase[] = [
  "ready",
  "claimed",
  "in_progress",
  "blocked",
  "paused",
  "review",
  "done",
  "abandoned",
  "failed_sealed",
];
// bug-371 — `failed_sealed` is terminal in the engine, MEASURED rather than assumed: all ten
// lifecycle verbs refuse on a seal-failed row, each with the seal-specific refusal (work-512 case
// (ii)). So this is a data correction, not an invented semantics — the phase genuinely has no
// legal move out and the terminal-phase oracles were previously skipping it entirely.
export const TERMINAL_PHASES: readonly Phase[] = ["done", "abandoned", "failed_sealed"];

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
  /**
   * idea-640: SUSPENSION IS A MANAGEMENT ATTRIBUTE, NOT A PHASE. `pause_work` no longer moves the
   * row along its lifecycle — a suspended `in_progress` row IS STILL `in_progress`, withdrawn from
   * execution rather than advanced. This spec table models ONE axis (the phase), so `to: "same"`
   * alone would under-specify pause into vacuity: an implementation where pause did NOTHING AT ALL
   * would satisfy it. `suspends` is the second axis, and the oracle asserts it in BOTH directions —
   * set here and true on the row, absent here and false — so a verb that spuriously suspends reds
   * just as loudly as one that fails to.
   */
  readonly suspends?: boolean;
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
    pause_work: { legal: true, to: "same", suspends: true },
    abandon_work: { legal: true, to: "abandoned", note: "creator-only guard (separate)" },
  }),
  claimed: row({
    start_work: { legal: true, to: "in_progress" },
    pause_work: { legal: true, to: "same", suspends: true, note: "architect/Director active recall; holder alone denied; PHASE PRESERVED (idea-640)" },
    release_work: { legal: true, to: "ready" },
    abandon_work: { legal: true, to: "abandoned" },
    renew_lease: { legal: true, to: "same" },
  }),
  in_progress: row({
    block_work: { legal: true, to: "blocked" },
    pause_work: { legal: true, to: "same", suspends: true, note: "architect/Director active recall; lease RETAINED but inert; PHASE PRESERVED (idea-640)" },
    complete_work: { legal: true, to: "gate", note: "review|done per completion-gate + evidence + explicit frictionReflection; missing friction persists valid evidence but stays same" },
    release_work: { legal: true, to: "ready" },
    abandon_work: { legal: true, to: "abandoned" },
    renew_lease: { legal: true, to: "same" },
  }),
  blocked: row({
    resume_work: { legal: true, to: "in_progress" },
    pause_work: { legal: true, to: "same", suspends: true, note: "architect/Director active recall; blocker preserved in recall history; PHASE PRESERVED (idea-640)" },
    release_work: { legal: true, to: "ready" },
    abandon_work: { legal: true, to: "abandoned" },
    renew_lease: { legal: true, to: "same" },
  }),
  // idea-640: this row is keyed `paused` for continuity with the Phase union, but it now models a
  // SUSPENDED row whose phase was `ready` — suspension no longer occupies the phase slot. Reaching
  // it drives a ready row and suspends it; unpause clears the attribute and the phase was never lost.
  paused: row({
    unpause_work: { legal: true, to: "ready" },
    // 🔴 bug-424 — REBUTTED, NOT WIDENED. This row previously left `abandon_work` at the
    // default (illegal), encoding a BLANKET refusal of disposal on a suspended row. The
    // Director's ruling and steve's F8 replace that blanket with an AUTHORITY MATRIX:
    // stewards (architect/director) and the self-suspending holder may dispose; a holder
    // whose row was suspended BY A STEWARD may not, and an unknown suspender fails closed.
    // The oracle drives this row as the ARCHITECT (oracles.ts:141), which is the steward
    // arm — so `legal: true` here asserts stewardship specifically, not a general opening.
    abandon_work: { legal: true, to: "abandoned", note: "steward (architect/director) or the SELF-suspending holder only — bug-424 authority matrix; a steward-suspended holder is still refused" },
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
