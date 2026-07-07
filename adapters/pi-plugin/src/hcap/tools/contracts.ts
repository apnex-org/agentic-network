/**
 * contracts.ts — HCAP-on-PI local control-plane contracts (mission-107 / idea-460).
 *
 * The declarative tool-control-plane interfaces, declared LOCALLY (A3 Earned-
 * Exposure): these types + U1-U4 import ZERO pi types and are NOT published on
 * `@apnex/network-adapter` until a real 2nd consumer (MCP claude/opencode, Slice 2)
 * needs them. Slice-2 extraction = a verbatim file-move into a resource-generic
 * `control-plane/` sibling, NOT a rewrite (seam-architecture-pi-v0.1 §7).
 *
 * The neutral tool DEFINITION reuses `@apnex/network-adapter`'s `ToolDescriptor`
 * (name/description/inputSchema — a neutral catalog shape, NOT a pi type), so a
 * declared tool carries no host coupling. ONLY U5 (PiToolActuatorPort) renders a
 * ToolDescriptor into pi's native `ToolDefinition` and crosses `ExtensionAPI`.
 *
 * HCAP = the harness control-plane umbrella; `ToolControlPlane` is the tool-KIND
 * plane. Future kinds (skills/context/plugins/hooks) are sibling planes sharing
 * the same machinery — no generic `ResourceControlPlane<T>` is built now (§8).
 */
import type { ToolDescriptor } from "@apnex/network-adapter";

/** The neutral tool definition — reused, no dup (seam-arch §3). */
export type ToolDefinitionNeutral = ToolDescriptor;

/**
 * A declared tool — the two-level spec (registration + activation).
 * Level 1 = registration (`definition` → `registerTool`, add/update by name).
 * Level 2 = activation (`enabled` → membership in the served active set).
 */
export interface ToolSpec {
  name: string;
  definition: ToolDefinitionNeutral;
  /** enabled ⇒ member of the served active set; false = registered-but-inactive. */
  enabled: boolean;
}

/** The running/observed surface, read fresh from the port (U5). */
export interface RunningSnapshot {
  /** names currently active (LLM-callable) — INCLUDES pi built-ins + non-Hub actives. */
  activeNames: string[];
  /** names this control plane has ever registered (the U5 ledger) — for KF5 status + the
   *  idempotent-register set. NOT the preserve-set (see builtinNames; ruling R1). */
  managedNames: string[];
  /**
   * R1 (ruling v0.2.1) — the STABLE built-in preserve BASELINE: pi's active tools
   * captured at U5 CONSTRUCTION, before the plane registered/activated anything.
   * U3 unions this into every desiredActive, so it is the AUTHORITATIVE preserve-set
   * — NOT "current unmanaged actives" (`activeNames − managedNames`), a leaky proxy
   * that preserves ANY unmanaged active and so cannot tell a built-in (preserve, T5)
   * from an out-of-band ROGUE (revert, T4/A2). Distinguishing them REQUIRES this
   * captured baseline.
   */
  builtinNames: string[];
}

/** The deterministic converge plan (U2 output). Total, pure. */
export interface ConvergencePlan {
  /** EVERY declared tool's definition (KF2: re-register all each pass → def-drift reconciled, A2). */
  toRegister: ToolDefinitionNeutral[];
  /** the spec names where `enabled:true` (the desired ENABLED subset, pre built-in union). */
  desiredActiveNames: string[];
}

/**
 * THE sole actuation seam (U5 impl). Structurally exposes NO remove/deregister
 * verb — REMOVE is emulated by set-subtraction (§4), mirroring the pi ground-truth
 * (ExtensionAPI has no tool-remove). No unit can call a remove that does not exist.
 */
export interface ToolActuatorPort {
  /** register/refresh a tool definition (idempotent by name; refreshes the in-session def). */
  register(def: ToolDefinitionNeutral): void;
  /** AUTHORITATIVE REPLACE of the whole active set (never union). */
  setActive(names: string[]): void;
  /** observe the running surface (fresh read every call — F1). */
  snapshot(): RunningSnapshot;
}

/**
 * KF4 — U1's persistence boundary, DECLARED now so the HCAP cold-start /
 * no-controller story (held spec survives independent of the adapter) has a home
 * in U1, not buried in U6 later. Slice-1 impl is in-memory/no-op behind this seam;
 * the disk-backed impl is deferred (Earned-Exposure). Seam declared now, IMPL later.
 */
export interface SpecPersistencePort {
  /** load a previously-persisted spec (null = none; in-memory Slice-1 always null). */
  load(): ToolSpec[] | null;
  /** persist the current declared spec (in-memory Slice-1 = no-op). */
  save(spec: readonly ToolSpec[]): void;
}

/**
 * Per-tool status (listRunningTools). `enabled`/`declared` are DERIVED FROM U1
 * records + `active`/`managed` from the U5 snapshot — NEVER pi introspection
 * (`getAllTools` cannot distinguish enabled:false from removed; §2). KF5: an
 * absent-but-still-managed name → {declared:false, enabled:false, active:false, managed:true}.
 */
export interface RunningToolStatus {
  name: string;
  /** present in the declared spec (U1). */
  declared: boolean;
  /** declared AND enabled (U1). */
  enabled: boolean;
  /** currently in the running active set (U5 snapshot). */
  active: boolean;
  /** ever registered by this control plane (U5 managedNames ledger). */
  managed: boolean;
}

/** F5 — failure taxonomy for a converge pass (loud escalation after the bound). */
export type ConvergeFailureClass =
  | "snapshot-failed"
  | "apply-failed"
  | "incoherent-plan"
  | "still-diverged";

/** The outcome of a `sync()` converge pass. */
export interface ConvergeOutcome {
  reason: string;
  converged: boolean;
  klass?: ConvergeFailureClass;
  detail?: string;
  /** consecutive converge failures including this pass (0 on success). */
  consecutiveFailures: number;
}

/**
 * The HCAP facade on PI — 6 verbs. DELEGATES and holds NO logic (§2 God-Object
 * guard): the 4 spec verbs → U1, `sync` → U4, `listRunningTools` computed from
 * U1 records + U5 snapshot. A KIND-scoped plane (tool kind); future kinds get
 * sibling planes sharing the machinery (§8).
 */
export interface ToolControlPlane {
  listDeclaredConfig(): readonly ToolSpec[];
  /** AUTHORITATIVE REPLACE of the declared spec (absent ⇒ removed on reconcile). */
  applyConfig(spec: readonly ToolSpec[]): void;
  /** incremental add/update of one declared tool. */
  createTool(spec: ToolSpec): void;
  /** incremental REMOVE — drop from the declared spec (set-subtracted from active on reconcile). */
  destroyTool(name: string): void;
  /** status from U1 records + U5 snapshot (never pi introspection). */
  listRunningTools(): RunningToolStatus[];
  /** converge-now / force: running active-set → declared spec. */
  sync(reason: string): ConvergeOutcome;
}
