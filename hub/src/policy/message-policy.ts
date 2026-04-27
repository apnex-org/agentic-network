/**
 * MessagePolicy — mission-51 W6 final wave.
 *
 * Surfaces `list_messages` + `create_message` MCP verbs. Per
 * mission-51 brief scope clarification: W6 ships uniformization at
 * the consumer layer — full public-API verb redesign (parameter
 * envelopes, error semantics) defers to idea-121 / API v2.0. These
 * verbs are the migration target; callers migrate; verb redesign
 * is a separate mission.
 *
 * Author authorization is gated via `checkAuthorAuthorized` from
 * the W1 entity layer. Three-axis kind taxonomy enforced:
 *   - `requires_turn`: not enforced at this layer (thread-policy is
 *     the enforcement boundary for turn ownership; create_message
 *     here is for non-thread or non-reply messages).
 *   - `shifts_turn`: same.
 *   - `authorized_authors`: enforced — directors-only kinds reject
 *     non-director callers; self-only kinds require priorAuthorAgentId.
 *
 * For thread-bound replies, callers should continue using
 * `create_thread_reply` (which write-throughs to the message store
 * via the W1+W2 migration shim). `create_message` here is for
 * non-thread or non-reply kinds (notes, external-injection,
 * urgency-flags, amendments).
 *
 * ADR-025 ratifies the message-primitive sovereign-workflow-entity
 * contract; this policy file is the public surface.
 */

import { z } from "zod";

import type { PolicyRouter } from "./router.js";
import type { IPolicyContext, PolicyResult } from "./types.js";
import type { Selector } from "../state.js";
import {
  MESSAGE_KINDS,
  MESSAGE_AUTHOR_ROLES,
  MESSAGE_DELIVERY_MODES,
  MESSAGE_STATUSES,
  KIND_AXES,
  checkAuthorAuthorized,
  type MessageKind,
  type MessageAuthorRole,
  type MessageStatus,
  type MessageDelivery,
  type MessageTarget,
  type CreateMessageInput,
} from "../entities/index.js";

// ── list_messages ────────────────────────────────────────────────────

async function listMessages(
  args: Record<string, unknown>,
  ctx: IPolicyContext,
): Promise<PolicyResult> {
  const threadId = args.threadId as string | undefined;
  const targetRole = args.targetRole as MessageAuthorRole | undefined;
  const targetAgentId = args.targetAgentId as string | undefined;
  const authorAgentId = args.authorAgentId as string | undefined;
  const status = args.status as MessageStatus | undefined;
  const delivery = args.delivery as MessageDelivery | undefined;
  const since = args.since as string | undefined;

  try {
    const messages = await ctx.stores.message.listMessages({
      threadId,
      targetRole,
      targetAgentId,
      authorAgentId,
      status,
      delivery,
      since,
    });
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              messages,
              count: messages.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: `list_messages failed: ${(err as Error)?.message ?? String(err)}`,
          }),
        },
      ],
      isError: true,
    };
  }
}

// ── create_message ───────────────────────────────────────────────────

