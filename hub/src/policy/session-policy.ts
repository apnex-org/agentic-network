/**
 * Session Policy — Role registration, agent handshake, and engineer status.
 *
 * Tools: register_role (with optional M18 Agent payload), get_engineer_status,
 *        migrate_agent_queue (Architect-only admin).
 */

import { z } from "zod";
import type { PolicyRouter } from "./router.js";
import type { IPolicyContext, PolicyResult } from "./types.js";
import type { AgentRole, RegisterAgentPayload, AgentClientMetadata } from "../state.js";

// ── M18 Handshake: register_role ────────────────────────────────────

function coerceAgentRole(role: string): AgentRole | null {
  if (role === "engineer" || role === "architect" || role === "director") return role;
  return null;
}

async function registerRole(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const role = args.role as string;
  const sid = ctx.sessionId;
  const globalInstanceId = args.globalInstanceId as string | undefined;
  const clientMetadataArg = args.clientMetadata as AgentClientMetadata | undefined;
  const advisoryTags = args.advisoryTags as Record<string, unknown> | undefined;
  const labels = args.labels as Record<string, string> | undefined;

  // M18 path: the proxy sent the full Agent handshake payload.
  if (globalInstanceId && clientMetadataArg) {
    const tokenRole = coerceAgentRole(role);
    if (!tokenRole) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ ok: false, code: "role_mismatch", message: `Unknown role '${role}'` }),
        }],
        isError: true,
      };
    }
    const payload: RegisterAgentPayload = {
      globalInstanceId,
      role: tokenRole,
      clientMetadata: clientMetadataArg,
      advisoryTags: advisoryTags ?? {},
      // CP3 C5 (bug-16): pass labels through as-is. `undefined` means the caller
      // omitted labels on this handshake (store preserves stored set); a provided
      // object (including `{}`) is an explicit refresh signal.
      labels: labels,
    };
    // M-Session-Claim-Separation (mission-40) T2: protocol cutover.
    // register_role no longer claims a session. It calls assertIdentity
    // directly (passing sessionId so the binding is recorded for the
    // SSE-subscribe / first-tools/call auto-claim hooks to find later)
    // and returns sessionClaimed: false. Adapters call claim_session
    // explicitly when they intend to be the active session, or rely on
    // the back-compat auto-claim hooks (T2 §10 deprecation runway).
    //
    // Set sessionRoles for RBAC parity with the pre-T2 path.
    ctx.stores.engineerRegistry.setSessionRole(sid, tokenRole as "engineer" | "architect" | "director");
    const identity = await ctx.stores.engineerRegistry.assertIdentity(
      {
        globalInstanceId: payload.globalInstanceId,
        role: tokenRole,
        clientMetadata: payload.clientMetadata,
        advisoryTags: payload.advisoryTags,
        labels: payload.labels,
        receiptSla: payload.receiptSla,
        wakeEndpoint: payload.wakeEndpoint,
      },
      sid,
      ctx.clientIp,
    );
    if (!identity.ok) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ ok: false, code: identity.code, message: identity.message }),
        }],
        isError: true,
      };
    }
    // Read current sessionEpoch (as-observed, NOT incremented — adapters
    // must key on the new sessionClaimed field, NOT epoch delta, per
    // T2 brief §3 + anti-goal §7.5).
    const currentAgent = await ctx.stores.engineerRegistry.getAgent(identity.engineerId);
    const currentSessionEpoch = currentAgent?.sessionEpoch ?? 0;

    // Audit emissions — T2 emits ONLY agent_identity_asserted from this
    // path. The session-claim audits (agent_session_claimed +
    // agent_session_displaced + agent_session_implicit_claim) move to
    // the actual claim sites: claim_session tool handler, SSE-subscribe
    // hook, first-tools/call hook. Best-effort (failure does not block
    // the handshake response).
    try {
      await ctx.stores.audit.logEntry(
        "hub",
        "agent_identity_asserted",
        `Agent ${identity.engineerId} identity asserted (wasCreated=${identity.wasCreated})`,
        identity.engineerId,
      );
    } catch (err) {
      console.warn(`[session-policy] agent_identity_asserted audit write failed for ${identity.engineerId}: ${(err as Error).message ?? err}`);
    }
    // CP3 C5 (bug-16): preserved unchanged — emits when mutable handshake
    // fields refresh stored state on reconnect.
    if (identity.changedFields && identity.changedFields.length > 0) {
      const diffDetails = identity.changedFields.includes("labels")
        ? `changedFields=${identity.changedFields.join(",")} priorLabels=${JSON.stringify(identity.priorLabels ?? {})} newLabels=${JSON.stringify(identity.labels)}`
        : `changedFields=${identity.changedFields.join(",")}`;
      try {
        await ctx.stores.audit.logEntry(
          "hub",
          "agent_handshake_refreshed",
          `Agent ${identity.engineerId} handshake refreshed stored state: ${diffDetails}`,
          identity.engineerId,
        );
      } catch (err) {
        console.warn(`[session-policy] agent_handshake_refreshed audit write failed for ${identity.engineerId}: ${(err as Error).message ?? err}`);
      }
    }
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          ok: true,
          engineerId: identity.engineerId,
          // T2: currentSessionEpoch reflects as-observed value, NOT a
          // just-incremented value. Adapters must key on sessionClaimed
          // (next field), not epoch delta.
          sessionEpoch: currentSessionEpoch,
          // T2: NEW field. False from register_role; true only from
          // claim_session response. Adapters key on this to detect
          // "I am the active session for this identity".
          sessionClaimed: false,
          wasCreated: identity.wasCreated,
          clientMetadata: identity.clientMetadata,
          advisoryTags: identity.advisoryTags,
          labels: identity.labels,
          message: `Identity asserted for agent ${identity.engineerId} (no session claim — call claim_session to bind this session as the active one${identity.wasCreated ? ", newly created" : ""})`,
        }),
      }],
    };
  }

  // Legacy path: bare {role} call, backwards-compatible with @ois/hub-connection <= 1.3.0.
  // Records the role in the sessionRoles map for RBAC; no Agent entity is created.
  //
  // Mission-19 label routing requires an Agent entity (labels are persisted on
  // the Agent, not on the session). Warn loudly so callers that set `labels`
  // here notice the silent degradation and switch to the enriched M18 handshake.
  if (labels && Object.keys(labels).length > 0) {
    console.warn(
      `[session-policy] register_role(bare) received labels=${JSON.stringify(labels)} ` +
      `on sessionId=${sid} role=${role} but labels are only persisted via the enriched M18 handshake ` +
      `(globalInstanceId + clientMetadata). Dropping labels — caller will default to broadcast dispatch.`
    );
  }
  ctx.stores.engineerRegistry.setSessionRole(sid, role as "engineer" | "architect");
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        success: true,
        role,
        sessionId: sid,
        message: `Registered as ${role}`,
      }),
    }],
  };
}

