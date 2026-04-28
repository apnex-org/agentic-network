/**
 * Mission-51 W1 — MessageRepository unit tests.
 *
 * Covers: CRUD via repository, multi-membership queries (thread / inbox /
 * outbox), sequenceInThread monotonic allocation, idempotent
 * find-or-create via migrationSourceId, ack-flip lifecycle, ordering
 * invariants for thread-scoped lists.
 */

import { describe, expect, it } from "vitest";
import { MemoryStorageProvider } from "@apnex/storage-provider";

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
    expect(second.agentId).toBe(first.agentId);
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
    // Mission-56 W3.2: ack now requires prior claim (FSM new→received→acked).
    await repo.claimMessage(m1.id, "test-agent");
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

// ── Mission-56 W3.1 — listMessages.since cursor tests ────────────────

describe("MessageRepository.listMessages — since cursor (mission-56 W3.1)", () => {
  it("since undefined: returns all matching (no cursor filter)", async () => {
    const repo = newRepo();
    await repo.createMessage({ ...baseInput, target: { role: "architect" } });
    await repo.createMessage({ ...baseInput, target: { role: "architect" } });
    await repo.createMessage({ ...baseInput, target: { role: "architect" } });

    const all = await repo.listMessages({ targetRole: "architect" });
    expect(all).toHaveLength(3);
  });

  it("since cursor: strictly excludes IDs <= since (ULID lex-asc)", async () => {
    const repo = newRepo();
    const m1 = await repo.createMessage({ ...baseInput, target: { role: "architect" } });
    const m2 = await repo.createMessage({ ...baseInput, target: { role: "architect" } });
    const m3 = await repo.createMessage({ ...baseInput, target: { role: "architect" } });

    const delta = await repo.listMessages({
      targetRole: "architect",
      since: m1.id,
    });
    // Strict: m1 itself excluded; m2 + m3 included.
    expect(delta.map((m) => m.id).sort()).toEqual([m2.id, m3.id].sort());
  });

  it("since matching most recent: returns empty (no delta to deliver)", async () => {
    const repo = newRepo();
    await repo.createMessage({ ...baseInput, target: { role: "architect" } });
    const m2 = await repo.createMessage({ ...baseInput, target: { role: "architect" } });

    const delta = await repo.listMessages({
      targetRole: "architect",
      since: m2.id,
    });
    expect(delta).toEqual([]);
  });

  it("since combines with status filter (poll-backstop pattern: new + delta)", async () => {
    const repo = newRepo();
    const m1 = await repo.createMessage({ ...baseInput, target: { role: "engineer" } });
    const m2 = await repo.createMessage({ ...baseInput, target: { role: "engineer" } });
    const m3 = await repo.createMessage({ ...baseInput, target: { role: "engineer" } });
    // Adapter has claim+acked m1; poll-backstop wants new-since-m1.
    await repo.claimMessage(m1.id, "test-agent");
    await repo.ackMessage(m1.id);

    const delta = await repo.listMessages({
      targetRole: "engineer",
      status: "new",
      since: m1.id,
    });
    // m1 excluded by both since (strict) AND status (acked). m2 + m3 included.
    expect(delta.map((m) => m.id).sort()).toEqual([m2.id, m3.id].sort());
  });

  it("since combines with targetAgentId (pinpoint poll-backstop)", async () => {
    const repo = newRepo();
    const m1 = await repo.createMessage({
      ...baseInput,
      target: { role: "engineer", agentId: "eng-7" },
    });
    await repo.createMessage({
      ...baseInput,
      target: { role: "engineer", agentId: "eng-3" },
    });
    const m3 = await repo.createMessage({
      ...baseInput,
      target: { role: "engineer", agentId: "eng-7" },
    });

    const delta = await repo.listMessages({
      targetAgentId: "eng-7",
      since: m1.id,
    });
    // Only eng-7 messages with id > m1.id; only m3 matches.
    expect(delta.map((m) => m.id)).toEqual([m3.id]);
  });

  it("since on threadId-scoped query: excludes thread messages with id <= since", async () => {
    const repo = newRepo();
    // Thread-A messages — sequenceInThread allocated, but cursor filter is on ULID id.
    const m1 = await repo.createMessage({ ...baseInput, threadId: "thread-A" });
    const m2 = await repo.createMessage({ ...baseInput, threadId: "thread-A" });
    const m3 = await repo.createMessage({ ...baseInput, threadId: "thread-A" });

    const delta = await repo.listMessages({
      threadId: "thread-A",
      since: m1.id,
    });
    // m1 excluded; thread order preserved (sequenceInThread asc).
    expect(delta.map((m) => m.id)).toEqual([m2.id, m3.id]);
    expect(delta.map((m) => m.sequenceInThread)).toEqual([1, 2]);
  });

  it("since with non-existent cursor (forged future ULID): returns empty", async () => {
    const repo = newRepo();
    await repo.createMessage({ ...baseInput, target: { role: "architect" } });
    await repo.createMessage({ ...baseInput, target: { role: "architect" } });

    // ULID max sentinel — strictly greater than any allocated ULID.
    const delta = await repo.listMessages({
      targetRole: "architect",
      since: "ZZZZZZZZZZZZZZZZZZZZZZZZZZ",
    });
    expect(delta).toEqual([]);
  });

  it("since cursor matches replayFromCursor semantics (same delta on shared inputs)", async () => {
    const repo = newRepo();
    const m1 = await repo.createMessage({ ...baseInput, target: { role: "architect" } });
    await repo.createMessage({ ...baseInput, target: { role: "architect" } });
    await repo.createMessage({ ...baseInput, target: { role: "architect" } });

    const viaList = await repo.listMessages({
      targetRole: "architect",
      status: "new",
      since: m1.id,
    });
    const viaReplay = await repo.replayFromCursor({
      targetRole: "architect",
      status: "new",
      since: m1.id,
      limit: 1000,
    });
    // Cursor + filter semantics agree across the two query surfaces.
    expect(viaList.map((m) => m.id).sort()).toEqual(viaReplay.map((m) => m.id).sort());
  });
});

