/**
 * State interfaces and in-memory implementation for the MCP Relay Hub.
 *
 * Defines ITaskStore and IEngineerRegistry interfaces that can be backed
 * by either in-memory storage (local dev) or GCS (production).
 */

export type TaskStatus = "pending" | "working" | "blocked" | "input_required" | "in_review" | "completed" | "failed" | "escalated" | "cancelled";

export type SessionRole = "engineer" | "architect" | "director" | "unknown";

export interface Task {
  id: string;
  directive: string;
  report: string | null;
  reportSummary: string | null;
  reportRef: string | null;
  verification: string | null;
  reviewAssessment: string | null;
  reviewRef: string | null;
  assignedEngineerId: string | null;
  clarificationQuestion: string | null;
  clarificationAnswer: string | null;
  correlationId: string | null;
  idempotencyKey: string | null;
  title: string | null;
  description: string | null;
  dependsOn: string[];
  revisionCount: number;
  status: TaskStatus;
  /** Mission-19: routing labels inherited from creator at submit-time. */
  labels: Record<string, string>;
  /** Mission-20 Phase 3: owning Turn for virtual-view composition. */
  turnId: string | null;
  /**
   * Mission-24 Phase 2 (ADR-014, INV-TH20/23): cascade-spawn back-links.
   * When this Task was spawned by a thread cascade handler, these fields
   * carry the provenance pair (sourceThreadId+sourceActionId is the
   * natural idempotency key) plus the thread's negotiated summary frozen
   * at commit (Summary-as-Living-Record). Null for non-cascade-spawned
   * tasks — Director-directed, legacy, or Architect-decomposed tasks.
   */
  sourceThreadId: string | null;
  sourceActionId: string | null;
  sourceThreadSummary: string | null;
  createdAt: string;
  updatedAt: string;
}

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
 * Projected view of an M18 Agent for the `get_engineer_status` tool.
 * `sessionId` is an alias for `currentSessionId` preserved so task-policy
 * can match `engStatus.engineers.find(e => e.sessionId === sid)` against the
 * caller's live MCP session without knowing the M18 field name.
 */
export interface EngineerStatusEntry {
  engineerId: string;
  sessionId: string | null;
  status: "online" | "offline";
  sessionEpoch: number;
  clientMetadata: AgentClientMetadata;
  advisoryTags: AgentAdvisoryTags;
  labels: AgentLabels;
  firstSeenAt: string;
  lastSeenAt: string;
}

// ── M18: Agent as First-Class Entity ─────────────────────────────────
// Design from thread-79. Decouples stable identity (globalInstanceId)
// from authentication (token) and role (token claim).

export interface AgentClientMetadata {
  clientName: string;          // MCP initialize.clientInfo.name (e.g., "claude-code")
  clientVersion: string;       // MCP initialize.clientInfo.version
  proxyName: string;           // e.g., "@ois/claude-plugin"
  proxyVersion: string;        // e.g., "1.0.0"
  transport?: string;          // "stdio-mcp-proxy" | "plugin-native"
  sdkVersion?: string;         // e.g., "@ois/network-adapter@2.0.0"
  hostname?: string;
  platform?: string;
  pid?: number;
}

export interface AgentAdvisoryTags {
  // All fields are best-effort, launch-time-only, subject to drift.
  // DO NOT build routing logic on these.
  llmModel?: string;           // e.g., "claude-opus-4-6"
  [key: string]: unknown;
}

export type AgentRole = "engineer" | "architect" | "director";
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
 * filters to agents whose role ∈ roles. `engineerId`, when set,
 * pins dispatch to that specific Agent (P2P routing — t5). An
 * empty selector matches all non-archived, online agents.
 */
