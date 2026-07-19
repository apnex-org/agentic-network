import { describe, expect, it } from "vitest";
import type { AgentRole } from "../../src/state.js";
import {
  GITHUB_LOGIN_LABEL,
} from "../../src/policy/repo-event-author-lookup.js";
import {
  PR_REVIEWER_IDENTITY_SOURCE_VERSION,
  projectReviewerGithubIdentities,
  resolveReviewerGithubLogin,
} from "../../src/policy/pr-reviewer-identity-source.js";

type TestAgent = {
  id: string;
  name: string;
  role: AgentRole;
  labels?: Record<string, string>;
};

function agent(id: string, name: string, role: AgentRole, githubLogin?: string): TestAgent {
  return {
    id,
    name,
    role,
    labels: githubLogin ? { [GITHUB_LOGIN_LABEL]: githubLogin } : {},
  };
}

const prodAgents = [
  agent("agent-0d2c690e", "greg", "engineer", "apnex-greg"),
  agent("agent-b9138194", "ruby", "engineer", "apnex-greg"),
  agent("agent-40903c59", "lily", "architect", "apnex-lily"),
  agent("agent-f148389d", "steve", "verifier"),
  agent("agent-b347db63", "steve-pitest", "verifier"),
];

describe("PR reviewer identity source", () => {
  it("projects GitHub reviewer identities from Hub labels plus audited v0 fallback", () => {
    const projection = projectReviewerGithubIdentities(prodAgents);

    expect(projection.sourceVersion).toBe(PR_REVIEWER_IDENTITY_SOURCE_VERSION);
    expect(projection.labelKey).toBe(GITHUB_LOGIN_LABEL);
    expect(projection.conflicts).toEqual([]);
    expect(projection.identities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agentId: "agent-0d2c690e", name: "greg", githubLogin: "apnex-greg" }),
        expect.objectContaining({ agentId: "agent-b9138194", name: "ruby", githubLogin: "apnex-greg" }),
        expect.objectContaining({ agentId: "agent-40903c59", name: "lily", githubLogin: "apnex-lily" }),
        expect.objectContaining({ agentId: "agent-f148389d", name: "steve", githubLogin: "apnex" }),
      ]),
    );

    expect(projection.identitySources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agentId: "agent-0d2c690e", source: "hub-agent-label" }),
        expect.objectContaining({ agentId: "agent-b9138194", source: "hub-agent-label" }),
        expect.objectContaining({ agentId: "agent-40903c59", source: "hub-agent-label" }),
        expect.objectContaining({ agentId: "agent-f148389d", source: "audited-static-fixture" }),
      ]),
    );
    expect(projection.identitySources.find((source) => source.agentId === "agent-f148389d")?.sourceRef).toBe(
      "docs/reports/pr-reviewer-eligibility0-behavior.md",
    );
  });

  it("keeps Greg/Ruby shared GitHub login semantics machine-readable", () => {
    const projection = projectReviewerGithubIdentities(prodAgents);

    expect(projection.sharedGithubLogins).toEqual([
      {
        githubLogin: "apnex-greg",
        agentIds: ["agent-0d2c690e", "agent-b9138194"],
        names: ["greg", "ruby"],
        roles: ["engineer"],
      },
    ]);

    const resolution = resolveReviewerGithubLogin(projection, "apnex-greg");
    expect(resolution.status).toBe("shared_login");
    expect(resolution.matchCount).toBe(2);
    if (resolution.status === "shared_login") {
      expect(resolution.identities.map((identity) => identity.agentId)).toEqual([
        "agent-0d2c690e",
        "agent-b9138194",
      ]);
    }
  });

  it("is cardinality explicit instead of first-match routing", () => {
    const projection = projectReviewerGithubIdentities(prodAgents);

    expect(resolveReviewerGithubLogin(projection, "apnex")).toEqual({
      status: "unique",
      githubLogin: "apnex",
      matchCount: 1,
      identity: expect.objectContaining({ agentId: "agent-f148389d", name: "steve" }),
    });
    expect(resolveReviewerGithubLogin(projection, "missing-login")).toEqual({
      status: "none",
      githubLogin: "missing-login",
      matchCount: 0,
    });
  });

  it("surfaces missing and conflicting identity facts rather than hiding them", () => {
    const projection = projectReviewerGithubIdentities([
      agent("agent-f148389d", "steve", "verifier", "apnex-other"),
      agent("agent-b347db63", "steve-pitest", "verifier"),
    ]);

    expect(projection.conflicts).toEqual([
      {
        agentId: "agent-f148389d",
        name: "steve",
        role: "verifier",
        labelLogin: "apnex-other",
        fixtureLogin: "apnex",
        fixtureSourceRef: "docs/reports/pr-reviewer-eligibility0-behavior.md",
      },
    ]);
    expect(projection.missingGithubLoginAgents).toEqual([
      { agentId: "agent-b347db63", name: "steve-pitest", role: "verifier" },
    ]);
  });
});