// ── M-Session-Claim-Separation (mission-40) T2: claim_session ──────

async function claimSessionTool(_args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const sid = ctx.sessionId;
  // Look up the agent bound to this session. After register_role, the
  // session→engineerId binding is recorded by assertIdentity (T2 sig
  // extension) so getAgentForSession returns the asserted-identity
  // agent even though no claim has happened yet.
  const agent = await ctx.stores.engineerRegistry.getAgentForSession(sid);
  if (!agent) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          ok: false,
          code: "no_identity_asserted",
          message: "claim_session: no identity bound to this session — call register_role first to assert identity",
        }),
      }],
      isError: true,
    };
  }
  const claim = await ctx.stores.engineerRegistry.claimSession(agent.engineerId, sid, "explicit");
  if (!claim.ok) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ ok: false, code: claim.code, message: claim.message }),
      }],
      isError: true,
    };
  }
  // Audit emissions for the explicit claim path.
  try {
    await ctx.stores.audit.logEntry(
      "hub",
      "agent_session_claimed",
      `Agent ${claim.engineerId} session claimed (trigger=explicit, epoch=${claim.sessionEpoch})`,
      claim.engineerId,
    );
  } catch (err) {
    console.warn(`[session-policy] agent_session_claimed audit write failed for ${claim.engineerId}: ${(err as Error).message ?? err}`);
  }
  if (claim.displacedPriorSession) {
    try {
      await ctx.stores.audit.logEntry(
        "hub",
        "agent_session_displaced",
        `Agent ${claim.engineerId} session displaced (priorSessionId=${claim.displacedPriorSession.sessionId}, priorEpoch=${claim.displacedPriorSession.epoch}, newEpoch=${claim.sessionEpoch}, trigger=explicit)`,
        claim.engineerId,
      );
    } catch (err) {
      console.warn(`[session-policy] agent_session_displaced audit write failed for ${claim.engineerId}: ${(err as Error).message ?? err}`);
    }
  }
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        ok: true,
        engineerId: claim.engineerId,
        sessionEpoch: claim.sessionEpoch,
        sessionClaimed: true,
        ...(claim.displacedPriorSession ? { displacedPriorSession: claim.displacedPriorSession } : {}),
        message: `Session claimed for agent ${claim.engineerId} (epoch=${claim.sessionEpoch}${claim.displacedPriorSession ? `, displaced prior session ${claim.displacedPriorSession.sessionId} epoch=${claim.displacedPriorSession.epoch}` : ""})`,
      }),
    }],
  };
}

async function migrateAgentQueue(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const sourceEngineerId = args.sourceEngineerId as string;
  const targetEngineerId = args.targetEngineerId as string;
  const result = await ctx.stores.engineerRegistry.migrateAgentQueue(sourceEngineerId, targetEngineerId);
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        ok: true,
        sourceEngineerId,
        targetEngineerId,
        moved: result.moved,
        message: `Moved ${result.moved} pending notifications from ${sourceEngineerId} to ${targetEngineerId}`,
      }),
    }],
  };
}

