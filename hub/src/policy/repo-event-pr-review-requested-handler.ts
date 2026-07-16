import type { Message } from "../entities/index.js";
import type { WorkItem } from "../entities/work-item.js";
import type { IPolicyContext } from "./types.js";
import type { AgentRole } from "../state.js";
import type { MessageDispatch, RepoEventHandler } from "./repo-event-handlers.js";
import { resolveGhLoginAgent } from "./repo-event-author-lookup.js";
import { extractRefField, isRecord } from "./repo-event-pr-handler-helpers.js";
import {
  normalizePrReviewRequestEvent,
  type PrReviewRequestLegacySubkind,
  type PrWorkGraphBindingProof,
  type ReviewerResolutionProof,
} from "./pr-review-workitem-event-contract.js";
import { evaluatePrReviewRequestRule } from "./pr-review-request-static-rule.js";
import { reconcilePrReviewProjection, projectPrReviewWorkItem, type ExistingPrReviewProjection } from "./pr-review-workitem-projection.js";

interface PrReviewRequestPayload {
  repo: string;
  action: "review_requested" | "review_request_removed";
  number: number;
  title: string;
  url: string;
  author: string;
  requestedReviewerLogin: string;
  requestedTeamSlug: string;
  requestedTeamName: string;
  base: { ref: string; sha: string } | undefined;
  head: { ref: string; sha: string } | undefined;
}

type ResolutionProjection = {
  targetResolutionStatus: "unique" | "ambiguous" | "none" | "team";
  targetAgentId?: string;
  targetRole?: AgentRole;
  routingReason: string;
  target: MessageDispatch["target"];
  matchedAgentIds?: string[];
};

const FALLBACK_ROLE: AgentRole = "architect";
const ALLOWED_DIRECT_ROLES: AgentRole[] = ["engineer", "architect", "verifier"];

function extractPayload(raw: Record<string, unknown>): PrReviewRequestPayload | null {
  if (typeof raw.number !== "number") return null;
  const action = raw.action;
  if (action !== "review_requested" && action !== "review_request_removed") return null;
  return {
    repo: typeof raw.repo === "string" ? raw.repo : "",
    action,
    number: raw.number,
    title: typeof raw.title === "string" ? raw.title : "",
    url: typeof raw.url === "string" ? raw.url : "",
    author: typeof raw.author === "string" ? raw.author : "",
    requestedReviewerLogin:
      typeof raw.requestedReviewerLogin === "string" ? raw.requestedReviewerLogin : "",
    requestedTeamSlug: typeof raw.requestedTeamSlug === "string" ? raw.requestedTeamSlug : "",
    requestedTeamName: typeof raw.requestedTeamName === "string" ? raw.requestedTeamName : "",
    base: extractRefField(raw.base),
    head: extractRefField(raw.head),
  };
}

function extractInboundPayload(inbound: Message): PrReviewRequestPayload | null {
  const repoEvent = inbound.payload as { payload?: unknown } | undefined;
  const inner = repoEvent?.payload;
  if (!isRecord(inner)) return null;
  return extractPayload(inner);
}

function fallbackProjection(status: "ambiguous" | "none" | "team", reason: string): ResolutionProjection {
  return {
    targetResolutionStatus: status,
    targetRole: FALLBACK_ROLE,
    routingReason: reason,
    target: { role: FALLBACK_ROLE },
  };
}

async function resolveTarget(
  payload: PrReviewRequestPayload,
  ctx: IPolicyContext,
): Promise<ResolutionProjection> {
  if (payload.requestedReviewerLogin) {
    const resolution = await resolveGhLoginAgent(ctx, payload.requestedReviewerLogin, {
      allowedRoles: ALLOWED_DIRECT_ROLES,
    });
    if (resolution.status === "unique") {
      return {
        targetResolutionStatus: "unique",
        targetAgentId: resolution.agent.id,
        targetRole: resolution.agent.role,
        routingReason: "requested_reviewer_unique",
        target: { agentId: resolution.agent.id },
      };
    }
    if (resolution.status === "ambiguous") {
      return {
        ...fallbackProjection("ambiguous", "requested_reviewer_ambiguous"),
        matchedAgentIds: resolution.matchedAgentIds,
      };
    }
    return fallbackProjection("none", "requested_reviewer_unresolved");
  }

  if (payload.requestedTeamSlug || payload.requestedTeamName) {
    return fallbackProjection("team", "team_request_unresolved");
  }

  return fallbackProjection("none", "requested_target_missing");
}

function actionNoun(payload: PrReviewRequestPayload): string {
  return payload.action === "review_request_removed" ? "review request removed" : "review requested";
}

