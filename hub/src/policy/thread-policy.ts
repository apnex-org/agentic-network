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
import type { ThreadAuthor, ThreadIntent, StagedAction, StagedActionOp, Thread, ThreadRoutingMode, ThreadContext } from "../state.js";
import { ThreadConvergenceGateError } from "../state.js";
import type { DomainEvent } from "./types.js";
import { callerLabels } from "./labels.js";
import { LIST_PAGINATION_SCHEMA, LIST_LABELS_SCHEMA, applyLabelFilter, paginate } from "./list-filters.js";
import { runCascade } from "./cascade.js";
// Side-effect import: registers per-action-type cascade handlers
// (create_task, create_proposal, create_idea) with the cascade
// registry at module-load time. Adding a new handler type: append
// to cascade-actions/index.ts.
import "./cascade-actions/index.js";

// ── Routing Mode Validation (M24-T2, INV-TH18) ──────────────────────
/**
 * Enforce routingMode ↔ mode-specific field consistency at thread open.
 * Returns null on valid input, otherwise a caller-facing error string.
 *
 *   - targeted       → recipientAgentId optional (pin), context must be null
 *   - broadcast      → recipientAgentId must be null, context must be null
 *   - context_bound  → context required with {entityType, entityId},
 *                      recipientAgentId must be null
 */
function validateRoutingModeArgs(
  routingMode: ThreadRoutingMode,
  recipientAgentId: string | null,
  context: ThreadContext | null,
): string | null {
  if (routingMode === "targeted") {
    if (context !== null) {
      return `routingMode="targeted" must not set context — context is only for context_bound threads.`;
    }
    return null;
  }
  if (routingMode === "broadcast") {
    if (recipientAgentId) {
      return `routingMode="broadcast" must not set recipientAgentId — broadcast is pool-discovery by role/labels, not a pinned target.`;
    }
    if (context !== null) {
      return `routingMode="broadcast" must not set context — context is only for context_bound threads.`;
    }
    return null;
  }
  if (routingMode === "context_bound") {
    if (!context || typeof context.entityType !== "string" || !context.entityType || typeof context.entityId !== "string" || !context.entityId) {
      return `routingMode="context_bound" requires context={entityType, entityId} with non-empty strings.`;
    }
    if (recipientAgentId) {
      return `routingMode="context_bound" must not set recipientAgentId — participants resolve from the bound entity's assignee.`;
    }
    return null;
  }
  return `Unknown routingMode "${routingMode}" — expected one of: targeted, broadcast, context_bound.`;
}

// ── Handlers ────────────────────────────────────────────────────────