export interface Selector {
  engineerId?: string;
  /**
   * Pin dispatch to a specific set of Agents by engineerId. Used by
   * Threads 2.0 participant-scoped routing (INV-TH16) so replies land
   * only on the actual thread participants, not every Agent sharing
   * the target role. Applied as an AND filter on top of role/labels.
   */
  engineerIds?: string[];
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

export interface Agent {
  engineerId: string;          // e.g., "eng-abc123xyz" (Hub-issued)
  fingerprint: string;         // sha256(globalInstanceId) — token NOT included
  role: AgentRole;
  status: AgentStatus;
  archived: boolean;           // replaces deletion (append-only)
  sessionEpoch: number;        // monotonic, incremented on each displacement
  currentSessionId: string | null; // ephemeral, per SSE connection
  clientMetadata: AgentClientMetadata;
  advisoryTags: AgentAdvisoryTags;
  labels: AgentLabels;         // Mission-19: routing metadata, immutable post-create in v1
  firstSeenAt: string;
  lastSeenAt: string;
  // ADR-017 liveness FSM — computed from lastHeartbeatAt + receiptSla.
  livenessState: AgentLivenessState;
  lastHeartbeatAt: string;     // updated on drain_pending_actions; drives FSM
  receiptSla: number;          // ms; per-agent override, default DEFAULT_RECEIPT_SLA_MS
  wakeEndpoint: string | null; // optional durable-wake URL (Cloud Run, etc.)
  // Displacement rate-limit accounting (in-memory, not persisted):
  // see GcsEngineerRegistry.displacementHistory for the in-memory map.
}

export interface RegisterAgentPayload {
  globalInstanceId: string;
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
  engineerId: string;
  sessionEpoch: number;
  wasCreated: boolean;
  clientMetadata: AgentClientMetadata;
  advisoryTags: AgentAdvisoryTags;
  labels: AgentLabels;
}

export interface RegisterAgentFailure {
  ok: false;
  code: "agent_thrashing_detected" | "role_mismatch";
  message: string;
}

export type RegisterAgentResult = RegisterAgentSuccess | RegisterAgentFailure;

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
export type ThreadAuthor = "engineer" | "architect";
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
  /** Mission-21 Phase 1: the Agent.engineerId of the specific agent that
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
 * populates only engineer and architect from Agent role resolution. */
export type ParticipantRole = "engineer" | "architect" | "director";

export interface ThreadParticipant {
  role: ParticipantRole;
  /** Agent.engineerId. Null for future Director pre-idea-84 activation. */
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
  | "create_task"
  | "create_proposal"
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

/** Phase 2 autonomous: spawn a Task from thread convergence. */
export interface CreateTaskActionPayload {
  title: string;
  description: string;
  correlationId?: string;
}

/** Phase 2 autonomous: spawn a Proposal from thread convergence. */
export interface CreateProposalActionPayload {
  title: string;
  description: string;
  correlationId?: string;
}

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
  | CreateTaskActionPayload
  | CreateProposalActionPayload
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
}

/** Discriminated union on `type` — TypeScript narrows `payload` to the
 * matching shape when `type` is inspected, so handlers and tests can
 * access payload fields without explicit casts. */
export type StagedAction =
  | (StagedActionCommon & { type: "close_no_action"; payload: CloseNoActionPayload })
  | (StagedActionCommon & { type: "create_task"; payload: CreateTaskActionPayload })
  | (StagedActionCommon & { type: "create_proposal"; payload: CreateProposalActionPayload })
  | (StagedActionCommon & { type: "create_idea"; payload: CreateIdeaActionPayload })
  | (StagedActionCommon & { type: "update_idea"; payload: UpdateIdeaActionPayload })
  | (StagedActionCommon & { type: "update_mission_status"; payload: UpdateMissionStatusActionPayload })
  | (StagedActionCommon & { type: "propose_mission"; payload: ProposeMissionActionPayload })
  | (StagedActionCommon & { type: "create_clarification"; payload: CreateClarificationActionPayload })
  | (StagedActionCommon & { type: "create_bug"; payload: CreateBugActionPayload });

export type StagedActionOp =
  | { kind: "stage"; type: "close_no_action"; payload: CloseNoActionPayload }
  | { kind: "stage"; type: "create_task"; payload: CreateTaskActionPayload }
  | { kind: "stage"; type: "create_proposal"; payload: CreateProposalActionPayload }
  | { kind: "stage"; type: "create_idea"; payload: CreateIdeaActionPayload }
  | { kind: "stage"; type: "update_idea"; payload: UpdateIdeaActionPayload }
  | { kind: "stage"; type: "update_mission_status"; payload: UpdateMissionStatusActionPayload }
  | { kind: "stage"; type: "propose_mission"; payload: ProposeMissionActionPayload }
  | { kind: "stage"; type: "create_clarification"; payload: CreateClarificationActionPayload }
  | { kind: "stage"; type: "create_bug"; payload: CreateBugActionPayload }
  | { kind: "revise"; id: string; payload: StagedActionPayload }
  | { kind: "retract"; id: string };

/** Error thrown by the thread store when `converged=true` fails the Phase 1
 * forcing-function gate (empty committed actions OR empty summary). Carries
 * a domain-specific message so the caller can self-correct. */
export class ThreadConvergenceGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThreadConvergenceGateError";
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
  initiatedBy: ThreadAuthor;
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
   * specific agent (via Selector.engineerIds) rather than broadcasting
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
}

// ── Audit Types ──────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: "architect" | "engineer" | "hub";
  action: string;
  details: string;
  relatedEntity: string | null; // e.g., "task-24", "prop-7", "thread-3"
}

// ── Notification Types ───────────────────────────────────────────────

export interface Notification {
  id: number | string;  // number (legacy) or ULID string (AMP v2)
  event: string;
  targetRoles: string[];
  data: Record<string, unknown>;
  timestamp: string;
}

// ── Interfaces ───────────────────────────────────────────────────────

export interface INotificationStore {
  persist(event: string, data: Record<string, unknown>, targetRoles: string[]): Promise<Notification>;
  listSince(afterId: number | string, role?: string): Promise<Notification[]>;
  cleanup(maxAgeMs: number): Promise<number>;
}

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
  /** Agent.engineerId of the author (from engineerRegistry.getAgentForSession).
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
  listThreads(status?: ThreadStatus): Promise<Thread[]>;
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
}

export interface IProposalStore {
  submitProposal(title: string, summary: string, body: string, correlationId?: string, executionPlan?: ProposedExecutionPlan, labels?: Record<string, string>, backlink?: CascadeBacklink): Promise<Proposal>;
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

export interface ITaskStore {
  submitDirective(directive: string, correlationId?: string, idempotencyKey?: string, title?: string, description?: string, dependsOn?: string[], labels?: Record<string, string>, backlink?: CascadeBacklink): Promise<string>;
  findByIdempotencyKey(key: string): Promise<Task | null>;
  /**
   * Mission-24 Phase 2 (ADR-014, INV-TH20): look up a Task by the natural
   * idempotency key {sourceThreadId, sourceActionId}. Returns null when
   * no Task has been spawned from that thread+action pair. Cascade
   * handlers query this before create to dedupe retries. The key
   * structurally matches CascadeBacklink minus the summary — summary
   * isn't part of the lookup.
   */
  findByCascadeKey(key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">): Promise<Task | null>;
  unblockDependents(completedTaskId: string): Promise<string[]>;
  cancelDependents(failedTaskId: string): Promise<string[]>;
  /**
   * Mission-19: claim the next directive the caller is authorized to run.
   * A Task with non-empty `labels` is only matched when every (k,v) pair
   * in task.labels is present and equal in `claimant.labels` (subset).
   * When `claimant` is omitted, behaves like the pre-Mission-19 FIFO pull
   * (used by legacy paths that have not yet completed M18 handshake).
   * `claimant.engineerId`, when set, is persisted on the task as
   * `assignedEngineerId` for P2P routing of subsequent events.
   */
  getNextDirective(claimant?: { engineerId?: string; labels?: Record<string, string> }): Promise<Task | null>;
  submitReport(taskId: string, report: string, summary: string, success: boolean, verification?: string): Promise<boolean>;
  getNextReport(): Promise<Task | null>;
  getTask(taskId: string): Promise<Task | null>;
  listTasks(): Promise<Task[]>;
  cancelTask(taskId: string): Promise<boolean>;
  requestClarification(taskId: string, question: string): Promise<boolean>;
  respondToClarification(taskId: string, answer: string): Promise<boolean>;
  submitReview(taskId: string, assessment: string, decision?: "approved" | "rejected"): Promise<boolean>;
  getReview(taskId: string): Promise<{ taskId: string; assessment: string; reviewRef: string } | null>;
}

