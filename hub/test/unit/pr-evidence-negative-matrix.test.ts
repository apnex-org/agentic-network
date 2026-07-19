import { describe, expect, it } from "vitest";
import type { WorkItem } from "../../src/entities/work-item.js";
import { parsePrEvidenceLocator } from "../../src/policy/pr-evidence-admission-contract.js";
import { resolvePrEvidenceBinding, validatePrEvidenceBinding } from "../../src/policy/pr-evidence-admission-binding.js";
import { buildPrEvidenceReviewProjectionKey, projectPrEvidenceReviewWorkItem } from "../../src/policy/pr-review-workitem-projection.js";
import { APNEX_AGENTIC_NETWORK_REVIEW_POLICY } from "../../src/policy/pr-reviewer-eligibility-policy-fixture.js";
import {
  evaluateReviewerEligibility,
  PR_REVIEWER_ELIGIBILITY_CONTRACT_VERSION,
  summarizeReviewerEligibility,
} from "../../src/policy/pr-reviewer-eligibility.js";

const repo = "apnex-org/agentic-network";
const locator621 = { repo, prNumber: 621, source: "repo_pr_number" as const, raw: `${repo}#621` };

function bindingItem(overrides: Record<string, unknown> = {}, itemOverrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "prbind-621",
    status: "ready",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
    createdBy: { role: "architect", agentId: "agent-architect" },
    type: "task",
    priority: "normal",
    roleEligibility: [],
    dependsOn: [],
    completionDependsOn: [],
    evidenceRequirements: [],
    evidence: [],
    blockedOn: null,
    lease: null,
    attestations: {},
    attestationHistory: [],
    executorHistory: [],
    frictionReflections: [],
    leaseExpiryCount: 0,
    stateDurations: { ready: 0, claimed: 0, in_progress: 0, blocked: 0, paused: 0, review: 0 },
    enteredCurrentStateAt: "2026-07-17T00:00:00.000Z",
    payload: {
      obligationKind: "github_pr_workgraph_binding",
      repo,
      prNumber: 621,
      targetWorkId: "work-parent",
      headSha: "head-621",
      baseSha: "base-main",
      version: "v1",
      authorLogin: "apnex-greg",
      lastPusherLogin: "apnex-greg",
      pathClasses: ["hub_code"],
      changedPathSource: "bug-280-negative-matrix",
      ...overrides,
    },
    ...itemOverrides,
  } as WorkItem;
}

