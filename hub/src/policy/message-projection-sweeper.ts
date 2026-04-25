/**
 * MessageProjectionSweeper — mission-51 W2.
 *
 * Bounded-shadow polling sweeper backstop for the W1 in-process
 * thread-message migration shim. The shim writes through synchronously
 * on each thread-reply commit (~ms latency); this sweeper closes any
 * gaps that the in-process projector missed (e.g., shim failure logged
 * + skipped per the non-fatal failure mode; Hub crash between
 * legacy-message persist and shim-call).
 *
 * Algorithm (per W0 spike ratified path; PR #42 / 29b26c2):
 *   - Every interval (default 5s): scan `listThreads()` for threads
 *     where `lastMessageProjectedAt < updatedAt` (or absent).
 *   - For each such thread, walk `Thread.messages[]` and for each
 *     position i (sequence = i+1, 1-based per ThreadRepository's per-
 *     file layout `threads/<id>/messages/<seq>.json`), check
 *     `findByMigrationSourceId("thread-message:<threadId>/<seq>")`.
 *     If absent, project via `createMessage` with the same
 *     migrationSourceId (idempotent; createMessage's find-or-create
 *     short-circuit prevents duplicates).
 *   - After all messages projected, advance `Thread.lastMessageProjectedAt`
 *     to the thread's current `updatedAt` via the forward-progress-only
 *     `markLastMessageProjected` CAS.
 *
 * Bounded shadow-lag invariant: any thread-reply commit at time T
 * has its corresponding Message-store entry visible by T + (interval +
 * sweep duration). For the 5s default interval, lag ≤ 5s + sweep
 * runtime (small). Verified empirically via the bounded-lag test.
 *
 * Hub-restart resumption: `fullSweep()` runs once before serving
 * traffic on Hub startup. Catches any threads orphaned mid-projection
 * by the previous Hub instance dying.
 *
 * Idempotency: re-projection produces no duplicates. `createMessage`
 * with populated `migrationSourceId` does find-or-create at the
 * MessageRepository level; subsequent sweeper iterations see the
 * same migrationSourceId already present and skip.
 *
 * Failure handling: per-thread errors are logged + metric'd + isolated
 * (don't abort the remaining threads). Mirrors the cascade-runner's
 * INV-TH26 audit-recoverability stance.
 */

import type { IThreadStore, Thread } from "../state.js";
import type { IPolicyContext } from "./types.js";
import type { IMessageStore } from "../entities/index.js";

const DEFAULT_INTERVAL_MS = 5000;
const PROJECTION_NAMESPACE = "thread-message";

export interface MessageProjectionSweeperOptions {
  /** Polling interval in milliseconds. Default 5000ms (5s). */
  intervalMs?: number;
  /**
   * Optional metrics counter — same shape as IPolicyContext.metrics.
   * If absent, sweeper still runs but doesn't emit metrics.
   */
  metrics?: IPolicyContext["metrics"];
  /**
   * Optional logger. Defaults to console; tests can pass a no-op.
   */
  logger?: {
    log: (msg: string) => void;
    warn: (msg: string, err?: unknown) => void;
  };
}

export interface SweepResult {
  threadsScanned: number;
  threadsProjected: number;
  messagesProjected: number;
  errors: number;
}

export class MessageProjectionSweeper {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;
  private readonly metrics: IPolicyContext["metrics"] | undefined;
  private readonly logger: { log: (m: string) => void; warn: (m: string, err?: unknown) => void };

  constructor(
    private readonly threadStore: IThreadStore,
    private readonly messageStore: IMessageStore,
    options: MessageProjectionSweeperOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.metrics = options.metrics;
    this.logger = options.logger ?? {
      log: (m) => console.log(`[MessageProjectionSweeper] ${m}`),
      warn: (m, err) =>
        console.warn(`[MessageProjectionSweeper] ${m}`, err ?? ""),
    };
  }

