/**
 * Task Policy — Pure domain logic for task lifecycle management.
 *
 * Extracted from src/tools/task-tools.ts into transport-agnostic handlers.
 * Each handler receives (args, ctx) and returns a PolicyResult.
 *
 * Internal events are pushed onto ctx.internalEvents for the router
 * to drain after the primary handler completes.
 */

import { z } from "zod";
import type { PolicyRouter } from "./router.js";
import type { IPolicyContext, PolicyResult, FsmTransitionTable, DomainEvent } from "./types.js";
import { isValidTransition } from "./types.js";
import { callerLabels } from "./labels.js";
import { resolveCreatedBy } from "./caller-identity.js";
import {
  LIST_PAGINATION_SCHEMA,
  LIST_LABELS_SCHEMA,
  applyLabelFilter,
  paginate,
  buildQueryFilterSchema,
  buildQuerySortSchema,
  applyQueryFilter,
  applyQuerySort,
  type QueryableFieldSpec,
  type FieldAccessors,
} from "./list-filters.js";
import type { Task } from "../state.js";
import { dispatchTaskSpawned } from "./dispatch-helpers.js";
import { findNextUnissuedPlannedTask } from "../entities/mission.js";
import { emitDirectorNotification } from "./director-notification-helpers.js";

// ── Task FSM ────────────────────────────────────────────────────────

export const TASK_FSM: FsmTransitionTable = [
  { from: "pending", to: "working" },
  { from: "pending", to: "cancelled" },
  { from: "pending", to: "blocked" },
  { from: "working", to: "in_review" },
  { from: "working", to: "input_required" },
  { from: "working", to: "cancelled" },
  { from: "blocked", to: "pending" },
  { from: "blocked", to: "cancelled" },
  { from: "input_required", to: "working" },
  { from: "in_review", to: "completed" },
  { from: "in_review", to: "working" },
  { from: "in_review", to: "escalated" },
];

// ── Handlers ────────────────────────────────────────────────────────

async function createTask(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const title = args.title as string;
  const description = args.description as string;
  const correlationId = args.correlationId as string | undefined;
  const sourceThreadId = args.sourceThreadId as string | undefined;
  const idempotencyKey = args.idempotencyKey as string | undefined;
  const dependsOn = args.dependsOn as string[] | undefined;

  // Idempotency check — if key provided and already exists, reject as duplicate
  if (idempotencyKey) {
    const existing = await ctx.stores.task.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ error: "duplicate", existingTaskId: existing.id, existingStatus: existing.status }),
        }],
        isError: true,
      };
    }
  }

  if (!title || !description) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ success: false, error: "'title' and 'description' are required" }),
      }],
      isError: true,
    };
  }

  const resolvedDirective = description;

  // Validate dependsOn — ensure all referenced tasks exist
  if (dependsOn && dependsOn.length > 0) {
    for (const depId of dependsOn) {
      const depTask = await ctx.stores.task.getTask(depId);
      if (!depTask) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ success: false, error: `Dependency task ${depId} not found` }),
          }],
          isError: true,
        };
      }
    }
  }

  // Mission-19: propagate caller's Agent labels onto the new Task.
  const labels = await callerLabels(ctx);
  const createdBy = await resolveCreatedBy(ctx);
  const taskId = await ctx.stores.task.submitDirective(resolvedDirective, correlationId, idempotencyKey, title, description, dependsOn, labels, undefined, createdBy);

  // Atomically close the source thread if provided
  if (sourceThreadId) {
    try {
      await ctx.stores.thread.closeThread(sourceThreadId);
      console.log(`[TaskPolicy] Thread ${sourceThreadId} auto-closed by directive ${taskId}`);
    } catch (err) {
      console.log(`[TaskPolicy] Failed to auto-close thread ${sourceThreadId}: ${err}`);
      // Non-fatal — the directive was still created
    }
  }

  // Mission linkage is a virtual view over the task store (see mission.ts).
  // `correlationId` on the task is the single source of truth — no explicit
  // link step is needed.

  // Determine the resulting status
  const hasDeps = dependsOn && dependsOn.length > 0;
  const resultStatus = hasDeps ? "blocked" : "pending";

  // Fan-out routing event. Uses the shared helper so the cascade-
  // path (cascade-actions/create-task.ts) fires identically-shaped
  // events without drift — see policy/dispatch-helpers.ts.
  const spawnedTask = await ctx.stores.task.getTask(taskId);
  if (spawnedTask) {
    await dispatchTaskSpawned(ctx, spawnedTask, labels, sourceThreadId);
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ taskId, status: resultStatus, sourceThreadClosed: !!sourceThreadId }),
      },
    ],
  };
}

