/**
 * State interfaces and in-memory implementation for the MCP Relay Hub.
 *
 * Defines IEngineerRegistry + peer store interfaces that can be backed
 * by either in-memory storage (local dev) or GCS (production).
 *
 * work-162 (A1): the Task entity + TaskStatus + ITaskStore were retired
 * with the Task subsystem. Historical Task rows remain immutable in the
 * substrate (A4 zero-loss); there is no read path or type.
 */

export type SessionRole = "engineer" | "architect" | "director" | "verifier" | "unknown";

/**
 * Mission-24 Phase 2 (ADR-014): cascade-spawn provenance metadata
 * attached to any entity created by a cascade handler. `sourceThreadId`
 * + `sourceActionId` form the natural idempotency key (INV-TH20);
 * `sourceThreadSummary` preserves the decision narrative per INV-TH23
 * (Summary-as-Living-Record) even if the source thread is later
 * archived or expired.
 */
export interface CascadeBacklink {
  sourceThreadId: string;
  sourceActionId: string;
  sourceThreadSummary: string;
}

/**
 * Mission-24 idea-120 / thread-225 ratified provenance shape. Captures
 * WHO created a given entity via a direct tool call.
 *
 * Orthogonal to `CascadeBacklink` (cascade-provenance) and to mutable
 * current-owner fields like `Task.assignedAgentId`. `createdBy` is
 * set at creation time and never mutates after.
 *
 * - `role`: the caller's role at the moment of creation ("architect" |
 *   "engineer" | "director" | "system" | "unknown" | future roles).
 *   Stored as an open string for forward-compat; consumers should
 *   tolerate unknown values.
 * - `agentId`: stable agent identifier. For Hub-internal (non-agent)
 *   creates — reaper, watchdog, backfill scripts — use "hub-system".
 *   For legacy entities whose provenance can't be recovered from the
 *   audit log, the backfill script writes "legacy-pre-provenance".
 */
export interface EntityProvenance {
  role: string;
  agentId: string;
}

// ── M18: Agent as First-Class Entity ─────────────────────────────────
// Design from thread-79. Decouples stable identity (globalInstanceId)
// from authentication (token) and role (token claim).

export interface AgentClientMetadata {
  clientName: string;          // MCP initialize.clientInfo.name (e.g., "claude-code")
  clientVersion: string;       // MCP initialize.clientInfo.version
  proxyName: string;           // e.g., "@apnex/claude-plugin"
  proxyVersion: string;        // e.g., "1.0.0"
  transport?: string;          // "stdio-mcp-proxy" | "plugin-native"
  sdkVersion?: string;         // e.g., "@apnex/network-adapter@2.0.0"
  hostname?: string;
  platform?: string;
  pid?: number;
  // M-Build-Identity-AdvisoryTag (idea-256): build-identity wire fields
  // sourced from each package's dist/build-info.json (written by the
  // shared scripts/build/write-build-info.js prepack hook). Hub
  // deriveAdvisoryTags projects these into AgentAdvisoryTags.
  proxyCommitSha?: string;     // 7-char short SHA of claude-plugin shim build
  proxyDirty?: boolean;        // claude-plugin built from a dirty tree
  sdkCommitSha?: string;       // 7-char short SHA of network-adapter SDK build
  sdkDirty?: boolean;          // network-adapter built from a dirty tree
}

export interface AgentAdvisoryTags {
  // All fields are best-effort, launch-time-only, subject to drift.
  // DO NOT build routing logic on these.
  llmModel?: string;           // e.g., "claude-opus-4-6"
  // idea-355 SLICE-3 report-both + SLICE-4 AG-8 RETIRE: the intent-aligned
  // version surfaces. The old mislabeled `adapterVersion` (it carried
  // clientMetadata.proxyVersion — the SHIM, not the SDK; the bug-183 lie) was
  // RETIRED in SLICE-4; shimVersion is its exact-value replacement.
  //   shimVersion = clientMetadata.proxyVersion (the SHIM / plugin layer);
  //   sdkVersion  = clientMetadata.sdkVersion  (the KERNEL / network-adapter).
  // (The DIFFERENT top-level Agent.adapterVersion = the kernel version is
  // unrelated and untouched.)
  sdkVersion?: string;         // e.g., "@apnex/network-adapter@0.1.2"
  shimVersion?: string;        // e.g., "0.1.4"
  // M-Build-Identity-AdvisoryTag (idea-256): build-identity projections
  // from clientMetadata. Intent-aligned naming: proxy* = claude-plugin
  // shim layer; sdk* = network-adapter package.
  proxyCommitSha?: string;     // mirrors clientMetadata.proxyCommitSha
  proxyDirty?: boolean;        // mirrors clientMetadata.proxyDirty
  sdkCommitSha?: string;       // mirrors clientMetadata.sdkCommitSha
  sdkDirty?: boolean;          // mirrors clientMetadata.sdkDirty
  [key: string]: unknown;
}

export type AgentRole = "engineer" | "architect" | "director" | "verifier";
export type AgentStatus = "online" | "offline";

// Mission-19: routing metadata. Keys/values are caller-supplied strings.
// Labels are IMMUTABLE after first registration in v1 — a displacing call
// whose payload.labels differs from the persisted set is silently ignored.
// Reserved key `ois.io/namespace` is reserved for future strict-isolation
// semantics; no special behavior in v1.
export type AgentLabels = Record<string, string>;

/**
 * Mission-19: routing selector. Equality-only matchLabels in v1.
 * An Agent matches iff every (key, value) pair in matchLabels is
 * present and equal in agent.labels. `roles`, when set, further
 * filters to agents whose role ∈ roles. `agentId`, when set,
 * pins dispatch to that specific Agent (P2P routing — t5). An
 * empty selector matches all non-archived, online agents.
 */
export interface Selector {
  agentId?: string;
  /**
   * Pin dispatch to a specific set of Agents by agentId. Used by
   * Threads 2.0 participant-scoped routing (INV-TH16) so replies land
   * only on the actual thread participants, not every Agent sharing
   * the target role. Applied as an AND filter on top of role/labels.
   */
  agentIds?: string[];
  roles?: AgentRole[];
  matchLabels?: Record<string, string>;
}

/** True iff `labels` contains every key/value pair in `matchLabels`. */
export function labelsMatch(labels: AgentLabels, matchLabels?: Record<string, string>): boolean {
  if (!matchLabels) return true;
  for (const [k, v] of Object.entries(matchLabels)) {
    if (labels[k] !== v) return false;
  }
  return true;
}

/**
 * Mission-19: can an Agent with `claimantLabels` claim a Task with `taskLabels`?
 * True iff the task's labels are a subset of the claimant's labels (the
 * claimant carries every routing key the task demands). When the claimant
 * has no labels (undefined), only unlabeled tasks are claimable — legacy
 * behavior for sessions that have not completed the M18 handshake.
 */
export function taskClaimableBy(
  taskLabels: Record<string, string>,
  claimantLabels?: Record<string, string>,
): boolean {
  const taskKeys = Object.keys(taskLabels);
  if (taskKeys.length === 0) return true;
  if (!claimantLabels) return false;
  for (const [k, v] of Object.entries(taskLabels)) {
    if (claimantLabels[k] !== v) return false;
  }
  return true;
}

/**
 * ADR-017 liveness FSM — replaces the boolean online/offline `status`.
 * The legacy `status` field is derived from `livenessState` for backward
 * compatibility (online → "online"; everything else → "offline") during
 * migration; v1 surfaces both.
 */
export type AgentLivenessState = "online" | "degraded" | "unresponsive" | "offline";

/**
 * mission-75 (M-TTL-Liveliness-Design) v1.0 — component-state surface.
 * Simple TTL-derived freshness check on `lastSeenAt` (cognitiveState) and
 * `lastHeartbeatAt` (transportState). PARALLEL observability surfaces to
 * the composite `livenessState` 4-state ADR-017 FSM, NOT inputs to it.
 *
 * `unknown` covers the registration-instant edge case: `lastSeenAt` is
 * null until first tool-call, so post-`claim_session` the natural state
 * is `(cognitive=unknown, transport=alive)` per Design v1.0 §3.1 truth
 * table. Naturally-pending — NOT pathological.
 */
export type ComponentState = "alive" | "unresponsive" | "unknown";

/**
 * mission-75 (M-TTL-Liveliness-Design) v1.0 — per-agent override sub-object
 * for liveness-tuning fields (Design §3.1 v1.0 Director Declarative-Primacy
 * fold). Optional fields; resolution at consumption-site via
 * `resolveLivenessConfig()` precedence chain (agent → env → builtin).
 * Analogous to `AgentPulseConfig`. Sparse persistence — only populated
 * when overrides are set. Interim under idea-242 Vision (declarative
 * config-as-entities).
 */
export interface AgentLivenessConfig {
  peerPresenceWindowMs?: number;
  agentTouchMinIntervalMs?: number;
  transportHeartbeatIntervalMs?: number;
  transportHeartbeatEnabled?: boolean;
}

/**
 * mission-75 (M-TTL-Liveliness-Design) v1.0 — per-agent agentPulse
 * configuration. Fires for agent X iff `enabled === true` AND no active
 * mission has agent X in its pulse-binding (STRICT suppression rule per
 * Design §3.4 M3 fold; permissive alternative explicitly rejected).
 * `lastFiredAt` updated by PulseSweeper on each fire (NULL until first
 * fire). Death-detection-slow-but-cheap signal between missions per
 * envelope hybrid γ pulse architecture.
 */
export interface AgentPulseConfig {
  intervalSeconds: number;
  message: string;
  responseShape: "ack";
  missedThreshold: number;
  enabled: boolean;
  lastFiredAt: string | null;
}

/**
 * Mission-62 (M-Agent-Entity-Revisit) activity FSM — orthogonal to the
 * existing liveness FSM. Tool-call-driven; populated via explicit
 * signal_working_* / signal_quota_* RPCs (W3). Auto-clamp invariant:
 * `livenessState !== "online"` → `activityState = "offline"`.
 *
 * `online_paused` is schema-only this mission; no transitions wired.
 */
