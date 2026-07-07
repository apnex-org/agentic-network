/**
 * reconcile-loop.ts — U4 SpecReconcileLoop (HCAP-on-PI, seam-arch §1/§5).
 *
 * Single concern (Law-of-One): the level-triggered converge pass = `sync()`.
 * Neutral — a closure over the U1/U2/U3/U5 contracts, ZERO pi types.
 *
 * The crux re-pointing of mission-106: LEVEL was Hub-revision vs disk-served-revision
 * (string compare); HCAP LEVEL = DECLARED-SPEC (U1) vs RUNNING active-set (U5)
 * (set compare). Convergence is decoupled from the Hub — even with an unchanged
 * Hub, pi active-set drift is repaired against the held spec.
 *
 * mission-106 F-invariants, carried + re-pointed:
 *  - F1: LEVEL = a fresh `port.snapshot()` every pass; converge only after a fresh
 *    re-read serves exactly the expected active set — NO in-memory latch.
 *  - F2: fail-closed — if `snapshot()` throws, do NOT actuate; keep the surface; retry.
 *  - F3: coherent whole — U3 actuates register+activate from ONE plan; never strips
 *    built-ins; the zero-tool *poison* guard lives in U6, not here (KF1).
 *  - F5: consecutiveFailures + failureBound(3) + an `onOutcome` taxonomy
 *    (snapshot-failed | apply-failed | incoherent-plan | still-diverged) → LOUD
 *    escalation once the bound is reached (a persistent divergence is never silent).
 *
 * Next-turn tolerance (§4/T8): pi's `setActive` takes effect NEXT agent turn, so a
 * changing pass's immediate re-read may still be stale → `still-diverged` (counted
 * but tolerated); the following pass observes + confirms `converged:true`.
 */
import type {
  ConvergeOutcome,
  ConvergencePlan,
  RunningSnapshot,
  ToolSpec,
} from "./contracts.js";
import type { ApplyResult } from "./convergence-actuator.js";

/** The neutral collaborators U4 closes over (contracts, not concrete pi types). */
export interface ReconcileCollaborators {
  store: { list(): readonly ToolSpec[] };
  diff: { plan(declared: readonly ToolSpec[]): ConvergencePlan };
  actuator: { apply(plan: ConvergencePlan, snap: RunningSnapshot): ApplyResult };
  port: { snapshot(): RunningSnapshot };
}

export interface SpecReconcileLoopOptions {
  onOutcome?: (o: ConvergeOutcome) => void;
  failureBound?: number;
  log?: (msg: string) => void;
}

export class SpecReconcileLoop {
  private consecutiveFailures = 0;
  private readonly failureBound: number;
  private readonly log: (msg: string) => void;

  constructor(
    private readonly deps: ReconcileCollaborators,
    private readonly opts: SpecReconcileLoopOptions = {},
  ) {
    this.failureBound = opts.failureBound ?? 3;
    this.log = opts.log ?? (() => {});
  }

  /** Diagnostic: consecutive converge failures (F5 observability). */
  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  /** One level-triggered converge pass: snapshot → plan → apply → confirm. */
  sync(reason: string): ConvergeOutcome {
    // F1/F2: fresh read every pass; fail-closed on a snapshot fault (never actuate).
    let snap: RunningSnapshot;
    try {
      snap = this.deps.port.snapshot();
    } catch (err) {
      return this.fail(reason, "snapshot-failed", (err as Error)?.message ?? String(err));
    }

    const plan = this.deps.diff.plan(this.deps.store.list());
    const result = this.deps.actuator.apply(plan, snap);
    if (!result.ok) {
      return this.fail(reason, result.klass ?? "apply-failed", result.detail);
    }

    // F1: converge ONLY after a fresh re-read serves exactly the expected set (no latch).
    let after: RunningSnapshot;
    try {
      after = this.deps.port.snapshot();
    } catch (err) {
      return this.fail(reason, "snapshot-failed", (err as Error)?.message ?? String(err));
    }
    if (sameSet(after.activeNames, result.expectedActive)) {
      this.consecutiveFailures = 0;
      return this.emit({ reason, converged: true, consecutiveFailures: 0 });
    }
    // Not yet converged — e.g. pi's setActive lands next turn (T8): counted but
    // tolerated; the next pass confirms. A PERSISTENT still-diverged escalates (F5).
    return this.fail(reason, "still-diverged", "active-set not yet == expected (retry next pass)");
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
      // F5: LOUD escalation — a persistent divergence is never a silent no-op.
      this.log(
        `[hcap-reconcile] ${reason}: ESCALATION — ${this.consecutiveFailures} consecutive converge failures (>= ${this.failureBound}, ${klass}); tool surface cannot converge, operator/architect intervention required`,
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