function requestedSubject(payload: PrReviewRequestPayload): string {
  if (payload.requestedReviewerLogin) return `@${payload.requestedReviewerLogin}`;
  if (payload.requestedTeamSlug) return `team ${payload.requestedTeamSlug}`;
  if (payload.requestedTeamName) return `team ${payload.requestedTeamName}`;
  return "unresolved reviewer/team";
}

function reviewerProofFromResolution(resolution: ResolutionProjection): ReviewerResolutionProof {
  return {
    status: resolution.targetResolutionStatus,
    agentId: resolution.targetAgentId,
    role: resolution.targetRole,
    matchedAgentIds: resolution.matchedAgentIds,
  };
}

function bindingFromWorkItem(item: WorkItem, payload: PrReviewRequestPayload): PrWorkGraphBindingProof | null {
  const p = item.payload;
  if (!isRecord(p)) return null;
  if (p.obligationKind !== "github_pr_workgraph_binding") return null;
  if (p.repo !== payload.repo || p.prNumber !== payload.number) return null;
  if (typeof p.targetWorkId !== "string") return null;
  if (item.createdBy?.role !== "architect" && item.createdBy?.role !== "system") return null;
  return {
    id: item.id,
    repo: payload.repo,
    prNumber: payload.number,
    targetWorkId: p.targetWorkId,
    provenance: "hub",
    headSha: typeof p.headSha === "string" ? p.headSha : undefined,
    baseSha: typeof p.baseSha === "string" ? p.baseSha : undefined,
    version: typeof p.version === "string" ? p.version : undefined,
  };
}

async function listPrReviewBindingCandidates(
  ctx: IPolicyContext,
  payload: PrReviewRequestPayload,
): Promise<{ items: WorkItem[]; truncated: boolean }> {
  const store = ctx.stores.workItem;
  if (!store) return { items: [], truncated: false };
  if (typeof store.listPrReviewBindingWorkItems === "function") {
    return store.listPrReviewBindingWorkItems(payload.repo, payload.number);
  }
  // Back-compat for narrow test doubles/older stores: retain behavior, but production
  // repositories implement the keyed path above so authority lookups are not hostage
  // to an unfiltered cap.
  return store.listWorkItems();
}

async function listProjectionCandidates(
  ctx: IPolicyContext,
  projectionKey: string,
): Promise<{ items: WorkItem[]; truncated: boolean }> {
  const store = ctx.stores.workItem;
  if (!store) return { items: [], truncated: false };
  if (typeof store.listWorkItemsByProjectionKey === "function") {
    return store.listWorkItemsByProjectionKey(projectionKey);
  }
  return store.listWorkItems();
}

type HubBindingResolution =
  | { binding: PrWorkGraphBindingProof; denialReason?: undefined }
  | { binding: null; denialReason?: "binding_ambiguous" };

async function resolveHubBinding(ctx: IPolicyContext, payload: PrReviewRequestPayload): Promise<HubBindingResolution> {
  if (!ctx.stores.workItem) return { binding: null };
  const listed = await listPrReviewBindingCandidates(ctx, payload);
  if (listed.truncated) {
    console.warn(
      `[repo-event-pr-review-requested-handler] binding lookup for ${payload.repo}#${payload.number} hit payload-filter cap`,
    );
  }
  const matches = listed.items
    .map((item) => bindingFromWorkItem(item, payload))
    .filter((binding): binding is PrWorkGraphBindingProof => binding !== null);
  if (matches.length === 1) return { binding: matches[0] };
  if (matches.length > 1) return { binding: null, denialReason: "binding_ambiguous" };
  return { binding: null };
}

async function findExistingProjection(
  ctx: IPolicyContext,
  projectionKey: string | null,
): Promise<ExistingPrReviewProjection | null> {
  if (!projectionKey || !ctx.stores.workItem) return null;
  const listed = await listProjectionCandidates(ctx, projectionKey);
  if (listed.truncated) {
    console.warn(
      `[repo-event-pr-review-requested-handler] projection lookup for ${projectionKey} hit payload-filter cap`,
    );
  }
  const found = listed.items.find((item) => {
    const payload = item.payload;
    return isRecord(payload) && payload.projectionKey === projectionKey;
  });
  return found ? { projectionKey, workId: found.id, status: found.status } : null;
}

