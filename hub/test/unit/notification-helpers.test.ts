/**
 * Mission-56 W4.2 — Notification → Message migration helper tests.
 *
 * Pins:
 *   - emitLegacyNotification produces a Message with the canonical
 *     wire shape (kind=external-injection + system/hub author +
 *     target=null broadcast + delivery=push-immediate +
 *     payload-preserves-{event,data,targetRoles}).
 *   - Returned Message.id is a fresh ULID; status defaults to "new".
 *   - Multi-role targetRoles preserved verbatim in payload (no fanout
 *     into multiple Messages).
 *   - Empty data payload still parses cleanly.
 */

import { describe, expect, it } from "vitest";
import { MemoryStorageProvider } from "@apnex/storage-provider";

import { MessageRepository } from "../../src/entities/message-repository.js";
import { emitLegacyNotification } from "../../src/policy/notification-helpers.js";

function newRepo() {
  return new MessageRepository(new MemoryStorageProvider());
}

describe("emitLegacyNotification", () => {
  it("emits a Message with the canonical wire shape", async () => {
    const repo = newRepo();
    const m = await emitLegacyNotification(
      repo,
      "thread_message",
      { threadId: "thread-1", currentTurn: "engineer" },
      ["architect", "engineer"],
    );
    expect(m.kind).toBe("external-injection");
    expect(m.authorRole).toBe("system");
    expect(m.authorAgentId).toBe("hub");
    expect(m.target).toBeNull();
    expect(m.delivery).toBe("push-immediate");
    expect(m.status).toBe("new");
    expect(m.payload).toEqual({
      event: "thread_message",
      data: { threadId: "thread-1", currentTurn: "engineer" },
      targetRoles: ["architect", "engineer"],
    });
  });

  it("returns a fresh ULID id", async () => {
    const repo = newRepo();
    const a = await emitLegacyNotification(repo, "task_issued", {}, ["engineer"]);
    const b = await emitLegacyNotification(repo, "task_issued", {}, ["engineer"]);
    expect(a.id).not.toBe(b.id);
    // ULID-monotonic: lex-ordered ascending across instances.
    expect(b.id > a.id).toBe(true);
  });

  it("preserves a multi-role targetRoles array verbatim (no fanout)", async () => {
    const repo = newRepo();
    const m = await emitLegacyNotification(
      repo,
      "thread_abandoned",
      { threadId: "thread-9" },
      ["architect", "engineer", "director"],
    );
    expect((m.payload as { targetRoles: string[] }).targetRoles).toEqual([
      "architect",
      "engineer",
      "director",
    ]);
    // Single Message; no per-role fanout.
    const all = await repo.listMessages({});
    expect(all).toHaveLength(1);
  });

  it("accepts an empty data payload", async () => {
    const repo = newRepo();
    const m = await emitLegacyNotification(repo, "session_ready", {}, ["architect"]);
    expect((m.payload as { data: unknown }).data).toEqual({});
  });

  it("Message.id is forward-compatible with the W1b Last-Event-ID protocol", async () => {
    // The SSE event-id swap (notification.id → Message.id) is the load-
    // bearing forward-compatibility claim. Verify the ID shape is the
    // same ULID format the W1b replayFromCursor uses.
    const repo = newRepo();
    const m = await emitLegacyNotification(repo, "task_issued", {}, ["engineer"]);
    // ULIDs are 26 chars (Crockford base32). MessageRepository allocates
    // them via `ulidx.monotonicFactory()`; same shape used everywhere.
    expect(m.id).toMatch(/^[0-9A-Z]{26}$/);
  });
});
