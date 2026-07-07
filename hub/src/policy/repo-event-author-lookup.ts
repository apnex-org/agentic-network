/**
 * Repo-event author lookup primitive — mission-68 W1.
 *
 * Translates a GitHub login string → registered Hub agent → role
 * determination. Used by the commit-pushed handler (and forward by
 * idea-227 additional handlers) to route per-author cross-party
 * notifications based on the GH-side actor identity.
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
 *     filters to online agents only, and we need to resolve push-author
 *     identity even when the author is offline (architect-pushed-then-
 *     stepped-away common case).
 *   - lookupRoleByGhLogin preserves the legacy first-match behavior for
 *     existing peer-role notifications.
 *   - lookupUniqueAgentByGhLogin is the safe pinpoint identity primitive:
 *     it returns null unless exactly one registered Hub agent carries the
 *     login label. Use it when the dispatch target is a specific agentId.
 *   - Missing label or no-match → null. Caller handles (commit-pushed
 *     handler logs + skips per Design v1.0 §3 step 5).
 */

import type { IPolicyContext } from "./types.js";
import type { AgentRole } from "../state.js";

/** Reserved AgentLabels namespace key for GitHub login mapping. */
export const GITHUB_LOGIN_LABEL = "ois.io/github/login";

export interface GhLoginAgentIdentity {
  agentId: string;
  name?: string;
  role: AgentRole;
}

/**
 * Resolve a GitHub login string → registered Hub agent identity. Returns
 * null when no agent carries the login as its `ois.io/github/login`
 * label value.
 *
 * Keeps the historical listAgents() semantics from lookupRoleByGhLogin:
 * selectAgents() filters to online agents, but repo-event facts must be
 * routable to the responsible actor even when that actor is offline.
 */
function toGhLoginIdentity(agent: { id: string; name?: string; role: AgentRole }): GhLoginAgentIdentity {
  return {
    agentId: agent.id,
    name: agent.name,
    role: agent.role,
  };
}

export async function lookupAgentByGhLogin(
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
 * Resolve a GitHub login string → a UNIQUE registered Hub agent identity.
 * Returns null on no match OR duplicate matches, because an agentId-pinned
 * delivery must never guess between multiple agents sharing a GitHub login.
 */
export async function lookupUniqueAgentByGhLogin(
  ghLogin: string,
  ctx: IPolicyContext,
): Promise<GhLoginAgentIdentity | null> {
  if (typeof ghLogin !== "string" || ghLogin.length === 0) return null;
  const matches = (await ctx.stores.engineerRegistry.listAgents())
    .filter((agent) => agent.labels?.[GITHUB_LOGIN_LABEL] === ghLogin)
    .map(toGhLoginIdentity);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Resolve a GitHub login string → registered Hub agent role. Returns
 * null when no agent carries the login as its `ois.io/github/login`
 * label value, OR when the resolved agent's role is not one of the
 * canonical roles (defensive — Agent.role is enum-typed but this is
 * the load-bearing translation surface).
 */
export async function lookupRoleByGhLogin(
  ghLogin: string,
  ctx: IPolicyContext,
): Promise<AgentRole | null> {
  return (await lookupAgentByGhLogin(ghLogin, ctx))?.role ?? null;
}
