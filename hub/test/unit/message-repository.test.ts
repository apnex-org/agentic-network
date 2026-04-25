/**
 * Mission-51 W1 — MessageRepository unit tests.
 *
 * Covers: CRUD via repository, multi-membership queries (thread / inbox /
 * outbox), sequenceInThread monotonic allocation, idempotent
 * find-or-create via migrationSourceId, ack-flip lifecycle, ordering
 * invariants for thread-scoped lists.
 */

import { describe, expect, it } from "vitest";
import { MemoryStorageProvider } from "@ois/storage-provider";

import { MessageRepository } from "../../src/entities/message-repository.js";
import type { CreateMessageInput } from "../../src/entities/message.js";

function newRepo(): MessageRepository {
  return new MessageRepository(new MemoryStorageProvider());
}

const baseInput: CreateMessageInput = {
  kind: "reply",
  authorRole: "engineer",
  authorAgentId: "eng-1",
  target: null,
  delivery: "push-immediate",
  payload: { text: "hello" },
};

describe("MessageRepository.createMessage — CRUD basics", () => {
  it("assigns ULID id, sets timestamps, status=new on create", async () => {
    const repo = newRepo();
    const m = await repo.createMessage(baseInput);
    expect(m.id).toMatch(/^[0-9A-Z]{26}$/); // ULID Crockford-base32, 26 chars
    expect(m.status).toBe("new");
    expect(m.createdAt).toBe(m.updatedAt);
    expect(typeof m.createdAt).toBe("string");
  });

  it("getMessage returns the persisted message", async () => {
    const repo = newRepo();
    const created = await repo.createMessage(baseInput);
    const fetched = await repo.getMessage(created.id);
    expect(fetched).toEqual(created);
  });

  it("getMessage returns null for unknown id", async () => {
    const repo = newRepo();
    expect(await repo.getMessage("does-not-exist")).toBeNull();
  });

  it("propagates kind, target, delivery, payload, optional fields verbatim", async () => {
    const repo = newRepo();
    const m = await repo.createMessage({
      ...baseInput,
      kind: "note",
      target: { role: "architect", agentId: "arch-1" },
      delivery: "queued",
      payload: { foo: "bar", n: 42 },
      intent: "decision_needed",
      semanticIntent: "seek_rigorous_critique",
      converged: false,
      escalation: { timeoutMs: 60_000, targetRole: "director" },
    });
    expect(m.kind).toBe("note");
    expect(m.target).toEqual({ role: "architect", agentId: "arch-1" });
    expect(m.delivery).toBe("queued");
    expect(m.payload).toEqual({ foo: "bar", n: 42 });
    expect(m.intent).toBe("decision_needed");
    expect(m.semanticIntent).toBe("seek_rigorous_critique");
    expect(m.converged).toBe(false);
    expect(m.escalation).toEqual({ timeoutMs: 60_000, targetRole: "director" });
  });
});