async function getTask(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const sid = ctx.sessionId;

  // Auto-register as engineer if not already registered
  if (ctx.stores.engineerRegistry.getRole(sid) === "unknown") {
    ctx.stores.engineerRegistry.setSessionRole(sid, "engineer");
  }

  // Mission-19 t4/t5: label-aware claim. Only pull tasks whose labels are
  // a subset of the caller's Agent.labels; persist assignedEngineerId for
  // P2P routing of subsequent events (review, clarification, revision).
  const claimant = await ctx.stores.engineerRegistry.getAgentForSession(sid);
  const task = await ctx.stores.task.getNextDirective(
    claimant ? { agentId: claimant.agentId, labels: claimant.labels ?? {} } : undefined,
  );
  if (!task) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ task: null, message: "No pending directives" }),
        },
      ],
    };
  }

  // Fire notification to notify Architect that work has started (routed by task labels)
  await ctx.dispatch("directive_acknowledged", {
    taskId: task.id,
    agentId: task.assignedEngineerId || claimant?.agentId || "unknown",
    directive: task.description?.substring(0, 100) || task.title || "",
  }, { roles: ["architect"], matchLabels: task.labels });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          taskId: task.id,
          title: task.title,
          description: task.description,
          correlationId: task.correlationId,
          status: task.status,
        }),
      },
    ],
  };
}

async function createReport(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const taskId = args.taskId as string;
  const report = args.report as string;
  const summary = args.summary as string;
  const verification = args.verification as string | undefined;

  // FSM guard: only working tasks can receive reports
  const task = await ctx.stores.task.getTask(taskId);
  if (!task) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: `Task ${taskId} not found` }) }],
      isError: true,
    };
  }
  if (!isValidTransition(TASK_FSM, task.status, "in_review")) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: `Invalid state transition: cannot report on task in '${task.status}' state (must be 'working')` }) }],
      isError: true,
    };
  }

  const success = await ctx.stores.task.submitReport(taskId, report, summary, true, verification);

  if (!success) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            error: `Task ${taskId} not found`,
          }),
        },
      ],
      isError: true,
    };
  }

  // Versioned report ref
  const version = (task.revisionCount || 0) + 1;
  const reportRef = `reports/${taskId}-v${version}-report.md`;

  // Notify Architect(s) in task's label scope — report is now awaiting review.
  await ctx.dispatch("report_submitted", {
    taskId,
    summary,
    reportRef,
  }, { roles: ["architect"], matchLabels: task.labels });

  // NO cascade here — DAG unblocking moves to create_review(approved) in ReviewPolicy

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ success: true, taskId, status: "in_review", reportRef }),
      },
    ],
  };
}

async function getReport(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const task = await ctx.stores.task.getNextReport();
  if (!task) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ task: null, message: "No completed reports" }),
        },
      ],
    };
  }
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          taskId: task.id,
          directive: task.directive,
          summary: task.reportSummary,
          reportRef: task.reportRef,
          status: task.status,
        }),
      },
    ],
  };
}

// ── M-QueryShape Phase 1 (idea-119, task-302) ─────────────────────────
// Task-entity field descriptors + value accessors for the shared
// filter/sort primitives in list-filters.ts. Phase 1 scope:
// status + correlationId + assignedEngineerId + createdAt + updatedAt.
// Phase C (task-306): createdBy.role + createdBy.agentId + createdBy.id
// nested-path support. `createdBy.id` is computed in the accessor as
// `${role}:${agentId}` — virtual field, not persisted on write
// (architect-ratified clarification on task-306 directive).
//
// Sortable fields intentionally broader than filterable — sorting on
// a field is always safe (no query-cost bound implications), filtering
// on a field requires thinking about operator allowlists + value types.

const TASK_FILTERABLE_FIELDS: QueryableFieldSpec = {
  status: { type: "enum", values: ["pending", "working", "blocked", "input_required", "in_review", "completed", "failed", "cancelled", "escalated", "read_completed", "reported_completed"] },
  correlationId: { type: "string" },
  assignedEngineerId: { type: "string" },
  createdAt: { type: "date" },
  updatedAt: { type: "date" },
  "createdBy.role": { type: "string" },
  "createdBy.agentId": { type: "string" },
  "createdBy.id": { type: "string" },
};

const TASK_SORTABLE_FIELDS = [
  "id",
  "status",
  "createdAt",
  "updatedAt",
  "correlationId",
  "assignedEngineerId",
  "createdBy.role",
  "createdBy.agentId",
  "createdBy.id",
] as const;

