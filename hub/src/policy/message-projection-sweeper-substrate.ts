/**
 * mission-83 W3.x.1 — MessageProjectionSweeperSubstrate
 *
 * Substrate-API version of `MessageProjectionSweeper` (mission-51 W2; per
 * Design v1.3 §4 W3 row).
 *
 * Reads via `substrate.list('Thread')` + `substrate.get('Thread', id)` +
 * `substrate.list('Message', { filter: { migrationSourceId } })` directly —
 * NOT through IThreadStore/IMessageStore facades per architect-dispatch.
 *
 * Per α-reading: pure-additive at W3.x; production wire-up at hub/src/index.ts
 * UNCHANGED (still instantiates FS-version MessageProjectionSweeper); W5 cutover
 * swaps which sweeper-version is instantiated.
 *
 * Behavior preserved from FS-version sibling:
 *   - listThreads() scan + per-thread lastMessageProjectedAt < updatedAt skip
 *   - getThread(id) hydrated read with messages[] materialized
 *   - Per-message migrationSourceId find-or-create via substrate.list filter
 *   - createMessage with same migrationSourceId for idempotency
 *   - markLastMessageProjected forward-progress CAS-equivalent (substrate put)
 *   - Per-thread error isolation
 *
 * NEW capabilities vs FS-version:
 *   - AbortSignal cleanup per W1.4 substrate-side addition
 *
 * Per W3.x sweeper-port pattern established at ScheduledMessageSweeperSubstrate;
 * mechanical application + business-logic preservation.
 */

import type { HubStorageSubstrate, Filter } from "../storage-substrate/index.js";
import type { IPolicyContext } from "./types.js";
import type { Message } from "../entities/index.js";
import type { Thread } from "../state.js";

const DEFAULT_INTERVAL_MS = 5000;
const PROJECTION_NAMESPACE = "thread-message";
const THREAD_KIND = "Thread";
const MESSAGE_KIND = "Message";

export interface MessageProjectionSweeperSubstrateOptions {
  /** Polling interval in milliseconds. Default 5000ms (5s). */
  intervalMs?: number;
  /** Optional metrics counter. */
  metrics?: IPolicyContext["metrics"];
  /** Optional logger. */
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

export class MessageProjectionSweeperSubstrate {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;
  private readonly metrics: IPolicyContext["metrics"] | undefined;
  private readonly logger: { log: (m: string) => void; warn: (m: string, err?: unknown) => void };
  private readonly abort: AbortController;

  constructor(
    private readonly substrate: HubStorageSubstrate,
    options: MessageProjectionSweeperSubstrateOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.metrics = options.metrics;
    this.logger = options.logger ?? {
      log: (m) => console.log(`[MessageProjectionSweeperSubstrate] ${m}`),
      warn: (m, err) => console.warn(`[MessageProjectionSweeperSubstrate] ${m}`, err ?? ""),
    };
    this.abort = new AbortController();
  }

  async sweep(): Promise<SweepResult> {
    const result: SweepResult = {
      threadsScanned: 0,
      threadsProjected: 0,
      messagesProjected: 0,
      errors: 0,
    };

    // Substrate-API list (NOT through IThreadStore facade)
    const { items: threads } = await this.substrate.list<Thread>(THREAD_KIND);
    result.threadsScanned = threads.length;

    for (const scalar of threads) {
      try {
        const projectedAt = scalar.lastMessageProjectedAt;
        if (projectedAt && projectedAt >= scalar.updatedAt) continue;

        // Hydrate Thread (in substrate this is just the same scalar — messages[]
        // is embedded JSONB field on Thread per current shape). Re-read via
        // substrate.get for forward-compat if storage-layout splits later.
        const thread = await this.substrate.get<Thread>(THREAD_KIND, scalar.id);
        if (!thread) continue;
        const projected = await this.sweepThread(thread);
        if (projected > 0) {
          result.threadsProjected += 1;
          result.messagesProjected += projected;
        }
      } catch (err) {
        result.errors += 1;
        this.metrics?.increment("message_projection_sweeper_substrate.thread_error", {
          threadId: scalar.id,
          error: (err as Error)?.message ?? String(err),
        });
        this.logger.warn(`sweep failed for thread ${scalar.id}; skipping:`, err);
      }
    }

    if (result.messagesProjected > 0 || result.errors > 0) {
      this.logger.log(
        `sweep complete: scanned=${result.threadsScanned} projected=${result.threadsProjected} messages=${result.messagesProjected} errors=${result.errors}`,
      );
    }
    this.metrics?.increment("message_projection_sweeper_substrate.tick", result as unknown as Record<string, unknown>);
    return result;
  }

