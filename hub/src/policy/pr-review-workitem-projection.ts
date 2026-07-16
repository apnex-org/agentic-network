import type { PrReviewObligationDraft, PrReviewRequestRuleResult } from "./pr-review-request-static-rule.js";

export type PrReviewProjectionAction =
  | "create_review_workitem"
  | "reuse_existing_review_workitem"
  | "fallback_only";

export interface ExistingPrReviewProjection {
  projectionKey: string;
  workId: string;
  status: string;
}

export interface PrReviewWorkItemCreateSpec {
  projectionKey: string;
  type: "review";
  priority: "normal";
  roleEligibility: string[];
  targetRef: { kind: "pull_request"; id: string };
  payload: PrReviewObligationDraft["payload"] & {
    projectionKey: string;
    obligationKind: "github_pr_review_request";
  };
  runbook: string;
  evidenceRequirements: PrReviewObligationDraft["evidenceRequirements"];
}

export type PrReviewProjectionResult =
  | {
      action: "create_review_workitem";
      projectionKey: string;
      createSpec: PrReviewWorkItemCreateSpec;
    }
  | {
      action: "reuse_existing_review_workitem";
      projectionKey: string;
      existingWorkId: string;
      existingStatus: string;
    }
  | {
      action: "fallback_only";
      projectionKey: string | null;
      reason: string;
    };

export function toReviewWorkItemCreateSpec(args: {
  projectionKey: string;
  draft: PrReviewObligationDraft;
}): PrReviewWorkItemCreateSpec {
  return {
    projectionKey: args.projectionKey,
    type: args.draft.type,
    priority: args.draft.priority,
    roleEligibility: args.draft.roleEligibility,
    targetRef: args.draft.targetRef,
    payload: {
      ...args.draft.payload,
      projectionKey: args.projectionKey,
      obligationKind: "github_pr_review_request",
    },
    runbook: args.draft.runbook,
    evidenceRequirements: args.draft.evidenceRequirements,
  };
}

export function projectPrReviewWorkItem(args: {
  ruleResult: PrReviewRequestRuleResult;
  existingProjection?: ExistingPrReviewProjection | null;
}): PrReviewProjectionResult {
  if (args.ruleResult.action !== "materialize_review_obligation" || !args.ruleResult.obligationDraft) {
    return {
      action: "fallback_only",
      projectionKey: args.ruleResult.bindingDecision.ok ? args.ruleResult.bindingDecision.projectionKey : null,
      reason: args.ruleResult.fallback.reason,
    };
  }

  const projectionKey = args.ruleResult.bindingDecision.ok
    ? args.ruleResult.bindingDecision.projectionKey
    : null;
  if (!projectionKey) {
    return { action: "fallback_only", projectionKey: null, reason: "missing_projection_key" };
  }

  if (args.existingProjection?.projectionKey === projectionKey) {
    return {
      action: "reuse_existing_review_workitem",
      projectionKey,
      existingWorkId: args.existingProjection.workId,
      existingStatus: args.existingProjection.status,
    };
  }

  return {
    action: "create_review_workitem",
    projectionKey,
    createSpec: toReviewWorkItemCreateSpec({ projectionKey, draft: args.ruleResult.obligationDraft }),
  };
}
