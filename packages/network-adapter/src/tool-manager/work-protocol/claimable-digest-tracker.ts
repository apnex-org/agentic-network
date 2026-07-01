/**
 * claimable-digest-tracker.ts — idea-353 W1 inbound wake (level-triggered,
 * idle-gated, idempotent claimable-digest).
 *
 * The C1 work-queue is a pull model with no wake-on-ready signal: an idle
 * eligible agent never learns that newly-claimable work appeared and sits
 * unclaimed until someone manually nudges it (proven 3× in dogfood-1). This
 * tracker is the **decision core** of the inbound wake — given the set of
 * truly-claimable work ids for the agent's role (read via the stable
 * `list_ready_work` contract) and whether the agent is idle, it decides whether
 * to surface a digest ("N items claimable for your role").
 *
 * The design's ONE genuinely-new substrate is this **level-trigger / de-dup
 * state** (the FR-22 storm-risk locus). The rules:
 *
 *   - **Idle-gated (AC4):** never surface while the agent is mid-task. A busy
 *     tick neither emits NOR advances the baseline — so items that appeared
 *     while the agent was working are surfaced on the FIRST idle tick, not
 *     silently swallowed.
 *   - **Level-triggered / idempotent (AC3):** emit ONLY on an upward edge —
 *     0→N, or a genuinely-NEW claimable id appeared since the last surfaced
 *     set. A steady N>0, a re-tick, or a Hub restart (the in-memory baseline
 *     survives, since the adapter process does not restart) yields no new ids
 *     → no emit. ID-keyed, not count-keyed, so a swap (one item claimed away,
 *     another appearing at the same count) still edges.
 *
 * Pairs with the at-tick guard in the host: the tracker is only fed on a
 * SUCCESSFUL `list_ready_work` read — a failed read (Hub mid-restart, agent not
 * streaming) skips the tick entirely and leaves the baseline untouched, so a
 * transient empty/aborted read cannot manufacture a false 0→N replay.
 *
 * Pure + synchronous: all I/O (the list_ready_work read, the host emit) lives
 * in the host tick; this class holds only the de-dup state + the decision, so
 * the storm-proof contract is unit-testable without a live Hub (AC3/AC4).
 */

export interface ClaimableDigestInput {
  /** The truly-claimable work ids for the agent's role this tick (post-bug-181). */
  claimableIds: string[];
  /** The idle-gate: false = the agent is actively mid-task (never interrupt it). */
  isIdle: boolean;
}

export interface ClaimableDigestDecision {
  /** True iff an upward edge was detected while idle → surface the digest. */
  emit: boolean;
  /** Current claimable count (whether or not we emit). */
  count: number;
  /** Number of newly-appeared claimable ids since the last surfaced set. */
  newCount: number;
}

export class ClaimableDigestTracker {
  /** The claimable id set the agent was last woken about (the de-dup baseline). */
  private lastSurfaced = new Set<string>();

  /**
   * Decide whether this tick should surface a claimable-digest wake.
   * @param input current claimable ids + idle state for this tick.
   */
  reconcile(input: ClaimableDigestInput): ClaimableDigestDecision {
    const count = input.claimableIds.length;

    // AC4 idle-gate: never surface while mid-task, and do NOT advance the
    // baseline — accumulate so the first idle tick surfaces what appeared
    // while the agent was busy.
    if (!input.isIdle) {
      return { emit: false, count, newCount: 0 };
    }

    const newIds = input.claimableIds.filter((id) => !this.lastSurfaced.has(id));
    // AC3 level-trigger: emit only on an upward edge (0→N or a new id). A
    // steady set / re-tick / Hub-restart-replay yields no new ids → no emit.
    const emit = count > 0 && newIds.length > 0;

    // Advance the baseline to the current set on every IDLE pass (emit or not),
    // so a claimed-away item doesn't wedge the de-dup and a later re-appearance
    // re-edges correctly.
    this.lastSurfaced = new Set(input.claimableIds);

    return { emit, count, newCount: newIds.length };
  }

  /** Diagnostic/test accessor for the current de-dup baseline size. */
  getSurfacedCount(): number {
    return this.lastSurfaced.size;
  }
}
