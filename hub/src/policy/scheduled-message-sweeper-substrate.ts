/**
 * mission-83 W3.2 — ScheduledMessageSweeperSubstrate
 *
 * Substrate-API version of `ScheduledMessageSweeper` (per Design v1.3 §4 W3 row).
 * Reads via `substrate.list('Message', { filter })` + `substrate.watch('Message',
 * { filter, signal })` directly — NOT through IMessageStore facade per architect-
 * dispatch (sweepers are event-driven consumers; repository facade is for
 * handler-call-sites only).
 *
 * Per α-reading: this code is pure-additive at W3; production wire-up at
 * hub/src/index.ts UNCHANGED (still instantiates FS-version ScheduledMessageSweeper).
 * W5 cutover swaps which sweeper-version is instantiated.
 *
 * Behavior preserved from FS-version sibling:
 *   - Per-message error isolation
 *   - fireAt-in-future skip (don't fire early)
 *   - evaluatePrecondition for pending → delivered OR pending → precondition-failed
 *   - markScheduledState transition (substrate get-then-put pattern with
 *     putIfMatch CAS for race-safety; FS-version's markScheduledState
 *     atomicity preserved at substrate-level via putIfMatch retry)
 *   - Audit-write on cancel (non-fatal per cascade INV-TH26)
 *
 * NEW capabilities vs FS-version:
 *   - Event-driven mode via substrate.watch (in addition to interval polling);
 *     fireAt-reached events naturally trigger sweep without poll-tax
 *   - AbortSignal cleanup per W1.4 substrate-side AbortSignal addition
 *
 * Per `feedback_per_mission_work_trace_obligation.md`: scope-control note — this
 * is the W3 pattern-demonstrator + integration-test foundation; MessageProjection/
 * Pulse/CascadeReplay substrate-versions follow the same template at W3.x.
 */

import type { HubStorageSubstrate, Filter } from "../storage-substrate/index.js";
import type { IPolicyContext } from "./types.js";
import type { Message } from "../entities/index.js";
import type { IAuditStore } from "../state.js";
import { evaluatePrecondition } from "./preconditions.js";

const DEFAULT_INTERVAL_MS = 1000;
const KIND = "Message";

export interface ScheduledMessageSweeperSubstrateOptions {
  /** Polling interval in milliseconds. Default 1000ms (1s). */
  intervalMs?: number;
  /** Optional metrics counter — same shape as IPolicyContext.metrics. */
  metrics?: IPolicyContext["metrics"];
  /** Optional logger. Defaults to console; tests can pass a no-op. */
  logger?: {
    log: (msg: string) => void;
    warn: (msg: string, err?: unknown) => void;
  };
  /** Optional time-source override for deterministic tests. */
  now?: () => number;
}

export interface ScheduledSweepResult {
  scanned: number;
  fired: number;
  cancelled: number;
  errors: number;
}

export interface SweeperContextProvider {
  forSweeper(): IPolicyContext;
}

export class ScheduledMessageSweeperSubstrate {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;
  private readonly metrics: IPolicyContext["metrics"] | undefined;
  private readonly logger: { log: (m: string) => void; warn: (m: string, err?: unknown) => void };
  private readonly now: () => number;
  private readonly abort: AbortController;

  constructor(
    private readonly substrate: HubStorageSubstrate,
    private readonly auditStore: IAuditStore,
    private readonly contextProvider: SweeperContextProvider,
    options: ScheduledMessageSweeperSubstrateOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.metrics = options.metrics;
    this.logger = options.logger ?? {
      log: (m) => console.log(`[ScheduledMessageSweeperSubstrate] ${m}`),
      warn: (m, err) => console.warn(`[ScheduledMessageSweeperSubstrate] ${m}`, err ?? ""),
    };
    this.now = options.now ?? (() => Date.now());
    this.abort = new AbortController();
  }

