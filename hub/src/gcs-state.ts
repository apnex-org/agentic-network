/**
 * GCS Bucket implementation of ITaskStore and IEngineerRegistry.
 *
 * Stores tasks as JSON files, reports as Markdown files, and engineer
 * registry entries as JSON files in a GCS bucket.
 *
 * Bucket layout:
 *   gs://{bucket}/tasks/task-001.json
 *   gs://{bucket}/reports/task-001-report.md
 *   gs://{bucket}/engineers/eng-1.json
 *   gs://{bucket}/meta/counter.json
 */

import { Storage } from "@google-cloud/storage";
import type {
  Task,
  TaskStatus,
  Proposal,
  ProposalStatus,
  Thread,
  ThreadStatus,
  ThreadAuthor,
  ThreadIntent,
  SemanticIntent,
  AuditEntry,
  Notification,
  EngineerStatusEntry,
  SessionRole,
  ITaskStore,
  IProposalStore,
  IThreadStore,
  IAuditStore,
  INotificationStore,
  IEngineerRegistry,
  Agent,
  AgentRole,
  RegisterAgentPayload,
  RegisterAgentResult,
  Selector,
} from "./state.js";
import {
  computeFingerprint,
  shortHash,
  recordDisplacementAndCheck,
  labelsMatch,
  taskClaimableBy,
  THRASHING_THRESHOLD,
  THRASHING_WINDOW_MS,
  AGENT_TOUCH_MIN_INTERVAL_MS,
} from "./state.js";

// ── Simple async lock ────────────────────────────────────────────────
// Prevents concurrent GCS read-modify-write races within a single
// Node.js process (Cloud Run max-instances=1).

class AsyncLock {
  private locked = false;
  private queue: (() => void)[] = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }
}

// ── GCS Helpers ──────────────────────────────────────────────────────

const storage = new Storage();

export async function readJson<T>(bucket: string, path: string): Promise<T | null> {
  try {
    const [content] = await storage.bucket(bucket).file(path).download();
    return JSON.parse(content.toString("utf-8")) as T;
  } catch (error: any) {
    if (error.code === 404) return null;
    throw error;
  }
}

export async function writeJson(bucket: string, path: string, data: unknown): Promise<void> {
  const content = JSON.stringify(data, null, 2);
  await storage.bucket(bucket).file(path).save(content, {
    contentType: "application/json",
  });
}

// ── M18: GCS Optimistic Concurrency Control helpers ─────────────────
// Uses `ifGenerationMatch` to implement compare-and-swap semantics for
// Agent entity updates. A `generation` of 0 means "must not exist yet"
// (create-only); any other value matches the expected object version.

export async function readJsonWithGeneration<T>(
  bucket: string,
  path: string,
): Promise<{ data: T; generation: number } | null> {
  try {
    const file = storage.bucket(bucket).file(path);
    const [content] = await file.download();
    const [metadata] = await file.getMetadata();
    return {
      data: JSON.parse(content.toString("utf-8")) as T,
      generation: Number(metadata.generation ?? 0),
    };
  } catch (error: any) {
    if (error.code === 404) return null;
    throw error;
  }
}

/** Thrown when `ifGenerationMatch` fails — another writer won the race. */
export class GcsOccPreconditionFailed extends Error {
  constructor(path: string) {
    super(`GCS OCC precondition failed for ${path}`);
    this.name = "GcsOccPreconditionFailed";
  }
}

export async function writeJsonWithPrecondition(
  bucket: string,
  path: string,
  data: unknown,
  ifGenerationMatch: number,
): Promise<void> {
  const content = JSON.stringify(data, null, 2);
  try {
    await storage.bucket(bucket).file(path).save(content, {
      contentType: "application/json",
      preconditionOpts: { ifGenerationMatch },
    });
  } catch (error: any) {
    // GCS returns 412 Precondition Failed when generation mismatches.
    if (error.code === 412) throw new GcsOccPreconditionFailed(path);
    throw error;
  }
}

async function writeMarkdown(bucket: string, path: string, content: string): Promise<void> {
  await storage.bucket(bucket).file(path).save(content, {
    contentType: "text/markdown",
  });
}

async function deleteFile(bucket: string, path: string): Promise<void> {
  try {
    await storage.bucket(bucket).file(path).delete();
  } catch (error: any) {
    if (error.code !== 404) throw error;
  }
}

export async function listFiles(bucket: string, prefix: string): Promise<string[]> {
  const [files] = await storage.bucket(bucket).getFiles({ prefix });
  return files.map((f) => f.name);
}

// ── Counter Management ───────────────────────────────────────────────

interface Counters {
  taskCounter: number;
  proposalCounter: number;
  engineerCounter: number;
  threadCounter: number;
  notificationCounter: number;
  ideaCounter: number;
  missionCounter: number;
  turnCounter: number;
  teleCounter: number;
}

const counterLock = new AsyncLock();

/**
 * Safe number parser — returns 0 for any non-finite value (NaN, undefined, null, Infinity).
 */
function safeInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

