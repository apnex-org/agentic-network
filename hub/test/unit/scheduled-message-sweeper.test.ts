/**
 * Mission-51 W4 — ScheduledMessageSweeper unit tests.
 *
 * Covers: sweeper-fire-at-time (synthetic time advance via injected
 * `now` clock), precondition true/false/absent, malformed-fireAt
 * cancel, Hub-restart resumption (fullSweep + state preservation),
 * per-message error isolation, idempotent re-runs.
 *
 * Precondition predicate registry tests live in preconditions.test.ts.
 * W3 retry-interlock tests use this sweeper as a downstream consumer
 * but verify the runner side at runTriggers level.
 */

import { describe, expect, it } from "vitest";
import { MemoryStorageProvider } from "@ois/storage-provider";

import { MessageRepository } from "../../src/entities/message-repository.js";
import { ScheduledMessageSweeper } from "../../src/policy/scheduled-message-sweeper.js";
import { ThreadRepository } from "../../src/entities/thread-repository.js";
import { TaskRepository } from "../../src/entities/task-repository.js";
import { AuditRepository } from "../../src/entities/audit-repository.js";
import { StorageBackedCounter } from "../../src/entities/counter.js";
import type { IPolicyContext } from "../../src/policy/types.js";

const silentLogger = { log: () => {}, warn: () => {} };

async function makeFixture(now: () => number = () => Date.now()) {
  const provider = new MemoryStorageProvider();
  const counter = new StorageBackedCounter(provider);
  const messageStore = new MessageRepository(provider);
  const threadStore = new ThreadRepository(provider, counter);
  const taskStore = new TaskRepository(provider, counter);
  const auditStore = new AuditRepository(provider, counter);
  const ctx: IPolicyContext = {
    stores: {
      message: messageStore,
      thread: threadStore,
      task: taskStore,
      audit: auditStore,
    },
    metrics: { increment: () => {} },
    emit: async () => {},
    dispatch: async () => {},
    sessionId: "test",
    clientIp: "127.0.0.1",
    role: "system",
    internalEvents: [],
    config: { storageBackend: "memory", gcsBucket: "" },
  } as unknown as IPolicyContext;
  const sweeper = new ScheduledMessageSweeper(
    messageStore,
    auditStore,
    { forSweeper: () => ctx },
    { intervalMs: 50, logger: silentLogger, now },
  );
  return { provider, counter, messageStore, threadStore, taskStore, auditStore, sweeper, ctx };
}

const baseScheduledInput = {
  kind: "note" as const,
  authorRole: "system" as const,
  authorAgentId: "hub",
  target: null,
  delivery: "scheduled" as const,
  payload: { reason: "test" },
};

