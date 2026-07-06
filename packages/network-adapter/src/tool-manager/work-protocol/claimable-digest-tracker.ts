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

/** work-165 (idea-358): consecutive failed `list_ready_work` reads before the
 *  inbound wake is declared degraded. The wake only surfaces on a SUCCESSFUL read,
 *  so a run of failed reads (Hub unreachable, stream wedged) silently kills the
 *  wake with no signal. After this many misses the host emits a degraded-mode
 *  notification so the dead wake is visible instead of silent. */
const DEFAULT_READ_FAILURE_THRESHOLD = 3;

export interface ReadFailureDecision {
  /** True on the SINGLE tick where consecutive failures first reach the threshold
   *  (emit-once per streak; re-arms after the next successful read). */
  degraded: boolean;
  /** Current consecutive-failure count (for the host's log/notification). */
  consecutiveFailures: number;
}

export interface ClaimableDigestDecision {
  /** True iff an upward edge was detected while idle → surface the digest. */
  emit: boolean;
  /** Current claimable count (whether or not we emit). */
  count: number;
  /** Number of newly-appeared claimable ids since the last surfaced set. */
  newCount: number;
  /** bug-226: what fired this emit — "edge" = a genuinely-new claimable id;
   *  "level" = the idle-ENTRY re-surface of a standing claimable set. Both in
   *  one tick collapse into a single "level" emit (the same reconcile). */
  trigger: "edge" | "level" | null;
}

export class ClaimableDigestTracker {
  /** The claimable id set the agent was last woken about (the de-dup baseline). */
  private lastSurfaced = new Set<string>();
  /** bug-226: the prior tick's idle state — false at construction so the FIRST
   *  idle tick after adapter boot counts as an idle-entry (a restarted process
   *  must be re-told about standing work; the in-memory baseline it lost was
   *  exactly the bug). */
  private prevIdle = false;
  /** work-165 (idea-358): consecutive failed list_ready_work reads (silent-wake-
   *  death detector). Reset by recordReadSuccess; incremented by recordReadFailure. */
  private consecutiveReadFailures = 0;
  /** Emit-once latch for the degraded notification — set when the threshold is
   *  first crossed, cleared by the next successful read (so a persistent outage
   *  emits once, not every tick). */
  private degradedNotified = false;

  /**
   * work-165 (idea-358): record a SUCCESSFUL list_ready_work read — the wake is
   * alive, so clear the failure streak + re-arm the degraded latch. Call on any
   * non-throwing read (independent of idle-gate / reconcile).
   */
  recordReadSuccess(): void {
    this.consecutiveReadFailures = 0;
    this.degradedNotified = false;
  }

  /**
   * work-165 (idea-358): record a FAILED list_ready_work read. The inbound wake
   * only surfaces on a successful read, so a run of failures silently kills it.
   * Returns `degraded:true` exactly once — on the tick the count first reaches
   * `threshold` — so the host emits a single degraded-mode notification per
   * outage (re-armed by the next recordReadSuccess).
   */
  recordReadFailure(threshold = DEFAULT_READ_FAILURE_THRESHOLD): ReadFailureDecision {
    this.consecutiveReadFailures += 1;
    const degraded = this.consecutiveReadFailures >= threshold && !this.degradedNotified;
    if (degraded) this.degradedNotified = true;
    return { degraded, consecutiveFailures: this.consecutiveReadFailures };
  }

  /**
   * Decide whether this tick should surface a claimable-digest wake.
   * @param input current claimable ids + idle state for this tick.
   */
  reconcile(input: ClaimableDigestInput): ClaimableDigestDecision {
    const count = input.claimableIds.length;

    // AC4 idle-gate: never surface while mid-task, and do NOT advance the
    // baseline (or the idle latch) — accumulate so the first idle tick
    // surfaces what appeared while the agent was busy.
    if (!input.isIdle) {
      this.prevIdle = false;
      return { emit: false, count, newCount: 0, trigger: null };
    }

    // bug-226 fix shape (a): LEVEL trigger on idle-ENTRY. The edge-only
    // baseline meant an agent that was told about work BEFORE going busy was
    // never re-told at the next idle — it sat beside claimable work until a
    // human probed (3× in one day). On the busy→idle transition (and on the
    // first tick after adapter boot), clear the baseline so the STANDING
    // claimable set re-surfaces. Fires at most once per idle-entry by
    // construction — continuous idle never re-enters; the aging/nudge
    // machinery owns longer-horizon persistence.
    const idleEntry = !this.prevIdle;
    this.prevIdle = true;
    if (idleEntry) this.lastSurfaced.clear();

    const newIds = input.claimableIds.filter((id) => !this.lastSurfaced.has(id));
    // AC3 level-trigger: emit only on an upward edge (0→N or a new id) — which
    // an idle-entry reset widens to the full standing set. Edge + level in the
    // same tick is ONE reconcile → ONE emit (the bug-226 dedupe requirement).
    const emit = count > 0 && newIds.length > 0;

    // Advance the baseline to the current set on every IDLE pass (emit or not),
    // so a claimed-away item doesn't wedge the de-dup and a later re-appearance
    // re-edges correctly.
    this.lastSurfaced = new Set(input.claimableIds);

    return { emit, count, newCount: newIds.length, trigger: emit ? (idleEntry ? "level" : "edge") : null };
  }

  /** Diagnostic/test accessor for the current de-dup baseline size. */
  getSurfacedCount(): number {
    return this.lastSurfaced.size;
  }
}
