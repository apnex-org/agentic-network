/**
 * Mission-19: caller-labels resolver.
 * Returns the Agent.labels for the session bound to ctx, or {} if the
 * session has not yet completed the M18 handshake (legacy `register_role`).
 */

import type { IPolicyContext } from "./types.js";

export async function callerLabels(ctx: IPolicyContext): Promise<Record<string, string>> {
  const agent = await ctx.stores.engineerRegistry.getAgentForSession(ctx.sessionId);
  return agent?.labels ?? {};
}
