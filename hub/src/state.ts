/**
 * State interfaces and in-memory implementation for the MCP Relay Hub.
 *
 * Defines ITaskStore and IEngineerRegistry interfaces that can be backed
 * by either in-memory storage (local dev) or GCS (production).
 */

export type TaskStatus = "pending" | "working" | "blocked" | "input_required" | "in_review" | "completed" | "failed" | "escalated" | "cancelled";

export type SessionRole = "engineer" | "architect" | "unknown";

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
  createdAt: string;
  updatedAt: string;
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
  // Displacement rate-limit accounting (in-memory, not persisted):
  // see GcsEngineerRegistry.displacementHistory for the in-memory map.
}

export interface RegisterAgentPayload {
  globalInstanceId: string;
  role: AgentRole;
  clientMetadata: AgentClientMetadata;
  advisoryTags?: AgentAdvisoryTags;
  labels?: AgentLabels;
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
  createdAt: string;
  updatedAt: string;
}

export type ThreadStatus = "active" | "converged" | "round_limit" | "closed";
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
  text: string;
  timestamp: string;
  converged: boolean;
  intent: ThreadIntent;
  semanticIntent: SemanticIntent;
}

export type ConvergenceActionType = "create_task" | "create_proposal";

export interface ConvergenceAction {
  type: ConvergenceActionType;
  templateData: {
    title: string;
    description: string;
  };
}

export interface Thread {
  id: string;
  title: string;
  status: ThreadStatus;
  initiatedBy: ThreadAuthor;
  currentTurn: ThreadAuthor;
  roundCount: number;
  maxRounds: number;
  outstandingIntent: ThreadIntent;
  currentSemanticIntent: SemanticIntent;
  correlationId: string | null;
  convergenceAction: ConvergenceAction | null;
  messages: ThreadMessage[];
  /** Mission-19: routing labels inherited from creator at open-time. */
  labels: Record<string, string>;
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

export interface IThreadStore {
  openThread(title: string, message: string, author: ThreadAuthor, maxRounds?: number, correlationId?: string, labels?: Record<string, string>): Promise<Thread>;
  replyToThread(threadId: string, message: string, author: ThreadAuthor, converged?: boolean, intent?: ThreadIntent, semanticIntent?: SemanticIntent): Promise<Thread | null>;
  getThread(threadId: string): Promise<Thread | null>;
  listThreads(status?: ThreadStatus): Promise<Thread[]>;
  closeThread(threadId: string): Promise<boolean>;
  setConvergenceAction(threadId: string, action: ConvergenceAction): Promise<boolean>;
}

export interface IProposalStore {
  submitProposal(title: string, summary: string, body: string, correlationId?: string, executionPlan?: ProposedExecutionPlan, labels?: Record<string, string>): Promise<Proposal>;
  setScaffoldResult(proposalId: string, result: ScaffoldResult): Promise<boolean>;
  getProposals(status?: ProposalStatus): Promise<Proposal[]>;
  getProposal(proposalId: string): Promise<Proposal | null>;
  reviewProposal(proposalId: string, decision: ProposalStatus, feedback: string): Promise<boolean>;
  closeProposal(proposalId: string): Promise<boolean>;
}

export interface ITaskStore {
  submitDirective(directive: string, correlationId?: string, idempotencyKey?: string, title?: string, description?: string, dependsOn?: string[], labels?: Record<string, string>): Promise<string>;
  findByIdempotencyKey(key: string): Promise<Task | null>;
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
}

/** Minimum interval between persisted Agent heartbeat writes (per agent). */
export const AGENT_TOUCH_MIN_INTERVAL_MS = 30_000;

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

