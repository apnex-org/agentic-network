/**
 * control-plane/reconcile-loop.ts — U4 ReconcileLoop (resource-generic; hcapskills0
 * build_core). Single concern: the level-triggered converge pass. Neutral — closes
 * over the SpecStore + ResourceActuatorPort contracts, ZERO host types.
 *
 * LEVEL = declared spec (U1) vs the MANAGED observed surface (observed ∩ managedNames
 * — never the raw surface, so a host's ever-present built-ins can never read as
 * drift; design v2 §2 blocker fix). The actuator decides HOW to converge and reports
 * a tri-state; the loop owns the escalation classification.
 *
 * Escalation semantics (design v2 §2; ratified ruling): the failure counter is a
 * POISON/termination guard for "genuinely won't converge", NOT a divergence tally.
 * The loop counts converge PASSES, never a wall-clock "turn" — the ACTUATOR reports
 * `pending` (its actuation is accepted but not yet observable; what that means is the
 * actuator's substrate concern: pi setActive lands next agent turn, claude a watcher
 * hasn't yet picked up the write), and the loop TOLERATES it — it does NOT count.
 * Only a CROSS-PASS stall — the actuator reports `pending` again for the SAME managed
 * set on a LATER pass (it never became observable) — counts + escalates at the bound.
 * `pendingSince` tracks the last-actuated-still-pending managed set to make exactly
 * that within-pass-vs-cross-pass distinction. A hard actuation fault (status:"failed",
 * e.g. a registration reject) is a DISTINCT input that counts immediately.
 */
import type {
  ConvergeOutcome,
  ResourceActuatorPort,
  ResourceSpec,
} from "./contracts.js";

export interface ReconcileCollaborators {
  store: { list(): readonly ResourceSpec[] };
  actuator: Pick<ResourceActuatorPort, "converge">;
}

export interface ReconcileLoopOptions {
  onOutcome?: (o: ConvergeOutcome) => void;
  failureBound?: number;
  log?: (msg: string) => void;
}

export class ReconcileLoop {
  private consecutiveFailures = 0;
  /** the managed desired-set actuated in a prior pass that had NOT converged; a later
   *  pass still-pending on the SAME set = a cross-pass stall (counts); a first
   *  divergence = a within-pass pending (tolerated, not counted). */
  private pendingSince: string[] | null = null;
  private readonly failureBound: number;
  private readonly log: (msg: string) => void;

  constructor(
    private readonly deps: ReconcileCollaborators,
    private readonly opts: ReconcileLoopOptions = {},
  ) {
    this.failureBound = opts.failureBound ?? 3;
    this.log = opts.log ?? (() => {});
  }

  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  sync(reason: string): ConvergeOutcome {
    const desired = this.deps.store.list();
    // The actuator actuates + observes its own managed surface (a fresh read — F1) and
    // reports a tri-state; it NEVER throws for an actuation fault (returns "failed").
    const result = this.deps.actuator.converge(desired);

    if (result.status === "failed") {
      // a genuine actuation fault (registration reject, setActive throw) — counts NOW.
      this.pendingSince = null;
      return this.fail(reason, result.klass ?? "actuate-failed", result.detail);
    }

    if (result.status === "converged") {
      this.consecutiveFailures = 0;
      this.pendingSince = null;
      return this.emit({ reason, converged: true, consecutiveFailures: 0 });
    }

    // status === "pending": actuated, managed surface not yet reflecting it.
    const crossPass =
      this.pendingSince !== null &&
      sameSet(this.pendingSince, result.desiredManaged);
    this.pendingSince = [...result.desiredManaged];

    if (crossPass) {
      // same managed set reported pending again on a LATER pass, still not observable
      // = genuinely not converging → count + escalate at the bound (termination guard).
      return this.fail(
        reason,
        "still-diverged",
        "managed set still pending across a converge pass",
      );
    }

    // within-pass deferral — TOLERATED, NOT counted (design v2 §2; lily ruling (a)).
    this.log(
      `[hcap-reconcile] ${reason}: pending (managed actuation accepted, effect not yet observed) — not counted`,
    );
    return this.emit({
      reason,
      converged: false,
      pending: true,
      klass: "still-diverged",
      consecutiveFailures: this.consecutiveFailures,
    });
  }

  private fail(
    reason: string,
    klass: NonNullable<ConvergeOutcome["klass"]>,
    detail?: string,
  ): ConvergeOutcome {
    this.consecutiveFailures += 1;
    this.log(
      `[hcap-reconcile] ${reason}: NOT converged (${klass}${detail ? `: ${detail}` : ""}) — consecutive=${this.consecutiveFailures}`,
    );
    if (this.consecutiveFailures >= this.failureBound) {
      this.log(
        `[hcap-reconcile] ${reason}: ESCALATION — ${this.consecutiveFailures} consecutive cross-pass/failed converges (>= ${this.failureBound}, ${klass}); surface cannot converge, operator/architect intervention required`,
      );
    }
    return this.emit({
      reason,
      converged: false,
      klass,
      detail,
      consecutiveFailures: this.consecutiveFailures,
    });
  }

  private emit(o: ConvergeOutcome): ConvergeOutcome {
    this.opts.onOutcome?.(o);
    return o;
  }
}

/** Order-independent set equality over string name lists. */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const x of b) if (!sa.has(x)) return false;
  return true;
}
