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
import { systemClock } from "../entities/clock.js";
import type { PendingActionItem } from "../entities/pending-action.js";
import type { CompleteListPageInfo, CompleteListResult } from "../storage-substrate/complete-list.js";
import type { Proposal, Thread } from "../state.js";

// ── Handlers ────────────────────────────────────────────────────────

/** Whole-aggregate retries are bounded so reconnect churn cannot amplify forever. */
export const GET_PENDING_ACTIONS_MAX_SNAPSHOT_ATTEMPTS = 3;

type PendingAggregateSources = {
  inFlightPendingActions: CompleteListPageInfo;
  pendingProposals: CompleteListPageInfo;
  approvedProposals: CompleteListPageInfo;
  activeArchitectThreads: CompleteListPageInfo;
  convergedThreads: CompleteListPageInfo;
};

interface PendingAggregateAttempt {
  callerQueue: CompleteListResult<PendingActionItem>;
  pendingProposalResult: CompleteListResult<Proposal>;
  approvedProposalResult: CompleteListResult<Proposal>;
  activeArchitectThreadResult: CompleteListResult<Thread>;
  convergedThreadResult: CompleteListResult<Thread>;
  sources: PendingAggregateSources;
  snapshotRevision: string;
  complete: boolean;
  retryableDrift: boolean;
}

interface PendingAggregateAttemptReceipt {
  attempt: number;
  anchorRevision: string;
  complete: boolean;
  retryableDrift: boolean;
  observedRevisions: Record<keyof PendingAggregateSources, string>;
  reasons: Record<keyof PendingAggregateSources, string | null>;
}

async function readPendingAggregateAttempt(
  ctx: IPolicyContext,
  callerAgentId: string,
): Promise<PendingAggregateAttempt> {
  // The queue is the aggregate anchor because its thread-message ids suppress
  // the later Thread dimension. Every later dimension MUST join this exact
  // high-water or return snapshot_changed before accepting rows.
  const callerQueue = await ctx.stores.pendingAction.listForAgentComplete(callerAgentId, {
    states: ["enqueued", "receipt_acked"],
  });
  const snapshotRevision = callerQueue.pageInfo.snapshotRevision;
  const pendingProposalResult = await ctx.stores.proposal.getProposalsComplete(
    "submitted",
    snapshotRevision,
  );
  const approvedProposalResult = await ctx.stores.proposal.getProposalsComplete(
    "approved",
    snapshotRevision,
  );
  const activeArchitectThreadResult = await ctx.stores.thread.listThreadsComplete(
    "active",
    { currentTurn: "architect" },
    snapshotRevision,
  );
  const convergedThreadResult = await ctx.stores.thread.listThreadsComplete(
    "converged",
    undefined,
    snapshotRevision,
  );
  const sources: PendingAggregateSources = {
    inFlightPendingActions: callerQueue.pageInfo,
    pendingProposals: pendingProposalResult.pageInfo,
    approvedProposals: approvedProposalResult.pageInfo,
    activeArchitectThreads: activeArchitectThreadResult.pageInfo,
    convergedThreads: convergedThreadResult.pageInfo,
  };
  const complete = Object.values(sources).every(
    (source) => source.complete && source.snapshotRevision === snapshotRevision,
  );
  const hasNonDriftIncomplete = Object.values(sources).some(
    (source) => !source.complete && source.reason !== "snapshot_changed",
  );
  return {
    callerQueue,
    pendingProposalResult,
    approvedProposalResult,
    activeArchitectThreadResult,
    convergedThreadResult,
    sources,
    snapshotRevision,
    complete,
    retryableDrift: !hasNonDriftIncomplete
      && Object.values(sources).some((source) => source.reason === "snapshot_changed"),
  };
}

function attemptReceipt(
  attempt: PendingAggregateAttempt,
  attemptNumber: number,
): PendingAggregateAttemptReceipt {
  return {
    attempt: attemptNumber,
    anchorRevision: attempt.snapshotRevision,
    complete: attempt.complete,
    retryableDrift: attempt.retryableDrift,
    observedRevisions: Object.fromEntries(
      Object.entries(attempt.sources).map(([key, source]) => [key, source.observedRevision]),
    ) as Record<keyof PendingAggregateSources, string>,
    reasons: Object.fromEntries(
      Object.entries(attempt.sources).map(([key, source]) => [key, source.reason]),
    ) as Record<keyof PendingAggregateSources, string | null>,
  };
}

function result(content: unknown): PolicyResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(content, null, 2) }],
  };
}

