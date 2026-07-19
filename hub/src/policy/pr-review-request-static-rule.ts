import {
  PR_REVIEW_REQUEST_REMOVED_EVENT_TYPE,
  PR_REVIEW_REQUEST_RULE_ID,
  PR_REVIEW_REQUESTED_EVENT_TYPE,
  PR_EVIDENCE_REVIEW_GATE_RULE_ID,
  PR_EVIDENCE_REVIEW_REQUIRED_EVENT_TYPE,
  evaluatePrReviewBinding,
  evaluatePrReviewRemovalPolicy,
  evaluatePrReviewTargetPhase,
  type BoundWorkProjection,
  type NormalizedPrReviewRequestEvent,
  type PrReviewBindingDecision,
  type PrReviewGraphPhaseDecision,
  type PrReviewRemovalPolicyDecision,
  type PrWorkGraphBindingProof,
  type ReviewerResolutionProof,
} from "./pr-review-workitem-event-contract.js";
import type { ReviewerEligibilityProjectionSummary } from "./pr-reviewer-eligibility.js";

export type PrReviewRequestRuleAction =
  "materialize_review_obligation" | "fallback_candidate_note";

export interface PrReviewObligationDraft {
  type: "review";
  priority: "normal";
  roleEligibility: string[];
  targetRef: { kind: "pull_request"; id: string };
  payload: {
    ruleId: typeof PR_REVIEW_REQUEST_RULE_ID | typeof PR_EVIDENCE_REVIEW_GATE_RULE_ID;
    eventType: typeof PR_REVIEW_REQUESTED_EVENT_TYPE | typeof PR_EVIDENCE_REVIEW_REQUIRED_EVENT_TYPE;
    eventIdempotencyKey: string;
    sourceMessageId: string;
    bindingId: string;
    boundTargetWorkId: string;
    repo: string;
    prNumber: number;
    prUrl: string;
    requestedReviewerLogin: string;
    selectedReviewerLogin: string;
    reviewerAgentId: string;
    projectionKey: string;
    eligibility?: ReviewerEligibilityProjectionSummary;
    changedPathSource?: {
      changedPaths?: string[];
      pathClasses?: string[];
      provenance?: string;
    };
    completionPolicy: {
      requiredReviewerLogin: string;
      requiredHeadSha: string;
      forbiddenReviewerLogins: string[];
      lastPusherLogin?: string;
      verifierAuthorityRequired: boolean;
    };
  };
  runbook: string;
  evidenceRequirements: Array<
    | {
        id: "github_review_artifact";
        kind: "freeform";
        description: string;
      }
    | {
        id: "independent_pr_review_validation";
        kind: "review";
        description: string;
        evidenceAuthority: "verifier-attestation";
      }
  >;
}

export interface PrReviewRequestRuleResult {
  ruleId: typeof PR_REVIEW_REQUEST_RULE_ID;
  eventType: NormalizedPrReviewRequestEvent["type"];
  eventIdempotencyKey: string;
  action: PrReviewRequestRuleAction;
  bindingDecision: PrReviewBindingDecision;
  phaseDecision: PrReviewGraphPhaseDecision;
  removalDecision?: PrReviewRemovalPolicyDecision;
  eligibility?: ReviewerEligibilityProjectionSummary;
  obligationDraft?: PrReviewObligationDraft;
  fallback: {
    reason: string;
    sourceMessageId: string;
    rawDrilldownRequired: true;
  };
}

function prLocator(event: NormalizedPrReviewRequestEvent): string {
  return `${event.payload.repo}#${event.payload.prNumber}`;
}

