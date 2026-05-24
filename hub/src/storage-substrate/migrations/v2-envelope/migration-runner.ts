/**
 * mission-88 W0 — migration-runner skeleton.
 *
 * Per thread-639 Q4 disposition: registry runner consumes per-kind
 * KindMigrationModule implementations (one per substrate-mediated kind).
 * Iterates rows of the kind via substrate.list; for each row, invokes
 * module.migrateOne(); writes encoded envelope back via substrate.put;
 * advances MigrationCursorRepository checkpoint.
 *
 * Resume-from-checkpoint per A2 thread-635 R2: on retry, reads cursor +
 * skips rows with id <= cursor.lastMigratedId. Sort by id ensures stable
 * resume across runs.
 *
 * W1-W5 per-kind modules register here. W0 ships the runner shell + the
 * MigrationCursorRepository integration; per-kind module-registration
 * happens in subsequent waves.
 */

import type { HubStorageSubstrate } from "../../index.js";
import type { KindMigrationModule } from "./kinds/_contract.js";
import { MigrationCursorRepository } from "../../../entities/migration-cursor-repository.js";
import { encodeEnvelope, isEnvelopeShape } from "./shared/envelope.js";

const LIST_PAGE = 500;

export interface MigrationRunOptions {
  /** Wave tag for cursor row (e.g., "W1"). Optional. */
  waveId?: string;
  /**
   * Override resume-from value. Used for cutover-rehearsal or explicit
   * reset; in normal operation, MigrationCursorRepository checkpoint is
   * the source of truth.
   */
  resumeFromId?: string;
  /** Stop after N rows; useful for cutover-rehearsal or smoke runs. */
  maxRows?: number;
  /** Dry-run: encode + emit count, do NOT write back. */
  dryRun?: boolean;
}

export interface MigrationRunResult {
  kind: string;
  rowsMigrated: number;
  rowsSkipped: number;   // Already envelope-shape; idempotency case
  rowsErrored: number;
  errors: Array<{ id: string; message: string }>;
}

export class MigrationRunner {
  private readonly modules = new Map<string, KindMigrationModule>();
  private readonly cursorRepo: MigrationCursorRepository;

  constructor(private readonly substrate: HubStorageSubstrate) {
    this.cursorRepo = new MigrationCursorRepository(substrate);
  }

  /**
   * Register a per-kind migration module. W1-W5 per-cluster authoring
   * calls this at module load. Subsequent registration for the same kind
   * is a programming error.
   */
  register(module: KindMigrationModule): void {
    if (this.modules.has(module.kind)) {
      throw new Error(`[MigrationRunner] duplicate registration for kind=${module.kind}`);
    }
    this.modules.set(module.kind, module);
  }

  /**
   * Run migration for one kind. Idempotent: re-running skips already-
   * encoded rows (isEnvelopeShape probe per shared/envelope.ts) +
   * resumes from cursor checkpoint.
   */
  async runKind(kind: string, opts: MigrationRunOptions = {}): Promise<MigrationRunResult> {
    const module = this.modules.get(kind);
    if (!module) {
      throw new Error(`[MigrationRunner] no module registered for kind=${kind}`);
    }

    const result: MigrationRunResult = {
      kind,
      rowsMigrated: 0,
      rowsSkipped: 0,
      rowsErrored: 0,
      errors: [],
    };

    // Resume-from-checkpoint
    const checkpoint = await this.cursorRepo.getCheckpoint(kind);
    const resumeFromId = opts.resumeFromId ?? checkpoint?.lastMigratedId ?? "";

    // Paginated list + per-row migrate. Note: list() doesn't support
    // id-greater-than filter at the substrate boundary today; we list all +
    // skip-until pattern. Acceptable at <100K rows per kind.
    let offset = 0;
    while (true) {
      const page = await this.substrate.list<{ id: string }>(kind, { limit: LIST_PAGE, offset });
      if (page.items.length === 0) break;

      for (const row of page.items) {
        if (resumeFromId && row.id <= resumeFromId) {
          continue;  // already migrated in a prior run
        }
        if (opts.maxRows !== undefined && result.rowsMigrated >= opts.maxRows) {
          return result;
        }
        try {
          const encoded = module.migrateOne(row);
          if (encoded === row || (isEnvelopeShape(row) && encoded === row)) {
            // Idempotency case: row was already envelope-shape; module returned it unchanged
            result.rowsSkipped++;
          } else if (!opts.dryRun) {
            await this.substrate.put(kind, encoded as { id: string });
            result.rowsMigrated++;
          } else {
            result.rowsMigrated++;  // dry-run: count as migrated
          }
          if (!opts.dryRun) {
            await this.cursorRepo.advanceCheckpoint(kind, row.id, opts.waveId);
          }
        } catch (e) {
          result.rowsErrored++;
          result.errors.push({
            id: row.id,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }

      offset += page.items.length;
      if (page.items.length < LIST_PAGE) break;
    }

    return result;
  }

  /**
   * Helper for tests + W6 closing-audit: list registered kinds.
   */
  registeredKinds(): string[] {
    return Array.from(this.modules.keys()).sort();
  }

  // Re-export for caller convenience.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static readonly _DEFAULT_API_VERSION = "core.ois/v1";
}

// Re-export envelope library for convenience
export { encodeEnvelope, isEnvelopeShape };
export { MigrationCursorRepository };