export async function getAndIncrementCounter(
  bucket: string,
  field: keyof Counters
): Promise<number> {
  await counterLock.acquire();
  try {
    const raw = (await readJson<Counters>(bucket, "meta/counter.json")) || {
      taskCounter: 0,
      proposalCounter: 0,
      engineerCounter: 0,
      threadCounter: 0,
      notificationCounter: 0,
      ideaCounter: 0,
      missionCounter: 0,
      turnCounter: 0,
      teleCounter: 0,
    };
    // Ensure all counters are valid finite numbers (handles NaN, null, undefined)
    const counters: Counters = {
      taskCounter: safeInt(raw.taskCounter),
      proposalCounter: safeInt(raw.proposalCounter),
      engineerCounter: safeInt(raw.engineerCounter),
      threadCounter: safeInt(raw.threadCounter),
      notificationCounter: safeInt(raw.notificationCounter),
      ideaCounter: safeInt(raw.ideaCounter),
      missionCounter: safeInt(raw.missionCounter),
      turnCounter: safeInt(raw.turnCounter),
      teleCounter: safeInt(raw.teleCounter),
    };
    counters[field]++;
    await writeJson(bucket, "meta/counter.json", counters);
    return counters[field];
  } finally {
    counterLock.release();
  }
}

/**
 * Counter reconciliation — scans existing entities and ensures counters
 * are at least as high as the highest existing ID. Prevents ID collisions
 * after counter corruption (e.g., the thread-NaN bug).
 */
async function reconcileCounters(bucket: string): Promise<void> {
  await counterLock.acquire();
  try {
    const raw = (await readJson<Counters>(bucket, "meta/counter.json")) || {
      taskCounter: 0,
      proposalCounter: 0,
      engineerCounter: 0,
      threadCounter: 0,
      notificationCounter: 0,
      ideaCounter: 0,
      missionCounter: 0,
      turnCounter: 0,
      teleCounter: 0,
    };
    const counters: Counters = {
      taskCounter: safeInt(raw.taskCounter),
      proposalCounter: safeInt(raw.proposalCounter),
      engineerCounter: safeInt(raw.engineerCounter),
      threadCounter: safeInt(raw.threadCounter),
      notificationCounter: safeInt(raw.notificationCounter),
      ideaCounter: safeInt(raw.ideaCounter),
      missionCounter: safeInt(raw.missionCounter),
      turnCounter: safeInt(raw.turnCounter),
      teleCounter: safeInt(raw.teleCounter),
    };

    // Scan each entity type and find the highest existing numeric ID
    const prefixes: { prefix: string; pattern: RegExp; field: keyof Counters }[] = [
      { prefix: "tasks/", pattern: /task-(\d+)\.json$/, field: "taskCounter" },
      { prefix: "proposals/", pattern: /prop-(\d+)\.json$/, field: "proposalCounter" },
      { prefix: "engineers/", pattern: /eng-(\d+)\.json$/, field: "engineerCounter" },
      { prefix: "threads/", pattern: /thread-(\d+)\.json$/, field: "threadCounter" },
      { prefix: "notifications/", pattern: /notif-(\d+)\.json$/, field: "notificationCounter" },
      { prefix: "ideas/", pattern: /idea-(\d+)\.json$/, field: "ideaCounter" },
      { prefix: "missions/", pattern: /mission-(\d+)\.json$/, field: "missionCounter" },
      { prefix: "turns/", pattern: /turn-(\d+)\.json$/, field: "turnCounter" },
      { prefix: "tele/", pattern: /tele-(\d+)\.json$/, field: "teleCounter" },
    ];

    let reconciled = false;
    for (const { prefix, pattern, field } of prefixes) {
      const files = await listFiles(bucket, prefix);
      let maxId = 0;
      for (const file of files) {
        const match = file.match(pattern);
        if (match) {
          const num = parseInt(match[1], 10);
          if (Number.isFinite(num) && num > maxId) maxId = num;
        }
      }
      if (maxId > counters[field]) {
        console.log(`[Reconcile] ${field}: ${counters[field]} → ${maxId} (found higher existing ID)`);
        counters[field] = maxId;
        reconciled = true;
      }
    }

    if (reconciled) {
      await writeJson(bucket, "meta/counter.json", counters);
      console.log(`[Reconcile] Counters reconciled: ${JSON.stringify(counters)}`);
    } else {
      console.log(`[Reconcile] Counters OK: ${JSON.stringify(counters)}`);
    }
  } finally {
    counterLock.release();
  }
}

// Clean up orphaned NaN files from counter corruption bugs
async function cleanupOrphanedFiles(bucket: string): Promise<void> {
  const prefixes = ["tasks/", "proposals/", "engineers/", "threads/"];
  for (const prefix of prefixes) {
    const files = await listFiles(bucket, prefix);
    for (const file of files) {
      if (file.includes("NaN")) {
        console.log(`[Cleanup] Deleting orphaned file: ${file}`);
        await deleteFile(bucket, file);
      }
    }
  }
}

// Export reconciliation utilities for startup use
export { reconcileCounters, cleanupOrphanedFiles };

// ── GCS Task Store ───────────────────────────────────────────────────

export class GcsTaskStore implements ITaskStore {
  private bucket: string;
  private taskLock = new AsyncLock();

  constructor(bucket: string) {
    this.bucket = bucket;
    console.log(`[GcsTaskStore] Using bucket: gs://${bucket}`);
  }

