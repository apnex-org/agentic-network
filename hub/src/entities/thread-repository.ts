/**
 * ThreadRepository — StorageProvider-backed Thread persistence.
 *
 * Mission-47 W6. Replaces `MemoryThreadStore` (state.ts) +
 * `GcsThreadStore` (gcs-state.ts). Implements `IThreadStore` unchanged
 * — all policy callers (thread-policy, cascade handlers, watchdog)
 * keep working against the same surface.
 *
 * Per-file messages split (Phase 3 P1) preserved:
 *   threads/<threadId>.json                  — thread scalar (no messages[])
 *   threads/<threadId>/messages/<seq>.json   — per-round message entries
 *
 * Reply transform never RMWs an array — each new round appends a new
 * per-file message via `createOnly`. The scalar CAS loop only touches
 * scalars (status, roundCount, turn, convergenceActions, etc.).
 *
 * Thread read ops hydrate the messages[] on-the-fly via a list+get
 * pass under `threads/<id>/messages/`.
 *
 * Helpers `applyStagedActionOps`, `upsertParticipant`, `cloneThread`,
 * `truncateClosedThreadMessages`, `ThreadConvergenceGateError`, and
 * `CONVERGENCE_GATE_REMEDIATION` are imported from state.ts unchanged.
 */

import type { StorageProvider } from "@apnex/storage-provider";
import { hasGetWithToken, StoragePathNotFoundError } from "@apnex/storage-provider";

import type {
  IThreadStore,
  Thread,
  ThreadStatus,
  ThreadAuthor,
  ThreadMessage,
  OpenThreadOptions,
  ReplyToThreadOptions,
  ParticipantRole,
  ReapedThread,
  ConvergenceGateSubtype,
  StagedAction,
} from "../state.js";
import {
  ThreadConvergenceGateError,
  CONVERGENCE_GATE_REMEDIATION,
  applyStagedActionOps,
  upsertParticipant,
  cloneThread,
  truncateClosedThreadMessages,
} from "../state.js";
import { validateStagedActions } from "../policy/staged-action-payloads.js";
import { StorageBackedCounter } from "./counter.js";

const MAX_CAS_RETRIES = 50;

function threadScalarPath(threadId: string): string {
  return `threads/${threadId}.json`;
}

function messagePath(threadId: string, seq: number): string {
  return `threads/${threadId}/messages/${seq}.json`;
}

function encodeThread(t: Thread): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(t, null, 2));
}

function encodeMessage(m: ThreadMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(m, null, 2));
}

function decodeThread(bytes: Uint8Array): Thread {
  return JSON.parse(new TextDecoder().decode(bytes)) as Thread;
}

function decodeMessage(bytes: Uint8Array): ThreadMessage {
  return JSON.parse(new TextDecoder().decode(bytes)) as ThreadMessage;
}

/** Normalise on-read: fill in defaults for legacy fields, widen
 *  pre-ADR-014 routingMode names, etc. Ported verbatim from
 *  gcs-state.ts's private `normalizeThreadShape`. */
function normalizeThreadShape(t: unknown): Thread {
  const raw = t as Record<string, unknown>;
  const convergenceActions = Array.isArray(raw.convergenceActions)
    ? (raw.convergenceActions as unknown[]).map((a) => normalizeStagedActionShape(a))
    : [];
  return {
    ...raw,
    routingMode: normalizeRoutingMode(raw.routingMode),
    context: isThreadContext(raw.context) ? raw.context : null,
    idleExpiryMs: typeof raw.idleExpiryMs === "number" ? raw.idleExpiryMs : null,
    convergenceActions,
    summary: typeof raw.summary === "string" ? raw.summary : "",
    participants: Array.isArray(raw.participants) ? raw.participants : [],
    recipientAgentId: typeof raw.recipientAgentId === "string" ? raw.recipientAgentId : null,
    currentTurnAgentId: typeof raw.currentTurnAgentId === "string" ? raw.currentTurnAgentId : null,
    messages: Array.isArray(raw.messages) ? raw.messages : [],
  } as Thread;
}

