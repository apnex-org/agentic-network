/**
 * AgentRepository — StorageProvider-backed Engineer Registry.
 *
 * Mission-47 W7b. Replaces `MemoryEngineerRegistry` (state.ts) +
 * `GcsEngineerRegistry` (gcs-state.ts). Implements `IEngineerRegistry`
 * unchanged.
 *
 * Layout preserved byte-for-byte:
 *   agents/<agentId>.json             — per-engineer blob (session state source-of-truth)
 *   agents/by-fingerprint/<fp>.json      — fingerprint → agent mirror (identity lookup fast path)
 *
 * In-memory bookkeeping (wipes on Hub restart, identical to legacy):
 *   - sessionRoles          sessionId → SessionRole
 *   - displacementHistory   fingerprint → number[] (timestamps for rate-limit)
 *   - sessionToEngineerId   sessionId → agentId
 *   - lastTouchAt           agentId → heartbeat rate-limit accounting
 *
 * Mission-47 context (W7b architect watch-points per thread-296/298):
 *   1. sessionToEngineerId map — kept in-memory (same as legacy).
 *      Hub restart wipes + repopulates on next session-claim. NOT a
 *      blob-CRUD concern; no contract drift.
 *   2. Displacement rate-limit accounting — same in-memory pattern.
 *      recordDisplacementAndCheck is a pure function operating on
 *      the per-fingerprint array. No drift.
 *
 * Migration mapping:
 *   readJsonWithGeneration → provider.getWithToken + decode
 *   writeJsonWithPrecondition(path, data, 0) → provider.createOnly
 *   writeJsonWithPrecondition(path, data, generation) → provider.putIfMatch
 *   writeJson (unconditional) → provider.put
 *   readJson → provider.get + decode
 *   listFiles → provider.list
 *   deleteFile → provider.delete
 *   GcsOccPreconditionFailed on putIfMatch → result.ok === false
 */

import type { StorageProvider } from "@apnex/storage-provider";
import { hasGetWithToken, StoragePathNotFoundError } from "@apnex/storage-provider";

import type {
  IEngineerRegistry,
  Agent,
  AgentAdvisoryTags,
  AgentClientMetadata,
  AgentLabels,
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
  shortHash,
  THRASHING_THRESHOLD,
  THRASHING_WINDOW_MS,
  recordDisplacementAndCheck,
  shallowEqualLabels,
  computeLivenessState,
  AGENT_RECENT_ERRORS_CAP,
} from "../state.js";

function agentPath(agentId: string): string {
  return `agents/${agentId}.json`;
}

function fpPath(fingerprint: string): string {
  return `agents/by-fingerprint/${fingerprint}.json`;
}

function encode(a: Agent): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(a, null, 2));
}

function decode(bytes: Uint8Array): Agent {
  return JSON.parse(new TextDecoder().decode(bytes)) as Agent;
}

/** ADR-017 + Mission-62 defensive normalization — legacy Agent blobs
 *  lacking the liveness-layer (ADR-017) or mission-62 activity-layer
 *  fields get sane defaults on read. Ported from gcs-state.ts's
 *  `normalizeAgentShape`; extended Mission-62 W1+W2 Pass 1 with
 *  activityState + identity/session/diagnostics defaults. */
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
    // Mission-62 W1+W2 Pass 1 — additive defaults for legacy blobs.
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
  } as Agent;
}

