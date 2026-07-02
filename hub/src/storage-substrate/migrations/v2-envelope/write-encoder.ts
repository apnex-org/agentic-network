/**
 * mission-90 W4 — envelope write-encoder (idea-324 / preflight c1: close ALL
 * live bare-shape writers).
 *
 * A central, declarative WRITE-side encoder symmetric to the W2 read-side
 * translator (`SchemaReconciler.getFieldTranslation` → `substrate.setFieldTranslator`).
 * Built from the SAME shape-authority as the v2-envelope migration (each kind's
 * `KindMigrationModule.migrateOne`), so every write produces the byte-identical
 * envelope shape the migration produces — there is exactly ONE shape-authority.
 *
 * Injected at Hub boot via `substrate.setWriteEncoder(...)`; the substrate routes
 * put/createOnly/putIfMatch through it before storing. Complete-BY-CONSTRUCTION:
 * every write of every modelled kind is enveloped at the single chokepoint, so no
 * per-repo writer can be silently missed (the no-new-bare canary proves it).
 *
 * PASSTHROUGH GUARD (load-bearing, architect-pinned at W4):
 *   - `migrateOne` probes `isEnvelopeShape` at entry and returns the row UNCHANGED
 *     if already envelope → re-writes of envelope rows are byte-identical (no
 *     double-encode), and a row carrying status fields (e.g. SchemaDef
 *     status.phase/appliedVersion from the W5 status-write seam) keeps them.
 *   - kinds with NO migration module (e.g. MigrationCursor — bookkeeping, by
 *     design) pass through unchanged.
 */

import type { KindMigrationModule } from "./kinds/_contract.js";
import type { SchemaDef } from "../../types.js";
import { ALL_SCHEMAS } from "../../schemas/all-schemas.js";

import { createAgentMigrationModule } from "./kinds/Agent.js";
import { createAuditMigrationModule } from "./kinds/Audit.js";
import { createBugMigrationModule } from "./kinds/Bug.js";
import { createCounterMigrationModule } from "./kinds/Counter.js";
import { createIdeaMigrationModule } from "./kinds/Idea.js";
import { createMessageMigrationModule } from "./kinds/Message.js";
import { createMissionMigrationModule } from "./kinds/Mission.js";
import { createPendingActionMigrationModule } from "./kinds/PendingAction.js";
import { createProposalMigrationModule } from "./kinds/Proposal.js";
import { createTaskMigrationModule } from "./kinds/Task.js";
import { createTeleMigrationModule } from "./kinds/Tele.js";
import { createThreadMigrationModule } from "./kinds/Thread.js";
import { createTurnMigrationModule } from "./kinds/Turn.js";
import { createSchemaDefMigrationModule } from "./kinds/SchemaDef.js";
import { createNotificationMigrationModule } from "./kinds/Notification.js";
import { createDocumentMigrationModule } from "./kinds/Document.js";
import { createArchitectDecisionMigrationModule } from "./kinds/ArchitectDecision.js";
import { createDirectorHistoryEntryMigrationModule } from "./kinds/DirectorHistoryEntry.js";
import { createReviewHistoryEntryMigrationModule } from "./kinds/ReviewHistoryEntry.js";
import { createThreadHistoryEntryMigrationModule } from "./kinds/ThreadHistoryEntry.js";
import { createRepoEventBridgeCursorMigrationModule } from "./kinds/RepoEventBridgeCursor.js";
import { createRepoEventBridgeDedupeMigrationModule } from "./kinds/RepoEventBridgeDedupe.js";
import { createWorkItemMigrationModule } from "./kinds/WorkItem.js";

/** kind → migration-module factory. The single registry of envelope shape-authority. */
const MODULE_FACTORIES: Record<string, (schema: SchemaDef) => KindMigrationModule> = {
  Agent: createAgentMigrationModule,
  Audit: createAuditMigrationModule,
  Bug: createBugMigrationModule,
  Counter: createCounterMigrationModule,
  Idea: createIdeaMigrationModule,
  Message: createMessageMigrationModule,
  Mission: createMissionMigrationModule,
  PendingAction: createPendingActionMigrationModule,
  Proposal: createProposalMigrationModule,
  Task: createTaskMigrationModule,
  Tele: createTeleMigrationModule,
  Thread: createThreadMigrationModule,
  Turn: createTurnMigrationModule,
  SchemaDef: createSchemaDefMigrationModule,
  Notification: createNotificationMigrationModule,
  Document: createDocumentMigrationModule,
  ArchitectDecision: createArchitectDecisionMigrationModule,
  DirectorHistoryEntry: createDirectorHistoryEntryMigrationModule,
  ReviewHistoryEntry: createReviewHistoryEntryMigrationModule,
  ThreadHistoryEntry: createThreadHistoryEntryMigrationModule,
  RepoEventBridgeCursor: createRepoEventBridgeCursorMigrationModule,
  RepoEventBridgeDedupe: createRepoEventBridgeDedupeMigrationModule,
  WorkItem: createWorkItemMigrationModule,  // C1-R2 mission-94
};

export type EnvelopeWriteEncoder = (kind: string, entity: unknown) => unknown;

/**
 * The kinds the write-encoder registry covers (has a migration module). Exposed
 * for the W4 registry-completeness backstop test, which fs-enumerates the
 * kinds/*.ts module files and asserts this registry is bidirectionally complete —
 * every module file is registered (no Turn-class silent omission) AND no registry
 * entry points at a non-existent module. Documented module-less kinds (no envelope
 * partition): Counter has a module; MigrationCursor does not (bookkeeping, by design).
 */
export function writeEncoderRegisteredKinds(): string[] {
  return Object.keys(MODULE_FACTORIES).sort();
}

/**
 * Build the write-encoder from ALL_SCHEMAS + the per-kind migration modules.
 * Returns `(kind, entity) => envelopeRow` — idempotent (envelope passthrough),
 * and a no-op for kinds without a migration module (e.g. MigrationCursor).
 */
export function buildEnvelopeWriteEncoder(): EnvelopeWriteEncoder {
  const modules = new Map<string, KindMigrationModule>();
  for (const schema of ALL_SCHEMAS) {
    const factory = MODULE_FACTORIES[schema.kind];
    if (factory) modules.set(schema.kind, factory(schema));
  }
  return (kind: string, entity: unknown): unknown => {
    const mod = modules.get(kind);
    if (!mod) return entity; // no migration module (MigrationCursor, by design) → passthrough
    return mod.migrateOne(entity); // idempotent: already-envelope rows pass through byte-identical
  };
}
