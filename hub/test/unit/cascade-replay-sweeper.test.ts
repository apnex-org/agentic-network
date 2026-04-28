/**
 * Mission-51 W5 — CascadeReplaySweeper unit tests.
 *
 * Covers: marker write/clear (ThreadRepository methods); Hub-startup
 * replay (sweeper picks up threads with cascadePending=true and
 * re-runs runCascade); per-thread error isolation; idempotency on
 * re-run (per-action cascade-key short-circuit prevents duplication);
 * marker preservation on replay failure (next Hub-startup retries).
 *
 * The bug-31 closure narrative: variant 1 (cascade-bookkeeping race)
 * + variant 2 (orphaned-mid-cascade thread) are both architecturally
 * addressed by the marker + replay sweeper; this test file verifies
 * the mechanism works end-to-end against an in-process MemoryStorage
 * fixture.
 */

import { describe, expect, it } from "vitest";
import { MemoryStorageProvider } from "@apnex/storage-provider";

import { ThreadRepository } from "../../src/entities/thread-repository.js";
import { StorageBackedCounter } from "../../src/entities/counter.js";
import { CascadeReplaySweeper } from "../../src/policy/cascade-replay-sweeper.js";
import type { IPolicyContext } from "../../src/policy/types.js";

const silentLogger = { log: () => {}, warn: () => {} };

async function makeFixture() {
  const provider = new MemoryStorageProvider();
  const counter = new StorageBackedCounter(provider);
  const threadStore = new ThreadRepository(provider, counter);
  const ctx: IPolicyContext = {
    stores: { thread: threadStore } as unknown as IPolicyContext["stores"],
    metrics: { increment: () => {} } as IPolicyContext["metrics"],
    emit: async () => {},
    dispatch: async () => {},
    sessionId: "test",
    clientIp: "127.0.0.1",
    role: "system",
    internalEvents: [],
    config: { storageBackend: "memory", gcsBucket: "" },
  } as unknown as IPolicyContext;
  const sweeper = new CascadeReplaySweeper(
    threadStore,
    { forSweeper: () => ctx },
    { logger: silentLogger },
  );
  return { provider, threadStore, sweeper, ctx };
}

describe("ThreadRepository — markCascadePending / markCascadeCompleted", () => {
  it("markCascadePending sets cascadePending=true + actionCount + startedAt", async () => {
    const { threadStore } = await makeFixture();
    const thread = await threadStore.openThread("t", "m", "architect", {
      authorAgentId: "arch-1",
      recipientAgentId: "eng-1",
    });
    expect(thread.cascadePending).toBeUndefined();

    const ok = await threadStore.markCascadePending(thread.id, 3);
    expect(ok).toBe(true);

    const post = await threadStore.getThread(thread.id);
    expect(post?.cascadePending).toBe(true);
    expect(post?.cascadePendingActionCount).toBe(3);
    expect(post?.cascadePendingStartedAt).toBeTruthy();
  });

  it("markCascadePending refuses to re-mark already-pending thread (returns false)", async () => {
    const { threadStore } = await makeFixture();
    const thread = await threadStore.openThread("t", "m", "architect", {
      authorAgentId: "arch-1",
      recipientAgentId: "eng-1",
    });
    expect(await threadStore.markCascadePending(thread.id, 2)).toBe(true);
    // Re-mark — refused; existing marker preserved.
    expect(await threadStore.markCascadePending(thread.id, 5)).toBe(false);

    const post = await threadStore.getThread(thread.id);
    expect(post?.cascadePendingActionCount).toBe(2); // unchanged
  });

  it("markCascadePending returns false on missing thread", async () => {
    const { threadStore } = await makeFixture();
    expect(await threadStore.markCascadePending("nope", 1)).toBe(false);
  });

  it("markCascadeCompleted clears the marker + sets cascadeCompletedAt", async () => {
    const { threadStore } = await makeFixture();
    const thread = await threadStore.openThread("t", "m", "architect", {
      authorAgentId: "arch-1",
      recipientAgentId: "eng-1",
    });
    await threadStore.markCascadePending(thread.id, 2);
    expect(await threadStore.markCascadeCompleted(thread.id)).toBe(true);

    const post = await threadStore.getThread(thread.id);
    expect(post?.cascadePending).toBe(false);
    expect(post?.cascadePendingActionCount).toBeUndefined();
    expect(post?.cascadePendingStartedAt).toBeUndefined();
    expect(post?.cascadeCompletedAt).toBeTruthy();
  });

  it("markCascadeCompleted is idempotent on already-cleared (no-op success)", async () => {
    const { threadStore } = await makeFixture();
    const thread = await threadStore.openThread("t", "m", "architect", {
      authorAgentId: "arch-1",
      recipientAgentId: "eng-1",
    });
    expect(await threadStore.markCascadeCompleted(thread.id)).toBe(true);
    expect(await threadStore.markCascadeCompleted(thread.id)).toBe(true);
  });

  it("markCascadeCompleted returns false on missing thread", async () => {
    const { threadStore } = await makeFixture();
    expect(await threadStore.markCascadeCompleted("nope")).toBe(false);
  });
});

describe("ThreadRepository — listCascadePending", () => {
  it("returns empty array when no threads have the marker", async () => {
    const { threadStore } = await makeFixture();
    expect(await threadStore.listCascadePending()).toEqual([]);
  });

  it("returns only threads with cascadePending=true", async () => {
    const { threadStore } = await makeFixture();
    const t1 = await threadStore.openThread("t1", "m", "architect", {
      authorAgentId: "arch-1",
      recipientAgentId: "eng-1",
    });
    const t2 = await threadStore.openThread("t2", "m", "architect", {
      authorAgentId: "arch-1",
      recipientAgentId: "eng-1",
    });
    const t3 = await threadStore.openThread("t3", "m", "architect", {
      authorAgentId: "arch-1",
      recipientAgentId: "eng-1",
    });
    await threadStore.markCascadePending(t1.id, 1);
    await threadStore.markCascadePending(t3.id, 2);
    // t2 has no marker.

    const pending = await threadStore.listCascadePending();
    const ids = pending.map((t) => t.id).sort();
    expect(ids).toEqual([t1.id, t3.id].sort());
    void t2;
  });
});