async function createThread(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const title = args.title as string;
  const message = args.message as string;
  const maxRounds = (args.maxRounds as number) || 10;
  const correlationId = args.correlationId as string | undefined;
  const _semanticIntent = args.semanticIntent as string | undefined;
  const recipientAgentId = (args.recipientAgentId as string | undefined) ?? null;
  const routingMode = ((args.routingMode as ThreadRoutingMode | undefined) ?? "targeted");
  const context = (args.context as ThreadContext | undefined) ?? null;

  // Mission-24 Phase 2 (INV-TH18): validate routing mode ↔ mode-specific
  // field consistency before any store mutation. Exactly one targeting
  // channel per mode; inconsistent combinations reject at open.
  const modeError = validateRoutingModeArgs(routingMode, recipientAgentId, context);
  if (modeError) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: modeError }) }],
      isError: true,
    };
  }

  const callerRole = ctx.stores.engineerRegistry.getRole(ctx.sessionId);
  const author: ThreadAuthor = callerRole === "engineer" ? "engineer" : "architect";
  // Mission-19: propagate caller's Agent labels onto the new Thread.
  const labels = await callerLabels(ctx);
  // Mission-21 Phase 1: resolve the caller's agentId so openThread can
  // seed the participants[] array with a full {role, agentId} entry.
  const agent = await (ctx.stores.engineerRegistry as any).getAgentForSession?.(ctx.sessionId).catch(() => null);
  const authorAgentId: string | null = agent?.engineerId ?? null;
  // INV-TH17: when the opener pinned a recipientAgentId, resolve that
  // agent's role from the registry so openThread can set currentTurn
  // correctly — otherwise engineer↔engineer threads would incorrectly
  // flip to "architect" via the legacy formula.
  let recipientRole: ThreadAuthor | null = null;
  if (recipientAgentId) {
    const recipientAgent = await (ctx.stores.engineerRegistry as any).getAgent?.(recipientAgentId).catch(() => null);
    if (recipientAgent && (recipientAgent.role === "architect" || recipientAgent.role === "engineer")) {
      recipientRole = recipientAgent.role;
    }
  }
  const thread = await ctx.stores.thread.openThread(title, message, author, {
    maxRounds,
    correlationId,
    labels,
    authorAgentId,
    recipientAgentId,
    recipientRole,
    routingMode,
    context,
  });

  // Mission-21 Phase 1 (INV-TH16): when the opener named a specific
  // recipientAgentId, pin the open-time dispatch to that agent so
  // other agents sharing the role/labels don't get spammed. This is
  // the only way engineer↔engineer threads achieve isolation on the
  // first notification (before participants[] carries both parties).
  // Without recipientAgentId we preserve legacy role+label broadcast.
  const openSelector = recipientAgentId
    ? { engineerIds: [recipientAgentId], matchLabels: thread.labels }
    : { roles: [author === "architect" ? "engineer" : "architect"] as any, matchLabels: thread.labels };
  await ctx.dispatch("thread_message", {
    threadId: thread.id,
    title: thread.title,
    author,
    message: message.substring(0, 200),
    currentTurn: thread.currentTurn,
  }, openSelector);

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

  // Notify the other participants (unless thread just converged or hit limit).
  // Mission-21 Phase 1 (INV-TH16): dispatch is participant-scoped —
  // every non-author participant with a known agentId gets the event,
  // nobody else. Agents that joined via legacy (pre-M18) handshake
  // carry agentId=null; if every participant is pre-M18 we fall back
  // to role broadcast so the thread still progresses.
  if (thread.status === "active") {
    const otherParticipantIds = thread.participants
      .filter((p) => p.agentId && p.agentId !== authorAgentId)
      .map((p) => p.agentId as string);
    const replySelector = otherParticipantIds.length > 0
      ? { engineerIds: otherParticipantIds, matchLabels: thread.labels }
      : { roles: [author === "architect" ? "engineer" : "architect"] as any, matchLabels: thread.labels };
    await ctx.dispatch("thread_message", {
      threadId: thread.id,
      title: thread.title,
      author,
      message: message.substring(0, 200),
      currentTurn: thread.currentTurn,
    }, replySelector);
  }

  // Mission-21: push an internal cascade event on convergence so the
  // committed actions can be executed in array order.
  // Mission-24 Phase 2 (M24-T3, ADR-014): the two-event split
  // (thread_converged synchronous + thread_convergence_completed
  // post-cascade) is merged into one thread_convergence_finalized
  // event dispatched AFTER the cascade runs, carrying the full
  // ConvergenceReport. Consumers no longer have to reconstruct the
  // outcome from two events. The public dispatch now lives in the
  // handleThreadConvergedWithAction handler below.
  if (thread.status === "converged") {
    const committed = thread.convergenceActions.filter((a) => a.status === "committed");
    if (committed.length > 0) {
      ctx.internalEvents.push({
        type: "thread_converged_with_action",
        payload: {
          threadId: thread.id,
          title: thread.title,
          intent: thread.outstandingIntent,
          summary: thread.summary,
          actions: committed,
          participants: thread.participants,
          labels: thread.labels,
        },
      });
    }
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

/**
 * Mission-24 Phase 2 (M24-T6, ADR-014): participant-initiated exit
 * from an active thread. Unlike close_thread (Architect stewardship),
 * leave_thread is callable by any Thread participant and is the
 * counterpart to bilateral convergence for the abandonment case —
 * "one party wants out; no point holding the thread open for a
 * convergence that will never come."
 *
 * Side-effects: store transitions `active → abandoned`, auto-retracts
 * the leaver's staged actions, stamps updatedAt. Handler then dispatches
 * `thread_abandoned` participant-scoped (INV-TH16) to the remaining
 * participants so they can react; writes audit entry with actor=leaver.
 */
async function leaveThread(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const threadId = args.threadId as string;
  const reason = (args.reason as string | undefined) ?? null;

  // Resolve caller's agentId. Without an M18 agentId we can't verify
  // participant membership — leave_thread requires a resolved identity.
  const agent = await (ctx.stores.engineerRegistry as any).getAgentForSession?.(ctx.sessionId).catch(() => null);
  const leaverAgentId: string | null = agent?.engineerId ?? null;
  if (!leaverAgentId) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "leave_thread requires an M18-resolved agentId; caller session has no bound Agent" }) }],
      isError: true,
    };
  }

  const updated = await ctx.stores.thread.leaveThread(threadId, leaverAgentId);
  if (!updated) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: `leave_thread rejected for ${threadId}: thread not found, not active, or caller is not a participant` }) }],
      isError: true,
    };
  }

  // INV-TH16: dispatch thread_abandoned only to the remaining
  // participants (excluding the leaver). Architect is NOT notified
  // unless they were already on the participants list.
  const remainingParticipantIds = updated.participants
    .filter((p) => p.agentId && p.agentId !== leaverAgentId)
    .map((p) => p.agentId as string);
  if (remainingParticipantIds.length > 0) {
    await ctx.dispatch("thread_abandoned", {
      threadId: updated.id,
      title: updated.title,
      leaverAgentId,
      reason: reason ?? "(no reason provided)",
      retractedActionCount: updated.convergenceActions.filter((a) => a.status === "retracted" && a.proposer.agentId === leaverAgentId).length,
    }, { engineerIds: remainingParticipantIds, matchLabels: updated.labels });
  }

  await ctx.stores.audit.logEntry(
    "hub",
    "thread_abandoned",
    `Thread ${threadId} abandoned by ${leaverAgentId}. Reason: ${reason ?? "(no reason provided)"}. ${updated.convergenceActions.filter((a) => a.status === "retracted" && a.proposer.agentId === leaverAgentId).length} staged action(s) retracted.`,
    threadId,
  );

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        success: true,
        threadId: updated.id,
        status: updated.status,
        leaverAgentId,
        remainingParticipants: updated.participants
          .filter((p) => p.agentId !== leaverAgentId)
          .map((p) => ({ role: p.role, agentId: p.agentId })),
        retractedActionCount: updated.convergenceActions.filter((a) => a.status === "retracted" && a.proposer.agentId === leaverAgentId).length,
      }),
    }],
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
  const title = (payload.title as string) ?? "";
  const intent = (payload.intent as string | null) ?? null;
  const summary = (payload.summary as string) ?? "";
  const actions = payload.actions as StagedAction[] | undefined;

  if (!Array.isArray(actions) || actions.length === 0) {
    console.log(`[ThreadPolicy] thread_converged_with_action: no actions to cascade for thread ${threadId}`);
    return;
  }

  const sourceThread = await ctx.stores.thread.getThread(threadId);
  if (!sourceThread) {
    console.error(`[ThreadPolicy] Cascade aborted: thread ${threadId} not found post-convergence`);
    return;
  }
  const inheritedLabels = sourceThread.labels ?? (payload.labels as Record<string, string> | undefined) ?? {};
  // Include the thread's negotiated summary in audit details — Director
  // notification-A digest surfaces hub/architect audit entries and this
  // gives the human reader the actors' narrative without needing to
  // look the thread up separately.
  const summaryForCascade = summary.trim() || sourceThread.summary?.trim() || "(no summary provided)";

  // Mission-24 Phase 2 (M24-T4, INV-TH19): validate-then-execute
  // cascade. Validate phase already ran inside the store gate; this
  // is the async execute phase. Handlers are registered by type in
  // cascade.ts; each produces its own ConvergenceReportEntry with
  // executed/failed/skipped_idempotent status. "Committed means
  // committed" — per-action failures DO NOT abort the remaining
  // actions; each gets its attempt, and the thread terminal
  // classifies on the aggregate.
  const cascadeResult = await runCascade(ctx, sourceThread, actions, summaryForCascade);

  // Terminal transition per ADR-014 INV-TH19: any handler failure →
  // cascade_failed (audit + terminal); all succeeded/skipped → closed.
  if (cascadeResult.anyFailure) {
    await ctx.stores.thread.markCascadeFailed(threadId);
    await ctx.stores.audit.logEntry(
      "hub",
      "thread_cascade_failed",
      `Thread ${threadId} cascade_failed: ${cascadeResult.failedCount}/${actions.length} handler failure(s). Summary: ${summaryForCascade}.`,
      threadId,
    );
  } else {
    await ctx.stores.thread.closeThread(threadId);
  }

  // INV-TH16: cascade completion is participant-internal. Scope to thread
  // participants so engineer↔engineer threads don't notify unrelated roles.
  const participantSource = sourceThread.participants
    ?? (payload.participants as Array<{ agentId?: string | null }> | undefined)
    ?? [];
  const cascadeParticipantIds = participantSource
    .map((p) => p.agentId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const finalizedSelector = cascadeParticipantIds.length > 0
    ? { engineerIds: cascadeParticipantIds, matchLabels: inheritedLabels }
    : { roles: ["architect" as const, "engineer" as const], matchLabels: inheritedLabels };

  // Mission-24 Phase 2 (M24-T3, ADR-014): single merged event replacing
  // the legacy pre-cascade thread_converged and post-cascade
  // thread_convergence_completed emissions. Consumers get the full
  // ConvergenceReport in one delivery.
  await ctx.dispatch("thread_convergence_finalized", {
    threadId,
    title,
    intent,
    summary,
    committedActionCount: actions.length,
    executedCount: cascadeResult.executedCount,
    failedCount: cascadeResult.failedCount,
    skippedCount: cascadeResult.skippedCount,
    warning: cascadeResult.anyFailure,
    threadTerminal: cascadeResult.anyFailure ? "cascade_failed" : "closed",
    report: cascadeResult.report,
  }, finalizedSelector);

  console.log(
    `[ThreadPolicy] Cascade finalized for ${threadId}: ${cascadeResult.executedCount}/${actions.length} executed, ${cascadeResult.failedCount} failed, ${cascadeResult.skippedCount} skipped`,
  );
}