// ── Mission-56 W1b — replayFromCursor tests ──────────────────────────

describe("MessageRepository.replayFromCursor — Hub-internal cursor query", () => {
  it("cold-start (no since): returns all matching ordered by id ASC", async () => {
    const repo = newRepo();
    const m1 = await repo.createMessage({ ...baseInput, target: { role: "architect" } });
    const m2 = await repo.createMessage({ ...baseInput, target: { role: "architect" } });
    const m3 = await repo.createMessage({ ...baseInput, target: { role: "architect" } });

    const replay = await repo.replayFromCursor({
      targetRole: "architect",
      status: "new",
      limit: 1000,
    });
    expect(replay).toHaveLength(3);
    expect(replay.map((m) => m.id)).toEqual([m1.id, m2.id, m3.id]);
  });

  it("cursor (since): filters out IDs <= since (ULID lex-asc)", async () => {
    const repo = newRepo();
    const m1 = await repo.createMessage({ ...baseInput, target: { role: "architect" } });
    const m2 = await repo.createMessage({ ...baseInput, target: { role: "architect" } });
    const m3 = await repo.createMessage({ ...baseInput, target: { role: "architect" } });

    const replay = await repo.replayFromCursor({
      since: m1.id,
      targetRole: "architect",
      status: "new",
      limit: 1000,
    });
    // m1 itself excluded (since strictly greater); m2 + m3 included.
    expect(replay.map((m) => m.id)).toEqual([m2.id, m3.id]);
  });

  it("since matching most recent: returns empty (caller continues to live emit)", async () => {
    const repo = newRepo();
    await repo.createMessage({ ...baseInput, target: { role: "architect" } });
    const m2 = await repo.createMessage({ ...baseInput, target: { role: "architect" } });

    const replay = await repo.replayFromCursor({
      since: m2.id,
      targetRole: "architect",
      status: "new",
      limit: 1000,
    });
    expect(replay).toEqual([]);
  });

  it("limit caps result size; caller signals replay-truncated when length === limit", async () => {
    const repo = newRepo();
    for (let i = 0; i < 5; i++) {
      await repo.createMessage({ ...baseInput, target: { role: "architect" } });
    }

    const replay = await repo.replayFromCursor({
      targetRole: "architect",
      status: "new",
      limit: 3,
    });
    expect(replay).toHaveLength(3);
    // Caller reads .length === limit as soft-cap-hit signal.
  });

  it("targetRole filter: only returns Messages whose target.role matches", async () => {
    const repo = newRepo();
    await repo.createMessage({ ...baseInput, target: { role: "architect" } });
    await repo.createMessage({ ...baseInput, target: { role: "engineer" } });
    await repo.createMessage({ ...baseInput, target: { role: "architect" } });

    const replay = await repo.replayFromCursor({
      targetRole: "architect",
      status: "new",
      limit: 1000,
    });
    expect(replay).toHaveLength(2);
    expect(replay.every((m) => m.target?.role === "architect")).toBe(true);
  });

  it("targetAgentId filter: pins to a specific agent (AND with role)", async () => {
    const repo = newRepo();
    await repo.createMessage({ ...baseInput, target: { role: "engineer", agentId: "eng-7" } });
    await repo.createMessage({ ...baseInput, target: { role: "engineer", agentId: "eng-3" } });
    await repo.createMessage({ ...baseInput, target: { role: "engineer", agentId: "eng-7" } });

    const replay = await repo.replayFromCursor({
      targetRole: "engineer",
      targetAgentId: "eng-7",
      status: "new",
      limit: 1000,
    });
    expect(replay).toHaveLength(2);
    expect(replay.every((m) => m.target?.agentId === "eng-7")).toBe(true);
  });

  it("status filter: excludes acked Messages from replay", async () => {
    const repo = newRepo();
    const m1 = await repo.createMessage({ ...baseInput, target: { role: "architect" } });
    await repo.createMessage({ ...baseInput, target: { role: "architect" } });
    // Mission-56 W3.2: claim before ack (FSM new→received→acked).
    await repo.claimMessage(m1.id, "test-agent");
    await repo.ackMessage(m1.id);

    const replay = await repo.replayFromCursor({
      targetRole: "architect",
      status: "new",
      limit: 1000,
    });
    expect(replay).toHaveLength(1);
    expect(replay[0].id).not.toBe(m1.id);
  });

  it("broadcast Messages (target=null) NOT replayed (only targeted Messages match)", async () => {
    const repo = newRepo();
    await repo.createMessage({ ...baseInput, target: null });
    await repo.createMessage({ ...baseInput, target: { role: "architect" } });

    const replay = await repo.replayFromCursor({
      targetRole: "architect",
      status: "new",
      limit: 1000,
    });
    // Only the targeted message; broadcast excluded by targetRole filter.
    expect(replay).toHaveLength(1);
    expect(replay[0].target?.role).toBe("architect");
  });

  it("forward-compat: cursor + cold-start composes (since=undefined coexists with status filter)", async () => {
    const repo = newRepo();
    await repo.createMessage({ ...baseInput, target: { role: "architect" } });

    // No `since` AND with status filter → cold-start path with status.
    const replay = await repo.replayFromCursor({
      targetRole: "architect",
      status: "new",
      limit: 1000,
    });
    expect(replay).toHaveLength(1);
  });
});

