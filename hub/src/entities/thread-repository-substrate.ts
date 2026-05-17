/**
 * mission-83 W4.x.10 — ThreadRepositorySubstrate
 *
 * Substrate-API version of ThreadRepository (mission-47 W6 origin). Per Design
 * v1.3 §5.1 Option Y disposition (B) sibling-pattern. Implements IThreadStore
 * interface UNCHANGED (handler call-sites unchanged).
 *
 * FS-layout → substrate-layout MAJOR simplification:
 *   threads/<id>.json                  → substrate(kind="Thread", id=threadId)
 *   threads/<id>/messages/<seq>.json   → DROPPED (per-file-messages split was
 *                                       FS-storage atomicity coupling; substrate
 *                                       embeds messages[] on Thread entity per
 *                                       architect-side Thread SchemaDef comment
 *                                       "messages-thread-index DIY-secondary-
 *                                       index already replaced by W2 SchemaDef
 *                                       expression-index"). Substrate-API write
 *                                       is unified scalar+messages atomic CAS;
 *                                       no separate per-message createOnly needed.
 *
 * Trade-off: large threads with thousands of messages may approach 1.5MB JSONB
 * size cap per Design §2.2. Current scale (max ~50 messages per thread observed
 * in mission-83) well within bounds; W5+ may add per-message kind separation if
 * scale grows.
 *
 * Per-entity logic preserved:
 *   - ID allocation via SubstrateCounter.next("threadCounter") ("thread-N" shape)
 *   - openThread → substrate.createOnly with messages[0] inline (no separate
 *     per-message createOnly)
 *   - replyToThread CAS with full FSM gating: TransitionRejected for status/turn
 *     guards; ThreadConvergenceGateError for convergence validation; staged-
 *     action validation; convergence-trigger semantics (lastMessageConverged AND
 *     converged → status flip)
 *   - applyStagedActionOps + upsertParticipant + cloneThread + normalizeThreadShape
 *     + truncateClosedThreadMessages (state.ts helpers preserved)
 *   - All CAS via Design v1.4 getWithRevision + putIfMatch
 *
 * W4.x.10 — eleventh-slice of W4.x sweep after W4.x.9 TeleRepositorySubstrate.
 */

import type { HubStorageSubstrate } from "../storage-substrate/index.js";
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
import { SubstrateCounter } from "./substrate-counter.js";

const KIND = "Thread";
const MAX_CAS_RETRIES = 50;
const LIST_PREFETCH_CAP = 500;

/** Normalise on-read: fill in defaults for legacy fields. Ported from
 *  ThreadRepository (which ports from gcs-state.ts). */
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

export class ThreadRepositorySubstrate implements IThreadStore {
  constructor(
    private readonly substrate: HubStorageSubstrate,
    private readonly counter: SubstrateCounter,
  ) {}

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

    const thread: Thread = {
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
      messages: [firstMessage],  // EMBEDDED — no separate per-message createOnly
      labels: labels || {},
      lastMessageConverged: false,
      createdAt: now,
      updatedAt: now,
    };

    const result = await this.substrate.createOnly(KIND, thread);
    if (!result.ok) {
      throw new Error(
        `[ThreadRepositorySubstrate] openThread: counter issued existing ID ${id}; refusing to clobber`,
      );
    }
    console.log(`[ThreadRepositorySubstrate] Thread opened: ${id} — ${title}`);
    return thread;
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

        // Append new message INLINE on the entity (substrate-version simplification)
        const newMessage: ThreadMessage = {
          author,
          authorAgentId,
          text: message,
          timestamp: now,
          converged,
          intent,
          semanticIntent,
        };
        current.messages = [...(current.messages ?? []), newMessage];

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

