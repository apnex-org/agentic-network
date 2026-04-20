/**
 * GCS-backed PendingActionItem Store (ADR-017, Phase 2x P0-1).
 *
 * Persistence parity with the other entity stores. The memory store
 * was the original Phase-1 shortcut; after Phase 2b-B surfaced Hub
 * restart wiping queued work twice, GCS persistence became load-
 * bearing for the failure-amplification class squash.
 *
 * Layout:
 *   gs://{bucket}/pending-actions/{id}.json
 *
 * Natural-key idempotency: scanned at enqueue time via list+filter.
 * Expected queue size stays small (~20 items steady-state — watchdog
 * clears terminal items), so O(N) scan is acceptable. Concurrent-
 * enqueue race on identical naturalKey matches the memory store's
 * semantics (rare; naturalKey = targetAgent:entityRef:dispatchType).
 */

import {
  readJson,
  listFiles,
  getAndIncrementCounter,
  createOnly,
  updateExisting,
  GcsPathNotFound,
} from "../../gcs-state.js";
import type {
  IPendingActionStore,
  PendingActionItem,
  PendingActionState,
  PendingActionDispatchType,
  EnqueueOptions,
} from "../pending-action.js";
import { DEFAULT_RECEIPT_SLA_MS, DEFAULT_COMPLETION_SLA_MS } from "../pending-action.js";

function naturalKey(opts: { targetAgentId: string; dispatchType: string; entityRef: string }): string {
  return `${opts.targetAgentId}:${opts.entityRef}:${opts.dispatchType}`;
}

export class GcsPendingActionStore implements IPendingActionStore {
  private bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
    console.log(`[GcsPendingActionStore] Using bucket: gs://${bucket}`);
  }

  private async listAll(): Promise<PendingActionItem[]> {
    const files = await listFiles(this.bucket, "pending-actions/");
    const out: PendingActionItem[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const item = await readJson<PendingActionItem>(this.bucket, file);
      if (item) out.push(item);
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
      // Terminal item with same naturalKey — allow a new one (re-opens).
    }

    const num = await getAndIncrementCounter(this.bucket, "pendingActionCounter");
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
    await createOnly<PendingActionItem>(this.bucket, `pending-actions/${id}.json`, item);
    return item;
  }

  async getById(id: string): Promise<PendingActionItem | null> {
    return await readJson<PendingActionItem>(this.bucket, `pending-actions/${id}.json`);
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

  async receiptAck(id: string): Promise<PendingActionItem | null> {
    try {
      return await updateExisting<PendingActionItem>(
        this.bucket,
        `pending-actions/${id}.json`,
        (item) => {
          if (item.state !== "enqueued") return item; // idempotent
          item.state = "receipt_acked";
          item.receiptAckedAt = new Date().toISOString();
          return item;
        },
      );
    } catch (err) {
      if (err instanceof GcsPathNotFound) return null;
      throw err;
    }
  }

  async completionAck(id: string): Promise<PendingActionItem | null> {
    try {
      return await updateExisting<PendingActionItem>(
        this.bucket,
        `pending-actions/${id}.json`,
        (item) => {
          if (item.state === "completion_acked") return item; // idempotent
          item.state = "completion_acked";
          item.completionAckedAt = new Date().toISOString();
          if (!item.receiptAckedAt) item.receiptAckedAt = item.completionAckedAt;
          return item;
        },
      );
    } catch (err) {
      if (err instanceof GcsPathNotFound) return null;
      throw err;
    }
  }

  async escalate(id: string, reason: string): Promise<PendingActionItem | null> {
    try {
      return await updateExisting<PendingActionItem>(
        this.bucket,
        `pending-actions/${id}.json`,
        (item) => {
          item.state = "escalated";
          item.escalationReason = reason;
          return item;
        },
      );
    } catch (err) {
      if (err instanceof GcsPathNotFound) return null;
      throw err;
    }
  }

  async incrementAttempt(id: string): Promise<PendingActionItem | null> {
    try {
      return await updateExisting<PendingActionItem>(
        this.bucket,
        `pending-actions/${id}.json`,
        (item) => {
          item.attemptCount += 1;
          item.lastAttemptAt = new Date().toISOString();
          return item;
        },
      );
    } catch (err) {
      if (err instanceof GcsPathNotFound) return null;
      throw err;
    }
  }

  async rescheduleReceiptDeadline(id: string, newDeadline: string): Promise<PendingActionItem | null> {
    try {
      return await updateExisting<PendingActionItem>(
        this.bucket,
        `pending-actions/${id}.json`,
        (item) => {
          item.receiptDeadline = newDeadline;
          return item;
        },
      );
    } catch (err) {
      if (err instanceof GcsPathNotFound) return null;
      throw err;
    }
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
    try {
      return await updateExisting<PendingActionItem>(
        this.bucket,
        `pending-actions/${id}.json`,
        (item) => {
          // Idempotent on terminal states.
          if (item.state === "completion_acked" || item.state === "errored" || item.state === "escalated") return item;
          item.state = "errored";
          item.escalationReason = reason;
          return item;
        },
      );
    } catch (err) {
      if (err instanceof GcsPathNotFound) return null;
      throw err;
    }
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
}
