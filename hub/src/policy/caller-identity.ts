/**
 * Caller-identity resolver (Mission-24 idea-120 / task-305).
 *
 * Resolves the `EntityProvenance` for a `create_*` tool call from the
 * current `IPolicyContext`. The result is stamped onto newly-created
 * entities as their `createdBy` field.
 *
 * Resolution precedence:
 *   1. Session-registered agent — `role` from ctx, `agentId` from
 *      engineerRegistry.getAgentForSession(ctx.sessionId).agentId.
 *   2. Session-registered role only (no agent record yet — e.g. a
 *      create_* call arriving before an M18 handshake completes) —
 *      `role` from ctx, `agentId` = `anonymous-<role>` placeholder.
 *   3. No session identity at all — treated as a Hub-internal create
 *      (reaper, watchdog, backfill script) → `{role: "system",
 *      agentId: "hub-system"}`.
 *
 * The architect's thread-226 recommendation: default to `"system"` for
 * Hub-internal operations that aren't directly triggered by an agent,
 * rather than leaving the field null. This matches the null-gap
 * rejection from thread-225 (idea-120 triage).
 */

import type { IPolicyContext } from "./types.js";
import type { EntityProvenance } from "../state.js";

export const HUB_SYSTEM_PROVENANCE: EntityProvenance = {
  role: "system",
  agentId: "hub-system",
};

export async function resolveCreatedBy(ctx: IPolicyContext): Promise<EntityProvenance> {
  // mission-93 bug-168: resolve the role from the registry (the authoritative
  // registered role) first, falling back to ctx.role. ctx.role can be "unknown"
  // on some create_* paths even for a registered agent — a verifier's
  // create_idea stamped createdBy=system/hub-system because ctx.role wasn't
  // "verifier" there. getRole(sessionId) is the same authoritative source the
  // message author-derivation uses (bug-169).
  const registeredRole = ctx.stores.engineerRegistry.getRole(ctx.sessionId);
  const role =
    registeredRole && registeredRole !== "unknown"
      ? registeredRole
      : ctx.role && ctx.role !== "unknown"
        ? ctx.role
        : null;

  let agentId: string | null = null;
  try {
    const registry = ctx.stores.engineerRegistry as unknown as {
      getAgentForSession?: (sid: string) => Promise<{ id?: string } | null>;
    };
    if (typeof registry.getAgentForSession === "function") {
      const agent = await registry.getAgentForSession(ctx.sessionId);
      agentId = agent?.id ?? null;
    }
  } catch {
    // Registry lookup failure is non-fatal — caller gets a role-only
    // provenance (placeholder agentId) rather than a thrown exception.
    agentId = null;
  }

  if (role && agentId) return { role, agentId };
  if (role) return { role, agentId: `anonymous-${role}` };
  return HUB_SYSTEM_PROVENANCE;
}
