import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../../entities/substrate-counter.js";
import { ProposalRepositorySubstrate } from "../../entities/proposal-repository-substrate.js";
import { ThreadRepositorySubstrate } from "../../entities/thread-repository-substrate.js";
import { PendingActionRepositorySubstrate } from "../../entities/pending-action-repository-substrate.js";
import { PolicyRouter } from "../router.js";
import { registerSystemPolicy } from "../system-policy.js";
import type { AllStores, IPolicyContext } from "../types.js";

function id(prefix: string, i: number): string {
  return `${prefix}-${String(i).padStart(4, "0")}`;
}

function completeResult<T>(items: T[], revision: string) {
  return {
    items,
    pageInfo: {
      complete: true, truncated: false, returnedCount: items.length,
      exactCount: items.length, pagesRead: 1, pageSize: 500,
      snapshotRevision: revision, expectedRevision: revision,
      observedRevision: revision, nextOffset: null, reason: null,
    },
  };
}

function mismatchResult(expectedRevision: string, observedRevision: string) {
  return {
    items: [],
    pageInfo: {
      complete: false, truncated: true, returnedCount: 0,
      exactCount: null, pagesRead: 1, pageSize: 500,
      snapshotRevision: expectedRevision, expectedRevision,
      observedRevision, nextOffset: 0, reason: "snapshot_changed",
    },
  };
}

function incompleteResult<T>(items: T[], revision: string, reason: "safety_limit") {
  return {
    items,
    pageInfo: {
      complete: false, truncated: true, returnedCount: items.length,
      exactCount: null, pagesRead: 1, pageSize: 500,
      snapshotRevision: revision, expectedRevision: revision,
      observedRevision: revision, nextOffset: items.length, reason,
    },
  };
}

function aggregateStores(handlers: {
  pendingAction: () => Promise<unknown>;
  proposal: (status: string, expectedRevision: string) => Promise<unknown>;
  thread: (status: string, filter: Record<string, string> | undefined, expectedRevision: string) => Promise<unknown>;
}): AllStores {
  return {
    engineerRegistry: {
      getRole: () => "architect",
      getAgentForSession: async () => ({ id: "architect-overcap", currentSessionId: "architect-session" }),
    },
    pendingAction: { listForAgentComplete: handlers.pendingAction },
    proposal: { getProposalsComplete: handlers.proposal },
    thread: { listThreadsComplete: handlers.thread },
  } as unknown as AllStores;
}

async function invoke(stores: AllStores): Promise<Record<string, any>> {
  const ctx = {
    stores, emit: async () => {}, dispatch: async () => {},
    sessionId: "architect-session", clientIp: "127.0.0.1", role: "architect",
    internalEvents: [], metrics: { increment: () => {}, snapshot: () => ({}), recentDetails: () => [] },
  } as unknown as IPolicyContext;
  const router = new PolicyRouter(() => {});
  registerSystemPolicy(router);
  const response = await router.handle("get_pending_actions", {}, ctx);
  return JSON.parse(response.content[0]!.text) as Record<string, any>;
}

