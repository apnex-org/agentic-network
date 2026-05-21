/**
 * notification-surface.ts — Claude `<channel>` render-surface.
 *
 * Layer-3 host-specific binding (claude-plugin only). Implements one arm
 * of the Universal Adapter notification contract — the actionable path
 * renders through the MCP `notifications/claude/channel` method with the
 * claude-specific source-attribute taxonomy.
 *
 * Extracted from `shim.ts` (bug-108) so the surfacing is an importable,
 * test-drivable unit: the `shim.e2e.test.ts` real-Hub harness exercises
 * `surfacePendingActionItem` directly rather than reimplementing it.
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  appendNotification,
  buildPromptText,
  type AgentEvent,
  type DrainedPendingAction,
} from "@apnex/network-adapter";
import { resolveSourceAttribute, isPulseEvent } from "./source-attribute.js";

/**
 * Inject an actionable/informational event into the Claude session as a
 * `<channel>` notification — the live LLM wake. `log` is the shim's
 * structured logger, passed in so this module stays free of shim state.
 */
export function pushChannelNotification(
  server: Server | null,
  event: AgentEvent,
  level: "actionable" | "informational",
  log: (msg: string) => void,
): void {
  if (!server) return;
  const content = buildPromptText(event.event, event.data, {
    toolPrefix: "mcp__plugin_agent-adapter_proxy__",
  });
  const meta: Record<string, unknown> = {
    event: event.event,
    // Mission-56 W2.3: kind-family-aware source attribution per Design
    // v1.2 §"Architectural commitments #4" + Universal Adapter
    // notification contract spec §"Render-surface semantics" worked
    // example. Replaces the flat "hub" fallback so consumers (LLM
    // prompts, dashboards) can disambiguate repo-events / directives /
    // general notifications without parsing the inner subkind.
    // Mission-57 W3: pulse detection takes precedence over the
    // mission-56 W2.3 4-kind taxonomy. Pulse Messages arrive via
    // `message_arrived` but render with pulse source-attribute family
    // (avoids cognitive noise during high-activity sub-PR cascades —
    // S3 mitigation per Design v1.0 §4).
    source: resolveSourceAttribute(event.event, event.data),
    level,
  };
  const data = event.data as Record<string, unknown>;
  if (data.taskId) meta.taskId = data.taskId;
  if (data.threadId) meta.threadId = data.threadId;
  if (data.proposalId) meta.proposalId = data.proposalId;
  // mission-66 commit 6 (#26 marker-protocol; closes calibration #26):
  // propagate Hub-side truncation flag + full byte-length to `<channel>`
  // attributes per Design §2.1.2 architect-lean (b) `<channel>`-attribute
  // approach (out-of-band metadata; render-template-registry in
  // packages/network-adapter/src/prompt-format.ts consumes). Hub envelope-
  // builder at thread-policy.ts sets truncated/fullBytes when body exceeds
  // THREAD_MESSAGE_PREVIEW_CHARS threshold (constant 200 chars; Phase 2
  // stable per architect SPEC §2.4).
  if (data.truncated === true) meta.truncated = "true";
  if (typeof data.fullBytes === "number") meta.fullBytes = String(data.fullBytes);

  server
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .notification({
      method: "notifications/claude/channel",
      params: { content, meta },
    } as any)
    .then(() => log(`[Channel] Pushed ${event.event} (${level})`))
    .catch((err: unknown) => log(`[Channel] Push failed for ${event.event}: ${err}`));
}

/**
 * bug-108: surface a reconnect-drained pending action.
 *
 * On reconnect, `performStateSync` drains pending actions and fires
 * `onPendingActionItem` per item. A drained item is a notification that
 * arrived while the wire was down — it MUST wake the session, not just
 * hit the diagnostic log. This mirrors the live `onActionableEvent` path:
 * the diagnostic log append + the `pushChannelNotification` actionable
 * wake (pulse events downgrade to `informational`, same as live).
 *
 * The drained item's `payload` IS the original dispatchPayload — hub
 * `thread-policy.ts` enqueues `payload: dispatchPayload` — so
 * `{event: dispatchType, data: payload}` reconstructs the same AgentEvent
 * the live SSE path delivers.
 */
export function surfacePendingActionItem(
  opts: {
    server: Server | null;
    logPath: string;
    log: (msg: string) => void;
    mirror?: (block: string) => void;
  },
  item: DrainedPendingAction,
): void {
  // Diagnostic log mirror (the former appendPendingActionLog).
  const actionHint =
    item.dispatchType === "thread_message"
      ? `Reply with create_thread_reply to thread ${item.entityRef}`
      : `Owed: ${item.dispatchType} on ${item.entityRef}`;
  appendNotification(
    { event: item.dispatchType, data: item.payload, action: actionHint },
    { logPath: opts.logPath, mirror: opts.mirror },
  );
  // The actionable wake — the bug-108 fix. Converges the reconnect-drain
  // handler onto the same `<channel>` injection the live SSE path uses.
  const agentEvent: AgentEvent = {
    event: item.dispatchType,
    data: item.payload,
  };
  const level = isPulseEvent(agentEvent.event, agentEvent.data)
    ? "informational"
    : "actionable";
  pushChannelNotification(opts.server, agentEvent, level, opts.log);
}
