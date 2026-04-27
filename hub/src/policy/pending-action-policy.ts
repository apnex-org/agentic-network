/**
 * Pending-action policy (ADR-017).
 *
 * Exposes the drain-side surface for agents to reconcile with the Hub:
 * `drain_pending_actions` returns the caller's enqueued items and atomically
 * flips them to `receipt_acked` + refreshes the caller's `lastHeartbeatAt`
 * (the liveness heartbeat, per INV-COMMS-L03). Director-notification tools
 * surface the terminal escalation queue.
 */

import { z } from "zod";
import type { IPolicyContext, PolicyResult } from "./types.js";
import type { PolicyRouter } from "./router.js";
import {
  emitDirectorNotification,
  listDirectorNotificationViews,
  acknowledgeDirectorNotificationMessage,
} from "./director-notification-helpers.js";

async function drainPendingActions(
  _args: Record<string, unknown>,
  ctx: IPolicyContext,
): Promise<PolicyResult> {
  const agent = await ctx.stores.engineerRegistry.getAgentForSession(ctx.sessionId);
  if (!agent) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ items: [], warning: "no agent bound to session — register_role first" }) }],
      isError: true,
    };
  }

  const enqueued = await ctx.stores.pendingAction.listForAgent(agent.agentId, { state: "enqueued" });
  const drained = [];
  for (const item of enqueued) {
    const acked = await ctx.stores.pendingAction.receiptAck(item.id);
    if (acked) drained.push(acked);
  }

  // Heartbeat: the drain itself is proof of liveness. Update the agent's
  // lastHeartbeatAt + force livenessState back to online regardless of
  // prior degraded/unresponsive state (the agent is demonstrably alive).
  await (ctx.stores.engineerRegistry as any).refreshHeartbeat?.(agent.agentId);

  return {
    content: [{ type: "text" as const, text: JSON.stringify({ items: drained }) }],
  };
}

async function listDirectorNotifications(
  args: Record<string, unknown>,
  ctx: IPolicyContext,
): Promise<PolicyResult> {
  const filter: { severity?: any; source?: any; acknowledged?: boolean } = {};
  if (typeof args.severity === "string") filter.severity = args.severity;
  if (typeof args.source === "string") filter.source = args.source;
  if (typeof args.acknowledged === "boolean") filter.acknowledged = args.acknowledged;
  const notifications = await listDirectorNotificationViews(ctx.stores.message, filter);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ count: notifications.length, notifications }) }],
  };
}

async function acknowledgeDirectorNotification(
  args: Record<string, unknown>,
  ctx: IPolicyContext,
): Promise<PolicyResult> {
  const id = args.id as string;
  const agent = await ctx.stores.engineerRegistry.getAgentForSession(ctx.sessionId);
  const acknowledgedBy = agent?.agentId ?? ctx.sessionId;
  const result = await acknowledgeDirectorNotificationMessage(
    ctx.stores.message,
    id,
    acknowledgedBy,
  );
  if (!result) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: `notification ${id} not found` }) }],
      isError: true,
    };
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
  };
}

