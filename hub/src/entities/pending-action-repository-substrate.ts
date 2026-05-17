/**
 * mission-83 W4.x.6 — PendingActionRepositorySubstrate
 *
 * Substrate-API version of PendingActionRepository (mission-47 W7 origin). Per
 * Design v1.3 §5.1 Option Y disposition (B) sibling-pattern. Implements
 * IPendingActionStore interface UNCHANGED (handler call-sites unchanged).
 *
 * Per-entity logic preserved:
 *   - ID generation: pa-{timestamp-with-counter-suffix} (same shape as legacy)
 *   - INV-PA2 natural-key idempotency on non-terminal items (substrate.list with
 *     pa_natural_key_idx hot-path per PendingAction SchemaDef v2)
 *   - All CAS transitions use Design v1.4 getWithRevision + putIfMatch
 *   - TransitionRejected sentinel for transform-side gating (saveContinuation +
 *     resumeContinuation FSM-gating returns null per legacy contract)
 *   - Test-only __debugSetItem escape hatch via substrate.put bypass
 *
 * W4.x.6 — seventh-slice of W4.x sweep after W4.x.5 MissionRepositorySubstrate.
 */

import type { HubStorageSubstrate } from "../storage-substrate/index.js";
import type {
  IPendingActionStore,
  PendingActionItem,
  PendingActionState,
  PendingActionDispatchType,
  EnqueueOptions,
} from "./pending-action.js";
import {
  DEFAULT_RECEIPT_SLA_MS,
  DEFAULT_COMPLETION_SLA_MS,
} from "./pending-action.js";
import { SubstrateCounter } from "./substrate-counter.js";

const KIND = "PendingAction";
const MAX_CAS_RETRIES = 50;
const LIST_PREFETCH_CAP = 500;

function naturalKey(opts: { targetAgentId: string; dispatchType: string; entityRef: string }): string {
  return `${opts.targetAgentId}:${opts.entityRef}:${opts.dispatchType}`;
}

class TransitionRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransitionRejected";
  }
}

export class PendingActionRepositorySubstrate implements IPendingActionStore {
  constructor(
    private readonly substrate: HubStorageSubstrate,
    private readonly counter: SubstrateCounter,
  ) {}

  private async listAll(): Promise<PendingActionItem[]> {
    const { items } = await this.substrate.list<PendingActionItem>(KIND, {
      limit: LIST_PREFETCH_CAP,
    });
    return items;
  }

  async enqueue(opts: EnqueueOptions): Promise<PendingActionItem> {
    const key = naturalKey(opts);
    // INV-PA2 natural-key idempotency on non-terminal items.
    // Substrate-side filter on pa_natural_key_idx (SchemaDef v2 hot-path index).
    const { items } = await this.substrate.list<PendingActionItem>(KIND, {
      filter: { naturalKey: key },
      limit: LIST_PREFETCH_CAP,
    });
    for (const existing of items) {
      if (existing.state !== "completion_acked" && existing.state !== "errored") {
        return existing;
      }
    }

    const num = await this.counter.next("pendingActionCounter");
    const now = new Date();
    const receiptSla = opts.receiptSlaMs ?? DEFAULT_RECEIPT_SLA_MS;
    const completionSla = opts.completionSlaMs ?? DEFAULT_COMPLETION_SLA_MS;
    const id = `pa-${now.toISOString().replace(/[:.]/g, "-")}-${num.toString(36)}`;
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
    const result = await this.substrate.createOnly(KIND, item);
    if (!result.ok) {
      throw new Error(
        `[PendingActionRepositorySubstrate] enqueue: counter issued existing ID ${id}; refusing to clobber`,
      );
    }
    return item;
  }

  async getById(id: string): Promise<PendingActionItem | null> {
    return this.substrate.get<PendingActionItem>(KIND, id);
  }

  async listForAgent(
    targetAgentId: string,
    filter?: { state?: PendingActionState },
  ): Promise<PendingActionItem[]> {
    // Substrate-side filter on pa_target_idx hot-path + optional state filter
    const substrateFilter: Record<string, string> = { targetAgentId };
    if (filter?.state) substrateFilter.state = filter.state;
    const { items } = await this.substrate.list<PendingActionItem>(KIND, {
      filter: substrateFilter,
      limit: LIST_PREFETCH_CAP,
    });
    return items;
  }

