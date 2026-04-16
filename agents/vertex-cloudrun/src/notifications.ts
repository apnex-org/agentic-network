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
  sandwichThreadConverged,
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
      if (threadId && currentTurn === "architect") {
        sandwichThreadReply(hub, context, threadId);
      }
      break;
    }

    case "thread_converged": {
      const threadId = data.threadId as string;
      const intent = (data.intent as string) || null;
      const hasAction = !!data.hasAction;
      if (threadId && !hasAction) {
        // Only handle if Hub cascade didn't already act (hasAction = convergenceAction present)
        sandwichThreadConverged(hub, context, threadId, intent);
      } else if (hasAction) {
        console.log(`[Notifications] Skipping thread_converged for ${threadId} — Hub cascade handles convergenceAction`);
      }
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