const TASK_ACCESSORS: FieldAccessors<Task> = {
  id: (t) => t.id,
  status: (t) => t.status,
  correlationId: (t) => t.correlationId,
  assignedEngineerId: (t) => t.assignedEngineerId,
  createdAt: (t) => t.createdAt,
  updatedAt: (t) => t.updatedAt,
  "createdBy.role": (t) => t.createdBy?.role ?? null,
  "createdBy.agentId": (t) => t.createdBy?.agentId ?? null,
  "createdBy.id": (t) => (t.createdBy ? `${t.createdBy.role}:${t.createdBy.agentId}` : null),
};

const TASK_FILTER_SCHEMA = buildQueryFilterSchema(TASK_FILTERABLE_FIELDS);
const TASK_SORT_SCHEMA = buildQuerySortSchema(TASK_SORTABLE_FIELDS);

async function listTasks(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  let tasks = await ctx.stores.task.listTasks();
  const totalPreFilter = tasks.length;

  // Legacy label filter (pre-QueryShape; preserved).
  tasks = applyLabelFilter(tasks, args.labels as Record<string, string> | undefined);

  // Backwards-compat: legacy scalar `status` arg subsumed by the new
  // `filter.status` field. filter.status wins when both are present.
  // Legacy arg deprecated in tool description; removal in Phase 3.
  const legacyStatus = typeof args.status === "string" ? args.status : undefined;
  const filterArgRaw = args.filter as Record<string, unknown> | undefined;
  const effectiveFilter: Record<string, unknown> = { ...(filterArgRaw ?? {}) };
  if (legacyStatus && effectiveFilter.status === undefined) {
    effectiveFilter.status = legacyStatus;
  }
  const hasFilter = Object.keys(effectiveFilter).length > 0;

  if (hasFilter) {
    tasks = applyQueryFilter(tasks, effectiveFilter, TASK_ACCESSORS);
  }

  const sortArg = args.sort as ReadonlyArray<{ field: string; order: "asc" | "desc" }> | undefined;
  tasks = applyQuerySort(tasks, sortArg, TASK_ACCESSORS);

  const postFilterCount = tasks.length;
  const page = paginate(tasks, args);

  // Empty-result sentinel: filter was applied AND yielded zero matches
  // AND the underlying collection (pre-filter) was non-empty. Signals
  // to the LLM "your filter was valid, nothing matched" — distinct from
  // "tool broke". Prevents the Gemini-retry-on-empty pattern observed
  // in Phase 2b.
  const queryUnmatched = hasFilter && postFilterCount === 0 && totalPreFilter > 0;

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          tasks: page.items,
          count: page.count,
          total: page.total,
          offset: page.offset,
          limit: page.limit,
          ...(queryUnmatched ? { _ois_query_unmatched: true } : {}),
        }, null, 2),
      },
    ],
  };
}

async function cancelTask(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const taskId = args.taskId as string;
  const success = await ctx.stores.task.cancelTask(taskId);

  if (!success) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            error: `Task ${taskId} not found or not in pending status`,
          }),
        },
      ],
      isError: true,
    };
  }

  // Push task_cancelled internal event for cascade processing
  ctx.internalEvents.push({
    type: "task_cancelled",
    payload: { taskId },
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ success: true, taskId, status: "cancelled" }),
      },
    ],
  };
}

// ── Internal Event Handlers ─────────────────────────────────────────

