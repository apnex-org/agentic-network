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

// ── Handlers ────────────────────────────────────────────────────────

async function getPendingActions(_args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  // work-162 (A1): Task subsystem retired — the task-derived dimensions
  // (unreadReports / unreviewedTasks / clarificationsPending / orphanedReviews /
  // escalatedTasks) are dropped. This aggregator now surfaces proposals + threads.
  //
  // bug-343: every reconnect dimension is pushed to the substrate. The old
  // implementation fetched the first 500 proposals, first 500 threads, and every
  // queue item for the caller, then filtered in memory. Combined with list()'s
  // former substrate-wide MAX(resource_version), concurrent reconnects became a
  // whole-entity scan stampede. Keep these reads sequential (one admitted list
  // per reconnect) and index-addressable by kind/status/turn/target.

  // idea-117 Phase 2c ckpt-B — suppress legacy-path re-triggers when a
  // thread already has a non-terminal queue item for the caller. The
  // architect's EventLoop consumes `threadsAwaitingReply` as a legacy
  // backup path, independent of the ADR-017 queue.
  const callerAgent = await ctx.stores.engineerRegistry.getAgentForSession(ctx.sessionId);
  const inFlightThreadIds = new Set<string>();
  const callerQueue = callerAgent
    ? await ctx.stores.pendingAction.listForAgentComplete(callerAgent.id, {
        states: ["enqueued", "receipt_acked"],
      })
    : unavailableCallerResult();
  for (const item of callerQueue.items) {
    if (item.dispatchType === "thread_message") inFlightThreadIds.add(item.entityRef);
  }

  // bug-343 successor: each dimension is reconstructed through stable id-ordered
  // pages. Every page must share one high-water revision; concurrent drift or the
  // 10k safety ceiling returns an explicit incomplete receipt rather than a false
  // 500-row exact count.
  const pendingProposalResult = await ctx.stores.proposal.getProposalsComplete("submitted");
  const approvedProposalResult = await ctx.stores.proposal.getProposalsComplete("approved");
  const activeArchitectThreadResult = await ctx.stores.thread.listThreadsComplete("active", {
    currentTurn: "architect",
  });
  const convergedThreadResult = await ctx.stores.thread.listThreadsComplete("converged");
  const pendingProposals = pendingProposalResult.items;
  const approvedProposals = approvedProposalResult.items;
  const activeArchitectThreads = activeArchitectThreadResult.items;
  const convergedThreads = convergedThreadResult.items;

  // Threads awaiting Architect reply — excluding threads already in-flight via
  // the queue (Phase 2c ckpt-B, see note above).
  const threadsAwaitingArchitect = activeArchitectThreads.filter(
    (t) => !inFlightThreadIds.has(t.id)
  );

  // ── Anomalous States Detection ──────────────────────────────────
  // Dangling proposals: approved but no scaffold result and has execution plan.
  const danglingProposals = approvedProposals.filter(
    (p) => p.executionPlan && !p.scaffoldResult
  );

  const anomalyCount = danglingProposals.length;
  const sources = {
    inFlightPendingActions: callerQueue.pageInfo,
    pendingProposals: pendingProposalResult.pageInfo,
    approvedProposals: approvedProposalResult.pageInfo,
    activeArchitectThreads: activeArchitectThreadResult.pageInfo,
    convergedThreads: convergedThreadResult.pageInfo,
  };
  const complete = Object.values(sources).every((source) => source.complete);
  const visiblePending =
    pendingProposals.length +
    threadsAwaitingArchitect.length +
    convergedThreads.length;

  const summary = {
    // A number is emitted only when every source dimension is complete. During
    // snapshot churn/safety truncation, null + visiblePending + retrieval makes
    // the uncertainty machine-readable and impossible to mistake for exactness.
    totalPending: complete ? visiblePending : null,
    visiblePending,
    truncated: !complete,
    retrieval: {
      complete,
      truncated: !complete,
      dimensions: sources,
      derivedCounts: {
        pendingProposals: pendingProposals.length,
        threadsAwaitingReply: threadsAwaitingArchitect.length,
        convergedThreads: convergedThreads.length,
        danglingProposals: danglingProposals.length,
        totalPending: complete ? visiblePending : null,
      },
    },
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
    convergedThreads: convergedThreads.map((t) => ({
      threadId: t.id,
      title: t.title,
      outstandingIntent: t.outstandingIntent,
    })),
    // Anomalous States — state inconsistencies requiring intervention
    anomalies: {
      count: anomalyCount,
      danglingProposals: danglingProposals.map((p) => ({
        proposalId: p.id,
        title: p.title,
        message: "Proposal approved with execution plan but scaffolding did not complete.",
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
    "[Architect] Get a truncation-honest summary of all items requiring Architect attention: pending proposals, active threads awaiting Architect reply, and converged threads awaiting closure (plus dangling-proposal anomalies). Every Proposal/Thread/PendingAction dimension is reconstructed with stable paging beyond 500; retrieval dimensions expose exact counts when complete or loud truncation + nextOffset/reason when snapshot drift or the safety ceiling prevents completeness. totalPending is null rather than falsely exact when any source is incomplete. Designed for autonomous event loop polling. (work-162/A3: the Task-derived dimensions — unread reports, unreviewed/escalated tasks, task clarifications — were retired with the Task subsystem; the inbox is now WorkItem-native, so its terminal-legacy-Task noise is gone by construction.)",
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
