/**
 * convergence-actuator.ts — U3 ConvergenceActuator (HCAP-on-PI, seam-arch §1/§4).
 *
 * Single concern (Law-of-One): sequence a ConvergencePlan through the injected
 * `ToolActuatorPort` (U5), owning the built-in-preserving active-set computation.
 * Neutral — imports ZERO pi types; talks only to the port contract.
 *
 * §4 mechanic: (1) register each declared def (idempotent by name; KF2 refresh);
 * (2) compute the full authoritative active list ONCE:
 *     desiredActive = (snapshot.activeNames − snapshot.managedNames)  // preserve pi built-ins + non-Hub actives
 *                   ∪ plan.desiredActiveNames                          // the declared enabled subset
 * (3) `port.setActive(desiredActive)` — a single AUTHORITATIVE REPLACE (never union).
 * Both `enabled:false` and *removed* collapse to omission → not LLM-callable next turn.
 *
 * KF1 — built-ins-only is VALID, not poison: an empty declared/enabled set →
 * desiredActive == the preserved built-ins → converge, NO escalation. The size of
 * the desired set is NEVER treated as poison here (the fetch-anomaly poison guard
 * lives in U6). F3 "never STRIP built-ins" holds via the managedNames-subtraction:
 * built-ins are active-but-not-managed, so they survive into desiredActive by
 * construction. The coherence guard below defends against a corrupt snapshot only.
 */
import type {
  ConvergencePlan,
  RunningSnapshot,
  ToolActuatorPort,
} from "./contracts.js";

export interface ApplyResult {
  ok: boolean;
  /** the active set we authored (for U4's converged-⇔-re-read check). */
  expectedActive: string[];
  klass?: "incoherent-plan" | "apply-failed";
  detail?: string;
}

export class ConvergenceActuator {
  constructor(private readonly port: ToolActuatorPort) {}

  apply(plan: ConvergencePlan, snapshot: RunningSnapshot): ApplyResult {
    // Level 1 — (re-)register EVERY declared definition (idempotent-by-name; KF2).
    for (const def of plan.toRegister) this.port.register(def);

    // Level 2 — authoritative active set: preserve pi built-ins + non-managed
    // actives (subtract ONLY managedNames), union the declared enabled subset.
    const managed = new Set(snapshot.managedNames);
    const preserved = snapshot.activeNames.filter((n) => !managed.has(n));
    const desiredActive = [...new Set([...preserved, ...plan.desiredActiveNames])];

    // F3 / KF1 coherence guard — built-ins-only is fine (size is never poison), but
    // a list that would STRIP a currently-active built-in is incoherent → skip +
    // escalate, NEVER actuate. `desiredActive ⊇ preserved` by construction, so this
    // only ever fires on a corrupt snapshot (defense in depth), never normal converge.
    const stripsPreserved = preserved.some((n) => !desiredActive.includes(n));
    if (stripsPreserved) {
      return {
        ok: false,
        expectedActive: desiredActive,
        klass: "incoherent-plan",
        detail: "computed active set would strip a currently-active built-in — skipped",
      };
    }

    try {
      this.port.setActive(desiredActive);
    } catch (err) {
      return {
        ok: false,
        expectedActive: desiredActive,
        klass: "apply-failed",
        detail: (err as Error)?.message ?? String(err),
      };
    }
    return { ok: true, expectedActive: desiredActive };
  }
}
