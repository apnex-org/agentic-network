/**
 * tool-control-plane.ts — the HCAP facade on PI (hcapskills0 build_core). DELEGATES,
 * holds NO logic: the 4 spec verbs → the neutral SpecStore, `sync` → the neutral
 * ReconcileLoop, `listRunningTools` computed from the store records + the actuator's
 * MANAGED observation (never host introspection).
 *
 * Post-inversion, `listRunningTools` is MANAGED-SCOPED — it reports this plane's
 * managed resources (declared ∪ managed ∪ observed-managed), NOT host built-ins.
 * That is a deliberate scoping refinement of the inversion (the reconciler's blocker
 * fix); it has NO production caller (only tests) and built-in PRESERVATION is
 * unchanged (structural, in the actuator's union), so it is not a functional
 * regression. Enumerated for verify_build in the PR body.
 */
import type {
  ConvergeOutcome,
  ResourceSpec,
  RunningResourceStatus,
  SpecStore,
  ReconcileLoop,
} from "@apnex/network-adapter";
import type { PiToolActuatorPort } from "./pi-tool-actuator-port.js";

export interface ToolControlPlaneDeps {
  store: SpecStore;
  loop: ReconcileLoop;
  /** the actuator, for the managed-status join only (observeManaged). */
  port: Pick<PiToolActuatorPort, "observeManaged">;
}

export class PiToolControlPlane {
  constructor(private readonly deps: ToolControlPlaneDeps) {}

  listDeclaredConfig(): readonly ResourceSpec[] {
    return this.deps.store.list();
  }
  applyConfig(spec: readonly ResourceSpec[]): void {
    this.deps.store.apply(spec);
  }
  createTool(spec: ResourceSpec): void {
    this.deps.store.create(spec);
  }
  destroyTool(name: string): void {
    this.deps.store.destroy(name);
  }
  sync(reason: string): ConvergeOutcome {
    return this.deps.loop.sync(reason);
  }

  /** Status DERIVED from store records + the MANAGED observation (never host
   *  introspection). Reports every name known to any managed level (declared ∪
   *  managed ∪ observed-managed); host built-ins are out of scope by construction. */
  listRunningTools(): RunningResourceStatus[] {
    const obs = this.deps.port.observeManaged();
    const active = new Set(obs.observedManaged);
    const managed = new Set(obs.managedNames);
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
