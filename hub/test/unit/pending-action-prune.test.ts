/**
 * Phase 2c preamble — prune_stuck_queue_items tests.
 *
 * Pins the abandon() + listStuck() primitives and the pruner tool's
 * role gate, dry-run semantics, and audit/notification side-effects.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MemoryPendingActionStore } from "../../src/entities/pending-action.js";

describe("MemoryPendingActionStore — abandon()", () => {
  let store: MemoryPendingActionStore;

  beforeEach(() => {
    store = new MemoryPendingActionStore();
  });

  it("transitions a non-terminal item to errored with the supplied reason", async () => {
    const item = await store.enqueue({
      targetAgentId: "agent-1",
      dispatchType: "thread_message",
      entityRef: "thread-1",
      payload: {},
    });
    await store.receiptAck(item.id);
    const result = await store.abandon(item.id, "test abandon");
    expect(result?.state).toBe("errored");
    expect(result?.escalationReason).toBe("test abandon");
  });

  it("is idempotent on items already in terminal states", async () => {
    const item = await store.enqueue({
      targetAgentId: "agent-1",
      dispatchType: "thread_message",
      entityRef: "thread-1",
      payload: {},
    });
    await store.completionAck(item.id);
    const result = await store.abandon(item.id, "should not apply");
    expect(result?.state).toBe("completion_acked");
    expect(result?.escalationReason).toBeNull();
  });

  it("is idempotent on items already abandoned", async () => {
    const item = await store.enqueue({
      targetAgentId: "agent-1",
      dispatchType: "thread_message",
      entityRef: "thread-1",
      payload: {},
    });
    await store.receiptAck(item.id);
    const first = await store.abandon(item.id, "first");
    const second = await store.abandon(item.id, "second");
    expect(first?.escalationReason).toBe("first");
    expect(second?.escalationReason).toBe("first"); // unchanged
  });

  it("returns null for unknown ids", async () => {
    const result = await store.abandon("nonexistent", "test");
    expect(result).toBeNull();
  });
});

describe("MemoryPendingActionStore — listStuck()", () => {
  let store: MemoryPendingActionStore;

  beforeEach(() => {
    store = new MemoryPendingActionStore();
  });

  it("returns only receipt_acked items older than the threshold", async () => {
    const stale = await store.enqueue({
      targetAgentId: "agent-1",
      dispatchType: "thread_message",
      entityRef: "thread-stale",
      payload: {},
    });
    // Backdate the enqueue time to make it stale
    (stale as any).enqueuedAt = new Date(Date.now() - 30 * 60_000).toISOString();
    // Mutate the underlying item too (clone was returned; mutate via store internal)
    const internal = (store as any).items.get(stale.id);
    internal.enqueuedAt = (stale as any).enqueuedAt;
    await store.receiptAck(stale.id);

    const fresh = await store.enqueue({
      targetAgentId: "agent-1",
      dispatchType: "thread_message",
      entityRef: "thread-fresh",
      payload: {},
    });
    await store.receiptAck(fresh.id);

    const stuck = await store.listStuck({ olderThanMs: 10 * 60_000 });
    expect(stuck.length).toBe(1);
    expect(stuck[0].entityRef).toBe("thread-stale");
  });

  it("skips items in enqueued, completion_acked, escalated, errored states", async () => {
    const enq = await store.enqueue({
      targetAgentId: "a",
      dispatchType: "thread_message",
      entityRef: "r-enq",
      payload: {},
    });
    // Backdate
    (store as any).items.get(enq.id).enqueuedAt = new Date(Date.now() - 30 * 60_000).toISOString();
    // Leave in "enqueued" state — should not match

    const completed = await store.enqueue({
      targetAgentId: "a",
      dispatchType: "thread_message",
      entityRef: "r-done",
      payload: {},
    });
    (store as any).items.get(completed.id).enqueuedAt = new Date(Date.now() - 30 * 60_000).toISOString();
    await store.receiptAck(completed.id);
    await store.completionAck(completed.id);

    const abandoned = await store.enqueue({
      targetAgentId: "a",
      dispatchType: "thread_message",
      entityRef: "r-abandon",
      payload: {},
    });
    (store as any).items.get(abandoned.id).enqueuedAt = new Date(Date.now() - 30 * 60_000).toISOString();
    await store.receiptAck(abandoned.id);
    await store.abandon(abandoned.id, "prior");

    const stuck = await store.listStuck({ olderThanMs: 10 * 60_000 });
    expect(stuck.length).toBe(0);
  });

  it("respects dispatchType filter", async () => {
    for (const ref of ["t1", "t2"]) {
      const item = await store.enqueue({
        targetAgentId: "a",
        dispatchType: "thread_message",
        entityRef: ref,
        payload: {},
      });
      (store as any).items.get(item.id).enqueuedAt = new Date(Date.now() - 30 * 60_000).toISOString();
      await store.receiptAck(item.id);
    }
    const taskItem = await store.enqueue({
      targetAgentId: "a",
      dispatchType: "task_issued",
      entityRef: "task-1",
      payload: {},
    });
    (store as any).items.get(taskItem.id).enqueuedAt = new Date(Date.now() - 30 * 60_000).toISOString();
    await store.receiptAck(taskItem.id);

    const threadsOnly = await store.listStuck({ olderThanMs: 10 * 60_000, dispatchType: "thread_message" });
    expect(threadsOnly.length).toBe(2);
    expect(threadsOnly.every(i => i.dispatchType === "thread_message")).toBe(true);

    const tasksOnly = await store.listStuck({ olderThanMs: 10 * 60_000, dispatchType: "task_issued" });
    expect(tasksOnly.length).toBe(1);
  });

  it("respects targetAgentId filter", async () => {
    for (const agent of ["agent-A", "agent-B"]) {
      const item = await store.enqueue({
        targetAgentId: agent,
        dispatchType: "thread_message",
        entityRef: `t-${agent}`,
        payload: {},
      });
      (store as any).items.get(item.id).enqueuedAt = new Date(Date.now() - 30 * 60_000).toISOString();
      await store.receiptAck(item.id);
    }
    const filtered = await store.listStuck({ olderThanMs: 10 * 60_000, targetAgentId: "agent-A" });
    expect(filtered.length).toBe(1);
    expect(filtered[0].targetAgentId).toBe("agent-A");
  });
});

// ── Phase 2d CP3 C1: listNonTerminalByEntityRef ───────────────────────

describe("MemoryPendingActionStore — listNonTerminalByEntityRef (CP3 C1)", () => {
  let store: MemoryPendingActionStore;

  beforeEach(() => {
    store = new MemoryPendingActionStore();
  });

  it("returns items in enqueued + receipt_acked states bound to the ref", async () => {
    const enqueued = await store.enqueue({
      targetAgentId: "agent-1",
      dispatchType: "thread_message",
      entityRef: "thread-42",
      payload: {},
    });
    const acked = await store.enqueue({
      targetAgentId: "agent-2",
      dispatchType: "thread_message",
      entityRef: "thread-42",
      payload: {},
    });
    await store.receiptAck(acked.id);
    // Unrelated entityRef — should NOT appear
    await store.enqueue({
      targetAgentId: "agent-3",
      dispatchType: "thread_message",
      entityRef: "thread-99",
      payload: {},
    });

    const tied = await store.listNonTerminalByEntityRef("thread-42");
    expect(tied.length).toBe(2);
    const states = tied.map((i) => i.state).sort();
    expect(states).toEqual(["enqueued", "receipt_acked"]);
    expect(tied.every((i) => i.entityRef === "thread-42")).toBe(true);
  });

  it("excludes items in terminal states (completion_acked / escalated / errored)", async () => {
    const done = await store.enqueue({
      targetAgentId: "agent-1",
      dispatchType: "thread_message",
      entityRef: "thread-77",
      payload: {},
    });
    const abandoned = await store.enqueue({
      targetAgentId: "agent-2",
      dispatchType: "thread_message",
      entityRef: "thread-77",
      payload: {},
    });
    const escalated = await store.enqueue({
      targetAgentId: "agent-3",
      dispatchType: "thread_message",
      entityRef: "thread-77",
      payload: {},
    });
    await store.completionAck(done.id);
    await store.abandon(abandoned.id, "test");
    await store.escalate(escalated.id, "test");

    const tied = await store.listNonTerminalByEntityRef("thread-77");
    expect(tied.length).toBe(0);
  });

  it("returns empty for a ref with no items", async () => {
    const tied = await store.listNonTerminalByEntityRef("thread-does-not-exist");
    expect(tied).toEqual([]);
  });
});
