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
  | "errored"
  /**
   * M-Hypervisor-Adapter-Mitigations Task 1b (task-314) — "Graceful
   * Exhaustion" state. Set when the target agent calls
   * `save_continuation(queueItemId, payload)` because its
   * round-budget is approaching the cap. The item's current dispatch
   * is paused; `continuationState` holds the resumption payload
   * (caller-opaque JSON, conventionally `{kind, ...}` — v1 kinds
   * are "llm_state" for graceful-exhaustion snapshots and
   * "chunk_buffer" for task-313 oversize-reply durability per
   * idea-145 Path 2 unification). The Hub's dispatcher re-emits
   * the item on the next tick with `continuationState` embedded in
   * the payload so the adapter can resume from the snapshot rather
   * than re-run from scratch.
   */
  | "continuation_required";

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
  /**
   * M-Hypervisor-Adapter-Mitigations Task 1b (task-314). Set by
   * `save_continuation` when the target agent's round-budget runs
   * low. Shape is caller-opaque — v1 conventions: `{kind: "llm_state",
   * snapshot, currentRound}` for graceful-exhaustion LLM snapshots;
   * `{kind: "chunk_buffer", remainingChunks, finalArgs}` for the
   * task-313 oversize-reply persistence (idea-145 Path 2). Adapter
   * branches on `kind` at resumption time. Cleared (reset to
   * undefined) on re-dispatch pickup so the item's FSM settles
   * after one resumption cycle.
   */
  continuationState?: Record<string, unknown>;
  /**
   * M-Hypervisor-Adapter-Mitigations Task 1b (task-314). Timestamp
   * when `save_continuation` most recently set `continuationState`
   * on this item. Used by the re-dispatch sweep to prioritize
   * oldest-first + by operators to diagnose stuck continuations.
   */
  continuationSavedAt?: string | null;
}

export interface EnqueueOptions {
  targetAgentId: string;
  dispatchType: PendingActionDispatchType;
  entityRef: string;
  payload: Record<string, unknown>;
  receiptSlaMs?: number;
  completionSlaMs?: number;
  /** Mission-24 idea-120 / task-305: identity of the enqueueing agent. */
  createdBy?: EntityProvenance;
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
  /**
   * bug-19 / idea-123: look up the open pending-action item that matches
   * the natural key `{targetAgentId, entityRef, dispatchType}`. Returns
   * null if no open (non-terminal) item exists. Terminal items
   * (completion_acked / escalated / errored) are excluded so repeat
   * replies don't accidentally resurrect a closed dispatch.
   *
   * Used by `create_thread_reply` to auto-settle an outstanding
   * dispatch without requiring the LLM to plumb `sourceQueueItemId`.
   */
  findOpenByNaturalKey(opts: { targetAgentId: string; entityRef: string; dispatchType: PendingActionDispatchType }): Promise<PendingActionItem | null>;
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
  /**
   * Phase 2d CP3 C1 — list all non-terminal queue items bound to a
   * specific entityRef. Used by the thread reaper to enumerate queue
   * items tied to a reaped thread so they can be `abandon`ed in the
   * same cycle (queue-thread bidirectional integrity per thread-224
   * consensus).
   *
   * Non-terminal = state in {enqueued, receipt_acked}. Terminal items
   * (completion_acked / escalated / errored) are excluded.
   */
  listNonTerminalByEntityRef(entityRef: string): Promise<PendingActionItem[]>;
  /**
   * Task 1b (task-314) — "Graceful Exhaustion" save-continuation
   * transition. Called by the target agent via the `save_continuation`
   * MCP tool when round-budget runs low. Transitions the item to
   * `continuation_required` + persists the caller-opaque
   * `continuationState` payload. Guarded: returns null if the item
   * doesn't exist, the caller is not the item's targetAgentId, or
   * the item is in a terminal state. Idempotent on items already
   * in `continuation_required` (last-save-wins — the newest
   * continuationState replaces any prior one + `continuationSavedAt`
   * bumps).
   */
  saveContinuation(
    id: string,
    callerAgentId: string,
    continuationState: Record<string, unknown>,
  ): Promise<PendingActionItem | null>;
  /**
   * Task 1b (task-314) — list items awaiting continuation re-dispatch.
   * Returns items in `continuation_required` state, oldest-first by
   * `continuationSavedAt` so the dispatcher drains the queue in
   * arrival order. Does not mutate.
   */
  listContinuationItems(): Promise<PendingActionItem[]>;
  /**
   * Task 1b (task-314) — clear continuation state as part of the
   * re-dispatch cycle. Transitions the item from
   * `continuation_required` back to `enqueued` + returns the former
   * `continuationState` so the caller can embed it in the outbound
   * dispatch payload. No-op (returns null) if the item is not in
   * `continuation_required` state.
   */
  resumeContinuation(id: string): Promise<{
    item: PendingActionItem;
    continuationState: Record<string, unknown>;
  } | null>;
}