  async submitDirective(directive: string, correlationId?: string, idempotencyKey?: string, title?: string, description?: string, dependsOn?: string[], labels?: Record<string, string>): Promise<string> {
    const num = await getAndIncrementCounter(this.bucket, "taskCounter");
    const id = `task-${num}`;
    const now = new Date().toISOString();
    const hasDeps = dependsOn && dependsOn.length > 0;

    const task: Task = {
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
    };

    await writeJson(this.bucket, `tasks/${id}.json`, task);
    console.log(`[GcsTaskStore] Directive submitted: ${id} (status: ${hasDeps ? "blocked" : "pending"})`);
    return id;
  }

  async findByIdempotencyKey(key: string): Promise<Task | null> {
    const files = await listFiles(this.bucket, "tasks/");
    for (const file of files) {
      const task = await readJson<Task>(this.bucket, file);
      if (task && task.idempotencyKey === key) {
        return task;
      }
    }
    return null;
  }

  async unblockDependents(completedTaskId: string): Promise<string[]> {
    const files = await listFiles(this.bucket, "tasks/");
    const unblocked: string[] = [];

    // First pass: load all tasks to check dependency status
    const allTasks = new Map<string, Task>();
    for (const file of files) {
      const task = await readJson<Task>(this.bucket, file);
      if (task) allTasks.set(task.id, task);
    }

    for (const [, task] of allTasks) {
      if (task.status !== "blocked") continue;
      if (!task.dependsOn || !task.dependsOn.includes(completedTaskId)) continue;
      // Check if ALL dependencies are now completed
      const allDepsCompleted = task.dependsOn.every((depId) => {
        const dep = allTasks.get(depId);
        return dep && dep.status === "completed";
      });
      if (allDepsCompleted) {
        task.status = "pending";
        task.updatedAt = new Date().toISOString();
        await writeJson(this.bucket, `tasks/${task.id}.json`, task);
        unblocked.push(task.id);
        console.log(`[GcsTaskStore] Task unblocked: ${task.id}`);
      }
    }
    return unblocked;
  }

  async cancelDependents(failedTaskId: string): Promise<string[]> {
    const files = await listFiles(this.bucket, "tasks/");
    const cancelled: string[] = [];

    for (const file of files) {
      const task = await readJson<Task>(this.bucket, file);
      if (!task || task.status !== "blocked") continue;
      if (!task.dependsOn || !task.dependsOn.includes(failedTaskId)) continue;
      task.status = "cancelled";
      task.updatedAt = new Date().toISOString();
      await writeJson(this.bucket, `tasks/${task.id}.json`, task);
      cancelled.push(task.id);
      console.log(`[GcsTaskStore] Task cancelled (dependency failed): ${task.id}`);
    }
    return cancelled;
  }

  async getNextDirective(claimant?: { engineerId?: string; labels?: Record<string, string> }): Promise<Task | null> {
    await this.taskLock.acquire();
    try {
      const files = await listFiles(this.bucket, "tasks/");
      for (const file of files) {
        const task = await readJson<Task>(this.bucket, file);
        if (!task || task.status !== "pending") continue;
        if (!taskClaimableBy(task.labels ?? {}, claimant?.labels)) continue;
        task.status = "working";
        task.assignedEngineerId = claimant?.engineerId ?? null;
        task.updatedAt = new Date().toISOString();
        await writeJson(this.bucket, file, task);
        console.log(`[GcsTaskStore] Directive assigned: ${task.id}${task.assignedEngineerId ? ` → ${task.assignedEngineerId}` : ""}`);
        return task;
      }
      return null;
    } finally {
      this.taskLock.release();
    }
  }

  async submitReport(taskId: string, report: string, summary: string, success: boolean, verification?: string): Promise<boolean> {
    const taskPath = `tasks/${taskId}.json`;
    const task = await readJson<Task>(this.bucket, taskPath);
    if (!task) {
      console.log(`[GcsTaskStore] Report failed: task ${taskId} not found`);
      return false;
    }

    const version = (task.revisionCount || 0) + 1;
    const reportRef = `reports/${taskId}-v${version}-report.md`;
    task.report = report;
    task.reportSummary = summary;
    task.reportRef = reportRef;
    task.verification = verification || null;
    task.status = "in_review";
    task.updatedAt = new Date().toISOString();

    // Write task metadata update
    await writeJson(this.bucket, taskPath, task);

    // Write report as a separate Markdown file
    const reportContent = [
      `# Engineering Report: ${taskId}`,
      "",
      `**Status:** ${task.status}`,
      `**Directive:** ${task.directive}`,
      `**Summary:** ${summary}`,
      verification ? `**Verification:** ${verification}` : null,
      `**Completed:** ${task.updatedAt}`,
      "",
      "---",
      "",
      report,
    ].filter(Boolean).join("\n");
    await writeMarkdown(this.bucket, reportRef, reportContent);

    console.log(`[GcsTaskStore] Report submitted for: ${taskId} (${task.status})`);
    return true;
  }

  async getNextReport(): Promise<Task | null> {
    await this.taskLock.acquire();
    try {
      const files = await listFiles(this.bucket, "tasks/");
      for (const file of files) {
        const task = await readJson<Task>(this.bucket, file);
        if (
          task &&
          (task.status === "completed" || task.status === "failed") &&
          task.report !== null
        ) {
          // Mark as reported but keep report data intact
          // Full report is also preserved in reports/{taskId}-report.md
          const result = { ...task };
          task.status = ("reported_" + task.status) as TaskStatus;
          task.updatedAt = new Date().toISOString();
          await writeJson(this.bucket, file, task);
          console.log(`[GcsTaskStore] Report retrieved: ${task.id}`);
          return result;
        }
      }
      return null;
    } finally {
      this.taskLock.release();
    }
  }