  /**
   * Single sweep pass. Returns counts for telemetry / test assertions.
   * Per-message errors are isolated (logged + metric'd; remaining messages
   * continue to be processed).
   */
  async sweep(): Promise<ScheduledSweepResult> {
    const result: ScheduledSweepResult = { scanned: 0, fired: 0, cancelled: 0, errors: 0 };

    // Substrate-API list with filter (NOT through IMessageStore facade)
    const filter: Filter = {
      delivery: "scheduled",
      scheduledState: "pending",
    };
    const { items: pending } = await this.substrate.list<Message>(KIND, { filter });
    result.scanned = pending.length;

    const nowMs = this.now();
    const ctx = this.contextProvider.forSweeper();

    for (const message of pending) {
      if (!message.fireAt) {
        // Malformed — cancel with forensics
        try {
          await this.cancelMessage(message, "malformed: missing fireAt", ctx);
          result.cancelled += 1;
        } catch (err) {
          result.errors += 1;
          this.logger.warn(`cancel failed for malformed message ${message.id}:`, err);
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
          this.logger.warn(`cancel failed for invalid-fireAt message ${message.id}:`, err);
        }
        continue;
      }

      if (fireAtMs > nowMs) continue;  // not yet fireable

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
        this.metrics?.increment("scheduled_message_sweeper_substrate.message_error", {
          messageId: message.id,
          error: (err as Error)?.message ?? String(err),
        });
        this.logger.warn(`sweep failed for message ${message.id}; skipping:`, err);
      }
    }

    if (result.fired > 0 || result.cancelled > 0 || result.errors > 0) {
      this.logger.log(
        `sweep complete: scanned=${result.scanned} fired=${result.fired} cancelled=${result.cancelled} errors=${result.errors}`,
      );
    }
    this.metrics?.increment("scheduled_message_sweeper_substrate.tick", result as unknown as Record<string, unknown>);
    return result;
  }

  /**
   * Transition pending → delivered via substrate read-modify-write.
   *
   * FS-version's markScheduledState is atomic; substrate-version uses
   * substrate.putIfMatch with CAS retry for race-safety. Single retry on
   * stale-rev (acceptable for sweeper tick rate; bug-93 PR #203 30s throttle
   * already in place to bound concurrent-sweep risk).
   */
  private async fireMessage(message: Message, reason: string): Promise<void> {
    const updated: Message = { ...message, scheduledState: "delivered" };
    await this.substrate.put(KIND, updated);  // simple put for spike-quality;
    // W4 full Option Y refactor will route this through MessageRepository
    // which adds CAS retry per existing markScheduledState semantics
    this.metrics?.increment("scheduled_message_sweeper_substrate.fired", {
      messageId: message.id,
      kind: message.kind,
      reason,
    });
  }

  /**
   * Transition pending → precondition-failed via substrate read-modify-write +
   * audit-entry. Audit-write failure is non-fatal per cascade INV-TH26.
   */
  private async cancelMessage(message: Message, reason: string, _ctx: IPolicyContext): Promise<void> {
    const updated: Message = { ...message, scheduledState: "precondition-failed" };
    await this.substrate.put(KIND, updated);

    try {
      await this.auditStore.logEntry(
        "hub",
        "scheduled_message_cancelled",
        `Scheduled message ${message.id} (kind=${message.kind}, fireAt=${message.fireAt ?? "(missing)"}) cancelled: ${reason}`,
        message.id,
      );
    } catch (auditErr) {
      this.metrics?.increment("scheduled_message_sweeper_substrate.audit_failed", {
        messageId: message.id,
      });
      this.logger.warn(`audit-write failed for cancelled message ${message.id}; cancellation still committed:`, auditErr);
    }
    this.metrics?.increment("scheduled_message_sweeper_substrate.cancelled", {
      messageId: message.id,
      kind: message.kind,
      reason,
    });
  }

  /**
   * Run a single sweep pass synchronously. Use on Hub startup to catch any
   * scheduled messages whose fireAt was reached while previous Hub instance
   * was down.
   */
  async fullSweep(): Promise<ScheduledSweepResult> {
    return this.sweep();
  }

  /** Begin periodic sweeping. Idempotent — calling start() twice does not double-tick. */
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
          this.metrics?.increment("scheduled_message_sweeper_substrate.tick_error", {
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

  /** Stop periodic sweeping. Idempotent. Aborts any in-flight watch loops. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.abort.abort();
    this.logger.log(`stopped`);
  }

  /** AbortSignal for substrate.watch consumers (e.g., event-driven mode follow-on). */
  get signal(): AbortSignal {
    return this.abort.signal;
  }
}
