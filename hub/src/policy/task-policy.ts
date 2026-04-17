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
  const taskId = await ctx.stores.task.submitDirective(resolvedDirective, correlationId, idempotencyKey, title, description, dependsOn, labels);

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

  // Auto-linkage: if correlationId matches mission-\d+, link task to mission
  if (correlationId && /^mission-\d+$/.test(correlationId)) {
    try {
      await ctx.stores.mission.linkTask(correlationId, taskId);
      console.log(`[TaskPolicy] Auto-linked task ${taskId} to ${correlationId}`);
    } catch (err) {
      console.log(`[TaskPolicy] Auto-linkage failed (task ${taskId} → ${correlationId}): ${err}`);
      // Non-fatal — the directive was still created
    }
  }

  // Determine the resulting status
  const hasDeps = dependsOn && dependsOn.length > 0;
  const resultStatus = hasDeps ? "blocked" : "pending";

  if (hasDeps) {
    // Notify that the task is blocked on dependencies (architects in same label scope).
    await ctx.dispatch("task_blocked", {
      taskId,
      directive: resolvedDirective.substring(0, 200),
      correlationId,
      dependsOn,
    }, { roles: ["architect"], matchLabels: labels });
  } else {
    // Notify Engineers in the matching label scope that a new directive is available.
    await ctx.dispatch("directive_issued", {
      taskId,
      directive: resolvedDirective.substring(0, 200),
      correlationId,
      sourceThreadId,
    }, { roles: ["engineer"], matchLabels: labels });
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
    claimant ? { engineerId: claimant.engineerId, labels: claimant.labels ?? {} } : undefined,
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
    engineerId: task.assignedEngineerId || claimant?.engineerId || "unknown",
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

async function listTasks(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const tasks = await ctx.stores.task.listTasks();
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ tasks, count: tasks.length }, null, 2),
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
    await ctx.dispatch("directive_issued", {
      taskId: unblockedId,
      directive: `Unblocked by completion of ${taskId}`,
      correlationId: null,
    }, { roles: ["engineer"], matchLabels: unblocked?.labels });
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
    "[Any] List all current tasks in the hub (for debugging).",
    {},
    listTasks,
  );

  // ── cancel_task ───────────────────────────────────────────────────
  router.register(
    "cancel_task",
    "[Architect] Cancel a pending directive that hasn't been picked up by an Engineer yet. Only works on tasks with 'pending' status.",
    {
      taskId: z.string().describe("The task ID to cancel"),
    },
    cancelTask,
  );

  // ── Internal Event Handlers ───────────────────────────────────────
  router.onInternalEvent("task_completed", handleTaskCompleted);
  router.onInternalEvent("task_cancelled", handleTaskCancelled);
}
