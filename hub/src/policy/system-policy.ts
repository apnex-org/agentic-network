/**
 * System Policy — Cross-domain read models and aggregate queries.
 *
 * This policy handles tools that need access to multiple stores
 * but perform read-only operations. Extracted from TaskPolicy to
 * preserve bounded contexts.
 */

import { z } from "zod";
import type { PolicyRouter } from "./router.js";
import type { IPolicyContext, PolicyResult } from "./types.js";
import { RECENT_DETAILS_CAP } from "../observability/metrics.js";

// ── Handlers ────────────────────────────────────────────────────────

async function getPendingActions(_args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const tasks = await ctx.stores.task.listTasks();
  const proposals = await ctx.stores.proposal.getProposals();
  const threads = await ctx.stores.thread.listThreads();

  // idea-117 Phase 2c ckpt-B — suppress legacy-path re-triggers when a
  // thread already has a non-terminal queue item for the caller. The
  // architect's EventLoop consumes `threadsAwaitingReply` as a legacy
  // backup path, independent of the ADR-017 queue. Before this fix, a
  // sandwich that hit MAX_TOOL_ROUNDS left its queue item in
  // receipt_acked forever AND the thread in currentTurn=architect —
  // so every 300s poll re-fired the sandwich indefinitely, burning
  // millions of Gemini tokens on failed retries. Excluding threads with
  // enqueued/receipt_acked queue items here makes the legacy path purely
  // a recovery fallback — it fires only when the queue has nothing
  // actionable for that thread.
  const callerAgent = await ctx.stores.engineerRegistry.getAgentForSession(ctx.sessionId);
  const inFlightThreadIds = new Set<string>();
  if (callerAgent) {
    const callerQueue = await ctx.stores.pendingAction.listForAgent(callerAgent.id);
    for (const item of callerQueue) {
      if (item.dispatchType !== "thread_message") continue;
      if (item.state === "enqueued" || item.state === "receipt_acked") {
        inFlightThreadIds.add(item.entityRef);
      }
    }
  }

  // Reports awaiting Architect read (exclude already-reviewed).
  // idea-89 fix: submitReport transitions task → "in_review", but this
  // filter was only matching "completed"/"failed"/"reported_*". Result:
  // 14+ engineer reports sat in in_review indefinitely because the
  // architect's EventLoop poll saw unreviewedTasks:[] every tick.
  // Include "in_review" so the architect sandwich picks them up.
  const unreadReports = tasks.filter(
    (t) => (t.status === "in_review" || t.status === "completed" || t.status === "failed") && t.report !== null && !t.reviewAssessment
  );

  // Completed tasks without review. Same fix as above — add "in_review"
  // so the EventLoop.unreviewedTasks poll drains reports awaiting review.
  const unreviewedTasks = tasks.filter(
    (t) =>
      (t.status === "in_review" ||
       t.status === "completed" ||
       t.status === "failed" ||
       t.status?.startsWith("reported_")) &&
      !t.reviewAssessment
  );

  // Proposals needing review
  const pendingProposals = proposals.filter((p) => p.status === "submitted");

  // Threads awaiting Architect reply — excluding threads already
  // in-flight via the queue (Phase 2c ckpt-B, see note above).
  const threadsAwaitingArchitect = threads.filter(
    (t) => t.status === "active" && t.currentTurn === "architect" && !inFlightThreadIds.has(t.id)
  );

  // Clarification requests
  const clarificationsPending = tasks.filter(
    (t) => t.status === "input_required"
  );

  // Converged threads awaiting closure
  const convergedThreads = threads.filter(
    (t) => t.status === "converged"
  );

  // ── Anomalous States Detection ──────────────────────────────────
  // Detect state inconsistencies that indicate partial failures

  // Orphaned reviews: task in in_review but reviewRef already set
  // (review was stored but state transition failed — the deadlock scenario)
  const orphanedReviews = tasks.filter(
    (t) => t.status === "in_review" && t.reviewRef !== null
  );

  // Dangling proposals: approved but no scaffold result and has execution plan
  const danglingProposals = proposals.filter(
    (p) => p.status === "approved" && p.executionPlan && !p.scaffoldResult
  );

  // Escalated tasks: tasks stuck in escalated state requiring Director intervention
  const escalatedTasks = tasks.filter(
    (t) => t.status === "escalated"
  );

  const anomalyCount = orphanedReviews.length + danglingProposals.length + escalatedTasks.length;

  const summary = {
    totalPending:
      unreadReports.length +
      unreviewedTasks.length +
      pendingProposals.length +
      threadsAwaitingArchitect.length +
      clarificationsPending.length +
      convergedThreads.length,
    unreadReports: unreadReports.map((t) => ({
      taskId: t.id,
      summary: t.reportSummary,
      reportRef: t.reportRef,
    })),
    unreviewedTasks: unreviewedTasks.map((t) => ({
      taskId: t.id,
      title: t.title || (t.description || t.directive || "").substring(0, 100),
      reportRef: t.reportRef,
    })),
    pendingProposals: pendingProposals.map((p) => ({
      proposalId: p.id,
      title: p.title,
      summary: p.summary,
      proposalRef: p.proposalRef,
    })),
    threadsAwaitingReply: threadsAwaitingArchitect.map((t) => ({
      threadId: t.id,
      title: t.title,
      roundCount: t.roundCount,
      outstandingIntent: t.outstandingIntent,
    })),
    clarificationsPending: clarificationsPending.map((t) => ({
      taskId: t.id,
      question: t.clarificationQuestion,
    })),
    convergedThreads: convergedThreads.map((t) => ({
      threadId: t.id,
      title: t.title,
      outstandingIntent: t.outstandingIntent,
    })),
    // Anomalous States — state inconsistencies requiring intervention
    anomalies: {
      count: anomalyCount,
      orphanedReviews: orphanedReviews.map((t) => ({
        taskId: t.id,
        title: t.title || (t.description || "").substring(0, 100),
        reviewRef: t.reviewRef,
        message: "Task has a stored review but is still in_review. Re-submit create_review with decision: approved.",
      })),
      danglingProposals: danglingProposals.map((p) => ({
        proposalId: p.id,
        title: p.title,
        message: "Proposal approved with execution plan but scaffolding did not complete.",
      })),
      escalatedTasks: escalatedTasks.map((t) => ({
        taskId: t.id,
        title: t.title || (t.description || "").substring(0, 100),
        revisionCount: t.revisionCount,
        message: "Task hit circuit breaker. Director intervention required.",
      })),
    },
  };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(summary, null, 2),
      },
    ],
  };
}

