/**
 * control-plane/contracts.ts — the harness-neutral, RESOURCE-GENERIC HCAP consumer
 * core (hcapskills0 build_core; design docs/design/hcapskills-design.md v2).
 *
 * The generalize+invert of the mission-107 PI tool-control-plane: one neutral core
 * (SpecStore → DiffEngine → ReconcileLoop) drives ANY resource kind (tools on MCP,
 * skills on filesystem, …) through a `ResourceActuatorPort` that decides HOW to
 * converge. Two inversions vs the pi original (grounding §3, design §2/§3):
 *
 *  1. The port is `converge(desired) → tri-state` + `observeManaged()`, NOT
 *     register/setActive/snapshot. The built-in preserve-baseline union and the
 *     poison-guard are pi-ACTUATOR internals now — they never appear here (a
 *     root-scoped filesystem actuator has no built-ins to preserve).
 *  2. Every observed/desired comparison is MANAGED-SCOPED (`observed ∩ managedNames`
 *     vs desired). The neutral core never sees the raw running surface, so a host's
 *     ever-present built-ins can never read as drift.
 *
 * `definition` is OPAQUE (actuator-interpreted): a ToolDescriptor for pi-tools, a
 * skill/corpus identifier for claude-skills — NEVER molded to a tool shape.
 */

/** A declared resource — resource-generic. `definition` is opaque to the core. */
export interface ResourceSpec {
  name: string;
  /** actuator-interpreted payload (registration/materialization input). Opaque here. */
  definition: unknown;
  /** enabled ⇒ member of the desired ACTIVE managed subset; false = declared-inactive. */
  enabled: boolean;
}

/**
 * Tri-state convergence outcome from the actuator. The ACTUATOR decides what
 * "not-yet-observable" means for ITS substrate (pi: setActive lands the next agent
 * turn; claude: a filesystem watcher hasn't yet picked up the write) and reports
 * `pending`; the neutral loop counts-but-tolerates it and must NEVER read it as
 * `converged` OR `failed`. The loop counts converge PASSES, never a wall-clock
 * "turn" — the vocabulary here is substrate-agnostic on purpose.
 */
export type ConvergeStatus = "converged" | "pending" | "failed";

/** Failure taxonomy for a converge pass (loud escalation after the bound). */
export type ConvergeFailureClass =
  | "actuate-failed"
  | "incoherent-plan"
  | "observe-failed"
  | "still-diverged";

/** The actuator's report for one converge pass. */
export interface ConvergeResult {
  status: ConvergeStatus;
  /** the managed names the actuator drove toward ACTIVE (the loop confirms against this). */
  desiredManaged: string[];
  klass?: ConvergeFailureClass;
  detail?: string;
}

/** The MANAGED-scoped observation (`observed ∩ managedNames`) — never the raw surface. */
export interface ManagedObservation {
  /** names currently observed active WITHIN this plane's managed set. */
  observedManaged: string[];
  /** every name this plane has ever driven (the managed ledger; for status joins). */
  managedNames: string[];
}

/**
 * THE harness-neutral actuation seam. Each actuator decides HOW to converge its
 * managed surface toward `desired` (pi: register defs → setActive(builtins ∪
 * enabled) → poison-guard; claude: write/unlink SKILL.md trees). Exposes NO
 * register/setActive/remove primitives — those are actuator-internal.
 */
export interface ResourceActuatorPort {
  /** converge the managed surface toward `desired`; returns tri-state (never throws
   *  for an actuation fault — reports `failed` so the loop can escalate/retry). */
  converge(desired: readonly ResourceSpec[]): ConvergeResult;
  /** observe the MANAGED subset fresh (F1 — no in-memory latch). */
  observeManaged(): ManagedObservation;
}

/** U1 custody of the declared spec (neutral). */
export interface ResourceSpecStorePort {
  list(): readonly ResourceSpec[];
  get(name: string): ResourceSpec | undefined;
  apply(spec: readonly ResourceSpec[]): void;
  create(spec: ResourceSpec): void;
  destroy(name: string): void;
}

/** KF4 — the persistence seam (Slice-1 in-memory no-op; disk impl deferred). */
export interface SpecPersistencePort {
  load(): ResourceSpec[] | null;
  save(spec: readonly ResourceSpec[]): void;
}

/** The outcome of one level-triggered reconcile pass (loop → onOutcome). */
export interface ConvergeOutcome {
  reason: string;
  converged: boolean;
  /** true only for the tolerated interim (`pending`) — actuation accepted, effect not yet observed; not converged, not escalating yet. */
  pending?: boolean;
  klass?: ConvergeFailureClass;
  detail?: string;
  /** consecutive non-converged passes including this one (0 on convergence). */
  consecutiveFailures: number;
}

/** Per-resource status, derived from U1 records + the managed observation (never host introspection). */
export interface RunningResourceStatus {
  name: string;
  declared: boolean;
  enabled: boolean;
  active: boolean;
  managed: boolean;
}