  async getTask(taskId: string): Promise<Task | null> {
    return await readJson<Task>(this.bucket, `tasks/${taskId}.json`);
  }

  async listTasks(): Promise<Task[]> {
    const files = await listFiles(this.bucket, "tasks/");
    const tasks: Task[] = [];
    for (const file of files) {
      const task = await readJson<Task>(this.bucket, file);
      if (task) tasks.push(task);
    }
    return tasks;
  }

  async cancelTask(taskId: string): Promise<boolean> {
    const taskPath = `tasks/${taskId}.json`;
    const task = await readJson<Task>(this.bucket, taskPath);
    if (!task) return false;
    if (task.status !== "pending") return false;
    task.status = "cancelled";
    task.updatedAt = new Date().toISOString();
    await writeJson(this.bucket, taskPath, task);
    console.log(`[GcsTaskStore] Task cancelled: ${taskId}`);
    return true;
  }

  async requestClarification(taskId: string, question: string): Promise<boolean> {
    const taskPath = `tasks/${taskId}.json`;
    const task = await readJson<Task>(this.bucket, taskPath);
    if (!task || task.status !== "working") return false;
    task.status = "input_required";
    task.clarificationQuestion = question;
    task.updatedAt = new Date().toISOString();
    await writeJson(this.bucket, taskPath, task);
    console.log(`[GcsTaskStore] Clarification requested for: ${taskId}`);
    return true;
  }

  async respondToClarification(taskId: string, answer: string): Promise<boolean> {
    const taskPath = `tasks/${taskId}.json`;
    const task = await readJson<Task>(this.bucket, taskPath);
    if (!task || task.status !== "input_required") return false;
    task.status = "working";
    task.clarificationAnswer = answer;
    task.updatedAt = new Date().toISOString();
    await writeJson(this.bucket, taskPath, task);
    console.log(`[GcsTaskStore] Clarification answered for: ${taskId}`);
    return true;
  }

  async submitReview(taskId: string, assessment: string, decision?: "approved" | "rejected"): Promise<boolean> {
    const taskPath = `tasks/${taskId}.json`;
    const task = await readJson<Task>(this.bucket, taskPath);
    if (!task) return false;

    const version = (task.revisionCount || 0) + 1;
    const reviewRef = `reviews/${taskId}-v${version}-review.md`;
    task.reviewAssessment = assessment;
    task.reviewRef = reviewRef;
    task.updatedAt = new Date().toISOString();

    if (decision === "approved") {
      task.status = "completed";
    } else if (decision === "rejected") {
      if ((task.revisionCount || 0) >= 3) {
        task.status = "escalated";
      } else {
        task.revisionCount = (task.revisionCount || 0) + 1;
        task.status = "working";
      }
    }

    // Write task metadata update
    await writeJson(this.bucket, taskPath, task);

    // Write review as a separate Markdown file
    const reviewContent = [
      `# Architect Review: ${taskId} (v${version})`,
      "",
      `**Task:** ${task.directive}`,
      `**Decision:** ${decision || "none"}`,
      `**Reviewed:** ${task.updatedAt}`,
      "",
      "---",
      "",
      assessment,
    ].join("\n");
    await writeMarkdown(this.bucket, reviewRef, reviewContent);

    console.log(`[GcsTaskStore] Review submitted for: ${taskId} (v${version}, decision: ${decision || "none"})`);
    return true;
  }

  async getReview(taskId: string): Promise<{ taskId: string; assessment: string; reviewRef: string } | null> {
    const task = await readJson<Task>(this.bucket, `tasks/${taskId}.json`);
    if (!task || !task.reviewAssessment) return null;
    return {
      taskId: task.id,
      assessment: task.reviewAssessment,
      reviewRef: task.reviewRef || `reviews/${taskId}-v1-review.md`,
    };
  }
}

// ── GCS Engineer Registry ────────────────────────────────────────────

export class GcsEngineerRegistry implements IEngineerRegistry {
  private bucket: string;
  private sessionRoles: Map<string, SessionRole> = new Map();
  // M18 displacement rate-limit accounting (in-memory; resets on hub restart).
  private displacementHistory: Map<string, number[]> = new Map();
  // Session heartbeat bookkeeping (in-memory; resets on hub restart).
  private sessionToEngineerId: Map<string, string> = new Map();
  private lastTouchAt: Map<string, number> = new Map(); // engineerId -> ms

  constructor(bucket: string) {
    this.bucket = bucket;
    console.log(`[GcsEngineerRegistry] Using bucket: gs://${bucket}`);
  }

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

