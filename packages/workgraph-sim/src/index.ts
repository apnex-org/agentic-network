/**
 * @apnex/workgraph-sim — sovereign greenfield WorkGraph simulator + contract-oracle
 * platform (idea-449). Drives the REAL PolicyRouter/WorkItemRepositorySubstrate FSM.
 */
export { SimHarness } from "./harness.js";
export type { VerbOutcome, SimHarnessOptions } from "./harness.js";
export { SimClient } from "./clients.js";
export * from "./spec-table.js";
export * from "./oracles.js";
export * from "./determinism.js";
// Re-export the injected clock so sim consumers need not deep-import hub (idea-449/525).
export { VirtualClock, systemClock, type Clock } from "hub/dist/entities/clock.js";
