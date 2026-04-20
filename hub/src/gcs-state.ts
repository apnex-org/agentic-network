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
  ThreadMessage,
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
  AgentLivenessState,
  AgentRole,
  RegisterAgentPayload,
  RegisterAgentResult,
  Selector,
  ReplyToThreadOptions,
  OpenThreadOptions,
  ReapedThread,
  ParticipantRole,
  CascadeBacklink,
  EntityProvenance,
} from "./state.js";
import {
  computeFingerprint,
  shortHash,
  recordDisplacementAndCheck,
  labelsMatch,
  shallowEqualLabels,
  taskClaimableBy,
  applyStagedActionOps,
  upsertParticipant,
  ThreadConvergenceGateError,
  CONVERGENCE_GATE_REMEDIATION,
  truncateClosedThreadMessages,
  THRASHING_THRESHOLD,
  THRASHING_WINDOW_MS,
  AGENT_TOUCH_MIN_INTERVAL_MS,
  DEFAULT_AGENT_RECEIPT_SLA_MS,
} from "./state.js";
import type { ConvergenceGateSubtype } from "./state.js";
import { validateStagedActions } from "./policy/staged-action-payloads.js";

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

// Module-internal — NOT exported. External callers must use one of the
// three concurrency-aware primitives (createOnly / updateExisting /
// upsert) declared below. See ADR-011 for the invariant.
async function writeJson(bucket: string, path: string, data: unknown): Promise<void> {
  const content = JSON.stringify(data, null, 2);
  await storage.bucket(bucket).file(path).save(content, {
    contentType: "application/json",
  });
}

// ── GCS Optimistic Concurrency Control helpers ──────────────────────
// Uses `ifGenerationMatch` to implement compare-and-swap semantics on
// GCS-backed JSON objects. A `generation` of 0 means "must not exist yet"
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

/** Thrown by `updateExisting` when the target path does not exist. */
export class GcsPathNotFound extends Error {
  constructor(path: string) {
    super(`GCS path not found: ${path}`);
    this.name = "GcsPathNotFound";
  }
}

/** Thrown by `updateExisting` / `upsert` when the CAS retry budget is exhausted. */
export class GcsOccRetryExhausted extends Error {
  constructor(path: string, public readonly attempts: number) {
    super(`GCS OCC retry budget exhausted for ${path} after ${attempts} attempts`);
    this.name = "GcsOccRetryExhausted";
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

// ── Phase 2 concurrency-aware primitives (ADR-011) ──────────────────
// These are the ONLY public write surface for GCS-backed entity stores.
// The plain `writeJson` is module-internal — new call sites must pick
// one of the three intent-bearing primitives below.

const OCC_RETRY_MAX_ATTEMPTS = 5;
const OCC_RETRY_INITIAL_BACKOFF_MS = 20;

// Module-internal sentinel. Gated state transitions (e.g., "cancel only
// when pending") throw this from inside an `updateExisting` transform to
// signal the gate failed on a fresh read. Not retried — the transform's
// business check is authoritative. Caller catches and maps to its
// existing false/null contract.
class TransitionRejected extends Error {
  constructor(reason: string) {
    super(`transition rejected: ${reason}`);
    this.name = "TransitionRejected";
  }
}

/**
 * Exposed for unit testing only. Drives the CAS retry loop with injected
 * reader/writer so we can exercise the retry + backoff logic without a
 * live GCS bucket. Not for application use — application code should
 * call `createOnly` / `updateExisting` / `upsert`.
 */
export async function __casRetryForTest<T>(
  reader: () => Promise<{ data: T | null; generation: number }>,
  writer: (next: T, gen: number) => Promise<void>,
  transform: (current: T | null) => T | Promise<T>,
  opts: { allowMissing: boolean; path: string; sleep?: (ms: number) => Promise<void> },
): Promise<T> {
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; attempt < OCC_RETRY_MAX_ATTEMPTS; attempt++) {
    const { data, generation } = await reader();
    if (data === null && !opts.allowMissing) throw new GcsPathNotFound(opts.path);
    const next = await transform(data);
    try {
      await writer(next, generation);
      return next;
    } catch (err) {
      if (err instanceof GcsOccPreconditionFailed) {
        if (attempt + 1 >= OCC_RETRY_MAX_ATTEMPTS) {
          throw new GcsOccRetryExhausted(opts.path, attempt + 1);
        }
        const base = OCC_RETRY_INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        const jitter = Math.floor(Math.random() * base);
        await sleep(base + jitter);
        continue;
      }
      throw err;
    }
  }
  throw new GcsOccRetryExhausted(opts.path, OCC_RETRY_MAX_ATTEMPTS);
}

/**
 * Create a new JSON object at `path`. Fails with `GcsOccPreconditionFailed`
 * if the object already exists. Use for initial-creation paths where the
 * ID is freshly allocated and nothing else should be writing there.
 */
export async function createOnly<T>(
  bucket: string,
  path: string,
  data: T,
): Promise<void> {
  await writeJsonWithPrecondition(bucket, path, data, 0);
}

/**
 * OCC-safe update of an existing JSON object. Reads the current state
 * with its GCS generation, applies `transform`, and writes with
 * `ifGenerationMatch`. On precondition failure, re-reads and retries
 * with jittered exponential backoff up to `OCC_RETRY_MAX_ATTEMPTS`.
 *
 * Throws:
 *   - `GcsPathNotFound` if the object does not exist.
 *   - `GcsOccRetryExhausted` if concurrent writers beat us repeatedly.
 *   - Any other error from `transform` (not retried — business-level
 *     gating belongs inside the transform and bubbles up).
 *
 * Returns the final written state.
 */
export async function updateExisting<T>(
  bucket: string,
  path: string,
  transform: (current: T) => T | Promise<T>,
): Promise<T> {
  return __casRetryForTest<T>(
    async () => {
      const r = await readJsonWithGeneration<T>(bucket, path);
      return { data: r?.data ?? null, generation: r?.generation ?? 0 };
    },
    (next, gen) => writeJsonWithPrecondition(bucket, path, next, gen),
    (cur) => transform(cur as T),
    { allowMissing: false, path },
  );
}

/**
 * OCC-safe either-create-or-update. Reads the current state (may be
 * null), applies `transform(current | null)`, writes with
 * `ifGenerationMatch = generation` (0 if absent). Retries on precondition
 * failure with the same backoff as `updateExisting`.
 */
export async function upsert<T>(
  bucket: string,
  path: string,
  transform: (current: T | null) => T | Promise<T>,
): Promise<T> {
  return __casRetryForTest<T>(
    async () => {
      const r = await readJsonWithGeneration<T>(bucket, path);
      return { data: r?.data ?? null, generation: r?.generation ?? 0 };
    },
    (next, gen) => writeJsonWithPrecondition(bucket, path, next, gen),
    transform,
    { allowMissing: true, path },
  );
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
  bugCounter: number;
  // Phase 2x P0-1 — GCS persistence for ADR-017 pending-action queue
  // and Director-escalation notifications.
  pendingActionCounter: number;
  directorNotificationCounter: number;
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
      bugCounter: 0,
      pendingActionCounter: 0,
      directorNotificationCounter: 0,
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
      bugCounter: safeInt(raw.bugCounter),
      pendingActionCounter: safeInt(raw.pendingActionCounter),
      directorNotificationCounter: safeInt(raw.directorNotificationCounter),
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
      bugCounter: 0,
      pendingActionCounter: 0,
      directorNotificationCounter: 0,
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
      bugCounter: safeInt(raw.bugCounter),
      pendingActionCounter: safeInt(raw.pendingActionCounter),
      directorNotificationCounter: safeInt(raw.directorNotificationCounter),
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
      { prefix: "bugs/", pattern: /bug-(\d+)\.json$/, field: "bugCounter" },
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

  async submitDirective(directive: string, correlationId?: string, idempotencyKey?: string, title?: string, description?: string, dependsOn?: string[], labels?: Record<string, string>, backlink?: CascadeBacklink, createdBy?: EntityProvenance): Promise<string> {
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
      turnId: null,
      sourceThreadId: backlink?.sourceThreadId ?? null,
      sourceActionId: backlink?.sourceActionId ?? null,
      sourceThreadSummary: backlink?.sourceThreadSummary ?? null,
      createdBy,
      createdAt: now,
      updatedAt: now,
    };

    await createOnly<Task>(this.bucket, `tasks/${id}.json`, task);
    console.log(`[GcsTaskStore] Directive submitted: ${id} (status: ${hasDeps ? "blocked" : "pending"}${backlink ? `, cascade from ${backlink.sourceThreadId}/${backlink.sourceActionId}` : ""})`);
    return id;
  }

