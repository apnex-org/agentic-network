/**
 * Downstream-actor registry — mission-51 W3.
 *
 * Gates trigger emission per the rule from mission-51 brief:
 * "transition fires trigger iff downstream actor exists for the
 * resulting kind."
 *
 * If no actor matches the (kind, payload) pair, the trigger short-
 * circuits — no Message is created (saves write + storage). Skip-list
 * (ideas / audit-entry / tele transitions per brief) is honored
 * IMPLICITLY by the absence of matching actor declarations: if no
 * actor consumes a kind, the trigger doesn't fire.
 *
 * The gate is intentionally simple: a code-declared list of
 * `(kind, predicate)` entries. PR review locks the registry. Adding a
 * new actor requires a PR with explicit declaration.
 *
 * How to add a new actor:
 *   1. Append a `DownstreamActor` to DOWNSTREAM_ACTORS below.
 *   2. The `matches` predicate is a payload-shape check (e.g.,
 *      "this actor handles messages with kind=note where
 *      payload.taskId is set"). Pure; no I/O.
 *   3. Add a test verifying the actor matches the intended payload
 *      shapes + does NOT match unintended ones.
 *
 * Note: this registry exists at the trigger-emission boundary only.
 * Actual delivery + consumption mechanics live elsewhere
 * (PendingActionItem / SSE dispatch / inbox-drain). This registry's
 * single job is to gate the trigger from emitting at all.
 */

import type { MessageKind } from "../entities/index.js";

export interface DownstreamActor {
  /** Message kind this actor consumes. */
  readonly kind: MessageKind;
  /**
   * Payload-shape predicate. Returns true iff this actor handles a
   * message with the given payload. Pure; called synchronously by
   * the trigger gate.
   */
  readonly matches: (payload: unknown) => boolean;
  /** Human-readable name for log/metric attribution. */
  readonly name: string;
}

/**
 * Initial actor declarations — initial set covers the consumers for
 * the W3 trigger declarations in `triggers.ts`.
 *
 * Skip-list (per mission-51 brief): no actor for idea / audit-entry /
 * tele transitions. Their trigger declarations (if added) would
 * short-circuit at this gate.
 */
export const DOWNSTREAM_ACTORS: readonly DownstreamActor[] = [
  // mission-activated → engineer inbox-item
  // §3.2 trigger emits payload { missionId, transition: "proposed→active", ... }.
  {
    kind: "note",
    name: "mission_activation_inbox",
    matches: (payload) => {
      const p = payload as { transition?: string; missionId?: string };
      return p?.transition === "proposed→active" && typeof p?.missionId === "string";
    },
  },

  // mission-completed → director inbox-item
  // §7.3 trigger emits payload { missionId, transition: "active→completed", ... }.
  {
    kind: "note",
    name: "mission_completion_director_inbox",
    matches: (payload) => {
      const p = payload as { transition?: string; missionId?: string };
      return p?.transition === "active→completed" && typeof p?.missionId === "string";
    },
  },

  // review-submitted → engineer inbox-item
  // §6.4 trigger emits payload { reviewId, transition: "review_submitted", ... }.
  {
    kind: "note",
    name: "review_submitted_inbox",
    matches: (payload) => {
      const p = payload as { transition?: string; reviewId?: string };
      return p?.transition === "review_submitted" && typeof p?.reviewId === "string";
    },
  },
];

/**
 * Returns true iff at least one DownstreamActor matches the given
 * (kind, payload) pair. Trigger gate — see triggers.ts:runTriggers.
 *
 * Pure; no I/O. Called once per trigger evaluation.
 */
export function shouldFireTrigger(kind: MessageKind, payload: unknown): boolean {
  for (const actor of DOWNSTREAM_ACTORS) {
    if (actor.kind !== kind) continue;
    try {
      if (actor.matches(payload)) return true;
    } catch {
      // Actor predicate threw — treat as no-match. Defensive against
      // payload-shape drift; the actor's PR review should catch
      // structural issues, but at runtime we don't fail the trigger
      // gate on a single actor's bug.
      continue;
    }
  }
  return false;
}
