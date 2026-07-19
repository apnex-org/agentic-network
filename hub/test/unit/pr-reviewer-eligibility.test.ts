import { describe, expect, it } from "vitest";
import {
  evaluateReviewerEligibility,
  PR_REVIEWER_ELIGIBILITY_CONTRACT_VERSION,
  summarizeReviewerEligibility,
  type ReviewerAgentIdentity,
  type ReviewerEligibilityInput,
} from "../../src/policy/pr-reviewer-eligibility.js";
import { APNEX_AGENTIC_NETWORK_REVIEW_POLICY } from "../../src/policy/pr-reviewer-eligibility-policy-fixture.js";

const agents: ReviewerAgentIdentity[] = [
  { agentId: "agent-greg", name: "greg", role: "engineer", githubLogin: "apnex-greg" },
  { agentId: "agent-ruby", name: "ruby", role: "engineer", githubLogin: "apnex-greg" },
  { agentId: "agent-lily", name: "lily", role: "architect", githubLogin: "apnex-lily" },
  { agentId: "agent-steve", name: "steve", role: "verifier", githubLogin: "apnex" },
];

function input(overrides: Partial<ReviewerEligibilityInput> = {}): ReviewerEligibilityInput {
  return {
    contractVersion: PR_REVIEWER_ELIGIBILITY_CONTRACT_VERSION,
    repo: "apnex-org/agentic-network",
    prNumber: 629,
    authorLogin: "apnex-greg",
    lastPusherLogin: "apnex-greg",
    requestedReviewerLogin: "apnex-lily",
    paths: {
      changedPaths: ["docs/planning/pr-binding-reviewer-eligibility-plan0-final-design.md"],
      provenance: APNEX_AGENTIC_NETWORK_REVIEW_POLICY.provenance,
    },
    policy: APNEX_AGENTIC_NETWORK_REVIEW_POLICY,
    agents,
    ...overrides,
  };
}

describe("evaluateReviewerEligibility", () => {
  it("selects an explicitly requested eligible reviewer and summarizes WorkGraph payload fields", () => {
    const result = evaluateReviewerEligibility(input());

    expect(result.ok).toBe(true);
    expect(result.pathClasses).toEqual(["architect_docs"]);
    expect(result.requiredTeams).toEqual(["architect"]);
    expect(result.requestedReviewerStatus).toBe("eligible");
    expect(result.selected).toEqual([
      expect.objectContaining({ agentId: "agent-lily", githubLogin: "apnex-lily", satisfiesTeams: ["architect"] }),
    ]);

    expect(summarizeReviewerEligibility(result)).toMatchObject({
      ok: true,
      selectedReviewers: [{ agentId: "agent-lily", role: "architect", githubLogin: "apnex-lily" }],
      policySourceRef: "docs/reports/pr-reviewer-eligibility0-behavior.md",
    });
  });

  it("covers the PR #628/#629-like self-review incident: requested author/shared login is never selected first-match", () => {
    const result = evaluateReviewerEligibility(input({
      requestedReviewerLogin: "apnex-greg",
      paths: {
        changedPaths: ["hub/src/storage-substrate/schemas/all-schemas.ts"],
        provenance: APNEX_AGENTIC_NETWORK_REVIEW_POLICY.provenance,
      },
    }));

    expect(result.ok).toBe(true);
    expect(result.pathClasses).toEqual(["shared_storage_substrate"]);
    expect(result.requiredTeams).toEqual(["architect", "engineer"]);
    expect(result.requestedReviewerStatus).toBe("ambiguous_identity");
    expect(result.selected.map((candidate) => candidate.githubLogin).sort()).toEqual(["apnex", "apnex-lily"]);
    expect(result.disqualified).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ githubLogin: "apnex-greg", agentId: "agent-greg", reason: "author_self_review" }),
        expect.objectContaining({ githubLogin: "apnex-greg", agentId: "agent-ruby", reason: "author_self_review" }),
        expect.objectContaining({ githubLogin: "apnex-greg", agentId: "agent-greg", reason: "shared_login_duplicate_agent" }),
        expect.objectContaining({ githubLogin: "apnex-greg", agentId: "agent-ruby", reason: "shared_login_duplicate_agent" }),
      ]),
    );
  });

  it("keeps shared-login semantics cardinality-explicit instead of choosing the first Hub agent", () => {
    const result = evaluateReviewerEligibility(input({
      authorLogin: "apnex-lily",
      lastPusherLogin: undefined,
      requestedReviewerLogin: "apnex-greg",
      paths: { pathClasses: ["engineer_docs"], provenance: APNEX_AGENTIC_NETWORK_REVIEW_POLICY.provenance },
    }));

    expect(result.ok).toBe(true);
    expect(result.requestedReviewerStatus).toBe("ambiguous_identity");
    expect(result.selected.map((candidate) => candidate.agentId).sort()).toEqual(["agent-greg", "agent-ruby", "agent-steve"]);
    expect(result.disqualified).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agentId: "agent-greg", reason: "shared_login_duplicate_agent" }),
        expect.objectContaining({ agentId: "agent-ruby", reason: "shared_login_duplicate_agent" }),
      ]),
    );
  });

  it("disqualifies last-pusher self-review independently from author self-review", () => {
    const result = evaluateReviewerEligibility(input({
      authorLogin: "apnex-lily",
      lastPusherLogin: "apnex",
      requestedReviewerLogin: undefined,
      paths: { pathClasses: ["shared_root_or_governance"], provenance: APNEX_AGENTIC_NETWORK_REVIEW_POLICY.provenance },
    }));

    expect(result.ok).toBe(true);
    expect(result.selected.map((candidate) => candidate.githubLogin).sort()).toEqual(["apnex-greg", "apnex-greg"]);
    expect(result.disqualified).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ githubLogin: "apnex-lily", reason: "author_self_review" }),
        expect.objectContaining({ githubLogin: "apnex", reason: "last_pusher_self_review" }),
      ]),
    );
  });

  it("fails closed for team requests and missing changed-path source", () => {
    expect(evaluateReviewerEligibility(input({ requestedReviewerLogin: undefined, requestedTeamSlug: "engineer" }))).toMatchObject({
      ok: false,
      reason: "team_unresolved",
      requestedReviewerStatus: "team_request_requires_resolver",
    });

    expect(evaluateReviewerEligibility(input({ requestedReviewerLogin: undefined, paths: {} }))).toMatchObject({
      ok: false,
      reason: "changed_paths_missing",
    });
  });

  it("fails closed when the policy repo or path class does not match the input", () => {
    expect(evaluateReviewerEligibility(input({ repo: "apnex-org/other" }))).toMatchObject({
      ok: false,
      reason: "policy_repo_mismatch",
    });

    expect(evaluateReviewerEligibility(input({ paths: { pathClasses: ["unknown"], provenance: APNEX_AGENTIC_NETWORK_REVIEW_POLICY.provenance } }))).toMatchObject({
      ok: false,
      reason: "path_class_unresolved",
    });
  });
});
