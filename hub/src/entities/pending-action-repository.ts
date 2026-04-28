/**
 * PendingActionRepository — StorageProvider-backed persistence.
 *
 * Mission-47 W7. Replaces `MemoryPendingActionStore` (pending-action.ts)
 * + `GcsPendingActionStore` (gcs/gcs-pending-action.ts). Implements
 * `IPendingActionStore` unchanged.
 *
 * Natural-key idempotency (INV-PA2): scanned at enqueue time via
 * list+filter. Queue size stays small (~20 items steady-state per
 * ADR-017 operational notes), so O(N) scan is acceptable.
 *
 * Layout:
 *   pending-actions/<id>.json   — per-item blob
 *   meta/counter.json           — shared counter (pendingActionCounter)
 */

import type { StorageProvider } from "@apnex/storage-provider";
import { hasGetWithToken, StoragePathNotFoundError } from "@apnex/storage-provider";

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
import { StorageBackedCounter } from "./counter.js";

const MAX_CAS_RETRIES = 50;

function naturalKey(opts: { targetAgentId: string; dispatchType: string; entityRef: string }): string {
  return `${opts.targetAgentId}:${opts.entityRef}:${opts.dispatchType}`;
}

function itemPath(id: string): string {
  return `pending-actions/${id}.json`;
}

function encode(item: PendingActionItem): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(item, null, 2));
}

function decode(bytes: Uint8Array): PendingActionItem {
  return JSON.parse(new TextDecoder().decode(bytes)) as PendingActionItem;
}

/**
 * Sentinel for transform-side gating. Caught by tryCasUpdate and mapped
 * to null for the interface's null-returning methods. Gating strings
 * with "save_continuation:" / "resume_continuation:" prefixes are
 * preserved for log parity.
 */
class TransitionRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransitionRejected";
  }
}

export class PendingActionRepository implements IPendingActionStore {
  constructor(
    private readonly provider: StorageProvider,
    private readonly counter: StorageBackedCounter,
  ) {
    if (!hasGetWithToken(provider)) {
      throw new Error(
        "PendingActionRepository requires a StorageProvider with atomic read-with-token support",
      );
    }
  }

  private async listAll(): Promise<PendingActionItem[]> {
    const keys = await this.provider.list("pending-actions/");
    const out: PendingActionItem[] = [];
    for (const key of keys) {
      if (!key.endsWith(".json")) continue;
      const raw = await this.provider.get(key);
      if (!raw) continue;
      out.push(decode(raw));
    }
    return out;
  }

  async enqueue(opts: EnqueueOptions): Promise<PendingActionItem> {
    const key = naturalKey(opts);
    const all = await this.listAll();
    // INV-PA2 — natural-key idempotency on non-terminal items.
    for (const existing of all) {
      if (existing.naturalKey !== key) continue;
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
    const result = await this.provider.createOnly(itemPath(id), encode(item));
    if (!result.ok) {
      throw new Error(
        `[PendingActionRepository] enqueue: counter issued existing ID ${id}; refusing to clobber`,
      );
    }
    return item;
  }

  async getById(id: string): Promise<PendingActionItem | null> {
    const raw = await this.provider.get(itemPath(id));
    return raw ? decode(raw) : null;
  }

  async listForAgent(
    targetAgentId: string,
    filter?: { state?: PendingActionState },
  ): Promise<PendingActionItem[]> {
    const all = await this.listAll();
    return all.filter((item) => {
      if (item.targetAgentId !== targetAgentId) return false;
      if (filter?.state && item.state !== filter.state) return false;
      return true;
    });
  }

  async findOpenByNaturalKey(
    opts: { targetAgentId: string; entityRef: string; dispatchType: PendingActionDispatchType },
  ): Promise<PendingActionItem | null> {
    const key = naturalKey(opts);
    const all = await this.listAll();
    for (const item of all) {
      if (item.naturalKey !== key) continue;
      if (item.state === "completion_acked" || item.state === "escalated" || item.state === "errored") continue;
      return item;
    }
    return null;
  }

  async receiptAck(id: string): Promise<PendingActionItem | null> {
    return this.tryCasUpdate(id, (item) => {
      if (item.state !== "enqueued") return item; // idempotent — return unchanged
      item.state = "receipt_acked";
      item.receiptAckedAt = new Date().toISOString();
      return item;
    });
  }

  async completionAck(id: string): Promise<PendingActionItem | null> {
    return this.tryCasUpdate(id, (item) => {
      if (item.state === "completion_acked") return item; // idempotent
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
        return item; // idempotent
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
    const all = await this.listAll();
    return all.filter((item) => {
      if (item.state !== "receipt_acked") return false;
      if (opts.dispatchType && item.dispatchType !== opts.dispatchType) return false;
      if (opts.targetAgentId && item.targetAgentId !== opts.targetAgentId) return false;
      const enqueuedMs = new Date(item.enqueuedAt).getTime();
      return nowMs - enqueuedMs >= opts.olderThanMs;
    });
  }

  async listNonTerminalByEntityRef(entityRef: string): Promise<PendingActionItem[]> {
    const all = await this.listAll();
    return all.filter((item) => {
      if (item.entityRef !== entityRef) return false;
      return item.state !== "completion_acked" && item.state !== "escalated" && item.state !== "errored";
    });
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
    const all = await this.listAll();
    const filtered = all.filter((item) => item.state === "continuation_required");
    filtered.sort((a, b) => {
      const at = a.continuationSavedAt ? Date.parse(a.continuationSavedAt) : 0;
      const bt = b.continuationSavedAt ? Date.parse(b.continuationSavedAt) : 0;
      return at - bt;
    });
    return filtered;
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
   * on-disk state, bypassing FSM gates. Replaces the legacy pattern
   * of poking `(store as any).items.get(id).field = value` against
   * MemoryPendingActionStore's private Map — that Map no longer
   * exists post-W7.
   */
  async __debugSetItem(id: string, patch: Partial<PendingActionItem>): Promise<void> {
    const path = itemPath(id);
    const raw = await this.provider.get(path);
    if (!raw) throw new Error(`[PendingActionRepository.__debugSetItem] item not found: ${id}`);
    const current = decode(raw);
    const next: PendingActionItem = { ...current, ...patch };
    await this.provider.put(path, encode(next));
  }

  // ── Internal ─────────────────────────────────────────────────────

  /**
   * CAS-update a pending-action item. Returns the updated item on
   * success, null when the item is missing OR the transform throws
   * TransitionRejected. Matches the legacy idempotent-return pattern
   * (mutations that should be no-ops return the unchanged item; gate
   * failures throw TransitionRejected → caller sees null).
   */
  private async tryCasUpdate(
    id: string,
    transform: (current: PendingActionItem) => PendingActionItem,
  ): Promise<PendingActionItem | null> {
    const path = itemPath(id);
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const read = await (this.provider as unknown as {
        getWithToken(path: string): Promise<{ data: Uint8Array; token: string } | null>;
      }).getWithToken(path);
      if (read === null) return null;
      let next: PendingActionItem;
      try {
        next = transform(decode(read.data));
      } catch (err) {
        if (err instanceof TransitionRejected) {
          console.warn(`[PendingActionRepository] ${err.message}`);
          return null;
        }
        throw err;
      }
      try {
        const result = await this.provider.putIfMatch(path, encode(next), read.token);
        if (result.ok) return next;
      } catch (err) {
        if (err instanceof StoragePathNotFoundError) return null;
        throw err;
      }
    }
    throw new Error(
      `[PendingActionRepository] tryCasUpdate exhausted ${MAX_CAS_RETRIES} retries on ${id}`,
    );
  }
}