/**
 * Read-time liveness recompute (INV-COMMS-L03 / INV-AG6). Stale
 * heartbeat auto-demotes: online → degraded → unresponsive. The
 * explicit `offline` state (teardown-triggered) is sticky and never
 * auto-promotes. `status` tracks the binary derived view for
 * backwards compatibility with pre-ADR-017 callers.
 *
 * Ported from the legacy `MemoryEngineerRegistry` read paths.
 * `GcsEngineerRegistry` DID NOT have this recompute — that was a
 * latent INV-COMMS-L03 gap in GCS-backed prod where read-time liveness
 * would stay "online" despite a stale heartbeat until the watchdog
 * scan + `setLivenessState` caught up. Unifying into `AgentRepository`
 * restores consistent invariant enforcement across backends.
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
 * bug-35 fix: presence-projection window for `selectAgents` (peer-discovery
 * + thread-message dispatcher selector). Decouples the projection's notion
 * of "available" from the ADR-017 queue-drain liveness FSM — agents that
 * are tool-call-active but haven't drained recently must still be reachable
 * for new dispatch.
 *
 * Why not reuse `livenessState`/`status`: those derive from `lastHeartbeatAt`
 * (ADR-017 — bumped only on `refreshHeartbeat`/`claim_session`/etc.).
 * `lastSeenAt` is bumped by `touchAgent` on every tool call (rate-limited to
 * AGENT_TOUCH_MIN_INTERVAL_MS = 30s), making it the right signal for
 * "session is active, please route work here."
 *
 * Window of 60s = AGENT_TOUCH_MIN_INTERVAL_MS (30s rate-limit slack) +
 * one tool-call-budget worth of headroom. Wider than the rate-limit, narrow
 * enough that genuinely-stalled sessions age out within ~one ladder step.
 */
const PEER_PRESENCE_WINDOW_MS = 60_000;

/** Predicate: is this Agent eligible for `selectAgents` projection?
 *  - archived → no (lifecycle-pruned)
 *  - livenessState === "offline" → no (explicit teardown via markAgentOffline,
 *    or stored offline; sticky per ADR-017)
 *  - lastSeenAt within PEER_PRESENCE_WINDOW_MS → yes (recent tool-call activity)
 *  - else → no (stale; agent has gone quiet) */
function isPeerPresent(a: Agent, nowMs: number): boolean {
  if (a.archived) return false;
  if (a.livenessState === "offline") return false;
  const lastSeenMs = Date.parse(a.lastSeenAt);
  if (!Number.isFinite(lastSeenMs)) return false;
  return nowMs - lastSeenMs <= PEER_PRESENCE_WINDOW_MS;
}

type GetWithToken = (path: string) => Promise<{ data: Uint8Array; token: string } | null>;

/**
 * mission-66 #40 closure: Hub-side canonical projection for advisoryTags.
 * Derives `adapterVersion` from `clientMetadata.proxyVersion` so the wire
 * surface has a single source-of-truth (the npm package.json version
 * stamped into clientMetadata at the shim handshake). Caller-provided
 * advisoryTags.adapterVersion is preserved if present (defensive — Hub
 * does not overwrite an explicit value); otherwise derived from
 * clientMetadata. Returns a fresh object — caller-provided advisoryTags
 * are never mutated.
 */
function deriveAdvisoryTags(
  incoming: AgentAdvisoryTags | undefined | null,
  clientMetadata: AgentClientMetadata | undefined | null,
): AgentAdvisoryTags {
  const base: AgentAdvisoryTags = { ...(incoming ?? {}) };
  if (base.adapterVersion === undefined && clientMetadata?.proxyVersion) {
    base.adapterVersion = clientMetadata.proxyVersion;
  }
  return base;
}

export class AgentRepository implements IEngineerRegistry {
  private readonly sessionRoles = new Map<string, SessionRole>();
  // M18 displacement rate-limit accounting (in-memory; wipes on Hub restart).
  private readonly displacementHistory = new Map<string, number[]>();
  // Session heartbeat bookkeeping (in-memory; wipes on Hub restart).
  private readonly sessionToEngineerId = new Map<string, string>();
  private readonly lastTouchAt = new Map<string, number>();

  private readonly getWithToken: GetWithToken;

  constructor(private readonly provider: StorageProvider) {
    if (!hasGetWithToken(provider)) {
      throw new Error(
        "AgentRepository requires a StorageProvider with atomic read-with-token support",
      );
    }
    this.getWithToken = (provider as unknown as { getWithToken: GetWithToken }).getWithToken.bind(
      provider,
    );
  }

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
    // Mission-24 Phase 2 (ADR-014 §77): SessionRole carries "director" directly.
    this.sessionRoles.set(sessionId, tokenRole as SessionRole);