  async findByCascadeKey(key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">): Promise<Task | null> {
    // Linear scan — acceptable at Phase 2 scale. A secondary index is
    // follow-on work when task counts make this hot.
    const files = await listFiles(this.bucket, "tasks/");
    for (const file of files) {
      const task = await readJson<Task>(this.bucket, file);
      if (task && task.sourceThreadId === key.sourceThreadId && task.sourceActionId === key.sourceActionId) {
        return task;
      }
    }
    return null;
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
      // Stale-snapshot prefilter; transform re-checks against fresh state.
      const allDepsCompletedSnapshot = task.dependsOn.every((depId) => {
        const dep = allTasks.get(depId);
        return dep && dep.status === "completed";
      });
      if (!allDepsCompletedSnapshot) continue;
      try {
        await updateExisting<Task>(this.bucket, `tasks/${task.id}.json`, (current) => {
          if (current.status !== "blocked") throw new TransitionRejected("already transitioned");
          if (!current.dependsOn || !current.dependsOn.includes(completedTaskId)) {
            throw new TransitionRejected("dependency no longer relevant");
          }
          const stillAllDone = current.dependsOn.every((depId) => {
            const dep = allTasks.get(depId);
            return dep && dep.status === "completed";
          });
          if (!stillAllDone) throw new TransitionRejected("deps not all completed");
          current.status = "pending";
          current.updatedAt = new Date().toISOString();
          return current;
        });
        unblocked.push(task.id);
        console.log(`[GcsTaskStore] Task unblocked: ${task.id}`);
      } catch (err) {
        if (err instanceof TransitionRejected || err instanceof GcsPathNotFound) continue;
        throw err;
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
      try {
        await updateExisting<Task>(this.bucket, `tasks/${task.id}.json`, (current) => {
          if (current.status !== "blocked") throw new TransitionRejected("already transitioned");
          if (!current.dependsOn || !current.dependsOn.includes(failedTaskId)) {
            throw new TransitionRejected("dependency no longer relevant");
          }
          current.status = "cancelled";
          current.updatedAt = new Date().toISOString();
          return current;
        });
        cancelled.push(task.id);
        console.log(`[GcsTaskStore] Task cancelled (dependency failed): ${task.id}`);
      } catch (err) {
        if (err instanceof TransitionRejected || err instanceof GcsPathNotFound) continue;
        throw err;
      }
    }
    return cancelled;
  }

  async getNextDirective(claimant?: { engineerId?: string; labels?: Record<string, string> }): Promise<Task | null> {
    await this.taskLock.acquire();
    try {
      const files = await listFiles(this.bucket, "tasks/");
      for (const file of files) {
        const preview = await readJson<Task>(this.bucket, file);
        if (!preview || preview.status !== "pending") continue;
        if (!taskClaimableBy(preview.labels ?? {}, claimant?.labels)) continue;
        try {
          const task = await updateExisting<Task>(this.bucket, file, (current) => {
            if (current.status !== "pending") throw new TransitionRejected("already claimed");
            if (!taskClaimableBy(current.labels ?? {}, claimant?.labels)) {
              throw new TransitionRejected("labels diverged");
            }
            current.status = "working";
            current.assignedEngineerId = claimant?.engineerId ?? null;
            current.updatedAt = new Date().toISOString();
            return current;
          });
          console.log(`[GcsTaskStore] Directive assigned: ${task.id}${task.assignedEngineerId ? ` → ${task.assignedEngineerId}` : ""}`);
          return task;
        } catch (err) {
          if (err instanceof TransitionRejected || err instanceof GcsPathNotFound) continue;
          throw err;
        }
      }
      return null;
    } finally {
      this.taskLock.release();
    }
  }

