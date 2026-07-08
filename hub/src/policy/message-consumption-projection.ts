/**
 * State-projected Message consumption hints — mission-111 / stale_fyi0.
 *
 * Raw Messages remain the sovereign audit record. This module computes a
 * read/egress-time projection for WorkItem notification Messages so historical
 * delivery events do not masquerade as current action prompts.
 *
 * mission-112 / evpolicy0 Slice 0 lifts the first WorkItem notification rule
 * into a static EventPolicy registry + deterministic evaluator boundary. The
 * only Slice 0 effect is message projection; rules are code-review-owned and do
 * not mutate WorkGraph, Message, Decision, or Thread state.
 */

import type { Message } from "../entities/message.js";
import type { IWorkItemStore, WorkItem, WorkItemPhase } from "../entities/work-item.js";
import type { IEngineerRegistry } from "../state.js";
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
  recipientBasis?: EventPolicyRecipientBasis;
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
  engineerRegistry?: Pick<IEngineerRegistry, "getAgent">;
  now?: () => string;
}

export type EventPolicyEffectType = "message-projection";

export interface EventPolicyRule {
  ruleId: string;
  version: number;
  enabled: boolean;
  eventFamily: string;
  match: {
    messageKinds: string[];
    notificationEvents: string[];
  };
  requiredContext: string[];
  outputs: EventPolicyEffectType[];
  bypassClasses: string[];
  authority: {
    mutation: "code-review-only-for-slice0";
    runtimeActions: "none";
  };
}

export interface EventPolicyRawEventSummary {
  rawMessageId: string;
  messageKind: string;
  notificationEvent?: string;
  workId?: string;
  verb?: string;
  fromStatus?: string;
  toStatus?: string;
  actorRole?: string;
  actorAgentId?: string;
  targetRole?: string;
}

export interface EventPolicyWorkItemSnapshot {
  kind: "workitem";
  id: string;
  status?: WorkItemPhase;
  holder?: string | null;
  priority?: string;
  targetRef?: { kind: string; id: string } | null;
  roleEligibility?: string[];
  eventFromStatus?: unknown;
  eventToStatus?: unknown;
}

export interface EventPolicyRecipientBasis {
  role?: string;
  agentId?: string;
  targetRole?: string;
  targetAgentId?: string;
}

export interface EventPolicyLegalMovesBasis {
  claim?: { legal: boolean; reason?: string };
  start?: { legal: boolean; reason?: string };
  complete?: { legal: boolean; reason?: string };
  source: "item-local-legal-moves";
}

export interface EventPolicyAgentBasis {
  agentId?: string;
  registryRead: "not-needed" | "ok" | "failed";
  quarantined?: boolean;
  errorReason?: string;
}

export interface EventPolicyDecision {
  presentation?: MessageProjectionPresentation;
  actionability?: MessageProjectionActionability;
  reason?: string;
  degradedReason?: string;
}

export interface EventPolicyEffect {
  type: EventPolicyEffectType;
  rawMessageId: string;
}

export interface EventPolicyAudit {
  rawMessageId: string;
  eventFamily?: string;
  notificationEvent?: string;
  entityRefs: string[];
  recipientBasis?: EventPolicyRecipientBasis;
  stateRefs?: string[];
  contextErrors?: string[];
  authority: {
    runtimeActions: "none";
  };
}

export interface EventPolicyEvaluation {
  ruleId?: string;
  ruleVersion?: number;
  matched: boolean;
  productionEligible: boolean;
  selectedBy: "production" | "explicit-dry-run" | "none" | "conflict";
  decision: EventPolicyDecision;
  effects: EventPolicyEffect[];
  audit: EventPolicyAudit;
}

export interface EventPolicySelection {
  matched: boolean;
  selectedBy: "production" | "none" | "conflict";
  productionEligible: boolean;
  rule?: EventPolicyRule;
  conflicts?: EventPolicyRule[];
}