  /**
   * OCC-protected Agent registration / displacement.
   *
   * Flow:
   *   1. Compute fingerprint from globalInstanceId (token NOT mixed in).
   *   2. Read agents/by-fingerprint/<fp>.json with generation.
   *   3. If not found → create new Agent (write with ifGenerationMatch=0).
   *   4. If found:
   *      a. If role mismatch → 403 role_mismatch.
   *      b. If currently online → check thrashing rate limit.
   *      c. Increment sessionEpoch, rebind currentSessionId, update metadata.
   *      d. Write with ifGenerationMatch=<previous generation>.
   *      e. On precondition fail → caller retries; one-shot retry here.
   */
  async registerAgent(
    sessionId: string,
    tokenRole: AgentRole,
    payload: RegisterAgentPayload,
    address?: string,
  ): Promise<RegisterAgentResult> {
    this.sessionRoles.set(sessionId, (tokenRole === "director" ? "unknown" : tokenRole) as SessionRole);
    const fingerprint = computeFingerprint(payload.globalInstanceId);
    const fpPath = `agents/by-fingerprint/${fingerprint}.json`;

    // Two attempts: one for the natural path, one to retry on OCC contention.
    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = await readJsonWithGeneration<Agent>(this.bucket, fpPath);
      const now = new Date().toISOString();

      if (!existing) {
        // First-contact create: ifGenerationMatch=0 ensures "must not exist".
        const engineerId = `eng-${shortHash(fingerprint)}`;
        const agent: Agent = {
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
        try {
          await writeJsonWithPrecondition(this.bucket, fpPath, agent, 0);
          await writeJson(this.bucket, `agents/${engineerId}.json`, agent);
          this.sessionToEngineerId.set(sessionId, engineerId);
          this.lastTouchAt.set(engineerId, Date.now());
          console.log(`[GcsEngineerRegistry] Agent created: ${engineerId}`);
          return {
            ok: true,
            engineerId,
            sessionEpoch: 1,
            wasCreated: true,
            clientMetadata: agent.clientMetadata,
            advisoryTags: agent.advisoryTags,
            labels: agent.labels,
          };
        } catch (err) {
          if (err instanceof GcsOccPreconditionFailed) continue; // race: another create won
          throw err;
        }
      }

      const { data: agent, generation } = existing;

      // Role mismatch = hard security boundary.
      if (agent.role !== tokenRole) {
        return {
          ok: false,
          code: "role_mismatch",
          message: `Token role '${tokenRole}' does not match persisted agent role '${agent.role}' for engineerId=${agent.engineerId}`,
        };
      }

      // Thrashing circuit breaker (only counts live displacements).
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

      // Displace: increment epoch, rebind session, update mutable metadata.
      // Labels are immutable post-create in v1 — payload.labels is silently ignored.
      // Defensive migration: older Agents may lack the labels field entirely.
      const updated: Agent = {
        ...agent,
        sessionEpoch: agent.sessionEpoch + 1,
        currentSessionId: sessionId,
        status: "online",
        clientMetadata: payload.clientMetadata,
        advisoryTags: payload.advisoryTags ?? agent.advisoryTags ?? {},
        labels: agent.labels ?? {},
        lastSeenAt: now,
      };

      try {
        await writeJsonWithPrecondition(this.bucket, fpPath, updated, generation);
        await writeJson(this.bucket, `agents/${updated.engineerId}.json`, updated);
        this.sessionToEngineerId.set(sessionId, updated.engineerId);
        this.lastTouchAt.set(updated.engineerId, Date.now());
        console.log(`[GcsEngineerRegistry] Agent displaced: ${updated.engineerId} epoch=${updated.sessionEpoch}`);
        return {
          ok: true,
          engineerId: updated.engineerId,
          sessionEpoch: updated.sessionEpoch,
          wasCreated: false,
          clientMetadata: updated.clientMetadata,
          advisoryTags: updated.advisoryTags,
          labels: updated.labels,
        };
      } catch (err) {
        if (err instanceof GcsOccPreconditionFailed) continue; // race: retry once
        throw err;
      }
    }

    // Both attempts lost the OCC race — caller should retry on its own.
    return {
      ok: false,
      code: "agent_thrashing_detected",
      message: `OCC contention exceeded retry budget for fingerprint=${fingerprint}; likely concurrent registration storm.`,
    };
  }

  async getAgent(engineerId: string): Promise<Agent | null> {
    return await readJson<Agent>(this.bucket, `agents/${engineerId}.json`);
  }

  async getAgentForSession(sessionId: string): Promise<Agent | null> {
    const engineerId = this.sessionToEngineerId.get(sessionId);
    if (!engineerId) return null;
    return await readJson<Agent>(this.bucket, `agents/${engineerId}.json`);
  }

  async listAgents(): Promise<Agent[]> {
    const files = await listFiles(this.bucket, "agents/");
    const agents: Agent[] = [];
    for (const file of files) {
      // Only read the top-level per-engineerId file, not the by-fingerprint mirror.
      if (file.startsWith("agents/by-fingerprint/")) continue;
      const a = await readJson<Agent>(this.bucket, file);
      if (a) agents.push(a);
    }
    return agents;
  }

  async selectAgents(selector: Selector): Promise<Agent[]> {
    // Fast path for engineerId pinpoint — skip full bucket scan.
    if (selector.engineerId) {
      const a = await this.getAgent(selector.engineerId);
      if (!a) return [];
      if (a.archived) return [];
      if (a.status !== "online") return [];
      if (selector.roles && !selector.roles.includes(a.role)) return [];
      if (!labelsMatch(a.labels ?? {}, selector.matchLabels)) return [];
      return [a];
    }
    const all = await this.listAgents();
    return all.filter((a) => {
      if (a.archived) return false;
      if (a.status !== "online") return false;
      if (selector.roles && !selector.roles.includes(a.role)) return false;
      if (!labelsMatch(a.labels ?? {}, selector.matchLabels)) return false;
      return true;
    });
  }

