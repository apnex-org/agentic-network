import { createHash } from "node:crypto";
import type { WorkItemPhase } from "../entities/work-item.js";
import type { AgentRole } from "../state.js";

export const PR_REVIEW_REQUESTED_EVENT_TYPE =
  "github.pull_request.review_requested" as const;
export const PR_REVIEW_REQUEST_REMOVED_EVENT_TYPE =
  "github.pull_request.review_request_removed" as const;
export const PR_REVIEW_REQUEST_RULE_ID =
  "pr_review_request_to_workitem_v0" as const;
export const PR_EVIDENCE_REVIEW_REQUIRED_EVENT_TYPE =
  "workitem.complete_work.pr_evidence_review_required" as const;
export const PR_EVIDENCE_REVIEW_GATE_RULE_ID =
  "pr_evidence_admission_review_gate_v0" as const;

export type PrReviewRequestLegacySubkind =
  "pr-review-requested" | "pr-review-request-removed";

export type PrReviewRequestEventType =
  | typeof PR_REVIEW_REQUESTED_EVENT_TYPE
  | typeof PR_REVIEW_REQUEST_REMOVED_EVENT_TYPE;

export interface PrReviewRequestEventInput {
  legacySubkind: PrReviewRequestLegacySubkind;
  sourceMessageId: string;
  repo: string;
  prNumber: number;
  title?: string;
  url?: string;
  authorLogin?: string;
  requestedReviewerLogin?: string;
  requestedTeamSlug?: string;
  requestedTeamName?: string;
  baseRef?: string;
  baseSha?: string;
  headRef?: string;
  headSha?: string;
}

export interface NormalizedPrReviewRequestEvent {
  type: PrReviewRequestEventType;
  legacySubkind: PrReviewRequestLegacySubkind;
  ruleId: typeof PR_REVIEW_REQUEST_RULE_ID;
  sourceMessageId: string;
  idempotencyKey: string;
  payload: {
    repo: string;
    prNumber: number;
    title: string;
    url: string;
    authorLogin: string;
    requestedReviewerLogin: string;
    requestedTeamSlug: string;
    requestedTeamName: string;
    baseRef: string;
    baseSha: string;
    headRef: string;
    headSha: string;
  };
}

export interface PrWorkGraphBindingProof {
  /** Hub-authored binding id/projection id. Raw PR body markers are locators only. */
  id: string;
  repo: string;
  prNumber: number;
  targetWorkId: string;
  provenance: "hub" | "raw-body-marker" | "external";
  headSha?: string;
  baseSha?: string;
  version?: string;
  /** Optional deterministic changed-path source carried by the Hub-owned binding row. */
  changedPaths?: string[];
  /** Optional compact path classes derived from changedPaths by a declared review policy. */
  pathClasses?: string[];
  /** Provenance for changedPaths/pathClasses, e.g. PR-open event or audit fixture ref. */
  changedPathSource?: string;
  /** Deterministic last pusher GitHub login from a trusted Hub-owned binding/event source. */
  lastPusherLogin?: string;
  /** Deterministic PR author GitHub login from a trusted Hub-owned binding/event source. */
  authorLogin?: string;
}

export interface ReviewerResolutionProof {
  status: "unique" | "ambiguous" | "none" | "team";
  agentId?: string;
  role?: AgentRole;
  matchedAgentIds?: string[];
}

export interface BoundWorkProjection {
  id: string;
  status: WorkItemPhase;
}

export type PrReviewBindingDenialReason =
  | "binding_missing"
  | "binding_not_hub_authored"
  | "binding_repo_mismatch"
  | "binding_pr_mismatch"
  | "binding_target_mismatch"
  | "binding_head_mismatch"
  | "binding_base_mismatch"
  | "binding_ambiguous"
  | "target_missing"
  | "target_phase_unsafe"
  | "reviewer_not_unique"
  | "team_request_requires_resolver"
  | "removal_is_cancellation_only";

export type PrReviewBindingDecision =
  | {
      ok: true;
      ruleId: typeof PR_REVIEW_REQUEST_RULE_ID;
      bindingId: string;
      targetWorkId: string;
      reviewerAgentId: string;
      reviewerRole: AgentRole;
      projectionKey: string;
      changedPaths?: string[];
      pathClasses?: string[];
      changedPathSource?: string;
      lastPusherLogin?: string;
    }
  | {
      ok: false;
      ruleId: typeof PR_REVIEW_REQUEST_RULE_ID;
      reason: PrReviewBindingDenialReason;
      fallbackOnly: true;
    };

export type PrReviewGraphPhaseDecision =
  | {
      ok: true;
      targetPhase: "ready";
      graphAction: "project_review_obligation";
    }
  | {
      ok: false;
      reason: "target_missing" | "target_phase_unsafe";
      targetPhase?: WorkItemPhase;
      fallbackOnly: true;
      mutatesGraph: false;
    };

