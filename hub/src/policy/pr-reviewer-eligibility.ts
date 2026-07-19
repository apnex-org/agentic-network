import type { AgentRole } from "../state.js";

/**
 * Typed contract for deterministic PR reviewer eligibility.
 *
 * This module is intentionally policy/data-contract only for the
 * pr_reviewer_eligibility0 policy_contract node. Runtime evaluation and
 * WorkGraph projection integration live in later nodes. Keep the seam aligned
 * with the existing GitHub event → static rule → WorkGraph projection path;
 * this is not a PR entity/FSM contract.
 */

export const PR_REVIEWER_ELIGIBILITY_CONTRACT_VERSION = "pr-reviewer-eligibility-v1" as const;

export type PrReviewerEligibilityContractVersion =
  typeof PR_REVIEWER_ELIGIBILITY_CONTRACT_VERSION;

export type RepoReviewPolicySource =
  | "audited-static-fixture"
  | "generated-config"
  | "live-github-snapshot";

export interface PolicyProvenance {
  /** Human-readable source pointer, e.g. an audit/report path or GitHub ruleset URL. */
  sourceRef: string;
  /** Optional source revision/SHA for immutable evidence. */
  revision?: string;
  /** ISO-8601 time the source facts were captured or generated. */
  capturedAt?: string;
  /** Whether the policy is known to be a bounded snapshot rather than live truth. */
  driftBounded: boolean;
  /** Freeform caveat surfaced to WorkGraph payloads/reports. */
  caveat?: string;
}

export interface RepoReviewRulesetPolicy {
  requiredApprovingReviewCount: number;
  requireCodeOwnerReview: boolean;
  requireLastPushApproval: boolean;
  dismissStaleReviewsOnPush: boolean;
  requiredReviewThreadResolution: boolean;
}

export type ReviewOwnerTeam = "engineer" | "architect" | string;

export interface RepoReviewPathClass {
  /** Stable compact class id, e.g. hub_code, architect_docs, shared_root_or_governance. */
  id: string;
  /** CODEOWNERS-style patterns or audited path prefixes represented by this class. */
  patterns: string[];
  /** Teams GitHub CODEOWNERS/ruleset can satisfy for this class. */
  githubSatisfiableOwnerTeams: ReviewOwnerTeam[];
  /** Optional stricter process signoff teams; separated from GitHub satisfiability. */
  processRequiredTeams?: ReviewOwnerTeam[];
  /** Optional note for shared/governance rows or last-match-wins caveats. */
  note?: string;
}

export interface RepoReviewPolicy {
  contractVersion: PrReviewerEligibilityContractVersion;
  repo: string;
  version: string;
  source: RepoReviewPolicySource;
  provenance: PolicyProvenance;
  /** GitHub team slug/name to GitHub logins. */
  teams: Record<string, string[]>;
  ruleset: RepoReviewRulesetPolicy;
  pathClasses: RepoReviewPathClass[];
}

export interface ReviewerAgentIdentity {
  agentId: string;
  role: AgentRole;
  name?: string;
  /** GitHub login used for review authority. Missing is a load-bearing denial. */
  githubLogin?: string;
}

export interface ReviewerEligibilityPathInput {
  /** Raw changed paths when available. */
  changedPaths?: string[];
  /** Compact pre-classified path classes when raw paths are unavailable or too large. */
  pathClasses?: string[];
  /** Provenance for changedPaths/pathClasses. Required by callers before closure claims. */
  provenance?: PolicyProvenance;
}

export interface ReviewerEligibilityInput {
  contractVersion: PrReviewerEligibilityContractVersion;
  repo: string;
  prNumber: number;
  authorLogin: string;
  lastPusherLogin?: string;
  requestedReviewerLogin?: string;
  requestedTeamSlug?: string;
  headSha?: string;
  paths: ReviewerEligibilityPathInput;
  policy: RepoReviewPolicy;
  agents: ReviewerAgentIdentity[];
}

export type ReviewerRequestedStatus =
  | "not_requested"
  | "eligible"
  | "insufficient_but_alternative_selected"
  | "insufficient_no_alternative"
  | "ambiguous_identity"
  | "unresolved_identity"
  | "team_request_requires_resolver";

