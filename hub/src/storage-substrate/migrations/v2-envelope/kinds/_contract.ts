/**
 * mission-88 W0 — per-kind migration-module idempotency contract.
 *
 * Per thread-639 Q4 disposition: pattern for W1-W5 per-kind modules. Each
 * substrate-mediated kind (Idea, Bug, Thread, Mission, Proposal, Task,
 * PendingAction, Turn, Agent, Tele, SchemaDef, Counter, Message, Audit,
 * RepoEventBridgeCursor, RepoEventBridgeDedupe, Document, ArchitectDecision,
 * DirectorHistoryEntry, ReviewHistoryEntry, ThreadHistoryEntry) supplies a
 * module that implements this interface; the migration-runner consumes it.
 *
 * Resume-from-checkpoint via MigrationCursor entity (per A2 thread-635 R2):
 * runner reads cursor before invoking module; module reads cursor.lastMigratedId
 * to skip already-migrated rows; runner writes cursor after each row.
 *
 * Per `feedback_substrate_extension_wire_flow_integration_test` discipline:
 * per-kind tests + wire-flow integration test exercise the full contract.
 */

import type { HubStorageSubstrate, RenameMap, SchemaDef } from "../../../types.js";

/**
 * Per-kind rename mapping. Cluster-4 §1.7 canonical case: Message.kind →
 * metadata.messageKind (field-name collision with envelope `kind`). Other
 * rename candidates surface during W1-W5 per-kind module authoring.
 *
 * Mapping shape: `legacyFieldPath` → `envelopeFieldPath` (dotted paths).
 * Library honors mechanically; per-kind modules supply rules.
 *
 * mission-90 W1: declaration PROMOTED to the runtime contract surface
 * (storage-substrate/types.ts) — re-exported here so existing migration-layer
 * importers compile unchanged. Single type, no duplicate declaration.
 */
export type { RenameMap };

/**
 * SchemaDef + per-kind migration metadata passed to encode/parse functions
 * + per-kind migration modules.
 */
export interface MigrationSchemaRef {
  /** The locked SchemaDef for the kind. */
  readonly schema: SchemaDef;
  /** Per-kind rename rules (cluster-4 §1.7 + future analogues). Optional. */
  readonly renameMap?: RenameMap;
  /**
   * Per-kind partition rules: which top-level legacy fields land in
   * metadata vs spec vs status. Library default heuristic if absent.
   */
  readonly partition?: PartitionRules;
}

/**
 * K8s envelope-shape partition: legacy fields are sorted into metadata,
 * spec, or status. Default heuristic in envelope library if not supplied;
 * per-kind modules override for substantive deviations (cluster-1 §1.5
 * handle-classified vs content-classified is the most common axis).
 */
export interface PartitionRules {
  /** Fields that go into metadata (id, name, kind, labels, sourceThreadId, etc.). */
  metadata?: string[];
  /** Fields that go into spec (desired-state / declarative configuration). */
  spec?: string[];
  /** Fields that go into status (observed-state / runtime / FSM positions). */
  status?: string[];
}

/**
 * Per-kind migration module. Implementations live in
 * `hub/src/storage-substrate/migrations/v2-envelope/kinds/<KindName>.ts` for
 * W1-W5 per-cluster authoring.
 */
export interface KindMigrationModule {
  /** Entity kind this module migrates (matches SchemaDef.kind). */
  readonly kind: string;

  /** Schema + rename + partition rules for this kind. */
  readonly schemaRef: MigrationSchemaRef;

  /**
   * Migrate ONE legacy-shape entity to envelope-shape. Pure transformation;
   * substrate read/write happens at the runner layer. Returns the encoded
   * envelope entity (ready to substrate.put back).
   *
   * IDEMPOTENCY CONTRACT: if `legacy` is already envelope-shape (re-run case),
   * return it unchanged. The library function isEnvelopeShape() is the test.
   */
  migrateOne(legacy: unknown): unknown;
}