export interface IEngineerRegistry {
  /** Bare role-set used by the legacy register_role path and auto-register in task-policy. */
  setSessionRole(sessionId: string, role: SessionRole): void;
  getRole(sessionId: string): SessionRole;
  getStatusSummary(): Promise<{
    connected: number;
    engineers: EngineerStatusEntry[];
  }>;
  // M18: Agent entity operations.
  registerAgent(sessionId: string, tokenRole: AgentRole, payload: RegisterAgentPayload, address?: string): Promise<RegisterAgentResult>;
  getAgent(engineerId: string): Promise<Agent | null>;
  /** Mission-19: resolve the Agent bound to an SSE session (null if none). */
  getAgentForSession(sessionId: string): Promise<Agent | null>;
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
  refreshHeartbeat(engineerId: string): Promise<void>;
  /** ADR-017: flip `livenessState` on an agent (used by the watchdog's
   *  demotion ladder). No-op for unknown agents. */
  setLivenessState(engineerId: string, state: AgentLivenessState): Promise<void>;
}

/** Minimum interval between persisted Agent heartbeat writes (per agent). */
export const AGENT_TOUCH_MIN_INTERVAL_MS = 30_000;

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

// ── In-Memory Implementation ─────────────────────────────────────────

export class MemoryNotificationStore implements INotificationStore {
  private notifications: Notification[] = [];
  private ulidGen: (() => string) | null = null;

  async persist(event: string, data: Record<string, unknown>, targetRoles: string[]): Promise<Notification> {
    const { monotonicFactory } = await import("ulidx");
    if (!this.ulidGen) this.ulidGen = monotonicFactory();
    const id = this.ulidGen();
    const notification: Notification = {
      id,
      event,
      targetRoles,
      data,
      timestamp: new Date().toISOString(),
    };
    this.notifications.push(notification);
    return notification;
  }

  async listSince(afterId: number | string, role?: string): Promise<Notification[]> {
    const afterStr = String(afterId);
    return this.notifications.filter((n) => {
      // For ULID comparison: lexicographic string compare
      // For legacy integer: convert and compare numerically
      const nStr = String(n.id);
      if (nStr <= afterStr) return false;
      if (role && !n.targetRoles.includes(role)) return false;
      return true;
    });
  }

  async cleanup(maxAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
    const before = this.notifications.length;
    this.notifications = this.notifications.filter(
      (n) => new Date(n.timestamp).getTime() > cutoff
    );
    return before - this.notifications.length;
  }
}

export class MemoryTaskStore implements ITaskStore {
  private tasks: Map<string, Task> = new Map();
  private counter = 0;

  async submitDirective(directive: string, correlationId?: string, idempotencyKey?: string, title?: string, description?: string, dependsOn?: string[], labels?: Record<string, string>, backlink?: CascadeBacklink): Promise<string> {
    this.counter++;
    const id = `task-${this.counter}`;
    const now = new Date().toISOString();
    const hasDeps = dependsOn && dependsOn.length > 0;
    this.tasks.set(id, {
      id,
      directive,
      report: null,
      reportSummary: null,
      reportRef: null,
      verification: null,
      reviewAssessment: null,
      reviewRef: null,
      assignedEngineerId: null,
      clarificationQuestion: null,
      clarificationAnswer: null,
      correlationId: correlationId || null,
      idempotencyKey: idempotencyKey || null,
      title: title || null,
      description: description || null,
      dependsOn: dependsOn || [],
      revisionCount: 0,
      status: hasDeps ? "blocked" : "pending",
      labels: labels || {},
      turnId: null,
      sourceThreadId: backlink?.sourceThreadId ?? null,
      sourceActionId: backlink?.sourceActionId ?? null,
      sourceThreadSummary: backlink?.sourceThreadSummary ?? null,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`[MemoryTaskStore] Directive submitted: ${id} (status: ${hasDeps ? "blocked" : "pending"}${backlink ? `, cascade from ${backlink.sourceThreadId}/${backlink.sourceActionId}` : ""})`);
    return id;
  }

  async findByIdempotencyKey(key: string): Promise<Task | null> {
    for (const task of this.tasks.values()) {
      if (task.idempotencyKey === key) {
        return { ...task };
      }
    }
    return null;
  }

  async findByCascadeKey(key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">): Promise<Task | null> {
    for (const task of this.tasks.values()) {
      if (task.sourceThreadId === key.sourceThreadId && task.sourceActionId === key.sourceActionId) {
        return { ...task };
      }
    }
    return null;
  }

  async unblockDependents(completedTaskId: string): Promise<string[]> {
    const unblocked: string[] = [];
    for (const task of this.tasks.values()) {
      if (task.status !== "blocked") continue;
      if (!task.dependsOn.includes(completedTaskId)) continue;
      // Check if ALL dependencies are now completed
      const allDepsCompleted = task.dependsOn.every((depId) => {
        const dep = this.tasks.get(depId);
        return dep && dep.status === "completed";
      });
      if (allDepsCompleted) {
        task.status = "pending";
        task.updatedAt = new Date().toISOString();
        unblocked.push(task.id);
        console.log(`[MemoryTaskStore] Task unblocked: ${task.id}`);
      }
    }
    return unblocked;
  }

  async cancelDependents(failedTaskId: string): Promise<string[]> {
    const cancelled: string[] = [];
    for (const task of this.tasks.values()) {
      if (task.status !== "blocked") continue;
      if (!task.dependsOn.includes(failedTaskId)) continue;
      task.status = "cancelled";
      task.updatedAt = new Date().toISOString();
      cancelled.push(task.id);
      console.log(`[MemoryTaskStore] Task cancelled (dependency failed): ${task.id}`);
    }
    return cancelled;
  }

  async getNextDirective(claimant?: { engineerId?: string; labels?: Record<string, string> }): Promise<Task | null> {
    for (const task of this.tasks.values()) {
      if (task.status !== "pending") continue;
      if (!taskClaimableBy(task.labels ?? {}, claimant?.labels)) continue;
      task.status = "working";
      task.assignedEngineerId = claimant?.engineerId ?? null;
      task.updatedAt = new Date().toISOString();
      console.log(`[MemoryTaskStore] Directive assigned: ${task.id}${task.assignedEngineerId ? ` → ${task.assignedEngineerId}` : ""}`);
      return { ...task };
    }
    return null;
  }

  async submitReport(taskId: string, report: string, summary: string, success: boolean, verification?: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) {
      console.log(`[MemoryTaskStore] Report failed: task ${taskId} not found`);
      return false;
    }
    const version = task.revisionCount + 1;
    task.report = report;
    task.reportSummary = summary;
    task.reportRef = `reports/${taskId}-v${version}-report.md`;
    task.verification = verification || null;
    task.status = "in_review";
    task.updatedAt = new Date().toISOString();
    console.log(`[MemoryTaskStore] Report submitted for: ${taskId} (in_review, v${version})`);
    return true;
  }