// ── get_metrics (Phase 2d CP2) ──────────────────────────────────────
// Read-only snapshot of the Hub's in-memory observability counters
// (shadow-invariant breaches, cascade-failure types, convergence-gate
// rejections, etc.). Closes task-304 CP1 Finding §4.4. Counters live
// per-process, so a restart resets them — not a replacement for the
// audit-log channel, but a live-debugging affordance for the architect.

async function getMetrics(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const bucket = typeof args.bucket === "string" ? args.bucket : undefined;
  const rawLimit = typeof args.limit === "number" ? args.limit : undefined;
  const limit = Math.max(1, Math.min(RECENT_DETAILS_CAP, rawLimit ?? RECENT_DETAILS_CAP));

  const snapshot = ctx.metrics.snapshot();

  if (bucket) {
    const count = snapshot[bucket] ?? 0;
    const recentDetails = ctx.metrics.recentDetails(bucket, limit);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ bucket, count, recentDetails }, null, 2),
      }],
    };
  }

  // Default: full snapshot, no details (keeps payload compact).
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ snapshot }, null, 2),
    }],
  };
}

// ── Registration ────────────────────────────────────────────────────

export function registerSystemPolicy(router: PolicyRouter): void {
  router.register(
    "get_pending_actions",
    "[Architect] Get a summary of all items requiring Architect attention: unread reports, pending proposals, active threads awaiting Architect reply, and tasks needing review. Designed for autonomous event loop polling.",
    {},
    getPendingActions,
  );

  router.register(
    "get_metrics",
    "[Architect] Read-only snapshot of in-memory observability counters (Phase 2d CP1 taxonomy). " +
    "Default (no `bucket`) returns a compact `snapshot` object mapping every counter name to its integer count. " +
    "Pass `bucket: 'name'` to additionally get `recentDetails` (ring-buffer up to 32 entries per bucket) for that specific counter. " +
    "Counter taxonomy (CP1): `inv_th<N>.shadow_breach`, `inv_th25.near_miss`, `convergence_gate.rejected`, `convergence_gate.authority_rejected`, `create_thread.routing_mode_rejected`, `cascade_fail.{depth_exhausted,unknown_spec,execute_threw,dispatch_failed,audit_failed}`, `cascade.idempotent_skip`, `cascade.idempotent_update_skip`. " +
    "Counter state is per-process (Hub restart resets all counts); use `list_audit_entries` for a persisted view where available.",
    {
      bucket: z.string().optional()
        .describe("Specific counter bucket to drill into (returns count + recentDetails for that bucket)."),
      limit: z.number().int().positive().max(RECENT_DETAILS_CAP).optional()
        .describe(`Cap on recentDetails entries returned (max ${RECENT_DETAILS_CAP}, default ${RECENT_DETAILS_CAP}). Ignored when no bucket is specified.`),
    },
    getMetrics,
  );
}
