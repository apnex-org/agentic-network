/**
 * Message entity — mission-51 W1 (M-Message-Primitive).
 *
 * Universal sovereign communication primitive. Every cross-agent or
 * cross-Hub event flows through Message. Five initial kinds; three
 * orthogonal axes encode authorization + turn-shifting semantics. Per
 * thread-311 ratified design (Position A): no per-message override on
 * the axes — kinds are compile-time data, axes are derived. New kinds
 * land via PR review with explicit axis declarations.
 *
 * Multi-membership: a single Message belongs to thread + inbox + outbox
 * simultaneously via derived queries. Source-of-truth is the message
 * blob; views are computed from the indexed fields (`threadId`,
 * `target.{role,agentId}`, `authorAgentId`).
 *
 * ID strategy (Strategy B, architect-leaned in W0 spike):
 *   - Fresh ULID per message via `monotonicFactory()` per repository
 *     instance — same pattern as NotificationRepository (mission-49 W9).
 *   - Legacy entity IDs (thread-message seq, notification id, etc.) are
 *     stored in the optional `migrationSourceId` field. The W2 async-
 *     shadow projector and any sweeper-replay path use
 *     `migrationSourceId` for idempotent re-projection (`createOnly`
 *     keyed on `migrationSourceId` short-circuits duplicates).
 *   - Forward-compatible: post-W6 sunset, `migrationSourceId` becomes a
 *     historical curiosity; the ULID surface stays clean.
 *   - Debug-readability is satisfied via the `kind`+`authorAgentId`+
 *     `createdAt` triple already on every Message, plus the inline
 *     thread+sequence pointer for thread-membership messages.
 *
 * Storage layout (W1):
 *   messages/<id>.json                               — primary blob
 *   messages-thread-index/<threadId>/<paddedSeq>.json — per-thread index
 *     pointer ({messageId: <id>}) for ordered thread iteration + atomic
 *     sequence allocation via createOnly (collision → retry seq+1)
 *
 * Out of scope for W1 (deferred to subsequent waves):
 *   - W2: thread-message normalization read-path (this entity is the
 *     write target; W2 makes it the read source-of-truth too)
 *   - W3: state-transition trigger machinery
 *   - W4: scheduled-message sweeper (uses optional `fireAt` +
 *     `precondition` fields included here for forward-compat)
 *   - W5: cascade transactional boundary + replay sweeper
 *   - W6: legacy-read sunset + tool-surface migration
 */

import { z } from "zod";

// ── Kind taxonomy + axis matrix ──────────────────────────────────────

/**
 * The five initial Message kinds. Add via PR review with explicit
 * axis declarations in `KIND_AXES` below; the axis matrix is
 * compile-time-checked (TS exhaustiveness + Zod enum).
 */
export const MESSAGE_KINDS = [
  "reply",
  "note",
  "external-injection",
  "amendment",
  "urgency-flag",
] as const;

export type MessageKind = (typeof MESSAGE_KINDS)[number];

/**
 * Per-kind axis declarations. Three orthogonal axes:
 *   - `requires_turn`: caller must hold the turn on the thread to author
 *   - `shifts_turn`: posting this message rotates the thread's turn
 *   - `authorized_authors`: which roles may author this kind
 *
 * `"any"` = engineer | architect | director | system.
 * `"director-only"` = director only.
 * `"self-only"` = author must equal the message being amended (caller
 *   matches the prior message's authorAgentId).
 *
 * Footgun mitigation per thread-311 ratification: no runtime override
 * on these axes; per-message edits to these flags would let an LLM-
 * author bypass turn discipline or escalate authorization. Adding a new
 * kind requires a PR with explicit axis values.
 */
export interface KindAxes {
  readonly requires_turn: boolean;
  readonly shifts_turn: boolean;
  readonly authorized_authors: "any" | "director-only" | "self-only";
}

export const KIND_AXES: Readonly<Record<MessageKind, KindAxes>> = {
  reply:                { requires_turn: true,  shifts_turn: true,  authorized_authors: "any" },
  note:                 { requires_turn: false, shifts_turn: false, authorized_authors: "any" },
  "external-injection": { requires_turn: false, shifts_turn: false, authorized_authors: "any" },
  amendment:            { requires_turn: false, shifts_turn: false, authorized_authors: "self-only" },
  "urgency-flag":       { requires_turn: false, shifts_turn: true,  authorized_authors: "director-only" },
} as const;