export type ReviewerDisqualificationReason =
  | "missing_github_login"
  | "shared_login_duplicate_agent"
  | "not_in_required_owner_team"
  | "author_self_review"
  | "last_pusher_self_review"
  | "requested_reviewer_insufficient"
  | "identity_ambiguous"
  | "identity_unresolved";

export interface ReviewerDisqualification {
  githubLogin?: string;
  agentId?: string;
  role?: AgentRole;
  reason: ReviewerDisqualificationReason;
  detail?: string;
}

export interface EligibleReviewerCandidate {
  agentId: string;
  role: AgentRole;
  name?: string;
  githubLogin: string;
  satisfiesTeams: ReviewOwnerTeam[];
}

export type ReviewerEligibilityDenialReason =
  | "changed_paths_missing"
  | "path_class_unresolved"
  | "identity_missing"
  | "ambiguous_identity"
  | "team_unresolved"
  | "no_eligible_reviewer"
  | "unsupported_policy"
  | "unsupported_ruleset"
  | "policy_repo_mismatch"
  | "last_pusher_missing";

export interface ReviewerEligibilityBaseResult {
  contractVersion: PrReviewerEligibilityContractVersion;
  repo: string;
  prNumber: number;
  requiredTeams: ReviewOwnerTeam[];
  pathClasses: string[];
  requestedReviewerStatus: ReviewerRequestedStatus;
  disqualified: ReviewerDisqualification[];
  policyVersion: string;
  policyProvenance: PolicyProvenance;
}

export interface ReviewerEligibilityPass extends ReviewerEligibilityBaseResult {
  ok: true;
  selected: EligibleReviewerCandidate[];
  eligibleCandidates: EligibleReviewerCandidate[];
}

export interface ReviewerEligibilityFail extends ReviewerEligibilityBaseResult {
  ok: false;
  reason: ReviewerEligibilityDenialReason;
  selected: [];
  eligibleCandidates: EligibleReviewerCandidate[];
}

export type ReviewerEligibilityResult =
  | ReviewerEligibilityPass
  | ReviewerEligibilityFail;

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
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

function resolvePathClassId(path: string, policy: RepoReviewPolicy): string | null {
  let matched: string | null = null;
  for (const pathClass of policy.pathClasses) {
    if (pathClass.patterns.some((pattern) => patternMatches(pattern, path))) {
      matched = pathClass.id;
    }
  }
  return matched;
}

function disqualificationKey(d: ReviewerDisqualification): string {
  return `${d.agentId ?? ""}:${d.githubLogin ?? ""}:${d.reason}`;
}

function pushDisqualification(
  into: ReviewerDisqualification[],
  disqualification: ReviewerDisqualification,
): void {
  if (!into.some((existing) => disqualificationKey(existing) === disqualificationKey(disqualification))) {
    into.push(disqualification);
  }
}

function baseResult(input: ReviewerEligibilityInput, pathClasses: string[], requiredTeams: ReviewOwnerTeam[], disqualified: ReviewerDisqualification[], requestedReviewerStatus: ReviewerRequestedStatus): ReviewerEligibilityBaseResult {
  return {
    contractVersion: input.contractVersion,
    repo: input.repo,
    prNumber: input.prNumber,
    requiredTeams,
    pathClasses,
    requestedReviewerStatus,
    disqualified,
    policyVersion: input.policy.version,
    policyProvenance: input.policy.provenance,
  };
}

function teamsForLogin(policy: RepoReviewPolicy, githubLogin: string): ReviewOwnerTeam[] {
  return Object.entries(policy.teams)
    .filter(([, logins]) => logins.includes(githubLogin))
    .map(([team]) => team);
}

