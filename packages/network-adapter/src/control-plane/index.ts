/**
 * control-plane/ — the harness-neutral, resource-generic HCAP consumer Controller
 * (hcapskills0 build_core; design docs/design/hcapskills-design.md v2). Generalized
 * + inverted from the mission-107 PI tool-control-plane: one core (SpecStore →
 * ReconcileLoop) drives any resource kind through a `ResourceActuatorPort` that
 * decides HOW to converge. Consumed by pi-plugin (tools) and claude-plugin (skills).
 * Naming (ratified, K8s-lineage): the neutral core IS the "Controller" — it reconciles
 * declared specs onto a resource kind, living in this control-plane/. Classes keep their
 * names (SpecStore, ReconcileLoop); the actuators keep "Actuator".
 */
export type {
  ResourceSpec,
  ConvergeStatus,
  ConvergeFailureClass,
  ConvergeResult,
  ManagedObservation,
  ResourceActuatorPort,
  ResourceSpecStorePort,
  SpecPersistencePort,
  ConvergeOutcome,
  RunningResourceStatus,
} from "./contracts.js";
export { SpecStore, InMemorySpecPersistence } from "./spec-store.js";
export { ReconcileLoop } from "./reconcile-loop.js";
export type {
  ReconcileCollaborators,
  ReconcileLoopOptions,
} from "./reconcile-loop.js";