// ── Author + target shapes ───────────────────────────────────────────

export const MESSAGE_AUTHOR_ROLES = ["architect", "engineer", "director", "system"] as const;
export type MessageAuthorRole = (typeof MESSAGE_AUTHOR_ROLES)[number];

export const MESSAGE_DELIVERY_MODES = ["push-immediate", "queued", "scheduled"] as const;
export type MessageDelivery = (typeof MESSAGE_DELIVERY_MODES)[number];

export const MESSAGE_STATUSES = ["new", "acked"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/**
 * Target audience. `null` = broadcast (every subscriber to the relevant
 * fanout). Specific role | agentId restricts the inbox view to that
 * audience. Both fields optional to allow role-only fanout (any agent
 * with that role) or agentId-pinpoint (specific agent).
 */
export interface MessageTarget {
  role?: MessageAuthorRole;
  agentId?: string;
}

// ── The Message entity ───────────────────────────────────────────────

export interface Message {
  /** ULID, fresh per message (monotonic per repository instance). */
  id: string;

  /** Discriminator. Axes derived from `KIND_AXES[kind]`. */
  kind: MessageKind;

  /** Who authored. */
  authorRole: MessageAuthorRole;
  authorAgentId: string;

  /**
   * Audience. `null` = broadcast. Otherwise role | agentId pinpoint.
   * Inbox queries filter on `target.role` + `target.agentId`.
   */
  target: MessageTarget | null;

  /** Delivery semantics. Pin schema; W3/W4 expand the trigger surface. */
  delivery: MessageDelivery;

  /** Lifecycle. ADR-017 shape: receipt vs completion ack mapping. */
  status: MessageStatus;

  /** Optional thread membership. */
  threadId?: string;

  /**
   * Monotonic per-thread sequence. Allocated atomically at create-time
   * via `createOnly` on the per-thread index path; collision → retry
   * seq+1 (CAS-style). Only set when `threadId` is set.
   */
  sequenceInThread?: number;

  /** Opaque per-kind payload. W1 doesn't lock per-kind schemas. */
  payload: unknown;

  /** Future: escalation policy. W3 trigger surface. */
  escalation?: { timeoutMs: number; targetRole: string };

  /** Future: scheduled-message firing precondition. W4. */
  precondition?: unknown;

  /** Future: scheduled-message firing time (ISO-8601). W4. */
  fireAt?: string;

  /** Per-turn metadata (lifted from inline thread.messages[]). */
  intent?: string;
  semanticIntent?: string;
  converged?: boolean;

  /**
   * Migration source-pointer. Set when this Message was created by the
   * W2 async-shadow projector OR the W1 write-through migration shim.
   * Format: `<source-namespace>:<source-id>` (e.g.,
   * `thread-message:thread-N/seq-K`, `notification:<ulid>`,
   * `pending-action:<ulid>`). Sweeper-replay uses this for idempotent
   * re-projection (find-by-migrationSourceId short-circuits duplicates).
   * Post-W6 sunset, this field becomes historical / can be cleared.
   */
  migrationSourceId?: string;

  /** ISO-8601 timestamps. Set on create; `updatedAt` bumps on status flip. */
  createdAt: string;
  updatedAt: string;
}

// ── Zod schemas (validation surface) ─────────────────────────────────

const MessageTargetSchema = z.object({
  role: z.enum(MESSAGE_AUTHOR_ROLES).optional(),
  agentId: z.string().optional(),
});

export const MessageSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(MESSAGE_KINDS),
  authorRole: z.enum(MESSAGE_AUTHOR_ROLES),
  authorAgentId: z.string().min(1),
  target: MessageTargetSchema.nullable(),
  delivery: z.enum(MESSAGE_DELIVERY_MODES),
  status: z.enum(MESSAGE_STATUSES),
  threadId: z.string().optional(),
  sequenceInThread: z.number().int().nonnegative().optional(),
  payload: z.unknown(),
  escalation: z.object({
    timeoutMs: z.number().int().positive(),
    targetRole: z.string(),
  }).optional(),
  precondition: z.unknown().optional(),
  fireAt: z.string().optional(),
  intent: z.string().optional(),
  semanticIntent: z.string().optional(),
  converged: z.boolean().optional(),
  migrationSourceId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ── Axis enforcement helpers ─────────────────────────────────────────

/**
 * Authorization gate: returns `null` if the proposed author is allowed
 * to post this kind, or an error string explaining why not. Pure;
 * callers map the error string into their own response shape.
 *
 * The `priorAuthorAgentId` parameter applies only to `amendment`
 * (self-only authors): the caller's agentId must match the agentId of
 * the message being amended. Pass `undefined` for non-amendment kinds.
 */
export function checkAuthorAuthorized(
  kind: MessageKind,
  authorRole: MessageAuthorRole,
  authorAgentId: string,
  priorAuthorAgentId?: string,
): string | null {
  const axes = KIND_AXES[kind];
  switch (axes.authorized_authors) {
    case "any":
      return null;
    case "director-only":
      return authorRole === "director"
        ? null
        : `kind=${kind} requires director author; caller is ${authorRole}`;
    case "self-only":
      if (priorAuthorAgentId === undefined) {
        return `kind=${kind} requires priorAuthorAgentId for self-only authorization check`;
      }
      return authorAgentId === priorAuthorAgentId
        ? null
        : `kind=${kind} requires author ${priorAuthorAgentId} (self-only); caller is ${authorAgentId}`;
  }
}

/**
 * Convenience: derive the boolean `requires_turn` axis. Callers can
 * also read `KIND_AXES[kind].requires_turn` directly; this wrapper
 * exists for symmetry with `checkAuthorAuthorized`.
 */
export function requiresTurn(kind: MessageKind): boolean {
  return KIND_AXES[kind].requires_turn;
}

/**
 * Convenience: derive the boolean `shifts_turn` axis.
 */
export function shiftsTurn(kind: MessageKind): boolean {
  return KIND_AXES[kind].shifts_turn;
}

// ── IMessageStore interface ──────────────────────────────────────────

export interface CreateMessageInput {
  kind: MessageKind;
  authorRole: MessageAuthorRole;
  authorAgentId: string;
  target: MessageTarget | null;
  delivery: MessageDelivery;
  payload: unknown;
  threadId?: string;
  intent?: string;
  semanticIntent?: string;
  converged?: boolean;
  escalation?: { timeoutMs: number; targetRole: string };
  precondition?: unknown;
  fireAt?: string;
  migrationSourceId?: string;
}

export interface MessageQuery {
  threadId?: string;
  targetRole?: MessageAuthorRole;
  targetAgentId?: string;
  authorAgentId?: string;
  status?: MessageStatus;
}

export interface IMessageStore {
  /**
   * Create a new Message. Allocates ID + per-thread sequence (atomic
   * via createOnly on the index path) + sets timestamps. Returns the
   * created Message.
   *
   * Idempotency: callers passing `migrationSourceId` get find-or-create
   * semantics — if a Message with that migrationSourceId already
   * exists, the existing Message is returned and no new write happens.
   * This is the W2 async-shadow projector's idempotency hook.
   */
  createMessage(input: CreateMessageInput): Promise<Message>;

  /** Get a Message by ID. Returns null if absent. */
  getMessage(id: string): Promise<Message | null>;

  /**
   * Find a Message by its migration source pointer. Returns null if
   * absent. Used by the W2 async-shadow projector to short-circuit
   * re-projection on sweeper restart.
   */
  findByMigrationSourceId(migrationSourceId: string): Promise<Message | null>;

  /** List all Messages matching the query. Order is implementation-defined unless threadId is set; thread-scoped queries return ordered-by-sequenceInThread. */
  listMessages(query: MessageQuery): Promise<Message[]>;

  /**
   * Flip a Message's status to `acked` (ADR-017 receipt-acked-equivalent
   * for messages). Idempotent: already-acked messages return unchanged.
   * Returns null if the Message doesn't exist.
   */
  ackMessage(id: string): Promise<Message | null>;
}

// ── Path helpers (exported for repository + tests) ───────────────────

export function messagePath(id: string): string {
  return `messages/${id}.json`;
}

/** Per-thread sequence index path. `paddedSeq` = 0-padded to 10 digits
 *  for lex-correct ordering on listing. */
export function threadIndexPath(threadId: string, seq: number): string {
  const padded = String(seq).padStart(10, "0");
  return `messages-thread-index/${threadId}/${padded}.json`;
}

/** The migration-source-pointer composite. Format:
 *    `<namespace>:<id>` — e.g., `thread-message:thread-310/4`,
 *    `notification:01HX...`, `pending-action:01HX...`.
 *  Stored in `Message.migrationSourceId`. */
export function makeMigrationSourceId(namespace: string, sourceId: string): string {
  return `${namespace}:${sourceId}`;
}
