/**
 * Phase 2d CP2 C4 — Action-validator types (task-307).
 *
 * Shared types for the staged-action state-revalidation gate. Validators
 * run at the bilateral-convergence moment (right before staged→committed
 * promotion) and perform fail-fast entity-existence + FSM-transition
 * checks so stale references don't spawn broken cascades.
 *
 * The validation layer is strictly READ-ONLY. `ValidationContext` exposes
 * the entity store interfaces directly, not `IPolicyContext` — no
 * dispatch, emit, metrics, or mutation paths. This keeps the gate as a
 * fail-fast optimization rather than a second enforcement point; the
 * cascade handler remains the final transactional arbiter.
 */
import type { IProposalStore, IThreadStore } from "../../state.js";
import type { IIdeaStore } from "../../entities/idea.js";
import type { IMissionStore } from "../../entities/mission.js";
import type { IBugStore } from "../../entities/bug.js";
import type { ConvergenceGateSubtype } from "../../state.js";

/**
 * Strictly read-only subset of stores a validator may consult. Exposes
 * the `I*Store` interfaces directly (not wrapping structures) so
 * validators can reach standard read methods like `getIdea`, `getMission`,
 * `getTask`. Any mutation method on those interfaces exists for other
 * callers — validators MUST NOT invoke mutating methods.
 */
export interface ValidationContext {
  idea: IIdeaStore;
  mission: IMissionStore;
  thread: IThreadStore;
  proposal: IProposalStore;
  bug: IBugStore;
}

/**
 * Result of a per-action validator run. `ok=true` permits the action to
 * promote from staged→committed; `ok=false` raises the gate error with
 * the structured `subtype` + `error` so the caller can self-correct.
 *
 * `isNoOp=true` (only meaningful with `ok=true`) signals that the action
 * is well-formed but would produce no state change — the committed
 * action is tagged; the cascade runner observes the tag and emits a
 * `cascade.idempotent_update_skip` audit entry instead of performing a
 * redundant write. Bug-14 absorbed.
 */
export interface ValidationResult {
  ok: boolean;
  error?: string;
  subtype?: ConvergenceGateSubtype;
  isNoOp?: boolean;
  /** Structured payload surfaced alongside subtype — caller attaches it
   *  to the raised `ThreadConvergenceGateError.metadata`. Typical
   *  shapes: `{entityType, entityId}` for stale_reference,
   *  `{entityType, entityId, currentStatus, attemptedStatus}` for
   *  invalid_transition. Architect thread-232 refinement. */
  metadata?: Record<string, unknown>;
}

export interface IActionValidator {
  validate(payload: unknown, context: ValidationContext): Promise<ValidationResult>;
}

/** Convenience factory for the always-pass default — used for action
 *  types that require no state-reality check (e.g. `close_no_action`,
 *  top-level `propose_mission`). */
export const NULL_VALIDATOR: IActionValidator = {
  validate: async () => ({ ok: true }),
};
