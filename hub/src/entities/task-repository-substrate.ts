/**
 * mission-83 W4.x.8 — TaskRepositorySubstrate
 *
 * Substrate-API version of TaskRepository (mission-47 W5 origin). Per Design v1.3
 * §5.1 Option Y disposition (B) sibling-pattern. Implements ITaskStore interface
 * UNCHANGED (handler call-sites unchanged).
 *
 * Report/review MD body-storage carve-out (same pattern as ProposalRepository
 * W4.x.7): legacy TaskRepository writes report MD to reports/<id>-vN-report.md
 * + review MD to reviews/<id>-vN-review.md (consumed by document-policy read-tool
 * via reportRef/reviewRef). Substrate-API is kind+id+JSON (no blob primitive);
 * MD body writes DROPPED in substrate-version. reportRef/reviewRef fields
 * preserved as vestigial. Body-storage resolution deferred to W5 cutover OR
 * substrate-API extension.
 *
 * Per-entity logic preserved:
 *   - In-process taskLock Mutex for claim-poll serialization (getNextDirective +
 *     getNextReport prevent concurrent walk-then-CAS races within a single Hub
 *     process)
 *   - ID allocation via SubstrateCounter.next("taskCounter") ("task-N" shape)
 *   - submitDirective → substrate.createOnly + initial status="blocked" if deps
 *   - All CAS transitions use Design v1.4 getWithRevision + putIfMatch
 *   - TransitionRejected sentinel for FSM-gate failures
 *   - unblockDependents/cancelDependents — bulk dependency-graph walk + per-task CAS
 *   - taskClaimableBy gate (preview + authoritative inside transform)
 *   - __debugSetTask escape hatch via substrate.put bypass
 *
 * W4.x.8 — ninth-slice of W4.x sweep after W4.x.7 ProposalRepositorySubstrate.
 */

import type { HubStorageSubstrate } from "../storage-substrate/index.js";
import type {
  ITaskStore,
  Task,
  TaskStatus,
  EntityProvenance,
} from "../state.js";
import { taskClaimableBy } from "../state.js";
import type { CascadeBacklink } from "./idea.js";
import { SubstrateCounter } from "./substrate-counter.js";

const KIND = "Task";
const MAX_CAS_RETRIES = 50;
const LIST_PREFETCH_CAP = 500;

class TransitionRejected extends Error {
  constructor(reason: string) {
    super(`transition rejected: ${reason}`);
    this.name = "TransitionRejected";
  }
}

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

export class TaskRepositorySubstrate implements ITaskStore {
  private readonly taskLock = new Mutex();

  constructor(
    private readonly substrate: HubStorageSubstrate,
    private readonly counter: SubstrateCounter,
  ) {}

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

