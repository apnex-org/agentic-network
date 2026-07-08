import { describe, expect, it } from "vitest";

import {
  dryRunEventPolicy,
  EVENT_POLICY_REGISTRY,
  projectMessageForConsumption,
  selectEventPolicyRule,
  validateEventPolicyRegistry,
  WORKITEM_NOTIFICATION_RULE,
  type EventPolicyRule,
} from "../message-consumption-projection.js";
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

describe("EventPolicy registry/evaluator — evpolicy0 Slice 0", () => {
  const rawUnblocked = () => message({
    notificationEvent: "work-unblocked-notification",
    work_id: "work-1",
    body: "work-1 is now claimable",
  });

  const snapshot = (overrides: Record<string, unknown> = {}) => ({
    kind: "workitem" as const,
    id: "work-1",
    status: "ready" as const,
    holder: null,
    priority: "high",
    targetRef: { kind: "mission", id: "mission-112" },
    roleEligibility: ["architect"],
    ...overrides,
  });

  const legalClaim = (legal: boolean, reason?: string) => ({
    source: "item-local-legal-moves" as const,
    claim: legal ? { legal: true } : { legal: false, reason },
  });

  it("validates the static production registry row and authority boundary", () => {
    expect(validateEventPolicyRegistry()).toEqual([]);
    expect(EVENT_POLICY_REGISTRY).toHaveLength(1);
    expect(WORKITEM_NOTIFICATION_RULE).toMatchObject({
      ruleId: "workitem-notification-projection-v1",
      version: 1,
      enabled: true,
      eventFamily: "workitem-notification",
      outputs: ["message-projection"],
      authority: { mutation: "code-review-only-for-slice0", runtimeActions: "none" },
    });
  });

  it("selects the WorkItem notification rule and passes unknown families through as no-match", () => {
    const selected = selectEventPolicyRule(rawUnblocked());
    expect(selected).toMatchObject({ matched: true, selectedBy: "production", productionEligible: true });
    expect(selected.rule?.ruleId).toBe("workitem-notification-projection-v1");

    const none = selectEventPolicyRule(message({ notificationEvent: "future-event", work_id: "work-1" }));
    expect(none).toMatchObject({ matched: false, selectedBy: "none", productionEligible: false });
  });

  it("excludes disabled rules from production selection", () => {
    const disabled: EventPolicyRule = { ...WORKITEM_NOTIFICATION_RULE, enabled: false };
    const selected = selectEventPolicyRule(rawUnblocked(), [disabled]);
    expect(selected).toMatchObject({ matched: false, selectedBy: "none", productionEligible: false });
  });

  it("detects ambiguous enabled rule conflicts deterministically", () => {
    const clone: EventPolicyRule = { ...WORKITEM_NOTIFICATION_RULE, ruleId: "workitem-notification-projection-v1-clone" };
    expect(validateEventPolicyRegistry([WORKITEM_NOTIFICATION_RULE, clone]).some((err) => err.startsWith("ambiguous-match:"))).toBe(true);

    const selected = selectEventPolicyRule(rawUnblocked(), [WORKITEM_NOTIFICATION_RULE, clone]);
    expect(selected).toMatchObject({ matched: false, selectedBy: "conflict", productionEligible: false });
    expect(selected.conflicts).toHaveLength(2);
  });

  it("dry-runs terminal stale transition through the same decision shape", () => {
    const raw = message({ notificationEvent: "work-transition-notification", work_id: "work-1", to_status: "done" });
    const evaln = dryRunEventPolicy({
      message: raw,
      recipient: { role: "architect", agentId: "agent-a" },
      context: { workItem: snapshot({ status: "done", holder: "agent-a", eventToStatus: "done" }) },
    });

    expect(evaln).toMatchObject({
      ruleId: "workitem-notification-projection-v1",
      ruleVersion: 1,
      matched: true,
      productionEligible: true,
      selectedBy: "production",
      decision: { presentation: "historical", actionability: "none", reason: "terminal-now" },
      effects: [{ type: "message-projection", rawMessageId: "01KXMSG" }],
      audit: { authority: { runtimeActions: "none" } },
    });
  });

  it("dry-runs claimable, missing-agent, quarantined, and unknown-family fixture classes", () => {
    const claimable = dryRunEventPolicy({
      message: rawUnblocked(),
      recipient: { role: "architect", agentId: "agent-a" },
      context: { workItem: snapshot(), legalMoves: legalClaim(true), agent: { agentId: "agent-a", registryRead: "ok", quarantined: false } },
    });
    expect(claimable.decision).toMatchObject({ presentation: "actionable", actionability: "your-turn", reason: "claimable-now" });

    const missingAgent = dryRunEventPolicy({
      message: rawUnblocked(),
      recipient: { role: "architect" },
      context: { workItem: snapshot(), contextErrors: ["agent-context-unavailable"] },
    });
    expect(missingAgent.decision).toMatchObject({ presentation: "degraded", actionability: "inspect", degradedReason: "agent-context-unavailable" });

    const quarantined = dryRunEventPolicy({
      message: rawUnblocked(),
      recipient: { role: "architect", agentId: "agent-a" },
      // Verifier regression: WorkGraph legal_moves does not encode registry quarantine.
      // The pure evaluator must overlay quarantine even when item-local claim is legal.
      context: { workItem: snapshot(), legalMoves: legalClaim(true), agent: { agentId: "agent-a", registryRead: "ok", quarantined: true } },
    });
    expect(quarantined.decision).toMatchObject({ presentation: "awareness", actionability: "ack-only", reason: "quarantined" });

    const unknown = dryRunEventPolicy({
      message: message({ notificationEvent: "unknown-future-event", work_id: "work-1" }),
      recipient: { role: "architect", agentId: "agent-a" },
      context: { workItem: snapshot() },
    });
    expect(unknown).toMatchObject({ matched: false, selectedBy: "none", effects: [] });
  });

  it("dry-runs visible degraded errors for read, legal-moves, and registry failures", () => {
    for (const reason of ["work-item-store-unavailable", "legal-moves-read-failed:boom", "agent-registry-read-failed"]) {
      const evaln = dryRunEventPolicy({
        message: rawUnblocked(),
        recipient: { role: "architect", agentId: "agent-a" },
        context: { workItem: snapshot(), contextErrors: [reason] },
      });
      expect(evaln.decision).toMatchObject({ presentation: "degraded", actionability: "inspect", reason, degradedReason: reason });
      expect(evaln.effects).toEqual([{ type: "message-projection", rawMessageId: "01KXMSG" }]);
    }
  });
});
