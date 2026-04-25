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
import { runTriggers } from "./triggers.js";

// ── Handlers ────────────────────────────────────────────────────────

async function createReview(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const taskId = args.taskId as string;
  const assessment = args.assessment as string;
  // task-316 / thread-241: accept `revision_required` as the canonical
  // name for the revision branch (binary enum ratified per thread-241).
  // `rejected` stays as an alias for backward-compat with pre-task-316
  // callers + existing test corpora; both map to the same code path.
  const rawDecision = (args.decision as string) || "approved";
  const decision = rawDecision === "revision_required" ? "rejected" : rawDecision;

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

    // task-316 / thread-241: standalone approved reviews carry
    // `intent: "review_available"` so the engineer adapter can surface
    // the review as a read-only notification (distinct from revision-
    // required / address_feedback). Mission-linked approved reviews
    // will also fire this dispatch AS WELL AS the advancement cascade
    // downstream in handleTaskCompleted (task-policy.ts) which issues
    // the next plannedTask — the engineer sees both the review
    // completion and the next directive.
    await ctx.dispatch("review_completed", {
      taskId,
      reviewRef,
      assessment: assessment.substring(0, 200),
      decision: "approved",
      intent: "review_available",
    }, task.assignedEngineerId
      ? { engineerId: task.assignedEngineerId }
      : { roles: ["engineer"], matchLabels: task.labels });

    // Push task_completed internal event for DAG cascade
    ctx.internalEvents.push({
      type: "task_completed",
      payload: { taskId },
    });

    // Mission-51 W3: state-transition trigger for review-submitted.
    // Best-effort emission; failures are logged + non-fatal.
    try {
      await runTriggers(
        "review",
        null,
        "submitted",
        {
          id: reviewRef,
          taskId,
          decision: "approved",
          reviewerAgentId: ctx.sessionId,
          reportAuthorAgentId: task.assignedEngineerId ?? undefined,
        },
        ctx,
      );
    } catch (err) {
      ctx.metrics.increment("trigger.runner_error", {
        entityType: "review",
        toStatus: "submitted",
        error: (err as Error)?.message ?? String(err),
      });
      console.warn(`[ReviewPolicy] runTriggers failed for review of task ${taskId} (approved); review still committed:`, err);
    }

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
      // task-316 / thread-241: revision_required carries
      // `intent: "address_feedback"` + `decision: "revision_required"`
      // (canonical naming per thread-241; prose "rejected" retained in
      // the dispatch channel name for back-compat on listeners). The
      // adapter consumes these to surface an actionable feedback
      // context — engineer reasoning branches: report-discrepancy /
      // work-discrepancy / clarification-thread detour, all resolving
      // on the replaced create_report (thread-242 FSMs).
      //
      // Normal rejection — send back for revision (P2P to original engineer, fallback to pool).
      // Payload enrichment: include full assessment so agent loop can ingest immediately
      await ctx.dispatch("revision_required", {
        taskId,
        assessment,
        feedback: assessment,
        previousReportRef: task.reportRef,
        reviewRef,
        revisionCount: newRevisionCount,
        decision: "revision_required",
        intent: "address_feedback",
      }, task.assignedEngineerId
        ? { engineerId: task.assignedEngineerId }
        : { roles: ["engineer"], matchLabels: task.labels });

      // Mission-51 W3: state-transition trigger (same shape as the
      // approved-path; payload.decision differentiates).
      try {
        await runTriggers(
          "review",
          null,
          "submitted",
          {
            id: reviewRef,
            taskId,
            decision: "revision_required",
            reviewerAgentId: ctx.sessionId,
            reportAuthorAgentId: task.assignedEngineerId ?? undefined,
          },
          ctx,
        );
      } catch (err) {
        ctx.metrics.increment("trigger.runner_error", {
          entityType: "review",
          toStatus: "submitted",
          error: (err as Error)?.message ?? String(err),
        });
        console.warn(`[ReviewPolicy] runTriggers failed for review of task ${taskId} (revision_required); review still committed:`, err);
      }

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
    "[Architect] Review a task report. " +
    "If `approved`, transitions to completed and triggers DAG cascade + mission-advancement cascade (task-316 / idea-144 Path A — if the task is mission-linked AND the mission has unissued plannedTasks, the next plannedTask is auto-issued). " +
    "If `revision_required` (or legacy `rejected`), returns to working for revision; dispatches `address_feedback` intent to the engineer; at revisionCount≥3 escalates to architect pool. " +
    "task-316 / thread-241: canonical enum values are `approved` and `revision_required`; `rejected` is an alias for back-compat.",
    {
      taskId: z.string().describe("The task ID this review is for"),
      assessment: z.string().describe("The Architect's review assessment text"),
      decision: z.enum(["approved", "revision_required", "rejected"]).optional().describe("Review decision. Canonical values: `approved` (default) or `revision_required`. `rejected` is a back-compat alias for `revision_required` (task-316 / thread-241)."),
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
