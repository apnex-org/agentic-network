/**
 * mission-88 W0 — MigrationCursorRepository.
 *
 * Per thread-639 Q3 disposition: type-safe wrapper over HubStorageSubstrate
 * for per-kind migration progress tracking. Single row per kind being
 * migrated ({id: "cursor-<KindName>"}); resume-from-checkpoint contract per
 * A2 thread-635 R2 fold-in.
 *
 * Read-then-CAS pattern via getWithRevision + putIfMatch for resume-safety
 * under concurrent migration-runner instances (e.g., if cutover-rehearsal
 * runs alongside production-mode runner). Matches SubstrateCounter discipline.
 */

import type { HubStorageSubstrate } from "../storage-substrate/index.js";

const KIND = "MigrationCursor";
const MAX_CAS_RETRIES = 50;

export interface MigrationCursorEntity {
  /** Cursor row id: "cursor-<KindName>" (e.g., "cursor-Idea"). */
  id: string;
  /** The entity ID most recently migrated; resume from > this value. */
  lastMigratedId: string;
  /** ISO timestamp of last migration tick. */
  lastMigratedAt: string;
  /** Optional wave tag (e.g., "W1") for cross-wave forensic queries. */
  waveId?: string;
}

export class MigrationCursorRepository {
  constructor(private readonly substrate: HubStorageSubstrate) {}

  private cursorId(kind: string): string {
    return `cursor-${kind}`;
  }

  /**
   * Read the current checkpoint for a kind. Returns null if no cursor row
   * exists yet (first migration of this kind hasn't started).
   */
  async getCheckpoint(kind: string): Promise<MigrationCursorEntity | null> {
    return this.substrate.get<MigrationCursorEntity>(KIND, this.cursorId(kind));
  }

  /**
   * Advance the checkpoint to a new lastMigratedId. CAS-safe via
   * getWithRevision + putIfMatch retry loop; on first-write, uses
   * createOnly + retry-on-conflict (concurrent first-create race protection).
   */
  async advanceCheckpoint(
    kind: string,
    lastMigratedId: string,
    waveId?: string,
  ): Promise<void> {
    const id = this.cursorId(kind);
    const lastMigratedAt = new Date().toISOString();

    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<MigrationCursorEntity>(KIND, id);

      if (!existing) {
        // First-write: cursor row absent → createOnly
        const entity: MigrationCursorEntity = { id, lastMigratedId, lastMigratedAt, ...(waveId ? { waveId } : {}) };
        const result = await this.substrate.createOnly(KIND, entity);
        if (result.ok) return;
        // createOnly conflict — concurrent first-creator beat us; retry from re-read
        continue;
      }

      // Subsequent-write: row exists → putIfMatch with current resourceVersion
      const updated: MigrationCursorEntity = {
        ...existing.entity,
        id,
        lastMigratedId,
        lastMigratedAt,
        ...(waveId ? { waveId } : {}),
      };
      const result = await this.substrate.putIfMatch(KIND, updated, existing.resourceVersion);
      if (result.ok) return;
      // revision-mismatch: concurrent writer advanced cursor; retry from re-read
    }
    throw new Error(`[MigrationCursorRepository] advanceCheckpoint exhausted ${MAX_CAS_RETRIES} retries on kind=${kind}`);
  }

  /**
   * Reset the checkpoint for a kind (e.g., for cutover-rehearsal teardown
   * or W6 closing-audit cleanup). Substrate.delete; no CAS (idempotent).
   */
  async resetCheckpoint(kind: string): Promise<void> {
    await this.substrate.delete(KIND, this.cursorId(kind));
  }
}