export type ActivityState =
  | "offline"
  | "online_idle"
  | "online_working"
  | "online_quota_blocked"
  | "online_paused";

/**
 * Mission-62 error-record entry — populated by adapter-side handshake
 * sweep (W3) on tool-call failures. Size-bounded ring buffer per Agent.
 */
export interface AgentErrorRecord {
  at: string;                          // ISO timestamp
  toolCall: string;                    // tool that errored
  errorClass: string;                  // categorical (e.g. "timeout", "validation", "auth", "internal")
  message: string;                     // truncated free-form
}

/** Mission-62 ring-buffer cap for `recentErrors`. FIFO eviction. */
export const AGENT_RECENT_ERRORS_CAP = 10;

/** Mission-62 rolling-window for `restartCount` accounting. */
export const AGENT_RESTART_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

/** Mission-62 ring-buffer cap for restart-bump timestamps. */
export const AGENT_RESTART_HISTORY_CAP = 50;

export interface Agent {
  id: string;                  // e.g., "eng-abc123xyz" (Hub-issued); entity-internal field per Director Q4 inline-refinement (mission-62 sub-rename). Cross-refs in other entities use `agentId: string`.
  fingerprint: string;         // sha256(globalInstanceId) — token NOT included
  role: AgentRole;
  status: AgentStatus;
  archived: boolean;           // replaces deletion (append-only)
  sessionEpoch: number;        // monotonic, incremented on each displacement
  currentSessionId: string | null; // ephemeral, per SSE connection
  /** bug-230 (work-137): the PERSISTED register_role bindings — rolling list of
   *  session ids that completed a NAMED handshake as this agent (cap 8,
   *  newest-last). Distinct from currentSessionId (the CLAIMED session, which
   *  the displacement machinery owns): a secondary/bridge session registers
   *  here without touching claim discipline, so a hub restart or an unclaimed
   *  bridge no longer degrades rail-verb stamps to anonymous-<role>.
   *  Nullable-tolerant for legacy rows. */
  registeredSessions?: string[] | null;
  clientMetadata: AgentClientMetadata;
  advisoryTags: AgentAdvisoryTags;
  labels: AgentLabels;         // Mission-19: routing metadata, refreshed on every reconnect from handshake payload (CP3 C5 / bug-16).
  firstSeenAt: string;
  lastSeenAt: string;
  // ADR-017 liveness FSM — computed from lastHeartbeatAt + receiptSla.
  livenessState: AgentLivenessState;
  lastHeartbeatAt: string;     // updated on drain_pending_actions; drives FSM
  receiptSla: number;          // ms; per-agent override, default DEFAULT_RECEIPT_SLA_MS
  wakeEndpoint: string | null; // optional durable-wake URL (Cloud Run, etc.)
  // Displacement rate-limit accounting (in-memory, not persisted):
  // see GcsEngineerRegistry.displacementHistory for the in-memory map.

  // ── Mission-62 (M-Agent-Entity-Revisit) — additive Pass 1 ──────────
  // Identity-display field; populated from `OIS_INSTANCE_ID` env at handshake (W3).
  // Defaults to agentId for legacy blobs.
  name: string;
  // Activity FSM — orthogonal to liveness FSM. See ActivityState comment.
  // Auto-clamped to "offline" when livenessState !== "online".
  activityState: ActivityState;
  // Distinct from firstSeenAt; populated at handshake completion (W3).
  sessionStartedAt: string | null;
  // Last tool-call telemetry — un-rate-limited (every call) per Design §2.
  lastToolCallAt: string | null;
  lastToolCallName: string | null;
  // FSM-transition timestamps.
  idleSince: string | null;
  workingSince: string | null;
  // Quota-recovery timer; auto-promotes online_quota_blocked → online_idle on elapse.
  quotaBlockedUntil: string | null;
  // Adapter source-of-truth (e.g. "@apnex/network-adapter@2.1.0"); set at handshake.
  // Distinct from clientMetadata.sdkVersion (which is the raw client-supplied value).
  adapterVersion: string;
  // Hub-side derived from socket peer addr at SSE-stream-open. NOT adapter-supplied (security).
  ipAddress: string | null;
  // Count of sessionEpoch bumps within `AGENT_RESTART_WINDOW_MS` rolling window.
  restartCount: number;
  // FIFO ring buffer; cap=AGENT_RECENT_ERRORS_CAP. Mutated by tool-error hook (W3).
  recentErrors: AgentErrorRecord[];
  // Internal: ring of recent sessionEpoch-bump timestamps (ms epoch). Cap=AGENT_RESTART_HISTORY_CAP.
  // restartCount is computed by filtering this ring against AGENT_RESTART_WINDOW_MS.
  restartHistoryMs: number[];

  // ── mission-75 (M-TTL-Liveliness-Design) v1.0 — liveness component states ──
  // 4 NEW fields: parallel observability surface to the composite
  // `livenessState` 4-state ADR-017 FSM (which stays UNCHANGED). Eager-write
  // semantic per Q5=a — recomputed at signal-arrival in `touchAgent`
  // (cognitive) and `refreshHeartbeat` (transport). See Design v1.0 §3.1
  // truth table for `cognitiveState × transportState` semantics including
  // the registration-instant `(unknown, alive)` edge.
  cognitiveTTL: number | null;       // bug-52: seconds remaining in cognitive presence window (counts down from windowMs); null when lastSeenAt unset; 0 when expired
  transportTTL: number | null;       // bug-52: seconds remaining in transport presence window (counts down from windowMs); null when lastHeartbeatAt unset; 0 when expired
  cognitiveState: ComponentState;    // alive | unresponsive | unknown
  transportState: ComponentState;    // alive | unresponsive | unknown

  // ── mission-75 v1.0 Director Declarative-Primacy fold — per-agent overrides ──
  // Sparse sub-objects; populated only when overrides set. Resolution at
  // consumption-site via `resolveLivenessConfig()` (agent → env → builtin).
  // `pulseConfig` enables per-agent `agentPulse` cadence (60min default; STRICT
  // suppression when agent on any active mission per Design §3.4 M3 fold).
  livenessConfig?: AgentLivenessConfig;
  pulseConfig?: AgentPulseConfig;

  // ── C1-R2 (mission-94) — WorkItem claim-thrash quarantine (status bucket) ──
  // Consecutive claim→lease-expire-WITHOUT-evidence count; reset to 0 on a successful
  // complete_work (progress). At the cap → `quarantined`. The C1→C2 supervisor seam.
  thrashCount: number;
  // Locked out of claim_work once thrashCount hits the cap (the wedged-agent signal the
  // C2 supervisor reads). R2: cleared only by the manual clear verb (C2 auto-recovery deferred).
  quarantined: boolean;
}

export interface RegisterAgentPayload {
  // idea-251 D-prime Phase 2: name IS identity. Required (loud-error if absent).
  // Sourced from OIS_AGENT_NAME env via the M18 handshake. Drives agentId
  // derivation `agent-{8-hex-of-sha256(name)}`. globalInstanceId field RETIRED.
  name: string;
  role: AgentRole;
  clientMetadata: AgentClientMetadata;
  advisoryTags?: AgentAdvisoryTags;
  labels?: AgentLabels;
  // ADR-017 additions: optional liveness-layer configuration.
  wakeEndpoint?: string;
  receiptSla?: number;
}

export interface RegisterAgentSuccess {
  ok: true;
  agentId: string;
  sessionEpoch: number;
  wasCreated: boolean;
  clientMetadata: AgentClientMetadata;
  advisoryTags: AgentAdvisoryTags;
  labels: AgentLabels;
  // CP3 C5 (bug-16): populated on reconnect paths only when one or more
  // mutable handshake fields refresh stored state. `changedFields` names
  // the top-level keys that differ (e.g., ["labels"]); `priorLabels` is
  // the pre-refresh snapshot when labels change, for audit-diff reporting.
  // Absent on first-contact creation and on no-op reconnects.
  changedFields?: readonly ("labels" | "advisoryTags" | "clientMetadata")[];
  priorLabels?: AgentLabels;
  // M-Session-Claim-Separation (mission-40) T1: populated when the internal
  // claimSession call evicted a prior session. Used by the policy layer to
  // emit `agent_session_displaced` audit alongside the implicit-claim audit.
  // Absent on first-contact creation and when no prior session existed.
  displacedPriorSession?: { sessionId: string; epoch: number };
}

export interface RegisterAgentFailure {
  ok: false;
  // idea-251 D-prime Phase 2: `name_collision` added — surfaces upstream from
  // assertIdentity (same name from a different host = operator misconfiguration).
  code: "agent_thrashing_detected" | "role_mismatch" | "name_collision";
  message: string;
}

export type RegisterAgentResult = RegisterAgentSuccess | RegisterAgentFailure;

// ── M-Session-Claim-Separation (mission-40) T1: split helpers ──────────
//
// `assertIdentity` is the idempotent identity-claim half. `claimSession`
// is the displacing session-claim half. T1 wires both internally to the
// existing `registerAgent` path so externally-observable behavior is
// byte-identical to pre-T1; T2 cuts over and exposes claimSession via
// a dedicated MCP tool + SSE-subscribe / first-tools-call hooks.

export type ClaimSessionTrigger = "explicit" | "sse_subscribe" | "first_tool_call";

export interface AssertIdentityPayload {
  // idea-251 D-prime Phase 2: name IS identity. Required input for fingerprint
  // derivation `sha256(name)` → agentId `agent-{first-8-hex}`. Immutable
  // post-create (different name → different fingerprint → different lookup).
  name: string;
  role: AgentRole;
  clientMetadata: AgentClientMetadata;
  advisoryTags?: AgentAdvisoryTags;
  labels?: AgentLabels;
  // ADR-017 mutable config carried through the same handshake-refresh path:
  wakeEndpoint?: string;
  receiptSla?: number;
}

export interface AssertIdentitySuccess {
  ok: true;
  agentId: string;
  wasCreated: boolean;
  clientMetadata: AgentClientMetadata;
  advisoryTags: AgentAdvisoryTags;
  labels: AgentLabels;
  // bug-16 C5 label-refresh diff (only present on reconnect with changes):
  changedFields?: readonly ("labels" | "advisoryTags" | "clientMetadata")[];
  priorLabels?: AgentLabels;
}

