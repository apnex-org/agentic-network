/**
 * Notification Handler — dispatches Hub SSE events to sandwich handlers.
 *
 * Uses the shared event router from @ois/network-adapter for classification
 * and dedup. Each handled event is dispatched to its sandwich handler.
 */

import { HubAdapter } from "./hub-adapter.js";
import { ContextStore } from "./context.js";
import {
  sandwichReviewReport,
  sandwichReviewProposal,
  sandwichThreadReply,
  sandwichClarification,
} from "./sandwich.js";
import {
  parseHubEvent,
  createDedupFilter,
  classifyEvent,
} from "@ois/network-adapter";

// Shared dedup filter
const dedupFilter = createDedupFilter(100);

export function handleHubEvent(
  eventData: Record<string, unknown>,
  hub: HubAdapter,
  context: ContextStore
): void {
  const parsed = parseHubEvent(eventData);
  const { event, data } = parsed;

  // Dedup via shared filter (in-memory, session-scoped)
  if (dedupFilter.isDuplicate(parsed)) return;

  // GCS-persisted dedup REMOVED — State-Based Reconnect eliminates
  // event replay. The in-memory dedup filter above is sufficient for
  // SSE delivery dedup within a single process lifetime.

  // Classify using shared router
  const disposition = classifyEvent(event, "architect");
  if (disposition === "unhandled") {
    console.log(`[Notifications] Unhandled event: ${event}`);
    return;
  }

  console.log(`[Notifications] Processing event: ${event} (${disposition})`);

  switch (event) {
    case "report_submitted": {
      const taskId = data.taskId as string;
      const reportRef = data.reportRef as string;
      if (taskId && reportRef) {
        sandwichReviewReport(hub, context, taskId, reportRef);
      }
      break;
    }

    case "proposal_submitted": {
      const proposalId = data.proposalId as string;
      const title = (data.title || "") as string;
      const summary = (data.summary || "") as string;
      const proposalRef = data.proposalRef as string;
      if (proposalId && proposalRef) {
        sandwichReviewProposal(hub, context, proposalId, title, summary, proposalRef);
      }
      break;
    }

    case "clarification_requested": {
      const taskId = data.taskId as string;
      const question = (data.question || "") as string;
      if (taskId && question) {
        sandwichClarification(hub, context, taskId, question);
      }
      break;
    }

    case "thread_message": {
      const threadId = data.threadId as string;
      const currentTurn = data.currentTurn as string;
      // ADR-017 Phase 1.1: the Hub carries queueItemId INLINE on the SSE
      // event. Thread it through to sandwichThreadReply so the settling
      // create_thread_reply call injects sourceQueueItemId and the Hub
      // completion-ACKs without a watchdog escalation. Missing on legacy
      // events — sandwich falls back to no-ID (which Hub tolerates as
      // optional today; will escalate on Phase 1.1's watchdog-active path).
      const queueItemId = typeof data.queueItemId === "string" ? data.queueItemId : undefined;
      if (threadId && currentTurn === "architect") {
        sandwichThreadReply(hub, context, threadId, queueItemId);
      }
      break;
    }

    case "thread_convergence_finalized": {
      // Mission-24 Phase 2 (M24-T3, ADR-014): single merged event
      // replacing the legacy thread_converged + thread_convergence_completed
      // pair. Fires AFTER the Hub cascade runs, carrying the full
      // ConvergenceReport. All Phase 2 convergences have at least one
      // committed action (Phase 1 gate enforces it), so the Hub has
      // always done the work by the time this notification lands —
      // nothing for the sandwich to do besides log.
      const threadId = data.threadId as string;
      const executedCount = (data.executedCount as number | undefined) ?? 0;
      const failedCount = (data.failedCount as number | undefined) ?? 0;
      const warning = !!data.warning;
      console.log(
        `[Notifications] thread_convergence_finalized for ${threadId}: ` +
          `executed=${executedCount}, failed=${failedCount}${warning ? " [WARNING]" : ""} — Hub cascade has completed.`,
      );
      break;
    }

    default:
      // Informational events — log but no action needed
      console.log(`[Notifications] Informational event: ${event}`);
  }
}

/**
 * Also handle webhook events (fallback path).
 * Same dispatch logic as SSE notifications.
 */
export function handleWebhookEvent(
  event: string,
  data: Record<string, unknown>,
  hub: HubAdapter,
  context: ContextStore
): void {
  handleHubEvent(
    { event, data, timestamp: new Date().toISOString() },
    hub,
    context
  );
}