async function getPendingActions(_args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  // work-162 (A1): Task subsystem retired — the task-derived dimensions
  // (unreadReports / unreviewedTasks / clarificationsPending / orphanedReviews /
  // escalatedTasks) are dropped. This aggregator now surfaces proposals + threads.
  //
  // bug-343: every reconnect dimension is substrate-filtered, indexed, admitted,
  // and read sequentially. work-470 made each dimension complete beyond 500;
  // work-472 makes the OUTWARD aggregate coherent rather than combining five
  // individually-complete dimensions from sequential database revisions.
  const callerAgent = await ctx.stores.engineerRegistry.getAgentForSession(ctx.sessionId);
  if (!callerAgent) {
    const unavailable = unavailableCallerResult();
    return result(failedPendingAggregate(
      unavailable.pageInfo.snapshotRevision,
      "caller_agent_unavailable",
      { inFlightPendingActions: unavailable.pageInfo },
      [],
    ));
  }

  const attempts: PendingAggregateAttemptReceipt[] = [];
  let lastAttempt: PendingAggregateAttempt | null = null;
  for (let attemptNumber = 1; attemptNumber <= GET_PENDING_ACTIONS_MAX_SNAPSHOT_ATTEMPTS; attemptNumber++) {
    const attempt = await readPendingAggregateAttempt(ctx, callerAgent.id);
    lastAttempt = attempt;
    attempts.push(attemptReceipt(attempt, attemptNumber));
    if (attempt.complete) return result(successfulPendingAggregate(attempt, attempts));
    if (!attempt.retryableDrift) {
      return result(failedPendingAggregate(
        attempt.snapshotRevision,
        "aggregate_source_incomplete",
        attempt.sources,
        attempts,
      ));
    }
  }

  // Never return arrays/counts assembled from the final mixed attempt. On
  // sustained writes the failure is intentionally actionless and machine-loud;
  // reconnect can retry later without acting on a state that never existed.
  return result(failedPendingAggregate(
    lastAttempt?.snapshotRevision ?? "unavailable:no-attempt",
    "aggregate_snapshot_retry_exhausted",
    lastAttempt?.sources ?? {},
    attempts,
  ));
}

function successfulPendingAggregate(
  attempt: PendingAggregateAttempt,
  attempts: PendingAggregateAttemptReceipt[],
): Record<string, unknown> {
  const inFlightThreadIds = new Set<string>();
  for (const item of attempt.callerQueue.items) {
    if (item.dispatchType === "thread_message") inFlightThreadIds.add(item.entityRef);
  }
  const pendingProposals = attempt.pendingProposalResult.items;
  const approvedProposals = attempt.approvedProposalResult.items;
  const activeArchitectThreads = attempt.activeArchitectThreadResult.items;
  const convergedThreads = attempt.convergedThreadResult.items;
  const threadsAwaitingArchitect = activeArchitectThreads.filter(
    (thread) => !inFlightThreadIds.has(thread.id),
  );
  const danglingProposals = approvedProposals.filter(
    (proposal) => proposal.executionPlan && !proposal.scaffoldResult,
  );
  const visiblePending = pendingProposals.length + threadsAwaitingArchitect.length + convergedThreads.length;

  return {
    totalPending: visiblePending,
    visiblePending,
    truncated: false,
    complete: true,
    snapshotRevision: attempt.snapshotRevision,
    retrieval: {
      complete: true,
      truncated: false,
      reason: null,
      aggregateSnapshot: {
        snapshotRevision: attempt.snapshotRevision,
        attemptsUsed: attempts.length,
        retries: attempts.length - 1,
        maxAttempts: GET_PENDING_ACTIONS_MAX_SNAPSHOT_ATTEMPTS,
        attempts,
      },
      dimensions: attempt.sources,
      derivedCounts: {
        pendingProposals: pendingProposals.length,
        threadsAwaitingReply: threadsAwaitingArchitect.length,
        convergedThreads: convergedThreads.length,
        danglingProposals: danglingProposals.length,
        totalPending: visiblePending,
      },
    },
    pendingProposals: pendingProposals.map((proposal) => ({
      proposalId: proposal.id,
      title: proposal.title,
      summary: proposal.summary,
      proposalRef: proposal.proposalRef,
    })),
    threadsAwaitingReply: threadsAwaitingArchitect.map((thread) => ({
      threadId: thread.id,
      title: thread.title,
      roundCount: thread.roundCount,
      outstandingIntent: thread.outstandingIntent,
    })),
    convergedThreads: convergedThreads.map((thread) => ({
      threadId: thread.id,
      title: thread.title,
      outstandingIntent: thread.outstandingIntent,
    })),
    anomalies: {
      count: danglingProposals.length,
      danglingProposals: danglingProposals.map((proposal) => ({
        proposalId: proposal.id,
        title: proposal.title,
        message: "Proposal approved with execution plan but scaffolding did not complete.",
      })),
    },
  };
}

