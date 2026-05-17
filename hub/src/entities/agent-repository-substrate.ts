/**
 * mission-83 W4.x.1 — AgentRepositorySubstrate
 *
 * Substrate-API version of AgentRepository (mission-47 W7b origin). Per Design v1.3
 * §5.1 Option Y disposition (B) sibling-pattern:
 * - Existing agent-repository.ts UNTOUCHED at production
 * - This substrate-version SIBLING exists alongside as pure-additive code
 * - Implements same IEngineerRegistry interface (handler call-sites UNCHANGED)
 * - Hub bootstrap continues to instantiate existing repository at production
 *   until W5 cutover swaps instantiation
 * - W6 deletes the existing agent-repository.ts FS-version sibling
 *
 * Per-entity logic preserved byte-for-byte:
 *   - In-memory bookkeeping: sessionRoles + displacementHistory + sessionToEngineerId
 *     + lastTouchAt (wipes on Hub restart, identical to legacy)
 *   - Defensive normalization: normalizeAgentShape (read-side) + applyLivenessRecompute
 *     (read-time liveness recompute per INV-COMMS-L03 / INV-AG6)
 *   - selectAgents predicates: isPeerPresent (cognitive) + isAgentReachable (transport
 *     per bug-56 mission-225 v1.0 §3.3 separation)
 *   - Mission-75 v1.0 eager-recompute: computeComponentStates folded into single
 *     CAS write per F1 write-amp consideration
 *
 * FS-layout → substrate-layout translation:
 *   agents/<agentId>.json          → substrate(kind="Agent", id=agentId)
 *   agents/by-fingerprint/<fp>.json → REMOVED (replaced by substrate.list with
 *                                    fingerprint-indexed filter; SchemaDef.agent_fingerprint_idx
 *                                    is the index per Agent SchemaDef v2)
 *   provider.getWithToken(path)    → substrate.getWithRevision(kind, id)  (Design v1.4)
 *   provider.createOnly(path,...)  → substrate.createOnly(kind, entity)
 *   provider.putIfMatch(path,...)  → substrate.putIfMatch(kind, entity, expectedRevision)
 *   provider.put(path,...)         → substrate.put(kind, entity)  (unconditional)
 *   provider.get(path)             → substrate.get(kind, id)
 *   provider.list("agents/")       → substrate.list(kind, {filter}).items
 *   provider.delete(path)          → substrate.delete(kind, id)
 *
 * W4.x.1 — second-slice of W4.x sweep (W4 spike-class BugRepositorySubstrate at
 * commit 234c929 was the pattern-demonstrator). 11 remaining existing-sibling
 * substrate-versions follow this pattern (Audit/Idea/Message/Mission/PendingAction/
 * Proposal/Task/Tele/Thread/Turn).
 */

import type { HubStorageSubstrate } from "../storage-substrate/index.js";
import type {
  IEngineerRegistry,
  Agent,
  AgentAdvisoryTags,
  AgentClientMetadata,
  AgentLivenessState,
  AgentRole,
  EngineerStatusEntry,
  RegisterAgentPayload,
  RegisterAgentResult,
  AssertIdentityPayload,
  AssertIdentityResult,
  ClaimSessionResult,
  ClaimSessionTrigger,
  SessionRole,
  Selector,
  ActivityState,
  AgentErrorRecord,
} from "../state.js";
import {
  labelsMatch,
  AGENT_TOUCH_MIN_INTERVAL_MS,
  DEFAULT_AGENT_RECEIPT_SLA_MS,
  computeFingerprint,
  deriveAgentId,
  THRASHING_THRESHOLD,
  THRASHING_WINDOW_MS,
  recordDisplacementAndCheck,
  shallowEqualLabels,
  computeLivenessState,
  AGENT_RECENT_ERRORS_CAP,
  PEER_PRESENCE_WINDOW_MS_DEFAULT,
  resolveLivenessConfig,
  computeComponentStates,
} from "../state.js";

const KIND = "Agent";
const MAX_CAS_RETRIES = 50;

// ─── Defensive normalization (ported from agent-repository.ts) ──────────────

/**
 * ADR-017 + Mission-62 defensive normalization — legacy Agent blobs lacking
 * the liveness-layer (ADR-017) or mission-62 activity-layer fields get sane
 * defaults on read. Ported byte-for-byte from agent-repository.ts.
 */