async function createMessage(
  args: Record<string, unknown>,
  ctx: IPolicyContext,
): Promise<PolicyResult> {
  const kind = args.kind as MessageKind;
  const target = args.target as MessageTarget | null;
  const delivery = (args.delivery as MessageDelivery | undefined) ?? "push-immediate";
  const payload = args.payload;
  const intent = args.intent as string | undefined;
  const semanticIntent = args.semanticIntent as string | undefined;
  const fireAt = args.fireAt as string | undefined;
  const precondition = args.precondition;
  const priorAuthorAgentId = args.priorAuthorAgentId as string | undefined;

  // Resolve caller identity from policy context.
  const callerRole = ctx.stores.engineerRegistry.getRole(ctx.sessionId);
  const authorRole: MessageAuthorRole =
    callerRole === "engineer"
      ? "engineer"
      : callerRole === "director"
        ? "director"
        : "architect"; // architect is the default fallback for system-callers
  const agent = await (ctx.stores.engineerRegistry as any).getAgentForSession?.(
    ctx.sessionId,
  ).catch(() => null);
  const authorAgentId: string =
    agent?.agentId ?? `anonymous-${authorRole}`;

  // Author authorization gate per W1's checkAuthorAuthorized helper.
  const authError = checkAuthorAuthorized(
    kind,
    authorRole,
    authorAgentId,
    priorAuthorAgentId,
  );
  if (authError !== null) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: authError,
            subtype: "authorization",
            kind,
            callerRole: authorRole,
          }),
        },
      ],
      isError: true,
    };
  }

  // Scheduled messages require fireAt.
  if (delivery === "scheduled" && !fireAt) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: "delivery: 'scheduled' requires fireAt (ISO-8601 timestamp)",
            subtype: "validation",
          }),
        },
      ],
      isError: true,
    };
  }

  const input: CreateMessageInput = {
    kind,
    authorRole,
    authorAgentId,
    target,
    delivery,
    payload,
    intent,
    semanticIntent,
    fireAt,
    precondition,
  };

  try {
    const message = await ctx.stores.message.createMessage(input);

    // Mission-56 W1a: push-on-Message-create (Design v1.2 commitment #1).
    // After successful Message commit, fire an SSE event so active
    // subscribers matching the target receive the Message inline. The
    // Message is already persisted at this point; dispatch failure is
    // logged non-fatal (cold reconnect-replay arrives in W1b; poll
    // backstop in W3 — both recover any pushed-but-undelivered events).
    //
    // Subscriber resolution maps MessageTarget → Selector:
    //   target.role        → selector.roles = [target.role]
    //   target.agentId     → selector.agentId = target.agentId
    //   target == null     → empty selector (broadcast to all online)
    //   delivery !== "push-immediate" → no fire (queued + scheduled
    //                                   land on poll backstop / sweeper)
    //
    // Event payload: inline Message envelope (sub-1KB typical).
    // Event id semantic: Message ID (ULID-monotonic) — forward-compatible
    // with W1b Last-Event-ID protocol where SSE `id:` field carries this
    // for replay-cursor semantics.
    if (message.delivery === "push-immediate") {
      try {
        const selector: Selector = pushSelector(target);
        await ctx.dispatch("message_arrived", { message }, selector);
      } catch (err) {
        // Non-fatal: Message commits regardless of push delivery success.
        // Adapter recovers via cold reconnect-replay (W1b) or poll
        // backstop (W3). Log captures the failure for diagnostic
        // observability without affecting the create_message ACK.
        console.error(
          `[message-policy] push-on-create dispatch failed for ${message.id} (non-fatal): ${(err as Error)?.message ?? String(err)}`,
        );
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              messageId: message.id,
              kind: message.kind,
              status: message.status,
              scheduledState: message.scheduledState,
              createdAt: message.createdAt,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: `create_message failed: ${(err as Error)?.message ?? String(err)}`,
          }),
        },
      ],
      isError: true,
    };
  }
}

// ── claim_message + ack_message (mission-56 W3.2) ────────────────────

/**
 * Resolve the caller's agentId from the policy context (the same shape
 * used by createMessage for authorRole/authorAgentId resolution). Used
 * by claim_message to populate Message.claimedBy with the winning agent.
 */
async function resolveCallerAgentId(ctx: IPolicyContext): Promise<string> {
  const callerRole = ctx.stores.engineerRegistry.getRole(ctx.sessionId);
  const fallbackRole: MessageAuthorRole =
    callerRole === "engineer"
      ? "engineer"
      : callerRole === "director"
        ? "director"
        : "architect";
  const agent = await (ctx.stores.engineerRegistry as any).getAgentForSession?.(
    ctx.sessionId,
  ).catch(() => null);
  return agent?.agentId ?? `anonymous-${fallbackRole}`;
}

async function claimMessage(
  args: Record<string, unknown>,
  ctx: IPolicyContext,
): Promise<PolicyResult> {
  const id = args.id as string | undefined;
  if (!id) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: "claim_message requires `id` (Message ULID)",
            subtype: "validation",
          }),
        },
      ],
      isError: true,
    };
  }

  try {
    const claimerAgentId = await resolveCallerAgentId(ctx);
    const message = await ctx.stores.message.claimMessage(id, claimerAgentId);
    if (!message) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: `claim_message: Message ${id} not found`,
              subtype: "not_found",
            }),
          },
        ],
        isError: true,
      };
    }
    // Caller observes outcome via the returned Message:
    //   message.claimedBy === claimerAgentId → won the claim
    //   message.claimedBy !== claimerAgentId → lost (silent-drop in adapter)
    //   message.status === "acked"           → claim too late (already acked)
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              message,
              wonClaim:
                message.status === "received" &&
                message.claimedBy === claimerAgentId,
              callerAgentId: claimerAgentId,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: `claim_message failed: ${(err as Error)?.message ?? String(err)}`,
          }),
        },
      ],
      isError: true,
    };
  }
}