describe("MessageRepository — sequenceInThread allocation", () => {
  it("first message in a thread gets sequenceInThread=0", async () => {
    const repo = newRepo();
    const m = await repo.createMessage({ ...baseInput, threadId: "thread-A" });
    expect(m.threadId).toBe("thread-A");
    expect(m.sequenceInThread).toBe(0);
  });

  it("subsequent messages in the same thread get monotonically increasing seq", async () => {
    const repo = newRepo();
    const m1 = await repo.createMessage({ ...baseInput, threadId: "thread-A" });
    const m2 = await repo.createMessage({ ...baseInput, threadId: "thread-A" });
    const m3 = await repo.createMessage({ ...baseInput, threadId: "thread-A" });
    expect(m1.sequenceInThread).toBe(0);
    expect(m2.sequenceInThread).toBe(1);
    expect(m3.sequenceInThread).toBe(2);
  });

  it("sequence allocation is independent per thread", async () => {
    const repo = newRepo();
    const a1 = await repo.createMessage({ ...baseInput, threadId: "thread-A" });
    const b1 = await repo.createMessage({ ...baseInput, threadId: "thread-B" });
    const a2 = await repo.createMessage({ ...baseInput, threadId: "thread-A" });
    const b2 = await repo.createMessage({ ...baseInput, threadId: "thread-B" });
    expect(a1.sequenceInThread).toBe(0);
    expect(a2.sequenceInThread).toBe(1);
    expect(b1.sequenceInThread).toBe(0);
    expect(b2.sequenceInThread).toBe(1);
  });

  it("non-thread messages have undefined sequenceInThread + threadId", async () => {
    const repo = newRepo();
    const m = await repo.createMessage(baseInput);
    expect(m.threadId).toBeUndefined();
    expect(m.sequenceInThread).toBeUndefined();
  });

  it("concurrent in-process appends to same thread serialize via mutex (no duplicate seq)", async () => {
    const repo = newRepo();
    const N = 10;
    const created = await Promise.all(
      Array.from({ length: N }, () =>
        repo.createMessage({ ...baseInput, threadId: "thread-X" }),
      ),
    );
    const seqs = created
      .map((m) => m.sequenceInThread!)
      .sort((a, b) => a - b);
    expect(seqs).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("MessageRepository — idempotent find-or-create via migrationSourceId", () => {
  it("first call with migrationSourceId creates; second call returns the same id", async () => {
    const repo = newRepo();
    const first = await repo.createMessage({
      ...baseInput,
      threadId: "thread-A",
      migrationSourceId: "thread-message:thread-A/0",
    });
    const second = await repo.createMessage({
      ...baseInput,
      threadId: "thread-A",
      migrationSourceId: "thread-message:thread-A/0",
    });
    expect(second.id).toBe(first.id);
    expect(second.sequenceInThread).toBe(first.sequenceInThread);
  });

  it("findByMigrationSourceId returns the message", async () => {
    const repo = newRepo();
    const created = await repo.createMessage({
      ...baseInput,
      migrationSourceId: "notification:01HX",
    });
    const found = await repo.findByMigrationSourceId("notification:01HX");
    expect(found?.id).toBe(created.id);
  });

  it("findByMigrationSourceId returns null when absent", async () => {
    const repo = newRepo();
    expect(await repo.findByMigrationSourceId("nope:nada")).toBeNull();
  });

  it("two messages with different migrationSourceIds are distinct entries", async () => {
    const repo = newRepo();
    const a = await repo.createMessage({
      ...baseInput,
      migrationSourceId: "thread-message:t/0",
    });
    const b = await repo.createMessage({
      ...baseInput,
      migrationSourceId: "thread-message:t/1",
    });
    expect(a.id).not.toBe(b.id);
  });
});

describe("MessageRepository.listMessages — multi-membership views", () => {
  it("threadId filter returns thread-scoped messages ordered by sequenceInThread", async () => {
    const repo = newRepo();
    // Interleave thread-A and thread-B writes
    await repo.createMessage({ ...baseInput, threadId: "thread-A" });
    await repo.createMessage({ ...baseInput, threadId: "thread-B" });
    await repo.createMessage({ ...baseInput, threadId: "thread-A" });
    await repo.createMessage({ ...baseInput, threadId: "thread-B" });
    await repo.createMessage({ ...baseInput, threadId: "thread-A" });

    const aMessages = await repo.listMessages({ threadId: "thread-A" });
    const bMessages = await repo.listMessages({ threadId: "thread-B" });
    expect(aMessages.map((m) => m.sequenceInThread)).toEqual([0, 1, 2]);
    expect(bMessages.map((m) => m.sequenceInThread)).toEqual([0, 1]);
  });

  it("targetRole filter (inbox view) returns only matching audience", async () => {
    const repo = newRepo();
    await repo.createMessage({
      ...baseInput,
      target: { role: "architect" },
    });
    await repo.createMessage({
      ...baseInput,
      target: { role: "engineer" },
    });
    await repo.createMessage({ ...baseInput, target: null });

    const archInbox = await repo.listMessages({ targetRole: "architect" });
    expect(archInbox).toHaveLength(1);
    expect(archInbox[0].target).toEqual({ role: "architect" });
  });

  it("targetAgentId filter (pinpoint inbox) returns only that agent's messages", async () => {
    const repo = newRepo();
    await repo.createMessage({
      ...baseInput,
      target: { role: "engineer", agentId: "eng-1" },
    });
    await repo.createMessage({
      ...baseInput,
      target: { role: "engineer", agentId: "eng-2" },
    });

    const eng1Inbox = await repo.listMessages({ targetAgentId: "eng-1" });
    expect(eng1Inbox).toHaveLength(1);
    expect(eng1Inbox[0].target?.agentId).toBe("eng-1");
  });

  it("authorAgentId filter (outbox view) returns only that agent's authored messages", async () => {
    const repo = newRepo();
    await repo.createMessage({ ...baseInput, authorAgentId: "eng-1" });
    await repo.createMessage({ ...baseInput, authorAgentId: "eng-2" });
    await repo.createMessage({ ...baseInput, authorAgentId: "eng-1" });

    const eng1Outbox = await repo.listMessages({ authorAgentId: "eng-1" });
    expect(eng1Outbox).toHaveLength(2);
    expect(eng1Outbox.every((m) => m.authorAgentId === "eng-1")).toBe(true);
  });

  it("status filter combines with target/author filters", async () => {
    const repo = newRepo();
    const m1 = await repo.createMessage({
      ...baseInput,
      target: { role: "architect" },
    });
    await repo.createMessage({
      ...baseInput,
      target: { role: "architect" },
    });
    await repo.ackMessage(m1.id);

    const newOnly = await repo.listMessages({
      targetRole: "architect",
      status: "new",
    });
    const ackedOnly = await repo.listMessages({
      targetRole: "architect",
      status: "acked",
    });
    expect(newOnly).toHaveLength(1);
    expect(ackedOnly).toHaveLength(1);
    expect(ackedOnly[0].id).toBe(m1.id);
  });

  it("listMessages with no filters returns all messages", async () => {
    const repo = newRepo();
    await repo.createMessage(baseInput);
    await repo.createMessage({ ...baseInput, threadId: "t" });
    await repo.createMessage({
      ...baseInput,
      target: { role: "architect" },
    });
    const all = await repo.listMessages({});
    expect(all).toHaveLength(3);
  });
});

describe("MessageRepository.ackMessage — lifecycle flip", () => {
  it("flips status from new → acked, bumps updatedAt", async () => {
    const repo = newRepo();
    const m = await repo.createMessage(baseInput);
    expect(m.status).toBe("new");
    // Ensure timestamp granularity is observable.
    await new Promise((r) => setTimeout(r, 5));
    const acked = await repo.ackMessage(m.id);
    expect(acked).not.toBeNull();
    expect(acked!.status).toBe("acked");
    expect(new Date(acked!.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(m.updatedAt).getTime(),
    );
  });

  it("re-ack on already-acked message is a no-op (idempotent)", async () => {
    const repo = newRepo();
    const m = await repo.createMessage(baseInput);
    const first = await repo.ackMessage(m.id);
    const second = await repo.ackMessage(m.id);
    expect(second).toEqual(first);
  });

  it("ackMessage on non-existent id returns null", async () => {
    const repo = newRepo();
    expect(await repo.ackMessage("missing")).toBeNull();
  });
});

describe("MessageRepository — migration shim parity invariant", () => {
  it("listMessages({threadId}) returns messages in same order as their migrationSourceId pointers", async () => {
    // Simulate the W1 write-through shim: each thread reply at round R
    // creates a Message with migrationSourceId thread-message:t/R.
    // listMessages({threadId}) should return them in seq order, and
    // the seq order should match the order of migrationSourceId pointers.
    const repo = newRepo();
    const tid = "thread-Z";
    const order = [0, 1, 2, 3, 4];
    for (const r of order) {
      await repo.createMessage({
        ...baseInput,
        threadId: tid,
        migrationSourceId: `thread-message:${tid}/${r}`,
      });
    }
    const fetched = await repo.listMessages({ threadId: tid });
    expect(fetched.map((m) => m.migrationSourceId)).toEqual(
      order.map((r) => `thread-message:${tid}/${r}`),
    );
    expect(fetched.map((m) => m.sequenceInThread)).toEqual(order);
  });

  it("idempotent re-projection: re-running shim does not duplicate messages", async () => {
    // Sweeper-replay scenario: first projection writes messages; a
    // second projection (after a simulated crash + restart) MUST NOT
    // produce duplicates. Find-or-create via migrationSourceId guarantees
    // this.
    const repo = newRepo();
    const tid = "thread-Y";
    for (const r of [0, 1, 2]) {
      await repo.createMessage({
        ...baseInput,
        threadId: tid,
        migrationSourceId: `thread-message:${tid}/${r}`,
      });
    }
    // Re-run projection (replay)
    for (const r of [0, 1, 2]) {
      await repo.createMessage({
        ...baseInput,
        threadId: tid,
        migrationSourceId: `thread-message:${tid}/${r}`,
      });
    }
    const fetched = await repo.listMessages({ threadId: tid });
    expect(fetched).toHaveLength(3);
  });
});