export interface EventPolicyCollectedContext {
  rawEvent: EventPolicyRawEventSummary;
  recipientBasis: EventPolicyRecipientBasis;
  workItem?: EventPolicyWorkItemSnapshot;
  legalMoves?: EventPolicyLegalMovesBasis;
  agent?: EventPolicyAgentBasis;
  contextErrors: string[];
}

export interface SyntheticEventPolicyContext {
  workItem?: EventPolicyWorkItemSnapshot | null;
  legalMoves?: EventPolicyLegalMovesBasis;
  agent?: EventPolicyAgentBasis;
  contextErrors?: string[];
}

export interface DryRunEventPolicyInput {
  message: Message;
  recipient?: ProjectionRecipientContext;
  registry?: readonly EventPolicyRule[];
  context: SyntheticEventPolicyContext;
  ruleSelector?: { ruleId: string; version: number };
}

const WORK_TRANSITION = "work-transition-notification";
const WORK_UNBLOCKED = "work-unblocked-notification";
const WORK_UPDATED = "work-updated-notification";

export const WORKITEM_NOTIFICATION_RULE: EventPolicyRule = {
  ruleId: "workitem-notification-projection-v1",
  version: 1,
  enabled: true,
  eventFamily: "workitem-notification",
  match: {
    messageKinds: ["external-injection"],
    notificationEvents: [WORK_TRANSITION, WORK_UNBLOCKED, WORK_UPDATED],
  },
  requiredContext: ["message", "workItem", "recipient", "legalMoves", "agentRegistry"],
  outputs: ["message-projection"],
  // Metadata-only in Slice 0; no broad bypass behavior is enforced or claimed.
  bypassClasses: ["critical", "director-decision", "verifier-failure", "lease-risk"],
  authority: {
    mutation: "code-review-only-for-slice0",
    runtimeActions: "none",
  },
};

export const EVENT_POLICY_REGISTRY: readonly EventPolicyRule[] = [WORKITEM_NOTIFICATION_RULE];