  async findOpenByNaturalKey(
    opts: { targetAgentId: string; entityRef: string; dispatchType: PendingActionDispatchType },
  ): Promise<PendingActionItem | null> {
    const key = naturalKey(opts);
    const { items } = await this.substrate.list<PendingActionItem>(KIND, {
      filter: { naturalKey: key },
      limit: LIST_PREFETCH_CAP,
    });
    for (const item of items) {
      if (item.state === "completion_acked" || item.state === "escalated" || item.state === "errored") continue;
      return item;
    }
    return null;
  }

  async receiptAck(id: string): Promise<PendingActionItem | null> {
    return this.tryCasUpdate(id, (item) => {
      if (item.state !== "enqueued") return item;
      item.state = "receipt_acked";
      item.receiptAckedAt = new Date().toISOString();
      return item;
    });
  }

  async completionAck(id: string): Promise<PendingActionItem | null> {
    return this.tryCasUpdate(id, (item) => {
      if (item.state === "completion_acked") return item;
      item.state = "completion_acked";
      item.completionAckedAt = new Date().toISOString();
      if (!item.receiptAckedAt) item.receiptAckedAt = item.completionAckedAt;
      return item;
    });
  }

  async escalate(id: string, reason: string): Promise<PendingActionItem | null> {
    return this.tryCasUpdate(id, (item) => {
      item.state = "escalated";
      item.escalationReason = reason;
      return item;
    });
  }

  async incrementAttempt(id: string): Promise<PendingActionItem | null> {
    return this.tryCasUpdate(id, (item) => {
      item.attemptCount += 1;
      item.lastAttemptAt = new Date().toISOString();
      return item;
    });
  }

  async rescheduleReceiptDeadline(id: string, newDeadline: string): Promise<PendingActionItem | null> {
    return this.tryCasUpdate(id, (item) => {
      item.receiptDeadline = newDeadline;
      return item;
    });
  }

  async listExpired(nowMs: number): Promise<PendingActionItem[]> {
    const all = await this.listAll();
    return all.filter((item) => {
      if (item.state === "completion_acked" || item.state === "escalated" || item.state === "errored") return false;
      const deadline = item.state === "enqueued"
        ? new Date(item.receiptDeadline).getTime()
        : new Date(item.completionDeadline).getTime();
      return nowMs >= deadline;
    });
  }

  async abandon(id: string, reason: string): Promise<PendingActionItem | null> {
    return this.tryCasUpdate(id, (item) => {
      if (item.state === "completion_acked" || item.state === "errored" || item.state === "escalated") {
        return item;
      }
      item.state = "errored";
      item.escalationReason = reason;
      return item;
    });
  }

  async listStuck(opts: {
    olderThanMs: number;
    dispatchType?: PendingActionDispatchType;
    targetAgentId?: string;
  }): Promise<PendingActionItem[]> {
    const nowMs = Date.now();
    // Substrate-side filter on state="receipt_acked" hot-path; optional dispatchType+targetAgentId
    const substrateFilter: Record<string, string> = { state: "receipt_acked" };
    if (opts.targetAgentId) substrateFilter.targetAgentId = opts.targetAgentId;
    if (opts.dispatchType) substrateFilter.dispatchType = opts.dispatchType;
    const { items } = await this.substrate.list<PendingActionItem>(KIND, {
      filter: substrateFilter,
      limit: LIST_PREFETCH_CAP,
    });
    return items.filter((item) => {
      const enqueuedMs = new Date(item.enqueuedAt).getTime();
      return nowMs - enqueuedMs >= opts.olderThanMs;
    });
  }

  async listNonTerminalByEntityRef(entityRef: string): Promise<PendingActionItem[]> {
    // Substrate-side filter on entityRef + client-side terminal-state exclusion
    const { items } = await this.substrate.list<PendingActionItem>(KIND, {
      filter: { entityRef },
      limit: LIST_PREFETCH_CAP,
    });
    return items.filter((item) =>
      item.state !== "completion_acked" && item.state !== "escalated" && item.state !== "errored"
    );
  }

