import { describe, expect, it } from "vitest";
import {
  PR_REVIEW_REQUESTED_EVENT_TYPE,
  PR_REVIEW_REQUEST_REMOVED_EVENT_TYPE,
  PR_REVIEW_REQUEST_RULE_ID,
  evaluatePrReviewBinding,
  normalizePrReviewRequestEvent,
} from "../../src/policy/pr-review-workitem-event-contract.js";

function reviewRequestedEvent() {
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
  });
}

describe("PR review WorkItem event contract", () => {
  it("maps legacy review-request subkinds to upstream-aligned rule event names", () => {
    const requested = reviewRequestedEvent();
    const removed = normalizePrReviewRequestEvent({
      legacySubkind: "pr-review-request-removed",
      sourceMessageId: "01SOURCE",
      repo: "apnex-org/agentic-network",
      prNumber: 625,
      requestedReviewerLogin: "apnex-lily",
    });

    expect(requested.type).toBe(PR_REVIEW_REQUESTED_EVENT_TYPE);
    expect(removed.type).toBe(PR_REVIEW_REQUEST_REMOVED_EVENT_TYPE);
    expect(requested.ruleId).toBe(PR_REVIEW_REQUEST_RULE_ID);
    expect(requested.sourceMessageId).toBe("01SOURCE");
    expect(requested.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    expect(requested.payload.headSha).toBe("head-sha");
  });

  it("denies raw body marker bindings as locators only", () => {
    const decision = evaluatePrReviewBinding({
      event: reviewRequestedEvent(),
      binding: {
        id: "raw-work-123",
        repo: "apnex-org/agentic-network",
        prNumber: 625,
        targetWorkId: "work-123",
        provenance: "raw-body-marker",
      },
      target: { id: "work-123", status: "ready" },
      reviewer: { status: "unique", agentId: "agent-lily", role: "architect" },
    });

    expect(decision).toEqual({
      ok: false,
      ruleId: PR_REVIEW_REQUEST_RULE_ID,
      reason: "binding_not_hub_authored",
      fallbackOnly: true,
    });
  });

  it("denies unbound, stale, unsafe, team, ambiguous, and removal cases fail-closed", () => {
    const event = reviewRequestedEvent();
    const hubBinding = {
      id: "prbind-625",
      repo: "apnex-org/agentic-network",
      prNumber: 625,
      targetWorkId: "work-123",
      provenance: "hub" as const,
      headSha: "head-sha",
    };
    const uniqueReviewer = { status: "unique" as const, agentId: "agent-lily", role: "architect" as const };

    expect(evaluatePrReviewBinding({ event, binding: null, target: null, reviewer: uniqueReviewer })).toMatchObject({
      ok: false,
      reason: "binding_missing",
    });
    expect(
      evaluatePrReviewBinding({
        event,
        binding: { ...hubBinding, headSha: "old-head" },
        target: { id: "work-123", status: "ready" },
        reviewer: uniqueReviewer,
      }),
    ).toMatchObject({ ok: false, reason: "binding_head_mismatch" });
    expect(
      evaluatePrReviewBinding({
        event,
        binding: hubBinding,
        target: { id: "work-123", status: "in_progress" },
        reviewer: uniqueReviewer,
      }),
    ).toMatchObject({ ok: false, reason: "target_phase_unsafe" });
    expect(
      evaluatePrReviewBinding({
        event: normalizePrReviewRequestEvent({
          legacySubkind: "pr-review-requested",
          sourceMessageId: "01SOURCE",
          repo: "apnex-org/agentic-network",
          prNumber: 625,
          requestedTeamSlug: "engineer",
        }),
        binding: { ...hubBinding, headSha: undefined },
        target: { id: "work-123", status: "ready" },
        reviewer: { status: "team" },
      }),
    ).toMatchObject({ ok: false, reason: "team_request_requires_resolver" });
    expect(
      evaluatePrReviewBinding({
        event,
        binding: hubBinding,
        target: { id: "work-123", status: "ready" },
        reviewer: { status: "ambiguous", matchedAgentIds: ["a", "b"] },
      }),
    ).toMatchObject({ ok: false, reason: "reviewer_not_unique" });
    expect(
      evaluatePrReviewBinding({
        event: normalizePrReviewRequestEvent({
          legacySubkind: "pr-review-request-removed",
          sourceMessageId: "01SOURCE",
          repo: "apnex-org/agentic-network",
          prNumber: 625,
          requestedReviewerLogin: "apnex-lily",
        }),
        binding: hubBinding,
        target: { id: "work-123", status: "ready" },
        reviewer: uniqueReviewer,
      }),
    ).toMatchObject({ ok: false, reason: "removal_is_cancellation_only" });
  });

  it("allows only a hub-authored binding with safe target phase and unique reviewer", () => {
    const decision = evaluatePrReviewBinding({
      event: reviewRequestedEvent(),
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

    expect(decision).toMatchObject({
      ok: true,
      ruleId: PR_REVIEW_REQUEST_RULE_ID,
      bindingId: "prbind-625",
      targetWorkId: "work-123",
      reviewerAgentId: "agent-lily",
      reviewerRole: "architect",
    });
    if (decision.ok) expect(decision.projectionKey).toMatch(/^[a-f0-9]{64}$/);
  });
});
