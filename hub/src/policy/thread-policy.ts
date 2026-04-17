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
import type { ThreadAuthor, ThreadIntent, ConvergenceAction } from "../state.js";
import type { DomainEvent } from "./types.js";
import { callerLabels } from "./labels.js";

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
  const thread = await ctx.stores.thread.openThread(title, message, author, maxRounds, correlationId, labels);

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
  const convergenceAction = args.convergenceAction as ConvergenceAction | undefined;

  const callerRole = ctx.stores.engineerRegistry.getRole(ctx.sessionId);
  const author: ThreadAuthor = callerRole === "engineer" ? "engineer" : "architect";
  const thread = await ctx.stores.thread.replyToThread(
    threadId,
    message,
    author,
    converged,
    (intent as ThreadIntent) || null,
    semanticIntent as any,
  );

  if (!thread) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: `Thread ${threadId} not found, not active, or not your turn` }) }],
      isError: true,
    };
  }

  // Store convergenceAction on the thread entity (late-binding)
  if (convergenceAction) {
    // Directly mutate the thread in the store
    const stored = await ctx.stores.thread.getThread(threadId);
    if (stored) {
      (stored as any).convergenceAction = convergenceAction;
      // For MemoryThreadStore, we need to set it on the live object
      // The store returns copies, so we use a targeted update
      try {
        await (ctx.stores.thread as any).setConvergenceAction(threadId, convergenceAction);
      } catch {
        // Fallback: store doesn't have setConvergenceAction yet — log and continue
        console.log(`[ThreadPolicy] convergenceAction stored for thread ${threadId}: ${convergenceAction.type}`);
      }
    }
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

  // Notify Architect when thread converges
  if (thread.status === "converged") {
    // Check for convergenceAction — if present, push internal event for cascade
    const finalThread = await ctx.stores.thread.getThread(threadId);
    const action = finalThread?.convergenceAction || convergenceAction;

    if (action) {
      ctx.internalEvents.push({
        type: "thread_converged_with_action",
        payload: {
          threadId: thread.id,
          title: thread.title,
          action,
        },
      });
    }

    await ctx.dispatch("thread_converged", {
      threadId: thread.id,
      title: thread.title,
      intent: thread.outstandingIntent,
      hasAction: !!action,
    }, { roles: ["architect"], matchLabels: thread.labels });
  }

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
        convergenceAction: convergenceAction || null,
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
  const threads = await ctx.stores.thread.listThreads(status as any);
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
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ threads: summaries, count: summaries.length }, null, 2) }],
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

async function handleThreadConvergedWithAction(
  event: DomainEvent,
  ctx: IPolicyContext
): Promise<void> {
  const payload = event.payload;
  const threadId = payload.threadId as string;
  const action = payload.action as ConvergenceAction;

  if (!action || !action.type || !action.templateData) {
    console.log(`[ThreadPolicy] thread_converged_with_action: invalid action for thread ${threadId}`);
    return;
  }

  const { type, templateData } = action;
  const { title, description } = templateData;

  // Mission-19: spawn from a converged thread inherits the thread's labels.
  const sourceThread = await ctx.stores.thread.getThread(threadId);
  const inheritedLabels = sourceThread?.labels ?? {};

  if (type === "create_task") {
    // Spawn a task with sourceThreadId (auto-closes thread via XD-005)
    const taskId = await ctx.stores.task.submitDirective(
      description,
      undefined, // correlationId
      undefined, // idempotencyKey
      title,
      description,
      undefined, // dependsOn
      inheritedLabels,
    );

    // Auto-close the thread
    await ctx.stores.thread.closeThread(threadId);

    // Emit directive_issued for the new task (routed by inherited labels)
    await ctx.dispatch("directive_issued", {
      taskId,
      directive: description.substring(0, 200),
      sourceThreadId: threadId,
    }, { roles: ["engineer"], matchLabels: inheritedLabels });

    console.log(`[ThreadPolicy] Auto-spawned task ${taskId} from converged thread ${threadId}`);

  } else if (type === "create_proposal") {
    const proposal = await ctx.stores.proposal.submitProposal(
      title,
      description.substring(0, 200),
      description,
      undefined, // correlationId
      undefined, // executionPlan
      inheritedLabels,
    );

    // Auto-close the thread
    await ctx.stores.thread.closeThread(threadId);

    // Emit proposal_submitted (routed by inherited labels)
    await ctx.dispatch("proposal_submitted", {
      proposalId: proposal.id,
      title: proposal.title,
      summary: proposal.summary,
      proposalRef: proposal.proposalRef,
      sourceThreadId: threadId,
    }, { roles: ["architect"], matchLabels: inheritedLabels });

    console.log(`[ThreadPolicy] Auto-spawned proposal ${proposal.id} from converged thread ${threadId}`);

  } else {
    console.log(`[ThreadPolicy] Unknown convergenceAction type: ${type}`);
  }
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
    "[Any] Reply to an active ideation thread. Only works when it is your turn. Optionally signal convergence or classify the outstanding intent.",
    {
      threadId: z.string().describe("The thread ID to reply to"),
      message: z.string().describe("Your response message"),
      converged: z.boolean().optional().describe("Set to true if you agree with the other party's position"),
      intent: z.enum(["decision_needed", "agreement_pending", "director_input", "implementation_ready"]).optional().describe("Classify what the thread is waiting for (optional)"),
      semanticIntent: z.enum(["seek_rigorous_critique", "seek_approval", "collaborative_brainstorm", "inform", "seek_consensus", "rubber_duck", "educate", "mediate", "post_mortem"]).optional().describe("Communication semantics: how should the recipient frame their response (optional)"),
      convergenceAction: z.object({
        type: z.enum(["create_task", "create_proposal"]).describe("What to auto-spawn on convergence"),
        templateData: z.object({
          title: z.string().describe("Title for the auto-spawned entity"),
          description: z.string().describe("Description for the auto-spawned entity"),
        }).describe("Pre-populated data for the auto-spawned entity"),
      }).optional().describe("Optional late-binding action to execute when the thread converges. Attached by the converging party."),
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
    "[Any] List all ideation threads, optionally filtered by status (active, converged, round_limit, closed).",
    {
      status: z.enum(["active", "converged", "round_limit", "closed"]).optional().describe("Filter threads by status (optional)"),
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