function normalizeAgentShape(a: Agent): Agent {
  if (!a) return a;
  const raw = a as unknown as Record<string, unknown>;
  const now = (raw.lastSeenAt as string | undefined)
    ?? (raw.firstSeenAt as string | undefined)
    ?? new Date(0).toISOString();
  const livenessState = (a.livenessState as AgentLivenessState | undefined)
    ?? (a.status === "online" ? "online" : "offline");
  // Mission-62 auto-clamp invariant (Design v1.0 §3.3): when liveness !== online,
  // activityState clamps to "offline" regardless of stored value.
  const storedActivity = raw.activityState as ActivityState | undefined;
  const activityState: ActivityState = livenessState !== "online"
    ? "offline"
    : (storedActivity ?? "online_idle");
  return {
    ...a,
    labels: a.labels ?? {},
    livenessState,
    lastHeartbeatAt: a.lastHeartbeatAt ?? now,
    receiptSla: typeof a.receiptSla === "number" ? a.receiptSla : DEFAULT_AGENT_RECEIPT_SLA_MS,
    wakeEndpoint: typeof a.wakeEndpoint === "string" ? a.wakeEndpoint : null,
    name: typeof a.name === "string" ? a.name : a.id,
    activityState,
    sessionStartedAt: typeof a.sessionStartedAt === "string" ? a.sessionStartedAt : null,
    lastToolCallAt: typeof a.lastToolCallAt === "string" ? a.lastToolCallAt : null,
    lastToolCallName: typeof a.lastToolCallName === "string" ? a.lastToolCallName : null,
    idleSince: typeof a.idleSince === "string" ? a.idleSince : null,
    workingSince: typeof a.workingSince === "string" ? a.workingSince : null,
    quotaBlockedUntil: typeof a.quotaBlockedUntil === "string" ? a.quotaBlockedUntil : null,
    adapterVersion: typeof a.adapterVersion === "string"
      ? a.adapterVersion
      : (a.clientMetadata?.sdkVersion ?? ""),
    ipAddress: typeof a.ipAddress === "string" ? a.ipAddress : null,
    restartCount: typeof a.restartCount === "number" ? a.restartCount : 0,
    recentErrors: Array.isArray(a.recentErrors)
      ? (a.recentErrors as AgentErrorRecord[])
      : [],
    restartHistoryMs: Array.isArray(a.restartHistoryMs)
      ? (a.restartHistoryMs as number[])
      : [],
    cognitiveTTL: typeof a.cognitiveTTL === "number" ? a.cognitiveTTL : null,
    transportTTL: typeof a.transportTTL === "number" ? a.transportTTL : null,
    cognitiveState: isComponentState(a.cognitiveState) ? a.cognitiveState : "unknown",
    transportState: isComponentState(a.transportState) ? a.transportState : "unknown",
    ...(isAgentLivenessConfig(a.livenessConfig) ? { livenessConfig: a.livenessConfig } : {}),
    ...(isAgentPulseConfig(a.pulseConfig) ? { pulseConfig: a.pulseConfig } : {}),
  } as Agent;
}

function isComponentState(v: unknown): v is "alive" | "unresponsive" | "unknown" {
  return v === "alive" || v === "unresponsive" || v === "unknown";
}

function isAgentLivenessConfig(v: unknown): v is import("../state.js").AgentLivenessConfig {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  const numericOk = (k: string) => o[k] === undefined || typeof o[k] === "number";
  const boolOk = (k: string) => o[k] === undefined || typeof o[k] === "boolean";
  return numericOk("peerPresenceWindowMs")
    && numericOk("agentTouchMinIntervalMs")
    && numericOk("transportHeartbeatIntervalMs")
    && boolOk("transportHeartbeatEnabled");
}

function isAgentPulseConfig(v: unknown): v is import("../state.js").AgentPulseConfig {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.intervalSeconds === "number"
    && typeof o.message === "string"
    && o.responseShape === "ack"
    && typeof o.missedThreshold === "number"
    && typeof o.enabled === "boolean"
    && (o.lastFiredAt === null || typeof o.lastFiredAt === "string");
}

/**
 * Read-time liveness recompute (INV-COMMS-L03 / INV-AG6). Ported byte-for-byte
 * from agent-repository.ts.
 */