  async getNextReport(): Promise<Task | null> {
    for (const task of this.tasks.values()) {
      if ((task.status === "completed" || task.status === "failed") && task.report !== null) {
        // Mark as reported but keep the data intact
        task.status = ("reported_" + task.status) as TaskStatus;
        task.updatedAt = new Date().toISOString();
        console.log(`[MemoryTaskStore] Report retrieved: ${task.id}`);
        return { ...task };
      }
    }
    return null;
  }

  async getTask(taskId: string): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : null;
  }

  async listTasks(): Promise<Task[]> {
    return Array.from(this.tasks.values()).map((t) => ({ ...t }));
  }

  async cancelTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    // Cancellable from any non-terminal in-flight state. Stewardship
    // need: stranded `working` tasks (assigned engineer offline) and
    // `blocked` tasks with stale deps both require cancellation to
    // clear the board — tightening to `pending` alone left zombies
    // unreclaimable (thread-131 finding). `in_review` is deliberately
    // excluded: a submitted report deserves a decision, not a cancel.
    const CANCELLABLE: Task["status"][] = ["pending", "working", "blocked", "input_required"];
    if (!CANCELLABLE.includes(task.status)) return false;
    const priorStatus = task.status;
    task.status = "cancelled";
    task.updatedAt = new Date().toISOString();
    console.log(`[MemoryTaskStore] Task cancelled: ${taskId} (was: ${priorStatus})`);
    return true;
  }

  async requestClarification(taskId: string, question: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "working") return false;
    task.status = "input_required";
    task.clarificationQuestion = question;
    task.updatedAt = new Date().toISOString();
    console.log(`[MemoryTaskStore] Clarification requested for: ${taskId}`);
    return true;
  }

  async respondToClarification(taskId: string, answer: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "input_required") return false;
    task.status = "working";
    task.clarificationAnswer = answer;
    task.updatedAt = new Date().toISOString();
    console.log(`[MemoryTaskStore] Clarification answered for: ${taskId}`);
    return true;
  }

  async submitReview(taskId: string, assessment: string, decision?: "approved" | "rejected"): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    const version = (task.revisionCount || 0) + 1;
    task.reviewAssessment = assessment;
    task.reviewRef = `reviews/${taskId}-v${version}-review.md`;
    task.updatedAt = new Date().toISOString();

    if (decision === "approved") {
      task.status = "completed";
      console.log(`[MemoryTaskStore] Review approved for: ${taskId} → completed (v${version})`);
    } else if (decision === "rejected") {
      if (task.revisionCount >= 3) {
        task.status = "escalated";
        console.log(`[MemoryTaskStore] Review rejected for: ${taskId} → escalated (revisionCount=${task.revisionCount}, v${version})`);
      } else {
        task.revisionCount++;
        task.status = "working";
        console.log(`[MemoryTaskStore] Review rejected for: ${taskId} → working (revisionCount=${task.revisionCount}, v${version})`);
      }
    } else {
      // No decision — legacy behavior (just store assessment, no state change)
      console.log(`[MemoryTaskStore] Review submitted for: ${taskId} (v${version}, no decision)`);
    }
    return true;
  }

  async getReview(taskId: string): Promise<{ taskId: string; assessment: string; reviewRef: string } | null> {
    const task = this.tasks.get(taskId);
    if (!task || !task.reviewAssessment) return null;
    return {
      taskId: task.id,
      assessment: task.reviewAssessment,
      reviewRef: task.reviewRef || `reviews/${taskId}-v1-review.md`,
    };
  }
}

export class MemoryProposalStore implements IProposalStore {
  private proposals: Map<string, Proposal> = new Map();
  private counter = 0;