  async saveContinuation(
    id: string,
    callerAgentId: string,
    continuationState: Record<string, unknown>,
  ): Promise<PendingActionItem | null> {
    return this.tryCasUpdate(id, (item) => {
      if (item.targetAgentId !== callerAgentId) {
        throw new TransitionRejected(
          `save_continuation: caller ${callerAgentId} is not the targetAgentId ${item.targetAgentId} for queue item ${id}`,
        );
      }
      if (
        item.state === "completion_acked" ||
        item.state === "errored" ||
        item.state === "escalated"
      ) {
        throw new TransitionRejected(
          `save_continuation: queue item ${id} is in terminal state ${item.state}`,
        );
      }
      item.state = "continuation_required";
      item.continuationState = { ...continuationState };
      item.continuationSavedAt = new Date().toISOString();
      return item;
    });
  }

  async listContinuationItems(): Promise<PendingActionItem[]> {
    const { items } = await this.substrate.list<PendingActionItem>(KIND, {
      filter: { state: "continuation_required" },
      limit: LIST_PREFETCH_CAP,
    });
    items.sort((a, b) => {
      const at = a.continuationSavedAt ? Date.parse(a.continuationSavedAt) : 0;
      const bt = b.continuationSavedAt ? Date.parse(b.continuationSavedAt) : 0;
      return at - bt;
    });
    return items;
  }

  async resumeContinuation(id: string): Promise<{
    item: PendingActionItem;
    continuationState: Record<string, unknown>;
  } | null> {
    let snapshot: Record<string, unknown> = {};
    const updated = await this.tryCasUpdate(id, (item) => {
      if (item.state !== "continuation_required") {
        throw new TransitionRejected(
          `resume_continuation: queue item ${id} is in state ${item.state}, expected continuation_required`,
        );
      }
      snapshot = item.continuationState ?? {};
      item.state = "enqueued";
      item.continuationState = undefined;
      item.continuationSavedAt = null;
      const now = new Date();
      item.enqueuedAt = now.toISOString();
      item.receiptDeadline = new Date(now.getTime() + DEFAULT_RECEIPT_SLA_MS).toISOString();
      item.completionDeadline = new Date(now.getTime() + DEFAULT_COMPLETION_SLA_MS).toISOString();
      item.receiptAckedAt = null;
      return item;
    });
    if (!updated) return null;
    return { item: updated, continuationState: { ...snapshot } };
  }

  /**
   * Test-only escape hatch: directly patch a pending-action item's
   * on-disk state, bypassing FSM gates. substrate.put bypass (no CAS).
   */
  async __debugSetItem(id: string, patch: Partial<PendingActionItem>): Promise<void> {
    const current = await this.substrate.get<PendingActionItem>(KIND, id);
    if (!current) throw new Error(`[PendingActionRepositorySubstrate.__debugSetItem] item not found: ${id}`);
    const next: PendingActionItem = { ...current, ...patch };
    await this.substrate.put(KIND, next);
  }

  // ── Internal ─────────────────────────────────────────────────────

  /**
   * CAS-update via Design v1.4 getWithRevision + putIfMatch. Returns null on
   * absent OR TransitionRejected. Matches legacy idempotent-return pattern.
   */
  private async tryCasUpdate(
    id: string,
    transform: (current: PendingActionItem) => PendingActionItem,
  ): Promise<PendingActionItem | null> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<PendingActionItem>(KIND, id);
      if (!existing) return null;
      let next: PendingActionItem;
      try {
        next = transform({ ...existing.entity });
      } catch (err) {
        if (err instanceof TransitionRejected) {
          console.warn(`[PendingActionRepositorySubstrate] ${err.message}`);
          return null;
        }
        throw err;
      }
      const result = await this.substrate.putIfMatch(KIND, next, existing.resourceVersion);
      if (result.ok) return next;
      // revision-mismatch → retry from re-read
    }
    throw new Error(
      `[PendingActionRepositorySubstrate] tryCasUpdate exhausted ${MAX_CAS_RETRIES} retries on ${id}`,
    );
  }
}