    const identity = await this.assertIdentity(
      {
        globalInstanceId: payload.globalInstanceId,
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
      return identity;
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

  async assertIdentity(
    payload: AssertIdentityPayload,
    sessionId?: string,
    _address?: string,
  ): Promise<AssertIdentityResult> {
    const fingerprint = computeFingerprint(payload.globalInstanceId);
    const path = fpPath(fingerprint);
    // Two attempts: natural + retry on OCC contention. Matches legacy budget.
    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = await this.getWithToken(path);
      const now = new Date().toISOString();

      if (!existing) {
        // First-contact create: NO session bound (claimSession's job).
        const agentIdPrefix = payload.role === "director" ? "director" : "eng";
        const agentId = `${agentIdPrefix}-${shortHash(fingerprint)}`;
        // mission-66 #40 closure: Hub-side canonical projection derives
        // advisoryTags.adapterVersion from clientMetadata.proxyVersion.
        // Single source-of-truth at the Hub; consumers read advisoryTags.
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
          // Mission-62 W3 — `name` populated from globalInstanceId (which
          // the M18 handshake derives from the OIS_INSTANCE_ID env var per
          // Design v1.0 §5.1); falls back to agentId if globalInstanceId
          // is somehow unavailable.
          name: payload.globalInstanceId ?? agentId,
          activityState: "offline", // first-contact has no SSE stream yet
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
        };
        const created = await this.provider.createOnly(path, encode(agent));
        if (!created.ok) {
          // Lost the create race — retry on the get-path this iteration.
          continue;
        }
        // Mirror the identity on agents/<eid>.json (source of truth for session state).
        await this.provider.put(agentPath(agentId), encode(agent));
        if (sessionId) {
          this.sessionToEngineerId.set(sessionId, agentId);
        }
        console.log(`[AgentRepository] Agent identity asserted (created): ${agentId}`);
        return {
          ok: true,
          agentId,
          wasCreated: true,
          clientMetadata: agent.clientMetadata,
          advisoryTags: agent.advisoryTags,
          labels: agent.labels,
        };
      }

      const agent = normalizeAgentShape(decode(existing.data));

      // Role mismatch = hard security boundary.
      if (agent.role !== payload.role) {
        return {
          ok: false,
          code: "role_mismatch",
          message: `Token role '${payload.role}' does not match persisted agent role '${agent.role}' for agentId=${agent.id}`,
        };
      }

      // CP3 C5 (bug-16): labels refresh path — provided overwrites stored;
      // omitted preserves stored. Defensive migration for agents lacking labels.
      const priorLabels = agent.labels ?? {};
      const nextLabels = payload.labels ?? priorLabels;
      const labelsChanged = !shallowEqualLabels(priorLabels, nextLabels);
      // mission-66 #40 closure: derive advisoryTags.adapterVersion from
      // canonical clientMetadata.proxyVersion on every re-register so
      // version-source-of-truth tracks the running shim.
      const refreshedAdvisoryTags = deriveAdvisoryTags(
        payload.advisoryTags ?? agent.advisoryTags,
        payload.clientMetadata,
      );
      const updated: Agent = {
        ...agent,
        clientMetadata: payload.clientMetadata,
        advisoryTags: refreshedAdvisoryTags,
        labels: nextLabels,
        lastSeenAt: now,
        receiptSla: payload.receiptSla ?? agent.receiptSla ?? DEFAULT_AGENT_RECEIPT_SLA_MS,
        wakeEndpoint: payload.wakeEndpoint ?? agent.wakeEndpoint ?? null,
        // INVARIANT (T1): do NOT touch sessionEpoch/currentSessionId/status/
        // livenessState/lastHeartbeatAt. Identity assertion is identity-only.
      };

      const result = await this.provider.putIfMatch(path, encode(updated), existing.token);
      if (!result.ok) {
        // OCC lost — retry.
        continue;
      }
      await this.provider.put(agentPath(updated.id), encode(updated));
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
      const path = agentPath(agentId);
      const existing = await this.getWithToken(path);
      if (!existing) {
        return {
          ok: false,
          code: "unknown_engineer",
          message: `claimSession: agentId=${agentId} not found — call assertIdentity first`,
        };
      }
      const agent = normalizeAgentShape(decode(existing.data));
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
      // Mission-62 W1+W2 Pass 1: claimSession promotes activityState to
      // online_idle (agent now eligible for work assignment) + stamps
      // sessionStartedAt + bumps restartCount/restartHistoryMs accounting.
      const nowMs = Date.parse(now);
      const restartHistoryMs = [...(agent.restartHistoryMs ?? []), nowMs];
      while (restartHistoryMs.length > 50) restartHistoryMs.shift(); // AGENT_RESTART_HISTORY_CAP
      const restartCount = restartHistoryMs.filter(
        (t) => nowMs - t <= 24 * 60 * 60 * 1000, // AGENT_RESTART_WINDOW_MS
      ).length;
      const updated: Agent = {
        ...agent,
        sessionEpoch: agent.sessionEpoch + 1,
        currentSessionId: sessionId,
        status: "online",
        lastSeenAt: now,
        livenessState: "online",
        lastHeartbeatAt: now,
        activityState: "online_idle",
        sessionStartedAt: now,
        idleSince: now,
        workingSince: null,
        restartHistoryMs,
        restartCount,
      };
      const result = await this.provider.putIfMatch(path, encode(updated), existing.token);
      if (!result.ok) {
        // OCC lost — retry.
        continue;
      }
      // Best-effort mirror update on by-fingerprint; OCC failure here
      // is non-fatal because the per-agentId file is source of truth.
      try {
        const fpExisting = await this.getWithToken(fpPath(agent.fingerprint));
        if (fpExisting) {
          await this.provider.putIfMatch(fpPath(agent.fingerprint), encode(updated), fpExisting.token);
        }
      } catch (err) {
        if (!(err instanceof StoragePathNotFoundError)) throw err;
      }
      this.sessionToEngineerId.set(sessionId, updated.id);
      this.lastTouchAt.set(updated.id, Date.now());
      if (displaced) {
        console.log(
          `[AgentRepository] Agent displaced: ${updated.id} epoch=${updated.sessionEpoch} (trigger=${trigger}, prior sessionId=${displaced.sessionId} epoch=${displaced.epoch})`,
        );
      } else {
        console.log(
          `[AgentRepository] Agent session claimed: ${updated.id} epoch=${updated.sessionEpoch} (trigger=${trigger})`,
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
    const raw = await this.provider.get(agentPath(agentId));
    if (!raw) return null;
    return applyLivenessRecompute(normalizeAgentShape(decode(raw)), Date.now());
  }

  async getAgentForSession(sessionId: string): Promise<Agent | null> {
    const agentId = this.sessionToEngineerId.get(sessionId);
    if (!agentId) return null;
    const raw = await this.provider.get(agentPath(agentId));
    if (!raw) return null;
    return applyLivenessRecompute(normalizeAgentShape(decode(raw)), Date.now());
  }

  async listAgents(): Promise<Agent[]> {
    const keys = await this.provider.list("agents/");
    const agents: Agent[] = [];
    const nowMs = Date.now();
    for (const key of keys) {
      // Only read top-level per-agentId file, not by-fingerprint mirror.
      if (key.startsWith("agents/by-fingerprint/")) continue;
      if (!key.endsWith(".json")) continue;
      const raw = await this.provider.get(key);
      if (!raw) continue;
      agents.push(applyLivenessRecompute(normalizeAgentShape(decode(raw)), nowMs));
    }
    return agents;
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
      if (!isPeerPresent(a, nowMs)) return [];
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
        if (!isPeerPresent(a, nowMs)) continue;
        if (selector.roles && !selector.roles.includes(a.role)) continue;
        if (!labelsMatch(a.labels ?? {}, selector.matchLabels)) continue;
        out.push(a);
      }
      return out;
    }
    const all = await this.listAgents();
    return all.filter((a) => {
      if (!isPeerPresent(a, nowMs)) return false;
      if (selector.roles && !selector.roles.includes(a.role)) return false;
      if (!labelsMatch(a.labels ?? {}, selector.matchLabels)) return false;
      return true;
    });
  }

  /**
   * Heartbeat: bump lastSeenAt on the Agent bound to this session.
   * Rate-limited to AGENT_TOUCH_MIN_INTERVAL_MS per agent.
   * OCC-protected; on precondition failure the competing write already
   * carried a fresher lastSeenAt, so we silently skip.
   */
  async touchAgent(sessionId: string): Promise<void> {
    const agentId = this.sessionToEngineerId.get(sessionId);
    if (!agentId) return;
    const now = Date.now();
    const last = this.lastTouchAt.get(agentId) ?? 0;
    if (now - last < AGENT_TOUCH_MIN_INTERVAL_MS) return;
    // Reserve the slot up front so concurrent touches collapse to one write.
    this.lastTouchAt.set(agentId, now);

    const path = agentPath(agentId);
    const existing = await this.getWithToken(path);
    if (!existing) return;
    const agent = normalizeAgentShape(decode(existing.data));
    if (agent.currentSessionId !== sessionId) return; // session no longer owns this agent
    const updated: Agent = {
      ...agent,
      lastSeenAt: new Date(now).toISOString(),
      status: "online",
    };
    const result = await this.provider.putIfMatch(path, encode(updated), existing.token);
    if (!result.ok) return; // racing writer won
    // Mirror: fingerprint-indexed (best-effort).
    await this.provider.put(fpPath(agent.fingerprint), encode(updated));
  }

  /** ADR-017: refresh heartbeat on drain. Not rate-limited — drains
   *  are infrequent so a write every time is acceptable. Resets
   *  livenessState to online on the authoritative proof-of-life. */
  async refreshHeartbeat(agentId: string): Promise<void> {
    const path = agentPath(agentId);
    const existing = await this.getWithToken(path);
    if (!existing) return;
    const agent = normalizeAgentShape(decode(existing.data));
    const updated: Agent = {
      ...agent,
      lastHeartbeatAt: new Date().toISOString(),
      livenessState: "online",
    };
    const result = await this.provider.putIfMatch(path, encode(updated), existing.token);
    if (!result.ok) return;
    await this.provider.put(fpPath(agent.fingerprint), encode(updated));
  }

  async setLivenessState(agentId: string, state: AgentLivenessState): Promise<void> {
    const path = agentPath(agentId);
    const existing = await this.getWithToken(path);
    if (!existing) return;
    const agent = normalizeAgentShape(decode(existing.data));
    const updated: Agent = { ...agent, livenessState: state };
    const result = await this.provider.putIfMatch(path, encode(updated), existing.token);
    if (!result.ok) return;
    await this.provider.put(fpPath(agent.fingerprint), encode(updated));
  }

  // ── Mission-62 W1+W2 Pass 2: activity FSM transition handlers ──────

  async setActivityState(agentId: string, state: ActivityState): Promise<void> {
    const path = agentPath(agentId);
    const existing = await this.getWithToken(path);
    if (!existing) return;
    const agent = normalizeAgentShape(decode(existing.data));
    const updated: Agent = { ...agent, activityState: state };
    const result = await this.provider.putIfMatch(path, encode(updated), existing.token);
    if (!result.ok) return;
    await this.provider.put(fpPath(agent.fingerprint), encode(updated));
  }

  async recordToolCallStart(agentId: string, toolName: string): Promise<void> {
    const path = agentPath(agentId);
    const existing = await this.getWithToken(path);
    if (!existing) return;
    const agent = normalizeAgentShape(decode(existing.data));
    const now = new Date().toISOString();
    const updated: Agent = {
      ...agent,
      activityState: "online_working",
      lastToolCallAt: now,
      lastToolCallName: toolName,
      workingSince: now,
      idleSince: null,
    };
    const result = await this.provider.putIfMatch(path, encode(updated), existing.token);
    if (!result.ok) return;
    await this.provider.put(fpPath(agent.fingerprint), encode(updated));
  }

  async recordToolCallComplete(agentId: string): Promise<void> {
    const path = agentPath(agentId);
    const existing = await this.getWithToken(path);
    if (!existing) return;
    const agent = normalizeAgentShape(decode(existing.data));
    const now = new Date().toISOString();
    const updated: Agent = {
      ...agent,
      activityState: "online_idle",
      idleSince: now,
      workingSince: null,
    };
    const result = await this.provider.putIfMatch(path, encode(updated), existing.token);
    if (!result.ok) return;
    await this.provider.put(fpPath(agent.fingerprint), encode(updated));
  }

  async recordQuotaBlocked(agentId: string, retryAfterSeconds: number): Promise<void> {
    const path = agentPath(agentId);
    const existing = await this.getWithToken(path);
    if (!existing) return;
    const agent = normalizeAgentShape(decode(existing.data));
    const nowMs = Date.now();
    const quotaBlockedUntil = new Date(nowMs + retryAfterSeconds * 1000).toISOString();
    const updated: Agent = {
      ...agent,
      activityState: "online_quota_blocked",
      quotaBlockedUntil,
      workingSince: null,
    };
    const result = await this.provider.putIfMatch(path, encode(updated), existing.token);
    if (!result.ok) return;
    await this.provider.put(fpPath(agent.fingerprint), encode(updated));
  }

  async recordQuotaRecovered(agentId: string): Promise<void> {
    const path = agentPath(agentId);
    const existing = await this.getWithToken(path);
    if (!existing) return;
    const agent = normalizeAgentShape(decode(existing.data));
    const now = new Date().toISOString();
    const updated: Agent = {
      ...agent,
      activityState: "online_idle",
      idleSince: now,
      quotaBlockedUntil: null,
    };
    const result = await this.provider.putIfMatch(path, encode(updated), existing.token);
    if (!result.ok) return;
    await this.provider.put(fpPath(agent.fingerprint), encode(updated));
  }

  async recordAgentError(agentId: string, error: AgentErrorRecord): Promise<void> {
    const path = agentPath(agentId);
    const existing = await this.getWithToken(path);
    if (!existing) return;
    const agent = normalizeAgentShape(decode(existing.data));
    // FIFO: append + drop-oldest if over cap.
    const nextErrors = [...agent.recentErrors, error];
    while (nextErrors.length > AGENT_RECENT_ERRORS_CAP) nextErrors.shift();
    const updated: Agent = { ...agent, recentErrors: nextErrors };
    const result = await this.provider.putIfMatch(path, encode(updated), existing.token);
    if (!result.ok) return;
    await this.provider.put(fpPath(agent.fingerprint), encode(updated));
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

    const path = agentPath(agentId);
    const existing = await this.getWithToken(path);
    if (!existing) return;
    const agent = normalizeAgentShape(decode(existing.data));
    if (agent.currentSessionId !== sessionId) return; // a newer session owns the agent
    const updated: Agent = {
      ...agent,
      status: "offline",
      livenessState: "offline",
      lastSeenAt: new Date().toISOString(),
    };
    const result = await this.provider.putIfMatch(path, encode(updated), existing.token);
    if (!result.ok) return; // displaced mid-cleanup
    await this.provider.put(fpPath(agent.fingerprint), encode(updated));
    console.log(`[AgentRepository] Agent marked offline: ${agentId}`);
  }

  async migrateAgentQueue(sourceEngineerId: string, targetEngineerId: string): Promise<{ moved: number }> {
    // Placeholder: hub-networking owns the agentId-keyed queue.
    // Matches the legacy stub exactly; queue-rewire is deferred to
    // OpenCode integration coverage per thread-79.
    console.log(
      `[AgentRepository] migrate_agent_queue: ${sourceEngineerId} -> ${targetEngineerId} (stub; queue rewire pending)`,
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
    const raw = await this.provider.get(agentPath(agentId));
    if (!raw) return false;
    const agent = decode(raw);
    // Delete per-agentId file first, then by-fingerprint alias — preserves
    // crash-safety (alias-only remnant would let a concurrent registerAgent
    // retry create fresh state cleanly).
    await this.provider.delete(agentPath(agentId));
    await this.provider.delete(fpPath(agent.fingerprint));
    this.displacementHistory.delete(agent.fingerprint);
    this.lastTouchAt.delete(agentId);
    for (const [sid, eid] of this.sessionToEngineerId.entries()) {
      if (eid === agentId) this.sessionToEngineerId.delete(sid);
    }
    console.log(`[AgentRepository] Agent deleted: ${agentId} (via reaper)`);
    return true;
  }
}