  /**
   * Per-thread sweep. Returns the number of messages projected this pass
   * (0 if the thread is already up-to-date).
   */
  private async sweepThread(thread: Thread): Promise<number> {
    const projected = thread.lastMessageProjectedAt;
    if (projected && projected >= thread.updatedAt) return 0;

    const messages = thread.messages ?? [];
    if (messages.length === 0) {
      // Empty thread — just bump the marker forward to avoid re-scanning
      await this.markLastMessageProjected(thread.id, thread.updatedAt);
      return 0;
    }

    let projectedThisPass = 0;
    for (let i = 0; i < messages.length; i++) {
      const seq = i + 1;  // 1-based per ThreadRepository's per-file seq
      const sourceId = `${PROJECTION_NAMESPACE}:${thread.id}/${seq}`;

      // Substrate-API findByMigrationSourceId equivalent: list with filter, take[0]
      const filter: Filter = { migrationSourceId: sourceId };
      const { items: existing } = await this.substrate.list<Message>(MESSAGE_KIND, { filter });
      if (existing.length > 0) continue;  // already projected

      const m = messages[i]!;
      const authorRole: "engineer" | "architect" =
        m.author === "engineer" ? "engineer" : "architect";
      const authorAgentId = m.authorAgentId ?? `anonymous-${m.author}`;

      // createMessage via substrate.put with the message shape
      // (Spike-quality: skip id-generation + sequence-allocation logic; that's
      // W4 repository-composition territory; here we synthesize a deterministic
      // id from sourceId for idempotency at substrate-API level)
      const messageId = `proj-${thread.id}-${seq}`;
      const newMessage = {
        id: messageId,
        kind: "reply",
        authorRole,
        authorAgentId,
        target: null,
        delivery: "push-immediate",
        threadId: thread.id,
        payload: { text: m.text },
        intent: m.intent ?? null,
        semanticIntent: m.semanticIntent ?? null,
        converged: m.converged ?? false,
        migrationSourceId: sourceId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await this.substrate.put(MESSAGE_KIND, newMessage);
      projectedThisPass += 1;
    }

    // Advance forward-progress marker
    await this.markLastMessageProjected(thread.id, thread.updatedAt);
    return projectedThisPass;
  }

  /**
   * Substrate-API equivalent of IThreadStore.markLastMessageProjected.
   * Forward-progress only: only advance the marker if new updatedAt > current.
   * Uses substrate get-then-put pattern (W4 full repository-composition will
   * add CAS retry per the existing markLastMessageProjected semantics).
   */
  private async markLastMessageProjected(threadId: string, newProjectedAt: string): Promise<void> {
    const current = await this.substrate.get<Thread>(THREAD_KIND, threadId);
    if (!current) return;
    const existing = current.lastMessageProjectedAt;
    if (existing && existing >= newProjectedAt) return;  // forward-progress invariant
    const updated = { ...current, lastMessageProjectedAt: newProjectedAt };
    await this.substrate.put(THREAD_KIND, updated);
  }

  async fullSweep(): Promise<SweepResult> {
    return this.sweep();
  }

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
          this.metrics?.increment("message_projection_sweeper_substrate.tick_error", {
            error: (err as Error)?.message ?? String(err),
          });
          this.logger.warn(`tick failed:`, err);
        } finally {
          inFlight = false;
        }
      })();
    }, this.intervalMs);
    if (typeof (this.timer as { unref?: () => void }).unref === "function") {
      (this.timer as { unref: () => void }).unref();
    }
    this.logger.log(`started; interval=${this.intervalMs}ms`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.abort.abort();
    this.logger.log(`stopped`);
  }

  get signal(): AbortSignal {
    return this.abort.signal;
  }
}