/** Pure deterministic reviewer eligibility evaluator. */
export function evaluateReviewerEligibility(input: ReviewerEligibilityInput): ReviewerEligibilityResult {
  const disqualified: ReviewerDisqualification[] = [];
  const knownClassIds = new Set(input.policy.pathClasses.map((pathClass) => pathClass.id));

  if (input.contractVersion !== PR_REVIEWER_ELIGIBILITY_CONTRACT_VERSION) {
    return {
      ...baseResult(input, [], [], disqualified, "insufficient_no_alternative"),
      ok: false,
      reason: "unsupported_policy",
      selected: [],
      eligibleCandidates: [],
    };
  }
  if (input.policy.repo !== input.repo) {
    return {
      ...baseResult(input, [], [], disqualified, "insufficient_no_alternative"),
      ok: false,
      reason: "policy_repo_mismatch",
      selected: [],
      eligibleCandidates: [],
    };
  }
  if (input.requestedTeamSlug) {
    return {
      ...baseResult(input, [], [], disqualified, "team_request_requires_resolver"),
      ok: false,
      reason: "team_unresolved",
      selected: [],
      eligibleCandidates: [],
    };
  }

  let pathClasses = input.paths.pathClasses ? unique(input.paths.pathClasses) : undefined;
  if (!pathClasses && input.paths.changedPaths) {
    const resolved = input.paths.changedPaths.map((path) => resolvePathClassId(path, input.policy));
    if (resolved.some((id) => id === null)) {
      return {
        ...baseResult(input, [], [], disqualified, "insufficient_no_alternative"),
        ok: false,
        reason: "path_class_unresolved",
        selected: [],
        eligibleCandidates: [],
      };
    }
    pathClasses = unique(resolved as string[]);
  }
  if (!pathClasses || pathClasses.length === 0) {
    return {
      ...baseResult(input, [], [], disqualified, "insufficient_no_alternative"),
      ok: false,
      reason: "changed_paths_missing",
      selected: [],
      eligibleCandidates: [],
    };
  }
  if (pathClasses.some((id) => !knownClassIds.has(id))) {
    return {
      ...baseResult(input, pathClasses, [], disqualified, "insufficient_no_alternative"),
      ok: false,
      reason: "path_class_unresolved",
      selected: [],
      eligibleCandidates: [],
    };
  }

  const classPolicies = pathClasses.map((id) => input.policy.pathClasses.find((pathClass) => pathClass.id === id)!);
  const requiredTeams = unique(
    classPolicies.flatMap((pathClass) =>
      pathClass.processRequiredTeams && pathClass.processRequiredTeams.length > 0
        ? pathClass.processRequiredTeams
        : pathClass.githubSatisfiableOwnerTeams,
    ),
  );

  const byLogin = new Map<string, ReviewerAgentIdentity[]>();
  for (const agent of input.agents) {
    if (!agent.githubLogin) {
      pushDisqualification(disqualified, {
        agentId: agent.agentId,
        role: agent.role,
        reason: "missing_github_login",
      });
      continue;
    }
    const group = byLogin.get(agent.githubLogin) ?? [];
    group.push(agent);
    byLogin.set(agent.githubLogin, group);
  }

  const eligibleCandidates: EligibleReviewerCandidate[] = [];
  for (const agent of input.agents) {
    if (!agent.githubLogin) continue;
    const satisfiesTeams = teamsForLogin(input.policy, agent.githubLogin).filter((team) => requiredTeams.includes(team));
    if (satisfiesTeams.length === 0) {
      pushDisqualification(disqualified, {
        agentId: agent.agentId,
        role: agent.role,
        githubLogin: agent.githubLogin,
        reason: "not_in_required_owner_team",
      });
      continue;
    }
    if (agent.githubLogin === input.authorLogin) {
      pushDisqualification(disqualified, {
        agentId: agent.agentId,
        role: agent.role,
        githubLogin: agent.githubLogin,
        reason: "author_self_review",
      });
      continue;
    }
    if (input.lastPusherLogin && agent.githubLogin === input.lastPusherLogin) {
      pushDisqualification(disqualified, {
        agentId: agent.agentId,
        role: agent.role,
        githubLogin: agent.githubLogin,
        reason: "last_pusher_self_review",
      });
      continue;
    }
    eligibleCandidates.push({
      agentId: agent.agentId,
      role: agent.role,
      name: agent.name,
      githubLogin: agent.githubLogin,
      satisfiesTeams,
    });
  }

  let requestedReviewerStatus: ReviewerRequestedStatus = input.requestedReviewerLogin
    ? "unresolved_identity"
    : "not_requested";
  let selected = eligibleCandidates;
  if (input.requestedReviewerLogin) {
    const requestedIdentities = byLogin.get(input.requestedReviewerLogin) ?? [];
    const requestedEligible = eligibleCandidates.filter((candidate) => candidate.githubLogin === input.requestedReviewerLogin);
    if (requestedIdentities.length === 0) {
      requestedReviewerStatus = "unresolved_identity";
      pushDisqualification(disqualified, {
        githubLogin: input.requestedReviewerLogin,
        reason: "identity_unresolved",
      });
    } else if (requestedIdentities.length > 1) {
      requestedReviewerStatus = "ambiguous_identity";
      for (const identity of requestedIdentities) {
        pushDisqualification(disqualified, {
          agentId: identity.agentId,
          role: identity.role,
          githubLogin: identity.githubLogin,
          reason: "shared_login_duplicate_agent",
          detail: "Requested GitHub login maps to multiple Hub agents; never selecting a first match.",
        });
      }
    } else if (requestedEligible.length > 0) {
      requestedReviewerStatus = "eligible";
      selected = requestedEligible;
    } else {
      requestedReviewerStatus = eligibleCandidates.length > 0
        ? "insufficient_but_alternative_selected"
        : "insufficient_no_alternative";
      pushDisqualification(disqualified, {
        agentId: requestedIdentities[0].agentId,
        role: requestedIdentities[0].role,
        githubLogin: requestedIdentities[0].githubLogin,
        reason: "requested_reviewer_insufficient",
      });
    }
  }

  if (eligibleCandidates.length === 0) {
    return {
      ...baseResult(input, pathClasses, requiredTeams, disqualified, requestedReviewerStatus),
      ok: false,
      reason: input.agents.length === 0 ? "identity_missing" : "no_eligible_reviewer",
      selected: [],
      eligibleCandidates,
    };
  }

  return {
    ...baseResult(input, pathClasses, requiredTeams, disqualified, requestedReviewerStatus),
    ok: true,
    selected,
    eligibleCandidates,
  };
}