async function getEngineerStatus(_args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const summary = await ctx.stores.engineerRegistry.getStatusSummary();
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(summary, null, 2),
    }],
  };
}

// ── list_available_peers (M24-T8, ADR-014) ─────────────────────────
// Pruned projection for LLM consumption during thread opening. Unlike
// get_engineer_status (connection counts, timestamps, sessionEpoch),
// this returns only what the caller needs to decide "open a thread to
// whom": agentId + role + labels. Honours the existing selectAgents
// selector (role + matchLabels equality). Excludes the caller's own
// agentId — self-threads are a bug, not a feature.
async function listAvailablePeers(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const role = args.role as AgentRole | undefined;
  const matchLabels = args.matchLabels as Record<string, string> | undefined;

  const agents = await ctx.stores.engineerRegistry.selectAgents({
    roles: role ? [role] : undefined,
    matchLabels,
  });

  const self = await ctx.stores.engineerRegistry.getAgentForSession(ctx.sessionId);
  const selfId = self?.engineerId;
  const peers = agents
    .filter((a) => a.engineerId !== selfId)
    .map((a) => ({
      agentId: a.engineerId,
      role: a.role,
      labels: a.labels ?? {},
    }));

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ count: peers.length, peers }),
    }],
  };
}

// ── Registration ────────────────────────────────────────────────────

export function registerSessionPolicy(router: PolicyRouter): void {
  router.register(
    "register_role",
    "[Any] Register this session's role and, optionally (M18), the full Agent handshake payload (globalInstanceId, clientMetadata, advisoryTags) to obtain a stable engineerId with displacement-safe session rebinding.",
    {
      role: z.enum(["engineer", "architect", "director"]).describe("The role of this session: 'engineer', 'architect', or 'director'"),
      globalInstanceId: z.string().optional().describe("M18: Client-side stable UUID from ~/.ois/instance.json. When present, triggers the Agent handshake path."),
      clientMetadata: z
        .object({
          clientName: z.string(),
          clientVersion: z.string(),
          proxyName: z.string(),
          proxyVersion: z.string(),
          transport: z.string().optional(),
          sdkVersion: z.string().optional(),
          hostname: z.string().optional(),
          platform: z.string().optional(),
          pid: z.number().optional(),
        })
        .optional()
        .describe("M18: Mutable metadata about the client driving this session."),
      advisoryTags: z.record(z.string(), z.unknown()).optional().describe("M18: Launch-time-only tags (e.g., llmModel). Explicitly drift-prone; do NOT route on these values."),
      labels: z.record(z.string(), z.string()).optional().describe("Mission-19: routing labels (e.g., {env: 'smoke-test', team: 'billing'}). CP3 C5 (bug-16): refreshed on every reconnect from the handshake payload — a provided object overwrites stored labels; omitting labels preserves the stored set. Reserved key 'ois.io/namespace' has no v1 semantics."),
    },
    registerRole,
  );

  router.register(
    "claim_session",
    "[Any] M-Session-Claim-Separation (mission-40) T2: explicit session claim. Binds the caller's MCP session as the active session for the asserted identity (created via register_role). Increments sessionEpoch, evicts any prior session for the same engineerId, makes the agent eligible for SSE notification dispatch. Returns sessionClaimed=true. The verb 'claim_session' is committed as stable across future API v2.0 envelope migration (idea-121 may wrap but must not rename). Probes (claude mcp list) MUST NOT call this tool — that defeats the bug-26 structural fix. Use only when the caller intends to be the active session.",
    {},
    claimSessionTool,
  );

  router.register(
    "get_engineer_status",
    "[Any] Get the connection status of all registered Engineers, including their IDs, connection times, and task completion counts.",
    {},
    getEngineerStatus,
  );

  router.register(
    "list_available_peers",
    "[Any] Lean projection of online agents for thread opening. Returns {agentId, role, labels} per match. Use this — not get_engineer_status — when deciding who to open a thread to. Caller's own agentId is excluded.",
    {
      role: z.enum(["engineer", "architect", "director"]).optional().describe("Filter by role. Omit to return peers across all roles."),
      matchLabels: z.record(z.string(), z.string()).optional().describe("Match-all label filter: only agents whose labels include every provided key=value pair."),
    },
    listAvailablePeers,
  );

  router.register(
    "migrate_agent_queue",
    "[Architect] M18 admin: move pending notifications from a source engineerId to a target engineerId (used for 'my laptop died, new globalInstanceId' recovery). Agents are append-only and are never deleted.",
    {
      sourceEngineerId: z.string().describe("Engineer ID whose queue should be drained"),
      targetEngineerId: z.string().describe("Engineer ID to receive the pending notifications"),
    },
    migrateAgentQueue,
  );
}
