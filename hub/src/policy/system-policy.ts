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
import { phaseFromEntity } from "../entities/shape-helpers.js";
import type { Proposal, Thread } from "../state.js";

// ── Handlers ────────────────────────────────────────────────────────

async function getPendingActions(_args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  // work-162 (A1): Task subsystem retired — the task-derived dimensions
  // (unreadReports / unreviewedTasks / clarificationsPending / orphanedReviews /
  // escalatedTasks) are dropped. This aggregator now surfaces proposals + threads.
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

  // mission-89 Phase 4 (bug-137 closure): envelope-aware phase reads.
  const proposalPhase = (p: Proposal) => phaseFromEntity(p);
  const threadPhase = (t: Thread) => phaseFromEntity(t);

  // Proposals needing review
  const pendingProposals = proposals.filter((p) => proposalPhase(p) === "submitted");

  // Threads awaiting Architect reply — excluding threads already
  // in-flight via the queue (Phase 2c ckpt-B, see note above).
  const threadsAwaitingArchitect = threads.filter(
    (t) => threadPhase(t) === "active" && t.currentTurn === "architect" && !inFlightThreadIds.has(t.id)
  );

  // Converged threads awaiting closure
  const convergedThreads = threads.filter(
    (t) => threadPhase(t) === "converged"
  );

  // ── Anomalous States Detection ──────────────────────────────────
  // Dangling proposals: approved but no scaffold result and has execution plan
  const danglingProposals = proposals.filter(
    (p) => proposalPhase(p) === "approved" && p.executionPlan && !p.scaffoldResult
  );

  const anomalyCount = danglingProposals.length;

  const summary = {
    totalPending:
      pendingProposals.length +
      threadsAwaitingArchitect.length +
      convergedThreads.length,
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
    "[Architect] Get a summary of all items requiring Architect attention: pending proposals, active threads awaiting Architect reply, and converged threads awaiting closure (plus dangling-proposal anomalies). Designed for autonomous event loop polling. (work-162/A3: the Task-derived dimensions — unread reports, unreviewed/escalated tasks, task clarifications — were retired with the Task subsystem; the inbox is now WorkItem-native, so its terminal-legacy-Task noise is gone by construction.)",
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
}
