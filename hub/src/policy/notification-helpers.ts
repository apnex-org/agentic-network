/**
 * Notification → Message migration helper — mission-56 W4.2.
 *
 * Per Design v1.2 §"Architectural commitments #7" / §"Per-entity migration
 * mechanics": legacy entity sunset for the SSE-event-replay `Notification`
 * entity. Cut-over (no dual-write): write-paths in `hub-networking.ts`
 * (`notifyEvent` + `dispatchEvent`) emit Messages instead of Notifications.
 * The legacy `notificationStore` is retained until W5 entity-store removal;
 * new code never touches its `.persist()` write-API.
 *
 * Wire format on Messages:
 *   - `kind: "external-injection"` — Hub-internal events being injected
 *     into agent SSE streams (`thread_message`, `task_issued`,
 *     `proposal_submitted`, etc.). Distinct from the W4.1 DirectorNotification
 *     `kind: "note"` choice: those are inbox-routed alerts (system→inbox
 *     per `downstream-actors.ts` precedent); these are event-bus injections.
 *     Both kinds carry identical axes (no turn requirements; any author);
 *     the choice is semantic.
 *   - `authorRole: "system"`, `authorAgentId: "hub"` — same `triggers.ts`
 *     precedent as W4.1.
 *   - `target: null` (broadcast) — legacy `Notification.targetRoles` is
 *     multi-valued and SSE routing is independently driven by
 *     `notifyConnectedAgents` / selector-matching; the persisted Message
 *     is bookkeeping, not the routing primitive. Multi-role targetRoles
 *     are preserved verbatim in `payload.targetRoles`.
 *   - `delivery: "push-immediate"` — synchronous emit.
 *   - `payload: { event, data, targetRoles }` — preserves the legacy
 *     Notification field shape so external observers / future read-paths
 *     can recover the original envelope.
 *
 * Subkind discriminator: `payload.event` (the legacy event-name string).
 * Same pattern as the Universal Adapter notification contract spec's
 * `event.event` discriminator, and W4.1's `payload.source`.
 *
 * SSE delivery (no double-send): the W1a push-on-create path fires
 * inside the `create_message` MCP **tool handler** (in `message-policy.ts`),
 * NOT inside `messageStore.createMessage` itself. This helper invokes
 * `messageStore.createMessage` directly (not via the policy router), so
 * W1a does not auto-fire. The existing `notifyConnectedAgents` SSE path
 * in `hub-networking.ts` continues to drive delivery, now using
 * `Message.id` as the SSE event-id in place of `notification.id` —
 * forward-compatible with the W1b Last-Event-ID protocol where SSE `id:`
 * is a Message ULID.
 */

import type { IMessageStore, Message } from "../entities/index.js";

/**
 * Emit a legacy SSE-notification as a Message (replaces the legacy
 * `INotificationStore.persist` write path used by `notifyEvent` +
 * `dispatchEvent` in `hub-networking.ts`).
 */
export async function emitLegacyNotification(
  messageStore: IMessageStore,
  event: string,
  data: Record<string, unknown>,
  targetRoles: string[],
): Promise<Message> {
  return messageStore.createMessage({
    kind: "external-injection",
    authorRole: "system",
    authorAgentId: "hub",
    target: null,
    delivery: "push-immediate",
    payload: {
      event,
      data,
      targetRoles,
    },
  });
}