async function handleTaskCompleted(event: DomainEvent, ctx: IPolicyContext): Promise<void> {
  const taskId = event.payload.taskId as string;
  const unblockedIds = await ctx.stores.task.unblockDependents(taskId);
  for (const unblockedId of unblockedIds) {
    const unblocked = await ctx.stores.task.getTask(unblockedId);
    await ctx.dispatch("task_issued", {
      taskId: unblockedId,
      directive: `Unblocked by completion of ${taskId}`,
      correlationId: null,
    }, { roles: ["engineer"], matchLabels: unblocked?.labels });
  }

  // task-316 / idea-144 Path A — Mission advancement cascade.
  // When a mission-linked task completes (architect approved its
  // review), auto-advance to the next unissued plannedTask on the
  // parent mission. Eliminates the 5-nudge pattern observed in
  // mission-38 (quantified cost: ~15 engineer tool-calls per mission).
  // Cascade shape ratified on thread-241 (4-cell matrix) + thread-242
  // (revision-loop FSMs). This path is the approved+mission-linked
  // cell; the other 3 cells are handled by existing review-policy.ts
  // dispatches (review_completed / revision_required).
  //
  // Robustness: wrapped in try/catch per tele-4 criterion #5. On any
  // failure, emit cascade_failed + Director notification so the
  // frictionless collaboration substrate never degrades silently.
  try {
    const completedTask = await ctx.stores.task.getTask(taskId);
    if (completedTask?.correlationId) {
      const mission = await ctx.stores.mission.getMission(completedTask.correlationId);
      if (mission && mission.plannedTasks && mission.plannedTasks.length > 0) {
        // Mark the just-approved plannedTask completed (keyed on the
        // task id the architect just reviewed). No-op if this task
        // wasn't a plannedTask-spawned Task (e.g. standalone dependsOn
        // chain that happens to be correlationId'd to the mission).
        await ctx.stores.mission.markPlannedTaskCompleted(mission.id, taskId);

        // Find the next unissued plannedTask; if present, spawn it
        // and transition the mission forward.
        const refreshed = await ctx.stores.mission.getMission(mission.id);
        const nextPlan = findNextUnissuedPlannedTask(refreshed?.plannedTasks);

        if (nextPlan) {
          // Spawn the next Task. correlationId = mission.id propagates
          // the lineage; createdBy is attributed to hub (cascade-
          // originated, not caller-originated).
          const spawnLabels = completedTask.labels ?? {};
          const spawnedId = await ctx.stores.task.submitDirective(
            nextPlan.description,
            mission.id, // correlationId = mission's id → Mission.tasks virtual view includes it
            undefined, // no idempotencyKey on cascade-spawned tasks; natural-key dedupe not required (plan is append-only per v1)
            nextPlan.title,
            nextPlan.description,
            undefined, // no dependsOn in v1; sequencing through plannedTasks is linear
            spawnLabels,
            undefined, // no cascade-backlink (this isn't thread-spawned)
            { role: "hub", agentId: "mission-advancement-cascade" },
          );

          // Record the issuance on the plannedTask slot.
          await ctx.stores.mission.markPlannedTaskIssued(mission.id, nextPlan.sequence, spawnedId);

          // Audit the cascade for forensic lineage.
          await ctx.stores.audit.logEntry(
            "hub",
            "mission_advancement_cascade",
            `Mission ${mission.id} advanced on review approval of task ${taskId}: issued plannedTask[seq=${nextPlan.sequence}] as ${spawnedId} (title="${nextPlan.title.substring(0, 60)}")`,
            mission.id,
          );

          // Dispatch task_issued so the engineer sees the new directive
          // via their standard drain_pending_actions path (same as
          // architect-direct create_task). Reuses the helper for parity.
          const spawnedTask = await ctx.stores.task.getTask(spawnedId);
          if (spawnedTask) {
            await dispatchTaskSpawned(ctx, spawnedTask, spawnLabels);
          }
        }
        // If no nextPlan, mission is finished by plan — caller can
        // follow up with update_mission_status to flip active → completed
        // if desired. Not auto-firing the status change in v1 because
        // "all plannedTasks done" doesn't universally mean the mission
        // is complete (out-of-plan work may remain via direct create_task).
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[TaskPolicy] Mission-advancement cascade failed for task ${taskId}: ${msg}`);
    // cascade_failed audit + Director notification — tele-4 criterion
    // #5 (no silent failures). Never throws; cascade-advancement is
    // best-effort decoration on the primary review approval.
    try {
      await ctx.stores.audit.logEntry(
        "hub",
        "cascade_failed",
        `Mission-advancement cascade failed on approval of task ${taskId}: ${msg}`,
        taskId,
      );
      await emitDirectorNotification(ctx.stores.message, {
        severity: "warning",
        source: "cascade_failed",
        sourceRef: taskId,
        title: `Mission-advancement cascade failed on task ${taskId}`,
        details: `The review approval of ${taskId} completed, but the follow-on Mission-advancement cascade (task-316 / idea-144 Path A) threw an error: ${msg}. The task is still marked completed; no next plannedTask was issued. Investigate the mission entity + plannedTasks shape.`,
      });
    } catch (innerErr) {
      // If audit/notification also fail, swallow — at this point the
      // original review succeeded and we don't want to crash the
      // internal-event runner. Re-thrown via the console.error above.
      console.error(`[TaskPolicy] Cascade-failure bookkeeping also errored: ${innerErr}`);
    }
  }
}

async function handleTaskCancelled(event: DomainEvent, ctx: IPolicyContext): Promise<void> {
  const taskId = event.payload.taskId as string;
  const cancelledIds = await ctx.stores.task.cancelDependents(taskId);
  for (const cancelledId of cancelledIds) {
    const cancelled = await ctx.stores.task.getTask(cancelledId);
    await ctx.dispatch("task_cancelled", {
      taskId: cancelledId,
      reason: `Dependency ${taskId} was cancelled`,
    }, { roles: ["architect"], matchLabels: cancelled?.labels });
  }
}

// ── Registration ────────────────────────────────────────────────────

export function registerTaskPolicy(router: PolicyRouter): void {
  // ── create_task ───────────────────────────────────────────────────
  router.register(
    "create_task",
    "[Architect] Submit a directive from the Architect to the Engineer. Returns the assigned task ID.",
    {
      title: z.string().describe("Short title for the task"),
      description: z.string().describe("Full task description"),
      correlationId: z.string().optional().describe("Optional correlation ID to link this task to related threads/proposals/tasks"),
      sourceThreadId: z.string().optional().describe("Optional thread ID that spawned this directive. If provided, the thread is automatically closed when the directive is created."),
      idempotencyKey: z.string().optional().describe("Idempotency key for deduplication"),
      dependsOn: z.array(z.string()).optional().describe("Task IDs that must complete before this task becomes pending"),
    },
    createTask,
  );

  // ── get_task ──────────────────────────────────────────────────────
  router.register(
    "get_task",
    "[Engineer] Get the next pending directive for the Engineer. Returns null if no directives are waiting.",
    {},
    getTask,
  );

  // ── create_report ─────────────────────────────────────────────────
  router.register(
    "create_report",
    "[Engineer] Submit an engineering report for a completed directive. Called by the Engineer.",
    {
      taskId: z.string().describe("The task ID this report is for"),
      report: z.string().describe("The engineering report (status, output, errors)"),
      summary: z.string().describe("A 1-2 sentence summary of the report outcome"),
      verification: z.string().optional().describe("Test/build command output for quality verification (optional)"),
    },
    createReport,
  );

  // ── get_report ────────────────────────────────────────────────────
  router.register(
    "get_report",
    "[Architect] Get the next completed engineering report. Returns a summary and reference — use read_document to read the full report.",
    {},
    getReport,
  );

  // ── list_tasks ────────────────────────────────────────────────────
  router.register(
    "list_tasks",
    "[Any] List tasks in the hub with filter + sort + pagination. " +
    "`filter` accepts a Mongo-ish object with implicit AND across fields: " +
    "`{status: 'pending'}` for eq, `{status: {$in: ['pending','working']}}` for set membership, " +
    "`{createdAt: {$lt: '2026-04-01T00:00:00Z'}}` for range. " +
    "Filterable fields: status, correlationId, assignedEngineerId, createdAt, updatedAt, " +
    "'createdBy.role', 'createdBy.agentId', 'createdBy.id' (computed `${role}:${agentId}`). " +
    "Range operators ($gt/$lt/$gte/$lte) apply only to dates + numbers. " +
    "Forbidden operators ($regex, $where, $expr, $or, $and, $not) are rejected with an error naming the permitted set. " +
    "`sort` accepts an ordered tuple `[{field, order}]` on: id, status, createdAt, updatedAt, correlationId, assignedEngineerId, 'createdBy.role', 'createdBy.agentId', 'createdBy.id'. " +
    "Implicit id:asc tie-breaker is appended for deterministic pagination. " +
    "Returns `_ois_query_unmatched: true` when the filter yields zero matches but the collection is non-empty (distinct from tool error). " +
    "Legacy scalar `status:` arg preserved for backwards compat; deprecated in favour of `filter.status`; removal in a future phase.",
    {
      filter: TASK_FILTER_SCHEMA.optional()
        .describe("Mongo-ish filter object; see tool description for permitted fields + operators"),
      sort: TASK_SORT_SCHEMA
        .describe("Ordered-tuple sort; see tool description for permitted fields"),
      status: z.string().optional()
        .describe("DEPRECATED: use `filter: { status: ... }`. Preserved for backwards compat; `filter.status` wins when both present."),
      ...LIST_LABELS_SCHEMA,
      ...LIST_PAGINATION_SCHEMA,
    },
    listTasks,
  );

  // ── cancel_task ───────────────────────────────────────────────────
  router.register(
    "cancel_task",
    "[Architect] Cancel a directive. Permitted from pending, working, blocked, or input_required status (stewardship for stranded or stale tasks). Not permitted on tasks already reported for review — those require a review decision.",
    {
      taskId: z.string().describe("The task ID to cancel"),
    },
    cancelTask,
  );

  // ── Internal Event Handlers ───────────────────────────────────────
  router.onInternalEvent("task_completed", handleTaskCompleted);
  router.onInternalEvent("task_cancelled", handleTaskCancelled);
}
