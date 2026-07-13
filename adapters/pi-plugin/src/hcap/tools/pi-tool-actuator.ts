/**
 * pi-tool-actuator.ts — PiToolActuator, the PI concrete ResourceActuatorPort impl
 * (naming convention: <Harness><Kind>Actuator = the concrete last-mile shim; a
 * bare `...Port` name is reserved for the neutral interface). hcapskills0 build_core;
 * the generalize+invert of mission-107's U5. THE sole crossing of the pi
 * `ExtensionAPI` air-gap (A3): the ONLY unit importing pi SDK types, the SOLE caller
 * of `registerTool` / `setActiveTools`. Implements the harness-neutral
 * `ResourceActuatorPort` from @apnex/network-adapter — the neutral core (SpecStore →
 * ReconcileLoop) never sees a pi type.
 *
 * The inversion (design v2 §3): the built-in preserve-baseline UNION and the
 * register→activate two-level model live HERE now, not in the neutral core. A
 * root-scoped filesystem (claude-skills) actuator has no built-ins to preserve, so
 * these are genuinely pi-internal.
 *
 * Structurally exposes NO remove verb — REMOVE is set-subtraction (pi ExtensionAPI
 * has registerTool/getActiveTools/setActiveTools and NO tool-remove).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  ToolDispatchContext,
  ToolDescriptor,
  ResourceActuatorPort,
  ResourceSpec,
  ConvergeResult,
  ManagedObservation,
} from "@apnex/network-adapter";
import { buildPiToolDefinition } from "../../tool-bridge.js";

export class PiToolActuator implements ResourceActuatorPort {
  /** every name this plane has registered (the managed ledger; scoping key for
   *  observed ∩ managed + KF5 status). NOT the preserve-set (that is builtinBaseline). */
  private readonly managed = new Set<string>();

  /**
   * The built-in preserve BASELINE, captured ONCE at construction BEFORE this plane
   * registers/activates anything: pi's active tools here are exactly the built-ins
   * (+ any pre-existing foreign actives). Unioned into every desiredActive so
   * built-ins survive the authoritative REPLACE (T5) BY CONSTRUCTION, while an
   * out-of-band rogue (active but ∉ baseline ∪ enabled) is reverted (T4/A2).
   */
  private readonly builtinBaseline: string[];

  constructor(
    private readonly pi: ExtensionAPI,
    private readonly dispatchCtx: ToolDispatchContext,
  ) {
    this.builtinBaseline = [...pi.getActiveTools()];
  }

  converge(desired: readonly ResourceSpec[]): ConvergeResult {
    const managedEnabled = desired.filter((s) => s.enabled).map((s) => s.name);

    // Level 1 — (re-)register EVERY declared def (KF2 idempotent refresh). A hard
    // registration reject is an actuation fault → status:"failed"; we abort BEFORE
    // activation so nothing is served behind a failed register (the S1 poison path).
    try {
      for (const s of desired) {
        this.pi.registerTool(
          buildPiToolDefinition(s.definition as ToolDescriptor, this.dispatchCtx),
        );
        this.managed.add(s.name);
      }
    } catch (err) {
      return {
        status: "failed",
        klass: "actuate-failed",
        detail: (err as Error)?.message ?? String(err),
        desiredManaged: managedEnabled,
      };
    }

    // Level 2 — the R1 built-in-preserving union lives HERE now: the authoritative
    // REPLACE would strip built-ins, so union the captured baseline. Built-in
    // preservation is STRUCTURAL; a managed name that COLLIDES with a built-in dedups
    // to one entry (Set) — the built-in survives and is not double-served (S3).
    const desiredActive = [...new Set([...this.builtinBaseline, ...managedEnabled])];
    try {
      this.pi.setActiveTools(desiredActive);
    } catch (err) {
      return {
        status: "failed",
        klass: "actuate-failed",
        detail: (err as Error)?.message ?? String(err),
        desiredManaged: managedEnabled,
      };
    }

    // Observe the MANAGED subset fresh (observed ∩ managed). pi's setActive lands the
    // NEXT agent turn (T8) — this substrate's meaning of the neutral `pending`: an
    // immediate stale read reports `pending`; the loop tolerates it within a pass and
    // only a cross-pass stall (still stale a later pass) counts toward escalation.
    const observedManaged = this.pi
      .getActiveTools()
      .filter((n) => this.managed.has(n));
    const status = sameSet(observedManaged, managedEnabled)
      ? "converged"
      : "pending";
    return { status, desiredManaged: managedEnabled };
  }

  observeManaged(): ManagedObservation {
    const observedManaged = this.pi
      .getActiveTools()
      .filter((n) => this.managed.has(n));
    return { observedManaged, managedNames: [...this.managed] };
  }
}

/** Order-independent set equality over string name lists. */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const x of b) if (!sa.has(x)) return false;
  return true;
}
