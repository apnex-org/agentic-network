/**
 * PendingActionItem Entity (ADR-017).
 *
 * Authoritative record of work owed to a specific agent. Every
 * dispatched event that expects an agent response enqueues a
 * PendingActionItem BEFORE SSE fires (INV-COMMS-L01). SSE is a
 * delivery hint; the queue is truth.
 *
 * FSM:  enqueued → receipt_acked → completion_acked    (happy path)
 *                → escalated                            (Director handoff)
 *                → errored                              (non-recoverable)
 *
 * Natural-key idempotency: {targetAgentId, entityRef, dispatchType}.
 */

import type { EntityProvenance } from "../state.js";

export type PendingActionDispatchType =
  | "thread_message"
  | "thread_convergence_finalized"
  | "task_issued"
  | "proposal_submitted"
  | "report_created"
  | "review_requested";

export type PendingActionState =
  | "enqueued"
  | "receipt_acked"
  | "completion_acked"
  | "escalated"
  | "errored";

export interface PendingActionItem {
  id: string;
  targetAgentId: string;
  dispatchType: PendingActionDispatchType;
  entityRef: string;
  naturalKey: string;
  payload: Record<string, unknown>;
  enqueuedAt: string;
  receiptDeadline: string;
  completionDeadline: string;
  receiptAckedAt: string | null;
  completionAckedAt: string | null;
  attemptCount: number;
  lastAttemptAt: string | null;
  state: PendingActionState;
  escalationReason: string | null;
  /** Mission-24 idea-120: uniform direct-create provenance (task-305).
   *  Identity of the agent/role that enqueued this item. */
  createdBy?: EntityProvenance;
}

export interface EnqueueOptions {
  targetAgentId: string;
  dispatchType: PendingActionDispatchType;
  entityRef: string;
  payload: Record<string, unknown>;
  receiptSlaMs?: number;
  completionSlaMs?: number;
}

// Default SLAs (per-dispatch-type overrides at the policy layer).
// idea-105 (2026-04-19): bumped receipt SLA from 30s to 60s after dn-003
// false-positive — LLM-paced compose routinely exceeds 60s. Total watchdog
// ladder is 3× receiptSla; 60s gives a 180s total window matching observed
// reply compose-times without losing true-silence detection.
export const DEFAULT_RECEIPT_SLA_MS = 60_000;
export const DEFAULT_COMPLETION_SLA_MS = 5 * 60_000;

export interface IPendingActionStore {
  enqueue(opts: EnqueueOptions): Promise<PendingActionItem>;
  getById(id: string): Promise<PendingActionItem | null>;
  listForAgent(
    targetAgentId: string,
    filter?: { state?: PendingActionState },
  ): Promise<PendingActionItem[]>;
  receiptAck(id: string): Promise<PendingActionItem | null>;
  completionAck(id: string): Promise<PendingActionItem | null>;
  escalate(id: string, reason: string): Promise<PendingActionItem | null>;
  incrementAttempt(id: string): Promise<PendingActionItem | null>;
  /** Watchdog rescheduling: on stage-1/2 re-dispatch, push the receipt
   *  deadline forward so the agent gets another SLA window before the
   *  next escalation step. */
  rescheduleReceiptDeadline(id: string, newDeadline: string): Promise<PendingActionItem | null>;
  /** Watchdog scan: items whose deadline has passed and state is non-terminal. */
  listExpired(nowMs: number): Promise<PendingActionItem[]>;
  /**
   * idea-117 Phase 2c preamble — abandon a stuck queue item.
   *
   * Flips the item to `errored` state with `escalationReason` set to
   * the supplied abandonment reason. Idempotent on items already in a
   * terminal state (escalated / errored / completion_acked) — returns
   * the current snapshot without mutation.
   *
   * Used by the `prune_stuck_queue_items` admin tool to break
   * failure-amplification loops where items in `receipt_acked` state
   * are being redriven by a stale architect legacy-path.
   */
  abandon(id: string, reason: string): Promise<PendingActionItem | null>;
  /**
   * idea-117 Phase 2c preamble — list stuck items matching the pruner
   * criteria.
   *
   * Returns items whose state is `receipt_acked` (actively in flight
   * but never completion_acked) AND whose `enqueuedAt` is older than
   * `olderThanMs`. Optionally filtered by `dispatchType` and/or
   * `targetAgentId`. Does not mutate.
   */
  listStuck(opts: {
    olderThanMs: number;
    dispatchType?: PendingActionDispatchType;
    targetAgentId?: string;
  }): Promise<PendingActionItem[]>;
}

function naturalKey(opts: { targetAgentId: string; dispatchType: string; entityRef: string }): string {
  return `${opts.targetAgentId}:${opts.entityRef}:${opts.dispatchType}`;
}

function cloneItem(item: PendingActionItem): PendingActionItem {
  return { ...item, payload: { ...item.payload } };
}

export class MemoryPendingActionStore implements IPendingActionStore {
  private items = new Map<string, PendingActionItem>();
  private byNaturalKey = new Map<string, string>(); // naturalKey → id
  private counter = 0;