  async submitProposal(title: string, summary: string, body: string, correlationId?: string, executionPlan?: ProposedExecutionPlan, labels?: Record<string, string>, backlink?: CascadeBacklink): Promise<Proposal> {
    this.counter++;
    const id = `prop-${this.counter}`;
    const now = new Date().toISOString();
    const proposalRef = `proposals/${id}.md`;
    const proposal: Proposal = {
      id,
      title,
      summary,
      proposalRef,
      status: "submitted",
      decision: null,
      feedback: null,
      correlationId: correlationId || null,
      executionPlan: executionPlan || null,
      scaffoldResult: null,
      labels: labels || {},
      sourceThreadId: backlink?.sourceThreadId ?? null,
      sourceActionId: backlink?.sourceActionId ?? null,
      sourceThreadSummary: backlink?.sourceThreadSummary ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.proposals.set(id, proposal);
    console.log(`[MemoryProposalStore] Proposal submitted: ${id} — ${title}${backlink ? ` (cascade from ${backlink.sourceThreadId}/${backlink.sourceActionId})` : ""}`);
    return { ...proposal };
  }

  async findByCascadeKey(key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">): Promise<Proposal | null> {
    for (const proposal of this.proposals.values()) {
      if (proposal.sourceThreadId === key.sourceThreadId && proposal.sourceActionId === key.sourceActionId) {
        return { ...proposal };
      }
    }
    return null;
  }

  async getProposals(status?: ProposalStatus): Promise<Proposal[]> {
    const all = Array.from(this.proposals.values());
    if (status) return all.filter((p) => p.status === status).map((p) => ({ ...p }));
    return all.map((p) => ({ ...p }));
  }

  async getProposal(proposalId: string): Promise<Proposal | null> {
    const p = this.proposals.get(proposalId);
    return p ? { ...p } : null;
  }

  async reviewProposal(proposalId: string, decision: ProposalStatus, feedback: string): Promise<boolean> {
    const p = this.proposals.get(proposalId);
    if (!p) return false;
    p.status = decision;
    p.decision = decision;
    p.feedback = feedback;
    p.updatedAt = new Date().toISOString();
    console.log(`[MemoryProposalStore] Proposal ${proposalId} reviewed: ${decision}`);
    return true;
  }

  async closeProposal(proposalId: string): Promise<boolean> {
    const p = this.proposals.get(proposalId);
    if (!p) return false;
    if (p.status !== "approved" && p.status !== "rejected" && p.status !== "changes_requested") return false;
    p.status = "implemented";
    p.updatedAt = new Date().toISOString();
    console.log(`[MemoryProposalStore] Proposal ${proposalId} closed as implemented`);
    return true;
  }

  async setScaffoldResult(proposalId: string, result: ScaffoldResult): Promise<boolean> {
    const p = this.proposals.get(proposalId);
    if (!p) return false;
    p.scaffoldResult = result;
    p.updatedAt = new Date().toISOString();
    return true;
  }
}

export class MemoryThreadStore implements IThreadStore {
  private threads: Map<string, Thread> = new Map();
  private counter = 0;

  async openThread(title: string, message: string, author: ThreadAuthor, options: OpenThreadOptions = {}): Promise<Thread> {
    const {
      maxRounds = 10,
      correlationId,
      labels,
      authorAgentId = null,
      recipientAgentId = null,
      recipientRole = null,
      routingMode = "unicast",
      context = null,
    } = options;
    this.counter++;
    const id = `thread-${this.counter}`;
    const now = new Date().toISOString();
    // INV-TH17: when recipientRole is known, honour it — this is the only
    // way engineer↔engineer threads get the turn set correctly on open.
    // Fallback preserves legacy role-flip behaviour for plain architect↔
    // engineer threads that did not pass a recipient.
    const nextTurn: ThreadAuthor = recipientRole
      ?? (author === "engineer" ? "architect" : "engineer");
    const thread: Thread = {
      id,
      title,
      status: "active",
      // Mission-24 Phase 2 (INV-TH18): routing mode declared at open,
      // immutable for the thread's lifetime. Broadcast is the one
      // permitted mid-life transition (coerces to Targeted on first
      // reply, handled in replyToThread). Policy layer validates the
      // mode + mode-specific field consistency before handing off here.
      routingMode,
      context,
      idleExpiryMs: null,
      initiatedBy: author,
      currentTurn: nextTurn,
      currentTurnAgentId: recipientAgentId ?? null,
      roundCount: 1,
      maxRounds,
      outstandingIntent: null,
      currentSemanticIntent: null,
      correlationId: correlationId || null,
      convergenceActions: [],
      summary: "",
      participants: [{
        role: author,
        agentId: authorAgentId,
        joinedAt: now,
        lastActiveAt: now,
      }],
      recipientAgentId: recipientAgentId ?? null,
      messages: [{ author, authorAgentId, text: message, timestamp: now, converged: false, intent: null, semanticIntent: null }],
      labels: labels || {},
      createdAt: now,
      updatedAt: now,
    };
    this.threads.set(id, thread);
    console.log(`[MemoryThreadStore] Thread opened: ${id} — ${title}`);
    return cloneThread(thread);
  }