export interface AssertIdentityFailure {
  ok: false;
  // idea-251 D-prime Phase 2: `name_collision` added — same name from
  // a different host (operator misconfiguration; loud-error rather than
  // silent last-write-wins on clientMetadata.hostname).
  //
  // mission-88 W10-ext (bug-127 historic): `occ_contention_exhausted` added —
  // transient OCC retry-budget exhausted (NOT a fatal hard-boundary like
  // role_mismatch or name_collision). Callers SHOULD retry. Must NOT be
  // classified as FATAL_CODE in adapter-side handshake handling.
  //
  // @deprecated mission-89 Phase 5 (Observation 4): emit-sites RETIRED —
  // advisory-lock primitive (`withAdvisoryLock(LOCK_CLASS.assertIdentity)`)
  // eliminates the OCC-contention race-class structurally; no remaining
  // code path returns this code. The enum value is RETAINED for:
  //   (1) backward-compatibility — existing caller log-grep / regression-grep
  //   (2) discriminated-union test-coverage (the type-narrowing path is
  //       exercised by unit tests asserting code-discriminator shape)
  // Formal enum-removal deferred to a follow-on idea per Design v1.0 §3 P5.
  code: "role_mismatch" | "name_collision" | "occ_contention_exhausted";
  message: string;
}

export type AssertIdentityResult = AssertIdentitySuccess | AssertIdentityFailure;

export interface ClaimSessionSuccess {
  ok: true;
  agentId: string;
  sessionEpoch: number;
  trigger: ClaimSessionTrigger;
  // Set when a prior session for this agentId was evicted by the claim.
  // Absent when no prior session existed (first claim after assertIdentity)
  // or when the same sessionId is re-claiming (no-op re-bind).
  displacedPriorSession?: { sessionId: string; epoch: number };
}

export interface ClaimSessionFailure {
  ok: false;
  code: "agent_thrashing_detected" | "unknown_engineer";
  message: string;
}

export type ClaimSessionResult = ClaimSessionSuccess | ClaimSessionFailure;

export type ProposalStatus = "submitted" | "approved" | "rejected" | "changes_requested" | "implemented";

export interface ExecutionPlanMission {
  idRef: string;
  title: string;
  description: string;
}

export interface ExecutionPlanTask {
  idRef: string;
  missionRef?: string;
  title: string;
  description: string;
  dependsOn?: string[];
}

export interface ProposedExecutionPlan {
  missions?: ExecutionPlanMission[];
  tasks?: ExecutionPlanTask[];
}

export interface ScaffoldResult {
  missions: Array<{ idRef: string; generatedId: string }>;
  tasks: Array<{ idRef: string; generatedId: string }>;
}

export interface Proposal {
  id: string;
  title: string;
  summary: string;
  proposalRef: string;
  status: ProposalStatus;
  decision: string | null;
  feedback: string | null;
  correlationId: string | null;
  executionPlan: ProposedExecutionPlan | null;
  scaffoldResult: ScaffoldResult | null;
  /** Mission-19: routing labels inherited from creator at submit-time. */
  labels: Record<string, string>;
  /** Mission-24 Phase 2 (ADR-014, INV-TH20/23): cascade-spawn back-links.
   * See Task.sourceThreadId for semantics. */
  sourceThreadId: string | null;
  sourceActionId: string | null;
  sourceThreadSummary: string | null;
  /** Mission-24 idea-120: uniform direct-create provenance (task-305). */
  createdBy?: EntityProvenance;
  createdAt: string;
  updatedAt: string;
}

/**
 * Thread lifecycle terminal states.
 * Mission-21 Phase 1: active | converged | round_limit | closed.
 * Mission-24 Phase 2 (ADR-014): widens with `abandoned` and `cascade_failed`.
 * - `abandoned`: participant-initiated exit via `leave_thread`, or the Hub
 *   idle reaper (`thread_reaper_abandoned` audit action).
 * - `cascade_failed`: post-gate infrastructure failure during the async
 *   execute phase of validate-then-execute cascade (INV-TH19). Thread is
 *   terminal; manual resolution required.
 */
export type ThreadStatus = "active" | "converged" | "round_limit" | "closed" | "abandoned" | "cascade_failed";

/**
 * Mission-24 Phase 2 (ADR-014, INV-TH18): routing mode declared at thread
 * open, immutable for the thread's lifetime. Broadcast coerces to Targeted
 * on first reply (the single permitted mode transition). Context-bound
 * resolves participants dynamically from the bound entity's current
 * assignee(s) at each turn.
 */
/**
 * IP-routing-terminology routing modes (ADR-016, replaces the
 * `targeted` / `context_bound` names from ADR-014):
 *
 *   - unicast    one-to-one pinned dialogue (was "targeted")
 *   - broadcast  one-to-pool discovery by role+labels (present impl
 *                coerces to unicast on first reply — semantically
 *                closer to IP anycast than true broadcast). A future
 *                mode may split these: `anycast` = current behaviour
 *                (closest/first-match pinning), `broadcast` = strict
 *                1-to-all-every-message. Not urgent until a use case
 *                actually needs distinct semantics.
 *   - multicast  one-to-group; membership resolved dynamically from
 *                the bound entity's assignee(s) (was "context_bound")
 *
 * Legacy threads stored with "targeted"/"context_bound" normalize to
 * "unicast"/"multicast" on read via normalizeThreadShape() — no GCS
 * rewrite required.
 */
export type ThreadRoutingMode = "unicast" | "broadcast" | "multicast";

/**
 * Mission-24 Phase 2 (ADR-014): binding for `context_bound` threads.
 * Required when `routingMode === "multicast"`, null otherwise.
 * `entityType` typically one of `task | mission | proposal | idea`;
 * `entityId` is the owning entity's id.
 */
export interface ThreadContext {
  entityType: string;
  entityId: string;
}

export type ThreadIntent = "decision_needed" | "agreement_pending" | "director_input" | "implementation_ready" | null;
// mission-93: verifier is a thread turn-holder so it can reply to directed
// verification threads (the turn-check is currentTurn===author; a verifier
// recipient must therefore be a valid currentTurn role). See verifier-role.md §2.3.
export type ThreadAuthor = "engineer" | "architect" | "verifier";
export type SemanticIntent =
  | "seek_rigorous_critique"
  | "seek_approval"
  | "collaborative_brainstorm"
  | "inform"
  | "seek_consensus"
  | "rubber_duck"
  | "educate"
  | "mediate"
  | "post_mortem"
  | null;

export interface ThreadMessage {
  author: ThreadAuthor;
  /** Mission-21 Phase 1: the Agent.agentId of the specific agent that
   * sent this message. Null for legacy messages from before Threads 2.0. */
  authorAgentId: string | null;
  text: string;
  timestamp: string;
  converged: boolean;
  intent: ThreadIntent;
  semanticIntent: SemanticIntent;
}

// ── Mission-21 Threads 2.0 ──────────────────────────────────────────

/** Participant roles. Director reserved for future (idea-84) — Phase 1
 * populates only engineer and architect from Agent role resolution.
 * Verifier (mission-93) participates in verification threads. */
export type ParticipantRole = "engineer" | "architect" | "director" | "verifier";

export interface ThreadParticipant {
  role: ParticipantRole;
  /** Agent.agentId. Null for future Director pre-idea-84 activation. */
  agentId: string | null;
  joinedAt: string;
  lastActiveAt: string;
}

/**
 * Phase 1 (ADR-013) shipped with `close_no_action` only.
 * Phase 2 (ADR-014) widens the autonomous vocabulary to 8 types total.
 * Director-gated types (create_mission, update_mission_scope, cancel_task)
 * are NOT stageable via `create_thread_reply` — they have direct endpoints.
 */
export type StagedActionType =
  | "close_no_action"
  | "create_idea"
  | "update_idea"
  | "update_mission_status"
  | "propose_mission"
  | "create_clarification"
  | "create_bug";

export type StagedActionStatus =
  | "staged"      // proposed by a reply, not yet committed
  | "revised"     // superseded by a later revision (still in array for lineage)
  | "retracted"   // explicitly withdrawn by the proposer or partner
  | "committed"   // locked in at convergence; about to execute
  | "executed"    // cascade ran successfully
  | "failed";     // cascade attempted but threw

// ── Mission-24 Phase 2 payload shapes (ADR-014) ─────────────────────

/** Phase 1 retained. Used when a thread concludes with no entity-creation. */
export interface CloseNoActionPayload {
  reason: string;
}

// work-162 (A1): CreateTaskActionPayload removed — create_task retired as a
// convergence-spawnable action with the Task subsystem.
// proptool0: CreateProposalActionPayload removed — Proposal creation is no
// longer stageable through thread convergence.

/** Phase 2 autonomous: spawn an Idea from thread convergence. */
export interface CreateIdeaActionPayload {
  title: string;
  description: string;
  tags?: string[];
}

/** Phase 2 autonomous: update an existing Idea's mutable fields. */
export interface UpdateIdeaActionPayload {
  ideaId: string;
  changes: Record<string, unknown>;
}

/** Phase 2 autonomous: transition a Mission between its existing statuses
 * (e.g. active→paused). Scope-widening edits (goal/description) are
 * Director-gated and not in this vocabulary. */
export interface UpdateMissionStatusActionPayload {
  missionId: string;
  status: string;
}

/** Phase 2 autonomous: propose a new Mission in `draft`. Director approval
 * activates. Distinct from Director-gated `create_mission` which bypasses
 * the draft step. */
export interface ProposeMissionActionPayload {
  title: string;
  description: string;
  goals: string[];
}

/** Phase 2 autonomous: spawn a Clarification request. */
export interface CreateClarificationActionPayload {
  question: string;
  context: string;
}

/** M-Cascade-Perfection Phase 2 (ADR-015): spawn a Bug from thread
 *  convergence — e.g., an in-thread code-review discovering a defect.
 *  Class + tags optional (free-text); severity defaults to minor at the
 *  handler if omitted. */
