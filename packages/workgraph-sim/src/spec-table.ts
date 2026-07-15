/**
 * spec-table.ts — the INDEPENDENT hand-authored legal-move ground truth for the
 * WorkItem 8-phase FSM (idea-449 §2.3). This is the A8-seal reference: the real
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
export const PHASES: readonly Phase[] = [
  "ready",
  "claimed",
  "in_progress",
  "blocked",
  "paused",
  "review",
  "done",
  "abandoned",
];
export const TERMINAL_PHASES: readonly Phase[] = ["done", "abandoned"];

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
    release_work: { legal: true, to: "ready" },
    abandon_work: { legal: true, to: "abandoned" },
    renew_lease: { legal: true, to: "same" },
  }),
  in_progress: row({
    block_work: { legal: true, to: "blocked" },
    complete_work: { legal: true, to: "gate", note: "review|done per completion-gate + evidence + explicit frictionReflection; missing friction persists valid evidence but stays same" },
    release_work: { legal: true, to: "ready" },
    abandon_work: { legal: true, to: "abandoned" },
    renew_lease: { legal: true, to: "same" },
  }),
  blocked: row({
    resume_work: { legal: true, to: "in_progress" },
    release_work: { legal: true, to: "ready" },
    abandon_work: { legal: true, to: "abandoned" },
    renew_lease: { legal: true, to: "same" },
  }),
  paused: row({
    unpause_work: { legal: true, to: "ready" },
  }),
  review: row({
    complete_work: { legal: true, to: "gate", note: "→done once the gate is satisfied and explicit frictionReflection is present; missing friction persists valid evidence but stays same" },
    attest_evidence: { legal: true, to: "done", note: "verifier dual-edge advances review→done" },
    renew_lease: { legal: true, to: "same" },
  }),
  done: allIllegal(),
  abandoned: allIllegal(),
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
