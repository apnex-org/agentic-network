/**
 * State-projected Message consumption hints — mission-111 / stale_fyi0.
 *
 * Raw Messages remain the sovereign audit record. This module computes a
 * read/egress-time projection for WorkItem notification Messages so historical
 * delivery events do not masquerade as current action prompts.
 */

import type { Message } from "../entities/message.js";
import type { IWorkItemStore, WorkItem, WorkItemPhase } from "../entities/work-item.js";
import type { IPolicyContext } from "./types.js";

export type MessageProjectionPresentation = "actionable" | "awareness" | "historical" | "degraded";
export type MessageProjectionActionability = "your-turn" | "ack-only" | "inspect" | "none";

export interface MessageConsumptionProjection {
  observedAt: string;
  ruleId: string;
  ruleVersion: number;
  presentation: MessageProjectionPresentation;
  actionability: MessageProjectionActionability;
  reason: string;
  rawMessageId: string;
  entitySnapshot?: {
    kind: "workitem";
    id: string;
    status?: WorkItemPhase;
    holder?: string | null;
    priority?: string;
    targetRef?: { kind: string; id: string } | null;
    roleEligibility?: string[];
    eventToStatus?: unknown;
    eventFromStatus?: unknown;
  };
  recipientBasis?: {
    role?: string;
    agentId?: string;
    targetRole?: string;
    targetAgentId?: string;
  };
  recommendedActions: MessageProjectionActionability[];
  renderBody: string;
  degradedReason?: string;
}

export type ProjectedMessage = Message & { projection?: MessageConsumptionProjection };

export interface ProjectionRecipientContext {
  role?: string;
  agentId?: string;
}

export interface ProjectionRuntime {
  workItem?: IWorkItemStore;
  now?: () => string;
}

const WORK_TRANSITION = "work-transition-notification";
const WORK_UNBLOCKED = "work-unblocked-notification";
const WORK_UPDATED = "work-updated-notification";
const WORK_NOTIFICATION_EVENTS = new Set([WORK_TRANSITION, WORK_UNBLOCKED, WORK_UPDATED]);