describe("bug-343 successor get_pending_actions truncation honesty", () => {
  it("fully reconstructs authoritative 675/650/600 dimensions and reports exact paging counts", async () => {
    const substrate = createMemoryStorageSubstrate();
    const counter = new SubstrateCounter(substrate);
    const proposal = new ProposalRepositorySubstrate(substrate, counter);
    const thread = new ThreadRepositorySubstrate(substrate, counter);
    const pendingAction = new PendingActionRepositorySubstrate(substrate, counter);
    const now = "2026-07-23T00:00:00.000Z";

    await Promise.all([
      ...Array.from({ length: 675 }, (_, i) => substrate.put("Proposal", {
        id: id("prop-overcap", i),
        title: `Proposal ${i}`,
        summary: "over-cap",
        proposalRef: `proposals/${i}.md`,
        status: "submitted",
        decision: null,
        feedback: null,
        correlationId: null,
        executionPlan: null,
        scaffoldResult: null,
        labels: {},
        createdAt: now,
        updatedAt: now,
      })),
      ...Array.from({ length: 650 }, (_, i) => substrate.put("Thread", {
        id: id("thread-overcap", i),
        title: `Thread ${i}`,
        status: "active",
        routingMode: "unicast",
        context: null,
        idleExpiryMs: null,
        currentTurn: "architect",
        currentTurnAgentId: null,
        roundCount: 1,
        maxRounds: 10,
        outstandingIntent: null,
        currentSemanticIntent: null,
        correlationId: null,
        convergenceActions: [],
        summary: "",
        participants: [],
        recipientAgentId: null,
        messages: [],
        labels: {},
        lastMessageConverged: false,
        createdAt: now,
        updatedAt: now,
      })),
      ...Array.from({ length: 600 }, (_, i) => substrate.put("PendingAction", {
        id: id("pa-overcap", i),
        targetAgentId: "architect-overcap",
        dispatchType: "thread_message",
        entityRef: id("thread-overcap", i),
        naturalKey: `architect-overcap:${id("thread-overcap", i)}:thread_message`,
        payload: {},
        enqueuedAt: now,
        receiptDeadline: "2099-01-01T00:00:00.000Z",
        completionDeadline: "2099-01-01T00:05:00.000Z",
        receiptAckedAt: i % 2 === 0 ? null : now,
        completionAckedAt: null,
        attemptCount: 0,
        lastAttemptAt: null,
        state: i % 2 === 0 ? "enqueued" : "receipt_acked",
        escalationReason: null,
      })),
    ]);

    const stores = {
      proposal,
      thread,
      pendingAction,
      engineerRegistry: {
        getRole: () => "architect",
        getAgentForSession: async () => ({
          id: "architect-overcap",
          currentSessionId: "architect-session",
        }),
      },
    } as unknown as AllStores;
    const ctx = {
      stores,
      emit: async () => {},
      dispatch: async () => {},
      sessionId: "architect-session",
      clientIp: "127.0.0.1",
      role: "architect",
      internalEvents: [],
      metrics: { increment: () => {}, snapshot: () => ({}), recentDetails: () => [] },
    } as unknown as IPolicyContext;
    const router = new PolicyRouter(() => {});
    registerSystemPolicy(router);

    const response = await router.handle("get_pending_actions", {}, ctx);
    const body = JSON.parse(response.content[0]!.text);

    expect(body.truncated).toBe(false);
    expect(body.complete).toBe(true);
    expect(body.retrieval.complete).toBe(true);
    expect(body.retrieval.aggregateSnapshot).toMatchObject({
      snapshotRevision: body.snapshotRevision,
      attemptsUsed: 1,
      retries: 0,
      maxAttempts: 3,
    });
    expect(new Set(Object.values(body.retrieval.aggregateSnapshot.attempts[0].observedRevisions))).toEqual(
      new Set([body.snapshotRevision]),
    );
    expect(body.pendingProposals).toHaveLength(675);
    // 600 of the 650 architect-turn threads have an in-flight queue item.
    expect(body.threadsAwaitingReply).toHaveLength(50);
    expect(body.totalPending).toBe(725);
    expect(body.visiblePending).toBe(725);
    expect(body.retrieval.derivedCounts).toEqual({
      pendingProposals: 675,
      threadsAwaitingReply: 50,
      convergedThreads: 0,
      danglingProposals: 0,
      totalPending: 725,
    });
    expect(body.retrieval.dimensions.inFlightPendingActions).toMatchObject({
      complete: true, exactCount: 600, returnedCount: 600, pagesRead: 2,
    });
    expect(body.retrieval.dimensions.pendingProposals).toMatchObject({
      complete: true, exactCount: 675, returnedCount: 675, pagesRead: 2,
    });
    expect(body.retrieval.dimensions.activeArchitectThreads).toMatchObject({
      complete: true, exactCount: 650, returnedCount: 650, pagesRead: 2,
    });
  });

  it("retries the whole aggregate and returns only the coherent post-insertion membership", async () => {
    let queueAttempt = 0;
    const pendingForInsertedThread = {
      id: "pa-inserted", dispatchType: "thread_message", entityRef: "thread-scale-0601",
    };
    const insertedThread = {
      id: "thread-scale-0601", title: "inserted", roundCount: 2, outstandingIntent: null,
    };
    const submitted = { id: "proposal-1", title: "P", summary: "s", proposalRef: "p/1" };
    const stores = aggregateStores({
      pendingAction: async () => {
        queueAttempt++;
        return completeResult(queueAttempt === 1 ? [] : [pendingForInsertedThread], queueAttempt === 1 ? "212212" : "212213");
      },
      proposal: async (status, expected) => {
        if (expected === "212212") return mismatchResult(expected, "212213");
        return completeResult(status === "submitted" ? [submitted] : [], expected);
      },
      thread: async (status, _filter, expected) => {
        if (expected === "212212") return mismatchResult(expected, "212213");
        return completeResult(status === "active" ? [insertedThread] : [], expected);
      },
    });

    const body = await invoke(stores);

    expect(queueAttempt).toBe(2);
    expect(body.complete).toBe(true);
    expect(body.snapshotRevision).toBe("212213");
    expect(body.totalPending).toBe(1);
    expect(body.pendingProposals).toHaveLength(1);
    expect(body.threadsAwaitingReply).toEqual([]);
    expect(body.retrieval.aggregateSnapshot).toMatchObject({ attemptsUsed: 2, retries: 1 });
    expect(body.retrieval.aggregateSnapshot.attempts[0]).toMatchObject({
      anchorRevision: "212212", complete: false, retryableDrift: true,
    });
    expect(body.retrieval.aggregateSnapshot.attempts[1]).toMatchObject({
      anchorRevision: "212213", complete: true,
    });
  });

  it("fails actionless and loud after bounded aggregate snapshot retry exhaustion", async () => {
    let queueAttempt = 0;
    const stores = aggregateStores({
      pendingAction: async () => completeResult([], String(212211 + ++queueAttempt)),
      proposal: async (_status, expected) => mismatchResult(expected, String(Number(expected) + 1)),
      thread: async (_status, _filter, expected) => mismatchResult(expected, String(Number(expected) + 1)),
    });

    const body = await invoke(stores);

    expect(queueAttempt).toBe(3);
    expect(body).toMatchObject({
      totalPending: null,
      visiblePending: null,
      truncated: true,
      complete: false,
      snapshotRevision: null,
      pendingProposals: [],
      threadsAwaitingReply: [],
      convergedThreads: [],
    });
    expect(body.retrieval).toMatchObject({
      complete: false,
      reason: "aggregate_snapshot_retry_exhausted",
      retryable: true,
      aggregateSnapshot: { attemptsUsed: 3, retries: 2, maxAttempts: 3 },
    });
    expect(body.retrieval.aggregateSnapshot.attempts.map((attempt: { anchorRevision: string }) => attempt.anchorRevision)).toEqual([
      "212212", "212213", "212214",
    ]);
    expect(body.retrieval.derivedCounts).toEqual({
      pendingProposals: null,
      threadsAwaitingReply: null,
      convergedThreads: null,
      danglingProposals: null,
      totalPending: null,
    });
  });

  it("fails once without aggregate retry when a dimension hits its safety ceiling", async () => {
    let queueAttempt = 0;
    const partial = Array.from({ length: 500 }, (_, i) => ({
      id: id("partial-proposal", i), title: `P${i}`, summary: "s", proposalRef: `p/${i}`,
    }));
    const stores = aggregateStores({
      pendingAction: async () => {
        queueAttempt++;
        return completeResult([], "rv-1");
      },
      proposal: async (status, expected) => status === "submitted"
        ? incompleteResult(partial, expected, "safety_limit")
        : completeResult([], expected),
      thread: async (_status, _filter, expected) => completeResult([], expected),
    });

    const body = await invoke(stores);

    expect(queueAttempt).toBe(1);
    expect(body.totalPending).toBeNull();
    expect(body.visiblePending).toBeNull();
    expect(body.pendingProposals).toEqual([]);
    expect(body.retrieval).toMatchObject({
      complete: false,
      reason: "aggregate_source_incomplete",
      retryable: false,
      aggregateSnapshot: { attemptsUsed: 1, retries: 0 },
    });
    expect(body.retrieval.dimensions.pendingProposals).toMatchObject({
      complete: false,
      exactCount: null,
      returnedCount: 500,
      nextOffset: 500,
      reason: "safety_limit",
    });
  });
});
