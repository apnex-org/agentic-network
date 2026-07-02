/**
 * CascadeReplaySweeper — mission-51 W5.
 *
 * Hub-startup replay sweeper that closes the orphaned-mid-cascade gap
 * surfaced by bug-31 variants 1+2. On every Hub start, before serving
 * traffic, this sweeper:
 *
 *   1. Lists threads with `cascadePending: true` (the W5 marker
 *      written by `thread-policy.ts:handleThreadConvergedWithAction`
 *      before runCascade).
 *   2. Re-runs `runCascade` for each. Per-action idempotency
 *      (`findByCascadeKey` short-circuit on already-spawned entities)
 *      prevents duplication on replay; only actions that hadn't
 *      completed pre-crash actually re-execute.
 *   3. Clears the marker on each thread post-runCascade.
 *
 * Per W0 spike ratification: this composes the EXISTING saga-by-
 * construction cascade machinery with an explicit replay-on-restart
 * mechanism. No new contract surface. No new transactional primitive
 * at the StorageProvider layer. The cascade is already idempotency-
 * keyed; W5 just adds the trigger to re-run.
 *
 * Per-thread error isolation (mirrors W2 + W4 sweeper pattern):
 * one thread's failed re-run doesn't abort the remaining threads.
 * Failed re-runs leave the marker in place — the NEXT Hub-startup
 * will retry. No bounded retry loop here because Hub-restart is
 * already the natural retry boundary.
 *
 * Hub-startup-only (no periodic ticking): the cascade is
 * synchronously invoked from the convergence path during normal
 * operation; the replay sweeper exists ONLY to handle the case where
 * the Hub process dies before cascade completion. Periodic-tick
 * variant was considered but not implemented in v1 — Hub-startup is
 * sufficient because (a) the only way a marker stays set is process
 * death (in-process invocations always reach the clear), and (b)
 * any latency-sensitive cascade re-execution would prefer manual
 * triage over periodic-rerun-during-active-Hub.
 */

import type { IPolicyContext } from "./types.js";
import type { IThreadStore, Thread, StagedAction, IAuditStore } from "../state.js";
import { runCascade } from "./cascade.js";
import { escalateBareEnvelope } from "./bare-envelope-escalation.js";

export interface CascadeReplaySweeperOptions {
  metrics?: IPolicyContext["metrics"];
  /** C3-R4b piece 2: durable queryable sink for 0-bare-violation audit entries. */
  audit?: IAuditStore;
  logger?: {
    log: (msg: string) => void;
    warn: (msg: string, err?: unknown) => void;
    error?: (msg: string, err?: unknown) => void;
  };
}

export interface CascadeReplayResult {
  scanned: number;
  replayed: number;
  errors: number;
  /** C3-R4b piece 2: threads terminal-quarantined on a structural 0-bare defect. */
  quarantined: number;
}

export interface CascadeReplayContextProvider {
  forSweeper(): IPolicyContext;
}

export class CascadeReplaySweeper {
  private readonly metrics: IPolicyContext["metrics"] | undefined;
  private readonly audit: IAuditStore | undefined;
  private readonly logger: {
    log: (m: string) => void;
    warn: (m: string, err?: unknown) => void;
    error: (m: string, err?: unknown) => void;
  };

  constructor(
    private readonly threadStore: IThreadStore,
    private readonly contextProvider: CascadeReplayContextProvider,
    options: CascadeReplaySweeperOptions = {},
  ) {
    this.metrics = options.metrics;
    this.audit = options.audit;
    this.logger = {
      log: options.logger?.log ?? ((m) => console.log(`[CascadeReplaySweeper] ${m}`)),
      warn: options.logger?.warn ?? ((m, err) => console.warn(`[CascadeReplaySweeper] ${m}`, err ?? "")),
      error: options.logger?.error ?? ((m, err) => console.error(`[CascadeReplaySweeper] ${m}`, err ?? "")),
    };
  }

  /** C3-R4b piece 2: deps for the shared 0-bare escalation (durable audit +
   *  best-effort per-process metric + ERROR logger). */
  private escalationDeps(ctx: IPolicyContext) {
    return { audit: this.audit, metrics: ctx.metrics, logger: this.logger };
  }

