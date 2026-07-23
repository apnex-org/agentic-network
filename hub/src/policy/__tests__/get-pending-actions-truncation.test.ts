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
    expect(body.retrieval.complete).toBe(true);
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

  it("returns null totalPending plus a resumable reason when a source snapshot changes", async () => {
    const complete = <T>(items: T[]) => ({
      items,
      pageInfo: {
        complete: true, truncated: false, returnedCount: items.length,
        exactCount: items.length, pagesRead: 1, pageSize: 500,
        snapshotRevision: "rv-1", nextOffset: null, reason: null,
      },
    });
    const partialProposals = Array.from({ length: 500 }, (_, i) => ({
      id: id("partial-proposal", i), title: `P${i}`, summary: "s", proposalRef: `p/${i}`,
    }));
    const stores = {
      engineerRegistry: {
        getRole: () => "architect",
        getAgentForSession: async () => ({ id: "architect-overcap", currentSessionId: "architect-session" }),
      },
      pendingAction: { listForAgentComplete: async () => complete([]) },
      proposal: {
        getProposalsComplete: async (status: string) => status === "submitted"
          ? {
              items: partialProposals,
              pageInfo: {
                complete: false, truncated: true, returnedCount: 500,
                exactCount: null, pagesRead: 2, pageSize: 500,
                snapshotRevision: "rv-1", nextOffset: 500, reason: "snapshot_changed",
              },
            }
          : complete([]),
      },
      thread: { listThreadsComplete: async () => complete([]) },
    } as unknown as AllStores;
    const ctx = {
      stores, emit: async () => {}, dispatch: async () => {},
      sessionId: "architect-session", clientIp: "127.0.0.1", role: "architect",
      internalEvents: [], metrics: { increment: () => {}, snapshot: () => ({}), recentDetails: () => [] },
    } as unknown as IPolicyContext;
    const router = new PolicyRouter(() => {});
    registerSystemPolicy(router);

    const response = await router.handle("get_pending_actions", {}, ctx);
    const body = JSON.parse(response.content[0]!.text);

    expect(body.totalPending).toBeNull();
    expect(body.visiblePending).toBe(500);
    expect(body.truncated).toBe(true);
    expect(body.retrieval.complete).toBe(false);
    expect(body.retrieval.dimensions.pendingProposals).toMatchObject({
      complete: false,
      truncated: true,
      exactCount: null,
      returnedCount: 500,
      nextOffset: 500,
      reason: "snapshot_changed",
    });
  });
});
