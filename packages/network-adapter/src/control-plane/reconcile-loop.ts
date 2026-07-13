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
 * T8 escalation semantics (design v2 §2; lily ruling (a) + cross-turn definition):
 * the failure counter is a POISON/termination guard for "genuinely won't converge",
 * NOT a divergence tally. A `pending-next-turn` (this pass actuated; the actuation is
 * accepted and merely deferred to the turn boundary) is the system working as
 * designed — it is TOLERATED and does NOT count. Only a divergence that SURVIVES A
 * TURN BOUNDARY (we actuated the same managed set a prior pass, the boundary elapsed,
 * and it is STILL diverged) counts + escalates at the bound. `awaitingBoundary`
 * tracks the last-actuated-but-unconverged managed set to make exactly that
 * within-turn-vs-cross-turn distinction. A hard actuation fault (status:"failed",
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
   *  pass still-diverged on the SAME set = a cross-turn failure (counts); a first
   *  divergence = a within-turn pending (tolerated, not counted). */
  private awaitingBoundary: string[] | null = null;
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
      this.awaitingBoundary = null;
      return this.fail(reason, result.klass ?? "actuate-failed", result.detail);
    }

    if (result.status === "converged") {
      this.consecutiveFailures = 0;
      this.awaitingBoundary = null;
      return this.emit({ reason, converged: true, consecutiveFailures: 0 });
    }

    // status === "pending-next-turn": actuated, managed surface not yet reflecting it.
    const crossTurn =
      this.awaitingBoundary !== null &&
      sameSet(this.awaitingBoundary, result.desiredManaged);
    this.awaitingBoundary = [...result.desiredManaged];

    if (crossTurn) {
      // prior-pass actuation, turn boundary elapsed, STILL diverged = genuinely not
      // converging → count + escalate at the bound (the S2b termination guarantee).
      return this.fail(
        reason,
        "still-diverged",
        "managed set still diverged across a turn boundary",
      );
    }

    // within-turn deferral — TOLERATED, NOT counted (design v2 §2; lily ruling (a)).
    this.log(
      `[hcap-reconcile] ${reason}: pending-next-turn (managed actuation deferred to turn boundary) — not counted`,
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
        `[hcap-reconcile] ${reason}: ESCALATION — ${this.consecutiveFailures} consecutive cross-turn/failed converges (>= ${this.failureBound}, ${klass}); surface cannot converge, operator/architect intervention required`,
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
