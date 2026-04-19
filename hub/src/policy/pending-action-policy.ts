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

  const enqueued = await ctx.stores.pendingAction.listForAgent(agent.engineerId, { state: "enqueued" });
  const drained = [];
  for (const item of enqueued) {
    const acked = await ctx.stores.pendingAction.receiptAck(item.id);
    if (acked) drained.push(acked);
  }

  // Heartbeat: the drain itself is proof of liveness. Update the agent's
  // lastHeartbeatAt + force livenessState back to online regardless of
  // prior degraded/unresponsive state (the agent is demonstrably alive).
  await (ctx.stores.engineerRegistry as any).refreshHeartbeat?.(agent.engineerId);

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
  const notifications = await ctx.stores.directorNotification.list(filter);
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
  const acknowledgedBy = agent?.engineerId ?? ctx.sessionId;
  const result = await ctx.stores.directorNotification.acknowledge(id, acknowledgedBy);
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
}