function applyLivenessRecompute(a: Agent, nowMs: number): Agent {
  const livenessState = computeLivenessState(a, nowMs);
  return {
    ...a,
    livenessState,
    status: livenessState === "online" ? "online" : "offline",
  };
}

/**
 * bug-56: TRANSPORT-tier reachability predicate (vs cognitive-tier isPeerPresent).
 * Ported from agent-repository.ts. Used by selectAgents for routing-eligibility.
 */
function isAgentReachable(a: Agent, nowMs: number): boolean {
  if (a.archived) return false;
  if (a.livenessState === "offline") return false;
  if (!a.lastHeartbeatAt) return false;
  const lastHeartbeatMs = Date.parse(a.lastHeartbeatAt);
  if (!Number.isFinite(lastHeartbeatMs)) return false;
  const windowMs = resolveLivenessConfig(a, "peerPresenceWindowMs", PEER_PRESENCE_WINDOW_MS_DEFAULT);
  return nowMs - lastHeartbeatMs <= windowMs;
}

/**
 * mission-66 #40 closure: Hub-side canonical projection for advisoryTags.
 * Ported byte-for-byte from agent-repository.ts.
 */
function deriveAdvisoryTags(
  incoming: AgentAdvisoryTags | undefined | null,
  clientMetadata: AgentClientMetadata | undefined | null,
): AgentAdvisoryTags {
  const base: AgentAdvisoryTags = { ...(incoming ?? {}) };
  if (base.adapterVersion === undefined && clientMetadata?.proxyVersion) {
    base.adapterVersion = clientMetadata.proxyVersion;
  }
  if (base.proxyCommitSha === undefined && clientMetadata?.proxyCommitSha) {
    base.proxyCommitSha = clientMetadata.proxyCommitSha;
  }
  if (base.proxyDirty === undefined && clientMetadata?.proxyDirty !== undefined) {
    base.proxyDirty = clientMetadata.proxyDirty;
  }
  if (base.sdkCommitSha === undefined && clientMetadata?.sdkCommitSha) {
    base.sdkCommitSha = clientMetadata.sdkCommitSha;
  }
  if (base.sdkDirty === undefined && clientMetadata?.sdkDirty !== undefined) {
    base.sdkDirty = clientMetadata.sdkDirty;
  }
  return base;
}

export class AgentRepositorySubstrate implements IEngineerRegistry {
  private readonly sessionRoles = new Map<string, SessionRole>();
  // In-memory bookkeeping (wipes on Hub restart, identical to legacy).
  private readonly displacementHistory = new Map<string, number[]>();
  private readonly sessionToEngineerId = new Map<string, string>();
  private readonly lastTouchAt = new Map<string, number>();

  constructor(private readonly substrate: HubStorageSubstrate) {}

  // ── Session role (SessionRole) in-memory bookkeeping ───────────────

  setSessionRole(sessionId: string, role: SessionRole): void {
    this.sessionRoles.set(sessionId, role);
  }

  getRole(sessionId: string): SessionRole {
    return this.sessionRoles.get(sessionId) || "unknown";
  }

  async getStatusSummary() {
    const agents = await this.listAgents();
    const engineers: EngineerStatusEntry[] = agents
      .filter((a) => !a.archived)
      .map((a) => ({
        agentId: a.id,
        sessionId: a.currentSessionId,
        status: a.status,
        sessionEpoch: a.sessionEpoch,
        clientMetadata: a.clientMetadata,
        advisoryTags: a.advisoryTags,
        labels: a.labels ?? {},
        firstSeenAt: a.firstSeenAt,
        lastSeenAt: a.lastSeenAt,
      }));
    const connected = engineers.filter((e) => e.status === "online").length;
    return { connected, engineers };
  }

  // ── M18 Agent methods ──────────────────────────────────────────────

