/**
 * State sync — called on entry to the `synchronizing` phase.
 *
 * Runs `get_task` + `get_pending_actions` in parallel, then calls
 * `completeSync()` to transition to `streaming` and flush buffered events.
 *
 * The enriched handshake is NOT called here — `McpAgentClient.runHandshake`
 * invokes it before this function runs, so `state-sync.ts` can assume the
 * engineer has its canonical agentId by the time it queries pending state.
 */

import type { ILogger, LegacyStringLogger } from "../logger.js";
import { normalizeToILogger } from "../logger.js";

/**
 * A PendingActionItem as returned by `drain_pending_actions` (ADR-017).
 * Adapter-facing shape — subset of the Hub's canonical type that's
 * relevant for consumption. `id` is the queue item's surrogate ID which
 * MUST be passed back as `sourceQueueItemId` on the settling tool call
 * (e.g., create_thread_reply) for completion-ACK.
 */
export interface DrainedPendingAction {
  id: string;
  dispatchType: string;           // e.g. "thread_message"
  entityRef: string;              // e.g. "thread-137"
  payload: Record<string, unknown>; // original dispatch payload
}

export interface StateSyncContext {
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  completeSync: () => void;
  /** Structured logger. A legacy `(msg: string) => void` is auto-bridged. */
  log: ILogger | LegacyStringLogger;
  /** Optional hook for per-engineer logging of pending directives. */
  onPendingTask?: (task: Record<string, unknown>) => void;
  /**
   * ADR-017 drain-on-wake. Called once per item returned from
   * `drain_pending_actions`. The adapter is responsible for:
   *   1. Processing the item (LLM reasoning, user surface, etc.)
   *   2. Threading `item.id` as `sourceQueueItemId` when it issues the
   *      settling tool call (create_thread_reply, create_review, …)
   * Missing this hook means the queue items drain without consumer —
   * the Hub's watchdog will eventually escalate to Director.
   */
  onPendingActionItem?: (item: DrainedPendingAction) => void;
}

export async function performStateSync(ctx: StateSyncContext): Promise<void> {
  const log = normalizeToILogger(ctx.log, "StateSync");
  log.log("agent.sync.start", undefined, "[StateSync] Starting state sync...");

  try {
    // ADR-017 additive: drain_pending_actions runs alongside the legacy
    // surface. Hubs that don't expose the tool yet (pre-ADR-017) return
    // an error here which we swallow — the other two calls still land.
    const [directive, pendingActions, drainedRaw] = await Promise.all([
      ctx.executeTool("get_task", {}).catch((err: unknown) => {
        log.log(
          "agent.sync.get_task.failed",
          { error: String(err) },
          `[StateSync] get_task: ${err}`
        );
        return null;
      }),
      ctx.executeTool("get_pending_actions", {}).catch((err: unknown) => {
        log.log(
          "agent.sync.get_pending_actions.failed",
          { error: String(err) },
          `[StateSync] get_pending_actions: ${err}`
        );
        return null;
      }),
      ctx.executeTool("drain_pending_actions", {}).catch((err: unknown) => {
        log.log(
          "agent.sync.drain_pending_actions.failed",
          { error: String(err) },
          `[StateSync] drain_pending_actions: ${err}`
        );
        return null;
      }),
    ]);

    if (directive && typeof directive === "object") {
      const d = directive as Record<string, unknown>;
      if (d.task && typeof d.task === "object") {
        const task = d.task as Record<string, unknown>;
        log.log(
          "agent.sync.pending_task",
          { taskId: String(task.taskId ?? "unknown") },
          `[StateSync] Pending task: ${task.taskId ?? "unknown"}`
        );
        if (ctx.onPendingTask) ctx.onPendingTask(task);
      }
    }

    if (pendingActions && typeof pendingActions === "object") {
      const pa = pendingActions as Record<string, unknown>;
      log.log(
        "agent.sync.pending_actions",
        { totalPending: Number(pa.totalPending ?? 0) },
        `[StateSync] Pending actions: ${pa.totalPending ?? 0}`
      );
    }

    // ADR-017: dispatch drained queue items to the adapter's handler.
    // Shape: { items: PendingActionItem[] }. Tool returns isError=true
    // when no agent is bound to the session — the adapter catch above
    // already swallowed; here we just ensure the items array is safe.
    if (drainedRaw && typeof drainedRaw === "object") {
      const d = drainedRaw as Record<string, unknown>;
      const items = Array.isArray(d.items) ? d.items : [];
      if (items.length > 0) {
        log.log(
          "agent.sync.drained_items",
          { count: items.length },
          `[StateSync] Drained ${items.length} pending action item(s)`
        );
      }
      if (ctx.onPendingActionItem) {
        for (const raw of items) {
          if (!raw || typeof raw !== "object") continue;
          const item = raw as Record<string, unknown>;
          if (typeof item.id !== "string") continue;
          ctx.onPendingActionItem({
            id: item.id,
            dispatchType: String(item.dispatchType ?? ""),
            entityRef: String(item.entityRef ?? ""),
            payload: (item.payload as Record<string, unknown>) ?? {},
          });
        }
      }
    }

    ctx.completeSync();
    log.log("agent.sync.complete", undefined, "[StateSync] Sync complete — now streaming");
  } catch (err) {
    log.log(
      "agent.sync.failed",
      { error: String(err) },
      `[StateSync] Failed: ${err}`
    );
    try {
      ctx.completeSync();
    } catch {
      log.log(
        "agent.sync.complete_failed",
        undefined,
        "[StateSync] completeSync() also failed"
      );
    }
  }
}
