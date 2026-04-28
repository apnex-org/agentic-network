/**
 * MessageRepository — StorageProvider-backed persistence for Message.
 *
 * Mission-51 W1. Sovereign-package shape per mission-47 NotificationRepository
 * precedent (single-namespace primary blob + ULID IDs + `createOnly`-keyed
 * idempotency). Adds a per-thread sequence-index path for atomic
 * `sequenceInThread` allocation under concurrent appends and cheap
 * thread-scoped ordered iteration.
 *
 * Storage layout:
 *   messages/<id>.json                                 — primary blob
 *   messages-thread-index/<threadId>/<paddedSeq>.json  — per-thread index
 *     pointer (small JSON `{messageId: <id>}`)
 *
 * ID generation: ULID via `monotonicFactory()` (one factory per repository
 * instance). Lex-sortable byte keys; `findByMigrationSourceId` and the
 * by-target / by-author queries are list-prefix scans + filter — slower
 * than a dedicated secondary index but consistent across both backends
 * and idempotent on retry. Index optimization is filed as follow-on.
 *
 * Sequence allocation under concurrency: `createOnly` on the index path
 * is the atomic primitive. Callers retry seq+1 on collision (`{ok:false}`).
 * On either backend (`cas:true + concurrent:true` GCS or `cas:true +
 * concurrent:false` local-fs) the createOnly contract delivers the
 * required atomicity. Single-process callers get linearization for free
 * via JS's single-threaded model; we add a per-thread Mutex for
 * efficiency (avoid wasted retries when two in-process callers race
 * against the same thread).
 *
 * Mission-51 W0 spike (PR #42) ratified: this repository uses ONLY
 * existing single-entity atomic primitives. No new contract surface.
 *
 * Read-side optimization: `listByThread` filters via the index-path
 * prefix (cheap, ordered) and follows the messageId pointer to fetch
 * the full Message. `listByTarget` / `listByAuthor` scan the primary
 * namespace + filter (acceptable for W1; bounded by total message
 * count which is tracked Hub-wide).
 */

import type { StorageProvider } from "@apnex/storage-provider";

import type {
  IMessageStore,
  Message,
  CreateMessageInput,
  MessageQuery,
} from "./message.js";
import {
  KIND_AXES,
  messagePath,
  threadIndexPath,
} from "./message.js";

const MAX_SEQ_RETRIES = 100;
const PRIMARY_NAMESPACE = "messages/";
const THREAD_INDEX_NAMESPACE = "messages-thread-index/";

interface ThreadIndexEntry {
  messageId: string;
}

function encodeMessage(m: Message): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(m, null, 2));
}

function decodeMessage(bytes: Uint8Array): Message {
  return JSON.parse(new TextDecoder().decode(bytes)) as Message;
}

function encodeIndexEntry(e: ThreadIndexEntry): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(e));
}

function decodeIndexEntry(bytes: Uint8Array): ThreadIndexEntry {
  return JSON.parse(new TextDecoder().decode(bytes)) as ThreadIndexEntry;
}