  async registerAgent(
    sessionId: string,
    tokenRole: AgentRole,
    payload: RegisterAgentPayload,
    address?: string,
  ): Promise<RegisterAgentResult> {
    this.sessionRoles.set(sessionId, tokenRole as SessionRole);

    const identity = await this.assertIdentity(
      {
        name: payload.name,
        role: tokenRole,
        clientMetadata: payload.clientMetadata,
        advisoryTags: payload.advisoryTags,
        labels: payload.labels,
        receiptSla: payload.receiptSla,
        wakeEndpoint: payload.wakeEndpoint,
      },
      sessionId,
      address,
    );
    if (!identity.ok) {
      return identity as RegisterAgentResult;
    }
    const claim = await this.claimSession(identity.agentId, sessionId, "sse_subscribe");
    if (!claim.ok) {
      if (claim.code === "unknown_engineer") {
        throw new Error(
          `Internal invariant violation: assertIdentity wrote ${identity.agentId} but claimSession could not read it`,
        );
      }
      return { ok: false, code: claim.code, message: claim.message };
    }
    return {
      ok: true,
      agentId: claim.agentId,
      sessionEpoch: claim.sessionEpoch,
      wasCreated: identity.wasCreated,
      clientMetadata: identity.clientMetadata,
      advisoryTags: identity.advisoryTags,
      labels: identity.labels,
      ...(identity.changedFields ? { changedFields: identity.changedFields } : {}),
      ...(identity.priorLabels ? { priorLabels: identity.priorLabels } : {}),
      ...(claim.displacedPriorSession ? { displacedPriorSession: claim.displacedPriorSession } : {}),
    };
  }

  /**
   * idea-251 D-prime Phase 2 + Design v1.4 §2.1 getWithRevision.
   *
   * FS-version uses agents/by-fingerprint/<fp>.json mirror for identity lookup.
   * Substrate-version uses substrate.list({filter: {fingerprint}}) backed by
   * agent_fingerprint_idx (Agent SchemaDef v2). Single canonical row per agentId;
   * no mirror dual-write.
   */
  async assertIdentity(
    payload: AssertIdentityPayload,
    sessionId?: string,
    _address?: string,
  ): Promise<AssertIdentityResult> {
    if (!payload.name) {
      return {
        ok: false,
        code: "role_mismatch",
        message: "name required for assertIdentity (idea-251 D-prime: identity input is OIS_AGENT_NAME via M18 handshake)",
      };
    }
    const fingerprint = computeFingerprint(payload.name);

    // Two attempts: natural + retry on OCC contention. Matches legacy budget.
    for (let attempt = 0; attempt < 2; attempt++) {
      // Lookup by fingerprint via substrate.list with indexed filter
      const { items } = await this.substrate.list<Agent>(KIND, {
        filter: { fingerprint },
        limit: 1,
      });
      const existingAgent = items[0] ?? null;
      const now = new Date().toISOString();

      if (!existingAgent) {
        // First-contact create.
        const agentId = deriveAgentId(payload.name);
        const advisoryTagsWithAdapterVersion = deriveAdvisoryTags(
          payload.advisoryTags,
          payload.clientMetadata,
        );
        const agent: Agent = {
          id: agentId,
          fingerprint,
          role: payload.role,
          status: "offline",
          archived: false,
          sessionEpoch: 0,
          currentSessionId: null,
          clientMetadata: payload.clientMetadata,
          advisoryTags: advisoryTagsWithAdapterVersion,
          labels: payload.labels ?? {},
          firstSeenAt: now,
          lastSeenAt: now,
          livenessState: "offline",
          lastHeartbeatAt: now,
          receiptSla: payload.receiptSla ?? DEFAULT_AGENT_RECEIPT_SLA_MS,
          wakeEndpoint: payload.wakeEndpoint ?? null,
          name: payload.name,
          activityState: "offline",
          sessionStartedAt: null,
          lastToolCallAt: null,
          lastToolCallName: null,
          idleSince: null,
          workingSince: null,
          quotaBlockedUntil: null,
          adapterVersion: payload.clientMetadata?.sdkVersion ?? "",
          ipAddress: null,
          restartCount: 0,
          recentErrors: [],
          restartHistoryMs: [],
          cognitiveTTL: null,
          transportTTL: null,
          cognitiveState: "unknown",
          transportState: "unknown",
        };
        const created = await this.substrate.createOnly(KIND, agent);
        if (!created.ok) {
          // Lost the create race — retry on the lookup-path this iteration.
          continue;
        }
        if (sessionId) {
          this.sessionToEngineerId.set(sessionId, agentId);
        }
        console.log(`[AgentRepositorySubstrate] Agent identity asserted (created): ${agentId}`);
        return {
          ok: true,
          agentId,
          wasCreated: true,
          clientMetadata: agent.clientMetadata,
          advisoryTags: agent.advisoryTags,
          labels: agent.labels,
        };
      }

      // Re-fetch with revision for CAS-safe update path
      const existing = await this.substrate.getWithRevision<Agent>(KIND, existingAgent.id);
      if (!existing) {
        // Race with delete; retry the lookup
        continue;
      }
      const agent = normalizeAgentShape(existing.entity);

      // Role mismatch = hard security boundary.
      if (agent.role !== payload.role) {
        return {
          ok: false,
          code: "role_mismatch",
          message: `Token role '${payload.role}' does not match persisted agent role '${agent.role}' for agentId=${agent.id}`,
        };
      }

      // idea-251 D-prime Phase 2: name-collision detection.
      const priorHost = agent.clientMetadata?.hostname;
      const newHost = payload.clientMetadata?.hostname;
      if (priorHost && newHost && priorHost !== newHost) {
        return {
          ok: false,
          code: "name_collision",
          message: `Agent '${payload.name}' already registered from host '${priorHost}'; cannot re-register from host '${newHost}'. Rename this instance (set OIS_AGENT_NAME differently) or stop the other instance.`,
        };
      }

      // CP3 C5 (bug-16): labels refresh path.
      const priorLabels = agent.labels ?? {};
      const nextLabels = payload.labels ?? priorLabels;
      const labelsChanged = !shallowEqualLabels(priorLabels, nextLabels);
      const refreshedAdvisoryTags = deriveAdvisoryTags(
        payload.advisoryTags ?? agent.advisoryTags,
        payload.clientMetadata,
      );
      const stamped: Agent = {
        ...agent,
        clientMetadata: payload.clientMetadata,
        advisoryTags: refreshedAdvisoryTags,
        labels: nextLabels,
        // bug-55 Tier 2 — transport-tier bump on reconnect; do NOT bump lastSeenAt.
        lastHeartbeatAt: now,
        receiptSla: payload.receiptSla ?? agent.receiptSla ?? DEFAULT_AGENT_RECEIPT_SLA_MS,
        wakeEndpoint: payload.wakeEndpoint ?? agent.wakeEndpoint ?? null,
      };
      const updated: Agent = { ...stamped, ...computeComponentStates(stamped, Date.parse(now)) };

      const result = await this.substrate.putIfMatch(KIND, updated, existing.resourceVersion);
      if (!result.ok) {
        // OCC lost — retry.
        continue;
      }
      if (sessionId) {
        this.sessionToEngineerId.set(sessionId, updated.id);
      }
      const changedFields: ("labels" | "advisoryTags" | "clientMetadata")[] = [];
      if (labelsChanged) changedFields.push("labels");
      return {
        ok: true,
        agentId: updated.id,
        wasCreated: false,
        clientMetadata: updated.clientMetadata,
        advisoryTags: updated.advisoryTags,
        labels: updated.labels,
        ...(changedFields.length > 0 ? { changedFields } : {}),
        ...(labelsChanged ? { priorLabels } : {}),
      };
    }

    // Both attempts lost the OCC race.
    return {
      ok: false,
      code: "role_mismatch",
      message: `OCC contention exceeded retry budget on assertIdentity for fingerprint=${fingerprint}; likely concurrent registration storm.`,
    };
  }

