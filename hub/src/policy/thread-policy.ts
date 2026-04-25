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
import { ThreadConvergenceGateError, CONVERGENCE_GATE_REMEDIATION } from "../state.js";
import type { DomainEvent } from "./types.js";
import { callerLabels } from "./labels.js";
import {
  LIST_PAGINATION_SCHEMA,
  LIST_LABELS_SCHEMA,
  applyLabelFilter,
  paginate,
  buildQueryFilterSchema,
  buildQuerySortSchema,
  applyQueryFilter,
  applyQuerySort,
  type QueryableFieldSpec,
  type FieldAccessors,
} from "./list-filters.js";
import { runCascade } from "./cascade.js";
// Side-effect import: registers per-action-type cascade handlers
// (create_task, create_proposal, create_idea) with the cascade
// registry at module-load time. Adding a new handler type: append
// to cascade-actions/index.ts.
import "./cascade-actions/index.js";
import { validateActionsWithRegistry } from "./action-validators/index.js";
import type { ValidationContext } from "./action-validators/index.js";
import { AUTONOMOUS_STAGED_ACTION_TYPES, checkConvergerAuthority } from "./staged-action-payloads.js";
import { logShadowInvariantBreach } from "../observability/shadow-invariants.js";

// ── Routing Mode Validation (ADR-016, INV-TH18 + INV-TH28) ──────────
/**
 * Enforce routingMode ↔ mode-specific field consistency at thread open.
 * Returns null on valid input, otherwise a caller-facing error string.
 *
 *   - unicast   → recipientAgentId REQUIRED (one-to-one pin), context null
 *   - broadcast → recipientAgentId must be null, context must be null
 *                 (pool-discovery by role+labels; currently coerces to
 *                 unicast on first reply — see ThreadRoutingMode docstring
 *                 for anycast-semantic note)
 *   - multicast → context required with {entityType, entityId},
 *                 recipientAgentId must be null (membership resolved
 *                 dynamically from the bound entity's assignee)
 *
 * ADR-016 change: unicast now REQUIRES recipientAgentId. Callers who
 * want "any engineer matching labels" must explicitly opt in to
 * broadcast — eliminates the multi-agent leakage class that took out
 * the kate↔greg session when an architect opened a thread without
 * pinning a recipient. INV-TH28 pins this invariant.
 */
function validateRoutingModeArgs(
  routingMode: ThreadRoutingMode,
  recipientAgentId: string | null,
  context: ThreadContext | null,
): string | null {
  if (routingMode === "unicast") {
    if (!recipientAgentId) {
      return `routingMode="unicast" requires recipientAgentId — one-to-one dialogue must pin the counterparty. For pool-discovery by role+labels, set routingMode="broadcast" explicitly.`;
    }
    if (context !== null) {
      return `routingMode="unicast" must not set context — context is only for multicast threads.`;
    }
    return null;
  }
  if (routingMode === "broadcast") {
    if (recipientAgentId) {
      return `routingMode="broadcast" must not set recipientAgentId — broadcast is pool-discovery by role/labels, not a pinned target.`;
    }
    if (context !== null) {
      return `routingMode="broadcast" must not set context — context is only for multicast threads.`;
    }
    return null;
  }
  if (routingMode === "multicast") {
    if (!context || typeof context.entityType !== "string" || !context.entityType || typeof context.entityId !== "string" || !context.entityId) {
      return `routingMode="multicast" requires context={entityType, entityId} with non-empty strings.`;
    }
    if (recipientAgentId) {
      return `routingMode="multicast" must not set recipientAgentId — participants resolve from the bound entity's assignee.`;
    }
    return null;
  }
  return `Unknown routingMode "${routingMode}" — expected one of: unicast, broadcast, multicast.`;
}

// ── Handlers ────────────────────────────────────────────────────────