/**
 * Tiny in-process Mutex — same pattern as StorageBackedCounter.
 * Serializes per-thread sequence allocations within a single Hub
 * process so two concurrent `createMessage` calls don't both attempt
 * the same `createOnly` path before either resolves.
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

export class MessageRepository implements IMessageStore {
  private ulidGen: (() => string) | null = null;

  /** Per-thread mutex map for sequence allocation. Lazy. */
  private readonly threadLocks = new Map<string, Mutex>();

  constructor(private readonly provider: StorageProvider) {}

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
   * Allocate the next sequence number for a thread atomically. Tries
   * monotonically increasing seq values starting from
   * `lastKnownSeq + 1`; on `createOnly` collision (`{ok:false}`),
   * advances seq and retries.
   *
   * Returns the allocated seq + the index-path that was written. The
   * caller must follow up with the primary-blob write.
   */
  private async allocateSequence(
    threadId: string,
    messageId: string,
  ): Promise<{ seq: number; indexPath: string }> {
    // Discover the current max seq for this thread to avoid linear
    // probing from 0 on every allocation. Cheap on local-fs (filesystem
    // listdir is fast) and on GCS (prefix listing is paginated but
    // small per-thread).
    const existingPaths = await this.provider.list(
      `${THREAD_INDEX_NAMESPACE}${threadId}/`,
    );
    let nextSeq = 0;
    for (const path of existingPaths) {
      const fileName = path.split("/").pop() ?? "";
      const stem = fileName.replace(/\.json$/, "");
      const n = Number(stem);
      if (Number.isFinite(n) && n >= nextSeq) {
        nextSeq = n + 1;
      }
    }

    for (let attempt = 0; attempt < MAX_SEQ_RETRIES; attempt++) {
      const candidate = nextSeq + attempt;
      const indexPath = threadIndexPath(threadId, candidate);
      const result = await this.provider.createOnly(
        indexPath,
        encodeIndexEntry({ messageId }),
      );
      if (result.ok) {
        return { seq: candidate, indexPath };
      }
      // Collision → another writer (cross-process on GCS, or a stale
      // listdir on local-fs) got this seq. Try seq+1.
    }
    throw new Error(
      `[MessageRepository] sequence allocation exhausted ${MAX_SEQ_RETRIES} retries for thread ${threadId} starting at seq ${nextSeq}`,
    );
  }

  async createMessage(input: CreateMessageInput): Promise<Message> {
    // Idempotency hook: if migrationSourceId is set and a Message with
    // that source-pointer already exists, return it without writing.
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
        const { seq } = await this.allocateSequence(input.threadId, id);
        sequenceInThread = seq;
      } finally {
        lock.release();
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
    // Mission-51 W4: scheduled messages start at scheduledState='pending'.
    // Non-scheduled messages have scheduledState undefined.
    if (input.delivery === "scheduled") {
      message.scheduledState = "pending";
    }
    if (input.retryCount !== undefined) message.retryCount = input.retryCount;
    if (input.maxRetries !== undefined) message.maxRetries = input.maxRetries;

    const result = await this.provider.createOnly(messagePath(id), encodeMessage(message));
    if (!result.ok) {
      // ULID monotonicFactory + sequence-index pre-allocation guarantees
      // path-uniqueness within a single Hub process; collision indicates
      // an external writer or a serialization bug. Surface loudly.
      throw new Error(
        `[MessageRepository] createMessage: id ${id} already exists; refusing to clobber`,
      );
    }
    return message;
  }

  async getMessage(id: string): Promise<Message | null> {
    const raw = await this.provider.get(messagePath(id));
    if (!raw) return null;
    return decodeMessage(raw);
  }

  async findByMigrationSourceId(migrationSourceId: string): Promise<Message | null> {
    // Prefix-scan the primary namespace + filter by migrationSourceId.
    // Acceptable for W1 (bounded message count); index optimization is
    // a follow-on if hot-path performance demands it.
    const keys = await this.provider.list(PRIMARY_NAMESPACE);
    for (const key of keys) {
      if (!key.endsWith(".json")) continue;
      // Skip thread-index sub-namespace (defense against future namespace shifts).
      if (key.startsWith(THREAD_INDEX_NAMESPACE)) continue;
      const raw = await this.provider.get(key);
      if (!raw) continue;
      const m = decodeMessage(raw);
      if (m.migrationSourceId === migrationSourceId) return m;
    }
    return null;
  }

  async listMessages(query: MessageQuery): Promise<Message[]> {
    if (query.threadId !== undefined) {
      return this.listByThread(query.threadId, query);
    }
    return this.listFiltered(query);
  }

  /**
   * Thread-scoped listing using the per-thread index path for ordering.
   * Returns messages ordered by `sequenceInThread` ascending.
   */
  private async listByThread(threadId: string, query: MessageQuery): Promise<Message[]> {
    const indexKeys = await this.provider.list(
      `${THREAD_INDEX_NAMESPACE}${threadId}/`,
    );
    const ordered = indexKeys
      .filter((k) => k.endsWith(".json"))
      .sort();
    const out: Message[] = [];
    for (const indexKey of ordered) {
      const indexRaw = await this.provider.get(indexKey);
      if (!indexRaw) continue;
      let entry: ThreadIndexEntry;
      try {
        entry = decodeIndexEntry(indexRaw);
      } catch {
        continue;
      }
      const message = await this.getMessage(entry.messageId);
      if (!message) continue;
      if (!matchesAdditionalFilters(message, query)) continue;
      out.push(message);
    }
    return out;
  }

  /**
   * Non-thread-scoped listing: scan the primary namespace + filter.
   * Order is unspecified beyond storage-key lex order (which on ULID
   * IDs gives time-monotonic ordering — useful for outbox-by-author).
   */
  private async listFiltered(query: MessageQuery): Promise<Message[]> {
    const keys = await this.provider.list(PRIMARY_NAMESPACE);
    const ordered = keys
      .filter((k) => k.endsWith(".json"))
      .filter((k) => !k.startsWith(THREAD_INDEX_NAMESPACE))
      .sort();
    const out: Message[] = [];
    for (const key of ordered) {
      const raw = await this.provider.get(key);
      if (!raw) continue;
      const m = decodeMessage(raw);
      if (!matchesAdditionalFilters(m, query)) continue;
      out.push(m);
    }
    return out;
  }

  /**
   * Mission-56 W1b: Hub-internal cursor-based replay for SSE
   * Last-Event-ID protocol + cold-start stream-all.
   *
   * Returns Messages with id > since (or all if !since), filtered by
   * target/status, ordered by id ASC (ULID lex-sort = time-asc),
   * limited to `limit`.
   *
   * Hub-internal: NOT exposed via MCP tool surface (idea-121 defers).
   * Implementation: scan PRIMARY_NAMESPACE; ULID id-comparison filter;
   * skip thread-index keys; apply target/status filters; cap at limit.
   *
   * Same scan-and-filter shape as `listFiltered`, with cursor short-
   * circuit + soft-cap. Bounded by total Message count post-retention
   * cleanup; fast enough at the typical message rates this layer
   * handles per Design v1.2 §3.
   */
  async replayFromCursor(opts: {
    since?: string;
    targetRole?: import("./message.js").MessageAuthorRole;
    targetAgentId?: string;
    status?: import("./message.js").MessageStatus;
    limit: number;
  }): Promise<Message[]> {
    const keys = await this.provider.list(PRIMARY_NAMESPACE);
    const ordered = keys
      .filter((k) => k.endsWith(".json"))
      .filter((k) => !k.startsWith(THREAD_INDEX_NAMESPACE))
      .sort(); // ULID lex-sort = time-asc; cursor filter walks in order

    const out: Message[] = [];
    for (const key of ordered) {
      if (out.length >= opts.limit) break;

      // Extract ID from "messages/<id>.json" path; cursor filter is
      // string-comparison on ULIDs (lex-monotonic).
      const idMatch = key.match(/messages\/([^/]+)\.json$/);
      if (!idMatch) continue;
      const id = idMatch[1];

      if (opts.since !== undefined && id <= opts.since) continue;

      const raw = await this.provider.get(key);
      if (!raw) continue;
      const m = decodeMessage(raw);

      // Target + status filters.
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
   * Mission-56 W3.2: claim — atomic CAS `new → received` + set
   * claimedBy. Idempotent on `received` (returns existing,
   * preserving the original winning claimedBy) + on `acked`
   * (returns existing). Token-stale → fresh-read fallthrough
   * (returns whatever the winner persisted; caller observes
   * claimedBy to detect loss).
   *
   * Multi-agent same-role contract: winner-takes-all via the
   * putIfMatch CAS — only the agent whose putIfMatch succeeds
   * sets `claimedBy`. Losing agents see the winner's `claimedBy`
   * on fresh-read and self-arbitrate (silent drop).
   */
  async claimMessage(
    id: string,
    claimerAgentId: string,
  ): Promise<Message | null> {
    const provider = this.provider as StorageProvider & {
      getWithToken?: (path: string) => Promise<{ data: Uint8Array; token: string } | null>;
    };
    const path = messagePath(id);

    if (typeof provider.getWithToken === "function") {
      const read = await provider.getWithToken(path);
      if (!read) return null;
      const message = decodeMessage(read.data);
      // Idempotent / no-op states: only `new` triggers a CAS.
      if (message.status !== "new") return message;
      const updated: Message = {
        ...message,
        status: "received",
        claimedBy: claimerAgentId,
        updatedAt: new Date().toISOString(),
      };
      const writeResult = await this.provider.putIfMatch(
        path,
        encodeMessage(updated),
        read.token,
      );
      if (writeResult.ok) return updated;
      // Token stale — another agent (or this agent on retry) won the
      // race. Fresh-read returns whatever the winner persisted; caller
      // observes `claimedBy` to detect win vs loss.
      return this.getMessage(id);
    }

    // Fallback: providers without getWithToken use put-clobber. Race
    // is bounded — final state converges on `received` with one of
    // the racing agents' claimedBy. Non-CAS providers are dev-only
    // anyway per StorageProvider contract.
    const message = await this.getMessage(id);
    if (!message) return null;
    if (message.status !== "new") return message;
    const updated: Message = {
      ...message,
      status: "received",
      claimedBy: claimerAgentId,
      updatedAt: new Date().toISOString(),
    };
    await this.provider.put(path, encodeMessage(updated));
    return updated;
  }

  /**
   * Mission-56 W3.2: ack — atomic CAS `received → acked`.
   *
   * Tightened from the mission-51 W1 baseline (`* → acked`) per
   * Design v1.2 commitment #6 explicit-ack-on-action. Idempotent on
   * `acked`. No-op on `new` (returns unchanged; caller should call
   * claimMessage first). Returns null on missing.
   */
  async ackMessage(id: string): Promise<Message | null> {
    const provider = this.provider as StorageProvider & {
      getWithToken?: (path: string) => Promise<{ data: Uint8Array; token: string } | null>;
    };
    const path = messagePath(id);

    if (typeof provider.getWithToken === "function") {
      const read = await provider.getWithToken(path);
      if (!read) return null;
      const message = decodeMessage(read.data);
      // Idempotent / no-op: only `received` triggers a CAS.
      if (message.status !== "received") return message;
      const updated: Message = {
        ...message,
        status: "acked",
        updatedAt: new Date().toISOString(),
      };
      const writeResult = await this.provider.putIfMatch(
        path,
        encodeMessage(updated),
        read.token,
      );
      if (writeResult.ok) return updated;
      // Token stale — caller can retry; for ack idempotency, fall
      // through to fresh-read on next call.
      return this.getMessage(id);
    }

    // Fallback: providers without getWithToken use put-clobber. We use
    // it only for status flip, so race is benign (last-writer-wins on
    // a converging final state of "acked"; the timestamp difference is
    // not load-bearing semantically). Non-CAS providers are dev-only
    // anyway per StorageProvider contract.
    const message = await this.getMessage(id);
    if (!message) return null;
    if (message.status !== "received") return message;
    const updated: Message = {
      ...message,
      status: "acked",
      updatedAt: new Date().toISOString(),
    };
    await this.provider.put(path, encodeMessage(updated));
    return updated;
  }

  /**
   * Mission-51 W4: transition scheduledState. Same CAS-flip pattern
   * as ackMessage. Idempotent — already-at-state returns unchanged.
   */
  async markScheduledState(
    id: string,
    state: import("./message.js").MessageScheduledState,
  ): Promise<Message | null> {
    const provider = this.provider as StorageProvider & {
      getWithToken?: (path: string) => Promise<{ data: Uint8Array; token: string } | null>;
    };
    const path = messagePath(id);

    if (typeof provider.getWithToken === "function") {
      const read = await provider.getWithToken(path);
      if (!read) return null;
      const message = decodeMessage(read.data);
      if (message.scheduledState === state) return message;
      const updated: Message = {
        ...message,
        scheduledState: state,
        updatedAt: new Date().toISOString(),
      };
      const writeResult = await this.provider.putIfMatch(
        path,
        encodeMessage(updated),
        read.token,
      );
      if (writeResult.ok) return updated;
      return this.getMessage(id);
    }

    const message = await this.getMessage(id);
    if (!message) return null;
    if (message.scheduledState === state) return message;
    const updated: Message = {
      ...message,
      scheduledState: state,
      updatedAt: new Date().toISOString(),
    };
    await this.provider.put(path, encodeMessage(updated));
    return updated;
  }
}

// ── Filter helpers ───────────────────────────────────────────────────

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
  // Mission-51 W4: delivery + scheduledState filters.
  if (q.delivery !== undefined && m.delivery !== q.delivery) return false;
  if (q.scheduledState !== undefined && m.scheduledState !== q.scheduledState) return false;
  // Mission-56 W3.1: strict ULID-cursor filter — id > since (lex-asc =
  // time-asc). Same comparison shape as `replayFromCursor` (W1b) so the
  // poll-backstop and SSE-replay paths agree on cursor semantics.
  if (q.since !== undefined && m.id <= q.since) return false;
  return true;
}

// ── Re-exports for convenience ───────────────────────────────────────

export { KIND_AXES };
export type { Message, IMessageStore, CreateMessageInput, MessageQuery } from "./message.js";
