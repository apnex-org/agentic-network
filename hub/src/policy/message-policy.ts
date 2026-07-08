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
  type Message,
} from "../entities/index.js";
import { findRepoEventHandler } from "./repo-event-handlers.js";
import { projectMessageArrivalData, projectMessagesForConsumption, projectMessageForConsumption } from "./message-consumption-projection.js";
import { resolveRecipient } from "../entities/recipient-resolver.js";

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
    const callerAgentId = await resolveCallerAgentId(ctx);
    const callerRole = ctx.stores.engineerRegistry.getRole(ctx.sessionId);
    const projectedMessages = await projectMessagesForConsumption(
      { workItem: ctx.stores.workItem, engineerRegistry: ctx.stores.engineerRegistry },
      messages,
      {
        role: targetRole ?? (callerRole === "engineer" || callerRole === "director" || callerRole === "verifier" ? callerRole : "architect"),
        agentId: targetAgentId ?? callerAgentId,
      },
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              messages: projectedMessages,
              count: projectedMessages.length,
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

/**
 * bug-102: normalize a `create_message` `payload` argument that arrived as a
 * JSON-string instead of an object.
 *
 * The `payload` MCP-tool param is declared `z.unknown()` (typeless — payloads
 * are per-kind, so the param can't carry one schema). Some MCP-client / proxy
 * forward paths serialize a typeless param to a JSON string before it reaches
 * the Hub; the per-kind validators (`note-schema` et al.) then see a string
 * and reject ("payload must be a plain object … got string"), which broke the
 * documented `create_message kind=note payload:{body:"…"}` invocation
 * substrate-wide (the pulse-response channel).
 *
 * Pure. A JSON-string-encoded object/array is parsed back to its value;
 * anything else (a real object, a non-JSON string, a number) passes through
 * unchanged so the per-kind validator still produces its own diagnostic.
 */
export function coerceToolPayload(payload: unknown): unknown {
  if (typeof payload !== "string") return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return payload; // not JSON — per-kind validation produces the real error
  }
}

