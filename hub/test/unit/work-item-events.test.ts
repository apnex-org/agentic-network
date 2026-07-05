/**
 * work-54 (idea-357 pts 1-2) — WorkItem FSM-transition push-event unit tests.
 *
 * Covers the emitter seam directly: emitWorkTransition persists a broadcast
 * external-injection Message AND live-pushes it (the bug-192 create+push
 * coupling), payload shape (work_id / verb / from_status / to_status /
 * role_eligibility / notificationEvent), the sweeper's explicit-toStatus
 * override, title extraction off a JSON-string payload, the never-throws
 * posture, and the derived dependency-unblock scan (emits ONLY for a ready
 * dependent whose EVERY dependency is now done).
 */
import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate, buildEnvelopeWriteEncoder } from "../../src/storage-substrate/index.js";
import { MessageRepositorySubstrate } from "../../src/entities/message-repository-substrate.js";
import {
  emitWorkTransition,
  emitDependencyUnblocks,
  WORK_TRANSITION_EVENT,
  WORK_UNBLOCKED_EVENT,
} from "../../src/policy/work-item-events.js";
import type { IPolicyContext } from "../../src/policy/types.js";
import type { WorkItem, IWorkItemStore } from "../../src/entities/work-item.js";
import type { Message } from "../../src/entities/index.js";

function makeMessageStore(): MessageRepositorySubstrate {
  const substrate = createMemoryStorageSubstrate();
  substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
  return new MessageRepositorySubstrate(substrate);
}

interface Dispatched {
  event: string;
  data: Record<string, unknown>;
}

function makeCtx(over: {
  messageStore?: MessageRepositorySubstrate | { createMessage: () => Promise<never> };
  workItem?: Partial<IWorkItemStore>;
} = {}): { ctx: IPolicyContext; dispatched: Dispatched[]; messageStore: MessageRepositorySubstrate } {
  const dispatched: Dispatched[] = [];
  const messageStore = (over.messageStore ?? makeMessageStore()) as MessageRepositorySubstrate;
  const ctx = {
    stores: { message: messageStore, workItem: over.workItem },
    dispatch: async (event: string, data: Record<string, unknown>) => {
      dispatched.push({ event, data });
    },
    emit: async () => {},
    metrics: { increment: () => {} },
    sessionId: "test",
    clientIp: "127.0.0.1",
    role: "system",
    internalEvents: [],
  } as unknown as IPolicyContext;
  return { ctx, dispatched, messageStore };
}

const item = (over: Partial<WorkItem> = {}): WorkItem => ({
  id: "work-1", type: "task", priority: "high", roleEligibility: ["engineer"],
  dependsOn: [], completionDependsOn: [], evidenceRequirements: [], targetRef: null,
  status: "claimed",
  lease: { holder: "agent-a", token: "tok", claimedAt: "t", expiresAt: "t", heartbeatAt: "t" },
  evidence: [], blockedOn: null, leaseExpiryCount: 0,
  enteredCurrentStateAt: "t",
  stateDurations: { ready: 0, claimed: 0, in_progress: 0, blocked: 0, review: 0 },
  createdAt: "t", updatedAt: "t",
  ...over,
});

function payloadOf(m: Message): Record<string, unknown> {
  return m.payload as Record<string, unknown>;
}

describe("emitWorkTransition (work-54)", () => {
  it("persists a role-targeted (broadcast when any-role) external-injection Message AND live-pushes it (bug-192 coupling; work-124 targeting)", async () => {
    const { ctx, dispatched, messageStore } = makeCtx();
    await emitWorkTransition(ctx, {
      item: item(),
      verb: "claim_work",
      fromStatus: "ready",
      actor: { agentId: "agent-a", role: "engineer" },
    });

    const stored = await messageStore.listMessages({});
    expect(stored.length).toBe(1);
    const msg = stored[0];
    expect(msg.kind).toBe("external-injection");
    expect(msg.target).toEqual({ role: "engineer" }); // work-124: targeted to the eligible role
    expect(msg.delivery).toBe("push-immediate");
    const p = payloadOf(msg);
    expect(p.notificationEvent).toBe(WORK_TRANSITION_EVENT);
    expect(p.work_id).toBe("work-1");
    expect(p.verb).toBe("claim_work");
    expect(p.from_status).toBe("ready");
    expect(p.to_status).toBe("claimed");
    expect(p.role_eligibility).toEqual(["engineer"]);
    expect(p.holder).toBe("agent-a");
    expect(p.actor_agent_id).toBe("agent-a");
    expect(p.body).toContain("work-1 ready→claimed");

    // the push actually fired (a bare createMessage would leave this empty — bug-192)
    expect(dispatched.length).toBe(1);
    expect(dispatched[0].event).toBe("message_arrived");
  });

  it("sweeper path: explicit toStatus overrides the (pre-expiry) item status", async () => {
    const { ctx, messageStore } = makeCtx();
    await emitWorkTransition(ctx, {
      item: item({ status: "in_progress" }), // the stale pre-expiry row the sweeper listed
      verb: "lease_expired",
      fromStatus: "in_progress",
      toStatus: "ready",
    });
    const p = payloadOf((await messageStore.listMessages({}))[0]);
    expect(p.to_status).toBe("ready");
    expect(p.verb).toBe("lease_expired");
    expect(p.actor_agent_id).toBeNull();
    expect(p.body).toContain("by the lease-sweeper");
  });

  it("extracts the title off a JSON-string payload (the create_work convention)", async () => {
    const { ctx, messageStore } = makeCtx();
    await emitWorkTransition(ctx, {
      item: item({ payload: JSON.stringify({ title: "Fix the frobnicator" }) }),
      verb: "start_work",
      fromStatus: "claimed",
    });
    const p = payloadOf((await messageStore.listMessages({}))[0]);
    expect(p.title).toBe("Fix the frobnicator");
    expect(p.body).toContain('"Fix the frobnicator"');
  });

  it("NEVER throws: a failing message store is swallowed (transition already committed)", async () => {
    const { ctx, dispatched } = makeCtx({
      messageStore: { createMessage: async () => { throw new Error("storage down"); } },
    });
    await expect(
      emitWorkTransition(ctx, { item: item(), verb: "claim_work", fromStatus: "ready" }),
    ).resolves.toBeUndefined();
    expect(dispatched.length).toBe(0);
  });
});

