import { describe, expect, it } from "vitest";
import { normalizePrReviewRequestEvent } from "../../src/policy/pr-review-workitem-event-contract.js";
import { evaluatePrReviewRequestRule } from "../../src/policy/pr-review-request-static-rule.js";

function event(overrides: Partial<Parameters<typeof normalizePrReviewRequestEvent>[0]> = {}) {
  return normalizePrReviewRequestEvent({
    legacySubkind: "pr-review-requested",
    sourceMessageId: "01SOURCE",
    repo: "apnex-org/agentic-network",
    prNumber: 625,
    title: "Route PR review request repo events",
    url: "https://github.com/apnex-org/agentic-network/pull/625",
    authorLogin: "apnex-greg",
    requestedReviewerLogin: "apnex-lily",
    baseRef: "main",
    baseSha: "base-sha",
    headRef: "feature",
    headSha: "head-sha",
    ...overrides,
  });
}

const binding = {
  id: "prbind-625",
  repo: "apnex-org/agentic-network",
  prNumber: 625,
  targetWorkId: "work-123",
  provenance: "hub" as const,
  headSha: "head-sha",
  version: "1",
};
const target = { id: "work-123", status: "ready" as const };
const reviewer = { status: "unique" as const, agentId: "agent-lily", role: "architect" as const };

describe("pr_review_request_to_workitem_v0 static rule", () => {
  it("returns a materialization draft only after binding, graph, and reviewer guards pass", () => {
    const result = evaluatePrReviewRequestRule({ event: event(), binding, target, reviewer });

    expect(result.action).toBe("materialize_review_obligation");
    expect(result.bindingDecision).toMatchObject({ ok: true, bindingId: "prbind-625" });
    expect(result.obligationDraft).toMatchObject({
      type: "review",
      roleEligibility: ["architect"],
      targetRef: { kind: "pull_request", id: "apnex-org/agentic-network#625" },
      payload: {
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
          kind: "review",
          description: "GitHub review URL/id or equivalent explicit reviewer evidence for the bound PR.",
        },
      ],
    });
  });

  it("falls back without WorkGraph mutation for unbound and raw-marker-only cases", () => {
    const unbound = evaluatePrReviewRequestRule({ event: event(), binding: null, target: null, reviewer });
    const rawMarker = evaluatePrReviewRequestRule({
      event: event(),
      binding: { ...binding, provenance: "raw-body-marker" },
      target,
      reviewer,
    });

    expect(unbound).toMatchObject({ action: "fallback_candidate_note", fallback: { reason: "binding_missing" } });
    expect(unbound.obligationDraft).toBeUndefined();
    expect(rawMarker).toMatchObject({
      action: "fallback_candidate_note",
      fallback: { reason: "binding_not_hub_authored" },
    });
    expect(rawMarker.obligationDraft).toBeUndefined();
  });

  it("falls back for stale binding and unsafe target phase", () => {
    expect(
      evaluatePrReviewRequestRule({
        event: event(),
        binding: { ...binding, headSha: "old-head" },
        target,
        reviewer,
      }),
    ).toMatchObject({ action: "fallback_candidate_note", fallback: { reason: "binding_head_mismatch" } });
    expect(
      evaluatePrReviewRequestRule({
        event: event(),
        binding,
        target: { id: "work-123", status: "claimed" },
        reviewer,
      }),
    ).toMatchObject({ action: "fallback_candidate_note", fallback: { reason: "target_phase_unsafe" } });
  });

  it("falls back for unknown, ambiguous, and team reviewer resolution", () => {
    expect(
      evaluatePrReviewRequestRule({
        event: event(),
        binding,
        target,
        reviewer: { status: "none" },
      }),
    ).toMatchObject({ action: "fallback_candidate_note", fallback: { reason: "reviewer_not_unique" } });
    expect(
      evaluatePrReviewRequestRule({
        event: event(),
        binding,
        target,
        reviewer: { status: "ambiguous", matchedAgentIds: ["a", "b"] },
      }),
    ).toMatchObject({ action: "fallback_candidate_note", fallback: { reason: "reviewer_not_unique" } });
    expect(
      evaluatePrReviewRequestRule({
        event: event({ requestedReviewerLogin: undefined, requestedTeamSlug: "engineer" }),
        binding: { ...binding, headSha: undefined },
        target,
        reviewer: { status: "team" },
      }),
    ).toMatchObject({ action: "fallback_candidate_note", fallback: { reason: "team_request_requires_resolver" } });
  });

  it("treats removal events as fallback-only cancellation metadata", () => {
    const result = evaluatePrReviewRequestRule({
      event: event({ legacySubkind: "pr-review-request-removed" }),
      binding,
      target,
      reviewer,
    });

    expect(result).toMatchObject({
      action: "fallback_candidate_note",
      eventType: "github.pull_request.review_request_removed",
      fallback: { reason: "removal_is_cancellation_only" },
    });
    expect(result.obligationDraft).toBeUndefined();
  });
});