async function createMessage(
  args: Record<string, unknown>,
  ctx: IPolicyContext,
): Promise<PolicyResult> {
  const kind = args.kind as MessageKind;
  // idea-252 §1: tool-input target may carry `name` alongside `agentId`;
  // the stored Message.target keeps only {role?, agentId?}. Resolve below.
  const targetArg = args.target as (MessageTarget & { name?: string }) | null;
  const delivery = (args.delivery as MessageDelivery | undefined) ?? "push-immediate";
  // bug-102: normalize a JSON-string-encoded payload back to an object — see
  // `coerceToolPayload`. The `create_message` `payload` param is typeless
  // (`z.unknown()`), and some MCP-client / proxy forward paths JSON-stringify
  // a typeless param; without this the per-kind validators reject ("payload
  // must be a plain object … got string").
  const payload = coerceToolPayload(args.payload);
  const intent = args.intent as string | undefined;
  const semanticIntent = args.semanticIntent as string | undefined;
  const fireAt = args.fireAt as string | undefined;
  const precondition = args.precondition;
  const priorAuthorAgentId = args.priorAuthorAgentId as string | undefined;

  // idea-252 §1+§4 — resolve `target.name` / `target.agentId` to canonical
  // agentId. Loud-fail at API boundary on unknown / conflict (closes
  // calibration #64 + bug-56-class silent-dispatch for explicit-recipient
  // ops). Role-only targets bypass resolution (legitimate fanout pattern).
  let target: MessageTarget | null = null;
  if (targetArg) {
    if (targetArg.name || targetArg.agentId) {
      const resolution = await resolveRecipient(ctx.stores.engineerRegistry, {
        name: targetArg.name ?? null,
        agentId: targetArg.agentId ?? null,
      });
      if (!resolution.ok) {
        ctx.metrics.increment("create_message.recipient_rejected", { code: resolution.code });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: resolution.message, code: resolution.code, subtype: "recipient" }) }],
          isError: true,
        };
      }
      target = { ...(targetArg.role ? { role: targetArg.role } : {}), agentId: resolution.agentId };
    } else {
      // role-only target (e.g., role: "engineer" fanout). Preserve as-is.
      target = { ...(targetArg.role ? { role: targetArg.role } : {}) };
    }
  }

  // Resolve caller identity from policy context.
  const callerRole = ctx.stores.engineerRegistry.getRole(ctx.sessionId);
  const authorRole: MessageAuthorRole =
    callerRole === "engineer"
      ? "engineer"
      : callerRole === "director"
        ? "director"
        : callerRole === "verifier"
          ? "verifier" // mission-93 bug-169: verifier's notes/messages must attribute to verifier, not silently architect
          : "architect"; // architect is the default fallback for system-callers
  // bug-193 — DON'T swallow lookup errors. The old `.catch(()=>null)` collapsed
  // BOTH "no agent for this session" (legitimately null) AND "the registry read
  // THREW" (a substrate/infra fault) into the same anonymous-${role} default →
  // a transient fault silently mis-attributed the message to anonymous instead
  // of its real (registered) author + buried the fault. A genuine miss still
  // returns null → defaults (system-callers / unmapped session); a THROWN lookup
  // now propagates (fail-loud) so attribution integrity + the infra fault surface.
  const agent = await (ctx.stores.engineerRegistry as any).getAgentForSession?.(
    ctx.sessionId,
  );
  const authorAgentId: string =
    agent?.id ?? `anonymous-${authorRole}`;

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
        const arrivalData = await projectMessageArrivalData(ctx, message, {
          role: target?.role,
          agentId: target?.agentId,
        });
        await ctx.dispatch("message_arrived", arrivalData, selector);
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

    // Mission-68 W1: repo-event dispatch (Design v1.0 §2.4).
    //
    // Detect external-injection messages carrying a RepoEventBridge
    // (mission-52) envelope and route to a registered per-subkind
    // handler. Handlers synthesize 0+ downstream Messages (kind=note
    // typically) emitted via createMessage — recursive cascade-bounded
    // because handler emissions don't match this detection rule
    // (kind=note ≠ external-injection + payload.kind=repo-event).
    //
    // Two-message-intent rationale (Design v1.0 §2.4 M1 fold): the
    // bridge's broadcast remains substrate-grade event signal; the
    // synthesized note is engineer-cadence-discipline-shaped derivative.
    // Architect-role subscribers receive both by-design (different
    // consumer concerns; not redundant emission).
    //
    // Failure isolation: handler errors logged + non-fatal; the
    // inbound external-injection message is already persisted +
    // broadcast. Mirrors `pulseSweeper.onPulseAcked` (line 397) hook
    // pattern.
    if (
      message.kind === "external-injection" &&
      typeof (message.payload as { kind?: unknown })?.kind === "string" &&
      (message.payload as { kind: string }).kind === "repo-event"
    ) {
      const subkind = (message.payload as { subkind?: unknown }).subkind;
      if (typeof subkind === "string") {
        const handler = findRepoEventHandler(subkind);
        if (handler === null) {
          console.warn(
            `[message-policy] no repo-event handler registered for subkind=${subkind}; skipping (non-fatal)`,
          );
        } else {
          try {
            const dispatches = await handler.handle(message, ctx);
            for (const dispatch of dispatches) {
              const derivedInput: CreateMessageInput = {
                kind: dispatch.kind,
                authorRole: "architect", // system-emitted derivative; default architect fallback (matches RepoEventBridge in-process invoker)
                authorAgentId: `system-repo-event-handler-${handler.name}`,
                target: dispatch.target,
                delivery: dispatch.delivery ?? "push-immediate",
                payload: dispatch.payload,
                intent: dispatch.intent,
                semanticIntent: dispatch.semanticIntent,
              };
              try {
                const derived = await ctx.stores.message.createMessage(derivedInput);
                if (derived.delivery === "push-immediate") {
                  try {
                    const derivedSelector = pushSelector(dispatch.target);
                    const derivedArrivalData = await projectMessageArrivalData(ctx, derived, {
                      role: dispatch.target?.role,
                      agentId: dispatch.target?.agentId,
                    });
                    await ctx.dispatch(
                      "message_arrived",
                      derivedArrivalData,
                      derivedSelector,
                    );
                  } catch (err) {
                    console.error(
                      `[message-policy] derived push dispatch failed for ${derived.id} from handler=${handler.name} (non-fatal): ${(err as Error)?.message ?? String(err)}`,
                    );
                  }
                }
              } catch (err) {
                console.error(
                  `[message-policy] derived createMessage failed for handler=${handler.name} (non-fatal): ${(err as Error)?.message ?? String(err)}`,
                );
              }
            }
          } catch (err) {
            console.error(
              `[message-policy] repo-event handler ${handler.name} threw (non-fatal): ${(err as Error)?.message ?? String(err)}`,
            );
          }
        }
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
        : callerRole === "verifier"
          ? "verifier" // mission-93 bug-169: verifier attribution
          : "architect";
  // bug-193 — don't swallow lookup errors (see createMessage above): a genuine
  // miss returns null → defaults; a THROWN registry read propagates (fail-loud)
  // rather than silently mis-attributing claimedBy to anonymous-${role}.
  const agent = await (ctx.stores.engineerRegistry as any).getAgentForSession?.(
    ctx.sessionId,
  );
  return agent?.id ?? `anonymous-${fallbackRole}`;
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
    const callerRole = ctx.stores.engineerRegistry.getRole(ctx.sessionId);
    const projectedMessage = await projectMessageForConsumption(
      { workItem: ctx.stores.workItem, engineerRegistry: ctx.stores.engineerRegistry },
      message,
      {
        role: callerRole === "engineer" || callerRole === "director" || callerRole === "verifier" ? callerRole : "architect",
        agentId: claimerAgentId,
      },
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              message: projectedMessage,
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

/**
 * bug-192 — the canonical "system-emitter create + push-on-create" path.
 *
 * A system-emitter (trigger, director-notification, downstream-actor, sweeper)
 * that calls `ctx.stores.message.createMessage` DIRECTLY bypasses the SSE push
 * step the `create_message` MCP verb performs — so `delivery:"push-immediate"`
 * is INERT and a poll-less (opencode) recipient never sees the Message live,
 * only on reconnect-replay (compounds bug-189). Route every system-emit through
 * this helper so create + push stay coupled (the mission-60/61 pulse-path
 * lesson, generalized — the next emitter can't silently re-introduce the gap).
 * Dispatch failure is non-fatal: the Message is already committed; cold
 * reconnect-replay / poll-backstop recover any pushed-but-undelivered event.
 */
export async function emitAndPush(
  ctx: IPolicyContext,
  input: CreateMessageInput,
): Promise<Message> {
  const message = await ctx.stores.message.createMessage(input);
  if (message.delivery === "push-immediate") {
    try {
      const arrivalData = await projectMessageArrivalData(ctx, message, {
        role: message.target?.role,
        agentId: message.target?.agentId,
      });
      await ctx.dispatch("message_arrived", arrivalData, pushSelector(message.target ?? null));
    } catch (err) {
      // Non-fatal — the Message is committed; cold-replay / poll-backstop recover.
      console.error(
        `[emitAndPush] push-on-create dispatch failed for ${message.id} (non-fatal): ${(err as Error)?.message ?? String(err)}`,
      );
    }
  }
  return message;
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
          name: z.string().optional(),
        })
        .nullable()
        .describe(
          "Target audience. null = broadcast. Otherwise role and/or agentId pinpoint. " +
            "idea-252 §1: prefer `name` (operator-friendly; resolved server-side via deterministic name→agentId). " +
            "Supplying both `name` + `agentId` rejects with `recipient.conflict` if they don't resolve to the same agent.",
        ),
      delivery: z
        .enum(MESSAGE_DELIVERY_MODES)
        .optional()
        .describe(
          "Delivery semantics; defaults to 'push-immediate'. 'scheduled' requires fireAt.",
        ),
      payload: z
        .unknown()
        .describe(
          "Per-kind payload — pass a JSON object (e.g. {body: \"...\"} for kind=note). " +
            "A JSON-string-encoded object is also accepted + parsed (bug-102 tolerance).",
        ),
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