export type PrReviewRemovalPolicyDecision = {
  action:
    | "fallback_candidate_note"
    | "record_cancellation_metadata"
    | "historical_cancellation_note";
  reason:
    | "removal_without_existing_obligation"
    | "removal_records_metadata_only"
    | "removal_after_terminal_obligation";
  targetPhase?: WorkItemPhase;
  /** Removal is cancellation metadata only: it never means review approval. */
  completesReview: false;
  /** Removal must never ungate implementation work. */
  ungatesWork: false;
  /** v0 never terminal-mutates review WorkItems from removal alone. */
  terminalMutationAllowed: false;
};

const SAFE_START_GATE_PHASES: readonly WorkItemPhase[] = ["ready"];
const TERMINAL_PHASES: readonly WorkItemPhase[] = ["done", "abandoned"];

function nonEmpty(value: string | undefined): string {
  return value ?? "";
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function reviewerKey(input: PrReviewRequestEventInput): string {
  if (input.requestedReviewerLogin)
    return `user:${input.requestedReviewerLogin}`;
  if (input.requestedTeamSlug) return `team:${input.requestedTeamSlug}`;
  if (input.requestedTeamName) return `team-name:${input.requestedTeamName}`;
  return "target:missing";
}

export function eventTypeForLegacySubkind(
  subkind: PrReviewRequestLegacySubkind,
): PrReviewRequestEventType {
  return subkind === "pr-review-request-removed"
    ? PR_REVIEW_REQUEST_REMOVED_EVENT_TYPE
    : PR_REVIEW_REQUESTED_EVENT_TYPE;
}

export function buildPrReviewEventIdempotencyKey(
  input: PrReviewRequestEventInput,
): string {
  return sha256(
    [
      // bug-334: event-attempt identity must include the sovereign inbound
      // Message id.  A review request denied before materialization is not a
      // durable obligation, so a later GitHub request/replay must not collapse
      // onto that failed attempt merely because repo/PR/reviewer/head are
      // unchanged.  Output idempotency remains separately anchored by
      // buildPrReviewProjectionKey, which deliberately excludes this id.
      "pr-review-event-v1",
      input.sourceMessageId,
      input.legacySubkind,
      input.repo,
      input.prNumber,
      reviewerKey(input),
      nonEmpty(input.headSha),
    ].join("\u001f"),
  );
}

export function normalizePrReviewRequestEvent(
  input: PrReviewRequestEventInput,
): NormalizedPrReviewRequestEvent {
  return {
    type: eventTypeForLegacySubkind(input.legacySubkind),
    legacySubkind: input.legacySubkind,
    ruleId: PR_REVIEW_REQUEST_RULE_ID,
    sourceMessageId: input.sourceMessageId,
    idempotencyKey: buildPrReviewEventIdempotencyKey(input),
    payload: {
      repo: input.repo,
      prNumber: input.prNumber,
      title: nonEmpty(input.title),
      url: nonEmpty(input.url),
      authorLogin: nonEmpty(input.authorLogin),
      requestedReviewerLogin: nonEmpty(input.requestedReviewerLogin),
      requestedTeamSlug: nonEmpty(input.requestedTeamSlug),
      requestedTeamName: nonEmpty(input.requestedTeamName),
      baseRef: nonEmpty(input.baseRef),
      baseSha: nonEmpty(input.baseSha),
      headRef: nonEmpty(input.headRef),
      headSha: nonEmpty(input.headSha),
    },
  };
}

export function buildPrReviewProjectionKey(args: {
  event: NormalizedPrReviewRequestEvent;
  binding: PrWorkGraphBindingProof;
  reviewerAgentId: string;
}): string {
  return sha256(
    [
      "pr-review-workitem-v0",
      args.event.payload.repo,
      args.event.payload.prNumber,
      args.binding.id,
      args.binding.targetWorkId,
      args.reviewerAgentId,
      args.binding.version ?? "v0",
    ].join("\u001f"),
  );
}

export function evaluatePrReviewTargetPhase(
  target?: BoundWorkProjection | null,
): PrReviewGraphPhaseDecision {
  if (!target) {
    return {
      ok: false,
      reason: "target_missing",
      fallbackOnly: true,
      mutatesGraph: false,
    };
  }
  if (SAFE_START_GATE_PHASES.includes(target.status)) {
    return {
      ok: true,
      targetPhase: "ready",
      graphAction: "project_review_obligation",
    };
  }
  return {
    ok: false,
    reason: "target_phase_unsafe",
    targetPhase: target.status,
    fallbackOnly: true,
    mutatesGraph: false,
  };
}

export function evaluatePrReviewRemovalPolicy(args: {
  existingObligation?: BoundWorkProjection | null;
}): PrReviewRemovalPolicyDecision {
  const obligation = args.existingObligation;
  if (!obligation) {
    return {
      action: "fallback_candidate_note",
      reason: "removal_without_existing_obligation",
      completesReview: false,
      ungatesWork: false,
      terminalMutationAllowed: false,
    };
  }
  if (TERMINAL_PHASES.includes(obligation.status)) {
    return {
      action: "historical_cancellation_note",
      reason: "removal_after_terminal_obligation",
      targetPhase: obligation.status,
      completesReview: false,
      ungatesWork: false,
      terminalMutationAllowed: false,
    };
  }
  return {
    action: "record_cancellation_metadata",
    reason: "removal_records_metadata_only",
    targetPhase: obligation.status,
    completesReview: false,
    ungatesWork: false,
    terminalMutationAllowed: false,
  };
}

export function evaluatePrReviewBinding(args: {
  event: NormalizedPrReviewRequestEvent;
  binding?: PrWorkGraphBindingProof | null;
  bindingDenialReason?: Extract<PrReviewBindingDenialReason, "binding_ambiguous">;
  target?: BoundWorkProjection | null;
  reviewer: ReviewerResolutionProof;
}): PrReviewBindingDecision {
  const { event, binding, target, reviewer } = args;
  if (event.type === PR_REVIEW_REQUEST_REMOVED_EVENT_TYPE) {
    return {
      ok: false,
      ruleId: PR_REVIEW_REQUEST_RULE_ID,
      reason: "removal_is_cancellation_only",
      fallbackOnly: true,
    };
  }
  if (args.bindingDenialReason) {
    return {
      ok: false,
      ruleId: PR_REVIEW_REQUEST_RULE_ID,
      reason: args.bindingDenialReason,
      fallbackOnly: true,
    };
  }
  if (!binding) {
    return {
      ok: false,
      ruleId: PR_REVIEW_REQUEST_RULE_ID,
      reason: "binding_missing",
      fallbackOnly: true,
    };
  }
  if (binding.provenance !== "hub") {
    return {
      ok: false,
      ruleId: PR_REVIEW_REQUEST_RULE_ID,
      reason: "binding_not_hub_authored",
      fallbackOnly: true,
    };
  }
  if (binding.repo !== event.payload.repo) {
    return {
      ok: false,
      ruleId: PR_REVIEW_REQUEST_RULE_ID,
      reason: "binding_repo_mismatch",
      fallbackOnly: true,
    };
  }
  if (binding.prNumber !== event.payload.prNumber) {
    return {
      ok: false,
      ruleId: PR_REVIEW_REQUEST_RULE_ID,
      reason: "binding_pr_mismatch",
      fallbackOnly: true,
    };
  }
  const phaseDecision = evaluatePrReviewTargetPhase(target);
  if (!phaseDecision.ok) {
    return {
      ok: false,
      ruleId: PR_REVIEW_REQUEST_RULE_ID,
      reason: phaseDecision.reason,
      fallbackOnly: true,
    };
  }
  if (target!.id !== binding.targetWorkId) {
    return {
      ok: false,
      ruleId: PR_REVIEW_REQUEST_RULE_ID,
      reason: "binding_target_mismatch",
      fallbackOnly: true,
    };
  }
  if (
    binding.headSha &&
    event.payload.headSha &&
    binding.headSha !== event.payload.headSha
  ) {
    return {
      ok: false,
      ruleId: PR_REVIEW_REQUEST_RULE_ID,
      reason: "binding_head_mismatch",
      fallbackOnly: true,
    };
  }
  if (
    binding.baseSha &&
    event.payload.baseSha &&
    binding.baseSha !== event.payload.baseSha
  ) {
    return {
      ok: false,
      ruleId: PR_REVIEW_REQUEST_RULE_ID,
      reason: "binding_base_mismatch",
      fallbackOnly: true,
    };
  }
  if (
    event.payload.requestedTeamSlug ||
    event.payload.requestedTeamName ||
    reviewer.status === "team"
  ) {
    return {
      ok: false,
      ruleId: PR_REVIEW_REQUEST_RULE_ID,
      reason: "team_request_requires_resolver",
      fallbackOnly: true,
    };
  }
  if (reviewer.status !== "unique" || !reviewer.agentId || !reviewer.role) {
    return {
      ok: false,
      ruleId: PR_REVIEW_REQUEST_RULE_ID,
      reason: "reviewer_not_unique",
      fallbackOnly: true,
    };
  }
  return {
    ok: true,
    ruleId: PR_REVIEW_REQUEST_RULE_ID,
    bindingId: binding.id,
    targetWorkId: binding.targetWorkId,
    reviewerAgentId: reviewer.agentId,
    reviewerRole: reviewer.role,
    projectionKey: buildPrReviewProjectionKey({
      event,
      binding,
      reviewerAgentId: reviewer.agentId,
    }),
    changedPaths: binding.changedPaths,
    pathClasses: binding.pathClasses,
    changedPathSource: binding.changedPathSource,
    lastPusherLogin: binding.lastPusherLogin,
  };
}
