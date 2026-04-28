/**
 * CursorStore unit tests — mission-52 T2.
 *
 * Validates per-repo cursor + bounded-LRU dedupe persistence against
 * a `MemoryStorageProvider` (the conformance-suite reference impl).
 * Also covers the `mergeLru` helper directly for the LRU-policy
 * invariants.
 */

import { describe, it, expect } from "vitest";
import { MemoryStorageProvider } from "@apnex/storage-provider";
import {
  CursorStore,
  CursorStoreConflictError,
  mergeLru,
} from "../src/cursor-store.js";

const REPO = "owner/example";

function newStore(opts?: { dedupeCapacity?: number }): {
  store: CursorStore;
  storage: MemoryStorageProvider;
} {
  const storage = new MemoryStorageProvider();
  const store = new CursorStore({
    storage,
    dedupeCapacity: opts?.dedupeCapacity,
  });
  return { store, storage };
}

describe("CursorStore — cursor read/write", () => {
  it("readCursor returns null on first observation", async () => {
    const { store } = newStore();
    const result = await store.readCursor(REPO);
    expect(result.value).toBeNull();
    expect(result.token).toBeNull();
  });

  it("first writeCursor uses createOnly path; returned token chains into next write", async () => {
    const { store } = newStore();
    const token = await store.writeCursor(
      REPO,
      { etag: "W/\"abc\"", lastEventId: "1", updatedAt: new Date().toISOString() },
      null,
    );
    expect(token).not.toBeNull();
    const reread = await store.readCursor(REPO);
    expect(reread.value?.etag).toBe("W/\"abc\"");
    expect(reread.value?.lastEventId).toBe("1");
    expect(reread.token).not.toBeNull();
    // Chained write succeeds with the returned token.
    const secondToken = await store.writeCursor(
      REPO,
      { etag: "W/\"xyz\"", lastEventId: "2", updatedAt: new Date().toISOString() },
      token,
    );
    expect(secondToken).not.toBeNull();
  });

  it("second writeCursor with stale token throws CursorStoreConflictError", async () => {
    const { store } = newStore();
    await store.writeCursor(
      REPO,
      { etag: "W/\"v1\"", updatedAt: new Date().toISOString() },
      null,
    );
    const fresh = await store.readCursor(REPO);
    // Use a clearly-wrong token to force conflict.
    await expect(
      store.writeCursor(
        REPO,
        { etag: "W/\"v2\"", updatedAt: new Date().toISOString() },
        "bogus-token",
      ),
    ).rejects.toBeInstanceOf(CursorStoreConflictError);
    // Real token round-trip works.
    const newToken = await store.writeCursor(
      REPO,
      { etag: "W/\"v2\"", updatedAt: new Date().toISOString() },
      fresh.token,
    );
    expect(newToken).not.toBeNull();
  });

  it("first-write conflict throws when path already exists", async () => {
    const { store } = newStore();
    await store.writeCursor(REPO, { updatedAt: "t1" }, null);
    await expect(
      store.writeCursor(REPO, { updatedAt: "t2" }, null),
    ).rejects.toBeInstanceOf(CursorStoreConflictError);
  });
});

describe("CursorStore — Hub-restart resumption", () => {
  it("a fresh CursorStore over the same storage reads existing cursor", async () => {
    const storage = new MemoryStorageProvider();
    const first = new CursorStore({ storage });
    await first.writeCursor(
      REPO,
      { etag: "W/\"persisted\"", lastEventId: "42", updatedAt: "t1" },
      null,
    );

    // Simulate Hub restart: brand-new CursorStore over the same backing.
    const second = new CursorStore({ storage });
    const reread = await second.readCursor(REPO);
    expect(reread.value?.etag).toBe("W/\"persisted\"");
    expect(reread.value?.lastEventId).toBe("42");
  });

  it("dedupe set persists across CursorStore re-instantiation", async () => {
    const storage = new MemoryStorageProvider();
    const first = new CursorStore({ storage });
    await first.markSeen(REPO, ["evt-1", "evt-2", "evt-3"], null);

    const second = new CursorStore({ storage });
    const { unseen } = await second.filterUnseen(REPO, [
      "evt-2",
      "evt-3",
      "evt-4",
    ]);
    expect(unseen).toEqual(["evt-4"]);
  });
});

describe("CursorStore — dedupe LRU", () => {
  it("filterUnseen returns input unchanged on first observation", async () => {
    const { store } = newStore();
    const { unseen } = await store.filterUnseen(REPO, ["a", "b", "c"]);
    expect(unseen).toEqual(["a", "b", "c"]);
  });

  it("markSeen + filterUnseen rejects duplicates", async () => {
    const { store } = newStore();
    await store.markSeen(REPO, ["a", "b", "c"], null);
    const { unseen } = await store.filterUnseen(REPO, ["b", "c", "d"]);
    expect(unseen).toEqual(["d"]);
  });

  it("LRU bounded retention drops oldest entries beyond capacity", async () => {
    const { store } = newStore({ dedupeCapacity: 3 });
    const t1 = await store.markSeen(REPO, ["a", "b", "c"], null);
    // Capacity-3; adding two more drops the two oldest.
    await store.markSeen(REPO, ["d", "e"], t1);
    const { unseen } = await store.filterUnseen(REPO, ["a", "b", "c", "d", "e"]);
    // a, b dropped; c, d, e retained.
    expect(unseen).toEqual(["a", "b"]);
  });

  it("markSeen is a no-op on empty input", async () => {
    const { store } = newStore();
    const initialToken = await store.markSeen(REPO, ["a"], null);
    const sameToken = await store.markSeen(REPO, [], initialToken);
    expect(sameToken).toBe(initialToken);
  });
});

describe("mergeLru helper", () => {
  it("preserves order; appends new ids to the tail", () => {
    expect(mergeLru(["a", "b"], ["c", "d"], 10)).toEqual(["a", "b", "c", "d"]);
  });

  it("touch-on-access: re-appearing ids move to the tail", () => {
    expect(mergeLru(["a", "b", "c"], ["b", "d"], 10)).toEqual(["a", "c", "b", "d"]);
  });

  it("drops oldest beyond capacity", () => {
    expect(mergeLru(["a", "b", "c"], ["d", "e"], 3)).toEqual(["c", "d", "e"]);
  });

  it("zero capacity returns empty list", () => {
    expect(mergeLru(["a"], ["b"], 0)).toEqual([]);
  });

  it("incoming larger than capacity keeps only tail-most ids", () => {
    expect(mergeLru([], ["a", "b", "c", "d", "e"], 3)).toEqual(["c", "d", "e"]);
  });
});
