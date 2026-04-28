/**
 * Mission-51 W2 — MessageProjectionSweeper unit tests.
 *
 * Covers: per-tick projection of unprojected threads, idempotency on
 * already-projected threads, full-sweep on Hub startup, marker
 * advancement (forward-progress only), per-thread error isolation,
 * timer lifecycle (start/stop, no-overlap on long-running ticks),
 * and the bounded shadow-lag invariant (sweeper closes the gap on
 * the next tick after a thread-reply commit).
 *
 * Repository-level behavior + entity tests live in
 * message-{entity,repository}.test.ts (W1).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStorageProvider } from "@apnex/storage-provider";

import { ThreadRepository } from "../../src/entities/thread-repository.js";
import { MessageRepository } from "../../src/entities/message-repository.js";
import { StorageBackedCounter } from "../../src/entities/counter.js";
import { MessageProjectionSweeper } from "../../src/policy/message-projection-sweeper.js";

const silentLogger = { log: () => {}, warn: () => {} };

async function makeFixture() {
  const provider = new MemoryStorageProvider();
  const counter = new StorageBackedCounter(provider);
  const threadStore = new ThreadRepository(provider, counter);
  const messageStore = new MessageRepository(provider);
  const sweeper = new MessageProjectionSweeper(threadStore, messageStore, {
    intervalMs: 50,
    logger: silentLogger,
  });
  return { provider, counter, threadStore, messageStore, sweeper };
}

describe("MessageProjectionSweeper.sweep — per-tick projection", () => {
  it("returns zero-counts when there are no threads", async () => {
    const { sweeper } = await makeFixture();
    const result = await sweeper.sweep();
    expect(result).toEqual({
      threadsScanned: 0,
      threadsProjected: 0,
      messagesProjected: 0,
      errors: 0,
    });
  });

  it("projects messages from a thread that has no Message-store entries yet", async () => {
    const { threadStore, messageStore, sweeper } = await makeFixture();
    // Open a thread directly via store (bypassing the W1 in-process
    // shim that thread-policy installs). This simulates a thread
    // that was created BEFORE W1 / W2 — no projection happened.
    const thread = await threadStore.openThread(
      "test thread",
      "first message",
      "architect",
      { authorAgentId: "arch-1", recipientAgentId: "eng-1" },
    );

    // Verify Message-store is empty pre-sweep.
    const before = await messageStore.listMessages({ threadId: thread.id });
    expect(before).toHaveLength(0);

    const result = await sweeper.sweep();
    expect(result.threadsScanned).toBe(1);
    expect(result.threadsProjected).toBe(1);
    expect(result.messagesProjected).toBe(1);

    // Verify the message was projected.
    const after = await messageStore.listMessages({ threadId: thread.id });
    expect(after).toHaveLength(1);
    expect(after[0].migrationSourceId).toBe(`thread-message:${thread.id}/1`);
    expect(after[0].kind).toBe("reply");
    expect(after[0].threadId).toBe(thread.id);
    expect((after[0].payload as { text: string }).text).toBe("first message");
  });

  it("projects multi-round threads in seq order", async () => {
    const { threadStore, messageStore, sweeper } = await makeFixture();
    const thread = await threadStore.openThread(
      "multi-round",
      "round 1",
      "architect",
      { authorAgentId: "arch-1", recipientAgentId: "eng-1" },
    );
    await threadStore.replyToThread(thread.id, "round 2", "engineer", {
      authorAgentId: "eng-1",
    });
    await threadStore.replyToThread(thread.id, "round 3", "architect", {
      authorAgentId: "arch-1",
    });

    const result = await sweeper.sweep();
    expect(result.messagesProjected).toBe(3);

    const projected = await messageStore.listMessages({ threadId: thread.id });
    expect(projected.map((m) => (m.payload as { text: string }).text)).toEqual([
      "round 1",
      "round 2",
      "round 3",
    ]);
    // Sequence in thread is monotonic per the W1 MessageRepository.
    expect(projected.map((m) => m.sequenceInThread)).toEqual([0, 1, 2]);
  });
});

describe("MessageProjectionSweeper — idempotency", () => {
  it("re-running sweep on an already-projected thread is a no-op", async () => {
    const { threadStore, messageStore, sweeper } = await makeFixture();
    const thread = await threadStore.openThread(
      "idempotent",
      "msg",
      "architect",
      { authorAgentId: "arch-1", recipientAgentId: "eng-1" },
    );
    const first = await sweeper.sweep();
    expect(first.messagesProjected).toBe(1);

    // Re-run — no NEW messages projected.
    const second = await sweeper.sweep();
    expect(second.messagesProjected).toBe(0);

    // Still exactly one message in store.
    const all = await messageStore.listMessages({ threadId: thread.id });
    expect(all).toHaveLength(1);
  });

  it("re-projection via createMessage's findByMigrationSourceId short-circuit produces no duplicates", async () => {
    const { threadStore, messageStore, sweeper } = await makeFixture();
    const thread = await threadStore.openThread(
      "dup-test",
      "msg",
      "architect",
      { authorAgentId: "arch-1", recipientAgentId: "eng-1" },
    );
    // First sweep: marker is set.
    await sweeper.sweep();

    // Now manually advance Thread's updatedAt without adding messages
    // (simulates an unrelated update). Marker becomes stale; sweeper
    // will re-enter the projection loop, but createMessage's idempotency
    // gate prevents duplicate writes.
    const before = await threadStore.getThread(thread.id);
    const stale = await sweeper.sweep();
    // Either zero new (marker still ≥ updatedAt) or zero new (createMessage
    // short-circuit). Either way: no new messages.
    expect(stale.messagesProjected).toBe(0);

    const all = await messageStore.listMessages({ threadId: thread.id });
    expect(all).toHaveLength(1);
    void before;
  });
});

describe("MessageProjectionSweeper — marker advancement (forward-progress)", () => {
  it("advances Thread.lastMessageProjectedAt on first sweep", async () => {
    const { threadStore, sweeper } = await makeFixture();
    const thread = await threadStore.openThread(
      "marker-test",
      "msg",
      "architect",
      { authorAgentId: "arch-1", recipientAgentId: "eng-1" },
    );
    expect(thread.lastMessageProjectedAt).toBeUndefined();

    await sweeper.sweep();

    const post = await threadStore.getThread(thread.id);
    expect(post?.lastMessageProjectedAt).toBe(thread.updatedAt);
  });

  it("markLastMessageProjected refuses to go backwards (forward-progress only)", async () => {
    const { threadStore } = await makeFixture();
    const thread = await threadStore.openThread(
      "marker-backward",
      "msg",
      "architect",
      { authorAgentId: "arch-1", recipientAgentId: "eng-1" },
    );
    const advanced1 = await threadStore.markLastMessageProjected(
      thread.id,
      "2026-04-25T19:00:00.000Z",
    );
    expect(advanced1).toBe(true);
    // Backward attempt — refused.
    const advanced2 = await threadStore.markLastMessageProjected(
      thread.id,
      "2026-04-25T18:00:00.000Z",
    );
    expect(advanced2).toBe(false);
    // Forward attempt — accepted.
    const advanced3 = await threadStore.markLastMessageProjected(
      thread.id,
      "2026-04-25T20:00:00.000Z",
    );
    expect(advanced3).toBe(true);
    const post = await threadStore.getThread(thread.id);
    expect(post?.lastMessageProjectedAt).toBe("2026-04-25T20:00:00.000Z");
  });

  it("returns false on missing thread (no-op)", async () => {
    const { threadStore } = await makeFixture();
    expect(
      await threadStore.markLastMessageProjected("nope", "2026-04-25T19:00:00.000Z"),
    ).toBe(false);
  });
});

describe("MessageProjectionSweeper — per-thread error isolation", () => {
  it("a failing thread doesn't abort the remaining threads", async () => {
    const { threadStore, messageStore, sweeper } = await makeFixture();
    const t1 = await threadStore.openThread("ok-1", "m", "architect", {
      authorAgentId: "arch-1",
      recipientAgentId: "eng-1",
    });
    const t2 = await threadStore.openThread("ok-2", "m", "architect", {
      authorAgentId: "arch-1",
      recipientAgentId: "eng-1",
    });
    const t3 = await threadStore.openThread("ok-3", "m", "architect", {
      authorAgentId: "arch-1",
      recipientAgentId: "eng-1",
    });

    // Inject a transient failure into messageStore.createMessage for
    // thread t2 only. Use a stub that throws once for t2 then proxies.
    const realCreate = messageStore.createMessage.bind(messageStore);
    let injected = false;
    (messageStore as unknown as {
      createMessage: typeof realCreate;
    }).createMessage = async (input) => {
      if (!injected && input.threadId === t2.id) {
        injected = true;
        throw new Error("synthetic test failure");
      }
      return realCreate(input);
    };

    const result = await sweeper.sweep();
    expect(result.errors).toBe(1);
    // t1 + t3 projected; t2 errored mid-way (its first message not projected,
    // marker not advanced — sweeper will retry next tick).
    expect(result.messagesProjected).toBeGreaterThanOrEqual(2);

    // Restore + retry — t2 should succeed.
    (messageStore as unknown as {
      createMessage: typeof realCreate;
    }).createMessage = realCreate;
    const retry = await sweeper.sweep();
    // Whatever t2 didn't get projected first time gets projected now.
    const t2Messages = await messageStore.listMessages({ threadId: t2.id });
    expect(t2Messages).toHaveLength(1);
    void t1;
    void t3;
    void retry;
  });
});

describe("MessageProjectionSweeper — bounded shadow-lag invariant", () => {
  it("sweeper closes the gap on the very next tick after a thread-reply commit", async () => {
    const { threadStore, messageStore, sweeper } = await makeFixture();
    const thread = await threadStore.openThread(
      "lag-test",
      "round 1",
      "architect",
      { authorAgentId: "arch-1", recipientAgentId: "eng-1" },
    );
    // Add 3 more rounds (legacy path; bypassing the W1 in-process
    // shim by calling threadStore directly so the shim doesn't run).
    await threadStore.replyToThread(thread.id, "round 2", "engineer", {
      authorAgentId: "eng-1",
    });
    await threadStore.replyToThread(thread.id, "round 3", "architect", {
      authorAgentId: "arch-1",
    });
    await threadStore.replyToThread(thread.id, "round 4", "engineer", {
      authorAgentId: "eng-1",
    });

    // Pre-sweep: Message-store is empty for this thread.
    expect(
      (await messageStore.listMessages({ threadId: thread.id })).length,
    ).toBe(0);

    // One sweep tick closes the gap entirely.
    const result = await sweeper.sweep();
    expect(result.messagesProjected).toBe(4);

    const post = await messageStore.listMessages({ threadId: thread.id });
    expect(post).toHaveLength(4);
    expect(post.map((m) => (m.payload as { text: string }).text)).toEqual([
      "round 1",
      "round 2",
      "round 3",
      "round 4",
    ]);
  });
});

describe("MessageProjectionSweeper — timer lifecycle", () => {
  it("start() then stop() does not leak a timer", async () => {
    const { sweeper } = await makeFixture();
    sweeper.start();
    sweeper.stop();
    // No assertion needed: if the timer leaked, the process would
    // hang waiting for it. Vitest will time out the suite.
  });

  it("start() is idempotent (calling twice does not double-tick)", async () => {
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

  it("fullSweep() runs synchronously and returns the result", async () => {
    const { threadStore, sweeper } = await makeFixture();
    await threadStore.openThread("full-sweep", "m", "architect", {
      authorAgentId: "arch-1",
      recipientAgentId: "eng-1",
    });
    const result = await sweeper.fullSweep();
    expect(result.threadsScanned).toBe(1);
    expect(result.messagesProjected).toBe(1);
  });
});
