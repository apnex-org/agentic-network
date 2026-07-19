import { describe, expect, it } from "vitest";
import {
  prEvidenceAdmittedProjection,
  prEvidenceDeniedProjection,
  prParentRetryRequiredProjection,
  prReviewRequiredProjection,
} from "../../src/policy/pr-evidence-actionability.js";

const locator = {
  repo: "apnex-org/agentic-network",
  prNumber: 621,
  source: "repo_pr_number" as const,
  raw: "apnex-org/agentic-network#621",
};

describe("PR evidence actionability projection", () => {
  it("renders denial classifier first with stable required action fields", () => {
    expect(prEvidenceDeniedProjection({
      workId: "work-parent",
      reason: "binding_missing",
      locator,
      candidateBindingIds: [],
    })).toEqual({
      classifier: "PR_EVIDENCE_DENIED",
      admissionStatus: "denied",
      workId: "work-parent",
      reason: "binding_missing",
      locator,
      candidateBindingIds: [],
      requiredAction: "fix_pr_evidence_or_binding",
    });
  });

  it("renders admitted classifier after review gate is done and retry succeeds", () => {
    expect(prEvidenceAdmittedProjection({
      workId: "work-parent",
      locator,
      bindingId: "prbind-621",
      reviewWorkId: "work-prrev-621",
    })).toEqual({
      classifier: "PR_EVIDENCE_ADMITTED",
      admissionStatus: "admitted",
      workId: "work-parent",
      locator,
      bindingId: "prbind-621",
      reviewWorkId: "work-prrev-621",
      requiredAction: "none",
    });
  });

  it("renders review-required classifier with binding and optional review work id", () => {
    expect(prReviewRequiredProjection({
      workId: "work-parent",
      locator,
      bindingId: "prbind-621",
      reviewWorkId: "work-prrev-621",
    })).toEqual({
      classifier: "PR_REVIEW_REQUIRED",
      admissionStatus: "review_required",
      workId: "work-parent",
      locator,
      bindingId: "prbind-621",
      reviewWorkId: "work-prrev-621",
      requiredAction: "project_or_complete_pr_review_obligation",
    });
  });

  it("renders parent retry required for the manual-retry v0 boundary", () => {
    expect(prParentRetryRequiredProjection({
      workId: "work-parent",
      locator,
      bindingId: "prbind-621",
      reviewWorkId: "work-prrev-621",
    })).toMatchObject({
      classifier: "PARENT_RETRY_REQUIRED",
      admissionStatus: "parent_retry_required",
      workId: "work-parent",
      requiredAction: "retry_parent_completion_after_review",
    });
  });
});
