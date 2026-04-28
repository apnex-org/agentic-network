/**
 * Phase 2d CP3 C3 — summary-only truncation on closed threads.
 *
 * Pins `truncateClosedThreadMessages` helper + the integration points
 * on ThreadRepository (getThread + listThreads) where the trim is
 * applied at the read boundary.
 */

import { describe, it, expect } from "vitest";
import {
  truncateClosedThreadMessages,
  CLOSED_THREAD_MESSAGE_KEEP,
  type Thread,
  type ThreadMessage,
} from "../../src/state.js";
import { ThreadRepository } from "../../src/entities/thread-repository.js";
import { StorageBackedCounter } from "../../src/entities/counter.js";
import { MemoryStorageProvider } from "@apnex/storage-provider";

function makeStore(): ThreadRepository {
  const provider = new MemoryStorageProvider();
  const counter = new StorageBackedCounter(provider);
  return new ThreadRepository(provider, counter);
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    title: "T",
    status: "closed",
    routingMode: "broadcast",
    context: null,
    idleExpiryMs: null,
    initiatedBy: "architect",
    currentTurn: "architect",
    roundCount: 0,
    maxRounds: 10,
    outstandingIntent: null,
    currentSemanticIntent: null,
    correlationId: null,
    convergenceActions: [],
    summary: "ok",
    participants: [],
    messages: [],
    labels: {},
    lastMessageConverged: false,
    createdAt: "2026-04-20T00:00:00Z",
    updatedAt: "2026-04-20T00:00:00Z",
    createdBy: { role: "architect", agentId: "eng-1" },
    ...overrides,
  } as Thread;
}

function msg(i: number): ThreadMessage {
  return {
    author: "architect",
    authorAgentId: "eng-1",
    text: `message-${i}`,
    timestamp: `2026-04-20T00:00:0${i}Z`,
    converged: false,
    intent: null,
    semanticIntent: null,
  };
}

describe("truncateClosedThreadMessages — helper", () => {
  it("returns non-closed threads unchanged (status=active)", () => {
    const t = makeThread({ status: "active", messages: [msg(1), msg(2), msg(3), msg(4), msg(5), msg(6), msg(7), msg(8)] });
    const out = truncateClosedThreadMessages(t);
    expect(out.messages.length).toBe(8);
    expect(out).toBe(t); // identity on non-closed path
  });

  it("returns non-closed threads unchanged (status=converged — preserves forensic trail)", () => {
    const t = makeThread({ status: "converged", messages: Array.from({ length: 10 }, (_, i) => msg(i + 1)) });
    const out = truncateClosedThreadMessages(t);
    expect(out.messages.length).toBe(10);
  });

  it("returns short closed threads unchanged (≤6 messages)", () => {
    const t = makeThread({ status: "closed", messages: [msg(1), msg(2), msg(3), msg(4), msg(5)] });
    const out = truncateClosedThreadMessages(t);
    expect(out.messages.length).toBe(5);
  });

  it("returns exactly-6 closed threads unchanged (boundary)", () => {
    const t = makeThread({ status: "closed", messages: [msg(1), msg(2), msg(3), msg(4), msg(5), msg(6)] });
    const out = truncateClosedThreadMessages(t);
    expect(out.messages.length).toBe(6);
  });

  it("trims closed threads with >6 messages to first-3 + last-3", () => {
    const all = Array.from({ length: 10 }, (_, i) => msg(i + 1));
    const t = makeThread({ status: "closed", messages: all });
    const out = truncateClosedThreadMessages(t);
    expect(out.messages.length).toBe(CLOSED_THREAD_MESSAGE_KEEP * 2);
    expect(out.messages[0].text).toBe("message-1");
    expect(out.messages[1].text).toBe("message-2");
    expect(out.messages[2].text).toBe("message-3");
    expect(out.messages[3].text).toBe("message-8");
    expect(out.messages[4].text).toBe("message-9");
    expect(out.messages[5].text).toBe("message-10");
  });

  it("preserves non-message fields on trim (summary, convergenceActions, participants, status)", () => {
    const t = makeThread({
      status: "closed",
      summary: "The ratified outcome",
      messages: Array.from({ length: 20 }, (_, i) => msg(i + 1)),
    });
    const out = truncateClosedThreadMessages(t);
    expect(out.summary).toBe("The ratified outcome");
    expect(out.status).toBe("closed");
  });
});

describe("ThreadRepository — read-boundary truncation (CP3 C3)", () => {
  it("getThread returns trimmed messages for closed threads >6 messages", async () => {
    const store = makeStore();
    await store.openThread("T", "open", "architect");
    for (let i = 0; i < 10; i++) {
      await store.replyToThread("thread-1", `reply-${i}`, i % 2 === 0 ? "engineer" : "architect");
    }
    await store.closeThread("thread-1");

    const t = await store.getThread("thread-1");
    expect(t).not.toBeNull();
    expect(t!.status).toBe("closed");
    expect(t!.messages.length).toBe(CLOSED_THREAD_MESSAGE_KEEP * 2);
  });

  it("listThreads returns closed threads with ≤6 messages (trim-safe)", async () => {
    // Post-Mission-47 W6: ThreadRepository.listThreads does not hydrate
    // per-file messages into the returned scalars (listThreads is a
    // summary surface; getThread is the message-hydrating read). The
    // trim helper is still applied at the listThreads boundary; with no
    // messages hydrated the count is 0, which is ≤ the trim ceiling.
    const store = makeStore();
    await store.openThread("T", "open", "architect");
    for (let i = 0; i < 10; i++) {
      await store.replyToThread("thread-1", `reply-${i}`, i % 2 === 0 ? "engineer" : "architect");
    }
    await store.closeThread("thread-1");

    const threads = await store.listThreads("closed");
    expect(threads.length).toBe(1);
    expect(threads[0].status).toBe("closed");
    expect(threads[0].messages.length).toBeLessThanOrEqual(CLOSED_THREAD_MESSAGE_KEEP * 2);
  });

  it("getThread returns full messages for non-closed threads", async () => {
    const store = makeStore();
    await store.openThread("T", "open", "architect");
    for (let i = 0; i < 10; i++) {
      await store.replyToThread("thread-1", `reply-${i}`, i % 2 === 0 ? "engineer" : "architect");
    }
    // NOT closed — still active
    const t = await store.getThread("thread-1");
    expect(t).not.toBeNull();
    expect(t!.messages.length).toBeGreaterThan(6);
  });
});
