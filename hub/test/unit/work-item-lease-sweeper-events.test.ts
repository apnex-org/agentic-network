/**
 * work-54 (idea-357 pt-2) — lease-sweeper transition-event emission unit tests.
 *
 * The sweeper's requeue + poison-abandon are FSM transitions too; they must
 * emit `work-transition-notification` (verb=lease_expired) with the explicit
 * toStatus (ready | abandoned) through the sweeper's own IPolicyContext.
 * Stubbed store (the CAS mechanics are real-pg-tested in the sibling
 * substrate test); real memory message store proves the persist+push side.
 */
import { describe, expect, it } from "vitest";
import { WorkItemLeaseSweeper } from "../../src/policy/work-item-lease-sweeper.js";
import type { WorkItemRepositorySubstrate } from "../../src/entities/work-item-repository-substrate.js";
import { createMemoryStorageSubstrate, buildEnvelopeWriteEncoder } from "../../src/storage-substrate/index.js";
import { MessageRepositorySubstrate } from "../../src/entities/message-repository-substrate.js";
import type { IPolicyContext } from "../../src/policy/types.js";
import type { WorkItem } from "../../src/entities/work-item.js";

const NOW = "2099-01-01T00:00:00.000Z";

const expiredItem = (id: string, status: WorkItem["status"] = "in_progress"): WorkItem => ({
  id, type: "task", priority: "normal", roleEligibility: ["engineer"],
  dependsOn: [], completionDependsOn: [], evidenceRequirements: [], targetRef: null,
  status,
  lease: { holder: "agent-dead", token: "tok", claimedAt: "t", expiresAt: "t", heartbeatAt: "t" },
  evidence: [], blockedOn: null, leaseExpiryCount: 0,
  enteredCurrentStateAt: "t",
  stateDurations: { ready: 0, claimed: 0, in_progress: 0, blocked: 0, review: 0 },
  createdAt: "t", updatedAt: "t",
});

function makeRig(items: WorkItem[], outcomes: Record<string, "requeued" | "abandoned" | "skipped">) {
  const substrate = createMemoryStorageSubstrate();
  substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
  const messageStore = new MessageRepositorySubstrate(substrate);
  const dispatched: string[] = [];
  const ctxProvider = {
    forSweeper: (): IPolicyContext => ({
      stores: { message: messageStore },
      metrics: { increment: () => {} },
      emit: async () => {},
      dispatch: async (event: string) => { dispatched.push(event); },
      sessionId: "test-lease-sweeper", clientIp: "127.0.0.1", role: "system", internalEvents: [],
    } as unknown as IPolicyContext),
  };
  const store = {
    listExpiredLeaseItems: async () => items,
    expireLease: async (id: string) => outcomes[id] ?? "skipped",
  } as unknown as WorkItemRepositorySubstrate;
  const sweeper = new WorkItemLeaseSweeper(store, ctxProvider, {
    logger: { log: () => {}, warn: () => {} },
  });
  return { sweeper, messageStore, dispatched };
}

async function events(messageStore: MessageRepositorySubstrate) {
  const msgs = await messageStore.listMessages({});
  return msgs.filter((m) => m.kind === "external-injection").map((m) => m.payload as Record<string, unknown>);
}

describe("WorkItemLeaseSweeper transition events (work-54)", () => {
  it("a requeued expiry emits lease_expired →ready (with the lapsed holder) and pushes it", async () => {
    const { sweeper, messageStore, dispatched } = makeRig(
      [expiredItem("work-1")],
      { "work-1": "requeued" },
    );
    const res = await sweeper.fullSweep(NOW);
    expect(res.requeued).toBe(1);

    const evts = await events(messageStore);
    expect(evts.length).toBe(1);
    expect(evts[0].notificationEvent).toBe("work-transition-notification");
    expect(evts[0].verb).toBe("lease_expired");
    expect(evts[0].from_status).toBe("in_progress");
    expect(evts[0].to_status).toBe("ready"); // explicit override — NOT the stale listed status
    expect(evts[0].holder).toBe("agent-dead");
    expect(dispatched).toContain("message_arrived");
  });

  it("a poison-abandon emits lease_expired →abandoned", async () => {
    const { sweeper, messageStore } = makeRig(
      [expiredItem("work-2", "claimed")],
      { "work-2": "abandoned" },
    );
    const res = await sweeper.fullSweep(NOW);
    expect(res.abandoned).toBe(1);

    const evts = await events(messageStore);
    expect(evts.length).toBe(1);
    expect(evts[0].to_status).toBe("abandoned");
    expect(evts[0].from_status).toBe("claimed");
  });

  it("a skipped item (concurrent renew won the CAS) emits NOTHING", async () => {
    const { sweeper, messageStore } = makeRig(
      [expiredItem("work-3")],
      { "work-3": "skipped" },
    );
    const res = await sweeper.fullSweep(NOW);
    expect(res.skipped).toBe(1);
    expect((await events(messageStore)).length).toBe(0);
  });
});
