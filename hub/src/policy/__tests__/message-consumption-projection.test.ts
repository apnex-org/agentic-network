import { describe, expect, it } from "vitest";

import { projectMessageForConsumption } from "../message-consumption-projection.js";
import type { Message } from "../../entities/message.js";
import type { WorkItem } from "../../entities/work-item.js";

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

function store(item: WorkItem) {
  return {
    getWorkItem: async (id: string) => id === item.id ? item : null,
    listReadyForRole: async (_role: string | undefined, _limit: number, _agentId?: string) => ({
      items: item.status === "ready" ? [item] : [],
      truncated: false,
      ...(item.status === "ready" ? {} : { emptyReason: "no_claimable_ready" as const }),
    }),
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

  it("keeps an unblocked message actionable only when current state is claimable", async () => {
    const raw = message({
      notificationEvent: "work-unblocked-notification",
      work_id: "work-1",
      body: "work-1 is now claimable",
    });

    const projected = await projectMessageForConsumption(
      { workItem: store(work()), now: () => "2026-07-08T00:00:01.000Z" },
      raw,
      { role: "architect", agentId: "agent-a" },
    );

    expect(projected.projection?.presentation).toBe("actionable");
    expect(projected.projection?.actionability).toBe("your-turn");
    expect(projected.projection?.reason).toBe("claimable-now");
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