function objectPayload(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
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

function reasonForNonClaimableSnapshot(snapshot: EventPolicyWorkItemSnapshot, role?: string): string {
  if (snapshot.status === "paused") return "paused-now";
  if (snapshot.status === "claimed" || snapshot.status === "in_progress" || snapshot.status === "blocked" || snapshot.status === "review") return "already-held-or-in-flight";
  if (isTerminal(snapshot.status)) return "terminal-now";
  if (role && (snapshot.roleEligibility?.length ?? 0) > 0 && !snapshot.roleEligibility?.includes(role)) return "role-ineligible-now";
  if (snapshot.status && snapshot.status !== "ready") return `status-${snapshot.status}-now`;
  return "not-currently-claimable";
}

function snapshotFromItem(payload: Record<string, unknown>, item: WorkItem): EventPolicyWorkItemSnapshot {
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

function summaryFromMessage(message: Message, payload: Record<string, unknown> | null): EventPolicyRawEventSummary {
  return {
    rawMessageId: message.id,
    messageKind: message.kind,
    ...(payload && stringValue(payload, "notificationEvent") ? { notificationEvent: stringValue(payload, "notificationEvent") } : {}),
    ...(payload && stringValue(payload, "work_id") ? { workId: stringValue(payload, "work_id") } : {}),
    ...(payload && stringValue(payload, "verb") ? { verb: stringValue(payload, "verb") } : {}),
    ...(payload && stringValue(payload, "from_status") ? { fromStatus: stringValue(payload, "from_status") } : {}),
    ...(payload && stringValue(payload, "to_status") ? { toStatus: stringValue(payload, "to_status") } : {}),
    ...(payload && stringValue(payload, "actor_role") ? { actorRole: stringValue(payload, "actor_role") } : {}),
    ...(payload && stringValue(payload, "actor_agent_id") ? { actorAgentId: stringValue(payload, "actor_agent_id") } : {}),
    ...(message.target?.role ? { targetRole: message.target.role } : {}),
  };
}

export function validateEventPolicyRegistry(registry: readonly EventPolicyRule[] = EVENT_POLICY_REGISTRY): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const matchKeys = new Map<string, string>();

  for (const rule of registry) {
    const idVersion = `${rule.ruleId}@${rule.version}`;
    if (seen.has(idVersion)) errors.push(`duplicate-rule:${idVersion}`);
    seen.add(idVersion);
    if (!Number.isInteger(rule.version) || rule.version <= 0) errors.push(`invalid-version:${idVersion}`);
    if (rule.enabled && rule.match.notificationEvents.length === 0) errors.push(`empty-match-events:${idVersion}`);
    if (rule.outputs.length !== 1 || rule.outputs[0] !== "message-projection") errors.push(`invalid-outputs:${idVersion}`);
    if (rule.authority.runtimeActions !== "none") errors.push(`invalid-runtime-actions:${idVersion}`);

    if (!rule.enabled) continue;
    for (const kind of rule.match.messageKinds) {
      for (const event of rule.match.notificationEvents) {
        const matchKey = `${kind}:${event}`;
        const prior = matchKeys.get(matchKey);
        if (prior) errors.push(`ambiguous-match:${matchKey}:${prior},${idVersion}`);
        matchKeys.set(matchKey, idVersion);
      }
    }
  }

  return errors;
}

export function selectEventPolicyRule(
  message: Message,
  registry: readonly EventPolicyRule[] = EVENT_POLICY_REGISTRY,
): EventPolicySelection {
  const payload = objectPayload(message.payload);
  const event = payload ? stringValue(payload, "notificationEvent") : undefined;
  if (!event) return { matched: false, selectedBy: "none", productionEligible: false };

  const matches = registry.filter((rule) =>
    rule.enabled &&
    rule.match.messageKinds.includes(message.kind) &&
    rule.match.notificationEvents.includes(event),
  );

  if (matches.length === 0) return { matched: false, selectedBy: "none", productionEligible: false };
  if (matches.length > 1) return { matched: false, selectedBy: "conflict", productionEligible: false, conflicts: matches };
  return { matched: true, selectedBy: "production", productionEligible: true, rule: matches[0] };
}

function noMatchEvaluation(rawEvent: EventPolicyRawEventSummary): EventPolicyEvaluation {
  return {
    matched: false,
    productionEligible: false,
    selectedBy: "none",
    decision: {},
    effects: [],
    audit: {
      rawMessageId: rawEvent.rawMessageId,
      notificationEvent: rawEvent.notificationEvent,
      entityRefs: rawEvent.workId ? [`WorkItem/${rawEvent.workId}`] : [],
      authority: { runtimeActions: "none" },
    },
  };
}

function conflictEvaluation(rawEvent: EventPolicyRawEventSummary, recipientBasis?: EventPolicyRecipientBasis): EventPolicyEvaluation {
  return {
    matched: false,
    productionEligible: false,
    selectedBy: "conflict",
    decision: {
      presentation: "degraded",
      actionability: "inspect",
      reason: "rule-conflict",
      degradedReason: "rule-conflict",
    },
    effects: [{ type: "message-projection", rawMessageId: rawEvent.rawMessageId }],
    audit: {
      rawMessageId: rawEvent.rawMessageId,
      notificationEvent: rawEvent.notificationEvent,
      entityRefs: rawEvent.workId ? [`WorkItem/${rawEvent.workId}`] : [],
      recipientBasis,
      contextErrors: ["rule-conflict"],
      authority: { runtimeActions: "none" },
    },
  };
}

function contextErrorEvaluation(
  rule: EventPolicyRule,
  context: EventPolicyCollectedContext,
  reason: string,
): EventPolicyEvaluation {
  return {
    ruleId: rule.ruleId,
    ruleVersion: rule.version,
    matched: true,
    productionEligible: rule.enabled,
    selectedBy: "production",
    decision: {
      presentation: "degraded",
      actionability: "inspect",
      reason,
      degradedReason: reason,
    },
    effects: [{ type: "message-projection", rawMessageId: context.rawEvent.rawMessageId }],
    audit: {
      rawMessageId: context.rawEvent.rawMessageId,
      eventFamily: rule.eventFamily,
      notificationEvent: context.rawEvent.notificationEvent,
      entityRefs: context.rawEvent.workId ? [`WorkItem/${context.rawEvent.workId}`] : [],
      recipientBasis: context.recipientBasis,
      stateRefs: context.workItem ? [`WorkItem/${context.workItem.id}`] : [],
      contextErrors: context.contextErrors.length > 0 ? context.contextErrors : [reason],
      authority: { runtimeActions: rule.authority.runtimeActions },
    },
  };
}

export function evaluateWorkItemNotificationPolicy(
  rule: EventPolicyRule,
  context: EventPolicyCollectedContext,
  selectedBy: "production" | "explicit-dry-run" = "production",
): EventPolicyEvaluation {
  const firstError = context.contextErrors[0];
  if (firstError) return { ...contextErrorEvaluation(rule, context, firstError), selectedBy };

  const item = context.workItem;
  if (!item) return { ...contextErrorEvaluation(rule, context, "workitem-not-found"), selectedBy };

  const event = context.rawEvent.notificationEvent;
  const toStatus = context.rawEvent.toStatus;
  const role = context.recipientBasis.role;
  const agentId = context.recipientBasis.agentId;
  const claimMove = context.legalMoves?.claim;
  const claimable = claimMove?.legal === true;
  const claimabilityReason = context.agent?.quarantined
    ? "quarantined"
    : claimMove?.reason ?? reasonForNonClaimableSnapshot(item, role);

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
    actionability = item.holder && item.holder === agentId ? "inspect" : "ack-only";
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
    } else if (item.holder && item.holder === agentId) {
      presentation = "awareness";
      actionability = "inspect";
      reason = "held-by-recipient";
    } else {
      presentation = "awareness";
      actionability = "ack-only";
      reason = claimabilityReason ?? "not-currently-actionable";
    }
  }

  return {
    ruleId: rule.ruleId,
    ruleVersion: rule.version,
    matched: true,
    productionEligible: rule.enabled,
    selectedBy,
    decision: { presentation, actionability, reason },
    effects: [{ type: "message-projection", rawMessageId: context.rawEvent.rawMessageId }],
    audit: {
      rawMessageId: context.rawEvent.rawMessageId,
      eventFamily: rule.eventFamily,
      notificationEvent: event,
      entityRefs: [`WorkItem/${item.id}`],
      recipientBasis: context.recipientBasis,
      stateRefs: [`WorkItem/${item.id}`],
      contextErrors: context.contextErrors.length > 0 ? context.contextErrors : undefined,
      authority: { runtimeActions: rule.authority.runtimeActions },
    },
  };
}

