/**
 * ScheduledMessageSweeper — mission-51 W4.
 *
 * Polls the Message store for scheduled messages whose `fireAt` has
 * been reached, evaluates the optional `precondition` predicate, and
 * fires (transition `scheduledState` pending → delivered) or cancels
 * (pending → precondition-failed). Cancellations write an audit-entry
 * for forensics.
 *
 * Pattern matches the W2 MessageProjectionSweeper: timer-based; per-
 * message error isolation; full-sweep on Hub-startup for resumption
 * across restart; idempotent on retry (already-transitioned messages
 * are skipped via the existing scheduledState filter on the query).
 *
 * Default tick interval: 1000ms (1s). Tighter than W2's 5s because
 * timing-sensitivity is higher for scheduled messages. Configurable
 * via env var or constructor option.
 *
 * Failed-trigger retry interlock (per W3 brief): the sweeper does NOT
 * directly handle retry logic — it just fires/cancels at fireAt. The
 * trigger runner's `retryFailedTrigger` helper enqueues a fresh
 * scheduled-message with backoff fireAt + retryCount metadata; the
 * sweeper picks it up like any other scheduled message. If the
 * sweeper-side fire ALSO fails (e.g., the original target store is
 * down), the runner's failure-handler can re-enqueue another retry
 * if `retryCount < maxRetries`.
 *
 * Per W0 spike: this sweeper consumes ONLY existing single-entity
 * atomic primitives (createMessage, markScheduledState). No new
 * contract surface.
 */

import type { IPolicyContext } from "./types.js";
import type {
  IMessageStore,
  Message,
} from "../entities/index.js";
import type { IAuditStore } from "../state.js";
import type { IThreadStore } from "../state.js";
import type { ITaskStore } from "../state.js";
import { evaluatePrecondition } from "./preconditions.js";

const DEFAULT_INTERVAL_MS = 1000;

export interface ScheduledMessageSweeperOptions {
  /** Polling interval in milliseconds. Default 1000ms (1s). */
  intervalMs?: number;
  /**
   * Optional metrics counter — same shape as IPolicyContext.metrics.
   * If absent, sweeper still runs but doesn't emit metrics.
   */
  metrics?: IPolicyContext["metrics"];
  /** Optional logger. Defaults to console; tests can pass a no-op. */
  logger?: {
    log: (msg: string) => void;
    warn: (msg: string, err?: unknown) => void;
  };
  /**
   * Optional time-source override for deterministic tests. Returns
   * milliseconds since epoch. Default = `Date.now()`.
   */
  now?: () => number;
}

export interface ScheduledSweepResult {
  scanned: number;
  fired: number;
  cancelled: number;
  errors: number;
}

/**
 * Subset of the policy context that the sweeper needs at fire/cancel
 * time. Constructed by the wiring layer in hub/src/index.ts so the
 * sweeper can call evaluatePrecondition (which needs ctx.stores) +
 * audit on cancel.
 */
export interface SweeperContextProvider {
  forSweeper(): IPolicyContext;
}

export class ScheduledMessageSweeper {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;
  private readonly metrics: IPolicyContext["metrics"] | undefined;
  private readonly logger: { log: (m: string) => void; warn: (m: string, err?: unknown) => void };
  private readonly now: () => number;

