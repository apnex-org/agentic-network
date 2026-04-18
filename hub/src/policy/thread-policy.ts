/**
 * Thread Policy — Turn-based ideation thread lifecycle.
 *
 * Tools: create_thread, create_thread_reply, get_thread,
 *        list_threads, close_thread
 * FSM: active → converged | round_limit | closed
 * Features: turn enforcement, convergence detection, semantic intents
 */

import { z } from "zod";
import type { PolicyRouter } from "./router.js";
import type { IPolicyContext, PolicyResult } from "./types.js";
import type { ThreadAuthor, ThreadIntent, StagedAction, StagedActionOp, Thread } from "../state.js";
import { ThreadConvergenceGateError } from "../state.js";
import type { DomainEvent } from "./types.js";
import { callerLabels } from "./labels.js";
import { LIST_PAGINATION_SCHEMA, LIST_LABELS_SCHEMA, applyLabelFilter, paginate } from "./list-filters.js";

// ── Handlers ────────────────────────────────────────────────────────

async function createThread(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const title = args.title as string;
  const message = args.message as string;
  const maxRounds = (args.maxRounds as number) || 10;
  const correlationId = args.correlationId as string | undefined;
  const _semanticIntent = args.semanticIntent as string | undefined;

  const callerRole = ctx.stores.engineerRegistry.getRole(ctx.sessionId);
  const author: ThreadAuthor = callerRole === "engineer" ? "engineer" : "architect";
  // Mission-19: propagate caller's Agent labels onto the new Thread.
  const labels = await callerLabels(ctx);
  // Mission-21 Phase 1: resolve the caller's agentId so openThread can
  // seed the participants[] array with a full {role, agentId} entry.
  const agent = await (ctx.stores.engineerRegistry as any).getAgentForSession?.(ctx.sessionId).catch(() => null);
  const authorAgentId: string | null = agent?.engineerId ?? null;
  const thread = await ctx.stores.thread.openThread(title, message, author, maxRounds, correlationId, labels, authorAgentId);

  const targetRole = author === "architect" ? "engineer" : "architect";
  await ctx.dispatch("thread_message", {
    threadId: thread.id,
    title: thread.title,
    author,
    message: message.substring(0, 200),
    currentTurn: thread.currentTurn,
  }, { roles: [targetRole], matchLabels: thread.labels });

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        threadId: thread.id,
        title: thread.title,
        status: thread.status,
        currentTurn: thread.currentTurn,
        roundCount: thread.roundCount,
        maxRounds: thread.maxRounds,
      }),
    }],
  };
}

async function createThreadReply(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const threadId = args.threadId as string;
  const message = args.message as string;
  const converged = (args.converged as boolean) || false;
  const intent = (args.intent as string) || null;
  const semanticIntent = (args.semanticIntent as string) || null;
  const stagedActions = (args.stagedActions as StagedActionOp[] | undefined) ?? [];
  const summary = args.summary as string | undefined;

  const callerRole = ctx.stores.engineerRegistry.getRole(ctx.sessionId);
  const author: ThreadAuthor = callerRole === "engineer" ? "engineer" : "architect";
  // Mission-21 Phase 1: resolve the caller's agentId so the store can
  // attach it to the ThreadMessage and upsert into participants[].
  const agent = await (ctx.stores.engineerRegistry as any).getAgentForSession?.(ctx.sessionId).catch(() => null);
  const authorAgentId: string | null = agent?.engineerId ?? null;

  let thread: Thread | null;
  try {
    thread = await ctx.stores.thread.replyToThread(threadId, message, author, {
      converged,
      intent: (intent as ThreadIntent) || null,
      semanticIntent: semanticIntent as any,
      stagedActions,
      summary,
      authorAgentId,
    });
  } catch (err: any) {
    if (err instanceof ThreadConvergenceGateError) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }) }],
        isError: true,
      };
    }
    throw err;
  }

  if (!thread) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: `Thread ${threadId} not found, not active, or not your turn` }) }],
      isError: true,
    };
  }

  // Notify the other party (unless thread just converged or hit limit)
  if (thread.status === "active") {
    const targetRole = author === "architect" ? "engineer" : "architect";
    await ctx.dispatch("thread_message", {
      threadId: thread.id,
      title: thread.title,
      author,
      message: message.substring(0, 200),
      currentTurn: thread.currentTurn,
    }, { roles: [targetRole], matchLabels: thread.labels });
  }

  // Mission-21: push an internal cascade event on convergence so the
  // committed actions can be executed in array order.
  if (thread.status === "converged") {
    const committed = thread.convergenceActions.filter((a) => a.status === "committed");
    if (committed.length > 0) {
      ctx.internalEvents.push({
        type: "thread_converged_with_action",
        payload: {
          threadId: thread.id,
          title: thread.title,
          actions: committed,
        },
      });
    }

    await ctx.dispatch("thread_converged", {
      threadId: thread.id,
      title: thread.title,
      intent: thread.outstandingIntent,
      summary: thread.summary,
      committedActionCount: committed.length,
    }, { roles: ["architect"], matchLabels: thread.labels });
  }

  // Mission-21 Phase 1 Architect review addition #2: echo the current
  // convergenceActions[] and participants[] so the caller's LLM can
  // reason about the thread state without re-reading.
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        threadId: thread.id,
        status: thread.status,
        currentTurn: thread.currentTurn,
        roundCount: thread.roundCount,
        maxRounds: thread.maxRounds,
        outstandingIntent: thread.outstandingIntent,
        summary: thread.summary,
        convergenceActions: thread.convergenceActions,
        participants: thread.participants,
      }),
    }],
  };
}