async function collectWorkItemContext(
  runtime: ProjectionRuntime,
  message: Message,
  payload: Record<string, unknown>,
  recipient: ProjectionRecipientContext,
): Promise<EventPolicyCollectedContext> {
  const recipientBasis = { ...recipient, ...targetLabel(message) };
  const rawEvent = summaryFromMessage(message, payload);
  const workId = stringValue(payload, "work_id");

  if (!workId) {
    return { rawEvent, recipientBasis, contextErrors: ["missing-work-id"] };
  }

  const store = runtime.workItem;
  if (!store) {
    return { rawEvent, recipientBasis, workItem: { kind: "workitem", id: workId }, contextErrors: ["work-item-store-unavailable"] };
  }

  let item: WorkItem | null;
  try {
    item = await store.getWorkItem(workId);
  } catch (err) {
    return {
      rawEvent,
      recipientBasis,
      workItem: { kind: "workitem", id: workId },
      contextErrors: [`work-item-read-failed:${(err as Error)?.message ?? String(err)}`],
    };
  }

  if (!item) {
    return { rawEvent, recipientBasis, workItem: { kind: "workitem", id: workId }, contextErrors: ["workitem-not-found"] };
  }

  const snapshot = snapshotFromItem(payload, item);
  const context: EventPolicyCollectedContext = {
    rawEvent,
    recipientBasis,
    workItem: snapshot,
    agent: { agentId: recipient.agentId, registryRead: item.status === "ready" ? "ok" : "not-needed" },
    contextErrors: [],
  };

  // Caller-specific claimability is needed only while a specific WorkItem might
  // be claimable. Non-ready rows can be classified from their current state.
  if (item.status !== "ready") return context;

  if (!recipient.agentId) {
    context.contextErrors.push("agent-context-unavailable");
    return context;
  }

  try {
    const agent = await runtime.engineerRegistry?.getAgent(recipient.agentId);
    context.agent = { agentId: recipient.agentId, registryRead: "ok", quarantined: !!agent?.quarantined };
    if (agent?.quarantined) {
      context.legalMoves = {
        source: "item-local-legal-moves",
        claim: { legal: false, reason: "quarantined" },
      };
      return context;
    }
  } catch (err) {
    context.agent = {
      agentId: recipient.agentId,
      registryRead: "failed",
      errorReason: (err as Error)?.message ?? String(err),
    };
    context.contextErrors.push("agent-registry-read-failed");
    return context;
  }

  try {
    const legalMoves = await store.getLegalMoves(item.id, { agentId: recipient.agentId, role: recipient.role });
    if (!legalMoves) {
      context.contextErrors.push("legal-moves-workitem-not-found");
      return context;
    }
    const claimMove = legalMoves.moves.find((move) => move.verb === "claim");
    const startMove = legalMoves.moves.find((move) => move.verb === "start");
    const completeMove = legalMoves.moves.find((move) => move.verb === "complete");
    if (!claimMove) {
      context.contextErrors.push("claim-move-missing");
      return context;
    }
    context.legalMoves = {
      source: "item-local-legal-moves",
      claim: claimMove.legal ? { legal: true } : { legal: false, reason: claimMove.reason },
      ...(startMove ? { start: startMove.legal ? { legal: true } : { legal: false, reason: startMove.reason } } : {}),
      ...(completeMove ? { complete: completeMove.legal ? { legal: true } : { legal: false, reason: completeMove.reason } } : {}),
    };
  } catch (err) {
    context.contextErrors.push(`legal-moves-read-failed:${(err as Error)?.message ?? String(err)}`);
  }

  return context;
}

