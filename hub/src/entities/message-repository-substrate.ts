/**
 * mission-83 W4.x.4 — MessageRepositorySubstrate
 *
 * Substrate-API version of MessageRepository (mission-51 W1 origin). Per Design
 * v1.3 §5.1 Option Y disposition (B) sibling-pattern. Implements IMessageStore
 * interface UNCHANGED (handler call-sites unchanged).
 *
 * Most complex W4.x sweep slice (per architect thread-570 sequencing): per-thread
 * Mutex + sequence-allocation + ULID id generation + claim/ack/markScheduledState
 * CAS transitions + replayFromCursor lex-cursor pagination.
 *
 * Per-entity logic preserved:
 *   - ULID id generation via monotonicFactory (lazy-import; same as legacy)
 *   - Per-thread Mutex for in-process sequence allocation atomicity
 *   - Sequence allocation: discover max via substrate.list + sort + limit;
 *     assign max+1 within Mutex hold. Single-Hub-process-safe; cross-process
 *     race window is W5+ scope (architect-side decided: Message SchemaDef
 *     §3.4.2 comment "replaces DIY messages-thread-index/ secondary index" —
 *     means no separate MessageThreadIndex entity; substrate-native index
 *     replaces FS dual-namespace pattern).
 *   - migrationSourceId find-or-create idempotency
 *   - assertValidNotePayload schema validation (#41 STRUCTURAL ANCHOR)
 *   - claimMessage/ackMessage/markScheduledState — Design v1.4 getWithRevision
 *     + putIfMatch CAS retry loop (PROPER substrate-boundary CAS)
 *   - replayFromCursor — ULID lex-cursor pagination (since=ulid + id>since +
 *     limit cap)
 *
 * FS-layout → substrate-layout simplifications:
 *   messages/<id>.json              → substrate(kind="Message", id=ulid)
 *   messages-thread-index/.../<seq> → DROPPED (sequenceInThread is a field on
 *                                     Message; substrate.list with threadId
 *                                     filter + client-side sequence-sort
 *                                     replaces dual-namespace pattern)
 *
 * Note: ListSort across `data->>'sequenceInThread'` is string-typed in current
 * substrate; client-side numeric-sort applied post-list. W4.x or W5+ may
 * extend substrate-API with numeric-typed sort projection.
 *
 * W4.x.4 — fifth-slice of W4.x sweep after W4.x.3 IdeaRepositorySubstrate.
 */

import type { HubStorageSubstrate } from "../storage-substrate/index.js";
import type {
  IMessageStore,
  Message,
  CreateMessageInput,
  MessageQuery,
  MessageAuthorRole,
  MessageStatus,
  MessageScheduledState,
} from "./message.js";
import { KIND_AXES } from "./message.js";
import { assertValidNotePayload } from "../policy/note-schema.js";

const KIND = "Message";
const MAX_SEQ_RETRIES = 100;
const MAX_CAS_RETRIES = 50;
const LIST_PREFETCH_CAP = 500;

/**
 * Tiny in-process Mutex — same pattern as legacy MessageRepository.
 * Serializes per-thread sequence allocations within a single Hub process so
 * two concurrent createMessage calls don't both observe the same max-seq.
 */
class Mutex {
  private waiters: Array<() => void> = [];
  private held = false;

  async acquire(): Promise<void> {
    if (!this.held) {
      this.held = true;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.held = false;
  }
}

export class MessageRepositorySubstrate implements IMessageStore {
  private ulidGen: (() => string) | null = null;
  private readonly threadLocks = new Map<string, Mutex>();

  constructor(private readonly substrate: HubStorageSubstrate) {}

  private async ulid(): Promise<string> {
    if (!this.ulidGen) {
      const { monotonicFactory } = await import("ulidx");
      this.ulidGen = monotonicFactory();
    }
    return this.ulidGen();
  }

  private threadLock(threadId: string): Mutex {
    let lock = this.threadLocks.get(threadId);
    if (!lock) {
      lock = new Mutex();
      this.threadLocks.set(threadId, lock);
    }
    return lock;
  }

