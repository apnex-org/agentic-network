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

import type { Filter, HubStorageSubstrate } from "../storage-substrate/index.js";
import { LOCK_CLASS, withAdvisoryLock } from "../storage-substrate/advisory-lock.js";
import { type Clock, systemClock } from "./clock.js";
import {
  agentToEnvelope,
  envelopeToAgent,
  agentFilterToEnvelope,
} from "./agent-envelope-shape.js";
import type {
  IEngineerRegistry,
  Agent,
  AgentAdvisoryTags,
  AgentClientMetadata,
  AgentLivenessState,
  AgentRole,
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
/** C1-R2: CAS-retry budget for the claim-thrash counter mutations (so a concurrent
 *  heartbeat/touch write doesn't silently drop a thrash increment). */
const WORKITEM_THRASH_CAS_RETRIES = 5;

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
    // C1-R2 (mission-94): WorkItem claim-thrash quarantine defaults (legacy agents
    // predate these fields).
    thrashCount: typeof a.thrashCount === "number" ? a.thrashCount : 0,
    quarantined: a.quarantined === true,
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
  // idea-355 SLICE-4 / bug-183 (AG-8 retire): the legacy advisoryTags.adapterVersion
  // was mislabeled — it carried the SHIM (proxyVersion), not the adapter/SDK —
  // so SLICE-3's report-both added the honest sdkVersion + shimVersion keys, and
  // SLICE-4 now RETIRES the adapterVersion write entirely (shimVersion carries the
  // identical value, so it was a redundant mislabeled duplicate). The intent-
  // aligned keys are the canonical advisory surface:
  //   sdkVersion  = clientMetadata.sdkVersion  (the KERNEL / network-adapter)
  //   shimVersion = clientMetadata.proxyVersion (the SHIM / plugin)
  // NOTE: the DIFFERENT top-level Agent.adapterVersion (= the kernel/sdkVersion,
  // decoded elsewhere) is unrelated and is NOT touched.
  if (base.sdkVersion === undefined && clientMetadata?.sdkVersion) {
    base.sdkVersion = clientMetadata.sdkVersion;
  }
  if (base.shimVersion === undefined && clientMetadata?.proxyVersion) {
    base.shimVersion = clientMetadata.proxyVersion;
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

  /** bug-230: rolling, deduped, capped persisted register bindings (newest-last). */
  private static appendRegisteredSession(list: string[] | null | undefined, sessionId: string): string[] {
    const next = [...(list ?? []).filter((s) => s !== sessionId), sessionId];
    while (next.length > 8) next.shift();
    return next;
  }
  private readonly lastTouchAt = new Map<string, number>();

  constructor(
    private readonly substrate: HubStorageSubstrate,
    // idea-449 VirtualClock: agent-registry timestamps + liveness reads route through
    // the injected clock; defaults to real wall time so production is unchanged.
    private readonly clock: Clock = systemClock,
  ) {}

  // ── Envelope-aware substrate-boundary wrappers (mission-89 (A3); bug-138-class) ──
  //
  // Post-mission-88 W11 cutover, Agent rows are envelope-shape on disk; the
  // legacy-flat Agent type is the in-memory shape. These wrappers encode at
  // write and decode at read so the rest of this class operates on legacy-
  // flat Agent unchanged. Roundtrip preserves envelope shape on disk (no
  // de-migration on touch). See `agent-envelope-shape.ts` for the W11-
  // partition-locked rename + partition contract.

  private async loadAgent(id: string): Promise<Agent | null> {
    const raw = await this.substrate.get<unknown>(KIND, id);
    return raw === null ? null : envelopeToAgent(raw);
  }

  private async loadAgentWithRevision(
    id: string,
  ): Promise<{ entity: Agent; resourceVersion: string } | null> {
    const got = await this.substrate.getWithRevision<unknown>(KIND, id);
    if (!got) return null;
    return { entity: envelopeToAgent(got.entity), resourceVersion: got.resourceVersion };
  }

  private async listAgentsRaw(
    opts: { filter?: Filter; limit?: number; offset?: number } = {},
  ): Promise<Agent[]> {
    const envelopeFilter = agentFilterToEnvelope(opts.filter) as Filter | undefined;
    const { items } = await this.substrate.list<unknown>(KIND, {
      ...(envelopeFilter ? { filter: envelopeFilter } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      ...(opts.offset !== undefined ? { offset: opts.offset } : {}),
    });
    return items.map(envelopeToAgent);
  }

  private async createOnlyAgent(agent: Agent): Promise<{ ok: boolean }> {
    return this.substrate.createOnly(KIND, agentToEnvelope(agent));
  }

  private async putIfMatchAgent(
    agent: Agent,
    expectedRevision: string,
  ): Promise<{ ok: boolean }> {
    return this.substrate.putIfMatch(KIND, agentToEnvelope(agent), expectedRevision);
  }

  private async putAgent(agent: Agent): Promise<{ id: string; resourceVersion: string }> {
    return this.substrate.put(KIND, agentToEnvelope(agent));
  }

  // ── Session role (SessionRole) in-memory bookkeeping ───────────────

  setSessionRole(sessionId: string, role: SessionRole): void {
    this.sessionRoles.set(sessionId, role);
  }

  getRole(sessionId: string): SessionRole {
    return this.sessionRoles.get(sessionId) || "unknown";
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

    // mission-89 Phase 2 (bug-127 systemic-close): single-attempt lookup +
    // mutate under substrate-level advisory lock (LOCK_CLASS.assertIdentity).
    // Replaces mission-88 W10-ext 8-attempt retry-budget with exclusive-access
    // primitive — concurrent callers serialize behind the lock; no OCC race.
    // Sibling of bug-97 Counter-collision pattern, both closed by primitive.
    //
    // Lock-acquire is wait-indefinitely (no timeoutMs) to preserve drop-in
    // retry-loop replacement semantics; latency-warn at default 100ms surfaces
    // contention storms in logs (replaces retry-budget-counter observability).
    return await withAdvisoryLock(this.substrate, LOCK_CLASS.assertIdentity, fingerprint, async () => {
      // Lookup by fingerprint via envelope-aware listAgentsRaw wrapper (bug-138
      // (A3): wrapper translates `fingerprint` filter-key → envelope JSONB
      // path `metadata.fingerprint`; post-W11 cutover rows are envelope-shape).
      const items = await this.listAgentsRaw({ filter: { fingerprint }, limit: 1 });
      const existingAgent = items[0] ?? null;
      const now = this.clock.now().toISOString();

      if (!existingAgent) {
        // First-contact create. Lock-held → no concurrent creator can win
        // the race for this fingerprint; createOnly should always succeed.
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
          registeredSessions: sessionId ? [sessionId] : [],
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
          // C1-R2 (mission-94): claim-thrash quarantine — fresh agent starts clean.
          thrashCount: 0,
          quarantined: false,
        };
        const created = await this.createOnlyAgent(agent);
        if (!created.ok) {
          // mission-89 Phase 5 (Observation 4): structurally unreachable under
          // the per-fingerprint advisory lock — createOnly conflicts only on
          // same agentId, and same name → same fingerprint → lock-serialized.
          // hashToInt32 collision across different fingerprints is mathematically
          // negligible (~3e-10 at 100k keys per FNV-1a-32 birthday-paradox math).
          // If we reach here, the substrate state is anomalous; throw rather than
          // silently emit a deprecated transient code.
          throw new Error(
            `[AgentRepositorySubstrate] assertIdentity invariant violation: createOnly conflict ` +
              `under advisory-lock for agentId=${agentId}, fingerprint=${fingerprint}. ` +
              `Lock-serialization should prevent same-fingerprint createOnly races; ` +
              `investigate substrate state or hashToInt32 collision telemetry.`,
          );
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

      // Re-fetch with revision for CAS-safe update path.
      const existing = await this.loadAgentWithRevision(existingAgent.id);
      if (!existing) {
        // mission-89 Phase 5 (Observation 4): structurally unreachable under
        // the advisory lock — list returned existingAgent under-lock and the
        // lock prevents concurrent deletion by the same-fingerprint path. A
        // mid-flight delete by an OUT-of-band tool (operator script bypassing
        // the registry) would land here; treat as anomalous + throw.
        throw new Error(
          `[AgentRepositorySubstrate] assertIdentity invariant violation: Agent ${existingAgent.id} ` +
            `deleted between lookup and re-fetch for fingerprint=${fingerprint}. ` +
            `Advisory lock should prevent concurrent deletion via the registry; ` +
            `investigate out-of-band substrate mutation.`,
        );
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
        // bug-264: un-archive-on-online-transition — a re-registering seat is
        // coming back, so clear any tombstone by construction. This is what
        // makes a shorter reaper grace safe: a genuinely-returning seat always
        // re-materializes in the default view (tombstone = view filter, not
        // amnesia); only never-returning dead seats stay archived.
        archived: false,
        clientMetadata: payload.clientMetadata,
        advisoryTags: refreshedAdvisoryTags,
        labels: nextLabels,
        // bug-230 (work-137): persist the handshake binding — see the retry leg.
        registeredSessions: sessionId ? AgentRepositorySubstrate.appendRegisteredSession(agent.registeredSessions, sessionId) : agent.registeredSessions ?? [],
        // bug-55 Tier 2 — transport-tier bump on reconnect; do NOT bump lastSeenAt.
        lastHeartbeatAt: now,
        receiptSla: payload.receiptSla ?? agent.receiptSla ?? DEFAULT_AGENT_RECEIPT_SLA_MS,
        wakeEndpoint: payload.wakeEndpoint ?? agent.wakeEndpoint ?? null,
      };
      const updated: Agent = { ...stamped, ...computeComponentStates(stamped, Date.parse(now)) };

      let result = await this.putIfMatchAgent(updated, existing.resourceVersion);
      if (!result.ok) {
        // mission-89 Phase 5 (Observation 4): single in-lock retry. The
        // advisory lock prevents same-fingerprint assertIdentity races, but
        // OTHER write paths (heartbeat refresh, claim_session, mark_offline,
        // etc.) write to the same Agent row without holding our lock. A
        // concurrent bump from those paths can lose us the CAS once; a
        // single re-read + retry under-lock resolves it (those paths are
        // brief, non-contentious; second-attempt success rate is ~100%).
        // If second putIfMatch ALSO fails, throw — the codebase has a real
        // contention storm worth surfacing.
        const refreshed = await this.loadAgentWithRevision(existingAgent.id);
        if (!refreshed) {
          throw new Error(
            `[AgentRepositorySubstrate] assertIdentity in-lock retry: Agent ${existingAgent.id} ` +
              `disappeared between putIfMatch attempts for fingerprint=${fingerprint}.`,
          );
        }
        const refreshedAgent = normalizeAgentShape(refreshed.entity);
        const restamped: Agent = {
          ...refreshedAgent,
          // bug-264: un-archive-on-online-transition (retry leg — see above).
          archived: false,
          // bug-230: persist the handshake binding so a rail verb after a hub
          // restart (or from an unclaimed bridge session) still resolves the
          // registered identity instead of stamping anonymous-<role>.
          registeredSessions: sessionId ? AgentRepositorySubstrate.appendRegisteredSession(refreshedAgent.registeredSessions, sessionId) : refreshedAgent.registeredSessions ?? [],
          clientMetadata: payload.clientMetadata,
          advisoryTags: refreshedAdvisoryTags,
          labels: nextLabels,
          lastHeartbeatAt: now,
          receiptSla: payload.receiptSla ?? refreshedAgent.receiptSla ?? DEFAULT_AGENT_RECEIPT_SLA_MS,
          wakeEndpoint: payload.wakeEndpoint ?? refreshedAgent.wakeEndpoint ?? null,
        };
        const reupdated: Agent = { ...restamped, ...computeComponentStates(restamped, Date.parse(now)) };
        result = await this.putIfMatchAgent(reupdated, refreshed.resourceVersion);
        if (!result.ok) {
          throw new Error(
            `[AgentRepositorySubstrate] assertIdentity in-lock retry exhausted: putIfMatch conflict ` +
              `persisted across 2 attempts for agentId=${refreshedAgent.id}, fingerprint=${fingerprint}. ` +
              `Indicates concurrent non-assertIdentity writer storm; investigate heartbeat-path or ` +
              `claim_session contention telemetry.`,
          );
        }
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
    });
  }

  async claimSession(
    agentId: string,
    sessionId: string,
    trigger: ClaimSessionTrigger,
  ): Promise<ClaimSessionResult> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = await this.loadAgentWithRevision(agentId);
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
        const tripped = recordDisplacementAndCheck(history, this.clock.now().getTime());
        this.displacementHistory.set(agent.fingerprint, history);
        if (tripped) {
          return {
            ok: false,
            code: "agent_thrashing_detected",
            message: `Agent ${agent.id} exceeded ${THRASHING_THRESHOLD} displacements in ${THRASHING_WINDOW_MS / 1000}s — halting to prevent fork-bomb. Check ~/.ois/instance.json for duplicate processes.`,
          };
        }
      }
      const now = this.clock.now().toISOString();
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
        // bug-230 (work-137): displacement REVOKES the old session's persisted
        // binding — the mission-19 invariant (only the new session resolves)
        // holds through the fallback path too; the new session is appended.
        registeredSessions: AgentRepositorySubstrate.appendRegisteredSession(
          (agent.registeredSessions ?? []).filter((sid) => sid !== displaced?.sessionId),
          sessionId,
        ),
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
      const result = await this.putIfMatchAgent(updated, existing.resourceVersion);
      if (!result.ok) {
        continue;
      }
      this.sessionToEngineerId.set(sessionId, updated.id);
      this.lastTouchAt.set(updated.id, this.clock.now().getTime());
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
    const raw = await this.loadAgent(agentId);
    if (!raw) return null;
    return applyLivenessRecompute(normalizeAgentShape(raw), this.clock.now().getTime());
  }

  async getAgentForSession(sessionId: string): Promise<Agent | null> {
    const agentId = this.sessionToEngineerId.get(sessionId);
    if (agentId) return this.getAgent(agentId);
    // bug-230 (work-137): the in-memory map dies with the process while the
    // session AND the Agent row both survive — the row persists the binding
    // as currentSessionId (written at claim/handshake). A rail verb arriving
    // after a hub restart used to stamp anonymous-<role> (a dead-letter id
    // that defeated the bug-229 minter-targeted wake live). Fall back to the
    // PERSISTED binding and rehydrate the map; a genuinely unregistered
    // session matches no row and keeps the anonymous stamp (no invented
    // identity). One row-scan per unknown session per process — fleet-scale.
    const rows = await this.listAgents();
    const match = rows.find((a) => !a.archived && (a.currentSessionId === sessionId || (a.registeredSessions ?? []).includes(sessionId)));
    if (!match) return null;
    this.sessionToEngineerId.set(sessionId, match.id);
    console.log(`[AgentRepositorySubstrate] session→agent binding rehydrated from the persisted row: ${sessionId} → ${match.id} (bug-230)`);
    return match;
  }

  async listAgents(): Promise<Agent[]> {
    // Substrate-API kind-uniform list; no path-scan + no by-fingerprint mirror skip.
    const items = await this.listAgentsRaw({ limit: 500 });
    const nowMs = this.clock.now().getTime();
    return items.map((a) => applyLivenessRecompute(normalizeAgentShape(a), nowMs));
  }

  async selectAgents(selector: Selector): Promise<Agent[]> {
    const nowMs = this.clock.now().getTime();
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
    const now = this.clock.now().getTime();
    const last = this.lastTouchAt.get(agentId) ?? 0;
    if (now - last < AGENT_TOUCH_MIN_INTERVAL_MS) return;
    this.lastTouchAt.set(agentId, now);

    const existing = await this.loadAgentWithRevision(agentId);
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
    await this.putIfMatchAgent(updated, existing.resourceVersion);
  }

  async refreshHeartbeat(agentId: string): Promise<void> {
    const existing = await this.loadAgentWithRevision(agentId);
    if (!existing) return;
    const agent = normalizeAgentShape(existing.entity);
    const nowMs = this.clock.now().getTime();
    const stamped: Agent = {
      ...agent,
      lastHeartbeatAt: new Date(nowMs).toISOString(),
      livenessState: "online",
    };
    const components = computeComponentStates(stamped, nowMs);
    const updated: Agent = { ...stamped, ...components };
    await this.putIfMatchAgent(updated, existing.resourceVersion);
  }

  async setLivenessState(agentId: string, state: AgentLivenessState): Promise<void> {
    const existing = await this.loadAgentWithRevision(agentId);
    if (!existing) return;
    const agent = normalizeAgentShape(existing.entity);
    const updated: Agent = { ...agent, livenessState: state };
    await this.putIfMatchAgent(updated, existing.resourceVersion);
  }

  // ── C1-R2 (mission-94) — WorkItem claim-thrash quarantine ──────────────────
  // CAS-retry loops (NOT silent-skip-on-conflict like touchAgent) so a concurrent
  // heartbeat write never drops a thrash increment / reset.

  async recordWorkItemThrash(agentId: string, quarantineCap: number): Promise<{ thrashCount: number; quarantined: boolean } | null> {
    for (let attempt = 0; attempt < WORKITEM_THRASH_CAS_RETRIES; attempt++) {
      const existing = await this.loadAgentWithRevision(agentId);
      if (!existing) return null;
      const agent = normalizeAgentShape(existing.entity);
      const thrashCount = agent.thrashCount + 1;
      const quarantined = agent.quarantined || thrashCount >= quarantineCap;
      const updated: Agent = { ...agent, thrashCount, quarantined };
      const result = await this.putIfMatchAgent(updated, existing.resourceVersion);
      if (result.ok) return { thrashCount, quarantined };
      // revision-mismatch → re-read + retry (don't lose the increment)
    }
    return null; // best-effort: exhausted retries — never crash the sweep
  }

  /** Returns the PRIOR thrashCount (0 if no-op) so the caller can audit a NON-NOOP reset
   *  (audit-4133). Quarantined is cleared only by the manual clear path. */
  async resetWorkItemThrash(agentId: string): Promise<number> {
    for (let attempt = 0; attempt < WORKITEM_THRASH_CAS_RETRIES; attempt++) {
      const existing = await this.loadAgentWithRevision(agentId);
      if (!existing) return 0;
      const agent = normalizeAgentShape(existing.entity);
      if (agent.thrashCount === 0) return 0; // no-op
      const prior = agent.thrashCount;
      const updated: Agent = { ...agent, thrashCount: 0 };
      const result = await this.putIfMatchAgent(updated, existing.resourceVersion);
      if (result.ok) return prior;
      // revision-mismatch → retry
    }
    return 0; // exhausted retries (best-effort)
  }

  async clearWorkItemQuarantine(agentId: string): Promise<void> {
    for (let attempt = 0; attempt < WORKITEM_THRASH_CAS_RETRIES; attempt++) {
      const existing = await this.loadAgentWithRevision(agentId);
      if (!existing) return;
      const agent = normalizeAgentShape(existing.entity);
      if (agent.thrashCount === 0 && !agent.quarantined) return; // no-op
      const updated: Agent = { ...agent, thrashCount: 0, quarantined: false };
      const result = await this.putIfMatchAgent(updated, existing.resourceVersion);
      if (result.ok) return;
    }
  }

  async updateAgentPulseLastFiredAt(agentId: string, lastFiredAt: string): Promise<void> {
    const existing = await this.loadAgentWithRevision(agentId);
    if (!existing) return;
    const agent = normalizeAgentShape(existing.entity);
    if (!agent.pulseConfig) return;
    const updated: Agent = {
      ...agent,
      pulseConfig: { ...agent.pulseConfig, lastFiredAt },
    };
    await this.putIfMatchAgent(updated, existing.resourceVersion);
  }

  // ── Mission-62 W1+W2 Pass 2: activity FSM transition handlers ──────

  async setActivityState(agentId: string, state: ActivityState): Promise<void> {
    const existing = await this.loadAgentWithRevision(agentId);
    if (!existing) return;
    const agent = normalizeAgentShape(existing.entity);
    const updated: Agent = { ...agent, activityState: state };
    await this.putIfMatchAgent(updated, existing.resourceVersion);
  }

  async recordToolCallStart(agentId: string, toolName: string): Promise<void> {
    const existing = await this.loadAgentWithRevision(agentId);
    if (!existing) return;
    const agent = normalizeAgentShape(existing.entity);
    const now = this.clock.now().toISOString();
    const updated: Agent = {
      ...agent,
      activityState: "online_working",
      lastToolCallAt: now,
      lastToolCallName: toolName,
      workingSince: now,
      idleSince: null,
    };
    await this.putIfMatchAgent(updated, existing.resourceVersion);
  }

  async recordToolCallComplete(agentId: string): Promise<void> {
    const existing = await this.loadAgentWithRevision(agentId);
    if (!existing) return;
    const agent = normalizeAgentShape(existing.entity);
    const now = this.clock.now().toISOString();
    const updated: Agent = {
      ...agent,
      activityState: "online_idle",
      idleSince: now,
      workingSince: null,
    };
    await this.putIfMatchAgent(updated, existing.resourceVersion);
  }

  async recordQuotaBlocked(agentId: string, retryAfterSeconds: number): Promise<void> {
    const existing = await this.loadAgentWithRevision(agentId);
    if (!existing) return;
    const agent = normalizeAgentShape(existing.entity);
    const nowMs = this.clock.now().getTime();
    const quotaBlockedUntil = new Date(nowMs + retryAfterSeconds * 1000).toISOString();
    const updated: Agent = {
      ...agent,
      activityState: "online_quota_blocked",
      quotaBlockedUntil,
      workingSince: null,
    };
    await this.putIfMatchAgent(updated, existing.resourceVersion);
  }

  async recordQuotaRecovered(agentId: string): Promise<void> {
    const existing = await this.loadAgentWithRevision(agentId);
    if (!existing) return;
    const agent = normalizeAgentShape(existing.entity);
    const now = this.clock.now().toISOString();
    const updated: Agent = {
      ...agent,
      activityState: "online_idle",
      idleSince: now,
      quotaBlockedUntil: null,
    };
    await this.putIfMatchAgent(updated, existing.resourceVersion);
  }

  async recordAgentError(agentId: string, error: AgentErrorRecord): Promise<void> {
    const existing = await this.loadAgentWithRevision(agentId);
    if (!existing) return;
    const agent = normalizeAgentShape(existing.entity);
    const nextErrors = [...agent.recentErrors, error];
    while (nextErrors.length > AGENT_RECENT_ERRORS_CAP) nextErrors.shift();
    const updated: Agent = { ...agent, recentErrors: nextErrors };
    await this.putIfMatchAgent(updated, existing.resourceVersion);
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

    const existing = await this.loadAgentWithRevision(agentId);
    if (!existing) return;
    const agent = normalizeAgentShape(existing.entity);
    if (agent.currentSessionId !== sessionId) return;
    const updated: Agent = {
      ...agent,
      status: "offline",
      livenessState: "offline",
      lastSeenAt: this.clock.now().toISOString(),
    };
    const result = await this.putIfMatchAgent(updated, existing.resourceVersion);
    if (!result.ok) return;
    console.log(`[AgentRepositorySubstrate] Agent marked offline: ${agentId}`);
  }

  /**
   * bug-264: Tombstone an Agent (append-only soft-delete) by setting archived=true
   * via CAS — mirrors markAgentOffline. The Agent Reaper calls this INSTEAD of
   * deleteAgent so dead seats drop out of the default get_agents view WITHOUT
   * violating the append-only ('never deleted') registry invariant. Idempotent.
   * A returning seat clears archived on its next assertIdentity (un-archive-on-
   * online-transition), so a tombstone is a view filter, not amnesia. Returns
   * true if the agent is (now or already) archived, false if not found / CAS-lost.
   */
  async archiveAgent(agentId: string): Promise<boolean> {
    const existing = await this.loadAgentWithRevision(agentId);
    if (!existing) return false;
    const agent = normalizeAgentShape(existing.entity);
    if (agent.archived) return true; // already tombstoned — idempotent
    const updated: Agent = { ...agent, archived: true };
    const result = await this.putIfMatchAgent(updated, existing.resourceVersion);
    if (!result.ok) return false;
    console.log(`[AgentRepositorySubstrate] Agent archived (tombstone): ${agentId}`);
    return true;
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
    const nowMs = this.clock.now().getTime();
    const stale: Agent[] = [];
    for (const a of agents) {
      // bug-264 fast-follow: an already-tombstoned (archived) seat is NOT a
      // re-reap candidate — skip it so the reaper doesn't repeat the cascade-
      // unpin + archiveAgent (idempotent) + agent_reaper_archived audit on every
      // sweep. The tombstone stays queryable via get_agents includeTombstoned.
      if (a.archived) continue;
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
    const existing = await this.loadAgent(agentId);
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
