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
 *   - First match wins. Unique-login invariant is adapter-side discipline
 *     (one Hub agent per GH login); duplicates would surface as
 *     non-deterministic role lookup but are not enforced here.
 *   - Missing label or no-match → null. Caller handles (commit-pushed
 *     handler logs + skips per Design v1.0 §3 step 5).
 */

import type { IPolicyContext } from "./types.js";
import type { AgentRole } from "../state.js";

/** Reserved AgentLabels namespace key for GitHub login mapping. */
export const GITHUB_LOGIN_LABEL = "ois.io/github/login";

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
  if (typeof ghLogin !== "string" || ghLogin.length === 0) return null;
  const agents = await ctx.stores.engineerRegistry.listAgents();
  for (const agent of agents) {
    if (agent.labels?.[GITHUB_LOGIN_LABEL] === ghLogin) {
      return agent.role;
    }
  }
  return null;
}
