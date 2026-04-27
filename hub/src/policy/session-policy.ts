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

// ── Mission-62 W1+W2 Pass 4: get_agents pull primitive ────────────────
//
// One canonical tool. Replaces get_engineer_status as the routing-path
// projection per Design v1.0 §4.1. Sub-100ms p99 target on the routing
// hot-path (filter + default fields). [Any] role-callable per Q2=B+C+D.

type AgentFieldGroup = "identity" | "session" | "fsm" | "client" | "errors" | "all";

const ALL_FIELDS_EXPANDED: readonly AgentFieldGroup[] = ["identity", "session", "fsm", "client", "errors"] as const;
const DEFAULT_FIELD_GROUPS: readonly AgentFieldGroup[] = ["identity", "session", "fsm"] as const;

interface AgentProjection {
  // identity group
  id?: string;
  name?: string;
  role?: AgentRole;
  labels?: Record<string, string>;
  // session group
  sessionId?: string | null;
  sessionEpoch?: number;
  sessionStartedAt?: string | null;
  firstSeenAt?: string;
  lastSeenAt?: string;
  // fsm group
  livenessState?: string;
  activityState?: string;
  idleSince?: string | null;
  workingSince?: string | null;
  quotaBlockedUntil?: string | null;
  lastToolCallAt?: string | null;
  lastToolCallName?: string | null;
  currentMissionId?: string | null;
  currentTaskId?: string | null;
  currentThreadId?: string | null;
  // client group
  adapterVersion?: string;
  clientMetadata?: unknown;
  ipAddress?: string | null;
  restartCount?: number;
  // errors group
  recentErrors?: unknown[];
}

function expandFieldGroups(groups: readonly AgentFieldGroup[]): Set<AgentFieldGroup> {
  const out = new Set<AgentFieldGroup>();
  for (const g of groups) {
    if (g === "all") {
      for (const f of ALL_FIELDS_EXPANDED) out.add(f);
    } else {
      out.add(g);
    }
  }
  return out;
}

async function getAgents(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const filter = (args.filter as Record<string, unknown> | undefined) ?? {};
  const fieldsArg = args.fields as readonly AgentFieldGroup[] | undefined;
  const fieldGroups = expandFieldGroups(fieldsArg && fieldsArg.length > 0 ? fieldsArg : DEFAULT_FIELD_GROUPS);

  // Filter setup. selectAgents handles role + matchLabels; livenessState +
  // activityState + currentMissionId + agentId we filter post-fetch.
  const roleFilter = filter.role as AgentRole | AgentRole[] | undefined;
  const livenessFilter = filter.livenessState as string | string[] | undefined;
  const activityFilter = filter.activityState as string | string[] | undefined;
  const labelFilter = filter.label as Record<string, string> | undefined;
  const missionFilter = filter.currentMissionId as string | undefined;
  const agentIdFilter = filter.agentId as string | string[] | undefined;

  const roles: AgentRole[] | undefined = roleFilter
    ? (Array.isArray(roleFilter) ? roleFilter : [roleFilter])
    : undefined;
  const agentIdSet: Set<string> | null = agentIdFilter
    ? new Set(Array.isArray(agentIdFilter) ? agentIdFilter : [agentIdFilter])
    : null;

  // Pull all agents (selectAgents excludes archived + offline; we want the
  // full population for activityState filtering and self-introspection per
  // Design §4.1). Use listAgents which returns the full set.
  const agents = await ctx.stores.engineerRegistry.listAgents();
  const livenessAllow = livenessFilter
    ? new Set(Array.isArray(livenessFilter) ? livenessFilter : [livenessFilter])
    : null;
  const activityAllow = activityFilter
    ? new Set(Array.isArray(activityFilter) ? activityFilter : [activityFilter])
    : null;

  const results: AgentProjection[] = [];
  for (const a of agents) {
    if (a.archived) continue;
    if (roles && !roles.includes(a.role)) continue;
    if (livenessAllow && !livenessAllow.has(a.livenessState)) continue;
    if (activityAllow && !activityAllow.has(a.activityState)) continue;
    if (labelFilter && !labelsMatchAll(a.labels ?? {}, labelFilter)) continue;
    if (agentIdSet && !agentIdSet.has(a.engineerId)) continue;
    // currentMissionId filter: only match if we have a derived value (skip
    // until derivation is wired; for now no-match if filter set since stored
    // is always null per Design §11.1 derive-on-read).
    if (missionFilter) continue; // TODO(pass-4b): derivation

    const proj: AgentProjection = {};
    if (fieldGroups.has("identity")) {
      proj.id = a.engineerId;
      proj.name = a.name;
      proj.role = a.role;
      proj.labels = a.labels ?? {};
    }
    if (fieldGroups.has("session")) {
      proj.sessionId = a.currentSessionId;
      proj.sessionEpoch = a.sessionEpoch;
      proj.sessionStartedAt = a.sessionStartedAt;
      proj.firstSeenAt = a.firstSeenAt;
      proj.lastSeenAt = a.lastSeenAt;
    }
    if (fieldGroups.has("fsm")) {
      proj.livenessState = a.livenessState;
      proj.activityState = a.activityState;
      proj.idleSince = a.idleSince;
      proj.workingSince = a.workingSince;
      proj.quotaBlockedUntil = a.quotaBlockedUntil;
      proj.lastToolCallAt = a.lastToolCallAt;
      proj.lastToolCallName = a.lastToolCallName;
      // TODO(pass-4b): derive currentMissionId/TaskId/ThreadId from
      // task/thread stores per Design §11.1; for now null.
      proj.currentMissionId = null;
      proj.currentTaskId = null;
      proj.currentThreadId = null;
    }
    if (fieldGroups.has("client")) {
      proj.adapterVersion = a.adapterVersion;
      proj.clientMetadata = a.clientMetadata;
      proj.ipAddress = a.ipAddress;
      proj.restartCount = a.restartCount;
    }
    if (fieldGroups.has("errors")) {
      proj.recentErrors = a.recentErrors;
    }
    results.push(proj);
  }

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ count: results.length, agents: results }),
    }],
  };
}