  /**
   * Allocate next sequenceInThread atomically (in-process). Reads current max
   * via substrate.list filter+client-sort; assigns max+1. Mutex serializes
   * within a single Hub process. Cross-process race is W5+ scope (would need
   * substrate-side unique constraint on (kind, jsonb-threadId, jsonb-seq)).
   *
   * Returns the allocated seq. Caller writes the Message with this seq inside
   * the Mutex hold.
   */
  private async allocateSequence(threadId: string): Promise<number> {
    for (let attempt = 0; attempt < MAX_SEQ_RETRIES; attempt++) {
      const { items } = await this.substrate.list<Message>(KIND, {
        filter: { threadId },
        limit: LIST_PREFETCH_CAP,
      });
      let maxSeq = -1;
      for (const m of items) {
        if (typeof m.sequenceInThread === "number" && m.sequenceInThread > maxSeq) {
          maxSeq = m.sequenceInThread;
        }
      }
      const candidate = maxSeq + 1;
      // In-process Mutex bounds the race; single-Hub-process is safe.
      // Cross-process would race here; defer to W5+.
      return candidate;
    }
    throw new Error(
      `[MessageRepositorySubstrate] sequence allocation exhausted ${MAX_SEQ_RETRIES} retries for thread ${threadId}`,
    );
  }

  async createMessage(input: CreateMessageInput): Promise<Message> {
    // #41 STRUCTURAL ANCHOR — schema-validate at canonical repository write-path
    if (input.kind === "note") {
      assertValidNotePayload(input.payload);
    }

    // Idempotency hook: migrationSourceId find-or-create
    if (input.migrationSourceId) {
      const existing = await this.findByMigrationSourceId(input.migrationSourceId);
      if (existing) return existing;
    }

    const id = await this.ulid();
    const now = new Date().toISOString();

    let sequenceInThread: number | undefined;
    if (input.threadId) {
      const lock = this.threadLock(input.threadId);
      await lock.acquire();
      try {
        sequenceInThread = await this.allocateSequence(input.threadId);
      } finally {
        // Lock released AFTER substrate.createOnly below to bound the race
        // window. Lock-release happens in finally outside this block.
      }
    }

    const message: Message = {
      id,
      kind: input.kind,
      authorRole: input.authorRole,
      authorAgentId: input.authorAgentId,
      target: input.target,
      delivery: input.delivery,
      status: "new",
      payload: input.payload,
      createdAt: now,
      updatedAt: now,
    };
    if (input.threadId) message.threadId = input.threadId;
    if (sequenceInThread !== undefined) message.sequenceInThread = sequenceInThread;
    if (input.intent !== undefined) message.intent = input.intent;
    if (input.semanticIntent !== undefined) message.semanticIntent = input.semanticIntent;
    if (input.converged !== undefined) message.converged = input.converged;
    if (input.escalation) message.escalation = input.escalation;
    if (input.precondition !== undefined) message.precondition = input.precondition;
    if (input.fireAt !== undefined) message.fireAt = input.fireAt;
    if (input.migrationSourceId !== undefined) message.migrationSourceId = input.migrationSourceId;
    if (input.delivery === "scheduled") {
      message.scheduledState = "pending";
    }
    if (input.retryCount !== undefined) message.retryCount = input.retryCount;
    if (input.maxRetries !== undefined) message.maxRetries = input.maxRetries;

    try {
      const result = await this.substrate.createOnly(KIND, message);
      if (!result.ok) {
        throw new Error(
          `[MessageRepositorySubstrate] createMessage: id ${id} already exists; refusing to clobber`,
        );
      }
      return message;
    } finally {
      if (input.threadId) {
        this.threadLock(input.threadId).release();
      }
    }
  }

  async getMessage(id: string): Promise<Message | null> {
    return this.substrate.get<Message>(KIND, id);
  }

  async findByMigrationSourceId(migrationSourceId: string): Promise<Message | null> {
    const { items } = await this.substrate.list<Message>(KIND, {
      filter: { migrationSourceId },
      limit: 1,
    });
    return items[0] ?? null;
  }

  async listMessages(query: MessageQuery): Promise<Message[]> {
    if (query.threadId !== undefined) {
      return this.listByThread(query.threadId, query);
    }
    return this.listFiltered(query);
  }

  /**
   * Thread-scoped listing: substrate-side filter on threadId + client-side
   * numeric sort by sequenceInThread asc + additional filter pass.
   */
  private async listByThread(threadId: string, query: MessageQuery): Promise<Message[]> {
    const { items } = await this.substrate.list<Message>(KIND, {
      filter: { threadId },
      limit: LIST_PREFETCH_CAP,
    });
    return items
      .sort((a, b) => (a.sequenceInThread ?? 0) - (b.sequenceInThread ?? 0))
      .filter(m => matchesAdditionalFilters(m, query));
  }

  /**
   * Non-thread-scoped listing: substrate.list + client-side filter + lex-sort
   * by id (ULID id = time-monotonic).
   */
  private async listFiltered(query: MessageQuery): Promise<Message[]> {
    // No substrate-side filter — additional filters applied client-side per
    // matchesAdditionalFilters semantics (target/status/delivery/scheduledState/
    // authorAgentId/since cursor). Limit cap bounds memory.
    const { items } = await this.substrate.list<Message>(KIND, {
      limit: LIST_PREFETCH_CAP,
    });
    return items
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .filter(m => matchesAdditionalFilters(m, query));
  }

