import type { PrEvidenceLocator } from "./pr-evidence-admission-contract.js";

export type PrEvidenceActionabilityClassifier =
  | "PR_EVIDENCE_DENIED"
  | "PR_EVIDENCE_ADMITTED"
  | "PR_REVIEW_REQUIRED"
  | "PARENT_RETRY_REQUIRED"
  | "MANUAL_CHECK_REQUIRED";

export type PrEvidenceAdmissionStatus =
  | "denied"
  | "admitted"
  | "review_required"
  | "parent_retry_required"
  | "manual_check_required";

export type PrEvidenceRequiredAction =
  | "none"
  | "fix_pr_evidence_or_binding"
  | "project_or_complete_pr_review_obligation"
  | "retry_parent_completion_after_review"
  | "manual_check_pr_evidence_admission";

export interface PrEvidenceActionabilityProjection {
  /** Stable classifier-first field for bounded idea-578 PR evidence states. */
  classifier: PrEvidenceActionabilityClassifier;
  admissionStatus: PrEvidenceAdmissionStatus;
  workId: string;
  locator?: PrEvidenceLocator;
  reason?: string;
  bindingId?: string;
  candidateBindingIds?: string[];
  reviewWorkId?: string;
  requiredAction: PrEvidenceRequiredAction;
}

export function prEvidenceDeniedProjection(args: {
  workId: string;
  reason: string;
  locator?: PrEvidenceLocator;
  candidateBindingIds?: string[];
}): PrEvidenceActionabilityProjection {
  return {
    classifier: "PR_EVIDENCE_DENIED",
    admissionStatus: "denied",
    workId: args.workId,
    reason: args.reason,
    ...(args.locator ? { locator: args.locator } : {}),
    ...(args.candidateBindingIds ? { candidateBindingIds: args.candidateBindingIds } : {}),
    requiredAction: "fix_pr_evidence_or_binding",
  };
}

export function prEvidenceAdmittedProjection(args: {
  workId: string;
  locator: PrEvidenceLocator;
  bindingId: string;
  reviewWorkId?: string;
}): PrEvidenceActionabilityProjection {
  return {
    classifier: "PR_EVIDENCE_ADMITTED",
    admissionStatus: "admitted",
    workId: args.workId,
    locator: args.locator,
    bindingId: args.bindingId,
    ...(args.reviewWorkId ? { reviewWorkId: args.reviewWorkId } : {}),
    requiredAction: "none",
  };
}

export function prReviewRequiredProjection(args: {
  workId: string;
  locator: PrEvidenceLocator;
  bindingId: string;
  reviewWorkId?: string;
}): PrEvidenceActionabilityProjection {
  return {
    classifier: "PR_REVIEW_REQUIRED",
    admissionStatus: "review_required",
    workId: args.workId,
    locator: args.locator,
    bindingId: args.bindingId,
    ...(args.reviewWorkId ? { reviewWorkId: args.reviewWorkId } : {}),
    requiredAction: "project_or_complete_pr_review_obligation",
  };
}

export function prManualCheckRequiredProjection(args: {
  workId: string;
  reason: string;
  locator?: PrEvidenceLocator;
  bindingId?: string;
  reviewWorkId?: string;
}): PrEvidenceActionabilityProjection {
  return {
    classifier: "MANUAL_CHECK_REQUIRED",
    admissionStatus: "manual_check_required",
    workId: args.workId,
    reason: args.reason,
    ...(args.locator ? { locator: args.locator } : {}),
    ...(args.bindingId ? { bindingId: args.bindingId } : {}),
    ...(args.reviewWorkId ? { reviewWorkId: args.reviewWorkId } : {}),
    requiredAction: "manual_check_pr_evidence_admission",
  };
}

export function prParentRetryRequiredProjection(args: {
  workId: string;
  locator?: PrEvidenceLocator;
  bindingId?: string;
  reviewWorkId?: string;
}): PrEvidenceActionabilityProjection {
  return {
    classifier: "PARENT_RETRY_REQUIRED",
    admissionStatus: "parent_retry_required",
    workId: args.workId,
    ...(args.locator ? { locator: args.locator } : {}),
    ...(args.bindingId ? { bindingId: args.bindingId } : {}),
    ...(args.reviewWorkId ? { reviewWorkId: args.reviewWorkId } : {}),
    requiredAction: "retry_parent_completion_after_review",
  };
}