  async enqueue(opts: EnqueueOptions): Promise<PendingActionItem> {
    const key = naturalKey(opts);
    const existingId = this.byNaturalKey.get(key);
    if (existingId) {
      const existing = this.items.get(existingId);
      if (existing && existing.state !== "completion_acked" && existing.state !== "errored") {
        // INV-PA2 — idempotent re-enqueue on non-terminal items returns existing.
        return cloneItem(existing);
      }
      // Terminal item with same natural key — allow a new one (re-opens).
    }

    this.counter++;
    const now = new Date();
    const receiptSla = opts.receiptSlaMs ?? DEFAULT_RECEIPT_SLA_MS;
    const completionSla = opts.completionSlaMs ?? DEFAULT_COMPLETION_SLA_MS;
    const id = `pa-${now.toISOString().replace(/[:.]/g, "-")}-${this.counter.toString(36)}`;
    const item: PendingActionItem = {
      id,
      targetAgentId: opts.targetAgentId,
      dispatchType: opts.dispatchType,
      entityRef: opts.entityRef,
      naturalKey: key,
      payload: { ...opts.payload },
      enqueuedAt: now.toISOString(),
      receiptDeadline: new Date(now.getTime() + receiptSla).toISOString(),
      completionDeadline: new Date(now.getTime() + completionSla).toISOString(),
      receiptAckedAt: null,
      completionAckedAt: null,
      attemptCount: 0,
      lastAttemptAt: null,
      state: "enqueued",
      escalationReason: null,
    };
    this.items.set(id, item);
    this.byNaturalKey.set(key, id);
    return cloneItem(item);
  }

  async getById(id: string): Promise<PendingActionItem | null> {
    const item = this.items.get(id);
    return item ? cloneItem(item) : null;
  }

  async listForAgent(
    targetAgentId: string,
    filter?: { state?: PendingActionState },
  ): Promise<PendingActionItem[]> {
    const out: PendingActionItem[] = [];
    for (const item of this.items.values()) {
      if (item.targetAgentId !== targetAgentId) continue;
      if (filter?.state && item.state !== filter.state) continue;
      out.push(cloneItem(item));
    }
    return out;
  }

  async receiptAck(id: string): Promise<PendingActionItem | null> {
    const item = this.items.get(id);
    if (!item) return null;
    if (item.state !== "enqueued") return cloneItem(item); // idempotent
    item.state = "receipt_acked";
    item.receiptAckedAt = new Date().toISOString();
    return cloneItem(item);
  }

  async completionAck(id: string): Promise<PendingActionItem | null> {
    const item = this.items.get(id);
    if (!item) return null;
    if (item.state === "completion_acked") return cloneItem(item); // idempotent
    item.state = "completion_acked";
    item.completionAckedAt = new Date().toISOString();
    if (!item.receiptAckedAt) item.receiptAckedAt = item.completionAckedAt;
    return cloneItem(item);
  }

  async escalate(id: string, reason: string): Promise<PendingActionItem | null> {
    const item = this.items.get(id);
    if (!item) return null;
    item.state = "escalated";
    item.escalationReason = reason;
    return cloneItem(item);
  }

  async incrementAttempt(id: string): Promise<PendingActionItem | null> {
    const item = this.items.get(id);
    if (!item) return null;
    item.attemptCount += 1;
    item.lastAttemptAt = new Date().toISOString();
    return cloneItem(item);
  }

  async rescheduleReceiptDeadline(id: string, newDeadline: string): Promise<PendingActionItem | null> {
    const item = this.items.get(id);
    if (!item) return null;
    item.receiptDeadline = newDeadline;
    return cloneItem(item);
  }

  async listExpired(nowMs: number): Promise<PendingActionItem[]> {
    const out: PendingActionItem[] = [];
    for (const item of this.items.values()) {
      if (item.state === "completion_acked" || item.state === "escalated" || item.state === "errored") continue;
      const deadline = item.state === "enqueued"
        ? new Date(item.receiptDeadline).getTime()
        : new Date(item.completionDeadline).getTime();
      if (nowMs >= deadline) out.push(cloneItem(item));
    }
    return out;
  }

  async abandon(id: string, reason: string): Promise<PendingActionItem | null> {
    const item = this.items.get(id);
    if (!item) return null;
    // Idempotent on terminal states — caller observes current snapshot.
    if (item.state === "completion_acked" || item.state === "errored" || item.state === "escalated") {
      return cloneItem(item);
    }
    item.state = "errored";
    item.escalationReason = reason;
    return cloneItem(item);
  }

  async listStuck(opts: {
    olderThanMs: number;
    dispatchType?: PendingActionDispatchType;
    targetAgentId?: string;
  }): Promise<PendingActionItem[]> {
    const nowMs = Date.now();
    const out: PendingActionItem[] = [];
    for (const item of this.items.values()) {
      if (item.state !== "receipt_acked") continue;
      if (opts.dispatchType && item.dispatchType !== opts.dispatchType) continue;
      if (opts.targetAgentId && item.targetAgentId !== opts.targetAgentId) continue;
      const enqueuedMs = new Date(item.enqueuedAt).getTime();
      if (nowMs - enqueuedMs < opts.olderThanMs) continue;
      out.push(cloneItem(item));
    }
    return out;
  }
}