function normalizeRoutingMode(v: unknown): "unicast" | "broadcast" | "multicast" {
  if (v === "unicast" || v === "broadcast" || v === "multicast") return v;
  if (v === "targeted") return "unicast";
  if (v === "context_bound") return "multicast";
  return "unicast";
}

function isThreadContext(v: unknown): v is { entityType: string; entityId: string } {
  return typeof v === "object" && v !== null
    && typeof (v as Record<string, unknown>).entityType === "string"
    && typeof (v as Record<string, unknown>).entityId === "string";
}

/** Mission-24 (INV-TH22) backfill: widen legacy `proposer: string` into
 *  `{role, agentId: null}` on read. */
function normalizeStagedActionShape(a: unknown): unknown {
  if (!a || typeof a !== "object") return a;
  const rec = a as Record<string, unknown>;
  if (typeof rec.proposer === "string") {
    return { ...rec, proposer: { role: rec.proposer, agentId: null } };
  }
  return a;
}

class TransitionRejected extends Error {
  constructor(reason: string) {
    super(`transition rejected: ${reason}`);
    this.name = "TransitionRejected";
  }
}

export class ThreadRepository implements IThreadStore {
  constructor(
    private readonly provider: StorageProvider,
    private readonly counter: StorageBackedCounter,
  ) {
    if (!hasGetWithToken(provider)) {
      throw new Error(
        "ThreadRepository requires a StorageProvider with atomic read-with-token support",
      );
    }
  }

  async openThread(
    title: string,
    message: string,
    author: ThreadAuthor,
    options: OpenThreadOptions = {},
  ): Promise<Thread> {
    const {
      maxRounds = 10,
      correlationId,
      labels,
      authorAgentId = null,
      recipientAgentId = null,
      recipientRole = null,
      routingMode = "unicast",
      context = null,
    } = options;
    const num = await this.counter.next("threadCounter");
    const id = `thread-${num}`;
    const now = new Date().toISOString();
    const nextTurn: ThreadAuthor = recipientRole
      ?? (author === "engineer" ? "architect" : "engineer");
    const firstMessage: ThreadMessage = {
      author,
      authorAgentId,
      text: message,
      timestamp: now,
      converged: false,
      intent: null,
      semanticIntent: null,
    };

    const scalar: Thread = {
      id,
      title,
      status: "active",
      routingMode,
      context,
      idleExpiryMs: null,
      createdBy: {
        role: author,
        agentId: authorAgentId ?? `anonymous-${author}`,
      },
      currentTurn: nextTurn,
      currentTurnAgentId: recipientAgentId ?? null,
      roundCount: 1,
      maxRounds,
      outstandingIntent: null,
      currentSemanticIntent: null,
      correlationId: correlationId || null,
      convergenceActions: [],
      summary: "",
      participants: [{
        role: author,
        agentId: authorAgentId,
        joinedAt: now,
        lastActiveAt: now,
      }],
      recipientAgentId: recipientAgentId ?? null,
      messages: [],
      labels: labels || {},
      lastMessageConverged: false,
      createdAt: now,
      updatedAt: now,
    };

    const scalarRes = await this.provider.createOnly(
      threadScalarPath(id),
      encodeThread(scalar),
    );
    if (!scalarRes.ok) {
      throw new Error(
        `[ThreadRepository] openThread: counter issued existing ID ${id}; refusing to clobber`,
      );
    }
    const msgRes = await this.provider.createOnly(
      messagePath(id, 1),
      encodeMessage(firstMessage),
    );
    if (!msgRes.ok) {
      throw new Error(
        `[ThreadRepository] openThread: message-1 for ${id} already exists; refusing to clobber`,
      );
    }
    console.log(`[ThreadRepository] Thread opened: ${id} — ${title}`);
    return { ...scalar, messages: [firstMessage] };
  }

