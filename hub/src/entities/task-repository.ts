/**
 * TaskRepository — StorageProvider-backed Task persistence.
 *
 * Mission-47 W5. Replaces `MemoryTaskStore` (state.ts) + `GcsTaskStore`
 * (gcs-state.ts). Implements `ITaskStore` unchanged — all policy callers
 * (task-policy, clarification-policy, review-policy, thread cascade
 * handlers) keep working against the same surface.
 *
 * Behavior preserved byte-for-byte:
 *   - FSM gates inside transforms throw `TransitionRejected`; caller
 *     maps to the boolean/null contract.
 *   - Report / review Markdown is written as a separate blob alongside
 *     the Task JSON, same as the legacy GCS layout (`reports/…md`,
 *     `reviews/…md`).
 *   - `getNextDirective` / `getNextReport` serialize via an in-process
 *     Mutex (`taskLock`) so two concurrent claim-poll cycles don't both
 *     walk the list before either one CAS's its claim — matches the
 *     historical `AsyncLock` behavior.
 *   - `taskClaimableBy` gate runs both at preview-time (cheap filter)
 *     and inside the transform (authoritative).
 *
 * Layout:
 *   tasks/<taskId>.json              — per-task blob
 *   reports/<taskId>-v<N>-report.md  — per-revision report
 *   reviews/<taskId>-v<N>-review.md  — per-revision review
 *   meta/counter.json                — shared counter (taskCounter field)
 */

import type { StorageProvider } from "@apnex/storage-provider";
import { hasGetWithToken, StoragePathNotFoundError } from "@apnex/storage-provider";

import type {
  ITaskStore,
  Task,
  TaskStatus,
  EntityProvenance,
} from "../state.js";
import { taskClaimableBy } from "../state.js";
import type { CascadeBacklink } from "./idea.js";
import { StorageBackedCounter } from "./counter.js";

const MAX_CAS_RETRIES = 50;

function taskPath(taskId: string): string {
  return `tasks/${taskId}.json`;
}

function encodeTask(t: Task): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(t, null, 2));
}

function decodeTask(bytes: Uint8Array): Task {
  return JSON.parse(new TextDecoder().decode(bytes)) as Task;
}