  /**
   * Heartbeat: bump lastSeenAt on the Agent bound to this session.
   * Rate-limited to AGENT_TOUCH_MIN_INTERVAL_MS per agent to avoid GCS thrash.
   * OCC-protected read-modify-write on agents/<eid>.json; on precondition failure
   * the competing write already carried a fresher lastSeenAt, so we silently skip.
   */
  async touchAgent(sessionId: string): Promise<void> {
    const engineerId = this.sessionToEngineerId.get(sessionId);
    if (!engineerId) return;
    const now = Date.now();
    const last = this.lastTouchAt.get(engineerId) ?? 0;
    if (now - last < AGENT_TOUCH_MIN_INTERVAL_MS) return;
    // Reserve the slot up front so concurrent touches collapse to one write.
    this.lastTouchAt.set(engineerId, now);

    const existing = await readJsonWithGeneration<Agent>(this.bucket, `agents/${engineerId}.json`);
    if (!existing) return;
    const { data: agent, generation } = existing;
    if (agent.currentSessionId !== sessionId) return; // session no longer owns this agent
    const updated: Agent = {
      ...agent,
      lastSeenAt: new Date(now).toISOString(),
      status: "online",
    };
    try {
      await writeJsonWithPrecondition(this.bucket, `agents/${engineerId}.json`, updated, generation);
      // Mirror: fingerprint-indexed copy (best-effort, no generation tracked here).
      await writeJson(this.bucket, `agents/by-fingerprint/${agent.fingerprint}.json`, updated);
    } catch (err) {
      if (err instanceof GcsOccPreconditionFailed) return; // racing writer won; nothing to do
      throw err;
    }
  }

  /**
   * Mark the Agent bound to this session offline. Called on session teardown.
   * Only writes if the Agent's currentSessionId still matches — otherwise a
   * newer session has already taken over (displacement) and we must not clobber it.
   */
  async markAgentOffline(sessionId: string): Promise<void> {
    const engineerId = this.sessionToEngineerId.get(sessionId);
    this.sessionToEngineerId.delete(sessionId);
    if (!engineerId) return;

    const existing = await readJsonWithGeneration<Agent>(this.bucket, `agents/${engineerId}.json`);
    if (!existing) return;
    const { data: agent, generation } = existing;
    if (agent.currentSessionId !== sessionId) return; // a newer session owns the agent
    const updated: Agent = {
      ...agent,
      status: "offline",
      lastSeenAt: new Date().toISOString(),
    };
    try {
      await writeJsonWithPrecondition(this.bucket, `agents/${engineerId}.json`, updated, generation);
      await writeJson(this.bucket, `agents/by-fingerprint/${agent.fingerprint}.json`, updated);
      console.log(`[GcsEngineerRegistry] Agent marked offline: ${engineerId}`);
    } catch (err) {
      if (err instanceof GcsOccPreconditionFailed) return; // displaced mid-cleanup
      throw err;
    }
  }

  /**
   * Move pending notifications from sourceEngineerId's queue into targetEngineerId's queue.
   * Used for "my laptop died, I have a new globalInstanceId" recovery. Does NOT delete the
   * source Agent — Agents are append-only (see thread-79).
   *
   * Note: The actual pending-notification queue layout depends on NotificationStore; this
   * implementation is a best-effort scan of notifications/ that targets the source engineer.
   * Integration coverage is deferred to OpenCode (see Handoff Notes).
   */
  async migrateAgentQueue(sourceEngineerId: string, targetEngineerId: string): Promise<{ moved: number }> {
    // Placeholder: hub-networking owns the engineerId-keyed queue. This method exposes the
    // migration *entry point* that the admin tool binds to, and logs. A future revision
    // rewires HubNetworking's ActionablePendingQueue to accept reassignment.
    console.log(`[GcsEngineerRegistry] migrate_agent_queue: ${sourceEngineerId} -> ${targetEngineerId} (stub; queue rewire pending)`);
    return { moved: 0 };
  }

}

// ── GCS Proposal Store ───────────────────────────────────────────────