describe("ScheduledMessageSweeper.sweep — fire-at-time", () => {
  it("returns zero-counts when there are no scheduled-pending messages", async () => {
    const { sweeper } = await makeFixture();
    const result = await sweeper.sweep();
    expect(result).toEqual({ scanned: 0, fired: 0, cancelled: 0, errors: 0 });
  });

  it("fires a scheduled-pending message whose fireAt has been reached", async () => {
    let fakeNow = 1_700_000_000_000;
    const { messageStore, sweeper } = await makeFixture(() => fakeNow);
    const fireAt = new Date(fakeNow - 5000).toISOString(); // 5s in the past
    const m = await messageStore.createMessage({
      ...baseScheduledInput,
      fireAt,
    });
    expect(m.scheduledState).toBe("pending");

    const result = await sweeper.sweep();
    expect(result.fired).toBe(1);
    expect(result.cancelled).toBe(0);

    const post = await messageStore.getMessage(m.id);
    expect(post?.scheduledState).toBe("delivered");
  });

  it("does NOT fire a message whose fireAt is in the future", async () => {
    let fakeNow = 1_700_000_000_000;
    const { messageStore, sweeper } = await makeFixture(() => fakeNow);
    const fireAt = new Date(fakeNow + 60_000).toISOString(); // 1min future
    await messageStore.createMessage({ ...baseScheduledInput, fireAt });

    const result = await sweeper.sweep();
    expect(result.fired).toBe(0);
    expect(result.cancelled).toBe(0);
    expect(result.scanned).toBe(1);
  });

  it("cancels a malformed scheduled message (missing fireAt)", async () => {
    const { messageStore, sweeper, auditStore } = await makeFixture();
    const m = await messageStore.createMessage({
      ...baseScheduledInput,
      // no fireAt — malformed
    });
    const result = await sweeper.sweep();
    expect(result.cancelled).toBe(1);

    const post = await messageStore.getMessage(m.id);
    expect(post?.scheduledState).toBe("precondition-failed");

    const auditEntries = await auditStore.listEntries({ limit: 10 });
    const cancelEntry = auditEntries.find(
      (e) => e.action === "scheduled_message_cancelled" && e.relatedEntity === m.id,
    );
    expect(cancelEntry).toBeTruthy();
    expect(cancelEntry?.details).toContain("missing fireAt");
  });

  it("cancels a malformed scheduled message (invalid fireAt)", async () => {
    const { messageStore, sweeper } = await makeFixture();
    const m = await messageStore.createMessage({
      ...baseScheduledInput,
      fireAt: "not-a-date",
    });
    const result = await sweeper.sweep();
    expect(result.cancelled).toBe(1);

    const post = await messageStore.getMessage(m.id);
    expect(post?.scheduledState).toBe("precondition-failed");
  });
});

describe("ScheduledMessageSweeper — precondition evaluation", () => {
  it("fires when precondition is absent (default-true)", async () => {
    let fakeNow = 1_700_000_000_000;
    const { messageStore, sweeper } = await makeFixture(() => fakeNow);
    const fireAt = new Date(fakeNow - 1000).toISOString();
    const m = await messageStore.createMessage({
      ...baseScheduledInput,
      fireAt,
      // no precondition
    });
    await sweeper.sweep();
    const post = await messageStore.getMessage(m.id);
    expect(post?.scheduledState).toBe("delivered");
  });

  it("fires when precondition is satisfied (thread-still-active true)", async () => {
    let fakeNow = 1_700_000_000_000;
    const { messageStore, sweeper, threadStore } = await makeFixture(() => fakeNow);
    const thread = await threadStore.openThread(
      "active-thread",
      "hi",
      "architect",
      { authorAgentId: "arch-1", recipientAgentId: "eng-1" },
    );
    expect(thread.status).toBe("active");

    const fireAt = new Date(fakeNow - 1000).toISOString();
    const m = await messageStore.createMessage({
      ...baseScheduledInput,
      fireAt,
      precondition: { fn: "thread-still-active", args: { threadId: thread.id } },
    });
    const result = await sweeper.sweep();
    expect(result.fired).toBe(1);
    const post = await messageStore.getMessage(m.id);
    expect(post?.scheduledState).toBe("delivered");
  });

  it("cancels when precondition is unsatisfied (thread-still-active false because closed)", async () => {
    let fakeNow = 1_700_000_000_000;
    const { messageStore, sweeper, threadStore } = await makeFixture(() => fakeNow);
    const thread = await threadStore.openThread(
      "to-close",
      "hi",
      "architect",
      { authorAgentId: "arch-1", recipientAgentId: "eng-1" },
    );
    await threadStore.closeThread(thread.id);

    const fireAt = new Date(fakeNow - 1000).toISOString();
    const m = await messageStore.createMessage({
      ...baseScheduledInput,
      fireAt,
      precondition: { fn: "thread-still-active", args: { threadId: thread.id } },
    });
    const result = await sweeper.sweep();
    expect(result.cancelled).toBe(1);

    const post = await messageStore.getMessage(m.id);
    expect(post?.scheduledState).toBe("precondition-failed");
  });

  it("cancels when precondition.fn is not in registry", async () => {
    let fakeNow = 1_700_000_000_000;
    const { messageStore, sweeper, auditStore } = await makeFixture(() => fakeNow);
    const fireAt = new Date(fakeNow - 1000).toISOString();
    const m = await messageStore.createMessage({
      ...baseScheduledInput,
      fireAt,
      precondition: { fn: "nonexistent-predicate", args: {} },
    });
    const result = await sweeper.sweep();
    expect(result.cancelled).toBe(1);

    const auditEntries = await auditStore.listEntries({ limit: 10 });
    const cancelEntry = auditEntries.find(
      (e) => e.relatedEntity === m.id,
    );
    expect(cancelEntry?.details).toMatch(/not in registry|nonexistent-predicate/);
  });
});