  async claimSession(
    agentId: string,
    sessionId: string,
    trigger: ClaimSessionTrigger,
  ): Promise<ClaimSessionResult> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = await this.substrate.getWithRevision<Agent>(KIND, agentId);
      if (!existing) {
        return {
          ok: false,
          code: "unknown_engineer",
          message: `claimSession: agentId=${agentId} not found — call assertIdentity first`,
        };
      }
      const agent = normalizeAgentShape(existing.entity);
      // Thrashing rate-limit (only when displacing a live session).
      if (agent.status === "online") {
        const history = this.displacementHistory.get(agent.fingerprint) ?? [];
        const tripped = recordDisplacementAndCheck(history, Date.now());
        this.displacementHistory.set(agent.fingerprint, history);
        if (tripped) {
          return {
            ok: false,
            code: "agent_thrashing_detected",
            message: `Agent ${agent.id} exceeded ${THRASHING_THRESHOLD} displacements in ${THRASHING_WINDOW_MS / 1000}s — halting to prevent fork-bomb. Check ~/.ois/instance.json for duplicate processes.`,
          };
        }
      }
      const now = new Date().toISOString();
      const displaced =
        agent.currentSessionId && agent.currentSessionId !== sessionId
          ? { sessionId: agent.currentSessionId, epoch: agent.sessionEpoch }
          : undefined;
      const nowMs = Date.parse(now);
      const restartHistoryMs = [...(agent.restartHistoryMs ?? []), nowMs];
      while (restartHistoryMs.length > 50) restartHistoryMs.shift();
      const restartCount = restartHistoryMs.filter(
        (t) => nowMs - t <= 24 * 60 * 60 * 1000,
      ).length;
      const stamped: Agent = {
        ...agent,
        sessionEpoch: agent.sessionEpoch + 1,
        currentSessionId: sessionId,
        status: "online",
        livenessState: "online",
        lastHeartbeatAt: now,
        activityState: "online_idle",
        sessionStartedAt: now,
        idleSince: now,
        workingSince: null,
        restartHistoryMs,
        restartCount,
      };
      const updated: Agent = { ...stamped, ...computeComponentStates(stamped, nowMs) };
      const result = await this.substrate.putIfMatch(KIND, updated, existing.resourceVersion);
      if (!result.ok) {
        continue;
      }
      this.sessionToEngineerId.set(sessionId, updated.id);
      this.lastTouchAt.set(updated.id, Date.now());
      if (displaced) {
        console.log(
          `[AgentRepositorySubstrate] Agent displaced: ${updated.id} epoch=${updated.sessionEpoch} (trigger=${trigger}, prior sessionId=${displaced.sessionId} epoch=${displaced.epoch})`,
        );
      } else {
        console.log(
          `[AgentRepositorySubstrate] Agent session claimed: ${updated.id} epoch=${updated.sessionEpoch} (trigger=${trigger})`,
        );
      }
      return {
        ok: true,
        agentId: updated.id,
        sessionEpoch: updated.sessionEpoch,
        trigger,
        ...(displaced ? { displacedPriorSession: displaced } : {}),
      };
    }

    return {
      ok: false,
      code: "agent_thrashing_detected",
      message: `OCC contention exceeded retry budget on claimSession for agentId=${agentId}; likely concurrent claim storm.`,
    };
  }

  async getAgent(agentId: string): Promise<Agent | null> {
    const raw = await this.substrate.get<Agent>(KIND, agentId);
    if (!raw) return null;
    return applyLivenessRecompute(normalizeAgentShape(raw), Date.now());
  }

  async getAgentForSession(sessionId: string): Promise<Agent | null> {
    const agentId = this.sessionToEngineerId.get(sessionId);
    if (!agentId) return null;
    return this.getAgent(agentId);
  }

  async listAgents(): Promise<Agent[]> {
    // Substrate-API kind-uniform list; no path-scan + no by-fingerprint mirror skip.
    const { items } = await this.substrate.list<Agent>(KIND, { limit: 500 });
    const nowMs = Date.now();
    return items.map((a) => applyLivenessRecompute(normalizeAgentShape(a), nowMs));
  }

  async selectAgents(selector: Selector): Promise<Agent[]> {
    const nowMs = Date.now();
    const agentIdSet = selector.agentIds && selector.agentIds.length > 0
      ? new Set(selector.agentIds)
      : null;
    // Fast path: single agentId pinpoint.
    if (selector.agentId) {
      const a = await this.getAgent(selector.agentId);
      if (!a) return [];
      if (!isAgentReachable(a, nowMs)) return [];
      if (agentIdSet && !agentIdSet.has(a.id)) return [];
      if (selector.roles && !selector.roles.includes(a.role)) return [];
      if (!labelsMatch(a.labels ?? {}, selector.matchLabels)) return [];
      return [a];
    }
    // Fast path: agentIds pinpoint — fetch each directly.
    if (agentIdSet) {
      const out: Agent[] = [];
      for (const id of agentIdSet) {
        const a = await this.getAgent(id);
        if (!a) continue;
        if (!isAgentReachable(a, nowMs)) continue;
        if (selector.roles && !selector.roles.includes(a.role)) continue;
        if (!labelsMatch(a.labels ?? {}, selector.matchLabels)) continue;
        out.push(a);
      }
      return out;
    }
    const all = await this.listAgents();
    return all.filter((a) => {
      if (!isAgentReachable(a, nowMs)) return false;
      if (selector.roles && !selector.roles.includes(a.role)) return false;
      if (!labelsMatch(a.labels ?? {}, selector.matchLabels)) return false;
      return true;
    });
  }

  /**
   * Heartbeat: bump lastSeenAt on the Agent bound to this session.
   * Rate-limited to AGENT_TOUCH_MIN_INTERVAL_MS per agent.
   * CAS-protected via getWithRevision + putIfMatch; on precondition failure
   * the competing write already carried a fresher lastSeenAt, so we silently skip.
   */
  async touchAgent(sessionId: string): Promise<void> {
    const agentId = this.sessionToEngineerId.get(sessionId);
    if (!agentId) return;
    const now = Date.now();
    const last = this.lastTouchAt.get(agentId) ?? 0;
    if (now - last < AGENT_TOUCH_MIN_INTERVAL_MS) return;
    this.lastTouchAt.set(agentId, now);

    const existing = await this.substrate.getWithRevision<Agent>(KIND, agentId);
    if (!existing) return;
    const agent = normalizeAgentShape(existing.entity);
    if (agent.currentSessionId !== sessionId) return;
    const stamped: Agent = {
      ...agent,
      lastSeenAt: new Date(now).toISOString(),
      status: "online",
    };
    const components = computeComponentStates(stamped, now);
    const updated: Agent = { ...stamped, ...components };
    await this.substrate.putIfMatch(KIND, updated, existing.resourceVersion);
  }

  async refreshHeartbeat(agentId: string): Promise<void> {
    const existing = await this.substrate.getWithRevision<Agent>(KIND, agentId);
    if (!existing) return;
    const agent = normalizeAgentShape(existing.entity);
    const nowMs = Date.now();
    const stamped: Agent = {
      ...agent,
      lastHeartbeatAt: new Date(nowMs).toISOString(),
      livenessState: "online",
    };
    const components = computeComponentStates(stamped, nowMs);
    const updated: Agent = { ...stamped, ...components };
    await this.substrate.putIfMatch(KIND, updated, existing.resourceVersion);
  }

  async setLivenessState(agentId: string, state: AgentLivenessState): Promise<void> {
    const existing = await this.substrate.getWithRevision<Agent>(KIND, agentId);
    if (!existing) return;
    const agent = normalizeAgentShape(existing.entity);
    const updated: Agent = { ...agent, livenessState: state };
    await this.substrate.putIfMatch(KIND, updated, existing.resourceVersion);
  }

  async updateAgentPulseLastFiredAt(agentId: string, lastFiredAt: string): Promise<void> {
    const existing = await this.substrate.getWithRevision<Agent>(KIND, agentId);
    if (!existing) return;
    const agent = normalizeAgentShape(existing.entity);
    if (!agent.pulseConfig) return;
    const updated: Agent = {
      ...agent,
      pulseConfig: { ...agent.pulseConfig, lastFiredAt },
    };
    await this.substrate.putIfMatch(KIND, updated, existing.resourceVersion);
  }

  // ── Mission-62 W1+W2 Pass 2: activity FSM transition handlers ──────

  async setActivityState(agentId: string, state: ActivityState): Promise<void> {
    const existing = await this.substrate.getWithRevision<Agent>(KIND, agentId);
    if (!existing) return;
    const agent = normalizeAgentShape(existing.entity);
    const updated: Agent = { ...agent, activityState: state };
    await this.substrate.putIfMatch(KIND, updated, existing.resourceVersion);
  }

  async recordToolCallStart(agentId: string, toolName: string): Promise<void> {
    const existing = await this.substrate.getWithRevision<Agent>(KIND, agentId);
    if (!existing) return;
    const agent = normalizeAgentShape(existing.entity);
    const now = new Date().toISOString();
    const updated: Agent = {
      ...agent,
      activityState: "online_working",
      lastToolCallAt: now,
      lastToolCallName: toolName,
      workingSince: now,
      idleSince: null,
    };
    await this.substrate.putIfMatch(KIND, updated, existing.resourceVersion);
  }

  async recordToolCallComplete(agentId: string): Promise<void> {
    const existing = await this.substrate.getWithRevision<Agent>(KIND, agentId);
    if (!existing) return;
    const agent = normalizeAgentShape(existing.entity);
    const now = new Date().toISOString();
    const updated: Agent = {
      ...agent,
      activityState: "online_idle",
      idleSince: now,
      workingSince: null,
    };
    await this.substrate.putIfMatch(KIND, updated, existing.resourceVersion);
  }

  async recordQuotaBlocked(agentId: string, retryAfterSeconds: number): Promise<void> {
    const existing = await this.substrate.getWithRevision<Agent>(KIND, agentId);
    if (!existing) return;
    const agent = normalizeAgentShape(existing.entity);
    const nowMs = Date.now();
    const quotaBlockedUntil = new Date(nowMs + retryAfterSeconds * 1000).toISOString();
    const updated: Agent = {
      ...agent,
      activityState: "online_quota_blocked",
      quotaBlockedUntil,
      workingSince: null,
    };
    await this.substrate.putIfMatch(KIND, updated, existing.resourceVersion);
  }

  async recordQuotaRecovered(agentId: string): Promise<void> {
    const existing = await this.substrate.getWithRevision<Agent>(KIND, agentId);
    if (!existing) return;
    const agent = normalizeAgentShape(existing.entity);
    const now = new Date().toISOString();
    const updated: Agent = {
      ...agent,
      activityState: "online_idle",
      idleSince: now,
      quotaBlockedUntil: null,
    };
    await this.substrate.putIfMatch(KIND, updated, existing.resourceVersion);
  }

  async recordAgentError(agentId: string, error: AgentErrorRecord): Promise<void> {
    const existing = await this.substrate.getWithRevision<Agent>(KIND, agentId);
    if (!existing) return;
    const agent = normalizeAgentShape(existing.entity);
    const nextErrors = [...agent.recentErrors, error];
    while (nextErrors.length > AGENT_RECENT_ERRORS_CAP) nextErrors.shift();
    const updated: Agent = { ...agent, recentErrors: nextErrors };
    await this.substrate.putIfMatch(KIND, updated, existing.resourceVersion);
  }

  /**
   * Mark the Agent bound to this session offline. Called on session teardown.
   * Only writes if the Agent's currentSessionId still matches — newer sessions
   * (displacement) must not be clobbered.
   */
  async markAgentOffline(sessionId: string): Promise<void> {
    const agentId = this.sessionToEngineerId.get(sessionId);
    this.sessionToEngineerId.delete(sessionId);
    if (!agentId) return;

    const existing = await this.substrate.getWithRevision<Agent>(KIND, agentId);
    if (!existing) return;
    const agent = normalizeAgentShape(existing.entity);
    if (agent.currentSessionId !== sessionId) return;
    const updated: Agent = {
      ...agent,
      status: "offline",
      livenessState: "offline",
      lastSeenAt: new Date().toISOString(),
    };
    const result = await this.substrate.putIfMatch(KIND, updated, existing.resourceVersion);
    if (!result.ok) return;
    console.log(`[AgentRepositorySubstrate] Agent marked offline: ${agentId}`);
  }

  async migrateAgentQueue(sourceEngineerId: string, targetEngineerId: string): Promise<{ moved: number }> {
    // Stub: hub-networking owns the agentId-keyed queue (same as legacy).
    console.log(
      `[AgentRepositorySubstrate] migrate_agent_queue: ${sourceEngineerId} -> ${targetEngineerId} (stub; queue rewire pending)`,
    );
    return { moved: 0 };
  }

  async listOfflineAgentsOlderThan(staleThresholdMs: number): Promise<Agent[]> {
    const agents = await this.listAgents();
    const nowMs = Date.now();
    const stale: Agent[] = [];
    for (const a of agents) {
      const isOffline = a.status === "offline" || a.livenessState === "offline";
      if (!isOffline) continue;
      const lastSeenMs = Date.parse(a.lastSeenAt);
      if (!Number.isFinite(lastSeenMs)) continue;
      if (nowMs - lastSeenMs <= staleThresholdMs) continue;
      stale.push(a);
    }
    return stale;
  }

  async deleteAgent(agentId: string): Promise<boolean> {
    const existing = await this.substrate.get<Agent>(KIND, agentId);
    if (!existing) return false;
    await this.substrate.delete(KIND, agentId);
    this.displacementHistory.delete(existing.fingerprint);
    this.lastTouchAt.delete(agentId);
    for (const [sid, eid] of this.sessionToEngineerId.entries()) {
      if (eid === agentId) this.sessionToEngineerId.delete(sid);
    }
    console.log(`[AgentRepositorySubstrate] Agent deleted: ${agentId} (via reaper)`);
    return true;
  }
}