  async replyToThread(
    threadId: string,
    message: string,
    author: ThreadAuthor,
    options: ReplyToThreadOptions = {},
  ): Promise<Thread | null> {
    const {
      converged = false,
      intent = null,
      semanticIntent = null,
      stagedActions = [],
      summary: summaryUpdate,
      authorAgentId = null,
    } = options;

    let thread: Thread;
    try {
      thread = await this.casUpdateOrThrow(threadId, (current) => {
        if (current.status !== "active") throw new TransitionRejected("thread not active");
        if (current.currentTurn !== author) throw new TransitionRejected("not this author's turn");
        if (current.currentTurnAgentId && authorAgentId !== current.currentTurnAgentId) {
          throw new TransitionRejected("not this agent's turn");
        }

        const now = new Date().toISOString();

        applyStagedActionOps(
          current,
          stagedActions,
          { role: author as ParticipantRole, agentId: authorAgentId ?? null },
          now,
        );
        if (summaryUpdate !== undefined) current.summary = summaryUpdate;
        upsertParticipant(current.participants, author, authorAgentId, now);

        current.roundCount++;
        current.outstandingIntent = intent;
        if (semanticIntent) current.currentSemanticIntent = semanticIntent;
        const otherParticipant = current.participants.find(
          (p) => !(p.role === author && p.agentId === authorAgentId) && p.role !== "director",
        );
        if (otherParticipant) {
          current.currentTurn = otherParticipant.role as ThreadAuthor;
          current.currentTurnAgentId = otherParticipant.agentId ?? null;
        } else {
          current.currentTurn = author === "engineer" ? "architect" : "engineer";
          current.currentTurnAgentId = null;
        }
        if (current.routingMode === "broadcast") {
          current.routingMode = "unicast";
        }
        current.updatedAt = now;

        const prevConverged = current.lastMessageConverged ?? false;
        const willConverge = converged && prevConverged;
        current.lastMessageConverged = converged;

        if (willConverge) {
          const staged = current.convergenceActions.filter((a: StagedAction) => a.status === "staged");
          const summaryEmpty = current.summary.trim().length === 0;

          if (staged.length === 0 || summaryEmpty) {
            const reasons: string[] = [];
            if (staged.length === 0) reasons.push("no convergenceActions committed (stage at least one — Phase 1 vocab: close_no_action{reason})");
            if (summaryEmpty) reasons.push("summary is empty (narrate the agreed outcome)");
            const bothMissing = staged.length === 0 && summaryEmpty;
            const subtype: ConvergenceGateSubtype = staged.length === 0 ? "stage_missing" : "summary_missing";
            const remediation = bothMissing
              ? `${CONVERGENCE_GATE_REMEDIATION.stage_missing} Also: ${CONVERGENCE_GATE_REMEDIATION.summary_missing}`
              : undefined;
            throw new ThreadConvergenceGateError(
              `Thread convergence rejected: ${reasons.join("; ")}.`,
              subtype,
              remediation,
            );
          }

          const validation = validateStagedActions(staged);
          if (!validation.ok) {
            const detail = validation.errors
              .map((e) => `${e.actionId} (${e.type}): ${e.error}`)
              .join("; ");
            throw new ThreadConvergenceGateError(
              `Thread convergence rejected: staged action validation failed — ${detail}.`,
              "payload_validation",
            );
          }

          for (const action of current.convergenceActions) {
            if (action.status === "staged") action.status = "committed";
          }
          current.status = "converged";
        }

        if (current.roundCount >= current.maxRounds && current.status === "active") {
          current.status = "round_limit";
        }
        return current;
      });
    } catch (err) {
      if (err instanceof ThreadConvergenceGateError) throw err;
      if (err instanceof TransitionRejected) return null;
      if (err instanceof Error && err.message === `Thread not found: ${threadId}`) return null;
      throw err;
    }

    const newMessage: ThreadMessage = {
      author,
      authorAgentId,
      text: message,
      timestamp: thread.updatedAt,
      converged,
      intent,
      semanticIntent,
    };
    await this.provider.createOnly(
      messagePath(threadId, thread.roundCount),
      encodeMessage(newMessage),
    );

    if (thread.status === "converged") {
      const committedCount = thread.convergenceActions.filter((a: StagedAction) => a.status === "committed").length;
      console.log(`[ThreadRepository] Thread converged: ${threadId} (${committedCount} committed action(s))`);
    } else if (thread.status === "round_limit") {
      console.log(`[ThreadRepository] Thread hit round limit: ${threadId}`);
    }
    console.log(
      `[ThreadRepository] Reply on ${threadId} by ${author}` +
        (authorAgentId ? ` (${authorAgentId})` : "") +
        ` (round ${thread.roundCount}/${thread.maxRounds})`,
    );
    return { ...thread, messages: await this.loadMessages(threadId, thread) };
  }