export interface CreateBugActionPayload {
  title: string;
  description: string;
  severity?: "critical" | "major" | "minor";
  class?: string;
  tags?: string[];
  surfacedBy?: string;
}

/** Broad union of all autonomous payload shapes. Validators narrow by
 * the paired `type` discriminator on StagedAction. */
export type StagedActionPayload =
  | CloseNoActionPayload
  | CreateIdeaActionPayload
  | UpdateIdeaActionPayload
  | UpdateMissionStatusActionPayload
  | ProposeMissionActionPayload
  | CreateClarificationActionPayload
  | CreateBugActionPayload;

/**
 * Mission-24 Phase 2 (ADR-014, INV-TH22): proposer widens from bare
 * ParticipantRole to {role, agentId}. Essential for P2P audit trails
 * where multiple agents share a role (engineer↔engineer threads).
 * agentId is nullable for legacy/future-Director entries whose agentId
 * hasn't been resolved.
 */
export interface StagedActionProposer {
  role: ParticipantRole;
  agentId: string | null;
}

interface StagedActionCommon {
  /** Thread-scoped id: "action-1", "action-2", ... allocated in stage order. */
  id: string;
  status: StagedActionStatus;
  /** Mission-24 (INV-TH22): role+agentId of the agent that last staged /
   * revised this action. Widened from ParticipantRole in Phase 2. */
  proposer: StagedActionProposer;
  /** ISO-8601 of most recent stage / revise operation on this entry. */
  timestamp: string;
  /** If this entry revises a prior action, the prior action's id. */
  revisionOf?: string;
  /** Phase 2d CP2 C4 (task-307, bug-14): set by the convergence-gate
   * validator when the action is well-formed but would produce no state
   * change (e.g. update_idea.changes already match current state). The
   * cascade runner observes this flag and short-circuits with a
   * `cascade.idempotent_skip` audit entry instead of performing a
   * redundant write. Only meaningful on `status === "committed"` entries. */
  isNoOp?: boolean;
}

/** Discriminated union on `type` — TypeScript narrows `payload` to the
 * matching shape when `type` is inspected, so handlers and tests can
 * access payload fields without explicit casts. */
export type StagedAction =
  | (StagedActionCommon & { type: "close_no_action"; payload: CloseNoActionPayload })
  | (StagedActionCommon & { type: "create_idea"; payload: CreateIdeaActionPayload })
  | (StagedActionCommon & { type: "update_idea"; payload: UpdateIdeaActionPayload })
  | (StagedActionCommon & { type: "update_mission_status"; payload: UpdateMissionStatusActionPayload })
  | (StagedActionCommon & { type: "propose_mission"; payload: ProposeMissionActionPayload })
  | (StagedActionCommon & { type: "create_clarification"; payload: CreateClarificationActionPayload })
  | (StagedActionCommon & { type: "create_bug"; payload: CreateBugActionPayload });

export type StagedActionOp =
  | { kind: "stage"; type: "close_no_action"; payload: CloseNoActionPayload }
  | { kind: "stage"; type: "create_idea"; payload: CreateIdeaActionPayload }
  | { kind: "stage"; type: "update_idea"; payload: UpdateIdeaActionPayload }
  | { kind: "stage"; type: "update_mission_status"; payload: UpdateMissionStatusActionPayload }
  | { kind: "stage"; type: "propose_mission"; payload: ProposeMissionActionPayload }
  | { kind: "stage"; type: "create_clarification"; payload: CreateClarificationActionPayload }
  | { kind: "stage"; type: "create_bug"; payload: CreateBugActionPayload }
  | { kind: "revise"; id: string; payload: StagedActionPayload }
  | { kind: "retract"; id: string };

/** Subtype enumeration for `ThreadConvergenceGateError`. Aligns with the
 * Phase 2d CP1 observability taxonomy — each subtype maps 1:1 to a
 * metrics bucket detail + a structured remediation hint that the LLM
 * caller can use to self-correct without needing to parse the message
 * string. Phase 2d CP2 (task-304 audit report §5.1). */
export type ConvergenceGateSubtype =
  | "stage_missing"
  | "summary_missing"
  | "payload_validation"
  | "revise_invalid"
  | "retract_invalid"
  | "authority"
  | "stale_reference"
  | "invalid_transition";

/** Canonical remediation text per subtype. Throw sites may override with
 * a more specific hint (e.g., when both stage + summary are missing).
 * Text is written for the LLM caller's benefit: short, actionable,
 * references the exact field or shape to populate. */
export const CONVERGENCE_GATE_REMEDIATION: Record<ConvergenceGateSubtype, string> = {
  stage_missing:
    "To signal converged=true, populate `stagedActions` with at least one stage action before replying. For purely-ideation threads (no downstream work): [{kind:\"stage\",type:\"close_no_action\",payload:{reason:\"<short rationale>\"}}].",
  summary_missing:
    "To signal converged=true, also populate `summary` with a non-empty narrative of the thread's agreed outcome. Either party can set or revise across rounds; the latest non-empty value wins.",
  payload_validation:
    "Fix the per-action payload shape errors named in the message, then re-stage (or `revise`) the offending action. Payload schemas live in `hub/src/policy/staged-action-payloads.ts` per action type.",
  revise_invalid:
    "`revise` only applies to actions currently in status=\"staged\". Stage a new action instead when the target was already revised, retracted, or committed.",
  retract_invalid:
    "`retract` only applies to actions currently in status=\"staged\". A committed action cannot be retracted — open a follow-up thread to revise the outcome.",
  authority:
    "Caller's role lacks the authority to commit one or more staged action types. Either have a caller with the required role converge the thread, or `revise` the offending action to a type the current caller can commit.",
  stale_reference:
    "Staged action references an entity that no longer exists (or has been archived/deleted) since stage-time. Revise or retract the action, or stage a replacement that targets a current entity.",
  invalid_transition:
    "Staged action would move an entity through an FSM edge that is no longer valid given the entity's current status. Revise the action (e.g. target a different `newStatus`) or retract if the intent is now moot.",
};

/** Error thrown by the thread store when `converged=true` fails the Phase 1
 * forcing-function gate or when a stage/revise/retract op is structurally
 * invalid. Carries a `subtype` + `remediation` hint so the caller can
 * self-correct without parsing the message string. Phase 2d CP2.
 *
 * Optional `metadata` carries structured payload data for stale_reference
 * (`{entityType, entityId}`) and invalid_transition
 * (`{entityType, entityId, currentStatus, attemptedStatus}`) — lets the
 * caller address the exact entity without re-reading the error message. */
export class ThreadConvergenceGateError extends Error {
  readonly subtype: ConvergenceGateSubtype;
  readonly remediation: string;
  readonly metadata?: Record<string, unknown>;

  constructor(
    message: string,
    subtype: ConvergenceGateSubtype,
    remediation?: string,
    metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ThreadConvergenceGateError";
    this.subtype = subtype;
    this.remediation = remediation ?? CONVERGENCE_GATE_REMEDIATION[subtype];
    this.metadata = metadata;
  }
}

export interface Thread {
  id: string;
  title: string;
  status: ThreadStatus;
  /**
   * Mission-24 Phase 2 (ADR-014, INV-TH18): routing mode declared at
   * open, immutable. Legacy threads (pre-Phase-2) normalize to
   * `"unicast"` — their behaviour mapped cleanly to agent-pinned
   * dispatch via currentTurnAgentId + recipientAgentId. Broadcast and
   * Context-bound are Phase 2 additions; see ADR-014 for semantics.
   */
  routingMode: ThreadRoutingMode;
  /**
   * Mission-24 Phase 2 (ADR-014): entity binding for `context_bound`
   * threads. Required when routingMode === "multicast"; null in the
   * Targeted and Broadcast modes. PolicyRouter resolves participants
   * dynamically from the bound entity's assignee(s) at each turn.
   */
  context: ThreadContext | null;
  /**
   * Mission-24 Phase 2 (ADR-014, INV-TH21): optional per-thread override
   * on the deployment-wide idle-expiry default (typically 7 days). When
   * null, the deployment default applies. A Hub reaper periodically
   * transitions idle threads to `abandoned` with audit action
   * `thread_reaper_abandoned`.
   */
  idleExpiryMs: number | null;
  /**
   * Mission-24 idea-120 / task-305: uniform direct-create provenance.
   * Required. Populated in openThread from the caller's identity —
   * `role` from the `author` param, `agentId` from options.authorAgentId
   * (or an `anonymous-<role>` placeholder when unavailable). Legacy
   * GCS JSON (pre-task-305) carrying `initiatedBy: ThreadAuthor` is
   * upgraded by the migrate-on-read shim in `GcsThreadStore`.
   */
  createdBy: EntityProvenance;
  currentTurn: ThreadAuthor;
  /**
   * Mission-21 Phase 1 (INV-TH17): when non-null, the reply turn is
   * pinned to this specific agentId in addition to the role. Enables
   * engineer↔engineer threads (same role, distinct agents) and prevents
   * a second agent sharing the current-turn role from usurping the reply
   * slot. Null for legacy threads and open-broadcast threads where the
   * first responder in the role pool wins.
   */
  currentTurnAgentId?: string | null;
  roundCount: number;
  maxRounds: number;
  outstandingIntent: ThreadIntent;
  currentSemanticIntent: SemanticIntent;
  correlationId: string | null;
  /**
   * Mission-21 Phase 1: staged and committed convergence actions.
   * Replaces the singular `convergenceAction` field from Mission-11.
   * Entries with `status="staged"` are candidates for commit at the next
   * convergence; entries with `status="committed"` are the definitive
   * outcome set that the cascade will execute. See ADR-013.
   */
  convergenceActions: StagedAction[];
  /**
   * Mission-21 Phase 1: negotiated narrative summary of the thread's
   * outcome. Required non-empty at convergence. Either party can stage
   * or revise this across rounds; the converging party commits the
   * latest version. Distinct from `ConvergenceReport` (Hub-internal
   * per-action execution telemetry). See ADR-013.
   */
  summary: string;
  /**
   * Mission-21 Phase 1: participants tracked openly (no pinning in v1).
   * Upserted on every reply — new {role, agentId} gets appended;
   * existing entries update lastActiveAt. Enables engineer-to-engineer
   * collaboration within a single thread. See ADR-013.
   */
  participants: ThreadParticipant[];
  /**
   * Mission-21 Phase 1 (INV-TH16): optional intended recipient at open.
   * When set, the open-time `thread_message` dispatch is scoped to this
   * specific agent (via Selector.agentIds) rather than broadcasting
   * to the recipient role. Enables engineer↔engineer threads with true
   * isolation from other engineers sharing the same role/labels. Reply
   * dispatch always routes to thread.participants[] — `recipientAgentId`
   * exists solely to bootstrap the first notification before participants
   * has more than the opener.
   */
  recipientAgentId?: string | null;
  messages: ThreadMessage[];
  /** Mission-19: routing labels inherited from creator at open-time. */
  labels: Record<string, string>;
  /**
   * Mission-20 Phase 3: the `converged` flag of the most recent message,
   * tracked as a scalar so the reply transform no longer needs to RMW
   * the `messages[]` array to evaluate two-in-a-row convergence. In the
   * GCS backend, messages themselves now live one-per-file under
   * `threads/{id}/messages/{seq}.json`. Optional for forward compat with
   * pre-Phase-3 stored threads (treated as `false`).
   */
  lastMessageConverged?: boolean;
  createdAt: string;
  updatedAt: string;
  /**
   * Mission-51 W2: ISO-8601 timestamp of the latest projection write
   * to the sovereign Message store. Bounded-lag sweeper compares this
   * to `updatedAt` — if `lastMessageProjectedAt < updatedAt` (or
   * absent), the thread has unprojected messages and the sweeper will
   * re-project on next tick. Optional for forward compat with
   * pre-W2 stored threads (treated as "never projected"). Idempotency
   * via `findByMigrationSourceId` short-circuit means re-projection
   * produces no duplicates; the marker is an OPTIMIZATION to skip
   * already-projected threads, NOT a correctness gate.
   */
  lastMessageProjectedAt?: string;

