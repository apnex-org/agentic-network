/**
 * State sync — called on entry to the `synchronizing` phase.
 *
 * Runs a bounded, role-aware reconnect reconciliation, then calls
 * `completeSync()` to transition to `streaming` and flush buffered events.
 *
 * The enriched handshake is NOT called here — `McpAgentClient.runHandshake`
 * invokes it before this function runs, so `state-sync.ts` can assume the
 * engineer has its canonical agentId by the time it queries pending state.
 */

import type { ILogger, LegacyStringLogger } from "../logger.js";
import { normalizeToILogger } from "../logger.js";

// bug-160 — DrainedPendingAction relocated to @apnex/message-router (the
// Message-union payload contract) to break the L2↔L4 source cycle; the package
// index re-exports it so consumers are unaffected.
import type { DrainedPendingAction } from "@apnex/message-router";
// Re-export so internal consumers (event-router / dispatcher import it
// `from "./state-sync.js"`) keep resolving.
export type { DrainedPendingAction };

export interface StateSyncContext {
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  completeSync: () => void;
  /** Structured logger. A legacy `(msg: string) => void` is auto-bridged. */
  log: ILogger | LegacyStringLogger;
  /** Caller role; architect-only aggregate reads are skipped for other seats. */
  role?: string;
  /**
   * bug-343: bounded deterministic reconnect jitter computed by McpAgentClient.
   * Zero on first boot; reconnects spread across [0,max] instead of synchronizing.
   */
  admissionDelayMs?: number;
  /** Test seam for the admission delay (default: setTimeout). */
  sleep?: (ms: number) => Promise<void>;
  /** Optional hook for legacy per-engineer pending directives (retained API; no longer populated). */
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

/**
 * Stable per-agent jitter. FNV-1a keeps the value deterministic across process
 * restarts (no flaky timing) while distinct fleet names spread across the full
 * admission window. The result is always within [0, maxMs].
 */
export function computeReconnectSyncJitter(seed: string, maxMs: number): number {
  const bound = Math.max(0, Math.floor(maxMs));
  if (bound === 0) return 0;
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % (bound + 1);
}

export async function performStateSync(ctx: StateSyncContext): Promise<void> {
  const log = normalizeToILogger(ctx.log, "StateSync");
  log.log("agent.sync.start", undefined, "[StateSync] Starting state sync...");

  try {
    // bug-343 reconnect admission: stagger only when McpAgentClient supplies a
    // positive reconnect delay. The delay is bounded and deterministic per
    // agent, so tests and operators can reason about it while fleet members do
    // not align on the same PostgreSQL query instant.
    const admissionDelayMs = Math.max(0, Math.floor(ctx.admissionDelayMs ?? 0));
    if (admissionDelayMs > 0) {
      log.log(
        "agent.sync.admission_jitter",
        { delayMs: admissionDelayMs },
        `[StateSync] reconnect admission jitter ${admissionDelayMs}ms`,
      );
      await (ctx.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(admissionDelayMs);
    }

    const callOrNull = async (name: string): Promise<unknown> => {
      try {
        return await ctx.executeTool(name, {});
      } catch (err) {
        log.log(
          `agent.sync.${name}.failed`,
          { error: String(err) },
          `[StateSync] ${name}: ${err}`,
        );
        return null;
      }
    };

    // bug-343: one admitted request at a time per reconnect. The former
    // Promise.all issued three scans per client simultaneously. get_now is the
    // liveness probe now: unlike list_missions it is store-free and cannot scan
    // Mission/Idea history. get_pending_actions is architect-only, so engineer
    // and verifier reconnects no longer issue a guaranteed RBAC rejection.
    await callOrNull("get_now");
    const pendingActions = ctx.role === "architect"
      ? await callOrNull("get_pending_actions")
      : null;
    // ADR-017 drain remains the authoritative per-agent recovery read/mutation;
    // its repository path is target+state filtered and index-backed.
    const drainedRaw = await callOrNull("drain_pending_actions");

    if (pendingActions && typeof pendingActions === "object") {
      const pa = pendingActions as Record<string, unknown>;
      if (pa.truncated === true || pa.totalPending === null) {
        log.log(
          "agent.sync.pending_actions.truncated",
          { visiblePending: Number(pa.visiblePending ?? 0), retrieval: JSON.stringify(pa.retrieval ?? null) },
          `[StateSync] Pending actions INCOMPLETE — visible=${pa.visiblePending ?? 0}; inspect retrieval dimensions`,
        );
      } else {
        log.log(
          "agent.sync.pending_actions",
          { totalPending: Number(pa.totalPending ?? 0) },
          `[StateSync] Pending actions: ${pa.totalPending ?? 0}`,
        );
      }
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
