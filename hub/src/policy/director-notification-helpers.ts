/**
 * DirectorNotification → Message migration helpers — mission-56 W4.1.
 *
 * Per Design v1.2 §"Per-entity migration mechanics" / "Architectural
 * commitments #7": legacy entity sunset for DirectorNotification.
 *
 * Cut-over (no dual-write): write-paths emit Messages instead of
 * DirectorNotifications; read-paths project Messages back to the
 * DirectorNotification view shape so the existing MCP tool surface
 * (`list_director_notifications` / `acknowledge_director_notification`)
 * stays backward-compatible. The legacy `directorNotificationStore` is
 * retained until W5 entity-store removal; new code never touches its
 * write-API.
 *
 * Wire format on Messages:
 *   - `kind: "note"`              — system-emitted, no turn semantics
 *                                    (matches `triggers.ts` + the three
 *                                    inbox-director actors in
 *                                    `downstream-actors.ts`).
 *   - `authorRole: "system"`,
 *     `authorAgentId: "hub"`      — same precedent as `triggers.ts`.
 *   - `target: { role: "director" }` — role-only fanout.
 *   - `delivery: "push-immediate"` — synchronous emit.
 *   - `payload: { severity, source, sourceRef, title, details }` —
 *     the legacy `DirectorNotification` field set, preserved verbatim
 *     so the projection round-trips.
 *
 * Read-path projection filters Messages by (kind=note, target.role=director,
 * payload-shape carrying the legacy fields). Other kind=note director-
 * targeted Messages (e.g., `mission_completion_director_inbox` from
 * `downstream-actors.ts`) carry a different payload shape and are
 * skipped by the projection guard.
 *
 * Acknowledge mapping: legacy `acknowledge(id, by)` stamps
 * `acknowledgedAt + acknowledgedBy`. Maps to W3.2's `claimMessage` +
 * `ackMessage` FSM (`new → received → acked`); the projector reports
 * `acknowledgedAt = updatedAt` (when status is `acked`) and
 * `acknowledgedBy = claimedBy` (the agent that claimed before acking).
 */

import type {
  IMessageStore,
  Message,
} from "../entities/index.js";

/**
 * Mission-56 W5: severity + source enums inlined here from the deleted
 * `director-notification.ts` entity file. The legacy entity store was
 * removed in W5 cleanup; these enums remain the canonical taxonomy for
 * Director-targeted notification payloads (subkind discriminator inside
 * `Message.payload.source`).
 */
export type NotificationSeverity = "info" | "warning" | "critical";

export type NotificationSource =
  | "queue_item_escalated"
  | "agent_unresponsive"
  | "agent_stuck"
  | "cascade_failed"
  | "manual";

export interface DirectorNotificationEmitOptions {
  severity: NotificationSeverity;
  source: NotificationSource;
  sourceRef?: string | null;
  title: string;
  details: string;
}

/**
 * Emit a Director-targeted notification as a Message (replaces the
 * legacy `IDirectorNotificationStore.create` write path).
 */
export async function emitDirectorNotification(
  messageStore: IMessageStore,
  opts: DirectorNotificationEmitOptions,
): Promise<Message> {
  return messageStore.createMessage({
    kind: "note",
    authorRole: "system",
    authorAgentId: "hub",
    target: { role: "director" },
    delivery: "push-immediate",
    payload: {
      severity: opts.severity,
      source: opts.source,
      sourceRef: opts.sourceRef ?? null,
      title: opts.title,
      details: opts.details,
    },
  });
}

/**
 * View shape returned by `list_director_notifications` — preserves the
 * legacy `DirectorNotification` envelope so existing tool consumers
 * don't break across the migration boundary.
 */
export interface DirectorNotificationView {
  id: string;
  severity: NotificationSeverity;
  source: NotificationSource;
  sourceRef: string | null;
  title: string;
  details: string;
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

/**
 * Project a Message back to the `DirectorNotificationView`, or return
 * `null` if the Message is not a Director-notification-shaped record
 * (e.g., other kind=note director-targeted Messages from triggers).
 */
export function projectMessageToDirectorNotification(
  m: Message,
): DirectorNotificationView | null {
  if (m.kind !== "note") return null;
  if (m.target?.role !== "director") return null;
  const p = m.payload as
    | {
        severity?: unknown;
        source?: unknown;
        sourceRef?: unknown;
        title?: unknown;
        details?: unknown;
      }
    | null
    | undefined;
  if (!p || typeof p !== "object") return null;
  if (typeof p.severity !== "string") return null;
  if (typeof p.source !== "string") return null;
  if (typeof p.title !== "string") return null;
  if (typeof p.details !== "string") return null;

  const acknowledged = m.status === "acked";
  return {
    id: m.id,
    severity: p.severity as NotificationSeverity,
    source: p.source as NotificationSource,
    sourceRef: typeof p.sourceRef === "string" ? p.sourceRef : null,
    title: p.title,
    details: p.details,
    createdAt: m.createdAt,
    acknowledgedAt: acknowledged ? m.updatedAt : null,
    acknowledgedBy: acknowledged ? (m.claimedBy ?? null) : null,
  };
}

/**
 * List Director-notification-shaped Messages, applying the legacy
 * `IDirectorNotificationStore.list` filter semantics:
 *
 *   - severity / source: payload-field equality
 *   - acknowledged: true  → status === "acked"
 *                  false → status !== "acked" (new | received)
 *                  undefined → all statuses
 *
 * Returns the projected views in `createdAt` ascending order — matches
 * the legacy repository's natural ID-ordered iteration.
 */
export async function listDirectorNotificationViews(
  messageStore: IMessageStore,
  filter: {
    severity?: NotificationSeverity;
    source?: NotificationSource;
    acknowledged?: boolean;
  },
): Promise<DirectorNotificationView[]> {
  const messages = await messageStore.listMessages({ targetRole: "director" });
  const out: DirectorNotificationView[] = [];
  for (const m of messages) {
    const view = projectMessageToDirectorNotification(m);
    if (!view) continue;
    if (filter.severity !== undefined && view.severity !== filter.severity) continue;
    if (filter.source !== undefined && view.source !== filter.source) continue;
    if (filter.acknowledged === true && view.acknowledgedAt === null) continue;
    if (filter.acknowledged === false && view.acknowledgedAt !== null) continue;
    out.push(view);
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  return out;
}

/**
 * Acknowledge a Director-notification Message. Maps the legacy
 * `acknowledge(id, by)` semantics to the W3.2 claim+ack FSM:
 *
 *   1. `claimMessage(id, callerAgentId)` — flips `new → received` and
 *      stamps `claimedBy` (the legacy `acknowledgedBy` analog). If the
 *      Message is already `received` or `acked`, claim is a no-op
 *      (loser-of-race or already-acked).
 *   2. `ackMessage(id)` — flips `received → acked`. Idempotent on
 *      already-acked.
 *
 * Returns the projected view, or `null` when the Message doesn't exist
 * or is not a Director-notification-shaped record.
 */
export async function acknowledgeDirectorNotificationMessage(
  messageStore: IMessageStore,
  id: string,
  acknowledgedBy: string,
): Promise<DirectorNotificationView | null> {
  await messageStore.claimMessage(id, acknowledgedBy);
  const acked = await messageStore.ackMessage(id);
  if (!acked) return null;
  return projectMessageToDirectorNotification(acked);
}