async function getThread(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const threadId = args.threadId as string;
  const thread = await ctx.stores.thread.getThread(threadId);
  if (!thread) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: `Thread ${threadId} not found` }) }],
      isError: true,
    };
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(thread, null, 2) }],
  };
}

async function listThreads(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const status = args.status as string | undefined;
  let threads = await ctx.stores.thread.listThreads(status as any);
  threads = applyLabelFilter(threads, args.labels as Record<string, string> | undefined);
  const summaries = threads.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    currentTurn: t.currentTurn,
    roundCount: t.roundCount,
    maxRounds: t.maxRounds,
    outstandingIntent: t.outstandingIntent,
    initiatedBy: t.initiatedBy,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));
  const page = paginate(summaries, args);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ threads: page.items, count: page.count, total: page.total, offset: page.offset, limit: page.limit }, null, 2) }],
  };
}

async function closeThread(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const threadId = args.threadId as string;
  const success = await ctx.stores.thread.closeThread(threadId);
  if (!success) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: `Thread ${threadId} not found` }) }],
      isError: true,
    };
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ success: true, threadId, status: "closed" }) }],
  };
}

// ── Cascade Handlers ────────────────────────────────────────────────

/**
 * Mission-21 Phase 1: iterate committed StagedAction[] in array order
 * and execute each. Phase 1 only supports close_no_action, which just
 * writes an audit entry and closes the thread. Phase 2 widens this to
 * the full vocabulary (create_task, create_proposal, create_mission,
 * update_idea, update_mission, create_idea) with best-effort cascade
 * and a ConvergenceReport per action.
 */
async function handleThreadConvergedWithAction(
  event: DomainEvent,
  ctx: IPolicyContext
): Promise<void> {
  const payload = event.payload;
  const threadId = payload.threadId as string;
  const actions = payload.actions as StagedAction[] | undefined;

  if (!Array.isArray(actions) || actions.length === 0) {
    console.log(`[ThreadPolicy] thread_converged_with_action: no actions to cascade for thread ${threadId}`);
    return;
  }

  const sourceThread = await ctx.stores.thread.getThread(threadId);
  const inheritedLabels = sourceThread?.labels ?? {};
  // Include the thread's negotiated summary in audit details — Director
  // notification-A digest surfaces hub/architect audit entries and this
  // gives the human reader the actors' narrative without needing to
  // look the thread up separately.
  const summaryForAudit = sourceThread?.summary?.trim() || "(no summary provided)";

  // Internal ConvergenceReport — per-action telemetry. Distinct from
  // Thread.summary (the negotiated narrative). Phase 2 will widen this
  // with a `warning` flag on any partial failure.
  const report: Array<{ actionId: string; status: "executed" | "failed"; error?: string; entityId?: string | null }> = [];

  for (const action of actions) {
    if (action.type === "close_no_action") {
      const reason = action.payload.reason?.trim() || "(no reason provided)";
      try {
        await ctx.stores.audit.logEntry(
          "hub",
          "thread_close_no_action",
          `Thread ${threadId} closed (close_no_action). Summary: ${summaryForAudit}. Reason: ${reason}`,
          threadId,
        );
        report.push({ actionId: action.id, status: "executed", entityId: null });
      } catch (err: any) {
        report.push({ actionId: action.id, status: "failed", error: err?.message ?? String(err) });
      }
    } else {
      // Phase 1: vocabulary limited to close_no_action at the stage tool,
      // so this branch is unreachable under normal operation. Guard
      // defensively for Phase 2 widening.
      report.push({ actionId: action.id, status: "failed", error: `Phase 1 does not support action type "${action.type}"` });
    }
  }

  await ctx.stores.thread.closeThread(threadId);

  await ctx.dispatch("thread_convergence_completed", {
    threadId,
    committedActionCount: actions.length,
    report,
  }, { roles: ["architect", "engineer"], matchLabels: inheritedLabels });

  console.log(`[ThreadPolicy] Cascade completed for ${threadId}: ${report.filter(r => r.status === "executed").length}/${actions.length} executed`);
}

