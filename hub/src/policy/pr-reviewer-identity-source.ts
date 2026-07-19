import type { AgentLabels, AgentRole } from "../state.js";
import {
  type PolicyProvenance,
  PR_REVIEWER_ELIGIBILITY_CONTRACT_VERSION,
  type ReviewerAgentIdentity,
} from "./pr-reviewer-eligibility.js";
import { GITHUB_LOGIN_LABEL } from "./repo-event-author-lookup.js";

/**
 * Machine-readable v0 source for PR reviewer GitHub identities.
 *
 * This module deliberately projects identity facts without choosing a first
 * Hub agent for a GitHub login. Shared GitHub logins (Greg/Ruby ->
 * apnex-greg) remain explicit so the later eligibility engine can reason
 * about GitHub approval identity separately from Hub agent identity.
 */
export const PR_REVIEWER_IDENTITY_SOURCE_VERSION =
  "pr-reviewer-identity-source-2026-07-17" as const;

export type PrReviewerIdentitySourceVersion = typeof PR_REVIEWER_IDENTITY_SOURCE_VERSION;

export type ReviewerGithubIdentitySourceKind =
  | "hub-agent-label"
  | "audited-static-fixture";

export interface ReviewerIdentityAgentInput {
  id: string;
  role: AgentRole;
  name?: string;
  labels?: AgentLabels;
}

export interface AuditedReviewerGithubIdentity {
  name: string;
  role: AgentRole;
  githubLogin: string;
  provenance: PolicyProvenance;
}

export interface ReviewerGithubIdentitySourceRecord {
  agentId: string;
  role: AgentRole;
  name?: string;
  githubLogin?: string;
  source?: ReviewerGithubIdentitySourceKind;
  sourceRef?: string;
}

export interface ReviewerGithubLoginGroup {
  githubLogin: string;
  agentIds: string[];
  names: string[];
  roles: AgentRole[];
}

export interface ReviewerGithubIdentityConflict {
  agentId: string;
  name?: string;
  role: AgentRole;
  labelLogin: string;
  fixtureLogin: string;
  fixtureSourceRef: string;
}

export interface ReviewerGithubIdentityProjection {
  contractVersion: typeof PR_REVIEWER_ELIGIBILITY_CONTRACT_VERSION;
  sourceVersion: PrReviewerIdentitySourceVersion;
  labelKey: typeof GITHUB_LOGIN_LABEL;
  identities: ReviewerAgentIdentity[];
  identitySources: ReviewerGithubIdentitySourceRecord[];
  sharedGithubLogins: ReviewerGithubLoginGroup[];
  missingGithubLoginAgents: Array<{ agentId: string; name?: string; role: AgentRole }>;
  conflicts: ReviewerGithubIdentityConflict[];
}

export type ReviewerGithubLoginResolution =
  | {
      status: "none";
      githubLogin: string;
      matchCount: 0;
    }
  | {
      status: "unique";
      githubLogin: string;
      matchCount: 1;
      identity: ReviewerAgentIdentity;
    }
  | {
      status: "shared_login";
      githubLogin: string;
      matchCount: number;
      identities: ReviewerAgentIdentity[];
    };

const AUDIT_PROVENANCE: PolicyProvenance = {
  sourceRef: "docs/reports/pr-reviewer-eligibility0-behavior.md",
  capturedAt: "2026-07-17T00:00:00Z",
  driftBounded: true,
  caveat:
    "Static v0 identity fixture from org review eligibility audit; Hub agent labels remain preferred when present.",
};

/**
 * Audited fallback for prod seats whose live Hub label is missing or not yet
 * deployed. Name+role matching is intentional: Hub agent names are stable
 * identities, while the GitHub login is the external review-authority identity.
 */
export const APNEX_REVIEWER_GITHUB_IDENTITIES: AuditedReviewerGithubIdentity[] = [
  { name: "greg", role: "engineer", githubLogin: "apnex-greg", provenance: AUDIT_PROVENANCE },
  { name: "ruby", role: "engineer", githubLogin: "apnex-greg", provenance: AUDIT_PROVENANCE },
  { name: "lily", role: "architect", githubLogin: "apnex-lily", provenance: AUDIT_PROVENANCE },
  { name: "steve", role: "verifier", githubLogin: "apnex", provenance: AUDIT_PROVENANCE },
];