  /**
   * Run a single sweep pass synchronously. Returns counts for telemetry.
   * Safe to call concurrently with `start()`'s timer ticks (the timer
   * doesn't re-enter while a sweep is in-flight; see start()).
   */
  async sweep(): Promise<SweepResult> {
    const result: SweepResult = {
      threadsScanned: 0,
      threadsProjected: 0,
      messagesProjected: 0,
      errors: 0,
    };

    // listThreads returns scalar-only threads (no message[] hydration).
    // Per-thread sweep calls getThread(id) to hydrate messages from
    // the per-file storage layout (threads/<id>/messages/<seq>.json).
    const threadScalars = await this.threadStore.listThreads();
    result.threadsScanned = threadScalars.length;

    for (const scalar of threadScalars) {
      try {
        // Skip threads already up-to-date based on the scalar marker —
        // saves a getThread round-trip on the common steady-state path
        // where the in-process W1 projector has been keeping up.
        const projectedAt = scalar.lastMessageProjectedAt;
        if (projectedAt && projectedAt >= scalar.updatedAt) continue;

        const thread = await this.threadStore.getThread(scalar.id);
        if (!thread) continue;
        const projected = await this.sweepThread(thread);
        if (projected > 0) {
          result.threadsProjected += 1;
          result.messagesProjected += projected;
        }
      } catch (err) {
        result.errors += 1;
        this.metrics?.increment("message_projection_sweeper.thread_error", {
          threadId: scalar.id,
          error: (err as Error)?.message ?? String(err),
        });
        this.logger.warn(
          `sweep failed for thread ${scalar.id}; skipping (other threads continue):`,
          err,
        );
      }
    }

    if (result.messagesProjected > 0 || result.errors > 0) {
      this.logger.log(
        `sweep complete: scanned=${result.threadsScanned} projected=${result.threadsProjected} ` +
          `messages=${result.messagesProjected} errors=${result.errors}`,
      );
    }
    this.metrics?.increment("message_projection_sweeper.tick", {
      threadsScanned: result.threadsScanned,
      threadsProjected: result.threadsProjected,
      messagesProjected: result.messagesProjected,
      errors: result.errors,
    });
    return result;
  }

  /**
   * Per-thread sweep. Returns the number of messages projected this
   * pass (0 if the thread is already up-to-date).
   */
  private async sweepThread(thread: Thread): Promise<number> {
    // Skip threads that are already up-to-date. The marker is
    // forward-progress only, so absent or strictly-older means there
    // are unprojected messages OR the thread was created pre-W2.
    const projected = thread.lastMessageProjectedAt;
    if (projected && projected >= thread.updatedAt) return 0;

    const messages = thread.messages ?? [];
    if (messages.length === 0) {
      // Empty thread (very rare) — just bump the marker forward to
      // avoid re-scanning every tick.
      await this.threadStore.markLastMessageProjected(thread.id, thread.updatedAt);
      return 0;
    }

    let projectedThisPass = 0;
    for (let i = 0; i < messages.length; i++) {
      const seq = i + 1; // ThreadRepository's per-file seq is 1-based
      const sourceId = `${PROJECTION_NAMESPACE}:${thread.id}/${seq}`;
      const existing = await this.messageStore.findByMigrationSourceId(sourceId);
      if (existing) continue;

      const m = messages[i];
      const authorRole: "engineer" | "architect" =
        m.author === "engineer" ? "engineer" : "architect";
      const authorAgentId = m.authorAgentId ?? `anonymous-${m.author}`;

      await this.messageStore.createMessage({
        kind: "reply",
        authorRole,
        authorAgentId,
        target: null,
        delivery: "push-immediate",
        threadId: thread.id,
        payload: { text: m.text },
        intent: m.intent ?? undefined,
        semanticIntent: m.semanticIntent ?? undefined,
        converged: m.converged,
        migrationSourceId: sourceId,
      });
      projectedThisPass += 1;
    }

    // Advance the marker — best-effort forward-progress. If a fresh
    // reply lands between the loop above and this CAS, the next tick
    // will see lastMessageProjectedAt < new updatedAt and re-sweep.
    await this.threadStore.markLastMessageProjected(thread.id, thread.updatedAt);

    return projectedThisPass;
  }

  /**
   * Run a single sweep pass synchronously. Use this on Hub startup,
   * before serving traffic, to catch any threads orphaned mid-
   * projection by the previous Hub instance dying.
   */
  async fullSweep(): Promise<SweepResult> {
    return this.sweep();
  }

  /**
   * Begin periodic sweeping. The timer skips ticks where a previous
   * sweep is still in flight (no overlap). Idempotent: calling start()
   * twice does not double-tick.
   */
  start(): void {
    if (this.timer) return;
    let inFlight = false;
    this.timer = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void (async () => {
        try {
          await this.sweep();
        } catch (err) {
          this.metrics?.increment("message_projection_sweeper.tick_error", {
            error: (err as Error)?.message ?? String(err),
          });
          this.logger.warn(`tick failed:`, err);
        } finally {
          inFlight = false;
        }
      })();
    }, this.intervalMs);
    // Allow the Node.js event loop to exit even if this timer is
    // active (matches the existing reaper pattern in index.ts).
    if (typeof (this.timer as { unref?: () => void }).unref === "function") {
      (this.timer as { unref: () => void }).unref();
    }
    this.logger.log(`started; interval=${this.intervalMs}ms`);
  }

  /** Stop periodic sweeping. Idempotent. */
  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.logger.log(`stopped`);
  }
}