  async getThread(threadId: string): Promise<Thread | null> {
    const raw = await this.provider.get(threadScalarPath(threadId));
    if (!raw) return null;
    const normalized = normalizeThreadShape(decodeThread(raw));
    const hydrated = { ...normalized, messages: await this.loadMessages(threadId, normalized) };
    return truncateClosedThreadMessages(hydrated);
  }

  async listThreads(status?: ThreadStatus): Promise<Thread[]> {
    const keys = await this.provider.list("threads/");
    const out: Thread[] = [];
    for (const key of keys) {
      if (!key.endsWith(".json")) continue;
      // Filter out per-message files.
      if (key.slice("threads/".length).includes("/")) continue;
      const raw = await this.provider.get(key);
      if (!raw) continue;
      const t = normalizeThreadShape(decodeThread(raw));
      if (status && t.status !== status) continue;
      out.push(truncateClosedThreadMessages(t));
    }
    return out;
  }

  async closeThread(threadId: string): Promise<boolean> {
    try {
      await this.casUpdateOrThrow(threadId, (thread) => {
        thread.status = "closed";
        thread.updatedAt = new Date().toISOString();
        return thread;
      });
      console.log(`[ThreadRepository] Thread closed: ${threadId}`);
      return true;
    } catch (err) {
      if (err instanceof Error && err.message === `Thread not found: ${threadId}`) return false;
      throw err;
    }
  }

  async markCascadeFailed(threadId: string): Promise<boolean> {
    try {
      await this.casUpdateOrThrow(threadId, (thread) => {
        if (thread.status !== "converged" && thread.status !== "active") {
          throw new TransitionRejected(`cannot cascade_fail from status ${thread.status}`);
        }
        thread.status = "cascade_failed";
        thread.updatedAt = new Date().toISOString();
        return thread;
      });
      console.log(`[ThreadRepository] Thread cascade_failed: ${threadId}`);
      return true;
    } catch (err) {
      if (err instanceof TransitionRejected) return false;
      if (err instanceof Error && err.message === `Thread not found: ${threadId}`) return false;
      throw err;
    }
  }

  /**
   * Mission-51 W2: bounded-shadow projection-sweeper progress marker.
   * Forward-progress only — no-op if `projectedAt` is not strictly newer
   * than the current value. Idempotent.
   */
  async markLastMessageProjected(threadId: string, projectedAt: string): Promise<boolean> {
    try {
      let advanced = false;
      await this.casUpdateOrThrow(threadId, (thread) => {
        const current = thread.lastMessageProjectedAt;
        if (current && current >= projectedAt) {
          throw new TransitionRejected(
            `marker not advanced: current ${current} >= proposed ${projectedAt}`,
          );
        }
        thread.lastMessageProjectedAt = projectedAt;
        advanced = true;
        return thread;
      });
      return advanced;
    } catch (err) {
      if (err instanceof TransitionRejected) return false;
      if (err instanceof Error && err.message === `Thread not found: ${threadId}`) return false;
      throw err;
    }
  }

  /**
   * Mission-51 W5: write the cascade-pending marker. Refuses to set
   * if marker is already pending (returns false; existing marker
   * preserved). Idempotent on missing thread (returns false).
   */
  async markCascadePending(threadId: string, actionCount: number): Promise<boolean> {
    try {
      let setNow = false;
      await this.casUpdateOrThrow(threadId, (thread) => {
        if (thread.cascadePending === true) {
          throw new TransitionRejected(
            `cascade marker already pending for thread ${threadId}`,
          );
        }
        thread.cascadePending = true;
        thread.cascadePendingActionCount = actionCount;
        thread.cascadePendingStartedAt = new Date().toISOString();
        setNow = true;
        return thread;
      });
      return setNow;
    } catch (err) {
      if (err instanceof TransitionRejected) return false;
      if (err instanceof Error && err.message === `Thread not found: ${threadId}`) return false;
      throw err;
    }
  }