  /**
   * Mission-56 W1b: Hub-internal cursor-based replay for SSE Last-Event-ID
   * protocol + cold-start stream-all.
   *
   * Returns Messages with id > since (or all if !since), filtered by
   * target/status, ordered by id ASC (ULID lex-sort = time-asc), limited to
   * `limit`.
   */
  async replayFromCursor(opts: {
    since?: string;
    targetRole?: MessageAuthorRole;
    targetAgentId?: string;
    status?: MessageStatus;
    limit: number;
  }): Promise<Message[]> {
    const { items } = await this.substrate.list<Message>(KIND, {
      limit: LIST_PREFETCH_CAP,
    });
    const ordered = items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const out: Message[] = [];
    for (const m of ordered) {
      if (out.length >= opts.limit) break;
      if (opts.since !== undefined && m.id <= opts.since) continue;
      if (opts.targetRole !== undefined) {
        if (!m.target || m.target.role !== opts.targetRole) continue;
      }
      if (opts.targetAgentId !== undefined) {
        if (!m.target || m.target.agentId !== opts.targetAgentId) continue;
      }
      if (opts.status !== undefined && m.status !== opts.status) continue;
      out.push(m);
    }
    return out;
  }

  /**
   * Mission-56 W3.2: claim — atomic CAS `new → received` + set claimedBy via
   * Design v1.4 getWithRevision + putIfMatch. Idempotent on `received` (returns
   * existing) + on `acked` (returns existing).
   */
  async claimMessage(id: string, claimerAgentId: string): Promise<Message | null> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<Message>(KIND, id);
      if (!existing) return null;
      const message = existing.entity;
      if (message.status !== "new") return message;  // idempotent / no-op
      const updated: Message = {
        ...message,
        status: "received",
        claimedBy: claimerAgentId,
        updatedAt: new Date().toISOString(),
      };
      const result = await this.substrate.putIfMatch(KIND, updated, existing.resourceVersion);
      if (result.ok) return updated;
      // revision-mismatch — racing winner; fresh-read returns winner's state;
      // caller observes claimedBy to detect win vs loss
    }
    return this.getMessage(id);
  }

  /**
   * Mission-56 W3.2: ack — atomic CAS `received → acked`. Tightened from
   * mission-51 W1 baseline per Design v1.2 commitment #6 explicit-ack-on-action.
   */
  async ackMessage(id: string): Promise<Message | null> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<Message>(KIND, id);
      if (!existing) return null;
      const message = existing.entity;
      if (message.status !== "received") return message;  // idempotent / no-op
      const updated: Message = {
        ...message,
        status: "acked",
        updatedAt: new Date().toISOString(),
      };
      const result = await this.substrate.putIfMatch(KIND, updated, existing.resourceVersion);
      if (result.ok) return updated;
    }
    return this.getMessage(id);
  }

  /**
   * Mission-51 W4: transition scheduledState. Same CAS-flip pattern as
   * ackMessage. Idempotent — already-at-state returns unchanged.
   */
  async markScheduledState(id: string, state: MessageScheduledState): Promise<Message | null> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<Message>(KIND, id);
      if (!existing) return null;
      const message = existing.entity;
      if (message.scheduledState === state) return message;
      const updated: Message = {
        ...message,
        scheduledState: state,
        updatedAt: new Date().toISOString(),
      };
      const result = await this.substrate.putIfMatch(KIND, updated, existing.resourceVersion);
      if (result.ok) return updated;
    }
    return this.getMessage(id);
  }
}

// ── Filter helpers (byte-for-byte from legacy MessageRepository) ─────────────

function matchesAdditionalFilters(m: Message, q: MessageQuery): boolean {
  if (q.targetRole !== undefined) {
    if (!m.target || m.target.role !== q.targetRole) return false;
  }
  if (q.targetAgentId !== undefined) {
    if (!m.target || m.target.agentId !== q.targetAgentId) return false;
  }
  if (q.authorAgentId !== undefined && m.authorAgentId !== q.authorAgentId) {
    return false;
  }
  if (q.status !== undefined && m.status !== q.status) return false;
  if (q.delivery !== undefined && m.delivery !== q.delivery) return false;
  if (q.scheduledState !== undefined && m.scheduledState !== q.scheduledState) return false;
  if (q.since !== undefined && m.id <= q.since) return false;
  return true;
}

// ── Re-exports for convenience ───────────────────────────────────────
export { KIND_AXES };
export type { Message, IMessageStore, CreateMessageInput, MessageQuery } from "./message.js";