  /**
   * Mission-51 W5: cascade-pending marker. True iff `runCascade` was
   * invoked but has not yet completed (success OR failure-isolated).
   * Written via `markCascadePending` before cascade; cleared via
   * `markCascadeCompleted` after. The Hub-startup CascadeReplaySweeper
   * lists threads with `cascadePending: true` and re-runs `runCascade`
   * for each — closes the orphaned-mid-cascade gap that bug-31
   * variants 1+2 surfaced when the Hub process dies before all
   * cascade actions complete.
   *
   * The marker is OPTIMIZATION-not-correctness: cascade-action
   * idempotency (per-action `findByCascadeKey` short-circuit on
   * already-spawned entities) is the load-bearing mechanism that
   * prevents duplication on replay. The marker tells the sweeper
   * which threads to scan; the idempotency keys handle correct
   * re-execution.
   */
  cascadePending?: boolean;

  /** Mission-51 W5: count of committed actions at cascade start.
   *  Telemetry/diagnostics only — not consumed by replay logic. */
  cascadePendingActionCount?: number;

  /** Mission-51 W5: ISO-8601 timestamp of cascade start. Diagnostic. */
  cascadePendingStartedAt?: string;

  /** Mission-51 W5: ISO-8601 timestamp of cascade completion (success
   *  OR failure-isolated terminal). Diagnostic. */
  cascadeCompletedAt?: string;
}

// ── Audit Types ──────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: "architect" | "engineer" | "verifier" | "hub";
  action: string;
  details: string;
  relatedEntity: string | null; // e.g., "task-24", "prop-7", "thread-3"
}

// ── Interfaces ───────────────────────────────────────────────────────

// Mission-56 W4.2 + W5: legacy `Notification` entity + `INotificationStore`
// removed. Hub-event-bus → SSE injection now flows through the Message
// store as `kind: "external-injection"` Messages (see
// `hub/src/policy/notification-helpers.ts`).

export interface IAuditStore {
  logEntry(actor: AuditEntry["actor"], action: string, details: string, relatedEntity?: string): Promise<AuditEntry>;
  listEntries(limit?: number, actor?: AuditEntry["actor"]): Promise<AuditEntry[]>;
}

/**
 * Mission-21 Phase 1: Threads 2.0 — options bag for reply operations
 * to keep the interface readable as we add stagedActions, summary, and
 * authorAgentId alongside existing converged/intent/semanticIntent.
 */
export interface ReplyToThreadOptions {
  converged?: boolean;
  intent?: ThreadIntent;
  semanticIntent?: SemanticIntent;
  /** Optional staging operations applied to convergenceActions[]. */
  stagedActions?: StagedActionOp[];
  /** Optional summary update. Accumulates across rounds; non-empty
   * required at convergence. */
  summary?: string;
  /** Agent.agentId of the author (from engineerRegistry.getAgentForSession).
   * Attached to the new ThreadMessage and upserted into participants. */
  authorAgentId?: string | null;
}

/**
 * Mission-21 Phase 1: options bag for thread creation, introduced to
 * keep the store interface readable as recipientAgentId / recipientRole
 * joined the existing maxRounds / correlationId / labels / authorAgentId
 * mix. The legacy positional signature is no longer supported — all call
 * sites pass options explicitly.
 */
export interface OpenThreadOptions {
  maxRounds?: number;
  correlationId?: string;
  labels?: Record<string, string>;
  authorAgentId?: string | null;
  /** INV-TH16: pin the open-time dispatch to this agentId. */
  recipientAgentId?: string | null;
  /**
   * INV-TH17: recipient's role — used to set currentTurn correctly
   * when the recipient is in the same role as the opener (engineer↔
   * engineer threads). Resolved by the policy layer from engineerRegistry
   * on open; when absent, currentTurn uses the legacy role-flip formula.
   */
  recipientRole?: ThreadAuthor | null;
  /**
   * Mission-24 Phase 2 (ADR-014, INV-TH18): routing mode declared at
   * open. Omitted defaults to "unicast" so legacy callers keep working
   * unchanged. Consistency with mode-specific fields is enforced by the
   * policy layer at create_thread, not here — the store trusts that
   * what the policy hands it is well-formed.
   */
  routingMode?: ThreadRoutingMode;
  /**
   * Mission-24 Phase 2 (ADR-014): required when routingMode==="context_bound",
   * null otherwise. PolicyRouter resolves participants dynamically from the
   * bound entity's assignee(s) at each turn.
   */
  context?: ThreadContext | null;
}

/**
 * Mission-24 Phase 2 (ADR-014, M24-T7): reaper return shape. One entry
 * per active thread that the reaper transitioned to `abandoned`. The
 * caller (index.ts reaper loop) uses this to audit + dispatch
 * thread_abandoned participant-scoped per INV-TH16.
 */
export interface ReapedThread {
  threadId: string;
  title: string;
  labels: Record<string, string>;
  /** Resolved agentIds of current participants. Excludes null agentIds
   * (pre-M18 legacy entries) so the dispatch selector is well-formed. */
  participantAgentIds: string[];
  /** ms of idle time at the moment of reaping. Surfaced in the
   * thread_abandoned event payload for remaining participants. */
  idleMs: number;
}

export interface IThreadStore {
  openThread(title: string, message: string, author: ThreadAuthor, options?: OpenThreadOptions): Promise<Thread>;
  replyToThread(threadId: string, message: string, author: ThreadAuthor, options?: ReplyToThreadOptions): Promise<Thread | null>;
  getThread(threadId: string): Promise<Thread | null>;
  listThreads(status?: ThreadStatus, equalityFilter?: Record<string, string>): Promise<Thread[]>;
  closeThread(threadId: string): Promise<boolean>;
  /**
   * Mission-24 Phase 2 (ADR-014, M24-T6): participant-initiated exit
   * from an active thread. Returns the mutated Thread on success, null
   * when the thread doesn't exist / isn't active / leaver isn't a
   * participant. Side-effects: auto-retracts staged actions proposed by
   * the leaver, transitions status to `abandoned`, stamps updatedAt.
   * Caller (thread-policy) is responsible for the thread_abandoned
   * dispatch + audit entry — see INV-TH16 participant-scoped routing.
   */
  leaveThread(threadId: string, leaverAgentId: string): Promise<Thread | null>;
  /**
   * Mission-24 Phase 2 (ADR-014, M24-T4, INV-TH19): transition a
   * converged thread to `cascade_failed` after the async execute
   * phase encountered a handler failure. "Committed means committed"
   * — the staged→committed promotion already happened; this just
   * records the terminal outcome. Returns true on success, false
   * when the thread doesn't exist or isn't in a transition-eligible
   * state (converged). Distinct from closeThread so observers can
   * tell a clean close from a post-gate infrastructure failure.
   */
  markCascadeFailed(threadId: string): Promise<boolean>;
  /**
   * Mission-51 W2: bump `lastMessageProjectedAt` on a thread to track
   * the bounded-shadow projection sweeper's progress. Idempotent — only
   * advances forward (refuses to write a value older than the current
   * one to avoid races between the in-process projector and the
   * sweeper). Returns true on successful bump (forward-progress), false
   * when the thread doesn't exist OR the proposed value is not strictly
   * newer than the current value (no-op idempotent).
   */
  markLastMessageProjected(threadId: string, projectedAt: string): Promise<boolean>;
  /**
   * Mission-51 W5: write the cascade-pending marker (idempotent CAS
   * update). Sets `cascadePending: true` + `cascadePendingActionCount`
   * + `cascadePendingStartedAt`. Returns true on successful set,
   * false when the thread doesn't exist or the marker is already
   * pending (in which case the existing marker is preserved).
   */
  markCascadePending(threadId: string, actionCount: number): Promise<boolean>;
  /**
   * Mission-51 W5: clear the cascade-pending marker (idempotent CAS
   * update). Sets `cascadePending: false`, clears the diagnostic
   * fields, sets `cascadeCompletedAt` to the current timestamp.
   * Returns true on successful clear, false when the thread doesn't
   * exist (already-cleared returns true since it's a no-op idempotent
   * end state).
   */
  markCascadeCompleted(threadId: string): Promise<boolean>;
  /**
   * Mission-51 W5: list threads with the cascade-pending marker set.
   * Used by the Hub-startup CascadeReplaySweeper to discover
   * orphaned-mid-cascade threads. Returns full Thread (with messages
   * + convergenceActions hydrated) so the sweeper can re-run
   * runCascade against the committed actions.
   */
  listCascadePending(): Promise<Thread[]>;
  /**
   * Mission-24 Phase 2 (ADR-014, M24-T7, INV-TH21): scan all active
   * threads and transition to `abandoned` any whose idle time
   * `(now - updatedAt)` exceeds the per-thread `idleExpiryMs` override
   * or the deployment-default when that's null. Auto-retracts ALL
   * staged actions (no leaver — the thread is dying, nothing commits).
   * Returns the reaped set so the caller can audit with action
   * `thread_reaper_abandoned` and dispatch `thread_abandoned`
   * participant-scoped. Called by the periodic reaper in index.ts.
   */
  reapIdleThreads(defaultIdleExpiryMs: number): Promise<ReapedThread[]>;
  /**
   * CP3 C4 (bug-16 part 1): find all threads whose `currentTurnAgentId`
   * pins to the given victim agentId and null-out the pin so other
   * participants (or a freshly-minted successor fingerprint) can resume
   * the conversation. Called by the Agent reaper in index.ts immediately
   * before the Agent record is deleted, so no thread ends up pinned to
   * a non-existent agent. Returns the threadIds that were unpinned
   * (non-empty only when the agent held at least one pin).
   */
  unpinCurrentTurnAgent(agentId: string): Promise<string[]>;
}