  /**
   * Mission-51 W5: clear the cascade-pending marker (sets
   * cascadeCompletedAt for telemetry). Idempotent on already-cleared
   * (no-op success) and missing thread (returns false).
   */
  async markCascadeCompleted(threadId: string): Promise<boolean> {
    try {
      await this.casUpdateOrThrow(threadId, (thread) => {
        thread.cascadePending = false;
        thread.cascadePendingActionCount = undefined;
        thread.cascadePendingStartedAt = undefined;
        thread.cascadeCompletedAt = new Date().toISOString();
        return thread;
      });
      return true;
    } catch (err) {
      if (err instanceof Error && err.message === `Thread not found: ${threadId}`) return false;
      throw err;
    }
  }

  /**
   * Mission-51 W5: list threads with cascadePending=true. Called by
   * the Hub-startup CascadeReplaySweeper. Returns hydrated threads
   * (messages + convergenceActions) so the sweeper can re-run
   * runCascade against the committed actions without an extra
   * round-trip.
   */
  async listCascadePending(): Promise<Thread[]> {
    const threadScalars = await this.listThreads();
    const out: Thread[] = [];
    for (const scalar of threadScalars) {
      if (scalar.cascadePending !== true) continue;
      const hydrated = await this.getThread(scalar.id);
      if (hydrated) out.push(hydrated);
    }
    return out;
  }

  async leaveThread(threadId: string, leaverAgentId: string): Promise<Thread | null> {
    let updated: Thread;
    try {
      updated = await this.casUpdateOrThrow(threadId, (current) => {
        if (current.status !== "active") throw new TransitionRejected("thread not active");
        const isParticipant = current.participants.some((p) => p.agentId === leaverAgentId);
        if (!isParticipant) throw new TransitionRejected("leaver is not a thread participant");

        const now = new Date().toISOString();
        for (const action of current.convergenceActions) {
          if (action.status === "staged" && action.proposer.agentId === leaverAgentId) {
            action.status = "retracted";
            action.timestamp = now;
          }
        }
        current.status = "abandoned";
        current.updatedAt = now;
        return current;
      });
    } catch (err) {
      if (err instanceof TransitionRejected) return null;
      if (err instanceof Error && err.message === `Thread not found: ${threadId}`) return null;
      throw err;
    }
    console.log(`[ThreadRepository] Thread abandoned: ${threadId} (leaver=${leaverAgentId})`);
    return { ...updated, messages: await this.loadMessages(threadId, updated) };
  }

  async reapIdleThreads(defaultIdleExpiryMs: number): Promise<ReapedThread[]> {
    const scalars = await this.listThreads("active");
    const now = Date.now();
    const nowIso = new Date().toISOString();
    const reaped: ReapedThread[] = [];
    for (const thread of scalars) {
      const threshold = typeof thread.idleExpiryMs === "number" ? thread.idleExpiryMs : defaultIdleExpiryMs;
      const idleMs = now - new Date(thread.updatedAt).getTime();
      if (idleMs <= threshold) continue;
      try {
        await this.casUpdateOrThrow(thread.id, (current) => {
          if (current.status !== "active") throw new TransitionRejected("not active");
          const reIdleMs = now - new Date(current.updatedAt).getTime();
          const reThreshold = typeof current.idleExpiryMs === "number" ? current.idleExpiryMs : defaultIdleExpiryMs;
          if (reIdleMs <= reThreshold) throw new TransitionRejected("no longer idle");
          for (const action of current.convergenceActions) {
            if (action.status === "staged") {
              action.status = "retracted";
              action.timestamp = nowIso;
            }
          }
          current.status = "abandoned";
          current.updatedAt = nowIso;
          return current;
        });
        reaped.push({
          threadId: thread.id,
          title: thread.title,
          labels: { ...thread.labels },
          participantAgentIds: thread.participants
            .map((p) => p.agentId)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
          idleMs,
        });
        console.log(`[ThreadRepository] Thread reaped (idle ${Math.round(idleMs / 1000)}s): ${thread.id}`);
      } catch (err) {
        if (err instanceof TransitionRejected) continue;
        if (err instanceof Error && err.message === `Thread not found: ${thread.id}`) continue;
        throw err;
      }
    }
    return reaped;
  }