  constructor(
    private readonly messageStore: IMessageStore,
    private readonly auditStore: IAuditStore,
    private readonly contextProvider: SweeperContextProvider,
    options: ScheduledMessageSweeperOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.metrics = options.metrics;
    this.logger = options.logger ?? {
      log: (m) => console.log(`[ScheduledMessageSweeper] ${m}`),
      warn: (m, err) =>
        console.warn(`[ScheduledMessageSweeper] ${m}`, err ?? ""),
    };
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Single sweep pass. Returns counts for telemetry / test assertions.
   * Per-message errors are isolated (logged + metric'd; remaining
   * messages continue to be processed).
   */
  async sweep(): Promise<ScheduledSweepResult> {
    const result: ScheduledSweepResult = {
      scanned: 0,
      fired: 0,
      cancelled: 0,
      errors: 0,
    };

    const pending = await this.messageStore.listMessages({
      delivery: "scheduled",
      scheduledState: "pending",
    });
    result.scanned = pending.length;

    const nowMs = this.now();
    const ctx = this.contextProvider.forSweeper();

    for (const message of pending) {
      // Skip messages whose fireAt is in the future (don't fire early).
      if (!message.fireAt) {
        // Defensive: a scheduled-pending message without fireAt is
        // malformed; cancel it with a forensics audit entry rather
        // than leave it stuck.
        try {
          await this.cancelMessage(message, "malformed: missing fireAt", ctx);
          result.cancelled += 1;
        } catch (err) {
          result.errors += 1;
          this.logger.warn(
            `cancel failed for malformed message ${message.id}:`,
            err,
          );
        }
        continue;
      }
      const fireAtMs = new Date(message.fireAt).getTime();
      if (!Number.isFinite(fireAtMs)) {
        try {
          await this.cancelMessage(message, "malformed: invalid fireAt", ctx);
          result.cancelled += 1;
        } catch (err) {
          result.errors += 1;
          this.logger.warn(
            `cancel failed for invalid-fireAt message ${message.id}:`,
            err,
          );
        }
        continue;
      }
      if (fireAtMs > nowMs) continue;

      try {
        const decision = await evaluatePrecondition(message.precondition, ctx);
        if (decision.ok) {
          await this.fireMessage(message, decision.reason);
          result.fired += 1;
        } else {
          await this.cancelMessage(message, decision.reason, ctx);
          result.cancelled += 1;
        }
      } catch (err) {
        result.errors += 1;
        this.metrics?.increment("scheduled_message_sweeper.message_error", {
          messageId: message.id,
          error: (err as Error)?.message ?? String(err),
        });
        this.logger.warn(
          `sweep failed for message ${message.id}; skipping (other messages continue):`,
          err,
        );
      }
    }

    if (result.fired > 0 || result.cancelled > 0 || result.errors > 0) {
      this.logger.log(
        `sweep complete: scanned=${result.scanned} fired=${result.fired} cancelled=${result.cancelled} errors=${result.errors}`,
      );
    }
    this.metrics?.increment("scheduled_message_sweeper.tick", {
      scanned: result.scanned,
      fired: result.fired,
      cancelled: result.cancelled,
      errors: result.errors,
    });
    return result;
  }

  /**
   * Transition pending → delivered. Idempotent (markScheduledState
   * returns existing message unchanged on no-op).
   */
  private async fireMessage(message: Message, reason: string): Promise<void> {
    await this.messageStore.markScheduledState(message.id, "delivered");
    this.metrics?.increment("scheduled_message_sweeper.fired", {
      messageId: message.id,
      kind: message.kind,
      reason,
    });
  }

  /**
   * Transition pending → precondition-failed. Writes audit-entry for
   * forensics (so cancelled messages are traceable post-fact).
   * Idempotent.
   */
  private async cancelMessage(
    message: Message,
    reason: string,
    ctx: IPolicyContext,
  ): Promise<void> {
    await this.messageStore.markScheduledState(message.id, "precondition-failed");
    try {
      await this.auditStore.logEntry(
        "hub",
        "scheduled_message_cancelled",
        `Scheduled message ${message.id} (kind=${message.kind}, fireAt=${message.fireAt ?? "(missing)"}) cancelled: ${reason}`,
        message.id,
      );
    } catch (auditErr) {
      // Audit failures are non-fatal per cascade INV-TH26 stance.
      this.metrics?.increment("scheduled_message_sweeper.audit_failed", {
        messageId: message.id,
      });
      this.logger.warn(
        `audit-write failed for cancelled message ${message.id}; cancellation still committed:`,
        auditErr,
      );
    }
    this.metrics?.increment("scheduled_message_sweeper.cancelled", {
      messageId: message.id,
      kind: message.kind,
      reason,
    });
    void ctx;
  }

  /**
   * Run a single sweep pass synchronously. Use on Hub startup, before
   * serving traffic, to catch any scheduled messages whose fireAt was
   * reached while the previous Hub instance was down.
   */
  async fullSweep(): Promise<ScheduledSweepResult> {
    return this.sweep();
  }

  /**
   * Begin periodic sweeping. Skips ticks where a previous sweep is
   * still in flight. Idempotent: calling start() twice does not
   * double-tick.
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
          this.metrics?.increment("scheduled_message_sweeper.tick_error", {
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

  /** Stop periodic sweeping. Idempotent. */
  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.logger.log(`stopped`);
  }
}

// Force module-level type imports stay alive for ts isolatedModules.
void (null as unknown as IThreadStore | ITaskStore);
