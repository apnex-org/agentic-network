/**
 * Mission-51 W4 — W3 trigger retry-interlock unit tests.
 *
 * Covers: retryFailedTrigger creates a scheduled-message-retry with
 * backoff fireAt + retryCount metadata; backoff schedule defaults
 * (30s for attempt 1, 5min for attempt 2+); retry exhaustion
 * (`attempt > maxRetries` → log + metric + give up; no enqueue);
 * runTriggers integration (createMessage failure on first emission
 * triggers retry-enqueue).
 */

import { describe, expect, it } from "vitest";
import { MemoryStorageProvider } from "@apnex/storage-provider";

import { MessageRepository } from "../../src/entities/message-repository.js";
import { runTriggers, retryFailedTrigger, TRIGGERS } from "../../src/policy/triggers.js";
import type { IPolicyContext } from "../../src/policy/types.js";

function makeCtx(messageStore: MessageRepository): IPolicyContext {
  return {
    stores: { message: messageStore } as unknown as IPolicyContext["stores"],
    metrics: { increment: () => {} } as IPolicyContext["metrics"],
    emit: async () => {},
    dispatch: async () => {},
    sessionId: "test",
    clientIp: "127.0.0.1",
    role: "system",
    internalEvents: [],
    config: { storageBackend: "memory", gcsBucket: "" },
  } as unknown as IPolicyContext;
}

describe("retryFailedTrigger — direct unit", () => {
  it("attempt 1: enqueues a scheduled-message with fireAt ~30s in the future", async () => {
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore);
    const trigger = TRIGGERS.find((t) => t.name === "mission_activated")!;
    const before = Date.now();

    await retryFailedTrigger(
      trigger,
      { target: { role: "engineer" }, payload: { missionId: "m-1", transition: "proposed→active" } },
      ctx,
      1,
    );

    const all = await messageStore.listMessages({ delivery: "scheduled" });
    expect(all).toHaveLength(1);
    expect(all[0].kind).toBe("note");
    expect(all[0].retryCount).toBe(1);
    expect(all[0].maxRetries).toBe(3);
    expect(all[0].fireAt).toBeTruthy();

    const fireAtMs = new Date(all[0].fireAt!).getTime();
    // 30s default backoff for attempt 1
    expect(fireAtMs - before).toBeGreaterThanOrEqual(29_000);
    expect(fireAtMs - before).toBeLessThanOrEqual(31_000);
  });

  it("attempt 2: enqueues with fireAt ~5min in the future", async () => {
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore);
    const trigger = TRIGGERS.find((t) => t.name === "mission_activated")!;
    const before = Date.now();

    await retryFailedTrigger(
      trigger,
      { target: { role: "engineer" }, payload: { missionId: "m-1", transition: "proposed→active" } },
      ctx,
      2,
    );

    const all = await messageStore.listMessages({ delivery: "scheduled" });
    expect(all).toHaveLength(1);
    expect(all[0].retryCount).toBe(2);

    const fireAtMs = new Date(all[0].fireAt!).getTime();
    // 5min default backoff for attempt 2
    expect(fireAtMs - before).toBeGreaterThanOrEqual(299_000);
    expect(fireAtMs - before).toBeLessThanOrEqual(301_000);
  });

  it("attempt > maxRetries: gives up; no message enqueued", async () => {
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore);
    const trigger = TRIGGERS.find((t) => t.name === "mission_activated")!;

    await retryFailedTrigger(
      trigger,
      { target: { role: "engineer" }, payload: { missionId: "m-1", transition: "proposed→active" } },
      ctx,
      4, // > default maxRetries=3
    );

    const all = await messageStore.listMessages({ delivery: "scheduled" });
    expect(all).toHaveLength(0);
  });

  it("retry-enqueue includes _retryContext metadata in payload", async () => {
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore);
    const trigger = TRIGGERS.find((t) => t.name === "mission_activated")!;

    await retryFailedTrigger(
      trigger,
      { target: { role: "engineer" }, payload: { missionId: "m-1", transition: "proposed→active" } },
      ctx,
      1,
    );

    const all = await messageStore.listMessages({ delivery: "scheduled" });
    const payload = all[0].payload as { _retryContext?: { triggerName: string; retryCount: number; maxRetries: number } };
    expect(payload._retryContext).toBeDefined();
    expect(payload._retryContext!.triggerName).toBe("mission_activated");
    expect(payload._retryContext!.retryCount).toBe(1);
    expect(payload._retryContext!.maxRetries).toBe(3);
  });
});

describe("runTriggers integration — first-emission failure triggers retry", () => {
  it("createMessage failure on first emission → retry-enqueue (attempt 1)", async () => {
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    // Inject failure on the FIRST createMessage call (the original
    // emission). The SECOND call (the retry-enqueue) succeeds.
    const realCreate = messageStore.createMessage.bind(messageStore);
    let firstCalled = false;
    (messageStore as unknown as { createMessage: typeof realCreate }).createMessage = async (input) => {
      if (!firstCalled) {
        firstCalled = true;
        throw new Error("synthetic test failure");
      }
      return realCreate(input);
    };
    const ctx = makeCtx(messageStore);

    const result = await runTriggers(
      "mission",
      "proposed",
      "active",
      { id: "m-fail", title: "Test" },
      ctx,
    );
    expect(result.errors).toBe(1);
    expect(result.fired).toBe(0);

    // The retry-enqueue happened (second createMessage call succeeded).
    const all = await realCreate.bind(messageStore)
      ? await messageStore.listMessages({ delivery: "scheduled" })
      : [];
    expect(all).toHaveLength(1);
    expect(all[0].retryCount).toBe(1);
    expect((all[0].payload as { transition?: string }).transition).toBe("proposed→active");
  });

  it("createMessage failure on BOTH original emission AND retry-enqueue → log + give up (no infinite recursion)", async () => {
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    // Inject failure on EVERY createMessage call.
    (messageStore as unknown as { createMessage: () => Promise<never> }).createMessage = async () => {
      throw new Error("storage permanently down");
    };
    const ctx = makeCtx(messageStore);

    // Should NOT throw (catastrophic failure is logged + swallowed).
    const result = await runTriggers(
      "mission",
      "proposed",
      "active",
      { id: "m-doomed" },
      ctx,
    );
    expect(result.errors).toBe(1);
    expect(result.fired).toBe(0);
    // No exception propagated; entity transition stays committed.
  });
});