describe("emitDependencyUnblocks (work-54 — the derived keystone wake)", () => {
  const done = (id: string) => item({ id, status: "done", lease: null as unknown as WorkItem["lease"] });

  function stubWorkStore(readyItems: WorkItem[], byId: Record<string, WorkItem>): Partial<IWorkItemStore> {
    return {
      listWorkItems: async () => ({ items: readyItems, truncated: false }),
      getWorkItem: async (id: string) => byId[id] ?? null,
    } as Partial<IWorkItemStore>;
  }

  it("emits work-unblocked for a ready dependent whose EVERY dependency is now done", async () => {
    const dependent = item({
      id: "work-9", status: "ready", lease: null as unknown as WorkItem["lease"],
      dependsOn: ["work-1", "work-2"], roleEligibility: ["engineer"],
      payload: { title: "Downstream slice" },
    });
    const { ctx, messageStore } = makeCtx({
      workItem: stubWorkStore([dependent], { "work-2": done("work-2") }),
    });

    await emitDependencyUnblocks(ctx, done("work-1"));

    const stored = await messageStore.listMessages({});
    expect(stored.length).toBe(1);
    const p = payloadOf(stored[0]);
    expect(p.notificationEvent).toBe(WORK_UNBLOCKED_EVENT);
    expect(p.work_id).toBe("work-9");
    expect(p.unblocked_by).toBe("work-1");
    expect(p.role_eligibility).toEqual(["engineer"]);
    expect(p.body).toContain("work-9 is now claimable");
  });

  it("does NOT emit when another dependency is still unmet", async () => {
    const dependent = item({
      id: "work-9", status: "ready", lease: null as unknown as WorkItem["lease"],
      dependsOn: ["work-1", "work-2"],
    });
    const { ctx, messageStore } = makeCtx({
      workItem: stubWorkStore([dependent], { "work-2": item({ id: "work-2", status: "in_progress" }) }),
    });
    await emitDependencyUnblocks(ctx, done("work-1"));
    expect((await messageStore.listMessages({})).length).toBe(0);
  });

  it("does NOT emit for ready items that never depended on the completed item", async () => {
    const unrelated = item({ id: "work-9", status: "ready", lease: null as unknown as WorkItem["lease"], dependsOn: [] });
    const { ctx, messageStore } = makeCtx({ workItem: stubWorkStore([unrelated], {}) });
    await emitDependencyUnblocks(ctx, done("work-1"));
    expect((await messageStore.listMessages({})).length).toBe(0);
  });

  it("no-ops entirely unless the completed item reached done (a review-park unblocks nothing)", async () => {
    let scanned = false;
    const { ctx } = makeCtx({
      workItem: {
        listWorkItems: async () => { scanned = true; return { items: [], truncated: false }; },
      } as Partial<IWorkItemStore>,
    });
    await emitDependencyUnblocks(ctx, item({ id: "work-1", status: "review" }));
    expect(scanned).toBe(false);
  });

  it("NEVER throws: a failing ready-scan is swallowed", async () => {
    const { ctx } = makeCtx({
      workItem: {
        listWorkItems: async () => { throw new Error("scan failed"); },
      } as Partial<IWorkItemStore>,
    });
    await expect(emitDependencyUnblocks(ctx, done("work-1"))).resolves.toBeUndefined();
  });
});
