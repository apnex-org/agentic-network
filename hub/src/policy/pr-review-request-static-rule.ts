import {
  PR_REVIEW_REQUEST_REMOVED_EVENT_TYPE,
  PR_REVIEW_REQUEST_RULE_ID,
  PR_REVIEW_REQUESTED_EVENT_TYPE,
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

export type PrReviewRequestRuleAction =
  "materialize_review_obligation" | "fallback_candidate_note";

export interface PrReviewObligationDraft {
  type: "review";
  priority: "normal";
  roleEligibility: string[];
  targetRef: { kind: "pull_request"; id: string };
  payload: {
    ruleId: typeof PR_REVIEW_REQUEST_RULE_ID;
    eventType: typeof PR_REVIEW_REQUESTED_EVENT_TYPE;
    eventIdempotencyKey: string;
    sourceMessageId: string;
    bindingId: string;
    boundTargetWorkId: string;
    repo: string;
    prNumber: number;
    prUrl: string;
    requestedReviewerLogin: string;
    reviewerAgentId: string;
    projectionKey: string;
    completionPolicy: {
      requiredReviewerLogin: string;
      requiredHeadSha: string;
      forbiddenReviewerLogins: string[];
      verifierAuthorityRequired: boolean;
    };
  };
  runbook: string;
  evidenceRequirements: Array<{
    id: "independent_pr_review_validation";
    kind: "review";
    description: string;
    evidenceAuthority: "verifier-attestation";
  }>;
}

export interface PrReviewRequestRuleResult {
  ruleId: typeof PR_REVIEW_REQUEST_RULE_ID;
  eventType: NormalizedPrReviewRequestEvent["type"];
  eventIdempotencyKey: string;
  action: PrReviewRequestRuleAction;
  bindingDecision: PrReviewBindingDecision;
  phaseDecision: PrReviewGraphPhaseDecision;
  removalDecision?: PrReviewRemovalPolicyDecision;
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
): PrReviewObligationDraft {
  return {
    type: "review",
    priority: "normal",
    roleEligibility: [decision.reviewerRole],
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
      reviewerAgentId: decision.reviewerAgentId,
      projectionKey: decision.projectionKey,
      completionPolicy: {
        requiredReviewerLogin: event.payload.requestedReviewerLogin,
        requiredHeadSha: event.payload.headSha,
        forbiddenReviewerLogins: [event.payload.authorLogin].filter(Boolean),
        verifierAuthorityRequired: true,
      },
    },
    runbook:
      "Review the bound PR. Complete with explicit GitHub review evidence. Do not merge or enqueue unless separately authorized.",
    evidenceRequirements: [
      {
        id: "independent_pr_review_validation",
        kind: "review",
        evidenceAuthority: "verifier-attestation",
        description:
          "Verifier attestation that GitHub review evidence matches the requested reviewer, bound PR head, and independence policy. Arbitrary executor freeform evidence cannot satisfy this gate.",
      },
    ],
  };
}

export function evaluatePrReviewRequestRule(args: {
  event: NormalizedPrReviewRequestEvent;
  binding?: PrWorkGraphBindingProof | null;
  target?: BoundWorkProjection | null;
  reviewer: ReviewerResolutionProof;
  existingObligation?: BoundWorkProjection | null;
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
      fallback: {
        reason: bindingDecision.reason,
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
    obligationDraft: buildObligationDraft(args.event, bindingDecision),
    fallback: {
      reason: "not_applicable",
      sourceMessageId: args.event.sourceMessageId,
      rawDrilldownRequired: true,
    },
  };
}
