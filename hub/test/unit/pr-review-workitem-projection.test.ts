import { describe, expect, it } from "vitest";
import { normalizePrReviewRequestEvent } from "../../src/policy/pr-review-workitem-event-contract.js";
import { evaluatePrReviewRequestRule } from "../../src/policy/pr-review-request-static-rule.js";
import { projectPrEvidenceReviewWorkItem, projectPrReviewWorkItem, reconcilePrReviewProjection } from "../../src/policy/pr-review-workitem-projection.js";
import { createMemoryStorageSubstrate } from "../../src/storage-substrate/memory-substrate.js";
import { SubstrateCounter } from "../../src/entities/substrate-counter.js";
import { AttestationRejected, WorkItemRepositorySubstrate } from "../../src/entities/work-item-repository-substrate.js";

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
        completionPolicy: { verifierAuthorityRequired: true },
      },
      evidenceRequirements: [
        {
          id: "github_review_artifact",
          kind: "freeform",
          description: "Executor-submitted GitHub PR review artifact URL/id for the requested reviewer and bound head. This artifact is load-bearing input for verifier attestation but does not complete the review obligation alone.",
        },
        {
          id: "independent_pr_review_validation",
          kind: "review",
          evidenceAuthority: "verifier-attestation",
          description: "Verifier attestation that the submitted GitHub review artifact matches the requested reviewer, bound PR head, and independence policy. External-only refs are not load-bearing; cite the submitted evidence ref.",
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

  it("compensates the review WorkItem when relation creation fails", async () => {
    const deleted: string[] = [];
    const projection = projectPrReviewWorkItem({ ruleResult: allowedRuleResult() });
    if (projection.action !== "create_review_workitem") throw new Error("expected create");
    const result = await reconcilePrReviewProjection({
      projection,
      binding: {
        id: "prbind-625",
        repo: "apnex-org/agentic-network",
        prNumber: 625,
        targetWorkId: "work-123",
        provenance: "hub",
      },
      sourceMessageId: "01SOURCE",
      store: {
        createBlueprintNode: async () => ({ item: { id: "work-created" }, created: true }),
        updateWorkItem: async () => { throw new Error("edge rejected"); },
        deleteWorkItem: async (id: string) => { deleted.push(id); },
      } as never,
    });

    expect(result).toMatchObject({
      materialized: false,
      workId: "work-created",
      compensated: true,
      fallbackReason: "relation_failed:edge rejected",
    });
    expect(deleted).toEqual(["work-created"]);
  });


  it("projects PR-evidence review gates deterministically and reuses duplicate evidence/replay", async () => {
    const binding = {
      id: "prbind-625",
      repo: "apnex-org/agentic-network",
      prNumber: 625,
      targetWorkId: "work-123",
      provenance: "hub" as const,
      headSha: "head-sha",
      baseSha: "base-sha",
      version: "1",
      authorLogin: "apnex-greg",
      lastPusherLogin: "apnex",
      pathClasses: ["architect_docs"],
      changedPathSource: "test-fixture",
    };
    const eligibility = {
      contractVersion: "pr-reviewer-eligibility-v1" as const,
      ok: true,
      requiredTeams: ["architect"],
      pathClasses: ["architect_docs"],
      selectedReviewers: [{ agentId: "agent-lily", role: "architect" as const, githubLogin: "apnex-lily" }],
      requestedReviewerStatus: "not_requested" as const,
      disqualified: [
        { agentId: "agent-greg", githubLogin: "apnex-greg", reason: "author_self_review" as const },
        { agentId: "agent-steve", githubLogin: "apnex", reason: "last_pusher_self_review" as const },
      ],
      policyVersion: "test-policy",
      policySourceRef: "test-policy-ref",
      lastPusherLogin: "apnex",
    };

    const first = projectPrEvidenceReviewWorkItem({
      binding,
      locator: { repo: binding.repo, prNumber: binding.prNumber, source: "repo_pr_number", raw: "apnex-org/agentic-network#625" },
      sourceMessageId: "pr-evidence:work-123:pr",
      eligibility,
    });
    expect(first.action).toBe("create_review_workitem");
    if (first.action !== "create_review_workitem") throw new Error("expected create");
    expect(first.createSpec.payload).toMatchObject({
      ruleId: "pr_evidence_admission_review_gate_v0",
      eventType: "workitem.complete_work.pr_evidence_review_required",
      selectedReviewerLogin: "apnex-lily",
      completionPolicy: {
        requiredReviewerLogin: "apnex-lily",
        requiredHeadSha: "head-sha",
        forbiddenReviewerLogins: ["apnex-greg", "apnex"],
        verifierAuthorityRequired: true,
      },
    });

    const second = projectPrEvidenceReviewWorkItem({
      binding,
      locator: { repo: binding.repo, prNumber: binding.prNumber, source: "repo_pr_number", raw: "apnex-org/agentic-network#625" },
      sourceMessageId: "pr-evidence:work-123:pr",
      eligibility,
      existingProjection: { projectionKey: first.projectionKey, workId: "work-review-existing", status: "ready" },
    });
    expect(second).toEqual({
      action: "reuse_existing_review_workitem",
      projectionKey: first.projectionKey,
      existingWorkId: "work-review-existing",
      existingStatus: "ready",
    });

    const updates: unknown[] = [];
    const materialized = await reconcilePrReviewProjection({
      projection: second,
      binding,
      sourceMessageId: "pr-evidence:work-123:pr",
      relation: "appendCompletionDependsOn",
      store: {
        updateWorkItem: async (...args: unknown[]) => { updates.push(args); return { before: { id: "work-123" }, after: { id: "work-123", completionDependsOn: ["work-review-existing"] } }; },
      } as never,
    });

    expect(materialized).toMatchObject({
      materialized: true,
      created: false,
      workId: "work-review-existing",
      relation: "appendCompletionDependsOn",
    });
    expect(updates).toEqual([[
      "work-123",
      { role: "architect", agentId: "system-pr-review-rule" },
      { appendCompletionDependsOn: ["work-review-existing"] },
    ]]);
  });

  it("provides a load-bearing SEAL path: artifact evidence parks, verifier cites evidence ref, external-only rejects", async () => {
    const projection = projectPrReviewWorkItem({ ruleResult: allowedRuleResult() });
    if (projection.action !== "create_review_workitem") throw new Error("expected create");
    const substrate = createMemoryStorageSubstrate();
    await substrate.put("Agent", { id: "agent-arch", role: "architect" });
    await substrate.put("Agent", { id: "agent-verifier", role: "verifier" });
    const repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
    const item = await repo.createWorkItem({
      type: projection.createSpec.type,
      roleEligibility: projection.createSpec.roleEligibility,
      targetRef: projection.createSpec.targetRef,
      payload: projection.createSpec.payload,
      runbook: projection.createSpec.runbook,
      evidenceRequirements: projection.createSpec.evidenceRequirements,
    });
    const claimed = await repo.claimWorkItem(item.id, "agent-arch", "architect");
    const token = claimed!.lease!.token;
    await repo.startWork(item.id, "agent-arch", token);
    const artifactRef = "https://github.com/apnex-org/agentic-network/pull/625#pullrequestreview-1";
    const parked = await repo.completeWork(
      item.id,
      "agent-arch",
      token,
      [{ requirementId: "github_review_artifact", kind: "freeform", ref: artifactRef, producedAt: new Date().toISOString() }],
      { observed: false, summary: "no friction observed" },
    );

    expect(parked!.status).toBe("review");
    await expect(repo.attestEvidence(item.id, "independent_pr_review_validation", "agent-verifier", "pass", [{ kind: "external", ref: artifactRef }])).rejects.toThrow(AttestationRejected);
    await expect(repo.attestEvidence(item.id, "independent_pr_review_validation", "agent-verifier", "pass", [{ kind: "evidence", ref: "missing" }])).rejects.toThrow(AttestationRejected);
    const attested = await repo.attestEvidence(item.id, "independent_pr_review_validation", "agent-verifier", "pass", [{ kind: "evidence", ref: artifactRef }]);
    expect(attested.item.status).toBe("done");
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