function fixtureKey(name: string | undefined, role: AgentRole): string {
  return `${role}:${name ?? ""}`;
}

function findFixture(
  agent: ReviewerIdentityAgentInput,
  fixtures: AuditedReviewerGithubIdentity[],
): AuditedReviewerGithubIdentity | undefined {
  if (!agent.name) return undefined;
  const key = fixtureKey(agent.name, agent.role);
  return fixtures.find((fixture) => fixtureKey(fixture.name, fixture.role) === key);
}

function groupByGithubLogin(identities: ReviewerAgentIdentity[]): ReviewerGithubLoginGroup[] {
  const byLogin = new Map<string, ReviewerAgentIdentity[]>();
  for (const identity of identities) {
    if (!identity.githubLogin) continue;
    const existing = byLogin.get(identity.githubLogin) ?? [];
    existing.push(identity);
    byLogin.set(identity.githubLogin, existing);
  }

  return [...byLogin.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([githubLogin, group]) => ({
      githubLogin,
      agentIds: group.map((identity) => identity.agentId),
      names: group.flatMap((identity) => (identity.name ? [identity.name] : [])),
      roles: [...new Set(group.map((identity) => identity.role))],
    }));
}

export interface ProjectReviewerGithubIdentitiesOptions {
  fixtures?: AuditedReviewerGithubIdentity[];
}

export function projectReviewerGithubIdentities(
  agents: ReviewerIdentityAgentInput[],
  options: ProjectReviewerGithubIdentitiesOptions = {},
): ReviewerGithubIdentityProjection {
  const fixtures = options.fixtures ?? APNEX_REVIEWER_GITHUB_IDENTITIES;
  const identities: ReviewerAgentIdentity[] = [];
  const identitySources: ReviewerGithubIdentitySourceRecord[] = [];
  const missingGithubLoginAgents: Array<{ agentId: string; name?: string; role: AgentRole }> = [];
  const conflicts: ReviewerGithubIdentityConflict[] = [];

  for (const agent of agents) {
    const labelLogin = agent.labels?.[GITHUB_LOGIN_LABEL];
    const fixture = findFixture(agent, fixtures);
    if (labelLogin && fixture && labelLogin !== fixture.githubLogin) {
      conflicts.push({
        agentId: agent.id,
        name: agent.name,
        role: agent.role,
        labelLogin,
        fixtureLogin: fixture.githubLogin,
        fixtureSourceRef: fixture.provenance.sourceRef,
      });
    }

    const githubLogin = labelLogin ?? fixture?.githubLogin;
    const source: ReviewerGithubIdentitySourceKind | undefined = labelLogin
      ? "hub-agent-label"
      : fixture
        ? "audited-static-fixture"
        : undefined;

    identities.push({
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      githubLogin,
    });
    identitySources.push({
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      githubLogin,
      source,
      sourceRef: source === "audited-static-fixture" ? fixture?.provenance.sourceRef : GITHUB_LOGIN_LABEL,
    });

    if (!githubLogin) {
      missingGithubLoginAgents.push({ agentId: agent.id, name: agent.name, role: agent.role });
    }
  }

  return {
    contractVersion: PR_REVIEWER_ELIGIBILITY_CONTRACT_VERSION,
    sourceVersion: PR_REVIEWER_IDENTITY_SOURCE_VERSION,
    labelKey: GITHUB_LOGIN_LABEL,
    identities,
    identitySources,
    sharedGithubLogins: groupByGithubLogin(identities),
    missingGithubLoginAgents,
    conflicts,
  };
}

/**
 * Cardinality-explicit GitHub login resolution for reviewer eligibility.
 * Consumers must branch on `shared_login` rather than routing to the first Hub
 * agent that happens to carry the login.
 */
export function resolveReviewerGithubLogin(
  projection: ReviewerGithubIdentityProjection,
  githubLogin: string,
): ReviewerGithubLoginResolution {
  const matches = projection.identities.filter((identity) => identity.githubLogin === githubLogin);
  if (matches.length === 0) return { status: "none", githubLogin, matchCount: 0 };
  if (matches.length === 1) {
    return { status: "unique", githubLogin, matchCount: 1, identity: matches[0] };
  }
  return { status: "shared_login", githubLogin, matchCount: matches.length, identities: matches };
}