function labelsMatchAll(labels: Record<string, string>, match: Record<string, string>): boolean {
  for (const [k, v] of Object.entries(match)) {
    if (labels[k] !== v) return false;
  }
  return true;
}

// ── Mission-62 W1+W2 Pass 3: signal_working_* + signal_quota_* tools ──
//
// Adapter signals tool-call boundaries + idea-109 quota-block transitions
// to the Hub. Hub mutates the agent's activity FSM. Per Design v1.0 §5.2,
// LLM-to-MCP-tool-call path doesn't enqueue items, so implicit-only
// (drain+completion-ack) inference would be blind to most tool calls;
// explicit signaling is required.

async function signalWorkingStarted(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const toolName = (args.toolName as string | undefined) ?? "";
  if (!toolName) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ ok: false, code: "invalid_args", message: "toolName required" }) }],
      isError: true,
    };
  }
  const self = await ctx.stores.engineerRegistry.getAgentForSession(ctx.sessionId);
  if (!self) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ ok: false, code: "no_session_identity", message: "no agent bound to session — call register_role first" }) }],
      isError: true,
    };
  }
  await ctx.stores.engineerRegistry.recordToolCallStart(self.engineerId, toolName);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ ok: true, agentId: self.engineerId, activityState: "online_working", toolName }) }],
  };
}

async function signalWorkingCompleted(_args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const self = await ctx.stores.engineerRegistry.getAgentForSession(ctx.sessionId);
  if (!self) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ ok: false, code: "no_session_identity", message: "no agent bound to session — call register_role first" }) }],
      isError: true,
    };
  }
  await ctx.stores.engineerRegistry.recordToolCallComplete(self.engineerId);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ ok: true, agentId: self.engineerId, activityState: "online_idle" }) }],
  };
}

async function signalQuotaBlocked(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const retryAfterSeconds = typeof args.retryAfterSeconds === "number" ? args.retryAfterSeconds : 0;
  if (retryAfterSeconds < 0) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ ok: false, code: "invalid_args", message: "retryAfterSeconds must be >= 0" }) }],
      isError: true,
    };
  }
  const self = await ctx.stores.engineerRegistry.getAgentForSession(ctx.sessionId);
  if (!self) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ ok: false, code: "no_session_identity", message: "no agent bound to session — call register_role first" }) }],
      isError: true,
    };
  }
  await ctx.stores.engineerRegistry.recordQuotaBlocked(self.engineerId, retryAfterSeconds);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ ok: true, agentId: self.engineerId, activityState: "online_quota_blocked", retryAfterSeconds }) }],
  };
}

