/**
 * Repo-event author lookup primitive — mission-68 W1 + extidcard0.
 *
 * Translates a GitHub login string (external identity) through AgentLabels.
 * GitHub-login → specific Hub agent routing MUST use cardinality-explicit
 * resolution; first-match lookup is retained only for the legacy coarse
 * peer-role notification path.
 *
 * Per Design v1.0 §2.2 (engineer C4 + P2 ratification): AgentLabels
 * reserved-key approach with namespace `ois.io/github/login`. Avoids
 * Agent schema extension; uses existing routing infrastructure.
 *
 * Adapter responsibility: claude-plugin shim handshake reads
 * `OIS_GH_LOGIN` env (or resolves via git config) and emits in
 * `labels` at `register_role` (session-policy.ts assertIdentity path).
 *
 * Lookup semantics:
 *   - listAgents() rather than selectAgents(matchLabels) — selectAgents
 *     filters to online agents only, and repo-event facts must resolve even
 *     when the author is offline.
 *   - resolveGhLoginAgent / lookupAgentByGhLoginUniqueState are the safe
 *     cardinality-aware surfaces for direct `target.agentId` routing.
 *   - lookupRoleByGhLogin preserves legacy first-match role inference for
 *     broad peer-role notifications ONLY. It is NOT valid for direct agentId
 *     routing.
 */

import type { IPolicyContext } from "./types.js";
import type { AgentRole } from "../state.js";
import {
  resolveUniqueAgentByLabel,
  type ExternalAgentResolution,
} from "./external-agent-resolution.js";

/** Reserved AgentLabels namespace key for GitHub login mapping. */
export const GITHUB_LOGIN_LABEL = "ois.io/github/login";

export interface GhLoginAgentIdentity {
  agentId: string;
  name?: string;
  role: AgentRole;
}

export type GhLoginAgentLookupResult = ExternalAgentResolution;

function toGhLoginIdentity(agent: { id: string; name?: string; role: AgentRole }): GhLoginAgentIdentity {
  return {
    agentId: agent.id,
    name: agent.name,
    role: agent.role,
  };
}

/**
 * Legacy role-only first-match helper. Keep private so future direct-agent
 * routing cannot import an order-dependent GitHub-login → agent resolver.
 */
async function lookupFirstMatchAgentByGhLoginForRoleOnly(
  ghLogin: string,
  ctx: IPolicyContext,
): Promise<GhLoginAgentIdentity | null> {
  if (typeof ghLogin !== "string" || ghLogin.length === 0) return null;
  const agents = await ctx.stores.engineerRegistry.listAgents();
  for (const agent of agents) {
    if (agent.labels?.[GITHUB_LOGIN_LABEL] === ghLogin) {
      return toGhLoginIdentity(agent);
    }
  }
  return null;
}

/**
 * Resolve a GitHub login using the shared external-identity cardinality helper.
 * Only `status: "unique"` may feed a direct target.agentId route.
 */
export async function resolveGhLoginAgent(
  ctx: IPolicyContext,
  ghLogin: unknown,
  options: { allowedRoles?: AgentRole[] } = {},
): Promise<ExternalAgentResolution> {
  return resolveUniqueAgentByLabel(ctx, {
    labelKey: GITHUB_LOGIN_LABEL,
    labelValue: ghLogin,
    identityKind: "github-login",
    allowedRoles: options.allowedRoles,
  });
}

/** Compatibility wrapper: cardinality state for GitHub-login resolution. */
export async function lookupAgentByGhLoginUniqueState(
  ghLogin: string,
  ctx: IPolicyContext,
): Promise<GhLoginAgentLookupResult> {
  return resolveGhLoginAgent(ctx, ghLogin);
}

/** Compatibility wrapper: unique agent or null for no/ambiguous matches. */
export async function lookupUniqueAgentByGhLogin(
  ghLogin: string,
  ctx: IPolicyContext,
): Promise<GhLoginAgentIdentity | null> {
  const result = await lookupAgentByGhLoginUniqueState(ghLogin, ctx);
  return result.status === "unique"
    ? { agentId: result.agent.id, name: result.agent.name, role: result.agent.role }
    : null;
}

/**
 * Resolve a GitHub login string → registered Hub agent role for legacy
 * peer-role PR notifications. This path may first-match because it emits only
 * broad role/cohort notifications; it is NOT valid for direct `agentId`
 * routing.
 */
export async function lookupRoleByGhLogin(
  ghLogin: string,
  ctx: IPolicyContext,
): Promise<AgentRole | null> {
  return (await lookupFirstMatchAgentByGhLoginForRoleOnly(ghLogin, ctx))?.role ?? null;
}