function buildObligationDraft(
  event: NormalizedPrReviewRequestEvent,
  decision: Extract<PrReviewBindingDecision, { ok: true }>,
  eligibility?: ReviewerEligibilityProjectionSummary,
): PrReviewObligationDraft {
  const selectedReviewer = eligibility?.selectedReviewers[0];
  const reviewerAgentId = selectedReviewer?.agentId ?? decision.reviewerAgentId;
  const reviewerRole = selectedReviewer?.role ?? decision.reviewerRole;
  const selectedReviewerLogin = selectedReviewer?.githubLogin ?? event.payload.requestedReviewerLogin;
  return {
    type: "review",
    priority: "normal",
    roleEligibility: [reviewerRole],
    targetRef: { kind: "pull_request", id: prLocator(event) },
    payload: {
      ruleId: PR_REVIEW_REQUEST_RULE_ID,
      eventType: PR_REVIEW_REQUESTED_EVENT_TYPE,
      eventIdempotencyKey: event.idempotencyKey,
      sourceMessageId: event.sourceMessageId,
      bindingId: decision.bindingId,
      boundTargetWorkId: decision.targetWorkId,
      repo: event.payload.repo,
      prNumber: event.payload.prNumber,
      prUrl: event.payload.url,
      requestedReviewerLogin: event.payload.requestedReviewerLogin,
      selectedReviewerLogin,
      reviewerAgentId,
      projectionKey: decision.projectionKey,
      eligibility,
      changedPathSource: decision.changedPaths || decision.pathClasses || decision.changedPathSource
        ? {
            changedPaths: decision.changedPaths,
            pathClasses: decision.pathClasses,
            provenance: decision.changedPathSource,
          }
        : undefined,
      completionPolicy: {
        requiredReviewerLogin: selectedReviewerLogin,
        requiredHeadSha: event.payload.headSha,
        forbiddenReviewerLogins: [...new Set([event.payload.authorLogin, decision.lastPusherLogin].filter((login): login is string => Boolean(login)))],
        lastPusherLogin: decision.lastPusherLogin,
        verifierAuthorityRequired: true,
      },
    },
    runbook:
      "Review the bound PR. Complete with explicit GitHub review evidence. Do not merge or enqueue unless separately authorized.",
    evidenceRequirements: [
      {
        id: "github_review_artifact",
        kind: "freeform",
        description:
          "Executor-submitted GitHub PR review artifact URL/id for the requested reviewer and bound head. This artifact is load-bearing input for verifier attestation but does not complete the review obligation alone.",
      },
      {
        id: "independent_pr_review_validation",
        kind: "review",
        evidenceAuthority: "verifier-attestation",
        description:
          "Verifier attestation that the submitted GitHub review artifact matches the requested reviewer, bound PR head, and independence policy. External-only refs are not load-bearing; cite the submitted evidence ref.",
      },
    ],
  };
}

export function evaluatePrReviewRequestRule(args: {
  event: NormalizedPrReviewRequestEvent;
  binding?: PrWorkGraphBindingProof | null;
  bindingDenialReason?: "binding_ambiguous";
  target?: BoundWorkProjection | null;
  reviewer: ReviewerResolutionProof;
  existingObligation?: BoundWorkProjection | null;
  eligibility?: ReviewerEligibilityProjectionSummary;
}): PrReviewRequestRuleResult {
  const phaseDecision = evaluatePrReviewTargetPhase(args.target);
  const removalDecision =
    args.event.type === PR_REVIEW_REQUEST_REMOVED_EVENT_TYPE
      ? evaluatePrReviewRemovalPolicy({
          existingObligation: args.existingObligation,
        })
      : undefined;
  const bindingDecision = evaluatePrReviewBinding(args);
  if (!bindingDecision.ok) {
    return {
      ruleId: PR_REVIEW_REQUEST_RULE_ID,
      eventType: args.event.type,
      eventIdempotencyKey: args.event.idempotencyKey,
      action: "fallback_candidate_note",
      bindingDecision,
      phaseDecision,
      removalDecision,
      eligibility: args.eligibility,
      fallback: {
        reason: bindingDecision.reason,
        sourceMessageId: args.event.sourceMessageId,
        rawDrilldownRequired: true,
      },
    };
  }

  const allowedEligibilityStatuses = new Set(["eligible", "insufficient_but_alternative_selected"]);
  if (args.eligibility && (!args.eligibility.ok || !allowedEligibilityStatuses.has(args.eligibility.requestedReviewerStatus) || args.eligibility.selectedReviewers.length === 0)) {
    return {
      ruleId: PR_REVIEW_REQUEST_RULE_ID,
      eventType: args.event.type,
      eventIdempotencyKey: args.event.idempotencyKey,
      action: "fallback_candidate_note",
      bindingDecision,
      phaseDecision,
      removalDecision,
      eligibility: args.eligibility,
      fallback: {
        reason: `reviewer_eligibility_${args.eligibility.reason ?? args.eligibility.requestedReviewerStatus}`,
        sourceMessageId: args.event.sourceMessageId,
        rawDrilldownRequired: true,
      },
    };
  }

  return {
    ruleId: PR_REVIEW_REQUEST_RULE_ID,
    eventType: args.event.type,
    eventIdempotencyKey: args.event.idempotencyKey,
    action: "materialize_review_obligation",
    bindingDecision,
    phaseDecision,
    removalDecision,
    eligibility: args.eligibility,
    obligationDraft: buildObligationDraft(args.event, bindingDecision, args.eligibility),
    fallback: {
      reason: "not_applicable",
      sourceMessageId: args.event.sourceMessageId,
      rawDrilldownRequired: true,
    },
  };
}