// ── Registration ────────────────────────────────────────────────────

export function registerThreadPolicy(router: PolicyRouter): void {
  router.register(
    "create_thread",
    "[Any] Open a new ideation thread for bidirectional discussion. routingMode (Targeted / Broadcast / Context-bound) is declared at open and immutable for life — except Broadcast, which coerces to Targeted on first reply. Targeted pins via recipientAgentId; Broadcast discovers a responder by role/labels; Context-bound binds the thread to an entity so participants follow the entity's assignee. Omit routingMode for the default (targeted) + legacy call-path behaviour. Replies always route only to thread.participants[].",
    {
      title: z.string().describe("Short title for the discussion topic"),
      message: z.string().describe("Opening message with your initial thoughts"),
      maxRounds: z.number().optional().describe("Maximum rounds before auto-escalation (default: 10)"),
      correlationId: z.string().optional().describe("Optional correlation ID to link this thread to related tasks/proposals"),
      semanticIntent: z.enum(["seek_rigorous_critique", "seek_approval", "collaborative_brainstorm", "inform", "seek_consensus", "rubber_duck", "educate", "mediate", "post_mortem"]).optional().describe("Communication semantics: how should the recipient frame their response"),
      recipientAgentId: z.string().optional().describe("Targeted routingMode only: pin the open-time thread_message dispatch to this specific agentId. Required for engineer↔engineer threads when ambiguity exists; optional for architect↔engineer threads where role + labels disambiguate."),
      routingMode: z.enum(["targeted", "broadcast", "context_bound"]).optional().describe("Mission-24 Phase 2 (INV-TH18): declared at open, immutable for thread life. targeted=pinned dialogue (default); broadcast=pool-discovery by role/labels, coerces to targeted on first reply; context_bound=thread bound to an entity (requires context)."),
      context: z.object({
        entityType: z.string().describe("Entity type: task | mission | proposal | idea"),
        entityId: z.string().describe("ID of the bound entity"),
      }).optional().describe("Required when routingMode=context_bound. PolicyRouter resolves participants dynamically from the bound entity's assignee(s) at each turn."),
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
      status: z.enum(["active", "converged", "round_limit", "closed", "abandoned", "cascade_failed"]).optional().describe("Filter threads by status (optional)"),
      ...LIST_LABELS_SCHEMA,
      ...LIST_PAGINATION_SCHEMA,
    },
    listThreads,
  );

  router.register(
    "close_thread",
    "[Architect] Close an ideation thread as administrative stewardship. Distinct from `leave_thread` (participant-initiated abandonment) and from the cascade-driven close after bilateral convergence — use `close_thread` for stranded threads with no living participant, or for threads that need to be terminated outside the normal convergence flow.",
    { threadId: z.string().describe("The thread ID to close") },
    closeThread,
  );

  router.register(
    "leave_thread",
    "[Any] Participant-initiated exit from an active thread. Counterpart to bilateral convergence for the 'I want out' case. Caller MUST be a current participant. On call: auto-retracts the leaver's staged convergence actions, transitions the thread to the `abandoned` terminal state, dispatches `thread_abandoned` to remaining participants (not architect unless participant), writes an audit entry. Use this when the convergence will never come (peer unresponsive, change of plans, scope discovered) — it's the anti-deadlock primitive for P2P threads.",
    {
      threadId: z.string().describe("The thread ID to leave"),
      reason: z.string().optional().describe("Optional short explanation of why you're leaving — surfaces on the thread_abandoned event and the audit entry"),
    },
    leaveThread,
  );

  // ── Internal Event Handlers ─────────────────────────────────────
  router.onInternalEvent("thread_converged_with_action", handleThreadConvergedWithAction);
}