export function summarizeReviewerEligibility(
  result: ReviewerEligibilityResult,
): ReviewerEligibilityProjectionSummary {
  return {
    contractVersion: result.contractVersion,
    ok: result.ok,
    reason: result.ok ? undefined : result.reason,
    requiredTeams: result.requiredTeams,
    pathClasses: result.pathClasses,
    selectedReviewers: result.selected.map((candidate) => ({
      agentId: candidate.agentId,
      role: candidate.role,
      githubLogin: candidate.githubLogin,
    })),
    requestedReviewerStatus: result.requestedReviewerStatus,
    disqualified: result.disqualified.map((entry) => ({
      githubLogin: entry.githubLogin,
      agentId: entry.agentId,
      reason: entry.reason,
    })),
    policyVersion: result.policyVersion,
    policySourceRef: result.policyProvenance.sourceRef,
  };
}

/**
 * Compact payload intended for PR review WorkItems and fallback notes. It is
 * deliberately smaller than ReviewerEligibilityResult so WorkGraph rows do not
 * accrete raw CODEOWNERS/team/file dumps.
 */
export interface ReviewerEligibilityProjectionSummary {
  contractVersion: PrReviewerEligibilityContractVersion;
  ok: boolean;
  reason?: ReviewerEligibilityDenialReason;
  requiredTeams: ReviewOwnerTeam[];
  pathClasses: string[];
  selectedReviewers: Array<{
    agentId: string;
    role: AgentRole;
    githubLogin: string;
  }>;
  requestedReviewerStatus: ReviewerRequestedStatus;
  disqualified: Array<{
    githubLogin?: string;
    agentId?: string;
    reason: ReviewerDisqualificationReason;
  }>;
  policyVersion: string;
  policySourceRef: string;
  lastPusherLogin?: string;
}