async function ackMessage(
  args: Record<string, unknown>,
  ctx: IPolicyContext,
): Promise<PolicyResult> {
  const id = args.id as string | undefined;
  if (!id) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: "ack_message requires `id` (Message ULID)",
            subtype: "validation",
          }),
        },
      ],
      isError: true,
    };
  }

  try {
    const message = await ctx.stores.message.ackMessage(id);
    if (!message) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: `ack_message: Message ${id} not found`,
              subtype: "not_found",
            }),
          },
        ],
        isError: true,
      };
    }
    // Mission-57 W2 Item-2 webhook composition: when a pulse Message
    // (kind=external-injection + payload.pulseKind === "status_check")
    // transitions to acked, invoke the registered PulseSweeper hook so
    // it can reset missedCount + update lastResponseAt. Fire-and-forget;
    // hook errors are non-fatal (logged + swallowed; ack itself succeeds).
    if (
      message.status === "acked" &&
      typeof (message.payload as { pulseKind?: unknown })?.pulseKind === "string" &&
      (message.payload as { pulseKind: string }).pulseKind === "status_check"
    ) {
      try {
        await ctx.stores.pulseSweeper?.onPulseAcked(message);
      } catch (err) {
        console.warn(
          `[message-policy] pulseSweeper.onPulseAcked failed for ${message.id} (non-fatal):`,
          err,
        );
      }
    }

    // Caller observes outcome via message.status:
    //   "acked"    → ack succeeded (or idempotent on already-acked)
    //   "received" → unexpected (CAS lost a race; caller can retry)
    //   "new"      → must claim first (FSM-violation observation)
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              message,
              acked: message.status === "acked",
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: `ack_message failed: ${(err as Error)?.message ?? String(err)}`,
          }),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Map a MessageTarget to a dispatch Selector for SSE push delivery.
 * - `target == null` → empty selector (broadcast to all online agents)
 * - `target.role` (architect/engineer/director) → selector.roles
 * - `target.role === "system"` → role filter omitted (no Agent has the
 *   "system" role; "system"-targeted Messages are Hub-internal and
 *   shouldn't push to live subscribers)
 * - `target.agentId` → selector.agentId (single-agent pin)
 *
 * Both role + agentId together produce an AND filter (only the agent
 * with that agentId AND in that role). Mission-19 selector
 * semantics apply.
 *
 * Exported for unit testing.
 */
export function pushSelector(target: MessageTarget | null): Selector {
  if (target == null) return {};
  const sel: Selector = {};
  if (target.role && target.role !== "system") {
    sel.roles = [target.role];
  }
  if (target.agentId) sel.agentId = target.agentId;
  return sel;
}

// ── Registration ─────────────────────────────────────────────────────

export function registerMessagePolicy(router: PolicyRouter): void {
  router.register(
    "list_messages",
    "[Any] List messages from the sovereign Message store with multi-membership query primitives. " +
      "Supply any combination of `threadId` (thread view, ordered by sequenceInThread), " +
      "`targetRole` + `targetAgentId` (inbox view), `authorAgentId` (outbox view), " +
      "`status` ('new' | 'acked'), `delivery` ('push-immediate' | 'queued' | 'scheduled'), " +
      "`since` (ULID-cursor; return only messages with `id > since` — strict). " +
      "Multi-membership: a single message belongs to thread + inbox + outbox simultaneously. " +
      "Cursor semantics (mission-56 W3.1): Message IDs are ULIDs (lex-order = time-order); " +
      "passing the last-seen Message ID as `since` returns only the delta. Powers the adapter-side " +
      "hybrid poll-backstop (Design v1.2 commitment #5) and shares cursor semantics with the " +
      "SSE Last-Event-ID protocol (W1b).",
    {
      threadId: z
        .string()
        .optional()
        .describe("Filter to a specific thread; results ordered by sequenceInThread"),
      targetRole: z
        .enum(MESSAGE_AUTHOR_ROLES)
        .optional()
        .describe("Filter to messages targeted at this role"),
      targetAgentId: z
        .string()
        .optional()
        .describe("Filter to messages targeted at this specific agentId"),
      authorAgentId: z
        .string()
        .optional()
        .describe("Filter to messages authored by this agentId (outbox view)"),
      status: z
        .enum(MESSAGE_STATUSES)
        .optional()
        .describe("Filter by recipient-ack status"),
      delivery: z
        .enum(MESSAGE_DELIVERY_MODES)
        .optional()
        .describe("Filter by delivery mode"),
      since: z
        .string()
        .optional()
        .describe(
          "ULID-cursor (strict): return only messages with id > since. " +
            "Adapter-side hybrid poll-backstop persists last-seen Message ID and " +
            "passes it here to fetch only the delta on each poll-tick. " +
            "Combines with all other filters via AND.",
        ),
    },
    listMessages,
  );

  // Build kind enumeration for tool description.
  const kindAxesSummary = MESSAGE_KINDS.map((k) => {
    const a = KIND_AXES[k];
    return `${k} (requires_turn=${a.requires_turn}, shifts_turn=${a.shifts_turn}, authors=${a.authorized_authors})`;
  }).join("; ");

  router.register(
    "create_message",
    `[Any] Create a sovereign Message directly (escapes the legacy thread-reply / notification-emit / pending-action paths). ` +
      `For thread-bound replies, prefer create_thread_reply (which write-throughs to the message store). ` +
      `Author authorization enforced per kind axes: ${kindAxesSummary}. ` +
      `Self-only kinds (amendment) require priorAuthorAgentId; director-only kinds (urgency-flag) reject non-director callers. ` +
      `Scheduled delivery requires fireAt (ISO-8601 timestamp); precondition is optional.`,
    {
      kind: z.enum(MESSAGE_KINDS).describe("Message kind discriminator"),
      target: z
        .object({
          role: z.enum(MESSAGE_AUTHOR_ROLES).optional(),
          agentId: z.string().optional(),
        })
        .nullable()
        .describe(
          "Target audience. null = broadcast. Otherwise role and/or agentId pinpoint.",
        ),
      delivery: z
        .enum(MESSAGE_DELIVERY_MODES)
        .optional()
        .describe(
          "Delivery semantics; defaults to 'push-immediate'. 'scheduled' requires fireAt.",
        ),
      payload: z
        .unknown()
        .describe("Opaque per-kind payload"),
      intent: z
        .string()
        .optional()
        .describe("Per-turn intent metadata (decision_needed / agreement_pending / etc.)"),
      semanticIntent: z
        .string()
        .optional()
        .describe("Semantic intent metadata (seek_rigorous_critique / etc.)"),
      fireAt: z
        .string()
        .optional()
        .describe(
          "ISO-8601 timestamp for scheduled delivery (required when delivery='scheduled')",
        ),
      precondition: z
        .unknown()
        .optional()
        .describe(
          "Optional fire-precondition for scheduled delivery: { fn: <name>; args: <object> }",
        ),
      priorAuthorAgentId: z
        .string()
        .optional()
        .describe(
          "For self-only kinds (amendment): the agentId of the original author being amended",
        ),
    },
    createMessage,
  );

  router.register(
    "claim_message",
    "[Any] Claim a Message — atomic CAS `new → received` + record claimedBy. " +
      "Mission-56 W3.2: adapter-shim post-render call (Design v1.2 commitment #6 + " +
      "thread-325 round-2 Option (i) explicit-ack-on-action). Idempotent on `received` " +
      "(returns existing state, preserving the original winning claimedBy) and on `acked`. " +
      "Multi-agent same-role contract: winner-takes-all via putIfMatch CAS — losers see " +
      "claimedBy !== myAgentId on fresh-read and silently drop. Returns `{message, wonClaim, " +
      "callerAgentId}`; caller observes `wonClaim` to gate render/act.",
    {
      id: z
        .string()
        .describe("Message ID (ULID) to claim"),
    },
    claimMessage,
  );

  router.register(
    "ack_message",
    "[Any] Ack a Message — atomic CAS `received → acked`. " +
      "Mission-56 W3.2: LLM-consumer call after acting (or actively-deferring). " +
      "Tightened from the mission-51 W1 baseline (`* → acked`) per Design v1.2 commitment #6 " +
      "explicit-ack-on-action: ack is tied to consumer-action, not auto-on-render. Caller " +
      "must invoke claim_message first (post-render); ack on `new` is a no-op (returns " +
      "unchanged so the caller can observe the FSM violation). Idempotent on `acked`.",
    {
      id: z
        .string()
        .describe("Message ID (ULID) to ack"),
    },
    ackMessage,
  );
}