  async submitDirective(directive: string, correlationId?: string, idempotencyKey?: string, title?: string, description?: string, dependsOn?: string[], labels?: Record<string, string>): Promise<string> {
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
      createdAt: now,
      updatedAt: now,
    });
    console.log(`[MemoryTaskStore] Directive submitted: ${id} (status: ${hasDeps ? "blocked" : "pending"})`);
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
    if (task.status !== "pending") return false;
    task.status = "cancelled";
    task.updatedAt = new Date().toISOString();
    console.log(`[MemoryTaskStore] Task cancelled: ${taskId}`);
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

  async submitProposal(title: string, summary: string, body: string, correlationId?: string, executionPlan?: ProposedExecutionPlan, labels?: Record<string, string>): Promise<Proposal> {
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
      createdAt: now,
      updatedAt: now,
    };
    this.proposals.set(id, proposal);
    console.log(`[MemoryProposalStore] Proposal submitted: ${id} — ${title}`);
    return { ...proposal };
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

  async openThread(title: string, message: string, author: ThreadAuthor, maxRounds = 10, correlationId?: string, labels?: Record<string, string>): Promise<Thread> {
    this.counter++;
    const id = `thread-${this.counter}`;
    const now = new Date().toISOString();
    const otherParty: ThreadAuthor = author === "engineer" ? "architect" : "engineer";
    const thread: Thread = {
      id,
      title,
      status: "active",
      initiatedBy: author,
      currentTurn: otherParty,
      roundCount: 1,
      maxRounds,
      outstandingIntent: null,
      currentSemanticIntent: null,
      correlationId: correlationId || null,
      convergenceAction: null,
      messages: [{ author, text: message, timestamp: now, converged: false, intent: null, semanticIntent: null }],
      labels: labels || {},
      createdAt: now,
      updatedAt: now,
    };
    this.threads.set(id, thread);
    console.log(`[MemoryThreadStore] Thread opened: ${id} — ${title}`);
    return { ...thread };
  }

  async replyToThread(threadId: string, message: string, author: ThreadAuthor, converged = false, intent: ThreadIntent = null, semanticIntent: SemanticIntent = null): Promise<Thread | null> {
    const thread = this.threads.get(threadId);
    if (!thread || thread.status !== "active") return null;
    if (thread.currentTurn !== author) return null;

    const now = new Date().toISOString();
    thread.messages.push({ author, text: message, timestamp: now, converged, intent, semanticIntent });
    if (semanticIntent) thread.currentSemanticIntent = semanticIntent;
    thread.roundCount++;
    thread.outstandingIntent = intent;
    thread.currentTurn = author === "engineer" ? "architect" : "engineer";
    thread.updatedAt = now;

    // Check convergence
    const msgs = thread.messages;
    if (msgs.length >= 2 && msgs[msgs.length - 1].converged && msgs[msgs.length - 2].converged) {
      thread.status = "converged";
      console.log(`[MemoryThreadStore] Thread converged: ${threadId}`);
    }

    // Check round limit
    if (thread.roundCount >= thread.maxRounds && thread.status === "active") {
      thread.status = "round_limit";
      console.log(`[MemoryThreadStore] Thread hit round limit: ${threadId}`);
    }

    console.log(`[MemoryThreadStore] Reply on ${threadId} by ${author} (round ${thread.roundCount}/${thread.maxRounds})`);
    return { ...thread };
  }

  async getThread(threadId: string): Promise<Thread | null> {
    const t = this.threads.get(threadId);
    return t ? { ...t } : null;
  }

  async listThreads(status?: ThreadStatus): Promise<Thread[]> {
    const all = Array.from(this.threads.values());
    if (status) return all.filter((t) => t.status === status).map((t) => ({ ...t }));
    return all.map((t) => ({ ...t }));
  }

  async closeThread(threadId: string): Promise<boolean> {
    const thread = this.threads.get(threadId);
    if (!thread) return false;
    thread.status = "closed";
    thread.updatedAt = new Date().toISOString();
    console.log(`[MemoryThreadStore] Thread closed: ${threadId}`);
    return true;
  }

  async setConvergenceAction(threadId: string, action: ConvergenceAction): Promise<boolean> {
    const thread = this.threads.get(threadId);
    if (!thread) return false;
    thread.convergenceAction = action;
    thread.updatedAt = new Date().toISOString();
    return true;
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
    // SessionRole is engineer|architect|unknown — map director to unknown for legacy use.
    this.sessionRoles.set(sessionId, (tokenRole === "director" ? "unknown" : tokenRole) as SessionRole);

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

    // First-contact: create a new Agent entity.
    const engineerId = `eng-${shortHash(fingerprint)}`;
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
    return a ? { ...a } : null;
  }

  async getAgentForSession(sessionId: string): Promise<Agent | null> {
    const engineerId = this.sessionToEngineerId.get(sessionId);
    if (!engineerId) return null;
    const a = this.agents.get(engineerId);
    return a ? { ...a } : null;
  }

  async listAgents(): Promise<Agent[]> {
    return Array.from(this.agents.values()).map((a) => ({ ...a }));
  }

  async selectAgents(selector: Selector): Promise<Agent[]> {
    const out: Agent[] = [];
    for (const a of this.agents.values()) {
      if (a.archived) continue;
      if (a.status !== "online") continue;
      if (selector.engineerId && a.engineerId !== selector.engineerId) continue;
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