export class GcsProposalStore implements IProposalStore {
  private bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
    console.log(`[GcsProposalStore] Using bucket: gs://${bucket}`);
  }

  async submitProposal(title: string, summary: string, body: string, correlationId?: string, executionPlan?: import("./state.js").ProposedExecutionPlan, labels?: Record<string, string>): Promise<Proposal> {
    const num = await getAndIncrementCounter(this.bucket, "proposalCounter");
    const id = `prop-${num}`;
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

    // Write metadata
    await writeJson(this.bucket, `proposals/${id}.json`, proposal);

    // Write full proposal as Markdown
    const mdContent = [
      `# Proposal: ${title}`,
      "",
      `**ID:** ${id}`,
      `**Status:** submitted`,
      `**Summary:** ${summary}`,
      `**Submitted:** ${now}`,
      "",
      "---",
      "",
      body,
    ].join("\n");
    await writeMarkdown(this.bucket, proposalRef, mdContent);

    console.log(`[GcsProposalStore] Proposal submitted: ${id} — ${title}`);
    return { ...proposal };
  }

  async getProposals(status?: ProposalStatus): Promise<Proposal[]> {
    const files = await listFiles(this.bucket, "proposals/");
    const proposals: Proposal[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const p = await readJson<Proposal>(this.bucket, file);
      if (p) {
        if (status && p.status !== status) continue;
        proposals.push(p);
      }
    }
    return proposals;
  }

  async getProposal(proposalId: string): Promise<Proposal | null> {
    return await readJson<Proposal>(this.bucket, `proposals/${proposalId}.json`);
  }

  async reviewProposal(proposalId: string, decision: ProposalStatus, feedback: string): Promise<boolean> {
    const path = `proposals/${proposalId}.json`;
    const p = await readJson<Proposal>(this.bucket, path);
    if (!p) return false;

    p.status = decision;
    p.decision = decision;
    p.feedback = feedback;
    p.updatedAt = new Date().toISOString();
    await writeJson(this.bucket, path, p);

    console.log(`[GcsProposalStore] Proposal ${proposalId} reviewed: ${decision}`);
    return true;
  }

  async closeProposal(proposalId: string): Promise<boolean> {
    const path = `proposals/${proposalId}.json`;
    const p = await readJson<Proposal>(this.bucket, path);
    if (!p) return false;
    if (p.status !== "approved" && p.status !== "rejected" && p.status !== "changes_requested") return false;
    p.status = "implemented";
    p.updatedAt = new Date().toISOString();
    await writeJson(this.bucket, path, p);
    console.log(`[GcsProposalStore] Proposal ${proposalId} closed as implemented`);
    return true;
  }

  async setScaffoldResult(proposalId: string, result: import("./state.js").ScaffoldResult): Promise<boolean> {
    const path = `proposals/${proposalId}.json`;
    const p = await readJson<Proposal>(this.bucket, path);
    if (!p) return false;
    p.scaffoldResult = result;
    p.updatedAt = new Date().toISOString();
    await writeJson(this.bucket, path, p);
    return true;
  }
}

// ── GCS Thread Store ─────────────────────────────────────────────────

export class GcsThreadStore implements IThreadStore {
  private bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
    console.log(`[GcsThreadStore] Using bucket: gs://${bucket}`);
  }

  async openThread(title: string, message: string, author: ThreadAuthor, maxRounds = 10, correlationId?: string, labels?: Record<string, string>): Promise<Thread> {
    const num = await getAndIncrementCounter(this.bucket, "threadCounter");
    const id = `thread-${num}`;
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

    await writeJson(this.bucket, `threads/${id}.json`, thread);
    console.log(`[GcsThreadStore] Thread opened: ${id} — ${title}`);
    return { ...thread };
  }

  async replyToThread(threadId: string, message: string, author: ThreadAuthor, converged = false, intent: ThreadIntent = null, semanticIntent: SemanticIntent = null): Promise<Thread | null> {
    const path = `threads/${threadId}.json`;
    const thread = await readJson<Thread>(this.bucket, path);
    if (!thread || thread.status !== "active") return null;
    if (thread.currentTurn !== author) return null;

    const now = new Date().toISOString();
    thread.messages.push({ author, text: message, timestamp: now, converged, intent, semanticIntent });
    thread.roundCount++;
    thread.outstandingIntent = intent;
    if (semanticIntent) thread.currentSemanticIntent = semanticIntent;
    thread.currentTurn = author === "engineer" ? "architect" : "engineer";
    thread.updatedAt = now;

    // Check convergence
    const msgs = thread.messages;
    if (msgs.length >= 2 && msgs[msgs.length - 1].converged && msgs[msgs.length - 2].converged) {
      thread.status = "converged";
      console.log(`[GcsThreadStore] Thread converged: ${threadId}`);
    }

    // Check round limit
    if (thread.roundCount >= thread.maxRounds && thread.status === "active") {
      thread.status = "round_limit";
      console.log(`[GcsThreadStore] Thread hit round limit: ${threadId}`);
    }

    await writeJson(this.bucket, path, thread);
    console.log(`[GcsThreadStore] Reply on ${threadId} by ${author} (round ${thread.roundCount}/${thread.maxRounds})`);
    return { ...thread };
  }

  async getThread(threadId: string): Promise<Thread | null> {
    return await readJson<Thread>(this.bucket, `threads/${threadId}.json`);
  }

  async listThreads(status?: ThreadStatus): Promise<Thread[]> {
    const files = await listFiles(this.bucket, "threads/");
    const threads: Thread[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const t = await readJson<Thread>(this.bucket, file);
      if (t) {
        if (status && t.status !== status) continue;
        threads.push(t);
      }
    }
    return threads;
  }

  async closeThread(threadId: string): Promise<boolean> {
    const path = `threads/${threadId}.json`;
    const thread = await readJson<Thread>(this.bucket, path);
    if (!thread) return false;
    thread.status = "closed";
    thread.updatedAt = new Date().toISOString();
    await writeJson(this.bucket, path, thread);
    console.log(`[GcsThreadStore] Thread closed: ${threadId}`);
    return true;
  }

  async setConvergenceAction(threadId: string, action: import("./state.js").ConvergenceAction): Promise<boolean> {
    const path = `threads/${threadId}.json`;
    const thread = await readJson<Thread>(this.bucket, path);
    if (!thread) return false;
    thread.convergenceAction = action;
    thread.updatedAt = new Date().toISOString();
    await writeJson(this.bucket, path, thread);
    return true;
  }
}