async function createThread(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const title = args.title as string;
  const message = args.message as string;
  const maxRounds = (args.maxRounds as number) || 10;
  const correlationId = args.correlationId as string | undefined;
  const _semanticIntent = args.semanticIntent as string | undefined;
  const recipientAgentId = (args.recipientAgentId as string | undefined) ?? null;
  const routingMode = ((args.routingMode as ThreadRoutingMode | undefined) ?? "unicast");
  const context = (args.context as ThreadContext | undefined) ?? null;

  // Mission-24 Phase 2 (INV-TH18): validate routing mode ↔ mode-specific
  // field consistency before any store mutation. Exactly one targeting
  // channel per mode; inconsistent combinations reject at open.
  const modeError = validateRoutingModeArgs(routingMode, recipientAgentId, context);
  if (modeError) {
    logShadowInvariantBreach("INV-TH18", `routing-mode validation failed on create_thread: ${modeError}`, ctx, {
      extra: { routingMode, hasRecipient: !!recipientAgentId, hasContext: !!context },
    });
    ctx.metrics.increment("create_thread.routing_mode_rejected", {
      routingMode, hasRecipient: !!recipientAgentId, hasContext: !!context,
    });
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

  // ── Mission-51 W1: Message primitive write-through migration shim ──
  // Mirror of the create_thread_reply shim — also project the OPENING
  // message (round 1) into the universal Message namespace so
  // list_messages({threadId}) returns the full ordered conversation.
  // Same idempotency + non-fatal failure semantics as the reply shim
  // (see create_thread_reply for full rationale).
  try {
    const openAuthorRole: "engineer" | "architect" =
      author === "engineer" ? "engineer" : "architect";
    const openAuthorAgentId = authorAgentId ?? `anonymous-${author}`;
    await ctx.stores.message.createMessage({
      kind: "reply",
      authorRole: openAuthorRole,
      authorAgentId: openAuthorAgentId,
      target: null,
      delivery: "push-immediate",
      threadId: thread.id,
      payload: { text: message },
      migrationSourceId: `thread-message:${thread.id}/1`,
    });
    // Mission-51 W2: bump bounded-shadow projection marker (see
    // create_thread_reply for full rationale).
    await ctx.stores.thread.markLastMessageProjected(thread.id, thread.updatedAt);
  } catch (shimErr) {
    ctx.metrics.increment("message_shim.thread_open_write_failed", {
      threadId: thread.id,
      author,
      error: (shimErr as Error)?.message ?? String(shimErr),
    });
    console.warn(
      `[ThreadPolicy] message-shim write-through failed for thread-open ${thread.id}; legacy path remains authoritative:`,
      shimErr,
    );
  }

  // INV-TH16 + ADR-016 INV-TH27: thread open dispatch is always
  // agent-targeted in unicast/multicast modes. Broadcast mode
  // EXPLICITLY opts in to role-pool discovery via the routingMode
  // declaration — no implicit role fallback. The kate↔greg incident
  // (architect opened a thread without pinning recipientAgentId, both
  // engineer sessions received the opener) cannot recur because
  // unicast now rejects at validate time without a recipientAgentId.
  let openSelector;
  if (routingMode === "broadcast") {
    // Explicit pool discovery: architect → any engineer; engineer
    // opens only happen in peer-to-peer contexts which require
    // unicast, so broadcast openers are always from the architect.
    openSelector = {
      roles: [author === "architect" ? "engineer" : "architect"] as ("engineer" | "architect")[],
      matchLabels: thread.labels,
    };
  } else if (recipientAgentId) {
    // unicast with required recipientAgentId (validator enforced).
    // bug-18: NO matchLabels filter — the recipient is explicit, labels
    // MUST NOT gate delivery. thread.labels inherit from the opener
    // (e.g. architect env=prod), which for cross-env unicast (kate
    // env=dev) would silently drop SSE dispatch. The id IS the
    // addressing; pool-filtering is irrelevant when the target is
    // named.
    openSelector = { engineerIds: [recipientAgentId] };
  } else {
    // multicast: participants resolve from bound entity assignee.
    // Today this doesn't yet trigger dynamic resolution (ADR-014 §189
    // deferred), so openers behave as no-op dispatch — thread still
    // persists, no SSE fires. Participant resolution at reply time
    // drives the flow for now.
    openSelector = null;
  }
  if (openSelector) {
    const dispatchPayload: Record<string, unknown> = {
      threadId: thread.id,
      title: thread.title,
      author,
      message: message.substring(0, 200),
      currentTurn: thread.currentTurn,
    };
    // ADR-017 Phase 1.1: enqueue BEFORE SSE AND carry queueItemId INLINE
    // in the SSE payload. Adapters settle directly from the event without
    // needing a separate drain round-trip (eliminates the SSE-vs-drain
    // race observed on thread-138). drain_pending_actions remains the
    // recovery path for items that arrived while the adapter was
    // disconnected. For broadcast/multicast, no single target owes a
    // response (phase-2 scope — no enqueue yet).
    if (routingMode === "unicast" && recipientAgentId) {
      const item = await ctx.stores.pendingAction.enqueue({
        targetAgentId: recipientAgentId,
        dispatchType: "thread_message",
        entityRef: thread.id,
        payload: dispatchPayload,
      });
      dispatchPayload.queueItemId = item.id;
    }
    await ctx.dispatch("thread_message", dispatchPayload, openSelector);
  }

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
  // ADR-017: when present, the caller is settling a queue item. The ACK
  // lands atomically with the reply — if the reply succeeds, the queue
  // item transitions to completion_acked. Missing ID is fine (callers
  // pre-ADR-017 or callers not holding a specific queue item).
  const sourceQueueItemId = (args.sourceQueueItemId as string | undefined) ?? null;

  const callerRole = ctx.stores.engineerRegistry.getRole(ctx.sessionId);
  const author: ThreadAuthor = callerRole === "engineer" ? "engineer" : "architect";
  // Mission-21 Phase 1: resolve the caller's agentId so the store can
  // attach it to the ThreadMessage and upsert into participants[].
  const agent = await (ctx.stores.engineerRegistry as any).getAgentForSession?.(ctx.sessionId).catch(() => null);
  const authorAgentId: string | null = agent?.engineerId ?? null;

  // Phase 2a (task-303, thread-223) — per-action commit authority.
  // When bilateral convergence fires, at least ONE converger must have
  // authority over the staged actions. Architect stamp can be first
  // (architect stages + converges, engineer confirms) or second
  // (engineer stages or converges first, architect confirms). Either
  // shape is valid — what matters is that the architect is part of
  // the consensus for architect-required actions, not which slot they
  // occupy.
  //
  // Check fires ONLY at the bilateral trigger (lastMessageConverged
  // already true + this reply is converged=true). Failing earlier
  // converges would block healthy one-party-commits-first flows.
  if (converged) {
    const existing = await ctx.stores.thread.getThread(threadId);
    const prevConverged = existing?.lastMessageConverged === true;
    if (prevConverged) {
      const stagedEffective = [
        ...(existing?.convergenceActions ?? [])
          .filter((a: any) => a.status === "staged" || a.status === "committed")
          .map((a: any) => a.type as string),
        ...(stagedActions ?? [])
          .filter((op: any) => op?.kind === "stage")
          .map((op: any) => op.type as string),
      ];
      // Collect every role that has signalled converged=true on this
      // thread (including the current caller). At least one of those
      // roles must satisfy the staged-action authority requirement.
      const convergerRoles: Array<"architect" | "engineer" | "director" | "unknown"> = [callerRole as any];
      for (const m of existing?.messages ?? []) {
        if ((m as any).converged === true) {
          convergerRoles.push((m as any).author === "architect" ? "architect" : "engineer");
        }
      }
      const anyAuthorized = convergerRoles.some(
        (role) => checkConvergerAuthority(role, stagedEffective) === null,
      );
      if (!anyAuthorized) {
        const authorityError = checkConvergerAuthority(callerRole as any, stagedEffective);
        ctx.metrics.increment("convergence_gate.rejected", { threadId, subtype: "authority" });
        ctx.metrics.increment("convergence_gate.authority_rejected", {
          threadId, callerRole, stagedEffective,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            success: false,
            error: authorityError,
            subtype: "authority",
            remediation: CONVERGENCE_GATE_REMEDIATION.authority,
          }) }],
          isError: true,
        };
      }

      // ── Phase 2d CP2 C4 (task-307) ───────────────────────────────
      // State-reality validation: fail-fast check that every staged
      // action's referenced entities still exist and are in a
      // transition-permitted state. Runs at the bilateral-convergence
      // trigger only (mirrors authority check scope).
      //
      // Per architect thread-232: gate is a fail-fast optimization;
      // the cascade handler remains the transactional arbiter. Race
      // window between this check and the cascade execution is
      // accepted (handlers recheck; gate just shortens the common
      // failure path).
      const projectedStaged: Array<{ id: string; type: string; status: string; payload: unknown }> = [
        ...(existing?.convergenceActions ?? [])
          .filter((a: any) => a.status === "staged")
          .map((a: any) => ({ id: a.id, type: a.type, status: "staged", payload: a.payload })),
      ];
      // Apply the caller's incoming stage/revise/retract ops so the
      // validator sees the action set as it would look post-commit.
      const incomingStages = (stagedActions ?? []).filter((op: any) => op?.kind === "stage");
      incomingStages.forEach((op: any, i: number) => {
        projectedStaged.push({ id: `pending-${i + 1}`, type: op.type, status: "staged", payload: op.payload });
      });
      const reviseOps = (stagedActions ?? []).filter((op: any) => op?.kind === "revise");
      for (const r of reviseOps as any[]) {
        const idx = projectedStaged.findIndex((a) => a.id === r.id);
        if (idx >= 0) projectedStaged[idx] = { ...projectedStaged[idx], payload: r.payload };
      }
      const retractIds = new Set((stagedActions ?? []).filter((op: any) => op?.kind === "retract").map((op: any) => op.id));
      const filteredProjectedStaged = projectedStaged.filter((a) => !retractIds.has(a.id));

      if (filteredProjectedStaged.length > 0) {
        const validationContext: ValidationContext = {
          task: ctx.stores.task,
          idea: ctx.stores.idea,
          mission: ctx.stores.mission,
          thread: ctx.stores.thread,
          proposal: ctx.stores.proposal,
          turn: ctx.stores.turn,
          bug: ctx.stores.bug,
        };
        const stateValidation = await validateActionsWithRegistry(filteredProjectedStaged, validationContext);
        if (!stateValidation.ok) {
          ctx.metrics.increment("convergence_gate.rejected", { threadId, subtype: stateValidation.subtype });
          logShadowInvariantBreach("INV-TH19", `convergence gate rejected on state-reality check: ${stateValidation.error}`, ctx, {
            relatedEntity: threadId,
            extra: {
              subtype: stateValidation.subtype,
              actionId: stateValidation.actionId,
              actionType: stateValidation.type,
              metadata: stateValidation.metadata,
            },
          });
          const remediation = CONVERGENCE_GATE_REMEDIATION[stateValidation.subtype];
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              success: false,
              error: stateValidation.error,
              subtype: stateValidation.subtype,
              remediation,
              ...(stateValidation.metadata ? { metadata: stateValidation.metadata } : {}),
            }) }],
            isError: true,
          };
        }
        if (stateValidation.noOpActionIds.length > 0) {
          ctx.metrics.increment("convergence_gate.noop_detected", {
            threadId,
            actionIds: stateValidation.noOpActionIds,
          });
        }
      }
    }
  }

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
      // CP2 C2: subtype + remediation are now carried on the error
      // itself — no more message-string parsing at the catch site.
      // Throw sites populate them; policy just echoes them back.
      const { subtype, remediation, message } = err;
      logShadowInvariantBreach("INV-TH19", `convergence gate rejected on create_thread_reply: ${message}`, ctx, {
        relatedEntity: threadId,
        extra: { subtype, converged, authorAgentId },
      });
      ctx.metrics.increment("convergence_gate.rejected", { threadId, subtype });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: false,
          error: message,
          subtype,
          remediation,
        }) }],
        isError: true,
      };
    }
    throw err;
  }

  if (!thread) {
    // CP2 C3 (bug-15): INV-TH17 shadow instrumentation at the policy
    // catch site. `replyToThread` returns null for several reasons
    // (thread not found, not active, role-mismatch, or agent-pinning
    // mismatch). A diagnostic re-read distinguishes the agent-pinning
    // case so the shadow-breach metric fires only for that specific
    // invariant. Cost is one extra store read on the failure side.
    const current = await ctx.stores.thread.getThread(threadId);
    if (
      current &&
      current.status === "active" &&
      current.currentTurn === author &&
      current.currentTurnAgentId &&
      current.currentTurnAgentId !== authorAgentId
    ) {
      logShadowInvariantBreach(
        "INV-TH17",
        `create_thread_reply rejected: agent-pinning violation — caller agentId=${authorAgentId ?? "null"} but thread pins ${current.currentTurnAgentId}`,
        ctx,
        {
          relatedEntity: threadId,
          extra: {
            callerAgentId: authorAgentId,
            pinnedAgentId: current.currentTurnAgentId,
            author,
          },
        },
      );
    }
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: `Thread ${threadId} not found, not active, or not your turn` }) }],
      isError: true,
    };
  }

  // ── Mission-51 W1: Message primitive write-through migration shim ──
  // After the legacy thread-message append (`replyToThread` already
  // wrote `threads/<id>/messages/<seq>.json`), also create a Message
  // entity with `kind=reply` and the migration-source pointer. Both
  // paths are populated during the W1→W6 transition; W2 will
  // normalize the read path; W6 will sunset the legacy inline append.
  //
  // Idempotency: createMessage with a populated `migrationSourceId`
  // does find-or-create — if the same source pointer already maps to
  // a Message, the existing Message is returned and no new write
  // happens. Safe under retry / sweeper-replay.
  //
  // Failure handling: this is a write-through shim, NOT a hard
  // dependency for the reply path. If the Message write fails, log
  // and continue — the legacy thread-message is already persisted,
  // so the reply is visible via the legacy read path. Bug-classes:
  // mirror the cascade-runner's INV-TH26 audit-recoverability stance
  // (audit failures don't block dispatch; here, shadow-write failures
  // don't block the reply response).
  try {
    const replyAuthorRole: "engineer" | "architect" =
      author === "engineer" ? "engineer" : "architect";
    const replyAuthorAgentId = authorAgentId ?? `anonymous-${author}`;
    const sourceSeq = thread.roundCount;
    const sourceId = `${threadId}/${sourceSeq}`;
    await ctx.stores.message.createMessage({
      kind: "reply",
      authorRole: replyAuthorRole,
      authorAgentId: replyAuthorAgentId,
      target: null,
      delivery: "push-immediate",
      threadId,
      payload: { text: message },
      intent: intent ?? undefined,
      semanticIntent: semanticIntent ?? undefined,
      converged,
      migrationSourceId: `thread-message:${sourceId}`,
    });
    // Mission-51 W2: bump bounded-shadow projection marker. Best-effort
    // (forward-progress only); the sweeper is the safety net for races
    // (e.g., a fresh reply landing between this projection and the
    // marker bump). The sweeper sees `lastMessageProjectedAt < updatedAt`
    // and re-projects via findByMigrationSourceId-idempotent createMessage.
    await ctx.stores.thread.markLastMessageProjected(threadId, thread.updatedAt);
  } catch (shimErr) {
    // Non-fatal — shim is write-through; legacy path is authoritative
    // until W2 normalization. Log + metric + continue.
    ctx.metrics.increment("message_shim.thread_reply_write_failed", {
      threadId,
      author,
      error: (shimErr as Error)?.message ?? String(shimErr),
    });
    console.warn(
      `[ThreadPolicy] message-shim write-through failed for thread=${threadId} round=${thread.roundCount}; legacy path remains authoritative:`,
      shimErr,
    );
  }

  // INV-TH16 + ADR-016 INV-TH27: reply dispatch is strictly
  // participant-scoped. The role+label fallback is REMOVED — every
  // post-Phase-1 thread has resolved agentIds by round 2; a reply
  // reaching this point with unresolved participants is an invariant
  // violation, not a condition to tolerate. Throw loudly so the
  // upstream participant-upsert bug is visible instead of papered
  // over by silent role-broadcast leakage.
  if (thread.status === "active") {
    const otherParticipantIds = thread.participants
      .filter((p) => p.agentId && p.agentId !== authorAgentId)
      .map((p) => p.agentId as string);
    if (otherParticipantIds.length === 0) {
      throw new Error(
        `[ThreadPolicy] INV-TH27 violation: thread ${thread.id} reply has no resolved counterparty agentId. All post-Phase-1 threads must have resolved agentIds — participant-upsert chain is broken upstream.`,
      );
    }
    // ADR-017 Phase 1.1: enqueue per-recipient BEFORE SSE AND per-recipient
    // dispatch so each target's queueItemId rides inline on its event
    // payload. Adapters settle directly from the event — no separate drain
    // round-trip needed (eliminates the SSE-vs-drain race). For multi-
    // recipient threads (broadcast-coerced-to-unicast, multicast) each
    // recipient gets its own dispatch with its own queueItemId.
    const basePayload: Record<string, unknown> = {
      threadId: thread.id,
      title: thread.title,
      author,
      message: message.substring(0, 200),
      currentTurn: thread.currentTurn,
    };
    for (const targetId of otherParticipantIds) {
      const item = await ctx.stores.pendingAction.enqueue({
        targetAgentId: targetId,
        dispatchType: "thread_message",
        entityRef: thread.id,
        payload: basePayload,
      });
      // bug-18: per-participant reply dispatch is always pinpoint — the
      // recipient is explicit (resolved from participants[]). No
      // matchLabels filter — see create_thread unicast open for
      // rationale. Cross-env participants (e.g. architect env=prod,
      // engineer env=dev) must receive replies regardless of env
      // mismatch; labels are a filing property, not a delivery gate.
      await ctx.dispatch(
        "thread_message",
        { ...basePayload, queueItemId: item.id },
        { engineerIds: [targetId] },
      );
    }
  }

  // ADR-017 completion ACK: if the caller supplied a sourceQueueItemId,
  // the owed work has been delivered — flip the queue item to
  // completion_acked. Happens AFTER the successful reply persistence so
  // we only ack on observed work-lands.
  //
  // bug-19 / idea-123 (2026-04-20): when sourceQueueItemId is NOT
  // supplied, auto-match by natural key {callerAgentId, threadId,
  // thread_message}. This strips mechanical plumbing from the LLM's
  // reply surface — the LLM expresses cognition (message + optional
  // convergence signals); the Hub handles correlation. Explicit
  // sourceQueueItemId still wins when present (edge cases where a
  // single thread has multiple overlapping queue items for the caller).
  let queueItemToAck: string | null = sourceQueueItemId;
  if (!queueItemToAck && authorAgentId) {
    const autoMatch = await ctx.stores.pendingAction.findOpenByNaturalKey({
      targetAgentId: authorAgentId,
      entityRef: threadId,
      dispatchType: "thread_message",
    });
    if (autoMatch) queueItemToAck = autoMatch.id;
  }
  if (queueItemToAck) {
    await ctx.stores.pendingAction.completionAck(queueItemToAck);
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

// ── M-QueryShape Phase C (idea-119, task-306) ──────────────────────
// Thread-entity field descriptors + accessors. Mirrors list_tasks /
// list_ideas pattern. Nested createdBy.* paths share the C1 convention;
// createdBy.id is computed `${role}:${agentId}`.

const THREAD_FILTERABLE_FIELDS: QueryableFieldSpec = {
  status: { type: "enum", values: ["active", "converged", "round_limit", "closed", "abandoned", "cascade_failed"] },
  routingMode: { type: "enum", values: ["unicast", "broadcast", "multicast"] },
  currentTurn: { type: "string" },
  currentTurnAgentId: { type: "string" },
  roundCount: { type: "number" },
  outstandingIntent: { type: "string" },
  currentSemanticIntent: { type: "string" },
  correlationId: { type: "string" },
  recipientAgentId: { type: "string" },
  createdAt: { type: "date" },
  updatedAt: { type: "date" },
  "createdBy.role": { type: "string" },
  "createdBy.agentId": { type: "string" },
  "createdBy.id": { type: "string" },
};

const THREAD_SORTABLE_FIELDS = [
  "id",
  "status",
  "createdAt",
  "updatedAt",
  "roundCount",
  "currentTurn",
  "routingMode",
  "correlationId",
  "createdBy.role",
  "createdBy.agentId",
  "createdBy.id",
] as const;

const THREAD_ACCESSORS: FieldAccessors<Thread> = {
  id: (t) => t.id,
  status: (t) => t.status,
  routingMode: (t) => t.routingMode,
  currentTurn: (t) => t.currentTurn,
  currentTurnAgentId: (t) => t.currentTurnAgentId ?? null,
  roundCount: (t) => t.roundCount,
  outstandingIntent: (t) => t.outstandingIntent,
  currentSemanticIntent: (t) => t.currentSemanticIntent,
  correlationId: (t) => t.correlationId,
  recipientAgentId: (t) => t.recipientAgentId ?? null,
  createdAt: (t) => t.createdAt,
  updatedAt: (t) => t.updatedAt,
  "createdBy.role": (t) => t.createdBy?.role ?? null,
  "createdBy.agentId": (t) => t.createdBy?.agentId ?? null,
  "createdBy.id": (t) => (t.createdBy ? `${t.createdBy.role}:${t.createdBy.agentId}` : null),
};

const THREAD_FILTER_SCHEMA = buildQueryFilterSchema(THREAD_FILTERABLE_FIELDS);
const THREAD_SORT_SCHEMA = buildQuerySortSchema(THREAD_SORTABLE_FIELDS);

async function listThreads(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  let threads = await ctx.stores.thread.listThreads();
  const totalPreFilter = threads.length;

  // Legacy label match-all filter (pre-QueryShape; preserved).
  threads = applyLabelFilter(threads, args.labels as Record<string, string> | undefined);

  // Backwards-compat: legacy scalar `status` arg subsumed by the new
  // `filter.status` field. filter.status wins when both are present.
  const legacyStatus = typeof args.status === "string" ? args.status : undefined;
  const filterArgRaw = args.filter as Record<string, unknown> | undefined;
  const effectiveFilter: Record<string, unknown> = { ...(filterArgRaw ?? {}) };
  if (legacyStatus && effectiveFilter.status === undefined) {
    effectiveFilter.status = legacyStatus;
  }
  const hasFilter = Object.keys(effectiveFilter).length > 0;

  if (hasFilter) {
    threads = applyQueryFilter(threads, effectiveFilter, THREAD_ACCESSORS);
  }

  const sortArg = args.sort as ReadonlyArray<{ field: string; order: "asc" | "desc" }> | undefined;
  threads = applyQuerySort(threads, sortArg, THREAD_ACCESSORS);

  const postFilterCount = threads.length;

  // Preserve the lightweight summary projection post-filter to keep the
  // wire payload cheap. Heavy fields (messages[], convergenceActions[],
  // participants[]) remain accessible via get_thread.
  const summaries = threads.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    routingMode: t.routingMode,
    currentTurn: t.currentTurn,
    currentTurnAgentId: t.currentTurnAgentId ?? null,
    roundCount: t.roundCount,
    maxRounds: t.maxRounds,
    outstandingIntent: t.outstandingIntent,
    currentSemanticIntent: t.currentSemanticIntent,
    correlationId: t.correlationId,
    recipientAgentId: t.recipientAgentId ?? null,
    createdBy: t.createdBy,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));
  const page = paginate(summaries, args);

  const queryUnmatched = hasFilter && postFilterCount === 0 && totalPreFilter > 0;

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        threads: page.items,
        count: page.count,
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        ...(queryUnmatched ? { _ois_query_unmatched: true } : {}),
      }, null, 2),
    }],
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
 * Phase 2c ckpt-C (idea-117) — administrative thread close.
 *
 * Covers the gap where a thread is structurally stuck (currentTurn =
 * architect, but architect can never reply — e.g., MAX_TOOL_ROUNDS on
 * every attempt) and the normal close_thread path is inaccessible
 * (architect itself in a death spiral; director lacks architect role).
 *
 * Calls the same thread.closeThread primitive, but ALSO abandons any
 * non-terminal queue item for that thread so both the thread state and
 * the queue state transition to terminal atomically. Emits a distinct
 * audit action (`thread_force_closed`) and a Director notification so
 * the intervention is visible downstream.
 *
 * Role-gated at runtime to Architect or Director (inline check, same
 * pattern as prune_stuck_queue_items — the router RoleTag surface
 * doesn't include Director).
 */
async function forceCloseThread(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  // Role-gated at the router via [Architect|Director] tag prefix
  // (Phase 2x P2-6 made director a first-class RBAC role).

  const threadId = args.threadId as string;
  const reason = typeof args.reason === "string" && args.reason.trim().length > 0
    ? args.reason
    : "administrative force-close via force_close_thread";

  const thread = await ctx.stores.thread.getThread(threadId);
  if (!thread) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: `Thread ${threadId} not found` }) }],
      isError: true,
    };
  }

  const success = await ctx.stores.thread.closeThread(threadId);
  if (!success) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: `closeThread failed for ${threadId}` }) }],
      isError: true,
    };
  }

  // Abandon any non-terminal queue items attached to this thread so
  // the queue state matches the thread state. Scans across all
  // architect participants — covers the common case where a single
  // thread has one stuck queue item per recipient.
  const abandonedItems: string[] = [];
  for (const participant of thread.participants ?? []) {
    if (participant.role !== "architect") continue;
    if (!participant.agentId) continue;
    const items = await ctx.stores.pendingAction.listForAgent(participant.agentId);
    for (const item of items) {
      if (item.dispatchType !== "thread_message") continue;
      if (item.entityRef !== threadId) continue;
      if (item.state === "completion_acked" || item.state === "errored" || item.state === "escalated") continue;
      const abandoned = await ctx.stores.pendingAction.abandon(item.id, reason);
      if (abandoned?.state === "errored") abandonedItems.push(item.id);
    }
  }

  const callerRole = ctx.stores.engineerRegistry.getRole(ctx.sessionId);
  await ctx.stores.audit.logEntry(
    "hub",
    "thread_force_closed",
    `Thread ${threadId} administratively force-closed (reason: ${reason}, caller-role: ${callerRole}, abandoned-queue-items: ${abandonedItems.length})`,
    threadId,
  );

  await ctx.stores.directorNotification.create({
    severity: "warning",
    source: "queue_item_escalated",
    sourceRef: threadId,
    title: `Thread ${threadId} force-closed`,
    details: `Administrative force-close via force_close_thread. Reason: ${reason}. ${abandonedItems.length > 0 ? `Abandoned queue items: ${abandonedItems.join(", ")}.` : "No active queue items."}`,
  });

  return {
    content: [{ type: "text" as const, text: JSON.stringify({
      success: true,
      threadId,
      status: "closed",
      reason,
      abandonedQueueItems: abandonedItems,
    }) }],
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
    // Phase 2a (task-303, thread-223): Director notification on cascade
    // failure. Without this, cascade_failed threads were invisible until
    // someone listed threads by status. Severity: critical — human
    // intervention is expected (either retry-cascade once Phase 2c
    // ships, or force_close_thread to discard staged actions). Details
    // include the per-action report so operators can triage which
    // handler(s) broke the cascade.
    const failedReport = cascadeResult.report
      .filter((r) => r.status === "failed")
      .map((r) => `${r.type}/${r.actionId}: ${r.error ?? "unknown error"}`)
      .join("; ");
    await ctx.stores.directorNotification.create({
      severity: "critical",
      source: "cascade_failed",
      sourceRef: threadId,
      title: `Thread ${threadId} cascade_failed — ${cascadeResult.failedCount}/${actions.length} action(s) failed`,
      details: `Thread ${threadId} reached converged=true but the post-convergence cascade failed. Failed actions: ${failedReport}. Thread summary: ${summaryForCascade}. Retry path: Phase 2c retry_cascade tool (not yet shipped); interim path: force_close_thread to discard staged actions.`,
    });
  } else {
    await ctx.stores.thread.closeThread(threadId);
  }

  // INV-TH16 + ADR-016 INV-TH27: finalized dispatch is strictly
  // participant-scoped. Role+label fallback REMOVED — a converged
  // thread without resolved participant agentIds is an invariant
  // violation (every reply carries agentId; convergence is gated on
  // at least 2 replies). Throw so the bug is visible.
  const participantSource = sourceThread.participants
    ?? (payload.participants as Array<{ agentId?: string | null }> | undefined)
    ?? [];
  const cascadeParticipantIds = participantSource
    .map((p) => p.agentId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  if (cascadeParticipantIds.length === 0) {
    throw new Error(
      `[ThreadPolicy] INV-TH27 violation: thread ${threadId} finalized with no resolved participant agentIds. Cascade already executed successfully; the bug is in participant upsert, not in this dispatch.`,
    );
  }

  // Mission-24 Phase 2 (M24-T3, ADR-014): single merged event replacing
  // the legacy pre-cascade thread_converged and post-cascade
  // thread_convergence_completed emissions.
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
  }, { engineerIds: cascadeParticipantIds, matchLabels: inheritedLabels });

  console.log(
    `[ThreadPolicy] Cascade finalized for ${threadId}: ${cascadeResult.executedCount}/${actions.length} executed, ${cascadeResult.failedCount} failed, ${cascadeResult.skippedCount} skipped`,
  );
}

