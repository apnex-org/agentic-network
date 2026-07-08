import { describe, expect, it } from "vitest";

import { projectMessageForConsumption } from "../message-consumption-projection.js";
import type { Message } from "../../entities/message.js";
import type { LegalMoves, WorkItem } from "../../entities/work-item.js";

function work(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "work-1",
    type: "task",
    priority: "high",
    roleEligibility: ["architect"],
    dependsOn: [],
    completionDependsOn: [],
    evidenceRequirements: [],
    targetRef: { kind: "mission", id: "mission-111" },
    status: "ready",
    lease: null,
    evidence: [],
    blockedOn: null,
    leaseExpiryCount: 0,
    enteredCurrentStateAt: "2026-07-08T00:00:00.000Z",
    stateDurations: { ready: 0, claimed: 0, in_progress: 0, blocked: 0, paused: 0, review: 0 },
    attestationHistory: [],
    attestations: {},
    executorHistory: [],
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    ...overrides,
  };
}

function message(payload: Record<string, unknown>): Message {
  return {
    id: "01KXMSG",
    kind: "external-injection",
    authorRole: "system",
    authorAgentId: "hub",
    target: { role: "architect" },
    delivery: "push-immediate",
    status: "new",
    payload,
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
  };
}

function legalMoves(item: WorkItem, claimLegal = item.status === "ready", reason = "not-currently-claimable"): LegalMoves {
  return {
    workId: item.id,
    status: item.status,
    isHolder: false,
    gateMet: true,
    moves: [
      claimLegal ? { verb: "claim", legal: true } : { verb: "claim", legal: false, reason },
      { verb: "start", legal: false, reason: "not holder" },
      { verb: "block", legal: false, reason: "not holder" },
      { verb: "resume", legal: false, reason: "not holder" },
      { verb: "complete", legal: false, reason: "not holder" },
      { verb: "release", legal: false, reason: "not holder" },
      { verb: "abandon", legal: false, reason: "not holder" },
      { verb: "renew", legal: false, reason: "not holder" },
      { verb: "pause", legal: false, reason: "not creator" },
      { verb: "unpause", legal: false, reason: "not paused" },
    ],
  };
}

function store(item: WorkItem, options: { claimLegal?: boolean; claimReason?: string; onListReady?: () => void } = {}) {
  return {
    getWorkItem: async (id: string) => id === item.id ? item : null,
    getLegalMoves: async (id: string) => id === item.id
      ? legalMoves(item, options.claimLegal ?? item.status === "ready", options.claimReason)
      : null,
    listReadyForRole: async () => {
      options.onListReady?.();
      return { items: [], truncated: true };
    },
  } as any;
}

function registry(quarantined = false) {
  return {
    getAgent: async () => ({ quarantined }),
  } as any;
}

describe("projectMessageForConsumption — WorkItem notification projection", () => {
  it("downgrades a delayed unblocked message when the item is already terminal", async () => {
    const raw = message({
      notificationEvent: "work-unblocked-notification",
      work_id: "work-1",
      body: "work-1 is now claimable",
    });

    const projected = await projectMessageForConsumption(
      { workItem: store(work({ status: "done" })), now: () => "2026-07-08T00:00:01.000Z" },
      raw,
      { role: "architect", agentId: "agent-a" },
    );

    expect(projected.payload).toBe(raw.payload); // raw audit payload preserved
    expect(projected.projection?.presentation).toBe("historical");
    expect(projected.projection?.actionability).toBe("ack-only");
    expect(projected.projection?.reason).toBe("terminal-now");
    expect(projected.projection?.renderBody).toContain("Historical/no action");
  });

  it("keeps an unblocked message actionable only when current item-local legal_moves says claim is legal", async () => {
    const raw = message({
      notificationEvent: "work-unblocked-notification",
      work_id: "work-1",
      body: "work-1 is now claimable",
    });

    const projected = await projectMessageForConsumption(
      { workItem: store(work()), engineerRegistry: registry(), now: () => "2026-07-08T00:00:01.000Z" },
      raw,
      { role: "architect", agentId: "agent-a" },
    );

    expect(projected.projection?.presentation).toBe("actionable");
    expect(projected.projection?.actionability).toBe("your-turn");
    expect(projected.projection?.reason).toBe("claimable-now");
  });

  it("does not hide a specific claimable work_id just because the capped global ready page omits it", async () => {
    let listReadyCalls = 0;
    const raw = message({
      notificationEvent: "work-unblocked-notification",
      work_id: "work-1",
      body: "work-1 is now claimable",
    });

    const projected = await projectMessageForConsumption(
      {
        workItem: store(work(), { onListReady: () => { listReadyCalls += 1; } }),
        engineerRegistry: registry(),
        now: () => "2026-07-08T00:00:01.000Z",
      },
      raw,
      { role: "architect", agentId: "agent-a" },
    );

    expect(listReadyCalls).toBe(0);
    expect(projected.projection?.presentation).toBe("actionable");
    expect(projected.projection?.reason).toBe("claimable-now");
  });

  it("does not mark a quarantined caller's ready work as your-turn", async () => {
    const raw = message({
      notificationEvent: "work-unblocked-notification",
      work_id: "work-1",
      body: "work-1 is now claimable",
    });

    const projected = await projectMessageForConsumption(
      { workItem: store(work()), engineerRegistry: registry(true), now: () => "2026-07-08T00:00:01.000Z" },
      raw,
      { role: "architect", agentId: "agent-a" },
    );

    expect(projected.projection?.presentation).toBe("awareness");
    expect(projected.projection?.actionability).toBe("ack-only");
    expect(projected.projection?.reason).toBe("quarantined");
  });

  it("fails open when caller-specific actionability context is absent for a ready item", async () => {
    const raw = message({
      notificationEvent: "work-unblocked-notification",
      work_id: "work-1",
      body: "work-1 is now claimable",
    });

    const projected = await projectMessageForConsumption(
      { workItem: store(work()), engineerRegistry: registry(), now: () => "2026-07-08T00:00:01.000Z" },
      raw,
      { role: "architect" },
    );

    expect(projected.projection?.presentation).toBe("degraded");
    expect(projected.projection?.actionability).toBe("inspect");
    expect(projected.projection?.degradedReason).toBe("agent-context-unavailable");
  });

  it("fails open when current WorkItem truth cannot be read", async () => {
    const raw = message({
      notificationEvent: "work-transition-notification",
      work_id: "work-1",
      to_status: "ready",
      body: "work-1 paused→ready",
    });

    const projected = await projectMessageForConsumption(
      { now: () => "2026-07-08T00:00:01.000Z" },
      raw,
      { role: "architect", agentId: "agent-a" },
    );

    expect(projected.projection?.presentation).toBe("degraded");
    expect(projected.projection?.actionability).toBe("inspect");
    expect(projected.projection?.degradedReason).toBe("work-item-store-unavailable");
  });
});
