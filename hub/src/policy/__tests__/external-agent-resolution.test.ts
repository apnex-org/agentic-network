import { describe, expect, it } from "vitest";

import type { Agent, AgentRole } from "../../state.js";
import type { IPolicyContext } from "../types.js";
import { resolveUniqueAgentByLabel } from "../external-agent-resolution.js";
import {
  GITHUB_LOGIN_LABEL,
  lookupAgentByGhLoginUniqueState,
  lookupUniqueAgentByGhLogin,
  resolveGhLoginAgent,
} from "../repo-event-author-lookup.js";

function agent(id: string, role: AgentRole, labelValue?: string): Agent {
  return {
    id,
    name: id,
    role,
    labels: labelValue ? { [GITHUB_LOGIN_LABEL]: labelValue } : {},
  } as unknown as Agent;
}

function ctxWithAgents(agents: Agent[]): IPolicyContext {
  return {
    stores: {
      engineerRegistry: {
        listAgents: async () => agents,
      },
    },
    emit: async () => {},
    dispatch: async () => {},
    sessionId: "test-session",
    clientIp: "127.0.0.1",
    role: "system",
    internalEvents: [],
    metrics: { inc: () => {}, increment: () => {} },
  } as unknown as IPolicyContext;
}

async function resolve(labelValue: unknown, agents: Agent[], allowedRoles?: AgentRole[]) {
  return resolveUniqueAgentByLabel(ctxWithAgents(agents), {
    labelKey: GITHUB_LOGIN_LABEL,
    labelValue,
    identityKind: "github-login",
    allowedRoles,
  });
}

describe("resolveUniqueAgentByLabel — external identity cardinality", () => {
  it("empty or non-string label values resolve to none", async () => {
    expect(await resolve("", [agent("agent-greg", "engineer", "greg-gh")])).toEqual({
      status: "none",
      identityKind: "github-login",
      identityValue: "",
      matchCount: 0,
    });
    expect(await resolve(42, [agent("agent-greg", "engineer", "greg-gh")])).toEqual({
      status: "none",
      identityKind: "github-login",
      identityValue: "",
      matchCount: 0,
    });
  });

  it("no matching label resolves to none", async () => {
    expect(await resolve("missing-gh", [agent("agent-greg", "engineer", "greg-gh")])).toEqual({
      status: "none",
      identityKind: "github-login",
      identityValue: "missing-gh",
      matchCount: 0,
    });
  });

  it("one matching allowed-role agent resolves to unique", async () => {
    expect(await resolve("greg-gh", [agent("agent-greg", "engineer", "greg-gh")], ["engineer", "architect"])).toEqual({
      status: "unique",
      identityKind: "github-login",
      identityValue: "greg-gh",
      matchCount: 1,
      agent: { id: "agent-greg", name: "agent-greg", role: "engineer" },
    });
  });

  it("two matching allowed-role agents resolve to ambiguous with matched ids and no selected agent", async () => {
    const r = await resolve("shared-gh", [
      agent("agent-a", "engineer", "shared-gh"),
      agent("agent-b", "architect", "shared-gh"),
    ], ["engineer", "architect"]);

    expect(r).toEqual({
      status: "ambiguous",
      identityKind: "github-login",
      identityValue: "shared-gh",
      matchCount: 2,
      matchedAgentIds: ["agent-a", "agent-b"],
    });
    expect("agent" in r).toBe(false);
  });

  it("matching disallowed-role agent only resolves to none after role filter", async () => {
    expect(await resolve("director-gh", [agent("agent-director", "director", "director-gh")], ["engineer", "architect"])).toEqual({
      status: "none",
      identityKind: "github-login",
      identityValue: "director-gh",
      matchCount: 0,
    });
  });

  it("one allowed + one disallowed match resolves unique after role filter", async () => {
    expect(await resolve("mixed-gh", [
      agent("agent-director", "director", "mixed-gh"),
      agent("agent-greg", "engineer", "mixed-gh"),
    ], ["engineer", "architect"])).toEqual({
      status: "unique",
      identityKind: "github-login",
      identityValue: "mixed-gh",
      matchCount: 1,
      agent: { id: "agent-greg", name: "agent-greg", role: "engineer" },
    });
  });

  it("two allowed + one disallowed match resolves ambiguous over allowed ids only", async () => {
    expect(await resolve("mixed-shared-gh", [
      agent("agent-director", "director", "mixed-shared-gh"),
      agent("agent-greg", "engineer", "mixed-shared-gh"),
      agent("agent-lily", "architect", "mixed-shared-gh"),
    ], ["engineer", "architect"])).toEqual({
      status: "ambiguous",
      identityKind: "github-login",
      identityValue: "mixed-shared-gh",
      matchCount: 2,
      matchedAgentIds: ["agent-greg", "agent-lily"],
    });
  });
});

describe("GitHub-login wrappers delegate to cardinality-aware helper", () => {
  it("resolveGhLoginAgent preserves the shared cardinality shape", async () => {
    const r = await resolveGhLoginAgent(ctxWithAgents([
      agent("agent-a", "engineer", "shared-gh"),
      agent("agent-b", "engineer", "shared-gh"),
    ]), "shared-gh", { allowedRoles: ["engineer"] });

    expect(r).toMatchObject({
      status: "ambiguous",
      identityKind: "github-login",
      identityValue: "shared-gh",
      matchCount: 2,
      matchedAgentIds: ["agent-a", "agent-b"],
    });
  });

  it("legacy nullable compatibility wrapper returns only unique, never first-match on ambiguity", async () => {
    const ctx = ctxWithAgents([
      agent("agent-a", "engineer", "shared-gh"),
      agent("agent-b", "engineer", "shared-gh"),
    ]);

    expect(await lookupAgentByGhLoginUniqueState("shared-gh", ctx)).toMatchObject({ status: "ambiguous" });
    expect(await lookupUniqueAgentByGhLogin("shared-gh", ctx)).toBeNull();
  });
});
