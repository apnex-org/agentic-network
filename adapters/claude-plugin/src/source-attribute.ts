/**
 * Mission-56 W2.3 — claude-plugin render-surface source-attribute taxonomy.
 * Mission-57 W3 — pulse family extension.
 *
 * Layer-3 host-specific binding (claude-plugin only). The Universal
 * Adapter notification contract (Layer 1) emits classified events; the
 * Layer-2 `@ois/message-router` routes them onto the host's
 * `notificationHooks`; this module implements the claude-shim's
 * `<channel>` source-attribute taxonomy per Design v1.2 §"Architectural
 * commitments #4" + spec §"Render-surface semantics" worked example.
 *
 * The five ratified family strings (mission-57 W3 added pulse):
 *   - `plugin:agent-adapter:repo-event` — mission-52 bridge subkinds
 *   - `plugin:agent-adapter:directive`  — director-attention notifications
 *   - `plugin:agent-adapter:notification` — general Hub notifications
 *   - `plugin:agent-adapter:pulse`       — mission-57 pulse Messages (status_check + missed_threshold_escalation)
 *   - `plugin:agent-adapter:proxy`      — fallback / pre-taxonomy compat
 *
 * Pure function — testable in isolation; called from
 * `pushChannelNotification` to populate the `meta.source` field on
 * every `<channel>` push.
 */

const SOURCE_REPO_EVENT = "plugin:agent-adapter:repo-event";
const SOURCE_DIRECTIVE = "plugin:agent-adapter:directive";
const SOURCE_NOTIFICATION = "plugin:agent-adapter:notification";
const SOURCE_PULSE = "plugin:agent-adapter:pulse";
const SOURCE_PROXY = "plugin:agent-adapter:proxy";

/**
 * Mission-57 W3: pulse-kind discriminator values that route to the
 * `plugin:agent-adapter:pulse` family. Mirrors the Hub-side
 * PulseSweeper payload.pulseKind taxonomy (status_check fires from
 * normal pulse cadence; missed_threshold_escalation fires from E1
 * mediation-invariant escalation routing per Design v1.0 §4).
 */
const PULSE_KINDS: ReadonlySet<string> = new Set([
  "status_check",
  "missed_threshold_escalation",
]);

/**
 * Mirror of `@ois/repo-event-bridge` `REPO_EVENT_SUBKINDS`. Hardcoded to
 * avoid a cross-package install dependency just for a constant; verify
 * against `packages/repo-event-bridge/src/translator.ts` when bridge
 * subkind taxonomy evolves.
 */
const REPO_EVENT_SUBKINDS: ReadonlySet<string> = new Set([
  "pr-opened",
  "pr-closed",
  "pr-merged",
  "pr-review-submitted",
  "pr-review-approved",
  "pr-review-comment",
  "commit-pushed",
  "unknown",
]);

/**
 * Hub event-types that route to the general notification family.
 * Mirror of `HubEventType` in `@ois/network-adapter`'s
 * `kernel/event-router.ts` minus `director_attention_required` (which
 * has its own family) and minus `cascade_failure` (router-level
 * diagnostic; treated as general). `message_arrived` (mission-56 W1a)
 * is included so push-pipeline Messages route to the notification
 * family unless their subkind is repo-event.
 */
const HUB_NOTIFICATION_EVENTS: ReadonlySet<string> = new Set([
  "task_issued",
  "directive_acknowledged",
  "report_submitted",
  "review_completed",
  "revision_required",
  "proposal_submitted",
  "proposal_decided",
  "clarification_requested",
  "clarification_answered",
  "thread_opened",
  "thread_message",
  "thread_convergence_finalized",
  "thread_abandoned",
  "idea_submitted",
  "mission_created",
  "mission_activated",
  "turn_created",
  "turn_updated",
  "tele_defined",
  "cascade_failure",
  "message_arrived",
]);

/**
 * Resolve the `<channel>` source-attribute family for a given Hub
 * event-type + optional event data. Returns one of the five ratified
 * strings; never throws.
 *
 * Resolution order (kind/subkind-aware classification stays
 * forward-compat W3+):
 *   1. **pulse Message** (mission-57 W3) — eventType `message_arrived`
 *      AND eventData.message.payload.pulseKind ∈ PULSE_KINDS → pulse family
 *   2. repo-event subkind → repo-event family
 *   3. director_attention_required → directive family
 *   4. known general Hub event → notification family
 *   5. anything else → proxy fallback (preserves backward compat)
 *
 * `eventData` is optional for backward-compat with callers that only
 * have the event-type string. When omitted, pulse detection is skipped
 * and resolution falls through to the existing logic.
 */
export function resolveSourceAttribute(
  eventType: string,
  eventData?: Record<string, unknown>,
): string {
  // Mission-57 W3: pulse detection takes precedence — pulse Messages
  // arrive via `message_arrived` events but should render with pulse
  // source-attribute (informational level; reduced prominence per S3).
  if (eventType === "message_arrived" && eventData) {
    const message = eventData.message as { payload?: unknown } | undefined;
    const payload = message?.payload as { pulseKind?: unknown } | undefined;
    if (typeof payload?.pulseKind === "string" && PULSE_KINDS.has(payload.pulseKind)) {
      return SOURCE_PULSE;
    }
  }
  if (REPO_EVENT_SUBKINDS.has(eventType)) return SOURCE_REPO_EVENT;
  if (eventType === "director_attention_required") return SOURCE_DIRECTIVE;
  if (HUB_NOTIFICATION_EVENTS.has(eventType)) return SOURCE_NOTIFICATION;
  return SOURCE_PROXY;
}

/**
 * Mission-57 W3: detect whether an event is a pulse Message
 * (status_check or missed_threshold_escalation). Pure helper for the
 * shim's `notificationHooks.onActionableEvent` to downgrade level from
 * "actionable" to "informational" when rendering pulses (S3 noise
 * mitigation per Design v1.0 §4).
 */
export function isPulseEvent(eventType: string, eventData?: Record<string, unknown>): boolean {
  if (eventType !== "message_arrived" || !eventData) return false;
  const message = eventData.message as { payload?: unknown } | undefined;
  const payload = message?.payload as { pulseKind?: unknown } | undefined;
  return typeof payload?.pulseKind === "string" && PULSE_KINDS.has(payload.pulseKind);
}

/** Visibility for tests + diagnostics. */
export const SOURCE_ATTRIBUTE_FAMILIES = {
  REPO_EVENT: SOURCE_REPO_EVENT,
  DIRECTIVE: SOURCE_DIRECTIVE,
  NOTIFICATION: SOURCE_NOTIFICATION,
  PULSE: SOURCE_PULSE,
  PROXY: SOURCE_PROXY,
} as const;