async function signalQuotaRecovered(_args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const self = await ctx.stores.engineerRegistry.getAgentForSession(ctx.sessionId);
  if (!self) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ ok: false, code: "no_session_identity", message: "no agent bound to session — call register_role first" }) }],
      isError: true,
    };
  }
  await ctx.stores.engineerRegistry.recordQuotaRecovered(self.engineerId);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ ok: true, agentId: self.engineerId, activityState: "online_idle" }) }],
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

  // ── Mission-62 (M-Agent-Entity-Revisit) W1+W2 Pass 3 — activity FSM signaling ──

  router.register(
    "signal_working_started",
    "[Any] Mission-62: signal that this agent has started a tool call (transitions activityState to online_working). Adapter wraps each tool-call dispatch with this RPC before the call. Hub stamps lastToolCallAt + lastToolCallName + workingSince. Composes with future agent_state_changed SSE event (Pass 5).",
    {
      toolName: z.string().describe("The MCP tool name about to be invoked (for telemetry; e.g. 'create_thread_reply')."),
    },
    signalWorkingStarted,
  );

  router.register(
    "signal_working_completed",
    "[Any] Mission-62: signal that this agent's tool call has completed (transitions activityState to online_idle). Adapter wraps each tool-call dispatch with this RPC after the call. Hub stamps idleSince + clears workingSince. Composes with future agent_state_changed SSE event (Pass 5).",
    {},
    signalWorkingCompleted,
  );

  router.register(
    "signal_quota_blocked",
    "[Any] Mission-62 + idea-109 composability: signal that this agent has hit a quota / 429 backpressure response (transitions activityState to online_quota_blocked). Hub stamps quotaBlockedUntil = now + retryAfterSeconds * 1000. Routing peers prefer non-quota-blocked agents until quotaBlockedUntil elapses or signal_quota_recovered fires.",
    {
      retryAfterSeconds: z.number().describe("Server-supplied retry-after window in seconds; quotaBlockedUntil is computed as now + retryAfterSeconds * 1000."),
    },
    signalQuotaBlocked,
  );

  router.register(
    "signal_quota_recovered",
    "[Any] Mission-62 + idea-109 composability: signal that the quota-block has cleared early (transitions activityState back to online_idle). Hub clears quotaBlockedUntil. Optional — Hub auto-promotes online_quota_blocked → online_idle when quotaBlockedUntil elapses on next-touch even without this RPC.",
    {},
    signalQuotaRecovered,
  );

  router.register(
    "get_agents",
    "[Any] Mission-62 (M-Agent-Entity-Revisit): live-query the agent population with optional filters and a fields-projection. Replaces get_engineer_status as the routing-path projection. Self-introspectable (caller sees themselves). Default fields = identity+session+fsm (cheap routing path). Defers final tool-surface naming to idea-121.",
    {
      filter: z.object({
        role: z.union([
          z.enum(["engineer", "architect", "director"]),
          z.array(z.enum(["engineer", "architect", "director"])),
        ]).optional().describe("Filter by role; single or array."),
        livenessState: z.union([
          z.enum(["online", "degraded", "unresponsive", "offline"]),
          z.array(z.enum(["online", "degraded", "unresponsive", "offline"])),
        ]).optional().describe("Filter by ADR-017 liveness FSM state; single or array."),
        activityState: z.union([
          z.enum(["offline", "online_idle", "online_working", "online_quota_blocked", "online_paused"]),
          z.array(z.enum(["offline", "online_idle", "online_working", "online_quota_blocked", "online_paused"])),
        ]).optional().describe("Filter by mission-62 activity FSM state; single or array."),
        label: z.record(z.string(), z.string()).optional().describe("Match-all label filter."),
        currentMissionId: z.string().optional().describe("Filter by currently-active mission (derived). Not yet wired in Pass 4 — reserved."),
        agentId: z.union([z.string(), z.array(z.string())]).optional().describe("Filter by agent ID; single or array."),
      }).optional().describe("Multi-axis filter. All axes ANDed."),
      fields: z.array(z.enum(["identity", "session", "fsm", "client", "errors", "all"])).optional().describe("Field-projection groups: identity (id+name+role+labels), session (sessionId+sessionEpoch+sessionStartedAt+firstSeenAt+lastSeenAt), fsm (liveness+activity+idle/workingSince+lastToolCall+current*), client (adapterVersion+clientMetadata+ipAddress+restartCount), errors (recentErrors), or 'all' to expand to all groups. Default: identity+session+fsm."),
    },
    getAgents,
  );
}