  async submitReport(taskId: string, report: string, summary: string, success: boolean, verification?: string): Promise<boolean> {
    const taskPath = `tasks/${taskId}.json`;
    let finalTask: Task;
    try {
      finalTask = await updateExisting<Task>(this.bucket, taskPath, (current) => {
        const version = (current.revisionCount || 0) + 1;
        const reportRef = `reports/${taskId}-v${version}-report.md`;
        current.report = report;
        current.reportSummary = summary;
        current.reportRef = reportRef;
        current.verification = verification || null;
        current.status = "in_review";
        current.updatedAt = new Date().toISOString();
        return current;
      });
    } catch (err) {
      if (err instanceof GcsPathNotFound) {
        console.log(`[GcsTaskStore] Report failed: task ${taskId} not found`);
        return false;
      }
      throw err;
    }

    // Write report as a separate Markdown file
    const reportContent = [
      `# Engineering Report: ${taskId}`,
      "",
      `**Status:** ${finalTask.status}`,
      `**Directive:** ${finalTask.directive}`,
      `**Summary:** ${summary}`,
      verification ? `**Verification:** ${verification}` : null,
      `**Completed:** ${finalTask.updatedAt}`,
      "",
      "---",
      "",
      report,
    ].filter(Boolean).join("\n");
    await writeMarkdown(this.bucket, finalTask.reportRef!, reportContent);

    console.log(`[GcsTaskStore] Report submitted for: ${taskId} (${finalTask.status})`);
    return true;
  }

