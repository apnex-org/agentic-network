/**
 * Watchdog daemon (ADR-017).
 *
 * Stateless scanner that enforces PendingActionItem deadlines. Every tick,
 * it finds items whose deadline has passed and executes the escalation
 * ladder:
 *
 *   Stage 1 (attemptCount: 0 → 1) — Re-dispatch:
 *     • audit "comms_redispatch"
 *     • POST wakeEndpoint (if present)
 *     • extend receiptDeadline by receiptSla (grant another window)
 *
 *   Stage 2 (attemptCount: 1 → 2) — Demote liveness:
 *     • agent.livenessState = "degraded"
 *     • audit "agent_demoted"
 *     • POST wakeEndpoint (if present)
 *     • extend receiptDeadline
 *
 *   Stage 3 (attemptCount: 2 → 3) — Escalate to Director:
 *     • item.state = "escalated"
 *     • agent.livenessState = "unresponsive"
 *     • DirectorNotification.create(source="queue_item_escalated")
 *     • audit "queue_item_escalated"
 *
 * Stateless — all progress state lives on the queue item itself. Hub restart
 * resumes seamlessly from queue state.
 */

import type { Agent } from "../state.js";
import type { AllStores } from "./types.js";
import type { PendingActionItem } from "../entities/pending-action.js";

export type WakeClient = (wakeEndpoint: string, item: PendingActionItem) => Promise<void>;

export interface WatchdogOptions {
  stores: AllStores;
  /** Injectable HTTP client for wake-endpoint POSTs. Default is a no-op so
   *  tests don't fire real network calls; production wires a real client. */
  wakeClient?: WakeClient;
  /** Scan interval in ms. Defaults to 5000. */
  tickIntervalMs?: number;
  /** Optional logger for debug traces. */
  log?: (msg: string) => void;
}

const DEFAULT_TICK_INTERVAL_MS = 5_000;

export class Watchdog {
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly stores: AllStores;
  private readonly wakeClient: WakeClient;
  private readonly tickIntervalMs: number;
  private readonly log: (msg: string) => void;

  constructor(opts: WatchdogOptions) {
    this.stores = opts.stores;
    this.wakeClient = opts.wakeClient ?? (async () => {
      // Default: best-effort noop. Real deployments inject a fetch-based client.
    });
    this.tickIntervalMs = opts.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
    this.log = opts.log ?? (() => {});
  }

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => {
      this.tick().catch((err) => this.log(`[Watchdog] tick error: ${err?.message ?? err}`));
    }, this.tickIntervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /** Run one scan + escalation pass. Public so tests can drive deterministically. */
  async tick(): Promise<void> {
    const nowMs = Date.now();
    const expired = await this.stores.pendingAction.listExpired(nowMs);
    for (const item of expired) {
      await this.escalateOne(item, nowMs);
    }
  }

  private async escalateOne(item: PendingActionItem, nowMs: number): Promise<void> {
    // Fetch target agent for wake + demotion.
    const agent: Agent | null = await this.stores.engineerRegistry.getAgent(item.targetAgentId);
    const updated = await this.stores.pendingAction.incrementAttempt(item.id);
    if (!updated) return;
    const stage = updated.attemptCount;

    if (stage === 1) {
      await this.stores.audit.logEntry(
        "hub",
        "comms_redispatch",
        `Re-dispatching ${item.dispatchType} for ${item.entityRef} (queue item ${item.id}, targetAgent=${item.targetAgentId}, attempt 1)`,
        item.entityRef,
      );
      await this.wakeIfAble(agent, updated);
      await this.extendDeadline(item.id, nowMs, agent);
      this.log(`[Watchdog] Stage 1 re-dispatch: ${item.id}`);
    } else if (stage === 2) {
      if (agent) {
        await this.stores.engineerRegistry.setLivenessState(agent.engineerId, "degraded");
      }
      await this.stores.audit.logEntry(
        "hub",
        "agent_demoted",
        `Agent ${item.targetAgentId} demoted to degraded (queue item ${item.id} missed 2 deadlines, attempt 2)`,
        item.entityRef,
      );
      await this.wakeIfAble(agent, updated);
      await this.extendDeadline(item.id, nowMs, agent);
      this.log(`[Watchdog] Stage 2 demoted: ${item.targetAgentId}`);
    } else {
      // Stage 3+: escalate terminally.
      await this.stores.pendingAction.escalate(item.id, "receipt_deadline_missed_3x");
      if (agent) {
        await this.stores.engineerRegistry.setLivenessState(agent.engineerId, "unresponsive");
      }
      await this.stores.directorNotification.create({
        severity: "critical",
        source: "queue_item_escalated",
        sourceRef: item.id,
        title: `Agent ${item.targetAgentId} unresponsive — ${item.dispatchType} on ${item.entityRef}`,
        details: `Queue item ${item.id} (dispatchType=${item.dispatchType}, entityRef=${item.entityRef}) escalated after 3 deadline misses. Target agent ${item.targetAgentId} is marked unresponsive. Manual intervention required.`,
      });
      await this.stores.audit.logEntry(
        "hub",
        "queue_item_escalated",
        `Queue item ${item.id} escalated to Director (agent ${item.targetAgentId} unresponsive after 3 attempts)`,
        item.entityRef,
      );
      this.log(`[Watchdog] Stage 3 escalated: ${item.id}`);
    }
  }

  private async wakeIfAble(agent: Agent | null, _item: PendingActionItem): Promise<void> {
    if (!agent?.wakeEndpoint) return;
    try {
      await this.wakeClient(agent.wakeEndpoint, _item);
    } catch (err) {
      this.log(`[Watchdog] wake POST failed for ${agent.engineerId}: ${(err as any)?.message ?? err}`);
      // Wake failure is NOT terminal. The watchdog will try again on the
      // next tick; eventually Stage 3 escalates if no drain arrives.
    }
  }

  private async extendDeadline(itemId: string, nowMs: number, agent: Agent | null): Promise<void> {
    const sla = agent?.receiptSla ?? 30_000;
    const newDeadline = new Date(nowMs + sla).toISOString();
    await this.stores.pendingAction.rescheduleReceiptDeadline(itemId, newDeadline);
  }
}