  async replyToThread(threadId: string, message: string, author: ThreadAuthor, options: ReplyToThreadOptions = {}): Promise<Thread | null> {
    const stored = this.threads.get(threadId);
    if (!stored || stored.status !== "active") return null;
    if (stored.currentTurn !== author) return null;

    const {
      converged = false,
      intent = null,
      semanticIntent = null,
      stagedActions = [],
      summary: summaryUpdate,
      authorAgentId = null,
    } = options;

    // INV-TH17: when the thread pinned a current-turn agentId (engineer↔
    // engineer, or a post-first-reply state where we know both parties),
    // the author's agentId must match. Role alone is insufficient because
    // multiple agents may share a role.
    if (stored.currentTurnAgentId && authorAgentId !== stored.currentTurnAgentId) {
      return null;
    }

    // Transactional: mutate a clone. Only swap in on success so that
    // throwing `ThreadConvergenceGateError` (or `applyStagedActionOps`
    // throws on bad revise/retract) rolls back cleanly.
    const working = cloneThread(stored);
    const now = new Date().toISOString();

    // applyStagedActionOps can throw on bad op (e.g. revising a
    // non-existent / wrong-status action). Let it propagate — caller
    // gets ThreadConvergenceGateError with a domain-specific message.
    applyStagedActionOps(
      working,
      stagedActions,
      { role: author as ParticipantRole, agentId: authorAgentId ?? null },
      now,
    );

    if (summaryUpdate !== undefined) working.summary = summaryUpdate;
    upsertParticipant(working.participants, author, authorAgentId, now);

    working.messages.push({ author, authorAgentId, text: message, timestamp: now, converged, intent, semanticIntent });
    if (semanticIntent) working.currentSemanticIntent = semanticIntent;
    working.roundCount++;
    working.outstandingIntent = intent;
    // INV-TH17: hand the turn to the next participant. When a second
    // participant is on the thread we prefer their (role, agentId) over
    // the legacy role-flip so engineer↔engineer keeps the turn on the
    // counterparty engineer rather than bouncing to "architect".
    const otherParticipant = working.participants.find(
      (p) => !(p.role === author && p.agentId === authorAgentId) && p.role !== "director",
    );
    if (otherParticipant) {
      working.currentTurn = otherParticipant.role as ThreadAuthor;
      working.currentTurnAgentId = otherParticipant.agentId ?? null;
    } else {
      working.currentTurn = author === "engineer" ? "architect" : "engineer";
      working.currentTurnAgentId = null;
    }
    // Mission-24 Phase 2 (INV-TH18): broadcast → targeted coercion on
    // first reply. The responder becomes the second (and only) other
    // participant; the pool-discovery surface closes. This is the single
    // permitted routingMode transition; unicast + multicast remain
    // immutable for the thread's lifetime.
    if (stored.routingMode === "broadcast") {
      working.routingMode = "unicast";
    }
    working.updatedAt = now;

    const prevConverged = stored.lastMessageConverged ?? false;
    const willConverge = converged && prevConverged;
    working.lastMessageConverged = converged;

    if (willConverge) {
      // Mission-21 Phase 1 forcing-function gate. On rejection, throw
      // so the clone is discarded and the stored thread stays intact.
      const staged = working.convergenceActions.filter((a) => a.status === "staged");
      const summaryEmpty = working.summary.trim().length === 0;

      if (staged.length === 0 || summaryEmpty) {
        const reasons: string[] = [];
        if (staged.length === 0) reasons.push("no convergenceActions committed (stage at least one — Phase 1 vocab: close_no_action{reason})");
        if (summaryEmpty) reasons.push("summary is empty (narrate the agreed outcome)");
        throw new ThreadConvergenceGateError(
          `Thread convergence rejected: ${reasons.join("; ")}.`,
        );
      }

      // Mission-24 Phase 2 (M24-T4, INV-TH19): validate staged payloads
      // BEFORE staged→committed promotion. "Committed means committed" —
      // once a payload is promoted, the cascade executes and there is
      // no rollback, so per-action semantic validation must run here.
      const validation = validateStagedActions(staged);
      if (!validation.ok) {
        const detail = validation.errors
          .map((e) => `${e.actionId} (${e.type}): ${e.error}`)
          .join("; ");
        throw new ThreadConvergenceGateError(
          `Thread convergence rejected: staged action validation failed — ${detail}.`,
        );
      }

      for (const action of working.convergenceActions) {
        if (action.status === "staged") action.status = "committed";
      }
      working.status = "converged";
      console.log(`[MemoryThreadStore] Thread converged: ${threadId} (${staged.length} committed action(s))`);
    }

    if (working.roundCount >= working.maxRounds && working.status === "active") {
      working.status = "round_limit";
      console.log(`[MemoryThreadStore] Thread hit round limit: ${threadId}`);
    }

    // Commit: replace the stored thread with the fully-mutated clone.
    this.threads.set(threadId, working);

    console.log(`[MemoryThreadStore] Reply on ${threadId} by ${author}${authorAgentId ? ` (${authorAgentId})` : ""} (round ${working.roundCount}/${working.maxRounds})`);
    return cloneThread(working);
  }

  async getThread(threadId: string): Promise<Thread | null> {
    const t = this.threads.get(threadId);
    return t ? cloneThread(t) : null;
  }

  async listThreads(status?: ThreadStatus): Promise<Thread[]> {
    const all = Array.from(this.threads.values());
    if (status) return all.filter((t) => t.status === status).map(cloneThread);
    return all.map(cloneThread);
  }

  async markCascadeFailed(threadId: string): Promise<boolean> {
    const thread = this.threads.get(threadId);
    if (!thread) return false;
    // Only converged threads can transition to cascade_failed.
    // From any other state, this is a no-op + false return.
    if (thread.status !== "converged" && thread.status !== "active") return false;
    thread.status = "cascade_failed";
    thread.updatedAt = new Date().toISOString();
    console.log(`[MemoryThreadStore] Thread cascade_failed: ${threadId}`);
    return true;
  }

  async closeThread(threadId: string): Promise<boolean> {
    const thread = this.threads.get(threadId);
    if (!thread) return false;
    thread.status = "closed";
    thread.updatedAt = new Date().toISOString();
    console.log(`[MemoryThreadStore] Thread closed: ${threadId}`);
    return true;
  }

  async leaveThread(threadId: string, leaverAgentId: string): Promise<Thread | null> {
    const stored = this.threads.get(threadId);
    if (!stored) return null;
    if (stored.status !== "active") return null;
    const isParticipant = stored.participants.some((p) => p.agentId === leaverAgentId);
    if (!isParticipant) return null;

    // Transactional clone-and-swap mirrors replyToThread. The auto-
    // retract mutates staged-action statuses; if anything throws
    // (shouldn't, but belt-and-braces) we discard the clone.
    const working = cloneThread(stored);
    const now = new Date().toISOString();

    // Auto-retract every staged action proposed by the leaver. Other
    // participants' staged actions remain — if a remaining participant
    // wants to converge later they'd open a fresh thread per the
    // abandoned terminal (no re-entry on abandoned).
    for (const action of working.convergenceActions) {
      if (action.status === "staged" && action.proposer.agentId === leaverAgentId) {
        action.status = "retracted";
        action.timestamp = now;
      }
    }

    working.status = "abandoned";
    working.updatedAt = now;
    this.threads.set(threadId, working);
    console.log(`[MemoryThreadStore] Thread abandoned: ${threadId} (leaver=${leaverAgentId})`);
    return cloneThread(working);
  }