async function pruneStuckQueueItems(
  args: Record<string, unknown>,
  ctx: IPolicyContext,
): Promise<PolicyResult> {
  // idea-117 Phase 2c preamble — admin tool to break failure-amplification
  // loops. Role-gated at the router via [Architect|Director] tag prefix
  // (Phase 2x P2-6 made director a first-class RBAC role, so the inline
  // check previously here is no longer needed).

  const olderThanMinutes = typeof args.olderThanMinutes === "number" ? args.olderThanMinutes : 15;
  const dispatchType = typeof args.dispatchType === "string" ? args.dispatchType as any : undefined;
  const targetAgentId = typeof args.targetAgentId === "string" ? args.targetAgentId : undefined;
  const dryRun = args.dryRun === true;
  const reason = typeof args.reason === "string" && args.reason.trim().length > 0
    ? args.reason
    : "pruned by prune_stuck_queue_items";

  const olderThanMs = olderThanMinutes * 60_000;
  const stuck = await ctx.stores.pendingAction.listStuck({ olderThanMs, dispatchType, targetAgentId });

  if (dryRun) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        dryRun: true,
        matched: stuck.length,
        items: stuck.map(i => ({ id: i.id, dispatchType: i.dispatchType, entityRef: i.entityRef, targetAgentId: i.targetAgentId, enqueuedAt: i.enqueuedAt, attemptCount: i.attemptCount })),
      }) }],
    };
  }

  const abandoned: Array<{ id: string; entityRef: string; dispatchType: string }> = [];
  for (const item of stuck) {
    const result = await ctx.stores.pendingAction.abandon(item.id, reason);
    if (!result || result.state !== "errored") continue;
    abandoned.push({ id: item.id, entityRef: item.entityRef, dispatchType: item.dispatchType });
    await ctx.stores.audit.logEntry(
      "hub",
      "queue_item_abandoned",
      `Queue item ${item.id} abandoned via prune_stuck_queue_items (reason: ${reason}, entityRef: ${item.entityRef}, dispatchType: ${item.dispatchType}, attemptCount: ${item.attemptCount}, age: ${Math.round((Date.now() - new Date(item.enqueuedAt).getTime()) / 60_000)}min)`,
      item.entityRef,
    );

    // Phase 2d CP3 C2 — reverse bidirectional integrity: when the
    // pruned item is thread-bound, emit a thread-scoped observability
    // signal so the thread's participants + `list_audit_entries` on
    // the thread surface the prune (CP1 audit §5.2 bullet 4).
    if (item.dispatchType === "thread_message" || item.dispatchType === "thread_convergence_finalized") {
      const thread = await ctx.stores.thread.getThread(item.entityRef);
      if (thread) {
        // Thread-scoped audit entry — distinct from the queue-item
        // audit above; this one's relatedEntity is the thread so
        // `list_audit_entries({relatedEntity: thread-N})` surfaces it.
        await ctx.stores.audit.logEntry(
          "hub",
          "thread_queue_item_pruned",
          `Thread ${thread.id} had queue item ${item.id} pruned (dispatchType=${item.dispatchType}, targetAgentId=${item.targetAgentId}, reason=${reason}). Thread status remains ${thread.status}; the pruned dispatch will never settle.`,
          thread.id,
        );
        // Dispatch to any remaining participants with resolved agentIds
        // so online UIs refresh without polling. Best-effort.
        const participantAgentIds = thread.participants
          .map((p) => p.agentId)
          .filter((id): id is string => typeof id === "string" && id.length > 0);
        if (participantAgentIds.length > 0) {
          await ctx.dispatch(
            "thread_queue_item_pruned",
            {
              threadId: thread.id,
              queueItemId: item.id,
              dispatchType: item.dispatchType,
              targetAgentId: item.targetAgentId,
              reason,
            },
            { agentIds: participantAgentIds, matchLabels: thread.labels },
          );
        }
      }
    }
  }

  if (abandoned.length > 0) {
    await emitDirectorNotification(ctx.stores.message, {
      severity: "warning",
      source: "queue_item_escalated",
      sourceRef: `prune-${Date.now()}`,
      title: `Pruned ${abandoned.length} stuck queue item(s)`,
      details: `Administrative abandonment via prune_stuck_queue_items. Reason: ${reason}. Items: ${abandoned.map(a => `${a.id} (${a.dispatchType}:${a.entityRef})`).join(", ")}`,
    });
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify({
      dryRun: false,
      matched: stuck.length,
      abandoned: abandoned.length,
      items: abandoned,
      reason,
    }) }],
  };
}

async function saveContinuation(
  args: Record<string, unknown>,
  ctx: IPolicyContext,
): Promise<PolicyResult> {
  const queueItemId = typeof args.queueItemId === "string" ? args.queueItemId : null;
  const payload =
    args.payload && typeof args.payload === "object" && !Array.isArray(args.payload)
      ? (args.payload as Record<string, unknown>)
      : null;
  if (!queueItemId || !payload) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          ok: false,
          error: "save_continuation: queueItemId + payload are required",
        }),
      }],
      isError: true,
    };
  }

  const agent = await ctx.stores.engineerRegistry.getAgentForSession(ctx.sessionId);
  if (!agent) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          ok: false,
          error: "save_continuation: no agent bound to session — register_role first",
        }),
      }],
      isError: true,
    };
  }

  const updated = await ctx.stores.pendingAction.saveContinuation(
    queueItemId,
    agent.agentId,
    payload,
  );
  if (!updated) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          ok: false,
          error: `save_continuation: queue item ${queueItemId} not found, not owned by caller, or in terminal state`,
        }),
      }],
      isError: true,
    };
  }

  await ctx.stores.audit.logEntry(
    "hub",
    "queue_item_continuation_saved",
    `Queue item ${queueItemId} transitioned to continuation_required by agent ${agent.agentId} (payload kind: ${typeof payload.kind === "string" ? payload.kind : "unspecified"}).`,
    queueItemId,
  );

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        ok: true,
        queueItemId: updated.id,
        state: updated.state,
        continuationSavedAt: updated.continuationSavedAt,
        message: `Continuation saved for queue item ${queueItemId}. Hub will re-dispatch on next continuation sweep.`,
      }),
    }],
  };
}