function objectPayload(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isTerminal(status: WorkItemPhase | undefined): boolean {
  return status === "done" || status === "abandoned";
}

function targetLabel(message: Message): { targetRole?: string; targetAgentId?: string } {
  return {
    ...(message.target?.role ? { targetRole: message.target.role } : {}),
    ...(message.target?.agentId ? { targetAgentId: message.target.agentId } : {}),
  };
}

function recipientFor(message: Message, recipient?: ProjectionRecipientContext): ProjectionRecipientContext {
  return {
    role: recipient?.role ?? message.target?.role,
    agentId: recipient?.agentId ?? message.target?.agentId,
  };
}

function eventStatus(payload: Record<string, unknown>, key: "from_status" | "to_status"): WorkItemPhase | undefined {
  const value = payload[key];
  return typeof value === "string" ? value as WorkItemPhase : undefined;
}

function renderBodyPrefix(projection: Pick<MessageConsumptionProjection, "presentation" | "actionability">): string {
  if (projection.presentation === "actionable" && projection.actionability === "your-turn") return "[Hub]";
  if (projection.presentation === "degraded") return "[Hub] Needs manual check";
  if (projection.presentation === "historical") return "[Hub] Historical/no action";
  return "[Hub] Awareness";
}

function reasonForNonClaimable(item: WorkItem, role?: string): string {
  if (item.status === "paused") return "paused-now";
  if (item.status === "claimed" || item.status === "in_progress" || item.status === "blocked" || item.status === "review") return "already-held-or-in-flight";
  if (isTerminal(item.status)) return "terminal-now";
  if (role && item.roleEligibility.length > 0 && !item.roleEligibility.includes(role)) return "role-ineligible-now";
  if (item.status !== "ready") return `status-${item.status}-now`;
  return "not-currently-claimable";
}

async function computeClaimable(
  store: IWorkItemStore,
  item: WorkItem,
  recipient: ProjectionRecipientContext,
): Promise<{ claimable: boolean; reason?: string }> {
  if (item.status !== "ready") return { claimable: false, reason: reasonForNonClaimable(item, recipient.role) };

  try {
    const role = recipient.role;
    const ready = await store.listReadyForRole(role, 500, recipient.agentId);
    if (ready.items.some((candidate) => candidate.id === item.id)) return { claimable: true };
    if (ready.emptyReason) return { claimable: false, reason: ready.emptyReason };
    return { claimable: false, reason: reasonForNonClaimable(item, role) };
  } catch (err) {
    return { claimable: false, reason: `claimability-projection-failed:${(err as Error)?.message ?? String(err)}` };
  }
}

function withProjection(message: Message, projection: MessageConsumptionProjection): ProjectedMessage {
  return { ...message, projection };
}

function degradedProjection(
  message: Message,
  payload: Record<string, unknown>,
  observedAt: string,
  reason: string,
  recipient: ProjectionRecipientContext,
): ProjectedMessage {
  const workId = typeof payload.work_id === "string" ? payload.work_id : "unknown-workitem";
  const renderBody = `${renderBodyPrefix({ presentation: "degraded", actionability: "inspect" })}: ${workId} notification could not be projected against current WorkGraph truth (${reason}). Inspect raw message ${message.id}.`;
  return withProjection(message, {
    observedAt,
    ruleId: "workitem-notification-projection-v1",
    ruleVersion: 1,
    presentation: "degraded",
    actionability: "inspect",
    reason: "unprojected-needs-check",
    rawMessageId: message.id,
    entitySnapshot: { kind: "workitem", id: workId },
    recipientBasis: { ...recipient, ...targetLabel(message) },
    recommendedActions: ["inspect"],
    renderBody,
    degradedReason: reason,
  });
}

function baseSnapshot(payload: Record<string, unknown>, item: WorkItem): NonNullable<MessageConsumptionProjection["entitySnapshot"]> {
  return {
    kind: "workitem",
    id: item.id,
    status: item.status,
    holder: item.lease?.holder ?? null,
    priority: item.priority,
    targetRef: item.targetRef,
    roleEligibility: item.roleEligibility,
    eventFromStatus: payload.from_status,
    eventToStatus: payload.to_status,
  };
}

function projectionBody(
  item: WorkItem,
  projection: Pick<MessageConsumptionProjection, "presentation" | "actionability" | "reason">,
  payload: Record<string, unknown>,
): string {
  const prefix = renderBodyPrefix(projection);
  const event = typeof payload.notificationEvent === "string" ? payload.notificationEvent : "work-notification";
  const verb = typeof payload.verb === "string" ? ` (${payload.verb})` : "";
  const eventTo = typeof payload.to_status === "string" ? ` event→${payload.to_status}` : "";
  const holder = item.lease?.holder ? ` holder=${item.lease.holder}` : "";
  return `${prefix}: ${item.id}${verb} ${event}${eventTo}; current=${item.status}${holder}; reason=${projection.reason}. Raw event retained.`;
}

export async function projectMessageForConsumption(
  runtime: ProjectionRuntime,
  message: Message,
  recipientContext?: ProjectionRecipientContext,
): Promise<ProjectedMessage> {
  const payload = objectPayload(message.payload);
  if (!payload || message.kind !== "external-injection") return message;
  const event = payload.notificationEvent;
  if (typeof event !== "string" || !WORK_NOTIFICATION_EVENTS.has(event)) return message;

  const observedAt = runtime.now?.() ?? new Date().toISOString();
  const recipient = recipientFor(message, recipientContext);
  const workId = payload.work_id;
  if (typeof workId !== "string" || workId.length === 0) {
    return degradedProjection(message, payload, observedAt, "missing-work-id", recipient);
  }
  const store = runtime.workItem;
  if (!store) return degradedProjection(message, payload, observedAt, "work-item-store-unavailable", recipient);

  let item: WorkItem | null;
  try {
    item = await store.getWorkItem(workId);
  } catch (err) {
    return degradedProjection(message, payload, observedAt, `work-item-read-failed:${(err as Error)?.message ?? String(err)}`, recipient);
  }
  if (!item) return degradedProjection(message, payload, observedAt, "work-item-not-found", recipient);

  const toStatus = eventStatus(payload, "to_status");
  const { claimable, reason: claimabilityReason } = await computeClaimable(store, item, recipient);

  let presentation: MessageProjectionPresentation = "awareness";
  let actionability: MessageProjectionActionability = "ack-only";
  let reason = "awareness-current-state";

  if (event === WORK_UNBLOCKED) {
    if (claimable) {
      presentation = "actionable";
      actionability = "your-turn";
      reason = "claimable-now";
    } else {
      presentation = isTerminal(item.status) || item.status !== "ready" ? "historical" : "awareness";
      actionability = "ack-only";
      reason = claimabilityReason ?? "not-currently-claimable";
    }
  } else if (event === WORK_UPDATED) {
    presentation = "awareness";
    actionability = item.lease?.holder && item.lease.holder === recipient.agentId ? "inspect" : "ack-only";
    reason = actionability === "inspect" ? "held-work-updated" : "work-updated-awareness";
  } else {
    if (isTerminal(item.status)) {
      presentation = "historical";
      actionability = "none";
      reason = "terminal-now";
    } else if (toStatus && toStatus !== item.status) {
      presentation = "historical";
      actionability = "ack-only";
      reason = "superseded-by-status";
    } else if (claimable) {
      presentation = "actionable";
      actionability = "your-turn";
      reason = "claimable-now";
    } else if (item.lease?.holder && item.lease.holder === recipient.agentId) {
      presentation = "awareness";
      actionability = "inspect";
      reason = "held-by-recipient";
    } else {
      presentation = "awareness";
      actionability = "ack-only";
      reason = claimabilityReason ?? "not-currently-actionable";
    }
  }

  const projectionBase = { presentation, actionability, reason };
  return withProjection(message, {
    observedAt,
    ruleId: "workitem-notification-projection-v1",
    ruleVersion: 1,
    presentation,
    actionability,
    reason,
    rawMessageId: message.id,
    entitySnapshot: baseSnapshot(payload, item),
    recipientBasis: { ...recipient, ...targetLabel(message) },
    recommendedActions: actionability === "none" ? [] : [actionability],
    renderBody: projectionBody(item, projectionBase, payload),
  });
}

export async function projectMessagesForConsumption(
  runtime: ProjectionRuntime,
  messages: Message[],
  recipientContext?: ProjectionRecipientContext,
): Promise<ProjectedMessage[]> {
  return Promise.all(messages.map((message) => projectMessageForConsumption(runtime, message, recipientContext)));
}

export function messageArrivalData(projected: ProjectedMessage): Record<string, unknown> {
  const projection = projected.projection;
  if (!projection) return { message: projected };
  return {
    message: projected,
    projection,
    sourceClass: "workitem",
    entityRef: `workitem:${projection.entitySnapshot?.id ?? projection.rawMessageId}`,
    actionability: projection.actionability === "your-turn" ? "your-turn" : "FYI",
    body: projection.renderBody,
  };
}

export async function projectMessageArrivalData(
  ctx: IPolicyContext,
  message: Message,
  recipientContext?: ProjectionRecipientContext,
): Promise<Record<string, unknown>> {
  const projected = await projectMessageForConsumption(
    { workItem: ctx.stores.workItem },
    message,
    recipientContext,
  );
  return messageArrivalData(projected);
}