function failedPendingAggregate(
  snapshotRevision: string,
  reason: "caller_agent_unavailable" | "aggregate_source_incomplete" | "aggregate_snapshot_retry_exhausted",
  dimensions: Partial<PendingAggregateSources>,
  attempts: PendingAggregateAttemptReceipt[],
): Record<string, unknown> {
  return {
    totalPending: null,
    visiblePending: null,
    truncated: true,
    complete: false,
    snapshotRevision: null,
    retrieval: {
      complete: false,
      truncated: true,
      reason,
      retryable: reason === "aggregate_snapshot_retry_exhausted",
      aggregateSnapshot: {
        snapshotRevision: null,
        lastAnchorRevision: snapshotRevision,
        attemptsUsed: attempts.length,
        retries: Math.max(0, attempts.length - 1),
        maxAttempts: GET_PENDING_ACTIONS_MAX_SNAPSHOT_ATTEMPTS,
        attempts,
      },
      dimensions,
      derivedCounts: {
        pendingProposals: null,
        threadsAwaitingReply: null,
        convergedThreads: null,
        danglingProposals: null,
        totalPending: null,
      },
    },
    pendingProposals: [],
    threadsAwaitingReply: [],
    convergedThreads: [],
    anomalies: { count: null, danglingProposals: [] },
  };
}

// ── get_metrics (Phase 2d CP2) ──────────────────────────────────────
// Read-only snapshot of the Hub's in-memory observability counters
// (shadow-invariant breaches, cascade-failure types, convergence-gate
// rejections, etc.). Closes task-304 CP1 Finding §4.4. Counters live
// per-process, so a restart resets them — not a replacement for the
// audit-log channel, but a live-debugging affordance for the architect.

function unavailableCallerResult() {
  return {
    items: [],
    pageInfo: {
      complete: false,
      truncated: true,
      returnedCount: 0,
      exactCount: null,
      pagesRead: 0,
      pageSize: 500,
      snapshotRevision: "unavailable:no-caller-agent",
      expectedRevision: null,
      observedRevision: "unavailable:no-caller-agent",
      nextOffset: 0,
      reason: "caller_agent_unavailable",
    },
  } as const;
}

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

// idea-449 / idea-525: the agent-facing companion to the substrate VirtualClock.
// Reports "now" from the SAME injected clock source (ctx.clock) the WorkGraph
// substrate stamps its timestamps with, so agent-visible time matches FSM time —
// and is deterministic under a simulation's VirtualClock. Falls back to real wall
// time when a ctx builder omitted the clock (e.g. an internal sweeper context).
async function getNow(_args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const now = (ctx.clock ?? systemClock).now();
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ now: now.toISOString(), epochMs: now.getTime() }, null, 2),
    }],
  };
}

// ── Registration ────────────────────────────────────────────────────

export function registerSystemPolicy(router: PolicyRouter): void {
  router.register(
    "get_pending_actions",
    "[Architect] Get a truncation-honest, aggregate-snapshot-coherent summary of all items requiring Architect attention: pending proposals, active threads awaiting Architect reply, and converged threads awaiting closure (plus dangling-proposal anomalies). Every Proposal/Thread/PendingAction dimension is reconstructed with stable paging beyond 500 AND fenced to one queue-anchored substrate high-water. Cross-dimension drift retries the whole aggregate up to 3 times; sustained drift fails actionless and loud with reason=aggregate_snapshot_retry_exhausted, exact totals=null, empty action arrays, and per-attempt revisions. Per-dimension safety/incompleteness is likewise loud. Designed for autonomous event loop polling. (work-162/A3: the Task-derived dimensions — unread reports, unreviewed/escalated tasks, task clarifications — were retired with the Task subsystem; the inbox is now WorkItem-native, so its terminal-legacy-Task noise is gone by construction.)",
    {},
    getPendingActions,
  );

  router.register(
    "get_metrics",
    "[Architect|Verifier] Read-only snapshot of in-memory observability counters (Phase 2d CP1 taxonomy). " +
    "Default (no `bucket`) returns a compact `snapshot` object mapping every counter name to its integer count. " +
    "Pass `bucket: 'name'` to additionally get `recentDetails` (ring-buffer up to 32 entries per bucket) for that specific counter. " +
    "Counter taxonomy (CP1): `inv_th<N>.shadow_breach`, `inv_th25.near_miss`, `convergence_gate.rejected`, `convergence_gate.authority_rejected`, `create_thread.routing_mode_rejected`, `cascade_fail.{depth_exhausted,unknown_spec,execute_threw,dispatch_failed,audit_failed}`, `cascade.idempotent_skip`, `cascade.idempotent_update_skip`. " +
    "Counter state is per-process (Hub restart resets all counts). (SEAL-C/idea-444: the `list_audit_entries` verb is retired — there is no MCP-queryable persisted view of these counters.)",
    {
      bucket: z.string().optional()
        .describe("Specific counter bucket to drill into (returns count + recentDetails for that bucket)."),
      limit: z.number().int().positive().max(RECENT_DETAILS_CAP).optional()
        .describe(`Cap on recentDetails entries returned (max ${RECENT_DETAILS_CAP}, default ${RECENT_DETAILS_CAP}). Ignored when no bucket is specified.`),
    },
    getMetrics,
  );

  router.register(
    "get_now",
    "[Any] Read the Hub's current time from the authoritative clock (idea-525). Returns " +
    "`{ now: ISO-8601 string, epochMs: number }` from the SAME clock source the WorkGraph " +
    "substrate stamps its timestamps with — under a simulation's VirtualClock this is " +
    "deterministic. No lease, no side effects, no args.",
    {},
    getNow,
  );
}