function projectionBody(
  snapshot: EventPolicyWorkItemSnapshot,
  projection: Pick<MessageConsumptionProjection, "presentation" | "actionability" | "reason">,
  rawEvent: EventPolicyRawEventSummary,
): string {
  const prefix = renderBodyPrefix(projection);
  const event = rawEvent.notificationEvent ?? "work-notification";
  const verb = rawEvent.verb ? ` (${rawEvent.verb})` : "";
  const eventTo = rawEvent.toStatus ? ` event→${rawEvent.toStatus}` : "";
  const holder = snapshot.holder ? ` holder=${snapshot.holder}` : "";
  return `${prefix}: ${snapshot.id}${verb} ${event}${eventTo}; current=${snapshot.status ?? "unknown"}${holder}; reason=${projection.reason}. Raw event retained.`;
}

function degradedBody(workId: string, messageId: string, reason: string): string {
  return `${renderBodyPrefix({ presentation: "degraded", actionability: "inspect" })}: ${workId} notification could not be projected against current WorkGraph truth (${reason}). Inspect raw message ${messageId}.`;
}

function projectionFromEvaluation(
  message: Message,
  evaluation: EventPolicyEvaluation,
  context: EventPolicyCollectedContext,
  observedAt: string,
): MessageConsumptionProjection {
  const decision = evaluation.decision;
  const presentation = decision.presentation ?? "degraded";
  const actionability = decision.actionability ?? "inspect";
  const reason = decision.reason ?? "unprojected-needs-check";
  const fallbackWorkId = context.rawEvent.workId ?? "unknown-workitem";
  const snapshot = context.workItem ?? { kind: "workitem" as const, id: fallbackWorkId };
  const renderBody = context.workItem
    ? projectionBody(snapshot, { presentation, actionability, reason }, context.rawEvent)
    : degradedBody(fallbackWorkId, message.id, reason);

  return {
    observedAt,
    ruleId: evaluation.ruleId ?? WORKITEM_NOTIFICATION_RULE.ruleId,
    ruleVersion: evaluation.ruleVersion ?? WORKITEM_NOTIFICATION_RULE.version,
    presentation,
    actionability,
    reason,
    rawMessageId: message.id,
    entitySnapshot: snapshot,
    recipientBasis: context.recipientBasis,
    recommendedActions: actionability === "none" ? [] : [actionability],
    renderBody,
    ...(decision.degradedReason ? { degradedReason: decision.degradedReason } : {}),
  };
}