// ── Registration ────────────────────────────────────────────────────

export function registerThreadPolicy(router: PolicyRouter): void {
  router.register(
    "create_thread",
    "[Any] Open a new ideation thread for bidirectional discussion. routingMode (IP-routing terminology per ADR-016) declared at open, immutable for life except broadcast which coerces to unicast on first reply. unicast = one-to-one pinned dialogue (requires recipientAgentId); broadcast = explicit pool-discovery by role+labels (no recipientAgentId); multicast = one-to-group, membership resolved from the bound entity's assignee (requires context). Default is unicast — if you want pool discovery, set routingMode: \"broadcast\" explicitly. Replies always route only to thread.participants[].",
    {
      title: z.string().describe("Short title for the discussion topic"),
      message: z.string().describe("Opening message with your initial thoughts"),
      maxRounds: z.number().optional().describe("Maximum rounds before auto-escalation (default: 10)"),
      correlationId: z.string().optional().describe("Optional correlation ID to link this thread to related tasks/proposals"),
      semanticIntent: z.enum(["seek_rigorous_critique", "seek_approval", "collaborative_brainstorm", "inform", "seek_consensus", "rubber_duck", "educate", "mediate", "post_mortem"]).optional().describe("Communication semantics: how should the recipient frame their response"),
      recipientAgentId: z.string().optional().describe("Targeted routingMode only: pin the open-time thread_message dispatch to this specific agentId. Required for engineer↔engineer threads when ambiguity exists; optional for architect↔engineer threads where role + labels disambiguate."),
      routingMode: z.enum(["unicast", "broadcast", "multicast"]).optional().describe("ADR-016 IP-routing terminology (INV-TH18 + INV-TH28): declared at open, immutable for thread life. unicast = one-to-one pinned dialogue (default; REQUIRES recipientAgentId); broadcast = explicit pool-discovery by role+labels, coerces to unicast on first reply; multicast = one-to-group, membership resolved from bound entity's assignee (requires context)."),
      context: z.object({
        entityType: z.string().describe("Entity type: task | mission | proposal | idea"),
        entityId: z.string().describe("ID of the bound entity"),
      }).optional().describe("Required when routingMode=multicast. PolicyRouter resolves participants dynamically from the bound entity's assignee(s) at each turn."),
    },
    createThread,
  );

  router.register(
    "create_thread_reply",
    "[Any] Reply to an active ideation thread. Only works when it is your turn. Threads 2.0 (ADR-013/014): stage / revise / retract convergenceActions, author a summary narrating the thread's agreed outcome. At converged=true, the policy rejects the reply unless at least one action is committed and the summary is non-empty. Mission-24 Phase 2 widens the stage vocabulary to the 8 autonomous action types — close_no_action, create_task, create_proposal, create_idea, update_idea, update_mission_status, propose_mission, create_clarification — each committed action is executed by a registered cascade handler that spawns its entity with back-link metadata (sourceThreadId, sourceActionId, sourceThreadSummary).",
    {
      threadId: z.string().describe("The thread ID to reply to"),
      message: z.string().describe("Your response message"),
      converged: z.boolean().optional().describe("Set to true if you agree with the other party's position (requires committed convergenceActions + non-empty summary)"),
      intent: z.enum(["decision_needed", "agreement_pending", "director_input", "implementation_ready"]).optional().describe("Classify what the thread is waiting for (optional)"),
      semanticIntent: z.enum(["seek_rigorous_critique", "seek_approval", "collaborative_brainstorm", "inform", "seek_consensus", "rubber_duck", "educate", "mediate", "post_mortem"]).optional().describe("Communication semantics: how should the recipient frame their response (optional)"),
      summary: z.string().optional().describe("Negotiated narrative summary of the thread's agreed outcome. Either party can set or revise across rounds; latest value wins. Required non-empty at convergence."),
      stagedActions: z.array(
        // Mission-24 Phase 2 (M24-T11, ADR-014): 3-arm discriminated
        // union on `kind` with the full 8-type autonomous vocabulary
        // on the `stage` arm. The per-type payload validation is
        // enforced at the gate via validateStagedActions() rather
        // than at the tool layer — a nested discriminatedUnion on
        // (kind, type) is ambiguous (Zod rejects multiple arms
        // sharing the same `kind: "stage"` discriminator), so the
        // tool accepts any well-formed {type, payload} stage op and
        // the gate rejects mismatched shapes with a detailed per-action
        // error list before staged→committed promotion.
        z.discriminatedUnion("kind", [
          z.object({
            kind: z.literal("stage"),
            type: z.enum(AUTONOMOUS_STAGED_ACTION_TYPES).describe("One of the 8 Phase 2 autonomous action types"),
            payload: z.record(z.string(), z.unknown()).describe("Per-type payload — shape validated at the cascade gate (validateStagedActions)"),
          }),
          z.object({
            kind: z.literal("revise"),
            id: z.string().describe("Prior action ID to supersede"),
            payload: z.record(z.string(), z.unknown()).describe("Revised payload — shape must match the prior action's type (validated at gate)"),
          }),
          z.object({
            kind: z.literal("retract"),
            id: z.string().describe("Prior action ID to withdraw"),
          }),
        ]),
      ).optional().describe("Ordered staging operations applied to the thread's convergenceActions[]. stage allocates a new action-N id; revise supersedes a prior id; retract withdraws a prior id."),
      sourceQueueItemId: z.string().optional().describe("ADR-017: when this reply settles a pending-action queue item, pass its id (from drain_pending_actions). The Hub flips the item to completion_acked on successful reply. Omit when replying autonomously (not in response to a queued dispatch)."),
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
    "[Any] List ideation threads with filter + sort + pagination. " +
    "`filter` accepts a Mongo-ish object with implicit AND across fields: " +
    "`{status: 'active'}` for eq, `{status: {$in: ['active','converged']}}` for set membership, " +
    "`{createdAt: {$lt: '2026-04-01T00:00:00Z'}}` for range, `{roundCount: {$gte: 5}}` for numeric range. " +
    "Filterable fields: status, routingMode, currentTurn, currentTurnAgentId, roundCount, outstandingIntent, currentSemanticIntent, correlationId, recipientAgentId, createdAt, updatedAt, " +
    "'createdBy.role', 'createdBy.agentId', 'createdBy.id' (computed `${role}:${agentId}`). " +
    "Range operators ($gt/$lt/$gte/$lte) apply only to dates + numbers. " +
    "Forbidden operators ($regex, $where, $expr, $or, $and, $not) are rejected with an error naming the permitted set. " +
    "`sort` accepts an ordered tuple `[{field, order}]` on: id, status, createdAt, updatedAt, roundCount, currentTurn, routingMode, correlationId, 'createdBy.role', 'createdBy.agentId', 'createdBy.id'. " +
    "Implicit id:asc tie-breaker is appended for deterministic pagination. " +
    "Returns `_ois_query_unmatched: true` when the filter yields zero matches but the collection is non-empty. " +
    "Response is a lightweight summary projection (no messages[], convergenceActions[], or participants[] — use get_thread for those). " +
    "Legacy scalar `status:` arg and `labels:` match-all filter preserved for backwards compat; `filter.status` wins when both status shapes present.",
    {
      filter: THREAD_FILTER_SCHEMA.optional()
        .describe("Mongo-ish filter object; see tool description for permitted fields + operators"),
      sort: THREAD_SORT_SCHEMA
        .describe("Ordered-tuple sort; see tool description for permitted fields"),
      status: z.enum(["active", "converged", "round_limit", "closed", "abandoned", "cascade_failed"]).optional()
        .describe("DEPRECATED: use `filter: { status: ... }`. Preserved for backwards compat; `filter.status` wins when both present."),
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
    "force_close_thread",
    "[Architect|Director] idea-117 Phase 2c admin: force-close a structurally stuck thread. Distinct from close_thread — atomically abandons any non-terminal queue items for the thread, and emits a distinct audit action (thread_force_closed) + Director notification. Use when the architect cannot itself close the thread (e.g., MAX_TOOL_ROUNDS death spiral) or when director-level intervention is needed for queue-stuck threads.",
    {
      threadId: z.string().describe("The thread ID to force-close"),
      reason: z.string().optional().describe("Human-readable reason for the force-close; persisted on the audit entry and Director notification"),
    },
    forceCloseThread,
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