export function registerPendingActionPolicy(router: PolicyRouter): void {
  router.register(
    "drain_pending_actions",
    "[Any] ADR-017: drain the caller's pending-actions queue. Returns all enqueued items and atomically flips them to receipt_acked. Updates the caller's liveness heartbeat — proof the agent is alive and processing. Each settling action (create_thread_reply, auto_review, etc.) should carry the returned item's id as `sourceQueueItemId` so the Hub can completion-ack on successful landing.",
    {},
    drainPendingActions,
  );

  router.register(
    "list_director_notifications",
    "[Any] ADR-017: list Director-surfaced escalation notifications. Filter by severity (info|warning|critical), source (queue_item_escalated|agent_unresponsive|agent_stuck|cascade_failed|manual), and acknowledged state.",
    {
      severity: z.enum(["info", "warning", "critical"]).optional().describe("Filter by severity"),
      source: z.enum(["queue_item_escalated", "agent_unresponsive", "agent_stuck", "cascade_failed", "manual"]).optional().describe("Filter by source"),
      acknowledged: z.boolean().optional().describe("Filter by acknowledged state"),
    },
    listDirectorNotifications,
  );

  router.register(
    "acknowledge_director_notification",
    "[Any] ADR-017: mark a Director notification as acknowledged (idempotent). Records acknowledgement but does not delete — notifications remain append-only.",
    { id: z.string().describe("Notification ID") },
    acknowledgeDirectorNotification,
  );

  router.register(
    "save_continuation",
    "[Any] M-Hypervisor-Adapter-Mitigations Task 1b (task-314) — graceful exhaustion save-continuation transition. The target agent calls this when its round-budget is running low: transitions the queue item to `continuation_required` state and persists the caller-opaque `payload` as `continuationState`. Only the queue item's `targetAgentId` can call save_continuation. Terminal items (completion_acked/errored/escalated) cannot transition. The Hub's continuation sweep re-dispatches items in `continuation_required` on the next tick, embedding the saved payload so the adapter can resume from the snapshot rather than restart from scratch. Payload shape is open; reserve `{kind: 'llm_state', ...}` for graceful-exhaustion LLM snapshots and `{kind: 'chunk_buffer', ...}` for task-313 oversize-reply persistence (idea-145 Path 2 unification).",
    {
      queueItemId: z.string().describe("ID of the pending-action queue item to transition"),
      payload: z.record(z.string(), z.unknown()).describe("Caller-opaque continuation payload. Conventionally include a `kind` discriminator (e.g., 'llm_state' | 'chunk_buffer') so the resumer can dispatch on it."),
    },
    saveContinuation,
  );

  router.register(
    "prune_stuck_queue_items",
    "[Architect|Director] idea-117 Phase 2c admin: abandon pending-action items stuck in receipt_acked state. Matches items whose state is receipt_acked AND whose enqueuedAt is older than olderThanMinutes (default 15). Optionally filter by dispatchType or targetAgentId. Set dryRun=true to preview matches without mutation. Abandoned items transition to errored state; emits audit entries + a Director notification summarising the prune.",
    {
      olderThanMinutes: z.number().optional().describe("Only prune items enqueued more than N minutes ago (default 15)"),
      dispatchType: z.enum(["thread_message", "thread_convergence_finalized", "task_issued", "proposal_submitted", "report_created", "review_requested"]).optional().describe("Filter by dispatch type"),
      targetAgentId: z.string().optional().describe("Filter by target agent"),
      dryRun: z.boolean().optional().describe("Preview matches without mutation (default false)"),
      reason: z.string().optional().describe("Human-readable reason recorded on each abandoned item's escalationReason + audit entry"),
    },
    pruneStuckQueueItems,
  );
}