function withProjection(message: Message, projection: MessageConsumptionProjection): ProjectedMessage {
  return { ...message, projection };
}

export function dryRunEventPolicy(input: DryRunEventPolicyInput): EventPolicyEvaluation {
  const registry = input.registry ?? EVENT_POLICY_REGISTRY;
  const payload = objectPayload(input.message.payload);
  const rawEvent = summaryFromMessage(input.message, payload);
  const recipientBasis = { ...recipientFor(input.message, input.recipient), ...targetLabel(input.message) };

  if (input.ruleSelector) {
    const explicitRule = registry.find((rule) => rule.ruleId === input.ruleSelector?.ruleId && rule.version === input.ruleSelector.version);
    if (!explicitRule) return noMatchEvaluation(rawEvent);
    return evaluateWorkItemNotificationPolicy(
      explicitRule,
      {
        rawEvent,
        recipientBasis,
        ...(input.context.workItem ? { workItem: input.context.workItem } : {}),
        ...(input.context.legalMoves ? { legalMoves: input.context.legalMoves } : {}),
        ...(input.context.agent ? { agent: input.context.agent } : {}),
        contextErrors: input.context.contextErrors ?? [],
      },
      "explicit-dry-run",
    );
  }

  const selection = selectEventPolicyRule(input.message, registry);
  if (selection.selectedBy === "conflict") return conflictEvaluation(rawEvent, recipientBasis);
  if (!selection.rule) return noMatchEvaluation(rawEvent);

  return evaluateWorkItemNotificationPolicy(
    selection.rule,
    {
      rawEvent,
      recipientBasis,
      ...(input.context.workItem ? { workItem: input.context.workItem } : {}),
      ...(input.context.legalMoves ? { legalMoves: input.context.legalMoves } : {}),
      ...(input.context.agent ? { agent: input.context.agent } : {}),
      contextErrors: input.context.contextErrors ?? [],
    },
    "production",
  );
}

export async function projectMessageForConsumption(
  runtime: ProjectionRuntime,
  message: Message,
  recipientContext?: ProjectionRecipientContext,
): Promise<ProjectedMessage> {
  const payload = objectPayload(message.payload);
  const selection = selectEventPolicyRule(message);
  if (!payload || selection.selectedBy === "none") return message;

  const observedAt = runtime.now?.() ?? new Date().toISOString();
  const recipient = recipientFor(message, recipientContext);

  if (selection.selectedBy === "conflict") {
    const rawEvent = summaryFromMessage(message, payload);
    const recipientBasis = { ...recipient, ...targetLabel(message) };
    const context: EventPolicyCollectedContext = {
      rawEvent,
      recipientBasis,
      workItem: rawEvent.workId ? { kind: "workitem", id: rawEvent.workId } : undefined,
      contextErrors: ["rule-conflict"],
    };
    return withProjection(message, projectionFromEvaluation(message, conflictEvaluation(rawEvent, recipientBasis), context, observedAt));
  }

  if (!selection.rule) return message;

  const context = await collectWorkItemContext(runtime, message, payload, recipient);
  const evaluation = evaluateWorkItemNotificationPolicy(selection.rule, context);
  return withProjection(message, projectionFromEvaluation(message, evaluation, context, observedAt));
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
    { workItem: ctx.stores.workItem, engineerRegistry: ctx.stores.engineerRegistry },
    message,
    recipientContext,
  );
  return messageArrivalData(projected);
}
