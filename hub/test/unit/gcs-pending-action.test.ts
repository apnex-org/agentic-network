/**
 * Phase 2x P0-1 — GcsPendingActionStore round-trip tests.
 *
 * Exercise the GCS-backed pending-action store against the fake GCS
 * bucket (_gcs-fake.ts) to pin serialization + state-transition
 * semantics. The MemoryPendingActionStore is already covered by
 * pending-action-prune.test.ts; this file pins the GCS-specific
 * behaviour (persistence across Hub restart — simulated by
 * constructing a fresh store instance against the same fake bucket).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { GcsFakeStorage, installGcsFake, gcsFake } from "./_gcs-fake.js";

vi.mock("@google-cloud/storage", () => ({ Storage: GcsFakeStorage }));

const BUCKET = "test-bucket";

describe("GcsPendingActionStore", () => {
  beforeEach(() => {
    installGcsFake();
  });

  it("enqueue persists item + counter; getById round-trips across a fresh store instance", async () => {
    // Simulate Hub restart: create a store, enqueue, drop the reference,
    // create a NEW store instance against the same bucket, verify
    // getById finds the item.
    const { GcsPendingActionStore } = await import("../../src/entities/gcs/gcs-pending-action.js");
    const store1 = new GcsPendingActionStore(BUCKET);
    const item = await store1.enqueue({
      targetAgentId: "agent-1",
      dispatchType: "thread_message",
      entityRef: "thread-1",
      payload: { key: "value" },
    });
    expect(item.id).toMatch(/^pa-/);
    expect(item.state).toBe("enqueued");

    const store2 = new GcsPendingActionStore(BUCKET);
    const fetched = await store2.getById(item.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.state).toBe("enqueued");
    expect(fetched?.targetAgentId).toBe("agent-1");
    expect(fetched?.payload).toEqual({ key: "value" });
  });

  it("enqueue idempotent on same naturalKey while non-terminal", async () => {
    const { GcsPendingActionStore } = await import("../../src/entities/gcs/gcs-pending-action.js");
    const store = new GcsPendingActionStore(BUCKET);
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
    const { GcsPendingActionStore } = await import("../../src/entities/gcs/gcs-pending-action.js");
    const store = new GcsPendingActionStore(BUCKET);
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
    const { GcsPendingActionStore } = await import("../../src/entities/gcs/gcs-pending-action.js");
    const store = new GcsPendingActionStore(BUCKET);
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
    const { GcsPendingActionStore } = await import("../../src/entities/gcs/gcs-pending-action.js");
    const store = new GcsPendingActionStore(BUCKET);
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
    const { GcsPendingActionStore } = await import("../../src/entities/gcs/gcs-pending-action.js");
    const store1 = new GcsPendingActionStore(BUCKET);
    const stale = await store1.enqueue({
      targetAgentId: "agent-1",
      dispatchType: "thread_message",
      entityRef: "thread-stale",
      payload: {},
    });
    await store1.receiptAck(stale.id);
    // Backdate the enqueuedAt on the persisted JSON so the "age" predicate
    // matches. Using the fake's raceWrite to mutate the blob.
    const snapshot = JSON.parse(gcsFake().get(`pending-actions/${stale.id}.json`)!.data.toString("utf-8"));
    snapshot.enqueuedAt = new Date(Date.now() - 30 * 60_000).toISOString();
    gcsFake().raceWrite(`pending-actions/${stale.id}.json`, snapshot);

    // Fresh store instance — still sees the stale item
    const store2 = new GcsPendingActionStore(BUCKET);
    const stuck = await store2.listStuck({ olderThanMs: 10 * 60_000 });
    expect(stuck.length).toBe(1);
    expect(stuck[0].entityRef).toBe("thread-stale");
  });

  it("incrementAttempt accumulates across calls with persistence", async () => {
    const { GcsPendingActionStore } = await import("../../src/entities/gcs/gcs-pending-action.js");
    const store = new GcsPendingActionStore(BUCKET);
    const item = await store.enqueue({
      targetAgentId: "agent-1",
      dispatchType: "thread_message",
      entityRef: "thread-1",
      payload: {},
    });
    await store.incrementAttempt(item.id);
    await store.incrementAttempt(item.id);
    const freshStore = new GcsPendingActionStore(BUCKET);
    const fetched = await freshStore.getById(item.id);
    expect(fetched?.attemptCount).toBe(2);
    expect(fetched?.lastAttemptAt).not.toBeNull();
  });

  it("saveContinuation transitions an item to continuation_required with the payload persisted (Task 1b)", async () => {
    const { GcsPendingActionStore } = await import("../../src/entities/gcs/gcs-pending-action.js");
    const store = new GcsPendingActionStore(BUCKET);
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
    const freshStore = new GcsPendingActionStore(BUCKET);
    const fetched = await freshStore.getById(item.id);
    expect(fetched?.state).toBe("continuation_required");
    expect(fetched?.continuationState?.kind).toBe("llm_state");
  });

  it("saveContinuation rejects callers other than the item's targetAgentId (Task 1b authorization)", async () => {
    const { GcsPendingActionStore } = await import("../../src/entities/gcs/gcs-pending-action.js");
    const store = new GcsPendingActionStore(BUCKET);
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
    const { GcsPendingActionStore } = await import("../../src/entities/gcs/gcs-pending-action.js");
    const store = new GcsPendingActionStore(BUCKET);
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
    const { GcsPendingActionStore } = await import("../../src/entities/gcs/gcs-pending-action.js");
    const store = new GcsPendingActionStore(BUCKET);
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
    const { GcsPendingActionStore } = await import("../../src/entities/gcs/gcs-pending-action.js");
    const store = new GcsPendingActionStore(BUCKET);
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
    const { GcsPendingActionStore } = await import("../../src/entities/gcs/gcs-pending-action.js");
    const store = new GcsPendingActionStore(BUCKET);
    const item = await store.enqueue({ targetAgentId: "agent-1", dispatchType: "thread_message", entityRef: "thread-1", payload: {} });
    const resumed = await store.resumeContinuation(item.id);
    expect(resumed).toBeNull();
  });

  it("listExpired skips terminal states and returns non-terminal past-deadline items", async () => {
    const { GcsPendingActionStore } = await import("../../src/entities/gcs/gcs-pending-action.js");
    const store = new GcsPendingActionStore(BUCKET);
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
    // Backdate stale item's deadline by mutating the persisted JSON
    const snapshot = JSON.parse(gcsFake().get(`pending-actions/${stale.id}.json`)!.data.toString("utf-8"));
    snapshot.receiptDeadline = new Date(Date.now() - 60_000).toISOString();
    gcsFake().raceWrite(`pending-actions/${stale.id}.json`, snapshot);

    const expired = await store.listExpired(Date.now());
    expect(expired.length).toBe(1);
    expect(expired[0].id).toBe(stale.id);
  });
});
