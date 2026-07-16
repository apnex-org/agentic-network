import { describe, expect, it } from "vitest";
import { normalizePrReviewRequestEvent } from "../../src/policy/pr-review-workitem-event-contract.js";
import { evaluatePrReviewRequestRule } from "../../src/policy/pr-review-request-static-rule.js";
import { projectPrReviewWorkItem } from "../../src/policy/pr-review-workitem-projection.js";

function allowedRuleResult() {
  const event = normalizePrReviewRequestEvent({
    legacySubkind: "pr-review-requested",
    sourceMessageId: "01SOURCE",
    repo: "apnex-org/agentic-network",
    prNumber: 625,
    url: "https://github.com/apnex-org/agentic-network/pull/625",
    requestedReviewerLogin: "apnex-lily",
    headSha: "head-sha",
  });
  return evaluatePrReviewRequestRule({
    event,
    binding: {
      id: "prbind-625",
      repo: "apnex-org/agentic-network",
      prNumber: 625,
      targetWorkId: "work-123",
      provenance: "hub",
      headSha: "head-sha",
      version: "1",
    },
    target: { id: "work-123", status: "ready" },
    reviewer: { status: "unique", agentId: "agent-lily", role: "architect" },
  });
}

describe("PR review WorkItem projection", () => {
  it("turns an allowed rule decision into a review WorkItem create spec", () => {
    const projection = projectPrReviewWorkItem({ ruleResult: allowedRuleResult() });

    expect(projection.action).toBe("create_review_workitem");
    if (projection.action !== "create_review_workitem") throw new Error("expected create");
    expect(projection.projectionKey).toMatch(/^[a-f0-9]{64}$/);
    expect(projection.createSpec).toMatchObject({
      type: "review",
      priority: "normal",
      roleEligibility: ["architect"],
      targetRef: { kind: "pull_request", id: "apnex-org/agentic-network#625" },
      payload: {
        obligationKind: "github_pr_review_request",
        ruleId: "pr_review_request_to_workitem_v0",
        eventType: "github.pull_request.review_requested",
        sourceMessageId: "01SOURCE",
        bindingId: "prbind-625",
        boundTargetWorkId: "work-123",
        reviewerAgentId: "agent-lily",
      },
      evidenceRequirements: [
        {
          id: "github_review",
          kind: "freeform",
          description: "GitHub review URL/id or equivalent explicit reviewer evidence for the bound PR.",
        },
      ],
    });
    expect(projection.createSpec.payload.projectionKey).toBe(projection.projectionKey);
  });

  it("reuses an existing projection for duplicate delivery instead of duplicating WorkItems", () => {
    const first = projectPrReviewWorkItem({ ruleResult: allowedRuleResult() });
    if (first.action !== "create_review_workitem") throw new Error("expected create");

    const second = projectPrReviewWorkItem({
      ruleResult: allowedRuleResult(),
      existingProjection: {
        projectionKey: first.projectionKey,
        workId: "work-review-625-lily",
        status: "ready",
      },
    });

    expect(second).toEqual({
      action: "reuse_existing_review_workitem",
      projectionKey: first.projectionKey,
      existingWorkId: "work-review-625-lily",
      existingStatus: "ready",
    });
  });

  it("keeps denied rule decisions fallback-only", () => {
    const denied = evaluatePrReviewRequestRule({
      event: normalizePrReviewRequestEvent({
        legacySubkind: "pr-review-requested",
        sourceMessageId: "01SOURCE",
        repo: "apnex-org/agentic-network",
        prNumber: 625,
        requestedReviewerLogin: "apnex-lily",
      }),
      binding: null,
      target: null,
      reviewer: { status: "unique", agentId: "agent-lily", role: "architect" },
    });

    expect(projectPrReviewWorkItem({ ruleResult: denied })).toEqual({
      action: "fallback_only",
      projectionKey: null,
      reason: "binding_missing",
    });
  });
});