    if (thread.status === "converged") {
      const committedCount = thread.convergenceActions.filter((a: StagedAction) => a.status === "committed").length;
      console.log(`[ThreadRepositorySubstrate] Thread converged: ${threadId} (${committedCount} committed action(s))`);
    } else if (thread.status === "round_limit") {
      console.log(`[ThreadRepositorySubstrate] Thread hit round limit: ${threadId}`);
    }
    console.log(
      `[ThreadRepositorySubstrate] Reply on ${threadId} by ${author}` +
        (authorAgentId ? ` (${authorAgentId})` : "") +
        ` (round ${thread.roundCount}/${thread.maxRounds})`,
    );
    return thread;
  }

  async getThread(threadId: string): Promise<Thread | null> {
    const raw = await this.substrate.get<Thread>(KIND, threadId);
    if (!raw) return null;
    const normalized = normalizeThreadShape(raw);
    return truncateClosedThreadMessages(normalized);
  }

  async listThreads(status?: ThreadStatus): Promise<Thread[]> {
    const substrateFilter: Record<string, string> = {};
    if (status) substrateFilter.status = status;
    const { items } = await this.substrate.list<Thread>(KIND, {
      filter: Object.keys(substrateFilter).length > 0 ? substrateFilter : undefined,
      limit: LIST_PREFETCH_CAP,
    });
    return items.map((t) => truncateClosedThreadMessages(normalizeThreadShape(t)));
  }

  async closeThread(threadId: string): Promise<boolean> {
    try {
      await this.casUpdateOrThrow(threadId, (thread) => {
        thread.status = "closed";
        thread.updatedAt = new Date().toISOString();
        return thread;
      });
      console.log(`[ThreadRepositorySubstrate] Thread closed: ${threadId}`);
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
      console.log(`[ThreadRepositorySubstrate] Thread cascade_failed: ${threadId}`);
      return true;
    } catch (err) {
      if (err instanceof TransitionRejected) return false;
      if (err instanceof Error && err.message === `Thread not found: ${threadId}`) return false;
      throw err;
    }
  }

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

  async listCascadePending(): Promise<Thread[]> {
    const { items } = await this.substrate.list<Thread>(KIND, {
      filter: { cascadePending: true },
      limit: LIST_PREFETCH_CAP,
    });
    return items.map((t) => truncateClosedThreadMessages(normalizeThreadShape(t)));
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
    console.log(`[ThreadRepositorySubstrate] Thread abandoned: ${threadId} (leaver=${leaverAgentId})`);
    return updated;
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
        console.log(`[ThreadRepositorySubstrate] Thread reaped (idle ${Math.round(idleMs / 1000)}s): ${thread.id}`);
      } catch (err) {
        if (err instanceof TransitionRejected) continue;
        if (err instanceof Error && err.message === `Thread not found: ${thread.id}`) continue;
        throw err;
      }
    }
    return reaped;
  }

  async unpinCurrentTurnAgent(agentId: string): Promise<string[]> {
    // Substrate-side filter on thread_turn_agent_idx (SchemaDef v2 hot-path)
    const { items: candidates } = await this.substrate.list<Thread>(KIND, {
      filter: { currentTurnAgentId: agentId },
      limit: LIST_PREFETCH_CAP,
    });
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
        console.log(`[ThreadRepositorySubstrate] Thread ${thread.id} currentTurnAgentId unpinned via agent reaper (victim=${agentId})`);
      } catch (err) {
        if (err instanceof TransitionRejected) continue;
        if (err instanceof Error && err.message === `Thread not found: ${thread.id}`) continue;
        throw err;
      }
    }
    return unpinned;
  }

  /**
   * Test-only escape hatch: directly patch a thread's on-disk state.
   * substrate.put bypass (no CAS).
   */
  async __debugSetThread(threadId: string, patch: Partial<Thread>): Promise<void> {
    const current = await this.substrate.get<Thread>(KIND, threadId);
    if (!current) throw new Error(`[ThreadRepositorySubstrate.__debugSetThread] Thread not found: ${threadId}`);
    const normalized = normalizeThreadShape(current);
    const next: Thread = { ...normalized, ...patch } as Thread;
    await this.substrate.put(KIND, next);
  }

  // ── Internal ─────────────────────────────────────────────────────

  /**
   * CAS-update via Design v1.4 getWithRevision + putIfMatch. Returns the
   * updated thread on success; throws `Error("Thread not found: ${id}")` if
   * missing; lets TransitionRejected / ThreadConvergenceGateError propagate.
   */
  private async casUpdateOrThrow(
    threadId: string,
    transform: (current: Thread) => Thread,
  ): Promise<Thread> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<Thread>(KIND, threadId);
      if (!existing) throw new Error(`Thread not found: ${threadId}`);
      const normalized = normalizeThreadShape(existing.entity);
      const working = cloneThread(normalized);
      const next = transform(working);
      const result = await this.substrate.putIfMatch(KIND, next, existing.resourceVersion);
      if (result.ok) return next;
      // revision-mismatch → retry from re-read
    }
    throw new Error(
      `[ThreadRepositorySubstrate] casUpdateOrThrow exhausted ${MAX_CAS_RETRIES} retries on ${threadId}`,
    );
  }
}
