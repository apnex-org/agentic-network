import {
  PR_REVIEWER_ELIGIBILITY_CONTRACT_VERSION,
  type RepoReviewPathClass,
  type RepoReviewPolicy,
} from "./pr-reviewer-eligibility.js";

/**
 * Audited v0 review policy fixture for apnex-org/agentic-network.
 *
 * This is a deterministic snapshot used by pr_reviewer_eligibility0. It avoids
 * a mandatory live GitHub API dependency in the event handler while preserving
 * provenance and drift caveats for later reconciliation.
 */
export const APNEX_AGENTIC_NETWORK_REVIEW_POLICY: RepoReviewPolicy = {
  contractVersion: PR_REVIEWER_ELIGIBILITY_CONTRACT_VERSION,
  repo: "apnex-org/agentic-network",
  version: "apnex-agentic-network-review-policy-2026-07-17",
  source: "audited-static-fixture",
  provenance: {
    sourceRef: "docs/reports/pr-reviewer-eligibility0-behavior.md",
    revision: "81061e70ccdd7a1f91f0356fc500562aa09fc3cc:.github/CODEOWNERS",
    capturedAt: "2026-07-17T00:00:00Z",
    driftBounded: true,
    caveat:
      "Static v0 fixture from org review eligibility audit; future live reconciliation may supersede these team/CODEOWNERS/ruleset facts.",
  },
  teams: {
    engineer: ["apnex", "apnex-greg"],
    architect: ["apnex", "apnex-lily"],
  },
  ruleset: {
    requiredApprovingReviewCount: 1,
    requireCodeOwnerReview: true,
    requireLastPushApproval: true,
    dismissStaleReviewsOnPush: true,
    requiredReviewThreadResolution: true,
  },
  pathClasses: [
    {
      id: "catch_all",
      patterns: ["*"],
      githubSatisfiableOwnerTeams: ["architect", "engineer"],
      processRequiredTeams: ["architect", "engineer"],
      note: "CODEOWNERS catch-all fallback; comments describe co-author signoff.",
    },
    {
      id: "architect_docs",
      patterns: [
        "/docs/methodology/",
        "/docs/reviews/",
        "/docs/planning/",
        "/docs/decisions/",
      ],
      githubSatisfiableOwnerTeams: ["architect"],
    },
    {
      id: "engineer_docs",
      patterns: ["/docs/traces/"],
      githubSatisfiableOwnerTeams: ["engineer"],
    },
    {
      id: "hub_code",
      patterns: ["/hub/src/"],
      githubSatisfiableOwnerTeams: ["engineer"],
    },
    {
      id: "shared_storage_substrate",
      patterns: ["/hub/src/storage-substrate/"],
      githubSatisfiableOwnerTeams: ["architect", "engineer"],
      processRequiredTeams: ["architect", "engineer"],
      note: "More-specific CODEOWNERS row wins over /hub/src/.",
    },
    {
      id: "adapter_code",
      patterns: ["/adapters/*/src/"],
      githubSatisfiableOwnerTeams: ["engineer"],
    },
    {
      id: "package_code",
      patterns: ["/packages/*/src/"],
      githubSatisfiableOwnerTeams: ["engineer"],
    },
    {
      id: "hub_tests",
      patterns: ["/hub/test/"],
      githubSatisfiableOwnerTeams: ["engineer"],
    },
    {
      id: "adapter_tests",
      patterns: ["/adapters/*/test/"],
      githubSatisfiableOwnerTeams: ["engineer"],
    },
    {
      id: "package_tests",
      patterns: ["/packages/*/test/"],
      githubSatisfiableOwnerTeams: ["engineer"],
    },
    {
      id: "hub_scripts",
      patterns: ["/hub/scripts/"],
      githubSatisfiableOwnerTeams: ["engineer"],
    },
    {
      id: "adapter_scripts",
      patterns: ["/adapters/*/scripts/"],
      githubSatisfiableOwnerTeams: ["engineer"],
    },
    {
      id: "shared_root_or_governance",
      patterns: [
        "/docs/audits/",
        "/docs/specs/",
        "/.github/workflows/",
        "/package.json",
        "/package-lock.json",
        "/tsconfig.json",
        "/vitest.config.ts",
      ],
      githubSatisfiableOwnerTeams: ["architect", "engineer"],
      processRequiredTeams: ["architect", "engineer"],
      note: "GitHub may accept any listed code owner; process may require both-role signoff.",
    },
    {
      id: "mission_docs_shared",
      patterns: ["/docs/missions/"],
      githubSatisfiableOwnerTeams: ["architect", "engineer"],
      processRequiredTeams: ["architect", "engineer"],
    },
    {
      id: "mission_docs_architect",
      patterns: ["/docs/missions/*-preflight.md", "/docs/missions/*-kickoff-decisions.md"],
      githubSatisfiableOwnerTeams: ["architect"],
    },
    {
      id: "mission_docs_engineer",
      patterns: ["/docs/missions/*-merge.md"],
      githubSatisfiableOwnerTeams: ["engineer"],
    },
  ],
};

function normalizePath(path: string): string {
  if (!path.startsWith("/")) return `/${path}`;
  return path;
}

function patternMatches(pattern: string, path: string): boolean {
  const normalizedPattern = normalizePath(pattern);
  const normalizedPath = normalizePath(path);
  if (normalizedPattern === "/*" || normalizedPattern === "*") return true;
  if (normalizedPattern.endsWith("/")) {
    const parts = normalizedPattern.split("*");
    if (parts.length === 1) return normalizedPath.startsWith(normalizedPattern);
    let cursor = 0;
    for (const part of parts) {
      if (part === "") continue;
      const idx = normalizedPath.indexOf(part, cursor);
      if (idx < cursor) return false;
      cursor = idx + part.length;
    }
    return true;
  }
  if (!normalizedPattern.includes("*")) return normalizedPath === normalizedPattern;
  const escaped = normalizedPattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${escaped}$`).test(normalizedPath);
}

export function resolveReviewPolicyPathClass(
  path: string,
  policy: RepoReviewPolicy = APNEX_AGENTIC_NETWORK_REVIEW_POLICY,
): RepoReviewPathClass {
  let matched = policy.pathClasses[0];
  for (const pathClass of policy.pathClasses) {
    if (pathClass.patterns.some((pattern) => patternMatches(pattern, path))) {
      matched = pathClass;
    }
  }
  return matched;
}

export function resolveReviewPolicyPathClasses(
  paths: string[],
  policy: RepoReviewPolicy = APNEX_AGENTIC_NETWORK_REVIEW_POLICY,
): string[] {
  return [...new Set(paths.map((path) => resolveReviewPolicyPathClass(path, policy).id))];
}
