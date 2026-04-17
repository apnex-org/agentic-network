/**
 * Review Policy — Task review assessment lifecycle with decision logic.
 *
 * Tools: create_review, get_review
 * 
 * On approved: in_review → completed, triggers DAG cascade (unblockDependents)
 * On rejected: in_review → working (increments revisionCount), emits revision_required
 * On rejected with revisionCount >= 3: in_review → escalated (circuit breaker)
 */

import { z } from "zod";
import type { PolicyRouter } from "./router.js";
import type { IPolicyContext, PolicyResult } from "./types.js";
import { isValidTransition } from "./types.js";
import { TASK_FSM } from "./task-policy.js";

// ── Handlers ────────────────────────────────────────────────────────

async function createReview(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const taskId = args.taskId as string;
  const assessment = args.assessment as string;
  const decision = (args.decision as string) || "approved"; // default to approved for backward compat

  // Get task to validate state and compute versioned refs
  const task = await ctx.stores.task.getTask(taskId);
  if (!task) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: `Task ${taskId} not found` }) }],
      isError: true,
    };
  }

  const version = (task.revisionCount || 0) + 1;
  const reviewRef = `reviews/${taskId}-v${version}-review.md`;

  if (decision === "approved") {
    // Idempotency: if already completed, no-op safely
    if (task.status === "completed") {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            taskId,
            decision: "approved",
            status: "completed",
            reviewRef: task.reviewRef || reviewRef,
            message: "Task already completed — review is a no-op.",
            idempotent: true,
          }),
        }],
      };
    }

    // FSM guard: in_review → completed
    if (!isValidTransition(TASK_FSM, task.status, "completed")) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: `Invalid state transition: cannot approve task in '${task.status}' state (must be 'in_review')` }) }],
        isError: true,
      };
    }

    const success = await ctx.stores.task.submitReview(taskId, assessment, "approved");
    if (!success) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: `Task ${taskId} review failed` }) }],
        isError: true,
      };
    }

    // Audit lineage: log decision with revisionCount
    await ctx.stores.audit.logEntry("hub", "review_decision", 
      `Task ${taskId} review: approved (revisionCount=${task.revisionCount || 0})`,
      taskId
    );

    // Emit review_completed to the assigned engineer (P2P) or label-scoped pool fallback.
    await ctx.dispatch("review_completed", {
      taskId,
      reviewRef,
      assessment: assessment.substring(0, 200),
      decision: "approved",
    }, task.assignedEngineerId
      ? { engineerId: task.assignedEngineerId }
      : { roles: ["engineer"], matchLabels: task.labels });

    // Push task_completed internal event for DAG cascade
    ctx.internalEvents.push({
      type: "task_completed",
      payload: { taskId },
    });

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          success: true,
          taskId,
          decision: "approved",
          status: "completed",
          reviewRef,
        }),
      }],
    };

  } else if (decision === "rejected") {
    // Determine target state based on revisionCount
    const isEscalated = (task.revisionCount || 0) >= 3;
    const targetState = isEscalated ? "escalated" : "working";

    // FSM guard
    if (!isValidTransition(TASK_FSM, task.status, targetState)) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: `Invalid state transition: cannot reject task in '${task.status}' state (must be 'in_review')` }) }],
        isError: true,
      };
    }

    const success = await ctx.stores.task.submitReview(taskId, assessment, "rejected");
    if (!success) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: `Task ${taskId} review failed` }) }],
        isError: true,
      };
    }

    // Audit lineage: log rejection with revisionCount
    const newRevisionCount = isEscalated ? (task.revisionCount || 0) : (task.revisionCount || 0) + 1;
    await ctx.stores.audit.logEntry("hub", "review_decision",
      `Task ${taskId} review: rejected (revisionCount=${newRevisionCount}, escalated=${isEscalated})`,
      taskId
    );

    if (isEscalated) {
      // Circuit breaker: too many revisions — escalate to architect(s) in the label scope.
      await ctx.dispatch("director_attention_required", {
        taskId,
        revisionCount: task.revisionCount,
        assessment,
      }, { roles: ["architect"], matchLabels: task.labels });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            taskId,
            decision: "rejected",
            status: "escalated",
            revisionCount: task.revisionCount,
            reviewRef,
            message: "Task escalated — revision limit exceeded. Director intervention required.",
          }),
        }],
      };
    } else {
      // Normal rejection — send back for revision (P2P to original engineer, fallback to pool).
      // Payload enrichment: include full assessment so agent loop can ingest immediately
      await ctx.dispatch("revision_required", {
        taskId,
        assessment,
        feedback: assessment,
        previousReportRef: task.reportRef,
        reviewRef,
        revisionCount: newRevisionCount,
      }, task.assignedEngineerId
        ? { engineerId: task.assignedEngineerId }
        : { roles: ["engineer"], matchLabels: task.labels });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            taskId,
            decision: "rejected",
            status: "working",
            revisionCount: (task.revisionCount || 0) + 1,
            reviewRef,
            message: "Report rejected. Task returned to working for revision.",
          }),
        }],
      };
    }
  } else {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: `Invalid decision: '${decision}'. Must be 'approved' or 'rejected'.` }) }],
      isError: true,
    };
  }
}

async function getReview(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const taskId = args.taskId as string;

  const review = await ctx.stores.task.getReview(taskId);
  if (!review) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          taskId,
          reviewed: false,
          message: `No review found for task ${taskId}`,
        }),
      }],
    };
  }

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        taskId: review.taskId,
        reviewed: true,
        assessment: review.assessment,
        reviewRef: review.reviewRef,
      }),
    }],
  };
}

// ── Registration ────────────────────────────────────────────────────

export function registerReviewPolicy(router: PolicyRouter): void {
  router.register(
    "create_review",
    "[Architect] Review a task report. If approved, transitions to completed and triggers DAG cascade. If rejected, returns to working for revision.",
    {
      taskId: z.string().describe("The task ID this review is for"),
      assessment: z.string().describe("The Architect's review assessment text"),
      decision: z.enum(["approved", "rejected"]).optional().describe("Review decision: approved (default) transitions to completed, rejected returns to working."),
    },
    createReview,
  );

  router.register(
    "get_review",
    "[Any] Get the Architect's review assessment for a specific task. Returns the assessment text and a reference to the full review document.",
    {
      taskId: z.string().describe("The task ID to get the review for"),
    },
    getReview,
  );
}