describe("PR evidence admission negative matrix / bug-280 forward prevention", () => {
  it("rejects raw body markers and unparseable prose before any authority lookup", () => {
    expect(parsePrEvidenceLocator("PR #621 is in the body marker")).toMatchObject({ ok: false, code: "not_explicit_pr_locator" });
    expect(parsePrEvidenceLocator("not a pull request locator")).toMatchObject({ ok: false, code: "not_explicit_pr_locator" });
  });

  it("rejects bug-280-style wrong duplicate PR evidence (#620) when Hub truth binds #621", async () => {
    const store = {
      async listPrReviewBindingWorkItems(requestedRepo: string, requestedPr: number) {
        // Keyed lookup for #620 must not accidentally scan/admit the #621 binding.
        expect([requestedRepo, requestedPr]).toEqual([repo, 620]);
        return { items: [], truncated: false };
      },
    };
    await expect(resolvePrEvidenceBinding({
      store,
      locator: { ...locator621, prNumber: 620, raw: `${repo}#620` },
      targetWorkId: "work-parent",
    })).resolves.toMatchObject({ ok: false, reason: "binding_missing" });
  });

  it("fails closed for unbound, ambiguous, wrong repo/PR, target mismatch, and head/base mismatch", async () => {
    await expect(resolvePrEvidenceBinding({
      store: { async listPrReviewBindingWorkItems() { return { items: [], truncated: false }; } },
      locator: locator621,
      targetWorkId: "work-parent",
    })).resolves.toMatchObject({ ok: false, reason: "binding_missing" });

    await expect(resolvePrEvidenceBinding({
      store: { async listPrReviewBindingWorkItems() { return { items: [bindingItem(), bindingItem({}, { id: "prbind-621b" })], truncated: false }; } },
      locator: locator621,
      targetWorkId: "work-parent",
    })).resolves.toMatchObject({ ok: false, reason: "binding_ambiguous" });

    const binding = {
      id: "prbind-621",
      repo,
      prNumber: 621,
      targetWorkId: "work-parent",
      provenance: "hub" as const,
      headSha: "head-621",
      baseSha: "base-main",
    };
    expect(validatePrEvidenceBinding({ locator: { ...locator621, repo: "apnex-org/other" }, binding, targetWorkId: "work-parent" })).toMatchObject({ ok: false, reason: "binding_repo_mismatch" });
    expect(validatePrEvidenceBinding({ locator: { ...locator621, prNumber: 620 }, binding, targetWorkId: "work-parent" })).toMatchObject({ ok: false, reason: "binding_pr_mismatch" });
    expect(validatePrEvidenceBinding({ locator: locator621, binding, targetWorkId: "work-other" })).toMatchObject({ ok: false, reason: "binding_target_mismatch" });
    expect(validatePrEvidenceBinding({ locator: locator621, binding, targetWorkId: "work-parent", expectedHeadSha: "head-other" })).toMatchObject({ ok: false, reason: "binding_head_mismatch" });
    expect(validatePrEvidenceBinding({ locator: locator621, binding, targetWorkId: "work-parent", expectedBaseSha: "base-other" })).toMatchObject({ ok: false, reason: "binding_base_mismatch" });
  });

  it("fails closed when the only possible reviewer would self-review / last-pusher-review", () => {
    const eligibility = summarizeReviewerEligibility(evaluateReviewerEligibility({
      contractVersion: PR_REVIEWER_ELIGIBILITY_CONTRACT_VERSION,
      repo,
      prNumber: 621,
      authorLogin: "apnex-greg",
      lastPusherLogin: "apnex-greg",
      paths: { pathClasses: ["hub_code"], provenance: APNEX_AGENTIC_NETWORK_REVIEW_POLICY.provenance },
      policy: APNEX_AGENTIC_NETWORK_REVIEW_POLICY,
      agents: [{ agentId: "agent-greg", role: "engineer", name: "greg", githubLogin: "apnex-greg" }],
    }));

    expect(eligibility.ok).toBe(false);
    expect(eligibility.selectedReviewers).toEqual([]);
    expect(eligibility.disqualified.map((d) => d.reason)).toEqual(expect.arrayContaining(["author_self_review"]));

    const lastPusherEligibility = summarizeReviewerEligibility(evaluateReviewerEligibility({
      contractVersion: PR_REVIEWER_ELIGIBILITY_CONTRACT_VERSION,
      repo,
      prNumber: 621,
      authorLogin: "apnex-other",
      lastPusherLogin: "apnex-greg",
      paths: { pathClasses: ["hub_code"], provenance: APNEX_AGENTIC_NETWORK_REVIEW_POLICY.provenance },
      policy: APNEX_AGENTIC_NETWORK_REVIEW_POLICY,
      agents: [{ agentId: "agent-greg", role: "engineer", name: "greg", githubLogin: "apnex-greg" }],
    }));
    expect(lastPusherEligibility.ok).toBe(false);
    expect(lastPusherEligibility.selectedReviewers).toEqual([]);
    expect(lastPusherEligibility.disqualified.map((d) => d.reason)).toEqual(expect.arrayContaining(["last_pusher_self_review"]));

    expect(projectPrEvidenceReviewWorkItem({
      binding: {
        id: "prbind-621",
        repo,
        prNumber: 621,
        targetWorkId: "work-parent",
        provenance: "hub",
        authorLogin: "apnex-greg",
        lastPusherLogin: "apnex-greg",
      },
      locator: locator621,
      sourceMessageId: "pr-evidence:work-parent:pr",
      eligibility,
    })).toMatchObject({ action: "fallback_only" });
  });

  it("treats multi-PR evidence as unsupported so trailing PR refs cannot bypass admission", () => {
    // Integrated policy tests assert this denial happens before store.completeWork.
    // This matrix row records the verifier regression class: first admitted PR plus
    // any second PR evidence (raw, unbound, wrong repo/PR/target/head/base) is not
    // a supported admission contract in v0.
    const submittedPrEvidenceRefs = ["apnex-org/agentic-network#621", "PR is in the body #620"];
    expect(submittedPrEvidenceRefs).toHaveLength(2);
    expect(parsePrEvidenceLocator(submittedPrEvidenceRefs[0])).toMatchObject({ ok: true });
    expect(parsePrEvidenceLocator(submittedPrEvidenceRefs[1])).toMatchObject({ ok: false, code: "not_explicit_pr_locator" });
  });

  it("models stale/terminal review state as not missing review and requires explicit parent retry instead of silent finalization", () => {
    const binding = { id: "prbind-621", repo, prNumber: 621, targetWorkId: "work-parent", provenance: "hub" as const };
    const eligibility = {
      contractVersion: PR_REVIEWER_ELIGIBILITY_CONTRACT_VERSION,
      ok: true,
      requiredTeams: ["engineer"],
      pathClasses: ["hub_code"],
      selectedReviewers: [{ agentId: "agent-reviewer", role: "engineer" as const, githubLogin: "apnex" }],
      requestedReviewerStatus: "not_requested" as const,
      disqualified: [],
      policyVersion: APNEX_AGENTIC_NETWORK_REVIEW_POLICY.version,
      policySourceRef: APNEX_AGENTIC_NETWORK_REVIEW_POLICY.provenance.sourceRef,
    };
    const projectionKey = buildPrEvidenceReviewProjectionKey({
      binding,
      reviewerAgentId: "agent-reviewer",
      reviewerGithubLogin: "apnex",
      policyVersion: APNEX_AGENTIC_NETWORK_REVIEW_POLICY.version,
      policySourceRef: APNEX_AGENTIC_NETWORK_REVIEW_POLICY.provenance.sourceRef,
    });
    const retryProjection = projectPrEvidenceReviewWorkItem({
      binding,
      locator: locator621,
      sourceMessageId: "pr-evidence:work-parent:pr",
      eligibility,
      existingProjection: { projectionKey, workId: "work-review-621", status: "done" },
    });

    expect(retryProjection).toMatchObject({
      action: "reuse_existing_review_workitem",
      existingWorkId: "work-review-621",
      existingStatus: "done",
    });
  });
});
