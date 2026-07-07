/**
 * convergence-actuator.ts — U3 ConvergenceActuator (HCAP-on-PI, seam-arch §1/§4).
 *
 * Single concern (Law-of-One): sequence a ConvergencePlan through the injected
 * `ToolActuatorPort` (U5), owning the built-in-preserving active-set computation.
 * Neutral — imports ZERO pi types; talks only to the port contract.
 *
 * §4 mechanic (ruling R1): (1) register each declared def (idempotent by name; KF2
 * refresh); (2) compute the full authoritative active list ONCE:
 *     desiredActive = snapshot.builtinNames        // the captured built-in preserve baseline (U5)
 *                   ∪ plan.desiredActiveNames      // the declared enabled subset
 * (3) `port.setActive(desiredActive)` — a single AUTHORITATIVE REPLACE (never union).
 * Both `enabled:false` and *removed* collapse to omission → not LLM-callable next turn.
 *
 * R1 REPLACED the old `(activeNames − managedNames)` term — a leaky proxy for
 * built-ins that preserved ANY unmanaged active, so it could not tell a built-in
 * (preserve, T5) from an out-of-band ROGUE (revert, T4/A2). The captured baseline
 * distinguishes them; anything active but NOT in (baseline ∪ enabled) is reverted.
 *
 * KF1 — built-ins-only is VALID, not poison: an empty declared/enabled set →
 * desiredActive == baseline → converge, NO escalation (the fetch-anomaly poison
 * guard lives in U6, not here). F3 "never STRIP built-ins" is now STRUCTURAL — the
 * baseline is always unioned — so no runtime strip-guard is needed.
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

    // Level 2 — authoritative active set (R1): desiredActive = builtinBaseline ∪
    // (declared enabled subset). The captured baseline (U5) IS the authoritative
    // preserve-set, so built-ins survive the REPLACE (T5) BY CONSTRUCTION while any
    // out-of-band ROGUE (active but ∉ baseline ∪ enabled) is reverted (T4/A2).
    const desiredActive = [
      ...new Set([...snapshot.builtinNames, ...plan.desiredActiveNames]),
    ];

    // KF1: built-ins-only is VALID, never poison — an empty declared/enabled set →
    // desiredActive == baseline → converge, no escalation. `setActive([])` happens
    // ONLY when the baseline itself is empty (no built-ins) AND nothing is enabled,
    // which is the correct "nothing active" state, not a strip. Built-in
    // preservation is STRUCTURAL here; the fetch-anomaly poison guard stays in U6.
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