function naturalKey(opts: { targetAgentId: string; dispatchType: string; entityRef: string }): string {
  return `${opts.targetAgentId}:${opts.entityRef}:${opts.dispatchType}`;
}

function cloneItem(item: PendingActionItem): PendingActionItem {
  return {
    ...item,
    payload: { ...item.payload },
    ...(item.continuationState ? { continuationState: { ...item.continuationState } } : {}),
  };
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
      createdBy: opts.createdBy,
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

  async findOpenByNaturalKey(opts: { targetAgentId: string; entityRef: string; dispatchType: PendingActionDispatchType }): Promise<PendingActionItem | null> {
    const key = naturalKey(opts);
    const id = this.byNaturalKey.get(key);
    if (!id) return null;
    const item = this.items.get(id);
    if (!item) return null;
    // Only return open (non-terminal) items. A terminal item with the
    // same natural key is history — repeat replies don't resurrect it.
    if (item.state === "completion_acked" || item.state === "escalated" || item.state === "errored") return null;
    return cloneItem(item);
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

  async saveContinuation(
    id: string,
    callerAgentId: string,
    continuationState: Record<string, unknown>,
  ): Promise<PendingActionItem | null> {
    const item = this.items.get(id);
    if (!item) return null;
    if (item.targetAgentId !== callerAgentId) return null;
    if (
      item.state === "completion_acked" ||
      item.state === "errored" ||
      item.state === "escalated"
    ) {
      // Terminal items cannot transition to continuation_required.
      return null;
    }
    item.state = "continuation_required";
    item.continuationState = { ...continuationState };
    item.continuationSavedAt = new Date().toISOString();
    return cloneItem(item);
  }

  async listContinuationItems(): Promise<PendingActionItem[]> {
    const out: PendingActionItem[] = [];
    for (const item of this.items.values()) {
      if (item.state !== "continuation_required") continue;
      out.push(cloneItem(item));
    }
    // Oldest-first by continuationSavedAt for fair re-dispatch ordering.
    out.sort((a, b) => {
      const at = a.continuationSavedAt ? Date.parse(a.continuationSavedAt) : 0;
      const bt = b.continuationSavedAt ? Date.parse(b.continuationSavedAt) : 0;
      return at - bt;
    });
    return out;
  }

  async resumeContinuation(id: string): Promise<{
    item: PendingActionItem;
    continuationState: Record<string, unknown>;
  } | null> {
    const item = this.items.get(id);
    if (!item) return null;
    if (item.state !== "continuation_required") return null;
    const stateSnapshot = item.continuationState ?? {};
    item.state = "enqueued";
    item.continuationState = undefined;
    item.continuationSavedAt = null;
    // Bump enqueuedAt + deadlines so the watchdog treats the resumed
    // item as a fresh dispatch rather than an immediately-expired one.
    const now = new Date();
    item.enqueuedAt = now.toISOString();
    item.receiptDeadline = new Date(now.getTime() + DEFAULT_RECEIPT_SLA_MS).toISOString();
    item.completionDeadline = new Date(now.getTime() + DEFAULT_COMPLETION_SLA_MS).toISOString();
    item.receiptAckedAt = null;
    return { item: cloneItem(item), continuationState: { ...stateSnapshot } };
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

  async listNonTerminalByEntityRef(entityRef: string): Promise<PendingActionItem[]> {
    const out: PendingActionItem[] = [];
    for (const item of this.items.values()) {
      if (item.entityRef !== entityRef) continue;
      if (item.state === "completion_acked" || item.state === "escalated" || item.state === "errored") continue;
      out.push(cloneItem(item));
    }
    return out;
  }
}