  async getNextReport(): Promise<Task | null> {
    await this.taskLock.acquire();
    try {
      const files = await listFiles(this.bucket, "tasks/");
      for (const file of files) {
        const preview = await readJson<Task>(this.bucket, file);
        if (
          !preview ||
          !(preview.status === "completed" || preview.status === "failed") ||
          preview.report === null
        ) continue;
        let preTransition: Task | null = null;
        try {
          await updateExisting<Task>(this.bucket, file, (current) => {
            if (!(current.status === "completed" || current.status === "failed")) {
              throw new TransitionRejected("already reported or status flipped");
            }
            if (current.report === null) throw new TransitionRejected("report cleared");
            preTransition = { ...current };
            current.status = ("reported_" + current.status) as TaskStatus;
            current.updatedAt = new Date().toISOString();
            return current;
          });
        } catch (err) {
          if (err instanceof TransitionRejected || err instanceof GcsPathNotFound) continue;
          throw err;
        }
        if (preTransition) {
          console.log(`[GcsTaskStore] Report retrieved: ${(preTransition as Task).id}`);
          return preTransition;
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
    let priorStatus: Task["status"] | null = null;
    try {
      await updateExisting<Task>(this.bucket, taskPath, (current) => {
        // Cancellable from any non-terminal in-flight state. Stewardship
        // need: stranded `working` tasks (assigned engineer offline) and
        // `blocked` tasks with stale deps both require cancellation to
        // clear the board — tightening to `pending` alone left zombies
        // unreclaimable (thread-131 finding). `in_review` is deliberately
        // excluded: a submitted report deserves a decision, not a cancel.
        const CANCELLABLE: Task["status"][] = ["pending", "working", "blocked", "input_required"];
        if (!CANCELLABLE.includes(current.status)) {
          throw new TransitionRejected(`not cancellable from status ${current.status}`);
        }
        priorStatus = current.status;
        current.status = "cancelled";
        current.updatedAt = new Date().toISOString();
        return current;
      });
      console.log(`[GcsTaskStore] Task cancelled: ${taskId} (was: ${priorStatus})`);
      return true;
    } catch (err) {
      if (err instanceof TransitionRejected || err instanceof GcsPathNotFound) return false;
      throw err;
    }
  }

  async requestClarification(taskId: string, question: string): Promise<boolean> {
    const taskPath = `tasks/${taskId}.json`;
    try {
      await updateExisting<Task>(this.bucket, taskPath, (current) => {
        if (current.status !== "working") throw new TransitionRejected("not working");
        current.status = "input_required";
        current.clarificationQuestion = question;
        current.updatedAt = new Date().toISOString();
        return current;
      });
      console.log(`[GcsTaskStore] Clarification requested for: ${taskId}`);
      return true;
    } catch (err) {
      if (err instanceof TransitionRejected || err instanceof GcsPathNotFound) return false;
      throw err;
    }
  }

  async respondToClarification(taskId: string, answer: string): Promise<boolean> {
    const taskPath = `tasks/${taskId}.json`;
    try {
      await updateExisting<Task>(this.bucket, taskPath, (current) => {
        if (current.status !== "input_required") throw new TransitionRejected("not input_required");
        current.status = "working";
        current.clarificationAnswer = answer;
        current.updatedAt = new Date().toISOString();
        return current;
      });
      console.log(`[GcsTaskStore] Clarification answered for: ${taskId}`);
      return true;
    } catch (err) {
      if (err instanceof TransitionRejected || err instanceof GcsPathNotFound) return false;
      throw err;
    }
  }

  async submitReview(taskId: string, assessment: string, decision?: "approved" | "rejected"): Promise<boolean> {
    const taskPath = `tasks/${taskId}.json`;
    let finalTask: Task;
    let reviewVersion = 0;
    try {
      finalTask = await updateExisting<Task>(this.bucket, taskPath, (current) => {
        reviewVersion = (current.revisionCount || 0) + 1;
        current.reviewAssessment = assessment;
        current.reviewRef = `reviews/${taskId}-v${reviewVersion}-review.md`;
        current.updatedAt = new Date().toISOString();

        if (decision === "approved") {
          current.status = "completed";
        } else if (decision === "rejected") {
          if ((current.revisionCount || 0) >= 3) {
            current.status = "escalated";
          } else {
            current.revisionCount = (current.revisionCount || 0) + 1;
            current.status = "working";
          }
        }
        return current;
      });
    } catch (err) {
      if (err instanceof GcsPathNotFound) return false;
      throw err;
    }

    // Write review as a separate Markdown file
    const reviewContent = [
      `# Architect Review: ${taskId} (v${reviewVersion})`,
      "",
      `**Task:** ${finalTask.directive}`,
      `**Decision:** ${decision || "none"}`,
      `**Reviewed:** ${finalTask.updatedAt}`,
      "",
      "---",
      "",
      assessment,
    ].join("\n");
    await writeMarkdown(this.bucket, finalTask.reviewRef!, reviewContent);

    console.log(`[GcsTaskStore] Review submitted for: ${taskId} (v${reviewVersion}, decision: ${decision || "none"})`);
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
    // Mission-24 Phase 2 (ADR-014 §77): SessionRole now carries the
    // "director" literal directly rather than mapping to "unknown".
    this.sessionRoles.set(sessionId, tokenRole as SessionRole);
    const fingerprint = computeFingerprint(payload.globalInstanceId);
    const fpPath = `agents/by-fingerprint/${fingerprint}.json`;

    // Two attempts: one for the natural path, one to retry on OCC contention.
    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = await readJsonWithGeneration<Agent>(this.bucket, fpPath);
      const now = new Date().toISOString();

      if (!existing) {
        // First-contact create: ifGenerationMatch=0 ensures "must not exist".
        // Mission-24 Phase 2 (ADR-014 §77): director sessions get the
        // reserved director-* agentId prefix for at-a-glance identification.
        const agentIdPrefix = tokenRole === "director" ? "director" : "eng";
        const engineerId = `${agentIdPrefix}-${shortHash(fingerprint)}`;
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
          livenessState: "online",
          lastHeartbeatAt: now,
          receiptSla: payload.receiptSla ?? DEFAULT_AGENT_RECEIPT_SLA_MS,
          wakeEndpoint: payload.wakeEndpoint ?? null,
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
      // CP3 C5 (bug-16): labels refresh on reconnect when the caller supplies
      // them in the handshake payload; omitting labels preserves the stored set.
      // Defensive migration: older Agents may lack the labels field entirely.
      const priorLabels = agent.labels ?? {};
      const nextLabels = payload.labels ?? priorLabels;
      const labelsChanged = !shallowEqualLabels(priorLabels, nextLabels);
      const updated: Agent = {
        ...agent,
        sessionEpoch: agent.sessionEpoch + 1,
        currentSessionId: sessionId,
        status: "online",
        clientMetadata: payload.clientMetadata,
        advisoryTags: payload.advisoryTags ?? agent.advisoryTags ?? {},
        labels: nextLabels,
        lastSeenAt: now,
        // ADR-017: liveness reset + mutable config re-apply.
        livenessState: "online",
        lastHeartbeatAt: now,
        receiptSla: payload.receiptSla ?? agent.receiptSla ?? DEFAULT_AGENT_RECEIPT_SLA_MS,
        wakeEndpoint: payload.wakeEndpoint ?? agent.wakeEndpoint ?? null,
      };

      try {
        await writeJsonWithPrecondition(this.bucket, fpPath, updated, generation);
        await writeJson(this.bucket, `agents/${updated.engineerId}.json`, updated);
        this.sessionToEngineerId.set(sessionId, updated.engineerId);
        this.lastTouchAt.set(updated.engineerId, Date.now());
        console.log(`[GcsEngineerRegistry] Agent displaced: ${updated.engineerId} epoch=${updated.sessionEpoch}`);
        const changedFields: ("labels" | "advisoryTags" | "clientMetadata")[] = [];
        if (labelsChanged) changedFields.push("labels");
        return {
          ok: true,
          engineerId: updated.engineerId,
          sessionEpoch: updated.sessionEpoch,
          wasCreated: false,
          clientMetadata: updated.clientMetadata,
          advisoryTags: updated.advisoryTags,
          labels: updated.labels,
          ...(changedFields.length > 0 ? { changedFields } : {}),
          ...(labelsChanged ? { priorLabels } : {}),
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
    const a = await readJson<Agent>(this.bucket, `agents/${engineerId}.json`);
    return a ? normalizeAgentShape(a) : null;
  }

  async getAgentForSession(sessionId: string): Promise<Agent | null> {
    const engineerId = this.sessionToEngineerId.get(sessionId);
    if (!engineerId) return null;
    const a = await readJson<Agent>(this.bucket, `agents/${engineerId}.json`);
    return a ? normalizeAgentShape(a) : null;
  }

  async listAgents(): Promise<Agent[]> {
    const files = await listFiles(this.bucket, "agents/");
    const agents: Agent[] = [];
    for (const file of files) {
      // Only read the top-level per-engineerId file, not the by-fingerprint mirror.
      if (file.startsWith("agents/by-fingerprint/")) continue;
      const a = await readJson<Agent>(this.bucket, file);
      if (a) agents.push(normalizeAgentShape(a));
    }
    return agents;
  }

  async selectAgents(selector: Selector): Promise<Agent[]> {
    const engineerIdSet = selector.engineerIds && selector.engineerIds.length > 0
      ? new Set(selector.engineerIds)
      : null;
    // Fast path for engineerId pinpoint — skip full bucket scan.
    if (selector.engineerId) {
      const a = await this.getAgent(selector.engineerId);
      if (!a) return [];
      if (a.archived) return [];
      if (a.status !== "online") return [];
      if (engineerIdSet && !engineerIdSet.has(a.engineerId)) return [];
      if (selector.roles && !selector.roles.includes(a.role)) return [];
      if (!labelsMatch(a.labels ?? {}, selector.matchLabels)) return [];
      return [a];
    }
    // Fast path for engineerIds pinpoint — fetch each directly rather
    // than scanning every agent key in the bucket.
    if (engineerIdSet) {
      const out: Agent[] = [];
      for (const id of engineerIdSet) {
        const a = await this.getAgent(id);
        if (!a) continue;
        if (a.archived) continue;
        if (a.status !== "online") continue;
        if (selector.roles && !selector.roles.includes(a.role)) continue;
        if (!labelsMatch(a.labels ?? {}, selector.matchLabels)) continue;
        out.push(a);
      }
      return out;
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

  /** ADR-017: refresh heartbeat on drain. Not rate-limited — drains
   *  are infrequent, so a write every time is acceptable. Resets
   *  livenessState to online on the authoritative proof-of-life. */
  async refreshHeartbeat(engineerId: string): Promise<void> {
    const existing = await readJsonWithGeneration<Agent>(this.bucket, `agents/${engineerId}.json`);
    if (!existing) return;
    const { data: agent, generation } = existing;
    const updated: Agent = {
      ...normalizeAgentShape(agent),
      lastHeartbeatAt: new Date().toISOString(),
      livenessState: "online",
    };
    try {
      await writeJsonWithPrecondition(this.bucket, `agents/${engineerId}.json`, updated, generation);
      await writeJson(this.bucket, `agents/by-fingerprint/${agent.fingerprint}.json`, updated);
    } catch (err) {
      if (err instanceof GcsOccPreconditionFailed) return;
      throw err;
    }
  }

  async setLivenessState(engineerId: string, state: AgentLivenessState): Promise<void> {
    const existing = await readJsonWithGeneration<Agent>(this.bucket, `agents/${engineerId}.json`);
    if (!existing) return;
    const { data: agent, generation } = existing;
    const updated: Agent = { ...normalizeAgentShape(agent), livenessState: state };
    try {
      await writeJsonWithPrecondition(this.bucket, `agents/${engineerId}.json`, updated, generation);
      await writeJson(this.bucket, `agents/by-fingerprint/${agent.fingerprint}.json`, updated);
    } catch (err) {
      if (err instanceof GcsOccPreconditionFailed) return;
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
      ...normalizeAgentShape(agent),
      status: "offline",
      livenessState: "offline",
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

  async submitProposal(title: string, summary: string, body: string, correlationId?: string, executionPlan?: import("./state.js").ProposedExecutionPlan, labels?: Record<string, string>, backlink?: CascadeBacklink, createdBy?: EntityProvenance): Promise<Proposal> {
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
      sourceThreadId: backlink?.sourceThreadId ?? null,
      sourceActionId: backlink?.sourceActionId ?? null,
      sourceThreadSummary: backlink?.sourceThreadSummary ?? null,
      createdBy,
      createdAt: now,
      updatedAt: now,
    };

    // Write metadata
    await createOnly<Proposal>(this.bucket, `proposals/${id}.json`, proposal);

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
    try {
      await updateExisting<Proposal>(this.bucket, path, (p) => {
        p.status = decision;
        p.decision = decision;
        p.feedback = feedback;
        p.updatedAt = new Date().toISOString();
        return p;
      });
      console.log(`[GcsProposalStore] Proposal ${proposalId} reviewed: ${decision}`);
      return true;
    } catch (err) {
      if (err instanceof GcsPathNotFound) return false;
      throw err;
    }
  }

  async closeProposal(proposalId: string): Promise<boolean> {
    const path = `proposals/${proposalId}.json`;
    try {
      await updateExisting<Proposal>(this.bucket, path, (p) => {
        if (p.status !== "approved" && p.status !== "rejected" && p.status !== "changes_requested") {
          throw new TransitionRejected("not in a closeable state");
        }
        p.status = "implemented";
        p.updatedAt = new Date().toISOString();
        return p;
      });
      console.log(`[GcsProposalStore] Proposal ${proposalId} closed as implemented`);
      return true;
    } catch (err) {
      if (err instanceof TransitionRejected || err instanceof GcsPathNotFound) return false;
      throw err;
    }
  }

  async findByCascadeKey(key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">): Promise<Proposal | null> {
    const files = await listFiles(this.bucket, "proposals/");
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const p = await readJson<Proposal>(this.bucket, file);
      if (p && p.sourceThreadId === key.sourceThreadId && p.sourceActionId === key.sourceActionId) {
        return p;
      }
    }
    return null;
  }

  async setScaffoldResult(proposalId: string, result: import("./state.js").ScaffoldResult): Promise<boolean> {
    const path = `proposals/${proposalId}.json`;
    try {
      await updateExisting<Proposal>(this.bucket, path, (p) => {
        p.scaffoldResult = result;
        p.updatedAt = new Date().toISOString();
        return p;
      });
      return true;
    } catch (err) {
      if (err instanceof GcsPathNotFound) return false;
      throw err;
    }
  }
}

// ── GCS Thread Store ─────────────────────────────────────────────────

export class GcsThreadStore implements IThreadStore {
  private bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
    console.log(`[GcsThreadStore] Using bucket: gs://${bucket}`);
  }

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
    const num = await getAndIncrementCounter(this.bucket, "threadCounter");
    const id = `thread-${num}`;
    const now = new Date().toISOString();
    // INV-TH17: honour recipientRole when known so engineer↔engineer
    // threads flip the turn to the counterparty engineer rather than
    // bouncing to "architect" via the legacy role-flip.
    const nextTurn: ThreadAuthor = recipientRole
      ?? (author === "engineer" ? "architect" : "engineer");
    const firstMessage: ThreadMessage = { author, authorAgentId, text: message, timestamp: now, converged: false, intent: null, semanticIntent: null };

    // Stored thread scalar holds no messages[] — messages live one-per-file
    // under threads/{id}/messages/{seq}.json so the reply-path transform
    // never RMWs an array (ADR-011 Phase 3).
    const scalar: Thread = {
      id,
      title,
      status: "active",
      // Mission-24 Phase 2 (INV-TH18): routing mode declared at open,
      // immutable for the thread's lifetime. Broadcast coerces to
      // Targeted on first reply (see replyToThread); no other mode
      // transitions permitted. Policy layer validates consistency.
      routingMode,
      context,
      idleExpiryMs: null,
      createdBy: {
        role: author,
        agentId: authorAgentId ?? `anonymous-${author}`,
      },
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
      messages: [],
      labels: labels || {},
      lastMessageConverged: false,
      createdAt: now,
      updatedAt: now,
    };

    await createOnly<Thread>(this.bucket, `threads/${id}.json`, scalar);
    await createOnly<ThreadMessage>(this.bucket, `threads/${id}/messages/1.json`, firstMessage);
    console.log(`[GcsThreadStore] Thread opened: ${id} — ${title}`);
    return { ...scalar, messages: [firstMessage] };
  }

  async replyToThread(threadId: string, message: string, author: ThreadAuthor, options: ReplyToThreadOptions = {}): Promise<Thread | null> {
    const {
      converged = false,
      intent = null,
      semanticIntent = null,
      stagedActions = [],
      summary: summaryUpdate,
      authorAgentId = null,
    } = options;
    const path = `threads/${threadId}.json`;
    try {
      const thread = await updateExisting<Thread>(this.bucket, path, (current) => {
        if (current.status !== "active") throw new TransitionRejected("thread not active");
        if (current.currentTurn !== author) throw new TransitionRejected("not this author's turn");
        // INV-TH17: agent-pinned turn enforcement.
        if (current.currentTurnAgentId && authorAgentId !== current.currentTurnAgentId) {
          throw new TransitionRejected("not this agent's turn");
        }

        const now = new Date().toISOString();

        // Mission-21: apply staging ops BEFORE the turn flip so the gate
        // evaluates the post-op convergenceActions state.
        applyStagedActionOps(
          current,
          stagedActions,
          { role: author as ParticipantRole, agentId: authorAgentId ?? null },
          now,
        );
        if (summaryUpdate !== undefined) current.summary = summaryUpdate;
        upsertParticipant(current.participants, author, authorAgentId, now);

        current.roundCount++;
        current.outstandingIntent = intent;
        if (semanticIntent) current.currentSemanticIntent = semanticIntent;
        // INV-TH17: hand the turn to the next participant.
        const otherParticipant = current.participants.find(
          (p) => !(p.role === author && p.agentId === authorAgentId) && p.role !== "director",
        );
        if (otherParticipant) {
          current.currentTurn = otherParticipant.role as ThreadAuthor;
          current.currentTurnAgentId = otherParticipant.agentId ?? null;
        } else {
          current.currentTurn = author === "engineer" ? "architect" : "engineer";
          current.currentTurnAgentId = null;
        }
        // Mission-24 Phase 2 (INV-TH18): broadcast → targeted coercion
        // on first reply. The responder becomes the second (and only)
        // other participant; the pool-discovery surface closes. Single
        // permitted routingMode transition.
        if (current.routingMode === "broadcast") {
          current.routingMode = "unicast";
        }
        current.updatedAt = now;

        const prevConverged = current.lastMessageConverged ?? false;
        const willConverge = converged && prevConverged;
        current.lastMessageConverged = converged;

        if (willConverge) {
          // Mission-21 Phase 1 forcing-function gate.
          const staged = current.convergenceActions.filter((a) => a.status === "staged");
          const summaryEmpty = current.summary.trim().length === 0;

          if (staged.length === 0 || summaryEmpty) {
            const reasons: string[] = [];
            if (staged.length === 0) reasons.push("no convergenceActions committed (stage at least one — Phase 1 vocab: close_no_action{reason})");
            if (summaryEmpty) reasons.push("summary is empty (narrate the agreed outcome)");
            const bothMissing = staged.length === 0 && summaryEmpty;
            const subtype: ConvergenceGateSubtype = staged.length === 0 ? "stage_missing" : "summary_missing";
            const remediation = bothMissing
              ? `${CONVERGENCE_GATE_REMEDIATION.stage_missing} Also: ${CONVERGENCE_GATE_REMEDIATION.summary_missing}`
              : undefined;
            throw new ThreadConvergenceGateError(
              `Thread convergence rejected: ${reasons.join("; ")}.`,
              subtype,
              remediation,
            );
          }

          // Mission-24 Phase 2 (M24-T4, INV-TH19): validate staged
          // payloads before staged→committed promotion. Any failure
          // aborts the transform; CAS leaves the thread untouched.
          const validation = validateStagedActions(staged);
          if (!validation.ok) {
            const detail = validation.errors
              .map((e) => `${e.actionId} (${e.type}): ${e.error}`)
              .join("; ");
            throw new ThreadConvergenceGateError(
              `Thread convergence rejected: staged action validation failed — ${detail}.`,
              "payload_validation",
            );
          }

          for (const action of current.convergenceActions) {
            if (action.status === "staged") action.status = "committed";
          }
          current.status = "converged";
        }

        if (current.roundCount >= current.maxRounds && current.status === "active") {
          current.status = "round_limit";
        }
        return current;
      });

      const newMessage: ThreadMessage = {
        author,
        authorAgentId,
        text: message,
        timestamp: thread.updatedAt,
        converged,
        intent,
        semanticIntent,
      };
      await createOnly<ThreadMessage>(
        this.bucket,
        `threads/${threadId}/messages/${thread.roundCount}.json`,
        newMessage,
      );

      if (thread.status === "converged") {
        const committedCount = thread.convergenceActions.filter((a) => a.status === "committed").length;
        console.log(`[GcsThreadStore] Thread converged: ${threadId} (${committedCount} committed action(s))`);
      } else if (thread.status === "round_limit") {
        console.log(`[GcsThreadStore] Thread hit round limit: ${threadId}`);
      }
      console.log(`[GcsThreadStore] Reply on ${threadId} by ${author}${authorAgentId ? ` (${authorAgentId})` : ""} (round ${thread.roundCount}/${thread.maxRounds})`);
      return { ...thread, messages: await this.loadMessages(threadId, thread) };
    } catch (err) {
      // Gate rejection is a policy-visible failure — propagate so the
      // caller gets the specific message to self-correct. Other errors
      // (not-active, not-your-turn, missing path) still map to null.
      if (err instanceof ThreadConvergenceGateError) throw err;
      if (err instanceof TransitionRejected || err instanceof GcsPathNotFound) return null;
      throw err;
    }
  }

  async getThread(threadId: string): Promise<Thread | null> {
    const scalar = await readJson<Thread>(this.bucket, `threads/${threadId}.json`);
    if (!scalar) return null;
    const normalized = normalizeThreadShape(scalar);
    const hydrated = { ...normalized, messages: await this.loadMessages(threadId, normalized) };
    // Phase 2d CP3 C3 — summary-only truncation on closed threads.
    return truncateClosedThreadMessages(hydrated);
  }

  async listThreads(status?: ThreadStatus): Promise<Thread[]> {
    const files = await listFiles(this.bucket, "threads/");
    const threads: Thread[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      // Filter out per-message files (threads/<id>/messages/<seq>.json).
      // Top-level thread scalars are `threads/<id>.json` only.
      if (file.slice("threads/".length).includes("/")) continue;
      const t = await readJson<Thread>(this.bucket, file);
      if (t) {
        if (status && t.status !== status) continue;
        // CP3 C3: list_threads currently returns the scalar view
        // without hydrating per-file messages. Truncation still
        // applies to any inline messages[] the scalar carries (pre-
        // Phase-3 threads) — post-Phase-3 scalars have empty
        // messages[] on disk so truncation is a no-op for them.
        threads.push(truncateClosedThreadMessages(normalizeThreadShape(t)));
      }
    }
    return threads;
  }

  /**
   * Hydrate a thread's messages. Reads per-file messages under
   * `threads/{id}/messages/{seq}.json` ordered by numeric seq. Falls
   * back to the scalar's inline `messages` when no per-file entries
   * exist — supports legacy threads written before the Phase 3 split.
   * Also normalises legacy message shape to fill in authorAgentId.
   */
  private async loadMessages(threadId: string, scalar: Thread): Promise<ThreadMessage[]> {
    const files = await listFiles(this.bucket, `threads/${threadId}/messages/`);
    if (files.length === 0) return scalar.messages ?? [];
    const entries: { seq: number; msg: ThreadMessage }[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const basename = file.split("/").pop()!;
      const seq = Number(basename.replace(/\.json$/, ""));
      if (!Number.isFinite(seq)) continue;
      const msg = await readJson<ThreadMessage>(this.bucket, file);
      if (msg) entries.push({ seq, msg });
    }
    entries.sort((a, b) => a.seq - b.seq);
    // Mission-21 Phase 1: backfill authorAgentId=null on legacy messages
    // written before Threads 2.0 so consumers always see a defined field.
    return entries.map((e) => ({ ...e.msg, authorAgentId: e.msg.authorAgentId ?? null }));
  }

  async closeThread(threadId: string): Promise<boolean> {
    const path = `threads/${threadId}.json`;
    try {
      await updateExisting<Thread>(this.bucket, path, (thread) => {
        thread.status = "closed";
        thread.updatedAt = new Date().toISOString();
        return thread;
      });
      console.log(`[GcsThreadStore] Thread closed: ${threadId}`);
      return true;
    } catch (err) {
      if (err instanceof GcsPathNotFound) return false;
      throw err;
    }
  }

  async markCascadeFailed(threadId: string): Promise<boolean> {
    const path = `threads/${threadId}.json`;
    try {
      await updateExisting<Thread>(this.bucket, path, (thread) => {
        if (thread.status !== "converged" && thread.status !== "active") {
          throw new TransitionRejected(`cannot cascade_fail from status ${thread.status}`);
        }
        thread.status = "cascade_failed";
        thread.updatedAt = new Date().toISOString();
        return thread;
      });
      console.log(`[GcsThreadStore] Thread cascade_failed: ${threadId}`);
      return true;
    } catch (err) {
      if (err instanceof TransitionRejected || err instanceof GcsPathNotFound) return false;
      throw err;
    }
  }

  async leaveThread(threadId: string, leaverAgentId: string): Promise<Thread | null> {
    const path = `threads/${threadId}.json`;
    try {
      const updated = await updateExisting<Thread>(this.bucket, path, (current) => {
        if (current.status !== "active") throw new TransitionRejected("thread not active");
        const isParticipant = current.participants.some((p) => p.agentId === leaverAgentId);
        if (!isParticipant) throw new TransitionRejected("leaver is not a thread participant");

        const now = new Date().toISOString();
        // Auto-retract leaver's staged actions per M24-T6 spec.
        for (const action of current.convergenceActions) {
          if (action.status === "staged" && action.proposer.agentId === leaverAgentId) {
            action.status = "retracted";
            action.timestamp = now;
          }
        }
        current.status = "abandoned";
        current.updatedAt = now;
        return current;
      });
      console.log(`[GcsThreadStore] Thread abandoned: ${threadId} (leaver=${leaverAgentId})`);
      return { ...updated, messages: await this.loadMessages(threadId, updated) };
    } catch (err) {
      if (err instanceof TransitionRejected || err instanceof GcsPathNotFound) return null;
      throw err;
    }
  }

  async reapIdleThreads(defaultIdleExpiryMs: number): Promise<ReapedThread[]> {
    // List-then-update is non-atomic but acceptable for the reaper —
    // the CAS on each per-thread update ensures a concurrent reply
    // won't silently clobber the transition (the updateExisting
    // transform re-checks status=active; if a reply landed between the
    // list and the update, the transform throws TransitionRejected
    // and we skip that thread this tick. It'll be caught next cycle
    // if it idles again.)
    const scalars = await this.listThreads("active");
    const now = Date.now();
    const nowIso = new Date().toISOString();
    const reaped: ReapedThread[] = [];
    for (const thread of scalars) {
      const threshold = typeof thread.idleExpiryMs === "number" ? thread.idleExpiryMs : defaultIdleExpiryMs;
      const idleMs = now - new Date(thread.updatedAt).getTime();
      if (idleMs <= threshold) continue;
      const path = `threads/${thread.id}.json`;
      try {
        await updateExisting<Thread>(this.bucket, path, (current) => {
          if (current.status !== "active") throw new TransitionRejected("not active");
          const reIdleMs = now - new Date(current.updatedAt).getTime();
          const reThreshold = typeof current.idleExpiryMs === "number" ? current.idleExpiryMs : defaultIdleExpiryMs;
          if (reIdleMs <= reThreshold) throw new TransitionRejected("no longer idle");
          for (const action of current.convergenceActions) {
            if (action.status === "staged") {
              action.status = "retracted";
              action.timestamp = nowIso;
            }
          }
          current.status = "abandoned";
          current.updatedAt = nowIso;
          return current;
        });
        reaped.push({
          threadId: thread.id,
          title: thread.title,
          labels: { ...thread.labels },
          participantAgentIds: thread.participants
            .map((p) => p.agentId)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
          idleMs,
        });
        console.log(`[GcsThreadStore] Thread reaped (idle ${Math.round(idleMs / 1000)}s): ${thread.id}`);
      } catch (err) {
        if (err instanceof TransitionRejected || err instanceof GcsPathNotFound) {
          // Thread moved under us; skip this tick.
          continue;
        }
        throw err;
      }
    }
    return reaped;
  }

}

/**
 * Defensive read normaliser for Thread JSON read from GCS.
 *
 * Mission-21 Phase 1: backfills `convergenceActions`, `summary`,
 * `participants`, `recipientAgentId`, `currentTurnAgentId` for
 * pre-cutover threads that don't have them. Legacy `convergenceAction`
 * (singular) is read and silently dropped; the new `convergenceActions`
 * array is the only path forward (ADR-013).
 *
 * Mission-24 Phase 2 (ADR-014): additionally backfills
 * - `routingMode` — legacy threads default to `"unicast"` (their
 *   Phase 1 behaviour maps cleanly to agent-pinned dispatch).
 *   ADR-016 rename: legacy "targeted" → "unicast", "context_bound" →
 *   "multicast"; normalize-on-read so no GCS rewrite needed.
 * - `context` — null for non-multicast legacy threads.
 * - `idleExpiryMs` — null (deployment-wide default applies).
 * - Coerces legacy `proposer: ParticipantRole` entries on each staged
 *   action into the widened `{role, agentId: null}` shape (INV-TH22).
 *   agentId is null because pre-Phase-2 shapes never carried it.
 */
/** ADR-017 defensive normalization — legacy Agent blobs lacking the
 *  liveness-layer fields get sane defaults on read. Writes always
 *  populate these fields; the helper protects against persisted data
 *  predating the ADR-017 schema addition. */
function normalizeAgentShape(a: any): Agent {
  if (!a) return a;
  const now = a.lastSeenAt ?? a.firstSeenAt ?? new Date(0).toISOString();
  return {
    ...a,
    labels: a.labels ?? {},
    livenessState: (a.livenessState as Agent["livenessState"]) ?? (a.status === "online" ? "online" : "offline"),
    lastHeartbeatAt: a.lastHeartbeatAt ?? now,
    receiptSla: typeof a.receiptSla === "number" ? a.receiptSla : DEFAULT_AGENT_RECEIPT_SLA_MS,
    wakeEndpoint: typeof a.wakeEndpoint === "string" ? a.wakeEndpoint : null,
  } as Agent;
}

function normalizeThreadShape(t: any): Thread {
  const convergenceActions = Array.isArray(t.convergenceActions)
    ? t.convergenceActions.map((a: any) => normalizeStagedActionShape(a))
    : [];
  // Note: a `createdBy` migrate-on-read block lived here through task-305
  // (Mission-24 Phase A) to synthesize from the legacy `initiatedBy` +
  // participants[]. The prod backfill (scripts/backfill-created-by.ts
  // --apply) populated createdBy on every Thread on 2026-04-21 AEST and
  // the shim was removed after the architect-specified 48h soak. Readers
  // now see createdBy directly from persisted JSON.
  return {
    ...t,
    routingMode: normalizeRoutingMode(t.routingMode),
    context: isThreadContext(t.context) ? t.context : null,
    idleExpiryMs: typeof t.idleExpiryMs === "number" ? t.idleExpiryMs : null,
    convergenceActions,
    summary: typeof t.summary === "string" ? t.summary : "",
    participants: Array.isArray(t.participants) ? t.participants : [],
    recipientAgentId: typeof t.recipientAgentId === "string" ? t.recipientAgentId : null,
    currentTurnAgentId: typeof t.currentTurnAgentId === "string" ? t.currentTurnAgentId : null,
    messages: Array.isArray(t.messages) ? t.messages : [],
  } as Thread;
}

/** ADR-016 normalize-on-read: legacy ADR-014 routingMode names map
 *  to the IP-routing-terminology equivalents. Soft migration — no
 *  GCS rewrite, just translation at the boundary. */
function normalizeRoutingMode(v: unknown): "unicast" | "broadcast" | "multicast" {
  if (v === "unicast" || v === "broadcast" || v === "multicast") return v;
  if (v === "targeted") return "unicast";
  if (v === "context_bound") return "multicast";
  return "unicast"; // legacy threads without the field default to unicast
}

function isThreadContext(v: unknown): v is { entityType: string; entityId: string } {
  return typeof v === "object" && v !== null
    && typeof (v as any).entityType === "string"
    && typeof (v as any).entityId === "string";
}

/**
 * Mission-24 (INV-TH22) backfill: widen legacy `proposer: string` shape
 * into `{role, agentId: null}` on read. Already-widened entries pass
 * through untouched.
 */
function normalizeStagedActionShape(a: any): any {
  if (!a || typeof a !== "object") return a;
  if (typeof a.proposer === "string") {
    return { ...a, proposer: { role: a.proposer, agentId: null } };
  }
  return a;
}

// ── GCS Audit Store ──────────────────────────────────────────────────

export class GcsAuditStore implements IAuditStore {
  private bucket: string;

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

    await createOnly<AuditEntry>(this.bucket, `audit/${id}.json`, entry);
    console.log(`[GcsAuditStore] ${actor}/${action}: ${details.substring(0, 80)}`);
    return { ...entry };
  }

  async listEntries(limit = 50, actor?: AuditEntry["actor"]): Promise<AuditEntry[]> {
    const files = await listFiles(this.bucket, "audit/");
    const entries: AuditEntry[] = [];
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
    await createOnly<Notification>(this.bucket, `${GcsNotificationStore.V2_PREFIX}${id}.json`, notification);

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