  /**
   * Run a single sweep pass synchronously. Use on Hub startup, before
   * serving traffic. Returns counts for telemetry / test assertions.
   * Per-thread errors are isolated; one thread's failed replay does
   * NOT abort the remaining threads. A STRUCTURAL bare-envelope defect is
   * terminal-quarantined (not retried) + escalated loud/queryable (cal-84).
   */
  async fullSweep(): Promise<CascadeReplayResult> {
    const result: CascadeReplayResult = {
      scanned: 0,
      replayed: 0,
      errors: 0,
      quarantined: 0,
    };

    const ctx = this.contextProvider.forSweeper();

    let pendingThreads: Thread[];
    try {
      pendingThreads = await this.threadStore.listCascadePending();
    } catch (listErr) {
      // C3-R4b piece 2: a structural bare-envelope in the THREAD-list decode
      // throws mid-list (the offending thread can't be isolated per-item here).
      // Escalate LOUD + queryable and skip THIS sweep cycle — Hub still serves
      // (the index.ts startup wrap is a further backstop). NOT a silent swallow.
      if (
        await escalateBareEnvelope(
          listErr,
          { sweeper: "cascade-replay (cascadePending list)", entityRef: "(thread list)" },
          this.escalationDeps(ctx),
        )
      ) {
        result.quarantined += 1;
        return result;
      }
      throw listErr;
    }
    result.scanned = pendingThreads.length;
    if (result.scanned === 0) return result;

    for (const thread of pendingThreads) {
      try {
        await this.replayThread(thread, ctx);
        result.replayed += 1;
      } catch (err) {
        // C3-R4b piece 2: a STRUCTURAL bare-envelope (a spawned entity reached
        // replay still enveloped) is a PERMANENT defect — escalate loud +
        // queryable, then TERMINAL-QUARANTINE (markCascadeFailed → status
        // cascade_failed, which listCascadePending excludes) so it is NOT
        // re-dispatched, and CONTINUE so the other valid threads still replay.
        // This kills cal-84's silent-infinite-retry (do NOT preserve-the-marker).
        if (
          await escalateBareEnvelope(
            err,
            { sweeper: "cascade-replay", entityRef: thread.id },
            this.escalationDeps(ctx),
          )
        ) {
          result.quarantined += 1;
          try {
            await this.threadStore.markCascadeFailed(thread.id);
          } catch (quarErr) {
            this.logger.warn(
              `quarantine (markCascadeFailed) failed for thread ${thread.id}; it may re-list next startup:`,
              quarErr,
            );
          }
          continue;
        }
        // Existing TRANSIENT per-thread isolation — preserve marker for retry.
        result.errors += 1;
        this.metrics?.increment("cascade_replay.thread_error", {
          threadId: thread.id,
          error: (err as Error)?.message ?? String(err),
        });
        this.logger.warn(
          `replay failed for thread ${thread.id}; marker preserved for next Hub-startup retry:`,
          err,
        );
        // Don't clear the marker on failure — next Hub-startup will
        // retry. Failed-replay metric tracks this for operability.
      }
    }

    this.logger.log(
      `replay complete: scanned=${result.scanned} replayed=${result.replayed} errors=${result.errors} quarantined=${result.quarantined}`,
    );
    this.metrics?.increment("cascade_replay.sweep", {
      scanned: result.scanned,
      replayed: result.replayed,
      errors: result.errors,
      quarantined: result.quarantined,
    });
    return result;
  }

  /**
   * Replay a single thread's cascade. Re-runs runCascade against the
   * thread's committed convergenceActions. Existing per-action
   * idempotency (findByCascadeKey short-circuit on already-spawned
   * entities) makes this safe — only actions that hadn't completed
   * pre-crash actually re-execute.
   *
   * Marker is cleared post-runCascade regardless of cascade success
   * (matches the in-process clear path in thread-policy.ts).
   */
  private async replayThread(thread: Thread, ctx: IPolicyContext): Promise<void> {
    const committedActions = (thread.convergenceActions ?? []).filter(
      (a: StagedAction) => a.status === "committed",
    );
    if (committedActions.length === 0) {
      // No actions to replay — clear the marker and move on.
      await this.threadStore.markCascadeCompleted(thread.id);
      return;
    }

    const summaryForCascade = thread.summary?.trim() || "(no summary; cascade-replay)";

    this.logger.log(
      `replaying cascade for thread ${thread.id}: ${committedActions.length} committed action(s); summary="${summaryForCascade.substring(0, 80)}"`,
    );

    await runCascade(ctx, thread, committedActions, summaryForCascade);

    // Clear marker. Failure is non-fatal — next Hub-startup will
    // re-list and re-run; per-action idempotency catches duplicates.
    try {
      await this.threadStore.markCascadeCompleted(thread.id);
    } catch (clearErr) {
      this.metrics?.increment("cascade_replay.marker_clear_failed", {
        threadId: thread.id,
        error: (clearErr as Error)?.message ?? String(clearErr),
      });
      this.logger.warn(
        `marker clear failed for thread ${thread.id} post-replay; next Hub-startup will retry (idempotent):`,
        clearErr,
      );
    }
  }
}
