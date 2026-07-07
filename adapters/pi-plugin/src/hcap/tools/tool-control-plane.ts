/**
 * tool-control-plane.ts — the HCAP facade on PI (seam-arch §2).
 *
 * DELEGATES, holds NO logic (§2 God-Object guard): the 4 spec verbs → U1 SpecStore,
 * `sync` → U4 SpecReconcileLoop, `listRunningTools` computed from U1 records + U5
 * snapshot (NEVER pi introspection). A KIND-scoped plane (tool kind); future kinds
 * (skills/context/plugins/hooks) get sibling planes sharing the machinery (§8).
 */
import type {
  ConvergeOutcome,
  RunningSnapshot,
  RunningToolStatus,
  ToolActuatorPort,
  ToolControlPlane,
  ToolSpec,
} from "./contracts.js";
import type { SpecStore } from "./spec-store.js";
import type { SpecReconcileLoop } from "./reconcile-loop.js";

export interface ToolControlPlaneDeps {
  store: SpecStore;
  loop: SpecReconcileLoop;
  /** the port, for the status join only (U5 snapshot); actuation stays in U3/U4. */
  port: Pick<ToolActuatorPort, "snapshot">;
}

export class PiToolControlPlane implements ToolControlPlane {
  constructor(private readonly deps: ToolControlPlaneDeps) {}

  listDeclaredConfig(): readonly ToolSpec[] {
    return this.deps.store.list();
  }
  applyConfig(spec: readonly ToolSpec[]): void {
    this.deps.store.apply(spec);
  }
  createTool(spec: ToolSpec): void {
    this.deps.store.create(spec);
  }
  destroyTool(name: string): void {
    this.deps.store.destroy(name);
  }
  sync(reason: string): ConvergeOutcome {
    return this.deps.loop.sync(reason);
  }

  /**
   * KF5 — status DERIVED from U1 records + U5 snapshot, NEVER pi introspection
   * (`getAllTools` can't tell enabled:false from removed). Reports every name known
   * to any level (declared ∪ managed ∪ active). An absent-but-still-managed name
   * (removed from the spec but lingering in the ledger) → `{declared:false,
   * enabled:false, active:false, managed:true}`.
   */
  listRunningTools(): RunningToolStatus[] {
    const snap: RunningSnapshot = this.deps.port.snapshot();
    const active = new Set(snap.activeNames);
    const managed = new Set(snap.managedNames);
    const declaredNames = new Set(this.deps.store.list().map((s) => s.name));
    const names = new Set<string>([...declaredNames, ...managed, ...active]);
    return [...names].map((name) => {
      const spec = this.deps.store.get(name);
      return {
        name,
        declared: declaredNames.has(name),
        enabled: spec?.enabled ?? false,
        active: active.has(name),
        managed: managed.has(name),
      };
    });
  }
}