  async unpinCurrentTurnAgent(agentId: string): Promise<string[]> {
    const scalars = await this.listThreads();
    const candidates = scalars.filter((t) => t.currentTurnAgentId === agentId);
    const nowIso = new Date().toISOString();
    const unpinned: string[] = [];
    for (const thread of candidates) {
      try {
        await this.casUpdateOrThrow(thread.id, (current) => {
          if (current.currentTurnAgentId !== agentId) {
            throw new TransitionRejected("no longer pinned to victim");
          }
          current.currentTurnAgentId = null;
          current.updatedAt = nowIso;
          return current;
        });
        unpinned.push(thread.id);
        console.log(`[ThreadRepository] Thread ${thread.id} currentTurnAgentId unpinned via agent reaper (victim=${agentId})`);
      } catch (err) {
        if (err instanceof TransitionRejected) continue;
        if (err instanceof Error && err.message === `Thread not found: ${thread.id}`) continue;
        throw err;
      }
    }
    return unpinned;
  }

  /**
   * Test-only escape hatch: directly patch a thread scalar's on-disk
   * state, bypassing FSM gates. Previously done by poking
   * `(store as any).threads.get(id).field = value` against the legacy
   * MemoryThreadStore's private Map — that Map no longer exists post-W6.
   */
  async __debugSetThread(threadId: string, patch: Partial<Thread>): Promise<void> {
    const path = threadScalarPath(threadId);
    const raw = await this.provider.get(path);
    if (!raw) throw new Error(`[ThreadRepository.__debugSetThread] Thread not found: ${threadId}`);
    const current = normalizeThreadShape(decodeThread(raw));
    const next: Thread = { ...current, ...patch } as Thread;
    await this.provider.put(path, encodeThread(next));
  }

  // ── Internal ─────────────────────────────────────────────────────

  private async loadMessages(threadId: string, scalar: Thread): Promise<ThreadMessage[]> {
    const keys = await this.provider.list(`threads/${threadId}/messages/`);
    if (keys.length === 0) return scalar.messages ?? [];
    const entries: { seq: number; msg: ThreadMessage }[] = [];
    for (const key of keys) {
      if (!key.endsWith(".json")) continue;
      const basename = key.split("/").pop()!;
      const seq = Number(basename.replace(/\.json$/, ""));
      if (!Number.isFinite(seq)) continue;
      const raw = await this.provider.get(key);
      if (!raw) continue;
      entries.push({ seq, msg: decodeMessage(raw) });
    }
    entries.sort((a, b) => a.seq - b.seq);
    return entries.map((e) => ({ ...e.msg, authorAgentId: e.msg.authorAgentId ?? null }));
  }

  /**
   * CAS-update the thread scalar. Returns the updated thread on
   * success; throws `Error(\`Thread not found: ${id}\`)` if missing;
   * lets `TransitionRejected` / `ThreadConvergenceGateError` thrown
   * from the transform propagate (caller decides what to do).
   */
  private async casUpdateOrThrow(
    threadId: string,
    transform: (current: Thread) => Thread,
  ): Promise<Thread> {
    const path = threadScalarPath(threadId);
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const read = await (this.provider as unknown as {
        getWithToken(path: string): Promise<{ data: Uint8Array; token: string } | null>;
      }).getWithToken(path);
      if (read === null) throw new Error(`Thread not found: ${threadId}`);
      const normalized = normalizeThreadShape(decodeThread(read.data));
      // Transform mutates a clone — on throw, the CAS is never attempted.
      const working = cloneThread(normalized);
      const next = transform(working);
      try {
        const result = await this.provider.putIfMatch(path, encodeThread(next), read.token);
        if (result.ok) return next;
      } catch (err) {
        if (err instanceof StoragePathNotFoundError) {
          throw new Error(`Thread not found: ${threadId}`);
        }
        throw err;
      }
    }
    throw new Error(
      `[ThreadRepository] casUpdateOrThrow exhausted ${MAX_CAS_RETRIES} retries on ${threadId}`,
    );
  }
}