describe("MessageRepository.ackMessage — lifecycle flip (post-W3.2 FSM)", () => {
  it("flips status from received → acked, bumps updatedAt", async () => {
    const repo = newRepo();
    const m = await repo.createMessage(baseInput);
    expect(m.status).toBe("new");
    await repo.claimMessage(m.id, "test-agent");
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
    await repo.claimMessage(m.id, "test-agent");
    const first = await repo.ackMessage(m.id);
    const second = await repo.ackMessage(m.id);
    expect(second).toEqual(first);
  });

  it("ackMessage on non-existent id returns null", async () => {
    const repo = newRepo();
    expect(await repo.ackMessage("missing")).toBeNull();
  });
});

// ── Mission-56 W3.2 — claim/ack FSM tests ────────────────────────────

describe("MessageRepository.claimMessage — winner-takes-all CAS (mission-56 W3.2)", () => {
  it("flips status new → received and records claimedBy on first claim", async () => {
    const repo = newRepo();
    const m = await repo.createMessage(baseInput);
    expect(m.status).toBe("new");
    expect(m.claimedBy).toBeUndefined();

    const claimed = await repo.claimMessage(m.id, "agent-A");
    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe("received");
    expect(claimed!.claimedBy).toBe("agent-A");
  });

  it("idempotent on already-claimed by same agent (returns existing state)", async () => {
    const repo = newRepo();
    const m = await repo.createMessage(baseInput);
    const first = await repo.claimMessage(m.id, "agent-A");
    const second = await repo.claimMessage(m.id, "agent-A");
    expect(second).toEqual(first);
    expect(second!.claimedBy).toBe("agent-A");
  });

  it("multi-agent same-role: winner-takes-all (loser sees winner's claimedBy)", async () => {
    const repo = newRepo();
    const m = await repo.createMessage(baseInput);
    // agent-A wins by claiming first.
    const winnerView = await repo.claimMessage(m.id, "agent-A");
    // agent-B (loser) sees existing state with claimedBy = "agent-A".
    const loserView = await repo.claimMessage(m.id, "agent-B");
    expect(loserView).not.toBeNull();
    expect(loserView!.status).toBe("received");
    expect(loserView!.claimedBy).toBe("agent-A");
    expect(loserView!.id).toBe(winnerView!.id);
  });

  it("claim on already-acked message returns existing acked state (claim too late)", async () => {
    const repo = newRepo();
    const m = await repo.createMessage(baseInput);
    await repo.claimMessage(m.id, "agent-A");
    await repo.ackMessage(m.id);

    const lateClaim = await repo.claimMessage(m.id, "agent-B");
    expect(lateClaim).not.toBeNull();
    expect(lateClaim!.status).toBe("acked");
    // claimedBy preserved from original winner; not overwritten by late claimer.
    expect(lateClaim!.claimedBy).toBe("agent-A");
  });

  it("claim on non-existent id returns null", async () => {
    const repo = newRepo();
    expect(await repo.claimMessage("missing", "agent-A")).toBeNull();
  });

  it("listMessages({status: 'received'}) surfaces claimed-but-not-acked messages", async () => {
    const repo = newRepo();
    const m1 = await repo.createMessage({ ...baseInput, target: { role: "engineer" } });
    const m2 = await repo.createMessage({ ...baseInput, target: { role: "engineer" } });
    const m3 = await repo.createMessage({ ...baseInput, target: { role: "engineer" } });
    // Claim m1 + m2; ack m1; m3 stays new.
    await repo.claimMessage(m1.id, "agent-A");
    await repo.claimMessage(m2.id, "agent-A");
    await repo.ackMessage(m1.id);

    const received = await repo.listMessages({
      targetRole: "engineer",
      status: "received",
    });
    expect(received).toHaveLength(1);
    expect(received[0].id).toBe(m2.id);
  });
});