describe("ScheduledMessageSweeper — Hub-restart resumption", () => {
  it("fullSweep on startup catches messages that became due during downtime", async () => {
    let fakeNow = 1_700_000_000_000;
    const { messageStore, sweeper } = await makeFixture(() => fakeNow);
    // Message scheduled to fire 1min ago — Hub was down past fireAt.
    const fireAt = new Date(fakeNow - 60_000).toISOString();
    await messageStore.createMessage({ ...baseScheduledInput, fireAt });

    const result = await sweeper.fullSweep();
    expect(result.fired).toBe(1);
  });

  it("idempotent: re-running sweep on already-fired messages is no-op", async () => {
    let fakeNow = 1_700_000_000_000;
    const { messageStore, sweeper } = await makeFixture(() => fakeNow);
    const fireAt = new Date(fakeNow - 1000).toISOString();
    await messageStore.createMessage({ ...baseScheduledInput, fireAt });

    const first = await sweeper.sweep();
    expect(first.fired).toBe(1);
    const second = await sweeper.sweep();
    expect(second.fired).toBe(0);
    expect(second.scanned).toBe(0); // delivered messages are out of scheduledState=pending filter
  });
});

describe("ScheduledMessageSweeper — per-message error isolation", () => {
  it("a failing markScheduledState doesn't abort remaining messages", async () => {
    let fakeNow = 1_700_000_000_000;
    const { messageStore, sweeper } = await makeFixture(() => fakeNow);
    const fireAt = new Date(fakeNow - 1000).toISOString();
    const m1 = await messageStore.createMessage({ ...baseScheduledInput, fireAt });
    const m2 = await messageStore.createMessage({ ...baseScheduledInput, fireAt });
    const m3 = await messageStore.createMessage({ ...baseScheduledInput, fireAt });

    // Inject a transient failure on m2.
    const realMark = messageStore.markScheduledState.bind(messageStore);
    let failedOnce = false;
    (messageStore as unknown as { markScheduledState: typeof realMark }).markScheduledState =
      async (id, state) => {
        if (!failedOnce && id === m2.id) {
          failedOnce = true;
          throw new Error("synthetic test failure");
        }
        return realMark(id, state);
      };

    const result = await sweeper.sweep();
    expect(result.errors).toBe(1);
    // m1 + m3 still fired despite m2 failing.
    expect(result.fired).toBeGreaterThanOrEqual(2);

    const m1Post = await messageStore.getMessage(m1.id);
    const m3Post = await messageStore.getMessage(m3.id);
    expect(m1Post?.scheduledState).toBe("delivered");
    expect(m3Post?.scheduledState).toBe("delivered");
  });
});

describe("ScheduledMessageSweeper — timer lifecycle", () => {
  it("start() then stop() does not leak a timer", async () => {
    const { sweeper } = await makeFixture();
    sweeper.start();
    sweeper.stop();
  });

  it("start() is idempotent", async () => {
    const { sweeper } = await makeFixture();
    sweeper.start();
    sweeper.start();
    sweeper.stop();
  });

  it("stop() is idempotent", async () => {
    const { sweeper } = await makeFixture();
    sweeper.stop();
    sweeper.stop();
  });
});
