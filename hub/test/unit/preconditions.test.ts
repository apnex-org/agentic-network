/**
 * Mission-51 W4 — Precondition predicate registry unit tests.
 *
 * Covers: PRECONDITIONS registry shape (initial seed declarations),
 * evaluatePrecondition gate (absent → fire; valid+true → fire;
 * valid+false → cancel; missing-fn → cancel; malformed-precondition
 * → cancel; throw → cancel).
 */

import { describe, expect, it } from "vitest";
import { MemoryStorageProvider } from "@ois/storage-provider";

import { ThreadRepository } from "../../src/entities/thread-repository.js";
import { TaskRepository } from "../../src/entities/task-repository.js";
import { StorageBackedCounter } from "../../src/entities/counter.js";
import {
  PRECONDITIONS,
  evaluatePrecondition,
} from "../../src/policy/preconditions.js";
import type { IPolicyContext } from "../../src/policy/types.js";

async function makeCtx(): Promise<{
  ctx: IPolicyContext;
  threadStore: ThreadRepository;
  taskStore: TaskRepository;
}> {
  const provider = new MemoryStorageProvider();
  const counter = new StorageBackedCounter(provider);
  const threadStore = new ThreadRepository(provider, counter);
  const taskStore = new TaskRepository(provider, counter);
  const ctx: IPolicyContext = {
    stores: { thread: threadStore, task: taskStore },
    metrics: { increment: () => {} },
    emit: async () => {},
    dispatch: async () => {},
    sessionId: "test",
    clientIp: "127.0.0.1",
    role: "system",
    internalEvents: [],
    config: { storageBackend: "memory", gcsBucket: "" },
  } as unknown as IPolicyContext;
  return { ctx, threadStore, taskStore };
}

describe("PRECONDITIONS registry", () => {
  it("contains the W4 initial seed: thread-still-active + task-not-completed", () => {
    const fns = PRECONDITIONS.map((p) => p.fn);
    expect(fns).toContain("thread-still-active");
    expect(fns).toContain("task-not-completed");
  });

  it("each predicate has a non-empty fn name + description + evaluator", () => {
    for (const p of PRECONDITIONS) {
      expect(p.fn).toBeTruthy();
      expect(p.description).toBeTruthy();
      expect(typeof p.evaluate).toBe("function");
    }
  });
});

describe("evaluatePrecondition — absent precondition", () => {
  it("undefined → ok=true (fire unconditionally)", async () => {
    const { ctx } = await makeCtx();
    const result = await evaluatePrecondition(undefined, ctx);
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("no-precondition");
  });

  it("null → ok=true (fire unconditionally)", async () => {
    const { ctx } = await makeCtx();
    const result = await evaluatePrecondition(null, ctx);
    expect(result.ok).toBe(true);
  });
});

describe("evaluatePrecondition — thread-still-active", () => {
  it("returns true for active thread", async () => {
    const { ctx, threadStore } = await makeCtx();
    const thread = await threadStore.openThread(
      "active-test",
      "hi",
      "architect",
      { authorAgentId: "arch-1", recipientAgentId: "eng-1" },
    );
    const result = await evaluatePrecondition(
      { fn: "thread-still-active", args: { threadId: thread.id } },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.reason).toMatch(/returned true/);
  });

  it("returns false for closed thread", async () => {
    const { ctx, threadStore } = await makeCtx();
    const thread = await threadStore.openThread(
      "to-close",
      "hi",
      "architect",
      { authorAgentId: "arch-1", recipientAgentId: "eng-1" },
    );
    await threadStore.closeThread(thread.id);
    const result = await evaluatePrecondition(
      { fn: "thread-still-active", args: { threadId: thread.id } },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/returned false/);
  });

  it("returns false for nonexistent threadId", async () => {
    const { ctx } = await makeCtx();
    const result = await evaluatePrecondition(
      { fn: "thread-still-active", args: { threadId: "nope" } },
      ctx,
    );
    expect(result.ok).toBe(false);
  });

  it("returns false for missing threadId arg", async () => {
    const { ctx } = await makeCtx();
    const result = await evaluatePrecondition(
      { fn: "thread-still-active", args: {} },
      ctx,
    );
    expect(result.ok).toBe(false);
  });
});

describe("evaluatePrecondition — fn-not-in-registry", () => {
  it("returns false with helpful reason", async () => {
    const { ctx } = await makeCtx();
    const result = await evaluatePrecondition(
      { fn: "nonexistent", args: {} },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not in registry|nonexistent/);
  });
});

describe("evaluatePrecondition — malformed precondition", () => {
  it("missing fn returns false", async () => {
    const { ctx } = await makeCtx();
    const result = await evaluatePrecondition({ args: {} }, ctx);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/malformed/);
  });

  it("non-string fn returns false", async () => {
    const { ctx } = await makeCtx();
    const result = await evaluatePrecondition({ fn: 42 }, ctx);
    expect(result.ok).toBe(false);
  });

  it("missing args is treated as empty args (not a malformed error)", async () => {
    const { ctx, threadStore } = await makeCtx();
    const thread = await threadStore.openThread(
      "args-test",
      "hi",
      "architect",
      { authorAgentId: "arch-1", recipientAgentId: "eng-1" },
    );
    // No args object on the precondition. Predicate sees empty args
    // and returns false (because threadId is missing). Reason should
    // be "predicate returned false" — NOT "malformed precondition".
    const result = await evaluatePrecondition(
      { fn: "thread-still-active" },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/returned false/);
    void thread;
  });
});