describe("MessageRepository.ackMessage — FSM tightening (mission-56 W3.2)", () => {
  it("ack on `new` is a no-op (returns unchanged; caller should claim first)", async () => {
    const repo = newRepo();
    const m = await repo.createMessage(baseInput);
    expect(m.status).toBe("new");

    const result = await repo.ackMessage(m.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("new"); // FSM-violation observation; no flip.
  });

  it("ack on `received` flips to `acked`", async () => {
    const repo = newRepo();
    const m = await repo.createMessage(baseInput);
    await repo.claimMessage(m.id, "agent-A");

    const acked = await repo.ackMessage(m.id);
    expect(acked!.status).toBe("acked");
    // claimedBy preserved across ack flip.
    expect(acked!.claimedBy).toBe("agent-A");
  });

  it("MESSAGE_STATUSES enum includes the W3.2 'received' state", async () => {
    // Module-level enum access; protects against accidental enum-shape regression.
    const { MESSAGE_STATUSES } = await import("../../src/entities/message.js");
    expect(MESSAGE_STATUSES).toContain("new");
    expect(MESSAGE_STATUSES).toContain("received");
    expect(MESSAGE_STATUSES).toContain("acked");
    expect(MESSAGE_STATUSES.length).toBe(3);
  });

  it("FSM monotonicity: full new → received → acked roundtrip preserves invariants", async () => {
    const repo = newRepo();
    const m0 = await repo.createMessage(baseInput);
    expect(m0.status).toBe("new");
    expect(m0.claimedBy).toBeUndefined();

    const m1 = await repo.claimMessage(m0.id, "agent-A");
    expect(m1!.status).toBe("received");
    expect(m1!.claimedBy).toBe("agent-A");

    const m2 = await repo.ackMessage(m0.id);
    expect(m2!.status).toBe("acked");
    expect(m2!.claimedBy).toBe("agent-A");

    // No regress: idempotent re-ack stays at acked.
    const m3 = await repo.ackMessage(m0.id);
    expect(m3).toEqual(m2);
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