// ── Registration ────────────────────────────────────────────────────

export function registerThreadPolicy(router: PolicyRouter): void {
  router.register(
    "create_thread",
    "[Any] Open a new ideation thread for bidirectional discussion between Architect and Engineer. The other party will be notified via webhook.",
    {
      title: z.string().describe("Short title for the discussion topic"),
      message: z.string().describe("Opening message with your initial thoughts"),
      maxRounds: z.number().optional().describe("Maximum rounds before auto-escalation (default: 10)"),
      correlationId: z.string().optional().describe("Optional correlation ID to link this thread to related tasks/proposals"),
      semanticIntent: z.enum(["seek_rigorous_critique", "seek_approval", "collaborative_brainstorm", "inform", "seek_consensus", "rubber_duck", "educate", "mediate", "post_mortem"]).optional().describe("Communication semantics: how should the recipient frame their response"),
    },
    createThread,
  );

  router.register(
    "create_thread_reply",
    "[Any] Reply to an active ideation thread. Only works when it is your turn. Threads 2.0 (Mission-21 Phase 1): stage / revise / retract convergenceActions, author a summary narrating the thread's agreed outcome. At converged=true, the policy rejects the reply unless at least one action is committed and the summary is non-empty (close_no_action{reason} satisfies both — use it when the thread concludes with no entity-creation needed).",
    {
      threadId: z.string().describe("The thread ID to reply to"),
      message: z.string().describe("Your response message"),
      converged: z.boolean().optional().describe("Set to true if you agree with the other party's position (requires committed convergenceActions + non-empty summary)"),
      intent: z.enum(["decision_needed", "agreement_pending", "director_input", "implementation_ready"]).optional().describe("Classify what the thread is waiting for (optional)"),
      semanticIntent: z.enum(["seek_rigorous_critique", "seek_approval", "collaborative_brainstorm", "inform", "seek_consensus", "rubber_duck", "educate", "mediate", "post_mortem"]).optional().describe("Communication semantics: how should the recipient frame their response (optional)"),
      summary: z.string().optional().describe("Negotiated narrative summary of the thread's agreed outcome. Either party can set or revise across rounds; latest value wins. Required non-empty at convergence."),
      stagedActions: z.array(
        z.discriminatedUnion("kind", [
          z.object({
            kind: z.literal("stage"),
            type: z.enum(["close_no_action"]).describe("Phase 1 vocab: only close_no_action"),
            payload: z.object({ reason: z.string().describe("Why the thread is concluding with no entity-creation action") }),
          }),
          z.object({
            kind: z.literal("revise"),
            id: z.string().describe("Prior action ID to supersede"),
            payload: z.object({ reason: z.string() }),
          }),
          z.object({
            kind: z.literal("retract"),
            id: z.string().describe("Prior action ID to withdraw"),
          }),
        ]),
      ).optional().describe("Ordered staging operations applied to the thread's convergenceActions[]. stage allocates a new action-N id; revise supersedes a prior id; retract withdraws a prior id."),
    },
    createThreadReply,
  );

  router.register(
    "get_thread",
    "[Any] Read an ideation thread with all messages, status, and outstanding intent.",
    { threadId: z.string().describe("The thread ID to read") },
    getThread,
  );

  router.register(
    "list_threads",
    "[Any] List ideation threads with optional status filter, label match-all filter, and pagination.",
    {
      status: z.enum(["active", "converged", "round_limit", "closed"]).optional().describe("Filter threads by status (optional)"),
      ...LIST_LABELS_SCHEMA,
      ...LIST_PAGINATION_SCHEMA,
    },
    listThreads,
  );

  router.register(
    "close_thread",
    "[Architect] Close an ideation thread after the Director has reviewed the outcome.",
    { threadId: z.string().describe("The thread ID to close") },
    closeThread,
  );

  // ── Internal Event Handlers ─────────────────────────────────────
  router.onInternalEvent("thread_converged_with_action", handleThreadConvergedWithAction);
}
