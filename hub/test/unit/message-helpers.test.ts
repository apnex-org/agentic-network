/**
 * Mission-51 W2 — Read-path helpers unit tests.
 *
 * Covers: listMessagesByThread parity vs Thread.messages[];
 * getDerivedThreadFields parity vs Thread stored fields;
 * empty-thread defaults; latest-message-wins for derived fields.
 */

import { describe, expect, it } from "vitest";
import { MemoryStorageProvider } from "@ois/storage-provider";

import { MessageRepository } from "../../src/entities/message-repository.js";
import {
  listMessagesByThread,
  getDerivedThreadFields,
} from "../../src/policy/message-helpers.js";

function newRepo() {
  return new MessageRepository(new MemoryStorageProvider());
}

describe("listMessagesByThread", () => {
  it("returns empty array for thread with no messages", async () => {
    const repo = newRepo();
    expect(await listMessagesByThread(repo, "empty-thread")).toEqual([]);
  });

  it("returns thread-scoped messages ordered by sequenceInThread", async () => {
    const repo = newRepo();
    await repo.createMessage({
      kind: "reply",
      authorRole: "engineer",
      authorAgentId: "eng-1",
      target: null,
      delivery: "push-immediate",
      threadId: "t-1",
      payload: { text: "first" },
    });
    await repo.createMessage({
      kind: "reply",
      authorRole: "architect",
      authorAgentId: "arch-1",
      target: null,
      delivery: "push-immediate",
      threadId: "t-1",
      payload: { text: "second" },
    });
    // Interleave a different thread to verify scoping.
    await repo.createMessage({
      kind: "reply",
      authorRole: "engineer",
      authorAgentId: "eng-1",
      target: null,
      delivery: "push-immediate",
      threadId: "t-2",
      payload: { text: "other thread" },
    });
    await repo.createMessage({
      kind: "reply",
      authorRole: "engineer",
      authorAgentId: "eng-1",
      target: null,
      delivery: "push-immediate",
      threadId: "t-1",
      payload: { text: "third" },
    });

    const t1 = await listMessagesByThread(repo, "t-1");
    expect(t1.map((m) => (m.payload as { text: string }).text)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(t1.map((m) => m.sequenceInThread)).toEqual([0, 1, 2]);
  });
});

describe("getDerivedThreadFields", () => {
  it("returns sentinel-defaults for thread with no messages", async () => {
    const repo = newRepo();
    expect(await getDerivedThreadFields(repo, "empty-thread")).toEqual({
      lastMessageConverged: false,
      outstandingIntent: null,
      currentSemanticIntent: null,
      updatedAt: null,
    });
  });

  it("returns latest-message-wins fields", async () => {
    const repo = newRepo();
    await repo.createMessage({
      kind: "reply",
      authorRole: "engineer",
      authorAgentId: "eng-1",
      target: null,
      delivery: "push-immediate",
      threadId: "t-3",
      payload: { text: "first round" },
      intent: "decision_needed",
      semanticIntent: "seek_rigorous_critique",
      converged: false,
    });
    await repo.createMessage({
      kind: "reply",
      authorRole: "architect",
      authorAgentId: "arch-1",
      target: null,
      delivery: "push-immediate",
      threadId: "t-3",
      payload: { text: "second round" },
      intent: "agreement_pending",
      semanticIntent: "seek_consensus",
      converged: true,
    });

    const derived = await getDerivedThreadFields(repo, "t-3");
    expect(derived.lastMessageConverged).toBe(true);
    expect(derived.outstandingIntent).toBe("agreement_pending");
    expect(derived.currentSemanticIntent).toBe("seek_consensus");
    expect(derived.updatedAt).toBeTruthy();
  });

  it("treats absent converged/intent/semanticIntent on the latest message as null/false", async () => {
    const repo = newRepo();
    await repo.createMessage({
      kind: "reply",
      authorRole: "engineer",
      authorAgentId: "eng-1",
      target: null,
      delivery: "push-immediate",
      threadId: "t-4",
      payload: { text: "no metadata" },
      // Intentionally omit converged / intent / semanticIntent.
    });

    const derived = await getDerivedThreadFields(repo, "t-4");
    expect(derived.lastMessageConverged).toBe(false);
    expect(derived.outstandingIntent).toBeNull();
    expect(derived.currentSemanticIntent).toBeNull();
    expect(derived.updatedAt).toBeTruthy();
  });

  it("uses updatedAt of the latest message (not the first)", async () => {
    const repo = newRepo();
    await repo.createMessage({
      kind: "reply",
      authorRole: "engineer",
      authorAgentId: "eng-1",
      target: null,
      delivery: "push-immediate",
      threadId: "t-5",
      payload: { text: "first" },
    });
    // Tiny delay to ensure observable timestamp difference.
    await new Promise((r) => setTimeout(r, 5));
    await repo.createMessage({
      kind: "reply",
      authorRole: "architect",
      authorAgentId: "arch-1",
      target: null,
      delivery: "push-immediate",
      threadId: "t-5",
      payload: { text: "second" },
    });

    const messages = await listMessagesByThread(repo, "t-5");
    const derived = await getDerivedThreadFields(repo, "t-5");
    // updatedAt should match the latest message, not the first.
    expect(derived.updatedAt).toBe(messages[1].updatedAt);
    expect(derived.updatedAt).not.toBe(messages[0].updatedAt);
  });
});
