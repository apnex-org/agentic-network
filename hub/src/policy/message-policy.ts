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

  try {
    const messages = await ctx.stores.message.listMessages({
      threadId,
      targetRole,
      targetAgentId,
      authorAgentId,
      status,
      delivery,
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
    agent?.engineerId ?? `anonymous-${authorRole}`;

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

// ── Registration ─────────────────────────────────────────────────────

export function registerMessagePolicy(router: PolicyRouter): void {
  router.register(
    "list_messages",
    "[Any] List messages from the sovereign Message store with multi-membership query primitives. " +
      "Supply any combination of `threadId` (thread view, ordered by sequenceInThread), " +
      "`targetRole` + `targetAgentId` (inbox view), `authorAgentId` (outbox view), " +
      "`status` ('new' | 'acked'), `delivery` ('push-immediate' | 'queued' | 'scheduled'). " +
      "Multi-membership: a single message belongs to thread + inbox + outbox simultaneously.",
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
}
