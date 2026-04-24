/**
 * PendingActionRepository persistence + FSM tests.
 *
 * Mission-47 W7: `GcsPendingActionStore` deleted; replaced by
 * `PendingActionRepository` composed over any `StorageProvider`.
 * The GCS-specific round-trip behaviour this file used to pin is now
 * covered at two layers:
 *
 *   1. Storage layer — the @ois/storage-provider conformance suite
 *      exercises CAS/createOnly/getWithToken against GcsStorageProvider,
 *      MemoryStorageProvider, and LocalFsStorageProvider identically.
 *   2. Entity layer — this file pins `PendingActionRepository`'s FSM
 *      + persistence semantics against a shared `MemoryStorageProvider`
 *      instance. Two repository instances over the same provider
 *      simulate the "Hub restart" read-after-write assertion that the
 *      prior GcsPendingActionStore tests relied on, without GCS mocks.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStorageProvider } from "@ois/storage-provider";
import { PendingActionRepository } from "../../src/entities/pending-action-repository.js";
import { StorageBackedCounter } from "../../src/entities/counter.js";

describe("PendingActionRepository", () => {
  let provider: MemoryStorageProvider;

  function newStore(): PendingActionRepository {
    // Shared provider + counter so sibling store instances see the same
    // persisted state (the "Hub restart" equivalent).
    const counter = new StorageBackedCounter(provider);
    return new PendingActionRepository(provider, counter);
  }

  beforeEach(() => {
    provider = new MemoryStorageProvider();
  });

  it("enqueue persists item + counter; getById round-trips across a fresh store instance", async () => {
    // Simulate Hub restart: enqueue via one store instance, drop the
    // reference, construct a NEW instance against the same provider,
    // verify getById finds the item.
    const store1 = newStore();
    const item = await store1.enqueue({
      targetAgentId: "agent-1",
      dispatchType: "thread_message",
      entityRef: "thread-1",
      payload: { key: "value" },
    });
    expect(item.id).toMatch(/^pa-/);
    expect(item.state).toBe("enqueued");

    const store2 = newStore();
    const fetched = await store2.getById(item.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.state).toBe("enqueued");
    expect(fetched?.targetAgentId).toBe("agent-1");
    expect(fetched?.payload).toEqual({ key: "value" });
  });

  it("enqueue idempotent on same naturalKey while non-terminal", async () => {
    const store = newStore();
    const a = await store.enqueue({
      targetAgentId: "agent-1",
      dispatchType: "thread_message",
      entityRef: "thread-1",
      payload: {},
    });
    const b = await store.enqueue({
      targetAgentId: "agent-1",
      dispatchType: "thread_message",
      entityRef: "thread-1",
      payload: { differentPayload: true },
    });
    expect(b.id).toBe(a.id);
    // Idempotent — payload didn't get overwritten
    expect(b.payload).toEqual({});
  });

  it("enqueue re-opens when prior item is terminal (completion_acked)", async () => {
    const store = newStore();
    const a = await store.enqueue({
      targetAgentId: "agent-1",
      dispatchType: "thread_message",
      entityRef: "thread-1",
      payload: {},
    });
    await store.receiptAck(a.id);
    await store.completionAck(a.id);
    const b = await store.enqueue({
      targetAgentId: "agent-1",
      dispatchType: "thread_message",
      entityRef: "thread-1",
      payload: {},
    });
    expect(b.id).not.toBe(a.id);
  });

  it("state transitions: receiptAck → completionAck", async () => {
    const store = newStore();
    const item = await store.enqueue({
      targetAgentId: "agent-1",
      dispatchType: "thread_message",
      entityRef: "thread-1",
      payload: {},
    });
    const acked = await store.receiptAck(item.id);
    expect(acked?.state).toBe("receipt_acked");
    expect(acked?.receiptAckedAt).not.toBeNull();
    const completed = await store.completionAck(item.id);
    expect(completed?.state).toBe("completion_acked");
    expect(completed?.completionAckedAt).not.toBeNull();
  });

  it("abandon transitions non-terminal item to errored; idempotent on terminal", async () => {
    const store = newStore();
    const item = await store.enqueue({
      targetAgentId: "agent-1",
      dispatchType: "thread_message",
      entityRef: "thread-1",
      payload: {},
    });
    await store.receiptAck(item.id);
    const abandoned = await store.abandon(item.id, "test");
    expect(abandoned?.state).toBe("errored");
    expect(abandoned?.escalationReason).toBe("test");
    // Idempotent
    const second = await store.abandon(item.id, "different");
    expect(second?.escalationReason).toBe("test");
  });

  it("listStuck scans and filters across fresh store instances (persistence)", async () => {
    const store1 = newStore();
    const stale = await store1.enqueue({
      targetAgentId: "agent-1",
      dispatchType: "thread_message",
      entityRef: "thread-stale",
      payload: {},
    });
    await store1.receiptAck(stale.id);
    // Backdate the persisted enqueuedAt via the repository's test-only
    // escape hatch so the "age" predicate matches.
    await store1.__debugSetItem(stale.id, {
      enqueuedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    });

    // Fresh store instance — still sees the stale item
    const store2 = newStore();
    const stuck = await store2.listStuck({ olderThanMs: 10 * 60_000 });
    expect(stuck.length).toBe(1);
    expect(stuck[0].entityRef).toBe("thread-stale");
  });

  it("incrementAttempt accumulates across calls with persistence", async () => {
    const store = newStore();
    const item = await store.enqueue({
      targetAgentId: "agent-1",
      dispatchType: "thread_message",
      entityRef: "thread-1",
      payload: {},
    });
    await store.incrementAttempt(item.id);
    await store.incrementAttempt(item.id);
    const freshStore = newStore();
    const fetched = await freshStore.getById(item.id);
    expect(fetched?.attemptCount).toBe(2);
    expect(fetched?.lastAttemptAt).not.toBeNull();
  });

  it("saveContinuation transitions an item to continuation_required with the payload persisted (Task 1b)", async () => {
    const store = newStore();
    const item = await store.enqueue({
      targetAgentId: "agent-1",
      dispatchType: "thread_message",
      entityRef: "thread-1",
      payload: {},
    });
    const saved = await store.saveContinuation(item.id, "agent-1", {
      kind: "llm_state",
      snapshot: "architect was mid-analysis",
      currentRound: 12,
    });
    expect(saved).not.toBeNull();
    expect(saved?.state).toBe("continuation_required");
    expect(saved?.continuationState).toEqual({
      kind: "llm_state",
      snapshot: "architect was mid-analysis",
      currentRound: 12,
    });
    expect(saved?.continuationSavedAt).toBeTruthy();

    // Persistence verified across a fresh store instance.
    const freshStore = newStore();
    const fetched = await freshStore.getById(item.id);
    expect(fetched?.state).toBe("continuation_required");
    expect(fetched?.continuationState?.kind).toBe("llm_state");
  });

  it("saveContinuation rejects callers other than the item's targetAgentId (Task 1b authorization)", async () => {
    const store = newStore();
    const item = await store.enqueue({
      targetAgentId: "agent-1",
      dispatchType: "thread_message",
      entityRef: "thread-1",
      payload: {},
    });
    const rejected = await store.saveContinuation(item.id, "imposter-agent", {
      kind: "llm_state",
    });
    expect(rejected).toBeNull();
    const still = await store.getById(item.id);
    expect(still?.state).toBe("enqueued");
  });

  it("saveContinuation rejects transitions from terminal states (Task 1b FSM guard)", async () => {
    const store = newStore();
    const item = await store.enqueue({
      targetAgentId: "agent-1",
      dispatchType: "thread_message",
      entityRef: "thread-1",
      payload: {},
    });
    await store.receiptAck(item.id);
    await store.completionAck(item.id);
    const rejected = await store.saveContinuation(item.id, "agent-1", { kind: "llm_state" });
    expect(rejected).toBeNull();
  });

  it("listContinuationItems returns continuation_required items oldest-first (Task 1b dispatch ordering)", async () => {
    const store = newStore();
    const a = await store.enqueue({ targetAgentId: "agent-1", dispatchType: "thread_message", entityRef: "thread-1", payload: {} });
    const b = await store.enqueue({ targetAgentId: "agent-1", dispatchType: "thread_message", entityRef: "thread-2", payload: {} });
    // A saved first; B saved second with 10ms gap.
    await store.saveContinuation(a.id, "agent-1", { kind: "llm_state", n: 1 });
    await new Promise((r) => setTimeout(r, 10));
    await store.saveContinuation(b.id, "agent-1", { kind: "llm_state", n: 2 });
    const items = await store.listContinuationItems();
    expect(items.map((i) => i.id)).toEqual([a.id, b.id]);
  });

  it("resumeContinuation transitions back to enqueued + returns the saved continuationState (Task 1b re-dispatch)", async () => {
    const store = newStore();
    const item = await store.enqueue({ targetAgentId: "agent-1", dispatchType: "thread_message", entityRef: "thread-1", payload: {} });
    await store.saveContinuation(item.id, "agent-1", { kind: "chunk_buffer", remainingChunks: ["a", "b"] });
    const resumed = await store.resumeContinuation(item.id);
    expect(resumed).not.toBeNull();
    expect(resumed?.continuationState.kind).toBe("chunk_buffer");
    expect(resumed?.item.state).toBe("enqueued");
    expect(resumed?.item.continuationState).toBeUndefined();
    expect(resumed?.item.continuationSavedAt).toBeNull();
  });

  it("resumeContinuation is a no-op on items not in continuation_required (Task 1b guard)", async () => {
    const store = newStore();
    const item = await store.enqueue({ targetAgentId: "agent-1", dispatchType: "thread_message", entityRef: "thread-1", payload: {} });
    const resumed = await store.resumeContinuation(item.id);
    expect(resumed).toBeNull();
  });

  it("listExpired skips terminal states and returns non-terminal past-deadline items", async () => {
    const store = newStore();
    const stale = await store.enqueue({
      targetAgentId: "agent-1",
      dispatchType: "thread_message",
      entityRef: "thread-1",
      payload: {},
    });
    const completed = await store.enqueue({
      targetAgentId: "agent-1",
      dispatchType: "thread_message",
      entityRef: "thread-2",
      payload: {},
    });
    await store.receiptAck(completed.id);
    await store.completionAck(completed.id);
    // Backdate the stale item's receipt deadline so listExpired matches.
    await store.__debugSetItem(stale.id, {
      receiptDeadline: new Date(Date.now() - 60_000).toISOString(),
    });

    const expired = await store.listExpired(Date.now());
    expect(expired.length).toBe(1);
    expect(expired[0].id).toBe(stale.id);
  });
});
