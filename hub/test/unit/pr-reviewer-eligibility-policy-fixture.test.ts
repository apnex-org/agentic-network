import { describe, expect, it } from "vitest";
import {
  APNEX_AGENTIC_NETWORK_REVIEW_POLICY,
  resolveReviewPolicyPathClass,
  resolveReviewPolicyPathClasses,
} from "../../src/policy/pr-reviewer-eligibility-policy-fixture.js";

const policy = APNEX_AGENTIC_NETWORK_REVIEW_POLICY;

describe("apnex agentic-network review policy fixture", () => {
  it("carries audited team and ruleset facts with drift-bounded provenance", () => {
    expect(policy.repo).toBe("apnex-org/agentic-network");
    expect(policy.source).toBe("audited-static-fixture");
    expect(policy.provenance.sourceRef).toBe("docs/reports/org-review-eligibility-audit-2026-07-17.md");
    expect(policy.provenance.driftBounded).toBe(true);
    expect(policy.teams.engineer).toEqual(["apnex", "apnex-greg"]);
    expect(policy.teams.architect).toEqual(["apnex", "apnex-lily"]);
    expect(policy.ruleset).toMatchObject({
      requiredApprovingReviewCount: 1,
      requireCodeOwnerReview: true,
      requireLastPushApproval: true,
      dismissStaleReviewsOnPush: true,
      requiredReviewThreadResolution: true,
    });
  });

  it("classifies hub code/test paths as engineer-owned", () => {
    expect(resolveReviewPolicyPathClass("hub/src/policy/foo.ts").id).toBe("hub_code");
    expect(resolveReviewPolicyPathClass("/hub/test/unit/foo.test.ts").id).toBe("hub_tests");
    expect(resolveReviewPolicyPathClasses(["hub/src/policy/foo.ts", "hub/test/unit/foo.test.ts"])).toEqual([
      "hub_code",
      "hub_tests",
    ]);
  });

  it("preserves CODEOWNERS last-match-wins for storage-substrate shared ownership", () => {
    const pathClass = resolveReviewPolicyPathClass("hub/src/storage-substrate/schema.ts");
    expect(pathClass.id).toBe("shared_storage_substrate");
    expect(pathClass.githubSatisfiableOwnerTeams).toEqual(["architect", "engineer"]);
    expect(pathClass.processRequiredTeams).toEqual(["architect", "engineer"]);
  });

  it("classifies architect docs and shared governance/root paths distinctly", () => {
    expect(resolveReviewPolicyPathClass("docs/planning/plan.md").id).toBe("architect_docs");
    expect(resolveReviewPolicyPathClass(".github/workflows/test.yml").id).toBe("shared_root_or_governance");
    expect(resolveReviewPolicyPathClass("package.json").id).toBe("shared_root_or_governance");
  });

  it("keeps docs/missions specific rows after the shared missions row", () => {
    expect(resolveReviewPolicyPathClass("docs/missions/foo-preflight.md").id).toBe("mission_docs_architect");
    expect(resolveReviewPolicyPathClass("docs/missions/foo-merge.md").id).toBe("mission_docs_engineer");
    expect(resolveReviewPolicyPathClass("docs/missions/foo-overview.md").id).toBe("mission_docs_shared");
  });

  it("falls back to catch_all for unknown paths", () => {
    const pathClass = resolveReviewPolicyPathClass("README.md");
    expect(pathClass.id).toBe("catch_all");
    expect(pathClass.githubSatisfiableOwnerTeams).toEqual(["architect", "engineer"]);
  });
});
