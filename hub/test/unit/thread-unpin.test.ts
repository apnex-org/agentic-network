/**
 * Phase 2d CP3 C4 (bug-16 part 1) — cascade unpin of currentTurnAgentId
 * when the agent is reaped. Pins MemoryThreadStore.unpinCurrentTurnAgent.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MemoryThreadStore } from "../../src/state.js";

describe("MemoryThreadStore.unpinCurrentTurnAgent (CP3 C4)", () => {
  let store: MemoryThreadStore;

  beforeEach(() => {
    store = new MemoryThreadStore();
  });

  async function openActiveUnicast(title: string, pinnedAgentId: string): Promise<string> {
    const t = await store.openThread(title, "seed", {
      author: "engineer",
      authorAgentId: pinnedAgentId,
    }, {
      routingMode: "unicast",
      recipientAgentId: "eng-architect",
      createdBy: { role: "engineer", agentId: pinnedAgentId },
    });
    // Thread-policy pins the opener's agentId as currentTurnAgentId on
    // create when the routing is unicast-with-architect-recipient — we
    // emulate that by directly assigning for the memory test harness,
    // which bypasses the policy layer.
    (store as any).threads.get(t.id).currentTurnAgentId = pinnedAgentId;
    return t.id;
  }

  it("unpins only threads whose currentTurnAgentId matches the victim", async () => {
    const threadA = await openActiveUnicast("A", "eng-victim");
    const threadB = await openActiveUnicast("B", "eng-victim");
    const threadC = await openActiveUnicast("C", "eng-innocent");

    const unpinned = await store.unpinCurrentTurnAgent("eng-victim");
    expect(unpinned.sort()).toEqual([threadA, threadB].sort());

    const readA = await store.getThread(threadA);
    const readB = await store.getThread(threadB);
    const readC = await store.getThread(threadC);
    expect(readA?.currentTurnAgentId).toBeNull();
    expect(readB?.currentTurnAgentId).toBeNull();
    expect(readC?.currentTurnAgentId).toBe("eng-innocent");
  });

  it("returns an empty list when no thread pins the victim", async () => {
    await openActiveUnicast("A", "eng-innocent");
    const unpinned = await store.unpinCurrentTurnAgent("eng-never-pinned");
    expect(unpinned).toEqual([]);
  });

  it("is idempotent — second call with the same victim returns empty", async () => {
    const t = await openActiveUnicast("A", "eng-victim");
    const first = await store.unpinCurrentTurnAgent("eng-victim");
    const second = await store.unpinCurrentTurnAgent("eng-victim");
    expect(first).toEqual([t]);
    expect(second).toEqual([]);
  });

  it("bumps updatedAt on each unpinned thread", async () => {
    const t = await openActiveUnicast("A", "eng-victim");
    const before = (await store.getThread(t))?.updatedAt;
    // Sleep 2ms so the new ISO timestamp differs.
    await new Promise((r) => setTimeout(r, 2));
    await store.unpinCurrentTurnAgent("eng-victim");
    const after = (await store.getThread(t))?.updatedAt;
    expect(before).toBeTruthy();
    expect(after).toBeTruthy();
    expect(Date.parse(after!)).toBeGreaterThan(Date.parse(before!));
  });
});