async function buildDispatch(
  inbound: Message,
  subkind: PrReviewRequestLegacySubkind,
  payload: PrReviewRequestPayload,
  ctx: IPolicyContext,
  resolution: ResolutionProjection,
): Promise<MessageDispatch> {
  const intent =
    subkind === "pr-review-request-removed"
      ? "pr-review-request-removed-notification"
      : "pr-review-requested-notification";
  const normalizedEvent = normalizePrReviewRequestEvent({
    legacySubkind: subkind,
    sourceMessageId: inbound.id,
    repo: payload.repo,
    prNumber: payload.number,
    title: payload.title,
    url: payload.url,
    authorLogin: payload.author,
    requestedReviewerLogin: payload.requestedReviewerLogin,
    requestedTeamSlug: payload.requestedTeamSlug,
    requestedTeamName: payload.requestedTeamName,
    baseRef: payload.base?.ref,
    baseSha: payload.base?.sha,
    headRef: payload.head?.ref,
    headSha: payload.head?.sha,
  });
  const bindingResolution = await resolveHubBinding(ctx, payload);
  const binding = bindingResolution.binding;
  const target = binding && ctx.stores.workItem
    ? await ctx.stores.workItem.getWorkItem(binding.targetWorkId)
    : null;
  const preliminaryRuleDecision = evaluatePrReviewRequestRule({
    event: normalizedEvent,
    binding,
    bindingDenialReason: bindingResolution.denialReason,
    target: target ? { id: target.id, status: target.status } : null,
    reviewer: reviewerProofFromResolution(resolution),
  });
  const existingProjection = await findExistingProjection(
    ctx,
    preliminaryRuleDecision.bindingDecision.ok ? preliminaryRuleDecision.bindingDecision.projectionKey : null,
  );
  const ruleDecision = evaluatePrReviewRequestRule({
    event: normalizedEvent,
    binding,
    bindingDenialReason: bindingResolution.denialReason,
    target: target ? { id: target.id, status: target.status } : null,
    reviewer: reviewerProofFromResolution(resolution),
    existingObligation: existingProjection
      ? { id: existingProjection.workId, status: existingProjection.status as WorkItem["status"] }
      : null,
  });
  const projectionDecision = projectPrReviewWorkItem({ ruleResult: ruleDecision, existingProjection });
  const materialization = await reconcilePrReviewProjection({
    store: ctx.stores.workItem,
    projection: projectionDecision,
    binding,
    sourceMessageId: inbound.id,
  });
  const body = `${actionNoun(payload)} for PR #${payload.number}: ${requestedSubject(payload)}`;
  return {
    kind: "note",
    target: resolution.target,
    delivery: "push-immediate",
    intent,
    payload: {
      body,
      repo: payload.repo,
      prNumber: payload.number,
      title: payload.title,
      url: payload.url,
      authorLogin: payload.author,
      requestedReviewerLogin: payload.requestedReviewerLogin,
      requestedTeamSlug: payload.requestedTeamSlug,
      requestedTeamName: payload.requestedTeamName,
      reviewRequestAction: payload.action,
      subkind,
      targetResolutionStatus: resolution.targetResolutionStatus,
      targetAgentId: resolution.targetAgentId,
      targetRole: resolution.targetRole,
      routingReason: resolution.routingReason,
      matchedAgentIds: resolution.matchedAgentIds,
      prBaseRef: payload.base?.ref ?? "",
      prHeadRef: payload.head?.ref ?? "",
      sourceMessageId: inbound.id,
      normalizedEvent,
      normalizedEventType: normalizedEvent.type,
      normalizedEventIdempotencyKey: normalizedEvent.idempotencyKey,
      ruleId: normalizedEvent.ruleId,
      bindingDecision: ruleDecision.bindingDecision,
      ruleDecision,
      projectionDecision,
      materialization,
    },
  };
}

async function handlePrReviewRequest(
  inbound: Message,
  ctx: IPolicyContext,
  subkind: PrReviewRequestLegacySubkind,
): Promise<MessageDispatch[]> {
  const payload = extractInboundPayload(inbound);
  if (!payload) {
    console.warn(
      `[repo-event-${subkind}-handler] inbound message ${inbound.id} payload extraction failed; skipping`,
    );
    return [];
  }
  const resolution = await resolveTarget(payload, ctx);
  return [await buildDispatch(inbound, subkind, payload, ctx, resolution)];
}

export const PR_REVIEW_REQUESTED_HANDLER: RepoEventHandler = {
  subkind: "pr-review-requested",
  name: "pr_review_requested_routed",
  handle: (inbound, ctx) => handlePrReviewRequest(inbound, ctx, "pr-review-requested"),
};

export const PR_REVIEW_REQUEST_REMOVED_HANDLER: RepoEventHandler = {
  subkind: "pr-review-request-removed",
  name: "pr_review_request_removed_routed",
  handle: (inbound, ctx) => handlePrReviewRequest(inbound, ctx, "pr-review-request-removed"),
};