function encodeMarkdown(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * Sentinel thrown inside a `casUpdate` transform when a state-machine
 * gate fails (e.g., "not pending"). Semantics match the legacy
 * `TransitionRejected` in `gcs-state.ts`: not retried — the gate's
 * decision on fresh state is authoritative. Caller catches and maps to
 * its boolean/null contract.
 */
class TransitionRejected extends Error {
  constructor(reason: string) {
    super(`transition rejected: ${reason}`);
    this.name = "TransitionRejected";
  }
}

/** In-process Mutex for serializing claim-polls. */
class Mutex {
  private waiters: Array<() => void> = [];
  private held = false;
  async acquire(): Promise<void> {
    if (!this.held) {
      this.held = true;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.held = false;
  }
}

export class TaskRepository implements ITaskStore {
  private readonly taskLock = new Mutex();

  constructor(
    private readonly provider: StorageProvider,
    private readonly counter: StorageBackedCounter,
  ) {
    if (!hasGetWithToken(provider)) {
      throw new Error(
        "TaskRepository requires a StorageProvider with atomic read-with-token support",
      );
    }
  }

  async submitDirective(
    directive: string,
    correlationId?: string,
    idempotencyKey?: string,
    title?: string,
    description?: string,
    dependsOn?: string[],
    labels?: Record<string, string>,
    backlink?: CascadeBacklink,
    createdBy?: EntityProvenance,
  ): Promise<string> {
    const num = await this.counter.next("taskCounter");
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

    const result = await this.provider.createOnly(taskPath(id), encodeTask(task));
    if (!result.ok) {
      throw new Error(
        `[TaskRepository] submitDirective: counter issued existing ID ${id}; refusing to clobber`,
      );
    }
    console.log(
      `[TaskRepository] Directive submitted: ${id} (status: ${hasDeps ? "blocked" : "pending"}` +
        (backlink ? `, cascade from ${backlink.sourceThreadId}/${backlink.sourceActionId}` : "") +
        ")",
    );
    return id;
  }

  async findByCascadeKey(
    key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">,
  ): Promise<Task | null> {
    const keys = await this.provider.list("tasks/");
    for (const path of keys) {
      if (!path.endsWith(".json")) continue;
      const raw = await this.provider.get(path);
      if (!raw) continue;
      const task = decodeTask(raw);
      if (task.sourceThreadId === key.sourceThreadId && task.sourceActionId === key.sourceActionId) {
        return task;
      }
    }
    return null;
  }

  async findByIdempotencyKey(key: string): Promise<Task | null> {
    const keys = await this.provider.list("tasks/");
    for (const path of keys) {
      if (!path.endsWith(".json")) continue;
      const raw = await this.provider.get(path);
      if (!raw) continue;
      const task = decodeTask(raw);
      if (task.idempotencyKey === key) return task;
    }
    return null;
  }

  async unblockDependents(completedTaskId: string): Promise<string[]> {
    const keys = await this.provider.list("tasks/");
    const unblocked: string[] = [];

    // First pass: load all tasks for dependency snapshot.
    const allTasks = new Map<string, Task>();
    for (const path of keys) {
      if (!path.endsWith(".json")) continue;
      const raw = await this.provider.get(path);
      if (!raw) continue;
      const t = decodeTask(raw);
      allTasks.set(t.id, t);
    }

    for (const [, task] of allTasks) {
      if (task.status !== "blocked") continue;
      if (!task.dependsOn || !task.dependsOn.includes(completedTaskId)) continue;
      const allDepsCompletedSnapshot = task.dependsOn.every((depId) => {
        const dep = allTasks.get(depId);
        return dep && dep.status === "completed";
      });
      if (!allDepsCompletedSnapshot) continue;
      const ok = await this.tryCasUpdate(task.id, (current) => {
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
      if (ok) {
        unblocked.push(task.id);
        console.log(`[TaskRepository] Task unblocked: ${task.id}`);
      }
    }
    return unblocked;
  }

  async cancelDependents(failedTaskId: string): Promise<string[]> {
    const keys = await this.provider.list("tasks/");
    const cancelled: string[] = [];
    for (const path of keys) {
      if (!path.endsWith(".json")) continue;
      const raw = await this.provider.get(path);
      if (!raw) continue;
      const task = decodeTask(raw);
      if (task.status !== "blocked") continue;
      if (!task.dependsOn || !task.dependsOn.includes(failedTaskId)) continue;
      const ok = await this.tryCasUpdate(task.id, (current) => {
        if (current.status !== "blocked") throw new TransitionRejected("already transitioned");
        if (!current.dependsOn || !current.dependsOn.includes(failedTaskId)) {
          throw new TransitionRejected("dependency no longer relevant");
        }
        current.status = "cancelled";
        current.updatedAt = new Date().toISOString();
        return current;
      });
      if (ok) {
        cancelled.push(task.id);
        console.log(`[TaskRepository] Task cancelled (dependency failed): ${task.id}`);
      }
    }
    return cancelled;
  }

  async getNextDirective(
    claimant?: { agentId?: string; labels?: Record<string, string> },
  ): Promise<Task | null> {
    await this.taskLock.acquire();
    try {
      const keys = await this.provider.list("tasks/");
      for (const path of keys) {
        if (!path.endsWith(".json")) continue;
        const raw = await this.provider.get(path);
        if (!raw) continue;
        const preview = decodeTask(raw);
        if (preview.status !== "pending") continue;
        if (!taskClaimableBy(preview.labels ?? {}, claimant?.labels)) continue;
        let claimed: Task | null = null;
        const ok = await this.tryCasUpdate(preview.id, (current) => {
          if (current.status !== "pending") throw new TransitionRejected("already claimed");
          if (!taskClaimableBy(current.labels ?? {}, claimant?.labels)) {
            throw new TransitionRejected("labels diverged");
          }
          current.status = "working";
          current.assignedEngineerId = claimant?.agentId ?? null;
          current.updatedAt = new Date().toISOString();
          claimed = { ...current };
          return current;
        });
        if (ok && claimed) {
          console.log(
            `[TaskRepository] Directive assigned: ${(claimed as Task).id}` +
              ((claimed as Task).assignedEngineerId ? ` → ${(claimed as Task).assignedEngineerId}` : ""),
          );
          return claimed;
        }
      }
      return null;
    } finally {
      this.taskLock.release();
    }
  }

  async submitReport(
    taskId: string,
    report: string,
    summary: string,
    _success: boolean,
    verification?: string,
  ): Promise<boolean> {
    let finalTask: Task | null = null;
    const ok = await this.tryCasUpdate(taskId, (current) => {
      const version = (current.revisionCount || 0) + 1;
      const reportRef = `reports/${taskId}-v${version}-report.md`;
      current.report = report;
      current.reportSummary = summary;
      current.reportRef = reportRef;
      current.verification = verification || null;
      current.status = "in_review";
      current.updatedAt = new Date().toISOString();
      finalTask = { ...current };
      return current;
    });
    if (!ok || !finalTask) {
      console.log(`[TaskRepository] Report failed: task ${taskId} not found`);
      return false;
    }

    // Write report as separate Markdown blob — exact parity with legacy.
    const t = finalTask as Task;
    const reportContent = [
      `# Engineering Report: ${taskId}`,
      "",
      `**Status:** ${t.status}`,
      `**Directive:** ${t.directive}`,
      `**Summary:** ${summary}`,
      verification ? `**Verification:** ${verification}` : null,
      `**Completed:** ${t.updatedAt}`,
      "",
      "---",
      "",
      report,
    ].filter(Boolean).join("\n");
    await this.provider.put(t.reportRef!, encodeMarkdown(reportContent));

    console.log(`[TaskRepository] Report submitted for: ${taskId} (${t.status})`);
    return true;
  }

  async getNextReport(): Promise<Task | null> {
    await this.taskLock.acquire();
    try {
      const keys = await this.provider.list("tasks/");
      for (const path of keys) {
        if (!path.endsWith(".json")) continue;
        const raw = await this.provider.get(path);
        if (!raw) continue;
        const preview = decodeTask(raw);
        if (
          !(preview.status === "completed" || preview.status === "failed") ||
          preview.report === null
        )
          continue;
        let preTransition: Task | null = null;
        const ok = await this.tryCasUpdate(preview.id, (current) => {
          if (!(current.status === "completed" || current.status === "failed")) {
            throw new TransitionRejected("already reported or status flipped");
          }
          if (current.report === null) throw new TransitionRejected("report cleared");
          preTransition = { ...current };
          current.status = ("reported_" + current.status) as TaskStatus;
          current.updatedAt = new Date().toISOString();
          return current;
        });
        if (ok && preTransition) {
          console.log(`[TaskRepository] Report retrieved: ${(preTransition as Task).id}`);
          return preTransition;
        }
      }
      return null;
    } finally {
      this.taskLock.release();
    }
  }

  async getTask(taskId: string): Promise<Task | null> {
    const raw = await this.provider.get(taskPath(taskId));
    return raw ? decodeTask(raw) : null;
  }

  async listTasks(): Promise<Task[]> {
    const keys = await this.provider.list("tasks/");
    const tasks: Task[] = [];
    for (const path of keys) {
      if (!path.endsWith(".json")) continue;
      const raw = await this.provider.get(path);
      if (!raw) continue;
      tasks.push(decodeTask(raw));
    }
    return tasks;
  }

  async cancelTask(taskId: string): Promise<boolean> {
    let priorStatus: Task["status"] | null = null;
    const ok = await this.tryCasUpdate(taskId, (current) => {
      const CANCELLABLE: Task["status"][] = ["pending", "working", "blocked", "input_required"];
      if (!CANCELLABLE.includes(current.status)) {
        throw new TransitionRejected(`not cancellable from status ${current.status}`);
      }
      priorStatus = current.status;
      current.status = "cancelled";
      current.updatedAt = new Date().toISOString();
      return current;
    });
    if (ok) {
      console.log(`[TaskRepository] Task cancelled: ${taskId} (was: ${priorStatus})`);
    }
    return ok;
  }

  async requestClarification(taskId: string, question: string): Promise<boolean> {
    const ok = await this.tryCasUpdate(taskId, (current) => {
      if (current.status !== "working") throw new TransitionRejected("not working");
      current.status = "input_required";
      current.clarificationQuestion = question;
      current.updatedAt = new Date().toISOString();
      return current;
    });
    if (ok) console.log(`[TaskRepository] Clarification requested for: ${taskId}`);
    return ok;
  }

  async respondToClarification(taskId: string, answer: string): Promise<boolean> {
    const ok = await this.tryCasUpdate(taskId, (current) => {
      if (current.status !== "input_required") throw new TransitionRejected("not input_required");
      current.status = "working";
      current.clarificationAnswer = answer;
      current.updatedAt = new Date().toISOString();
      return current;
    });
    if (ok) console.log(`[TaskRepository] Clarification answered for: ${taskId}`);
    return ok;
  }

  async submitReview(
    taskId: string,
    assessment: string,
    decision?: "approved" | "rejected",
  ): Promise<boolean> {
    let finalTask: Task | null = null;
    let reviewVersion = 0;
    const ok = await this.tryCasUpdate(taskId, (current) => {
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
      finalTask = { ...current };
      return current;
    });
    if (!ok || !finalTask) return false;

    const t = finalTask as Task;
    const reviewContent = [
      `# Architect Review: ${taskId} (v${reviewVersion})`,
      "",
      `**Task:** ${t.directive}`,
      `**Decision:** ${decision || "none"}`,
      `**Reviewed:** ${t.updatedAt}`,
      "",
      "---",
      "",
      assessment,
    ].join("\n");
    await this.provider.put(t.reviewRef!, encodeMarkdown(reviewContent));

    console.log(
      `[TaskRepository] Review submitted for: ${taskId} (v${reviewVersion}, decision: ${decision || "none"})`,
    );
    return true;
  }

  async getReview(
    taskId: string,
  ): Promise<{ taskId: string; assessment: string; reviewRef: string } | null> {
    const raw = await this.provider.get(taskPath(taskId));
    if (!raw) return null;
    const task = decodeTask(raw);
    if (!task.reviewAssessment) return null;
    return {
      taskId: task.id,
      assessment: task.reviewAssessment,
      reviewRef: task.reviewRef || `reviews/${taskId}-v1-review.md`,
    };
  }

  /**
   * Test-only escape hatch: directly patch a task's on-disk state,
   * bypassing FSM gates. Tests use this to set up scenarios that
   * can't be reached through the public API (e.g., directly setting
   * `status: "failed"` or `revisionCount: 3`). Previously done by
   * poking `(store as any).tasks.get(id).field = value` against the
   * legacy MemoryTaskStore's private Map — that Map no longer exists
   * post-W5, so this helper replaces the pattern. Not wired into the
   * IStore interface on purpose; tests cast to `TaskRepository`.
   */
  async __debugSetTask(taskId: string, patch: Partial<Task>): Promise<void> {
    const path = taskPath(taskId);
    const raw = await this.provider.get(path);
    if (!raw) throw new Error(`[TaskRepository.__debugSetTask] Task not found: ${taskId}`);
    const current = decodeTask(raw);
    const next: Task = { ...current, ...patch } as Task;
    await this.provider.put(path, encodeTask(next));
  }

  // ── Internal ─────────────────────────────────────────────────────

  /**
   * CAS-update a task. Returns true on successful write, false when the
   * task is missing OR the transform throws TransitionRejected. Other
   * errors propagate. Matches the legacy `updateExisting` + catch-
   * TransitionRejected-map-to-false idiom used by every GcsTaskStore
   * mutator.
   */
  private async tryCasUpdate(
    taskId: string,
    transform: (current: Task) => Task,
  ): Promise<boolean> {
    const path = taskPath(taskId);
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const read = await (this.provider as unknown as {
        getWithToken(path: string): Promise<{ data: Uint8Array; token: string } | null>;
      }).getWithToken(path);
      if (read === null) return false;
      let next: Task;
      try {
        next = transform(decodeTask(read.data));
      } catch (err) {
        if (err instanceof TransitionRejected) return false;
        throw err;
      }
      try {
        const result = await this.provider.putIfMatch(path, encodeTask(next), read.token);
        if (result.ok) return true;
        // Token stale — retry with fresh read.
      } catch (err) {
        if (err instanceof StoragePathNotFoundError) return false;
        throw err;
      }
    }
    throw new Error(
      `[TaskRepository] tryCasUpdate exhausted ${MAX_CAS_RETRIES} retries on ${taskId}`,
    );
  }
}