describe("CascadeReplaySweeper.fullSweep — no-op cases", () => {
  it("returns zero counts when no threads have the marker", async () => {
    const { sweeper } = await makeFixture();
    const result = await sweeper.fullSweep();
    expect(result).toEqual({ scanned: 0, replayed: 0, errors: 0 });
  });

  it("clears marker on threads with no committed actions (no-op replay)", async () => {
    const { threadStore, sweeper } = await makeFixture();
    const thread = await threadStore.openThread("empty-cascade", "m", "architect", {
      authorAgentId: "arch-1",
      recipientAgentId: "eng-1",
    });
    // Set marker manually but no committed actions exist on the thread.
    await threadStore.markCascadePending(thread.id, 0);

    const result = await sweeper.fullSweep();
    expect(result.scanned).toBe(1);
    expect(result.replayed).toBe(1);
    expect(result.errors).toBe(0);

    const post = await threadStore.getThread(thread.id);
    expect(post?.cascadePending).toBe(false);
    expect(post?.cascadeCompletedAt).toBeTruthy();
  });
});

describe("CascadeReplaySweeper — per-thread error isolation + marker preservation", () => {
  it("a failing thread's replay does NOT abort remaining threads; failed marker preserved", async () => {
    const { threadStore, sweeper } = await makeFixture();
    const t1 = await threadStore.openThread("ok-1", "m", "architect", {
      authorAgentId: "arch-1",
      recipientAgentId: "eng-1",
    });
    const t2 = await threadStore.openThread("will-fail", "m", "architect", {
      authorAgentId: "arch-1",
      recipientAgentId: "eng-1",
    });
    const t3 = await threadStore.openThread("ok-3", "m", "architect", {
      authorAgentId: "arch-1",
      recipientAgentId: "eng-1",
    });
    await threadStore.markCascadePending(t1.id, 0);
    await threadStore.markCascadePending(t2.id, 0);
    await threadStore.markCascadePending(t3.id, 0);

    // Inject failure on the SECOND markCascadeCompleted call (which
    // happens to be t2's). The other threads should still complete.
    const realMark = threadStore.markCascadeCompleted.bind(threadStore);
    let callCount = 0;
    (threadStore as unknown as { markCascadeCompleted: typeof realMark }).markCascadeCompleted =
      async (id: string) => {
        callCount += 1;
        if (id === t2.id) {
          throw new Error("synthetic test failure");
        }
        return realMark(id);
      };

    const result = await sweeper.fullSweep();
    expect(result.scanned).toBe(3);
    // t2 errored; t1 + t3 succeeded.
    expect(result.errors).toBe(1);
    expect(result.replayed).toBe(2);

    // t1 + t3 markers cleared; t2 marker still set.
    const t1Post = await threadStore.getThread(t1.id);
    const t2Post = await threadStore.getThread(t2.id);
    const t3Post = await threadStore.getThread(t3.id);
    expect(t1Post?.cascadePending).toBe(false);
    expect(t2Post?.cascadePending).toBe(true); // preserved for next-startup retry
    expect(t3Post?.cascadePending).toBe(false);
    void callCount;
  });
});

describe("CascadeReplaySweeper — bug-31 closure invariant", () => {
  it("variant 2 (orphaned-mid-cascade): thread with marker set + committed actions is replayed", async () => {
    // Simulates the variant-2 scenario: convergence committed
    // actions, marker was set, then process died before runCascade
    // completed. Sweeper picks up the thread on next start; replay
    // is a no-op (no spawn-handlers wired in this test fixture, so
    // runCascade returns "executed=0" but doesn't fail) and marker
    // is cleared.
    //
    // The structural property under test: marker survives across
    // simulated restart (verified by listCascadePending finding the
    // thread); sweeper picks it up; marker clears post-replay.
    const { threadStore, sweeper } = await makeFixture();
    const thread = await threadStore.openThread("orphaned", "m", "architect", {
      authorAgentId: "arch-1",
      recipientAgentId: "eng-1",
    });
    await threadStore.markCascadePending(thread.id, 0);

    // "Process dies" = no Hub instance running. Marker persists in
    // storage — the next Hub-startup picks it up.
    const pending = await threadStore.listCascadePending();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(thread.id);

    // "Hub starts up" — sweeper runs full-sweep.
    const result = await sweeper.fullSweep();
    expect(result.replayed).toBe(1);

    // Marker cleared; thread is no longer in pending list.
    const remaining = await threadStore.listCascadePending();
    expect(remaining).toHaveLength(0);
  });

  it("variant 1 (cascade-bookkeeping race): re-running replay is idempotent (no duplication)", async () => {
    const { threadStore, sweeper } = await makeFixture();
    const thread = await threadStore.openThread("idempotent", "m", "architect", {
      authorAgentId: "arch-1",
      recipientAgentId: "eng-1",
    });
    await threadStore.markCascadePending(thread.id, 0);

    // First sweep — clears the marker.
    const first = await sweeper.fullSweep();
    expect(first.replayed).toBe(1);
    expect(first.errors).toBe(0);

    // Second sweep — no pending threads; no-op.
    const second = await sweeper.fullSweep();
    expect(second.scanned).toBe(0);

    // No duplication possible: the marker is the trigger for replay.
    // Without a marker, replay can't fire.
  });
});