export interface IProposalStore {
  submitProposal(title: string, summary: string, body: string, correlationId?: string, executionPlan?: ProposedExecutionPlan, labels?: Record<string, string>, backlink?: CascadeBacklink, createdBy?: EntityProvenance): Promise<Proposal>;
  setScaffoldResult(proposalId: string, result: ScaffoldResult): Promise<boolean>;
  getProposals(status?: ProposalStatus): Promise<Proposal[]>;
  getProposal(proposalId: string): Promise<Proposal | null>;
  reviewProposal(proposalId: string, decision: ProposalStatus, feedback: string): Promise<boolean>;
  closeProposal(proposalId: string): Promise<boolean>;
  /**
   * Mission-24 Phase 2 (ADR-014, INV-TH20): look up a Proposal by the
   * natural idempotency key {sourceThreadId, sourceActionId}. Returns
   * null when no Proposal has been spawned from that thread+action pair.
   */
  findByCascadeKey(key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">): Promise<Proposal | null>;
}

// work-162 (A1): ITaskStore retired — Task verbs/cascade/stores cut. The `Task`
// read-shape above is preserved for frozen historical-row reads per A4; there is
// no store interface to mutate or produce Tasks.

export interface IEngineerRegistry {
  /** Bare role-set used by the legacy register_role path and auto-register in task-policy. */
  setSessionRole(sessionId: string, role: SessionRole): void;
  getRole(sessionId: string): SessionRole;
  // M18: Agent entity operations.
  registerAgent(sessionId: string, tokenRole: AgentRole, payload: RegisterAgentPayload, address?: string): Promise<RegisterAgentResult>;
  /**
   * M-Session-Claim-Separation (mission-40) T1 — idempotent identity
   * assertion. Ensures Agent record exists with the given fingerprint+
   * role+labels. Refreshes mutable handshake fields (labels, advisoryTags,
   * clientMetadata, receiptSla, wakeEndpoint, lastSeenAt) per the bug-16
   * C5 label-refresh contract — DOES NOT redefine those semantics, just
   * invokes the same code path. NEVER touches sessionEpoch, currentSessionId,
   * status, livenessState, lastHeartbeatAt, or SSE stream.
   *
   * Session work belongs to claimSession(). Caller decides whether/when
   * to claim a session for the asserted identity. T1 invokes both helpers
   * from registerAgent() under the hood; T2 wires the new MCP tool +
   * SSE-subscribe / first-tools-call hooks.
   */
  assertIdentity(payload: AssertIdentityPayload, sessionId?: string, address?: string): Promise<AssertIdentityResult>;
  /**
   * M-Session-Claim-Separation (mission-40) T1 — single helper for all
   * session-claim paths. Increments sessionEpoch, binds currentSessionId
   * to the supplied sessionId, evicts the prior session (if any).
   *
   * `trigger` distinguishes call paths for audit emission and the §10
   * deprecation-runway dashboard:
   * - "explicit"        : called by the new claim_session MCP tool (T2)
   * - "sse_subscribe"   : called from the SSE-stream-open hook (T2 back-compat)
   * - "first_tool_call" : called from the first-tools/call hook (T2 back-compat)
   *
   * In T1, only invoked by registerAgent() with trigger="sse_subscribe"
   * to preserve byte-identical external behavior of register_role.
   * Returns displacedPriorSession when a prior session was evicted —
   * the policy layer uses this to emit `agent_session_displaced` audit
   * alongside the claim audit.
   */
  claimSession(agentId: string, sessionId: string, trigger: ClaimSessionTrigger): Promise<ClaimSessionResult>;
  getAgent(agentId: string): Promise<Agent | null>;
  /** Mission-19: resolve the Agent bound to an SSE session (null if none). */
  getAgentForSession(sessionId: string): Promise<Agent | null>;
  // ── C1-R2 (mission-94) — WorkItem claim-thrash quarantine ──
  /** Increment the agent's claim-thrash counter (a lease expired without evidence);
   *  quarantines at `quarantineCap`. CAS-retry so increments aren't lost. Returns the
   *  new {thrashCount, quarantined} (null if the agent is absent). */
  recordWorkItemThrash(agentId: string, quarantineCap: number): Promise<{ thrashCount: number; quarantined: boolean } | null>;
  /** Reset the thrash counter to 0 on demonstrated progress (a successful complete_work).
   *  Returns the PRIOR thrashCount (0 if no-op) so the caller can audit a non-noop reset.
   *  Does NOT clear `quarantined` (that is the manual clear path). */
  resetWorkItemThrash(agentId: string): Promise<number>;
  /** Manual quarantine escape (R2 interim; architect/director-authorized at the policy
   *  layer): clear `quarantined` + reset the thrash counter. C2 auto-recovery deferred. */
  clearWorkItemQuarantine(agentId: string): Promise<void>;
  listAgents(): Promise<Agent[]>;
  /** Mission-19: return non-archived, online agents matching the selector (role ∧ matchLabels equality). */
  selectAgents(selector: Selector): Promise<Agent[]>;
  migrateAgentQueue(sourceEngineerId: string, targetEngineerId: string): Promise<{ moved: number }>;
  /** Heartbeat: bump lastSeenAt (and flip status back to online if it drifted) for the Agent bound to this session. Rate-limited per agent. */
  touchAgent(sessionId: string): Promise<void>;
  /** Mark the Agent bound to this session offline. Called on session teardown. */
  markAgentOffline(sessionId: string): Promise<void>;
  /** ADR-017: bump `lastHeartbeatAt` and force `livenessState` to "online" for
   *  an agent that demonstrably drained its queue. Unlike touchAgent (which is
   *  rate-limited), this is called only on authentic drain events and is not
   *  rate-limited — drains are infrequent enough to flush every time. */
  refreshHeartbeat(agentId: string): Promise<void>;
  /** ADR-017: flip `livenessState` on an agent (used by the watchdog's
   *  demotion ladder). No-op for unknown agents. */
  setLivenessState(agentId: string, state: AgentLivenessState): Promise<void>;
  /** mission-75 v1.0 §3.4 — sweeper-managed agentPulse bookkeeping. Updates
   *  `agent.pulseConfig.lastFiredAt` on each per-agent pulse fire. No-op
   *  for unknown agents OR agents without `pulseConfig`. */
  updateAgentPulseLastFiredAt(agentId: string, lastFiredAt: string): Promise<void>;
  // ── Mission-62 (M-Agent-Entity-Revisit) — activity FSM transition handlers ──
  /** Mission-62 W1+W2 Pass 2: write `activityState`. Auto-clamp invariant
   *  (livenessState !== "online" → activityState = "offline") is enforced
   *  read-side in normalizeAgentShape; this writer accepts any value and
   *  the projection clamps on subsequent reads. No-op for unknown agents. */
  setActivityState(agentId: string, state: ActivityState): Promise<void>;
  /** Mission-62 W1+W2 Pass 2: tool-call-start FSM transition. Sets
   *  activityState=online_working + lastToolCallAt + lastToolCallName +
   *  workingSince; clears idleSince. No-op for unknown agents. */
  recordToolCallStart(agentId: string, toolName: string): Promise<void>;
  /** Mission-62 W1+W2 Pass 2: tool-call-complete FSM transition. Sets
   *  activityState=online_idle + idleSince=now; clears workingSince.
   *  No-op for unknown agents. */
  recordToolCallComplete(agentId: string): Promise<void>;
  /** Mission-62 W1+W2 Pass 2: quota-block FSM transition (composes with
   *  idea-109 signal_quota_blocked). Sets activityState=online_quota_blocked
   *  + quotaBlockedUntil = now + retryAfterSeconds * 1000; clears
   *  workingSince. No-op for unknown agents. */
  recordQuotaBlocked(agentId: string, retryAfterSeconds: number): Promise<void>;
  /** Mission-62 W1+W2 Pass 2: quota-recovery FSM transition. Sets
   *  activityState=online_idle + idleSince=now; clears quotaBlockedUntil.
   *  No-op for unknown agents. */
  recordQuotaRecovered(agentId: string): Promise<void>;
  /** Mission-62 W1+W2 Pass 2: append a tool-error entry to the agent's
   *  recentErrors ring buffer (FIFO eviction; cap=AGENT_RECENT_ERRORS_CAP).
   *  No-op for unknown agents. */
  recordAgentError(agentId: string, error: AgentErrorRecord): Promise<void>;
  /**
   * CP3 C4 (bug-16 part 1): return Agent records whose last-seen timestamp
   * is older than `staleThresholdMs` AND whose current state is offline
   * (either `status === "offline"` or `livenessState === "offline"`).
   * Caller is the background Agent reaper in index.ts; it cascades the
   * unpin on the thread side before calling `deleteAgent` for each.
   */
  listOfflineAgentsOlderThan(staleThresholdMs: number): Promise<Agent[]>;
  /**
   * CP3 C4 (bug-16 part 1): permanently delete the Agent record + the
   * by-fingerprint alias for this agentId. Returns `true` if a record
   * was removed, `false` if no such agent existed. The caller (reaper)
   * is responsible for the audit + any pre-delete cascades (thread
   * unpinning in particular).
   */
  deleteAgent(agentId: string): Promise<boolean>;
}

/**
 * Minimum interval between persisted Agent heartbeat writes (per agent).
 * mission-75 v1.0 Director Declarative-Primacy fold — env-ified via
 * `AGENT_TOUCH_MIN_INTERVAL_MS` env var (default 30_000; backward-compatible).
 * Per-agent override via `agent.livenessConfig.agentTouchMinIntervalMs?` —
 * resolved at consumption-site via `resolveLivenessConfig()`.
 */
export const AGENT_TOUCH_MIN_INTERVAL_MS_DEFAULT = 30_000;
export const AGENT_TOUCH_MIN_INTERVAL_MS: number =
  Number.isFinite(Number(process.env.AGENT_TOUCH_MIN_INTERVAL_MS))
    ? Number(process.env.AGENT_TOUCH_MIN_INTERVAL_MS)
    : AGENT_TOUCH_MIN_INTERVAL_MS_DEFAULT;

/**
 * Cognitive-presence window — `cognitivelyStale = !isPeerPresent(agent)`
 * collapses 60s threshold into existing PEER_PRESENCE_WINDOW_MS invariant
 * per Design v1.0 §3.5 M4 fold. Net win: 1 invariant not 2.
 *
 * mission-75 v1.0 Director Declarative-Primacy fold — env-ified
 * (`PEER_PRESENCE_WINDOW_MS` env var; default 60_000; backward-compatible).
 * Per-agent override via `agent.livenessConfig.peerPresenceWindowMs?` —
 * resolved at consumption-site. Closes F3 mitigation strategy structurally:
 * operator can tune via env without code change; specific agents can
 * override at registration time.
 */
export const PEER_PRESENCE_WINDOW_MS_DEFAULT = 60_000;
export const PEER_PRESENCE_WINDOW_MS: number =
  Number.isFinite(Number(process.env.PEER_PRESENCE_WINDOW_MS))
    ? Number(process.env.PEER_PRESENCE_WINDOW_MS)
    : PEER_PRESENCE_WINDOW_MS_DEFAULT;

/**
 * Transport heartbeat cadence — adapter-side poll-backstop second 30s
 * timer fires `transport_heartbeat` MCP tool, bumping `lastHeartbeatAt`.
 * Matches transport-HB threshold derivation per Design v1.0 §3.3.
 *
 * mission-75 v1.0 — env-ified (`TRANSPORT_HEARTBEAT_INTERVAL_MS` env var;
 * default 30_000; minimum 10_000 per design §3.3). Per-agent override via
 * `agent.livenessConfig.transportHeartbeatIntervalMs?`.
 */
export const TRANSPORT_HEARTBEAT_INTERVAL_MS_DEFAULT = 30_000;
export const TRANSPORT_HEARTBEAT_INTERVAL_MS: number = (() => {
  const raw = Number(process.env.TRANSPORT_HEARTBEAT_INTERVAL_MS);
  if (!Number.isFinite(raw)) return TRANSPORT_HEARTBEAT_INTERVAL_MS_DEFAULT;
  return Math.max(10_000, raw);
})();

/**
 * Transport heartbeat enabled — disable-disable for test scenarios.
 * mission-75 v1.0 — env-ified (`TRANSPORT_HEARTBEAT_ENABLED` env var;
 * default true). Per-agent override via
 * `agent.livenessConfig.transportHeartbeatEnabled?`.
 */
export const TRANSPORT_HEARTBEAT_ENABLED_DEFAULT = true;
export const TRANSPORT_HEARTBEAT_ENABLED: boolean =
  process.env.TRANSPORT_HEARTBEAT_ENABLED === "false"
    ? false
    : TRANSPORT_HEARTBEAT_ENABLED_DEFAULT;

/**
 * mission-75 v1.0 — agentPulse pulse-class identifier. SEPARATE from
 * `PULSE_KEYS = ["engineerPulse", "architectPulse"]` per Design §3.4 M1
 * fold: agentPulse iterates Agents-not-missions (config lives on Agent,
 * not Mission); cannot join PULSE_KEYS without breaking the
 * `mission.pulses[pulseKey]` invariant in 6-file references.
 */
export const AGENT_PULSE_KIND = "agentPulse" as const;

/**
 * mission-75 v1.0 — default cadence for per-agent `agentPulse` (60min per
 * F5 architect-recommendation; ≥30min per Q4 ratio; ≤120min per
 * "death-detection slow-but-cheap" Survey envelope §0).
 */
export const AGENT_PULSE_DEFAULT_INTERVAL_SECONDS = 60 * 60;
export const AGENT_PULSE_DEFAULT_MISSED_THRESHOLD = 2;
export const AGENT_PULSE_DEFAULT_MESSAGE = "Agent pulse — heartbeat check; respond with shape ack";

/** Default ADR-017 receipt SLA — Hub's tolerance for "drain has not arrived yet".
 *  idea-105 (2026-04-19): raised from 30s to 60s to accommodate real-world
 *  LLM compose-times without false-positive watchdog escalation. Total ladder
 *  is 3× this value. */
export const DEFAULT_AGENT_RECEIPT_SLA_MS = 60_000;

/**
 * Compute the canonical `livenessState` for an Agent given current time.
 * INV-AG6 / INV-COMMS-L03: online requires heartbeat within 2× receiptSla;
 * beyond that it degrades; deeper staleness promotes to unresponsive; the
 * explicit `offline` state requires a teardown signal and is set elsewhere.
 */
export function computeLivenessState(
  agent: Pick<Agent, "livenessState" | "lastHeartbeatAt" | "receiptSla">,
  nowMs: number,
): AgentLivenessState {
  if (agent.livenessState === "offline") return "offline";
  const heartbeatAtMs = new Date(agent.lastHeartbeatAt).getTime();
  const staleMs = nowMs - heartbeatAtMs;
  const sla = agent.receiptSla;
  if (staleMs <= 2 * sla) return "online";
  if (staleMs <= 4 * sla) return "degraded";
  return "unresponsive";
}

// ── mission-75 (M-TTL-Liveliness-Design) v1.0 — TTL/state derivation ──

/**
 * Per-agent liveness-config resolution with precedence chain:
 * `agent.livenessConfig.<field>` → env-var read → builtin fallback.
 *
 * When `agent` is null/undefined, falls through to env+builtin (used by
 * pre-fetch hot paths like touchAgent rate-limit where loading the
 * agent first would defeat the rate-limit's purpose).
 *
 * Per Design v1.0 §3.1+§3.2 v1.0 Director Declarative-Primacy fold —
 * single canonical resolver consumed by hooks + heartbeat handler +
 * watchdog escalation. Interim under idea-242 Vision (declarative
 * config-as-entities; env vars deprecate to LivenessConfig entity).
 */
export function resolveLivenessConfig<K extends keyof AgentLivenessConfig>(
  agent: Pick<Agent, "livenessConfig"> | null | undefined,
  field: K,
  builtinDefault: NonNullable<AgentLivenessConfig[K]>,
): NonNullable<AgentLivenessConfig[K]> {
  const override = agent?.livenessConfig?.[field];
  if (override !== undefined) {
    return override as NonNullable<AgentLivenessConfig[K]>;
  }
  const envVal = readLivenessConfigEnv(field);
  if (envVal !== undefined) {
    return envVal as NonNullable<AgentLivenessConfig[K]>;
  }
  return builtinDefault;
}

/**
 * Env-var lookup for AgentLivenessConfig fields. Returns undefined when
 * the env var is unset OR fails to parse — caller falls through to
 * builtin default. Env-var name == camelCase field upper-snake-cased
 * (peerPresenceWindowMs → PEER_PRESENCE_WINDOW_MS, etc.) for
 * deterministic resolution.
 */
function readLivenessConfigEnv<K extends keyof AgentLivenessConfig>(
  field: K,
): AgentLivenessConfig[K] | undefined {
  const envName = camelToSnakeUpper(field as string);
  const raw = process.env[envName];
  if (raw === undefined) return undefined;
  if (field === "transportHeartbeatEnabled") {
    if (raw === "true") return true as AgentLivenessConfig[K];
    if (raw === "false") return false as AgentLivenessConfig[K];
    return undefined;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return n as AgentLivenessConfig[K];
}

function camelToSnakeUpper(s: string): string {
  return s.replace(/([A-Z])/g, "_$1").toUpperCase();
}

/**
 * Derive a `ComponentState` from a TTL (seconds remaining) + window (ms).
 * Per Design v1.0 §3.2 + bug-52 correction (countdown-to-expiry semantic;
 * inverted from v1.0's AGE-since-event codification): single canonical
 * derivation consumed by both cognitive (touchAgent post-bump) + transport
 * (refreshHeartbeat post-bump) recompute hooks. windowMs retained in the
 * signature to preserve calling-convention compatibility (callers pass it
 * for self-documenting code; threshold logic is window-independent post-fix).
 */
export function deriveStateFromTTL(
  ttlSeconds: number | null,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  windowMs: number,
): ComponentState {
  if (ttlSeconds === null) return "unknown";
  // bug-52: countdown semantic — ttl <= 0 means window expired (unresponsive);
  // any positive ttl means time remaining = alive.
  return ttlSeconds <= 0 ? "unresponsive" : "alive";
}

/**
 * Compute fresh cognitive (cognitiveTTL, cognitiveState) + transport
 * (transportTTL, transportState) values for an agent given current time.
 * Pure derivation — caller composes into the OCC put.
 *
 * Per Design v1.0 §3.2 — recompute hooks fold into the same write that
 * bumped the source timestamp (single OCC write, not two per Design F1
 * write-amp considerations + AG-5 anti-goal).
 */
export interface ComponentStateSnapshot {
  cognitiveTTL: number | null;
  cognitiveState: ComponentState;
  transportTTL: number | null;
  transportState: ComponentState;
}

export function computeComponentStates(
  agent: Pick<Agent, "lastSeenAt" | "lastHeartbeatAt" | "livenessConfig">,
  nowMs: number,
): ComponentStateSnapshot {
  const windowMs = resolveLivenessConfig(agent, "peerPresenceWindowMs", PEER_PRESENCE_WINDOW_MS_DEFAULT);
  const cognitiveTTL = ttlRemainingFromIso(agent.lastSeenAt, nowMs, windowMs);
  const transportTTL = ttlRemainingFromIso(agent.lastHeartbeatAt, nowMs, windowMs);
  return {
    cognitiveTTL,
    cognitiveState: deriveStateFromTTL(cognitiveTTL, windowMs),
    transportTTL,
    transportState: deriveStateFromTTL(transportTTL, windowMs),
  };
}

/**
 * bug-52: countdown TTL — counts down from windowMs to 0 (expired). Returns
 * seconds remaining in the presence window:
 *   - just-bumped (ageMs ≈ 0)         → ttl ≈ windowMs/1000 (full window)
 *   - mid-window  (ageMs < windowMs)  → ttl > 0   (alive)
 *   - expired     (ageMs >= windowMs) → ttl = 0   (unresponsive; clamped non-negative)
 *
 * Director's stated example: 14s after a tool call with 60s window →
 * cognitiveTTL = 46. v1.0 codified the inverted (AGE-since-event) formula;
 * bug-52 corrects to standard network-TTL countdown convention.
 */
function ttlRemainingFromIso(
  iso: string | null | undefined,
  nowMs: number,
  windowMs: number,
): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const ageMs = nowMs - ms;
  return Math.max(0, Math.floor((windowMs - ageMs) / 1000));
}

// Mission-56 W5: `Notification` entity + `NotificationRepository` +
// `INotificationStore` removed. Hub-event-bus → SSE injection flows
// through the Message store via `emitLegacyNotification` (see
// `hub/src/policy/notification-helpers.ts`). Legacy GCS namespace
// `notifications/v2/` is frozen historical data.

// Mission-47 W5: `MemoryTaskStore` + `MemoryProposalStore` deleted.
// `TaskRepository` (entities/task-repository.ts) + `ProposalRepository`
// (entities/proposal-repository.ts) compose any `StorageProvider`
// (including `MemoryStorageProvider` for tests) via the ITaskStore /
// IProposalStore interfaces.

// Mission-47 W6: MemoryThreadStore deleted. ThreadRepository in
// entities/thread-repository.ts composes any StorageProvider
// (including MemoryStorageProvider for tests) via the
// IThreadStore interface.

// ── Thread 2.0 helpers ──────────────────────────────────────────────

/** Deep-clone a Thread so callers can't mutate the store's live state. */
export function cloneThread(t: Thread): Thread {
  return {
    ...t,
    // Cast preserves the (type, payload) pairing on the cloned action —
    // spreading the source `a` would lose the StagedAction discriminator
    // narrowing that TypeScript applies per source element.
    convergenceActions: t.convergenceActions.map((a) => ({ ...a, payload: { ...a.payload } } as StagedAction)),
    participants: t.participants.map((p) => ({ ...p })),
    messages: t.messages.map((m) => ({ ...m })),
    labels: { ...t.labels },
  };
}

/**
 * Phase 2d CP3 C3 (task-307 audit §5.2 bullet 3) — summary-only
 * truncation for closed threads. Applied at the read boundary so the
 * caller of `getThread` / `listThreads` sees the trimmed view; the
 * underlying per-message storage is unchanged (GCS per-file entries
 * and Memory backing retain the full history as the audit snapshot).
 *
 * Trim rule: when `status === "closed"` AND `messages.length > 6`,
 * keep the first 3 + last 3 messages only. All other fields
 * (convergenceActions, summary, participants, etc.) remain intact.
 * Non-closed threads are returned unchanged — "converged" in
 * particular must still show full history since it may transition
 * to cascade_failed and the forensic trail matters.
 */
export const CLOSED_THREAD_MESSAGE_KEEP = 3;

export function truncateClosedThreadMessages(t: Thread): Thread {
  if (t.status !== "closed") return t;
  if (t.messages.length <= CLOSED_THREAD_MESSAGE_KEEP * 2) return t;
  const first = t.messages.slice(0, CLOSED_THREAD_MESSAGE_KEEP);
  const last = t.messages.slice(-CLOSED_THREAD_MESSAGE_KEEP);
  return { ...t, messages: [...first, ...last] };
}

/** Apply a list of StagedActionOp in order to the thread's
 * convergenceActions[]. Called from both MemoryThreadStore and the
 * GcsThreadStore CAS transform. Side-effect only — mutates in place.
 *
 * Mission-24 (INV-TH22): `proposer` is now `{role, agentId}` rather
 * than bare ParticipantRole. Callers must pass both; agentId may be
 * null for future-Director entries that haven't resolved a stable
 * agentId yet.
 */
export function applyStagedActionOps(
  thread: Thread,
  ops: StagedActionOp[],
  proposer: StagedActionProposer,
  now: string,
): void {
  for (const op of ops) {
    if (op.kind === "stage") {
      const id = `action-${thread.convergenceActions.length + 1}`;
      // Cast is sound: `op` is discriminated on (kind="stage", type, payload)
      // so type and payload are tied at the op level; the assembled object
      // satisfies exactly one arm of the StagedAction discriminated union.
      thread.convergenceActions.push({
        id,
        type: op.type,
        status: "staged",
        proposer: { ...proposer },
        timestamp: now,
        payload: { ...op.payload },
      } as StagedAction);
    } else if (op.kind === "revise") {
      const prior = thread.convergenceActions.find((a) => a.id === op.id);
      if (!prior) {
        throw new ThreadConvergenceGateError(
          `Cannot revise action ${op.id}: no such action in thread ${thread.id}.`,
          "revise_invalid",
        );
      }
      if (prior.status !== "staged") {
        throw new ThreadConvergenceGateError(
          `Cannot revise action ${op.id}: status is ${prior.status} (only "staged" is revisable).`,
          "revise_invalid",
        );
      }
      prior.status = "revised";
      const newId = `action-${thread.convergenceActions.length + 1}`;
      thread.convergenceActions.push({
        id: newId,
        type: prior.type,
        status: "staged",
        proposer: { ...proposer },
        timestamp: now,
        payload: { ...op.payload },
        revisionOf: prior.id,
      } as StagedAction);
    } else if (op.kind === "retract") {
      const prior = thread.convergenceActions.find((a) => a.id === op.id);
      if (!prior) {
        throw new ThreadConvergenceGateError(
          `Cannot retract action ${op.id}: no such action in thread ${thread.id}.`,
          "retract_invalid",
        );
      }
      if (prior.status !== "staged") {
        throw new ThreadConvergenceGateError(
          `Cannot retract action ${op.id}: status is ${prior.status} (only "staged" is retractable).`,
          "retract_invalid",
        );
      }
      prior.status = "retracted";
    }
  }
}

/** Upsert a participant entry by (role, agentId). Mutates in place. */
export function upsertParticipant(
  participants: ThreadParticipant[],
  role: ParticipantRole,
  agentId: string | null,
  now: string,
): void {
  const existing = participants.find((p) => p.role === role && p.agentId === agentId);
  if (existing) {
    existing.lastActiveAt = now;
  } else {
    participants.push({ role, agentId, joinedAt: now, lastActiveAt: now });
  }
}

// Mission-49 W8: MemoryAuditStore deleted. AuditRepository in
// entities/audit-repository.ts composes any StorageProvider (including
// MemoryStorageProvider for tests) via the IAuditStore interface.

// ── M18 Shared Helpers ───────────────────────────────────────────────

import { createHash } from "node:crypto";
import { validateStagedActions } from "./policy/staged-action-payloads.js";

/**
 * sha256(name) — token deliberately NOT mixed in (see thread-79).
 * idea-251 D-prime Phase 2: input is the agent name (was globalInstanceId pre-D-prime).
 * Parameter kept named `input` to avoid coupling callers to either historical name.
 */
export function computeFingerprint(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * idea-251 D-prime Phase 2: deterministic agentId derivation from name.
 * Format: `agent-{first-8-hex-chars-of-sha256(name)}` per Director's spec.
 * Same name → same agentId across stores; different names → different agentIds.
 * 8 chars (~65k names before 50% collision) acceptable at current scale.
 */
export function deriveAgentId(name: string): string {
  return `agent-${computeFingerprint(name).slice(0, 8)}`;
}

/** Compact hash suffix for display agentIds (first 12 hex chars of fingerprint). */
export function shortHash(fingerprint: string): string {
  return fingerprint.slice(0, 12);
}

// Thrashing circuit breaker: >3 displacements in any 60s window trips.
export const THRASHING_WINDOW_MS = 60_000;
export const THRASHING_THRESHOLD = 3;

/** Append a timestamp and evict entries older than WINDOW_MS. Returns true if the threshold is tripped. */
export function recordDisplacementAndCheck(history: number[], now: number): boolean {
  history.push(now);
  const cutoff = now - THRASHING_WINDOW_MS;
  while (history.length > 0 && history[0] < cutoff) history.shift();
  return history.length > THRASHING_THRESHOLD;
}

/** CP3 C5 — key-wise equality for AgentLabels. String values only (type-enforced). */
export function shallowEqualLabels(a: AgentLabels, b: AgentLabels): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

// Mission-47 W7b: MemoryEngineerRegistry deleted. AgentRepository
// in entities/agent-repository.ts composes any StorageProvider
// (including MemoryStorageProvider for tests) via the
// IEngineerRegistry interface.