// ── GCS Audit Store ──────────────────────────────────────────────────

export class GcsAuditStore implements IAuditStore {
  private bucket: string;
  private auditLock = new AsyncLock();

  constructor(bucket: string) {
    this.bucket = bucket;
    console.log(`[GcsAuditStore] Using bucket: gs://${bucket}`);
  }

  async logEntry(actor: AuditEntry["actor"], action: string, details: string, relatedEntity?: string): Promise<AuditEntry> {
    const now = new Date();
    // Use timestamp-based ID for natural chronological ordering in GCS
    const ts = now.toISOString().replace(/[:.]/g, "-");
    const id = `audit-${ts}`;

    const entry: AuditEntry = {
      id,
      timestamp: now.toISOString(),
      actor,
      action,
      details,
      relatedEntity: relatedEntity || null,
    };

    // Write as JSON for structured querying
    await writeJson(this.bucket, `audit/${id}.json`, entry);

    // Also write a human-readable log line to a daily Markdown file
    const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const logPath = `audit/log-${dateStr}.md`;
    const logLine = `| ${now.toISOString()} | ${actor} | ${action} | ${details.substring(0, 120)} | ${relatedEntity || "—"} |\n`;

    await this.auditLock.acquire();
    try {
      // Read existing log or create header
      let existing: string | null = null;
      try {
        const [content] = await storage.bucket(this.bucket).file(logPath).download();
        existing = content.toString("utf-8");
      } catch (err: any) {
        if (err.code !== 404) throw err;
      }

      if (!existing) {
        existing = `# Audit Log — ${dateStr}\n\n| Timestamp | Actor | Action | Details | Entity |\n| --- | --- | --- | --- | --- |\n`;
      }
      existing += logLine;
      await writeMarkdown(this.bucket, logPath, existing);
    } finally {
      this.auditLock.release();
    }

    console.log(`[GcsAuditStore] ${actor}/${action}: ${details.substring(0, 80)}`);
    return { ...entry };
  }

  async listEntries(limit = 50, actor?: AuditEntry["actor"]): Promise<AuditEntry[]> {
    const files = await listFiles(this.bucket, "audit/");
    const entries: AuditEntry[] = [];

    // Only read JSON files (skip daily log Markdown files)
    const jsonFiles = files.filter((f) => f.endsWith(".json")).sort().reverse();

    for (const file of jsonFiles) {
      if (entries.length >= limit) break;
      const entry = await readJson<AuditEntry>(this.bucket, file);
      if (entry) {
        if (actor && entry.actor !== actor) continue;
        entries.push(entry);
      }
    }
    return entries;
  }
}

// ── GCS Notification Store ───────────────────────────────────────────

export class GcsNotificationStore implements INotificationStore {
  private bucket: string;
  private ulidGen: (() => string) | null = null;

  // AMP namespace cutover: new ULID notifications go to v2/, legacy stays frozen
  private static readonly V2_PREFIX = "notifications/v2/";

  constructor(bucket: string) {
    this.bucket = bucket;
    console.log(`[GcsNotificationStore] Using bucket: gs://${bucket} (v2 namespace: ${GcsNotificationStore.V2_PREFIX})`);
  }

  async persist(
    event: string,
    data: Record<string, unknown>,
    targetRoles: string[]
  ): Promise<Notification> {
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

    // Write to v2/ namespace — ULIDs are lexicographically sortable
    await writeJson(this.bucket, `${GcsNotificationStore.V2_PREFIX}${id}.json`, notification);

    console.log(`[GcsNotificationStore] Persisted ${id}: ${event} → [${targetRoles.join(",")}]`);
    return notification;
  }

  async listSince(afterId: number | string, role?: string): Promise<Notification[]> {
    const afterStr = String(afterId);

    // Only read from v2/ namespace — legacy integer notifications are frozen
    const files = await listFiles(this.bucket, GcsNotificationStore.V2_PREFIX);
    const jsonFiles = files
      .filter((f) => f.endsWith(".json"))
      .sort(); // Lexicographic sort — natural for ULIDs

    const notifications: Notification[] = [];
    for (const file of jsonFiles) {
      const notification = await readJson<Notification>(this.bucket, file);
      if (!notification) continue;
      // ULID string comparison — all v2 notifications have ULID IDs
      const nStr = String(notification.id);
      if (afterStr && nStr <= afterStr) continue;
      if (role && !notification.targetRoles.includes(role)) continue;
      notifications.push(notification);
    }

    return notifications;
  }

  async cleanup(maxAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
    // Clean up from v2/ namespace only
    const files = await listFiles(this.bucket, GcsNotificationStore.V2_PREFIX);
    let deleted = 0;

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const notification = await readJson<Notification>(this.bucket, file);
      if (!notification) continue;

      if (new Date(notification.timestamp).getTime() < cutoff) {
        await deleteFile(this.bucket, file);
        deleted++;
      }
    }

    if (deleted > 0) {
      console.log(`[GcsNotificationStore] Cleaned up ${deleted} expired notifications`);
    }
    return deleted;
  }
}
