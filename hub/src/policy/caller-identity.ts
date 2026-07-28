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

/** How long a session may hold a role with no bound identity before the placeholder is refused.
 *  Generous on purpose: the enriched handshake normally lands within a second of the plain one, so
 *  this is orders of magnitude above the legitimate window and still far below the ~1h that made
 *  bug-398 an outage. Sized to be obviously-not-a-race, not to be tight. */
export const IDENTITY_HANDSHAKE_WINDOW_MS = 60_000;

/** work-592 — the refusal. Carries idea-671's six properties as CLASS-LEVEL constants (declared on
 *  the class, never composed at the throw site) so `error-envelope.ts` serialises them without the
 *  router having to know anything about identity. */
export class IdentityUnboundError extends Error {
  readonly errorKind = "identity.unbound";
  readonly transience = "permanent" as const;
  readonly rationale =
    "A principal with role authority and no bound identity escapes every per-agent control — quarantine, WIP cap and thrash accounting all key on agentId, and none of them can see a session with no registry row (bug-398 §6f).";
  // ⚠️ NO IN-BAND VERB IS PROMISED. `reset_session` was DEFERRED (idea-674), and naming a verb
  // that does not exist sends the caller to a wall while sounding helpful — bug-399's exact
  // failure mode, where the stall prompt recommends `block_work`. An honest ugly route beats an
  // invented clean one.
  readonly route =
    "This seat must be restarted OUT-OF-BAND. There is no in-band reset verb — it is deferred (idea-674). Retrying this call will not bind an identity.";
  readonly atomicity = "Nothing has been changed by this call — the refusal happens before any handler runs.";

  constructor(role: string, elapsedMs: number) {
    super(
      `refused: this session has role '${role}' but no bound identity, and the handshake window closed ${Math.round(elapsedMs / 1000)}s ago (limit ${Math.round(IDENTITY_HANDSHAKE_WINDOW_MS / 1000)}s). ` +
      `MECHANICS: role-only sessions are accepted ONLY while an enriched handshake is in flight. ` +
      `TRANSIENCE: PERMANENT for this session. ` +
      `ROUTE: restart this seat out-of-band; there is no in-band reset verb (idea-674).`,
    );
    this.name = "IdentityUnboundError";
  }
}

/** Duck-typed so the registry interface needs no churn — mirrors how `getAgentForSession` is
 *  reached below. A registry without the method leaves the window UNBOUNDED, i.e. exactly today's
 *  behaviour: this guard can only ever refuse where the substrate can actually date the window. */
function readIdentityWindowElapsedMs(ctx: IPolicyContext): number | null {
  const reg = ctx.stores.engineerRegistry as unknown as {
    identityWindowElapsedMs?: (sid: string) => number | null;
  };
  if (typeof reg.identityWindowElapsedMs !== "function") return null;
  try {
    return reg.identityWindowElapsedMs(ctx.sessionId);
  } catch {
    // A bookkeeping read must never convert into a refusal — fail OPEN to the placeholder,
    // which is the documented contract, rather than closed on an unrelated fault.
    return null;
  }
}

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

  // 🔴 work-592 / bug-398 — BOUND THE WINDOW. THE PLACEHOLDER IS NOT THE DEFECT.
  //
  // MECHANICS: `anonymous-<role>` is a DOCUMENTED contract (see the header, resolution
  // precedence 2) for the gap between the two handshake phases — plain `register_role` binds the
  // ROLE, the enriched call binds the IDENTITY. While that is in flight, role-without-agentId is
  // correct and self-clearing. What never existed was any check that the window had CLOSED, so
  // `handshake IN FLIGHT` and `handshake FAILED FOREVER` produced an identical principal.
  //
  // RATIONALE: a principal carrying full role authority and no identity escapes EVERY per-agent
  // control — quarantine, WIP cap and thrash accounting all key on `agentId`, and none of them
  // can see a session that has no registry row (bug-398 §6f). The refusal is what makes the
  // transient bounded instead of permanent.
  //
  // ⚠️ THIS ADDS A THROW. IT DOES NOT DELETE THE PLACEHOLDER BELOW. Deleting `anonymous-${role}`
  // would promote HUB_SYSTEM_PROVENANCE — a degraded seat would resolve as the Hub's own internal
  // principal, which is STRICTLY WORSE than the phantom. A ladder's last branch is the default for
  // everything above it that stops matching.
  if (role) {
    const elapsedMs = readIdentityWindowElapsedMs(ctx);
    if (elapsedMs !== null && elapsedMs > IDENTITY_HANDSHAKE_WINDOW_MS) {
      throw new IdentityUnboundError(role, elapsedMs);
    }
  }

  if (role) return { role, agentId: `anonymous-${role}` };
  return HUB_SYSTEM_PROVENANCE;
}