  async reapIdleThreads(defaultIdleExpiryMs: number): Promise<ReapedThread[]> {
    const now = Date.now();
    const nowIso = new Date().toISOString();
    const reaped: ReapedThread[] = [];
    for (const [threadId, thread] of this.threads.entries()) {
      if (thread.status !== "active") continue;
      const threshold = typeof thread.idleExpiryMs === "number" ? thread.idleExpiryMs : defaultIdleExpiryMs;
      const idleMs = now - new Date(thread.updatedAt).getTime();
      if (idleMs <= threshold) continue;
      // Transition via clone-and-swap to match leaveThread discipline.
      const working = cloneThread(thread);
      // Reaper retracts ALL staged actions (no leaver — the thread is
      // dying; nothing commits). Preserves the staging history for audit.
      for (const action of working.convergenceActions) {
        if (action.status === "staged") {
          action.status = "retracted";
          action.timestamp = nowIso;
        }
      }
      working.status = "abandoned";
      working.updatedAt = nowIso;
      this.threads.set(threadId, working);
      reaped.push({
        threadId,
        title: thread.title,
        labels: { ...thread.labels },
        participantAgentIds: thread.participants
          .map((p) => p.agentId)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
        idleMs,
      });
      console.log(`[MemoryThreadStore] Thread reaped (idle ${Math.round(idleMs / 1000)}s): ${threadId}`);
    }
    return reaped;
  }
}

// ── Thread 2.0 helpers ──────────────────────────────────────────────

/** Deep-clone a Thread so callers can't mutate the store's live state. */
function cloneThread(t: Thread): Thread {
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
        );
      }
      if (prior.status !== "staged") {
        throw new ThreadConvergenceGateError(
          `Cannot revise action ${op.id}: status is ${prior.status} (only "staged" is revisable).`,
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
        );
      }
      if (prior.status !== "staged") {
        throw new ThreadConvergenceGateError(
          `Cannot retract action ${op.id}: status is ${prior.status} (only "staged" is retractable).`,
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

export class MemoryAuditStore implements IAuditStore {
  private entries: AuditEntry[] = [];
  private counter = 0;

  async logEntry(actor: AuditEntry["actor"], action: string, details: string, relatedEntity?: string): Promise<AuditEntry> {
    this.counter++;
    const entry: AuditEntry = {
      id: `audit-${this.counter}`,
      timestamp: new Date().toISOString(),
      actor,
      action,
      details,
      relatedEntity: relatedEntity || null,
    };
    this.entries.push(entry);
    console.log(`[MemoryAuditStore] ${entry.actor}/${entry.action}: ${entry.details.substring(0, 80)}`);
    return { ...entry };
  }

  async listEntries(limit = 50, actor?: AuditEntry["actor"]): Promise<AuditEntry[]> {
    let filtered = this.entries;
    if (actor) filtered = filtered.filter((e) => e.actor === actor);
    // Return most recent first
    return filtered.slice(-limit).reverse().map((e) => ({ ...e }));
  }
}

// ── M18 Shared Helpers ───────────────────────────────────────────────

import { createHash } from "node:crypto";
import { validateStagedActions } from "./policy/staged-action-payloads.js";

/** sha256(globalInstanceId) — token deliberately NOT mixed in (see thread-79). */
export function computeFingerprint(globalInstanceId: string): string {
  return createHash("sha256").update(globalInstanceId).digest("hex");
}

/** Compact hash suffix for display engineerIds (first 12 hex chars of fingerprint). */
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

export class MemoryEngineerRegistry implements IEngineerRegistry {
  private sessionRoles: Map<string, SessionRole> = new Map();
  // M18 Agent state
  private agents: Map<string, Agent> = new Map();      // engineerId -> Agent
  private byFingerprint: Map<string, string> = new Map(); // fingerprint -> engineerId
  private pendingQueues: Map<string, unknown[]> = new Map(); // engineerId -> pending (stub for migrate_agent_queue)
  private displacementHistory: Map<string, number[]> = new Map(); // fingerprint -> timestamps
  private sessionToEngineerId: Map<string, string> = new Map();
  private lastTouchAt: Map<string, number> = new Map(); // engineerId -> ms

  setSessionRole(sessionId: string, role: SessionRole): void {
    this.sessionRoles.set(sessionId, role);
  }

  getRole(sessionId: string): SessionRole {
    return this.sessionRoles.get(sessionId) || "unknown";
  }

  async getStatusSummary() {
    const engineers: EngineerStatusEntry[] = Array.from(this.agents.values())
      .filter((a) => !a.archived)
      .map((a) => ({
        engineerId: a.engineerId,
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
    const fingerprint = computeFingerprint(payload.globalInstanceId);
    const now = new Date().toISOString();
    // Mission-24 Phase 2 (ADR-014 §77): SessionRole widened with
    // "director" so the director-* agentId prefix flow can authorize
    // MCP tools via the existing getRole()-driven RBAC without the
    // legacy "unknown" → "engineer" fallback in task-policy auto-register.
    this.sessionRoles.set(sessionId, tokenRole as SessionRole);

    const existingId = this.byFingerprint.get(fingerprint);
    let agent = existingId ? this.agents.get(existingId) ?? null : null;

    if (agent) {
      // Role mismatch is a hard security boundary.
      if (agent.role !== tokenRole) {
        return {
          ok: false,
          code: "role_mismatch",
          message: `Token role '${tokenRole}' does not match persisted agent role '${agent.role}' for engineerId=${agent.engineerId}`,
        };
      }
      // Thrashing rate-limit (before displacement write).
      if (agent.status === "online") {
        const history = this.displacementHistory.get(fingerprint) ?? [];
        const tripped = recordDisplacementAndCheck(history, Date.now());
        this.displacementHistory.set(fingerprint, history);
        if (tripped) {
          return {
            ok: false,
            code: "agent_thrashing_detected",
            message: `Agent ${agent.engineerId} exceeded ${THRASHING_THRESHOLD} displacements in ${THRASHING_WINDOW_MS / 1000}s — halting to prevent fork-bomb. Check ~/.ois/instance.json for duplicate processes.`,
          };
        }
      }
      // Displacement: increment epoch, rebind session.
      // Labels are immutable post-create in v1 — payload.labels is silently ignored.
      agent.sessionEpoch += 1;
      agent.currentSessionId = sessionId;
      agent.status = "online";
      agent.clientMetadata = payload.clientMetadata;
      agent.advisoryTags = payload.advisoryTags ?? {};
      agent.labels = agent.labels ?? {};
      agent.lastSeenAt = now;
      // ADR-017: liveness reset on displacement; wakeEndpoint + receiptSla
      // are mutable config (unlike labels) and accept updates per payload.
      agent.livenessState = "online";
      agent.lastHeartbeatAt = now;
      agent.receiptSla = payload.receiptSla ?? agent.receiptSla ?? DEFAULT_AGENT_RECEIPT_SLA_MS;
      agent.wakeEndpoint = payload.wakeEndpoint ?? agent.wakeEndpoint ?? null;
      this.agents.set(agent.engineerId, agent);
      this.sessionToEngineerId.set(sessionId, agent.engineerId);
      this.lastTouchAt.set(agent.engineerId, Date.now());
      console.log(`[MemoryEngineerRegistry] Agent displaced: ${agent.engineerId} epoch=${agent.sessionEpoch}`);
      return {
        ok: true,
        engineerId: agent.engineerId,
        sessionEpoch: agent.sessionEpoch,
        wasCreated: false,
        clientMetadata: agent.clientMetadata,
        advisoryTags: agent.advisoryTags,
        labels: agent.labels,
      };
    }

    // First-contact: create a new Agent entity. Mission-24 Phase 2
    // (ADR-014 §77): director sessions get the reserved director-*
    // agentId prefix so dispatch selectors + audit trails can identify
    // Director actors at a glance (distinct from architect/engineer
    // which share the eng-* prefix). The prefix is cosmetic for routing
    // (the `role` field on the Agent is the authoritative check) but
    // makes cross-session traces immediately legible.
    const agentIdPrefix = tokenRole === "director" ? "director" : "eng";
    const engineerId = `${agentIdPrefix}-${shortHash(fingerprint)}`;
    agent = {
      engineerId,
      fingerprint,
      role: tokenRole,
      status: "online",
      archived: false,
      sessionEpoch: 1,
      currentSessionId: sessionId,
      clientMetadata: payload.clientMetadata,
      advisoryTags: payload.advisoryTags ?? {},
      labels: payload.labels ?? {},
      firstSeenAt: now,
      lastSeenAt: now,
      livenessState: "online",
      lastHeartbeatAt: now,
      receiptSla: payload.receiptSla ?? DEFAULT_AGENT_RECEIPT_SLA_MS,
      wakeEndpoint: payload.wakeEndpoint ?? null,
    };
    this.agents.set(engineerId, agent);
    this.byFingerprint.set(fingerprint, engineerId);
    this.sessionToEngineerId.set(sessionId, engineerId);
    this.lastTouchAt.set(engineerId, Date.now());
    console.log(`[MemoryEngineerRegistry] Agent created: ${engineerId}`);
    return {
      ok: true,
      engineerId,
      sessionEpoch: 1,
      wasCreated: true,
      clientMetadata: agent.clientMetadata,
      advisoryTags: agent.advisoryTags,
      labels: agent.labels,
    };
  }

  async getAgent(engineerId: string): Promise<Agent | null> {
    const a = this.agents.get(engineerId);
    if (!a) return null;
    const liveness = computeLivenessState(a, Date.now());
    return { ...a, livenessState: liveness, status: liveness === "online" ? "online" : "offline" };
  }

  async getAgentForSession(sessionId: string): Promise<Agent | null> {
    const engineerId = this.sessionToEngineerId.get(sessionId);
    if (!engineerId) return null;
    const a = this.agents.get(engineerId);
    if (!a) return null;
    const liveness = computeLivenessState(a, Date.now());
    return { ...a, livenessState: liveness, status: liveness === "online" ? "online" : "offline" };
  }

  async listAgents(): Promise<Agent[]> {
    const now = Date.now();
    return Array.from(this.agents.values()).map((a) => {
      const liveness = computeLivenessState(a, now);
      return { ...a, livenessState: liveness, status: liveness === "online" ? "online" : "offline" };
    });
  }

  async refreshHeartbeat(engineerId: string): Promise<void> {
    const a = this.agents.get(engineerId);
    if (!a) return;
    a.lastHeartbeatAt = new Date().toISOString();
    a.livenessState = "online";
  }

  async setLivenessState(engineerId: string, state: AgentLivenessState): Promise<void> {
    const a = this.agents.get(engineerId);
    if (!a) return;
    a.livenessState = state;
  }

  async selectAgents(selector: Selector): Promise<Agent[]> {
    const engineerIdSet = selector.engineerIds && selector.engineerIds.length > 0
      ? new Set(selector.engineerIds)
      : null;
    const out: Agent[] = [];
    for (const a of this.agents.values()) {
      if (a.archived) continue;
      if (a.status !== "online") continue;
      if (selector.engineerId && a.engineerId !== selector.engineerId) continue;
      if (engineerIdSet && !engineerIdSet.has(a.engineerId)) continue;
      if (selector.roles && !selector.roles.includes(a.role)) continue;
      if (!labelsMatch(a.labels ?? {}, selector.matchLabels)) continue;
      out.push({ ...a });
    }
    return out;
  }

  async touchAgent(sessionId: string): Promise<void> {
    const engineerId = this.sessionToEngineerId.get(sessionId);
    if (!engineerId) return;
    const agent = this.agents.get(engineerId);
    if (!agent) return;
    const now = Date.now();
    const last = this.lastTouchAt.get(engineerId) ?? 0;
    if (now - last < AGENT_TOUCH_MIN_INTERVAL_MS && agent.status === "online") return;
    agent.lastSeenAt = new Date(now).toISOString();
    if (agent.status !== "online") agent.status = "online";
    this.lastTouchAt.set(engineerId, now);
  }

  async markAgentOffline(sessionId: string): Promise<void> {
    const engineerId = this.sessionToEngineerId.get(sessionId);
    if (!engineerId) return;
    const agent = this.agents.get(engineerId);
    if (agent && agent.currentSessionId === sessionId) {
      agent.status = "offline";
      agent.livenessState = "offline";
      agent.lastSeenAt = new Date().toISOString();
    }
    this.sessionToEngineerId.delete(sessionId);
  }

  async migrateAgentQueue(sourceEngineerId: string, targetEngineerId: string): Promise<{ moved: number }> {
    const src = this.pendingQueues.get(sourceEngineerId) ?? [];
    const dst = this.pendingQueues.get(targetEngineerId) ?? [];
    const moved = src.length;
    this.pendingQueues.set(targetEngineerId, [...dst, ...src]);
    this.pendingQueues.set(sourceEngineerId, []);
    console.log(`[MemoryEngineerRegistry] migrate_agent_queue: moved ${moved} from ${sourceEngineerId} to ${targetEngineerId}`);
    return { moved };
  }

}