    const result = await this.substrate.createOnly(KIND, task);
    if (!result.ok) {
      throw new Error(
        `[TaskRepositorySubstrate] submitDirective: counter issued existing ID ${id}; refusing to clobber`,
      );
    }
    console.log(
      `[TaskRepositorySubstrate] Directive submitted: ${id} (status: ${hasDeps ? "blocked" : "pending"}` +
        (backlink ? `, cascade from ${backlink.sourceThreadId}/${backlink.sourceActionId}` : "") +
        ")",
    );
    return id;
  }

  async findByCascadeKey(
    key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">,
  ): Promise<Task | null> {
    const { items } = await this.substrate.list<Task>(KIND, {
      filter: {
        sourceThreadId: key.sourceThreadId,
        sourceActionId: key.sourceActionId,
      },
      limit: 1,
    });
    return items[0] ?? null;
  }

  async findByIdempotencyKey(key: string): Promise<Task | null> {
    const { items } = await this.substrate.list<Task>(KIND, {
      filter: { idempotencyKey: key },
      limit: 1,
    });
    return items[0] ?? null;
  }

  async unblockDependents(completedTaskId: string): Promise<string[]> {
    // Load full snapshot for dependency-graph eval
    const { items: allTasks } = await this.substrate.list<Task>(KIND, {
      limit: LIST_PREFETCH_CAP,
    });
    const allMap = new Map(allTasks.map((t) => [t.id, t]));
    const unblocked: string[] = [];

    for (const task of allTasks) {
      if (task.status !== "blocked") continue;
      if (!task.dependsOn || !task.dependsOn.includes(completedTaskId)) continue;
      const allDepsCompletedSnapshot = task.dependsOn.every((depId) => {
        const dep = allMap.get(depId);
        return dep && dep.status === "completed";
      });
      if (!allDepsCompletedSnapshot) continue;
      const ok = await this.tryCasUpdate(task.id, (current) => {
        if (current.status !== "blocked") throw new TransitionRejected("already transitioned");
        if (!current.dependsOn || !current.dependsOn.includes(completedTaskId)) {
          throw new TransitionRejected("dependency no longer relevant");
        }
        const stillAllDone = current.dependsOn.every((depId) => {
          const dep = allMap.get(depId);
          return dep && dep.status === "completed";
        });
        if (!stillAllDone) throw new TransitionRejected("deps not all completed");
        current.status = "pending";
        current.updatedAt = new Date().toISOString();
        return current;
      });
      if (ok) {
        unblocked.push(task.id);
        console.log(`[TaskRepositorySubstrate] Task unblocked: ${task.id}`);
      }
    }
    return unblocked;
  }

  async cancelDependents(failedTaskId: string): Promise<string[]> {
    const { items } = await this.substrate.list<Task>(KIND, {
      filter: { status: "blocked" },
      limit: LIST_PREFETCH_CAP,
    });
    const cancelled: string[] = [];
    for (const task of items) {
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
        console.log(`[TaskRepositorySubstrate] Task cancelled (dependency failed): ${task.id}`);
      }
    }
    return cancelled;
  }

  async getNextDirective(
    claimant?: { agentId?: string; labels?: Record<string, string> },
  ): Promise<Task | null> {
    await this.taskLock.acquire();
    try {
      // Substrate-side filter on task_status_idx (hot-path)
      const { items } = await this.substrate.list<Task>(KIND, {
        filter: { status: "pending" },
        limit: LIST_PREFETCH_CAP,
      });
      for (const preview of items) {
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
            `[TaskRepositorySubstrate] Directive assigned: ${(claimed as Task).id}` +
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
      console.log(`[TaskRepositorySubstrate] Report failed: task ${taskId} not found`);
      return false;
    }

    // Report MD body write DROPPED — substrate-API has no blob primitive.
    // reportRef vestigial; document-policy read-path requires W5 cutover-side
    // update OR substrate-API extension.
    void report;
    void summary;
    void verification;

    console.log(`[TaskRepositorySubstrate] Report submitted for: ${taskId} (${(finalTask as Task).status})`);
    return true;
  }

  async getNextReport(): Promise<Task | null> {
    await this.taskLock.acquire();
    try {
      // Filter on status in (completed, failed) via 2 calls (substrate FilterValue
      // doesn't directly support multi-value $in; use status_idx for each)
      const completed = await this.substrate.list<Task>(KIND, {
        filter: { status: "completed" },
        limit: LIST_PREFETCH_CAP,
      });
      const failed = await this.substrate.list<Task>(KIND, {
        filter: { status: "failed" },
        limit: LIST_PREFETCH_CAP,
      });
      const candidates = [...completed.items, ...failed.items].filter((t) => t.report !== null);

      for (const preview of candidates) {
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
          console.log(`[TaskRepositorySubstrate] Report retrieved: ${(preTransition as Task).id}`);
          return preTransition;
        }
      }
      return null;
    } finally {
      this.taskLock.release();
    }
  }

  async getTask(taskId: string): Promise<Task | null> {
    return this.substrate.get<Task>(KIND, taskId);
  }

  async listTasks(): Promise<Task[]> {
    const { items } = await this.substrate.list<Task>(KIND, { limit: LIST_PREFETCH_CAP });
    return items;
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
      console.log(`[TaskRepositorySubstrate] Task cancelled: ${taskId} (was: ${priorStatus})`);
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
    if (ok) console.log(`[TaskRepositorySubstrate] Clarification requested for: ${taskId}`);
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
    if (ok) console.log(`[TaskRepositorySubstrate] Clarification answered for: ${taskId}`);
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

    // Review MD body write DROPPED — same carve-out as submitReport
    void assessment;

    console.log(
      `[TaskRepositorySubstrate] Review submitted for: ${taskId} (v${reviewVersion}, decision: ${decision || "none"})`,
    );
    return true;
  }

  async getReview(
    taskId: string,
  ): Promise<{ taskId: string; assessment: string; reviewRef: string } | null> {
    const task = await this.substrate.get<Task>(KIND, taskId);
    if (!task) return null;
    if (!task.reviewAssessment) return null;
    return {
      taskId: task.id,
      assessment: task.reviewAssessment,
      reviewRef: task.reviewRef || `reviews/${taskId}-v1-review.md`,
    };
  }

  /**
   * Test-only escape hatch: directly patch a task's on-disk state, bypassing
   * FSM gates. substrate.put bypass (no CAS).
   */
  async __debugSetTask(taskId: string, patch: Partial<Task>): Promise<void> {
    const current = await this.substrate.get<Task>(KIND, taskId);
    if (!current) throw new Error(`[TaskRepositorySubstrate.__debugSetTask] Task not found: ${taskId}`);
    const next: Task = { ...current, ...patch } as Task;
    await this.substrate.put(KIND, next);
  }

  // ── Internal ─────────────────────────────────────────────────────

  /**
   * CAS-update via Design v1.4 getWithRevision + putIfMatch. Returns false on
   * absent OR TransitionRejected. Matches legacy boolean-return contract.
   */
  private async tryCasUpdate(
    taskId: string,
    transform: (current: Task) => Task,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<Task>(KIND, taskId);
      if (!existing) return false;
      let next: Task;
      try {
        next = transform({ ...existing.entity });
      } catch (err) {
        if (err instanceof TransitionRejected) return false;
        throw err;
      }
      const result = await this.substrate.putIfMatch(KIND, next, existing.resourceVersion);
      if (result.ok) return true;
      // revision-mismatch → retry from re-read
    }
    throw new Error(
      `[TaskRepositorySubstrate] tryCasUpdate exhausted ${MAX_CAS_RETRIES} retries on ${taskId}`,
    );
  }
}
