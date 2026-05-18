/**
 * mission-83 W3.x.3 — CascadeReplaySweeperSubstrate
 *
 * Substrate-API version of `CascadeReplaySweeper` (mission-51 W5; per Design v1.3
 * §4 W3 row).
 *
 * Reads via `substrate.list('Thread', { filter: { cascadePending: true } })`
 * directly — NOT through IThreadStore facade per architect-dispatch.
 *
 * Per α-reading: pure-additive at W3.x; production wire-up at hub/src/index.ts
 * UNCHANGED (still instantiates FS-version CascadeReplaySweeper); W5 cutover
 * swaps which sweeper-version is instantiated.
 *
 * Behavior preserved from FS-version sibling:
 *   - listCascadePending() equivalent via substrate.list with filter
 *   - Hub-startup-only (no periodic ticking; cascade is synchronously invoked
 *     from convergence path during normal operation; replay handles process-
 *     death case)
 *   - Per-thread error isolation
 *   - Re-runs `runCascade(ctx, thread, committedActions, summaryForCascade)` —
 *     existing per-action idempotency (findByCascadeKey short-circuit) prevents
 *     duplication on replay
 *   - markCascadeCompleted forward-progress (substrate get-then-put pattern)
 *   - Failure preserves marker for next Hub-startup retry (no bounded retry
 *     loop here; Hub-restart is the natural retry boundary)
 */

import type { HubStorageSubstrate, Filter } from "../storage-substrate/index.js";
import type { IPolicyContext } from "./types.js";
import type { Thread, StagedAction } from "../state.js";
import { runCascade } from "./cascade.js";

const THREAD_KIND = "Thread";

export interface CascadeReplaySweeperSubstrateOptions {
  metrics?: IPolicyContext["metrics"];
  logger?: {
    log: (msg: string) => void;
    warn: (msg: string, err?: unknown) => void;
  };
}

export interface CascadeReplayResult {
  scanned: number;
  replayed: number;
  errors: number;
}

export interface CascadeReplayContextProvider {
  forSweeper(): IPolicyContext;
}

export class CascadeReplaySweeperSubstrate {
  private readonly metrics: IPolicyContext["metrics"] | undefined;
  private readonly logger: { log: (m: string) => void; warn: (m: string, err?: unknown) => void };

  constructor(
    private readonly substrate: HubStorageSubstrate,
    private readonly contextProvider: CascadeReplayContextProvider,
    options: CascadeReplaySweeperSubstrateOptions = {},
  ) {
    this.metrics = options.metrics;
    this.logger = options.logger ?? {
      log: (m) => console.log(`[CascadeReplaySweeperSubstrate] ${m}`),
      warn: (m, err) => console.warn(`[CascadeReplaySweeperSubstrate] ${m}`, err ?? ""),
    };
  }

  async fullSweep(): Promise<CascadeReplayResult> {
    const result: CascadeReplayResult = {
      scanned: 0,
      replayed: 0,
      errors: 0,
    };

    // Substrate-API listCascadePending equivalent
    const filter: Filter = { cascadePending: true };
    const { items: pendingThreads } = await this.substrate.list<Thread>(THREAD_KIND, { filter });
    result.scanned = pendingThreads.length;
    if (result.scanned === 0) return result;

    const ctx = this.contextProvider.forSweeper();

    for (const thread of pendingThreads) {
      try {
        await this.replayThread(thread, ctx);
        result.replayed += 1;
      } catch (err) {
        result.errors += 1;
        this.metrics?.increment("cascade_replay_substrate.thread_error", {
          threadId: thread.id,
          error: (err as Error)?.message ?? String(err),
        });
        this.logger.warn(
          `replay failed for thread ${thread.id}; marker preserved for next Hub-startup retry:`,
          err,
        );
      }
    }

    this.logger.log(
      `replay complete: scanned=${result.scanned} replayed=${result.replayed} errors=${result.errors}`,
    );
    this.metrics?.increment("cascade_replay_substrate.sweep", result as unknown as Record<string, unknown>);
    return result;
  }

  /**
   * Replay a single thread's cascade. Re-runs runCascade against the thread's
   * committed convergenceActions. Per-action idempotency (findByCascadeKey
   * short-circuit) makes this safe — only actions that hadn't completed pre-
   * crash actually re-execute.
   */
  private async replayThread(thread: Thread, ctx: IPolicyContext): Promise<void> {
    const committedActions = (thread.convergenceActions ?? []).filter(
      (a: StagedAction) => a.status === "committed",
    );
    if (committedActions.length === 0) {
      // No actions to replay — clear the marker and move on
      await this.markCascadeCompleted(thread.id);
      return;
    }

    const summaryForCascade = thread.summary?.trim() || "(no summary; cascade-replay)";

    this.logger.log(
      `replaying cascade for thread ${thread.id}: ${committedActions.length} committed action(s); summary="${summaryForCascade.substring(0, 80)}"`,
    );

    await runCascade(ctx, thread, committedActions, summaryForCascade);

    // Clear marker. Failure is non-fatal — next Hub-startup will re-list +
    // re-run; per-action idempotency catches duplicates.
    try {
      await this.markCascadeCompleted(thread.id);
    } catch (clearErr) {
      this.metrics?.increment("cascade_replay_substrate.marker_clear_failed", {
        threadId: thread.id,
        error: (clearErr as Error)?.message ?? String(clearErr),
      });
      this.logger.warn(
        `marker clear failed for thread ${thread.id} post-replay; next Hub-startup will retry (idempotent):`,
        clearErr,
      );
    }
  }

  /**
   * Substrate-API equivalent of IThreadStore.markCascadeCompleted.
   * Get-then-put pattern: read thread, flip cascadePending → false (or remove),
   * write back. Spike-quality: simple put; W4 full repository-composition adds
   * CAS retry per existing markCascadeCompleted semantics.
   */
  private async markCascadeCompleted(threadId: string): Promise<void> {
    const current = await this.substrate.get<Thread>(THREAD_KIND, threadId);
    if (!current) return;
    const updated = { ...current, cascadePending: false };
    await this.substrate.put(THREAD_KIND, updated);
  }
}
