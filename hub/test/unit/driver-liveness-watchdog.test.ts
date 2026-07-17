import { describe, expect, it, vi } from "vitest";
import type { NextActionProjection, WorkItem } from "../../src/entities/work-item.js";
import {
  evaluateDriverLivenessWatchdog,
  fingerprintWorkItemForDriverProgress,
  DriverLivenessWatchdogSweeper,
  deriveDriverLivenessBaseline,
  driverLivenessWarningMigrationSourceId,
  warningPayload,
  type DriverLivenessBaseline,
  type DriverProgressEvent,
} from "../../src/policy/driver-liveness-watchdog.js";

const BASELINE = "2026-07-17T00:00:00.000Z";
const BEFORE = "2026-07-16T23:59:00.000Z";
const AFTER = "2026-07-17T00:05:00.000Z";
const NOW = "2026-07-17T00:20:00.000Z";
const THRESHOLD_MS = 10 * 60 * 1000;

function workItem(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    id: overrides.id,
    type: "task",
    priority: "normal",
    roleEligibility: ["engineer"],
    dependsOn: [],
    completionDependsOn: [],
    evidenceRequirements: [],
    targetRef: null,
    status: "ready",
    lease: null,
    evidence: [],
    frictionReflections: [],
    blockedOn: null,
    leaseExpiryCount: 0,
    enteredCurrentStateAt: BEFORE,
    stateDurations: { ready: 0, claimed: 0, in_progress: 0, blocked: 0, paused: 0, review: 0 },
    attestationHistory: [],
    attestations: {},
    executorHistory: [],
    createdAt: "2026-07-16T23:00:00.000Z",
    updatedAt: "2026-07-16T23:00:00.000Z",
    ...overrides,
  };
}

function lease(holder = "driver-1", expiresAt = "2026-07-17T01:00:00.000Z") {
  return {
    holder,
    token: `${holder}-token`,
    claimedAt: "2026-07-16T23:50:00.000Z",
    expiresAt,
    heartbeatAt: "2026-07-17T00:10:00.000Z",
  };
}

function driver(overrides: Partial<WorkItem> = {}): WorkItem {
  return workItem({
    id: "driver",
    roleEligibility: ["architect"],
    completionDependsOn: ["child"],
    status: "in_progress",
    lease: lease("architect-1"),
    ...overrides,
  });
}

function projection(arcId: string, nextAction: WorkItem | null, readyCandidates = nextAction ? 1 : 0, emptyReason?: "wip_capped" | "quarantined"): NextActionProjection {
  return {
    arcId,
    nextAction,
    readyCandidates,
    hasChildren: true,
    ...(emptyReason ? { emptyReason } : {}),
  };
}

function baselineFor(children: WorkItem[], d = driver()): DriverLivenessBaseline {
  return {
    recordedAt: BASELINE,
    driverFingerprint: fingerprintWorkItemForDriverProgress(d),
    childFingerprints: Object.fromEntries(children.map((child) => [child.id, fingerprintWorkItemForDriverProgress(child)])),
  };
}

describe("DriverLivenessWatchdog pure evaluator", () => {
  it("warns when a held driver has a graph-local ready action and only ack/renew/read/updatedAt activity occurred", () => {
    const child = workItem({ id: "child", status: "ready", enteredCurrentStateAt: BEFORE });
    const d = driver();
    const nonProgress: DriverProgressEvent[] = [
      { kind: "renew_lease", arcId: d.id, occurredAt: AFTER },
      { kind: "message_ack", arcId: d.id, occurredAt: AFTER },
      { kind: "state_read", arcId: d.id, occurredAt: AFTER },
      { kind: "updated_at", arcId: d.id, occurredAt: AFTER },
    ];

    const verdict = evaluateDriverLivenessWatchdog({
      driver: d,
      children: [child],
      driverNextAction: projection(d.id, child),
      baseline: baselineFor([child], d),
      now: NOW,
      thresholdMs: THRESHOLD_MS,
      progressEvents: nonProgress,
    });

    expect(verdict.status).toBe("warning");
    expect(verdict.reason).toBe("no_progress_with_ready_action");
    expect(verdict.action).toMatchObject({ kind: "driver_next_action", childId: "child" });
  });

  it("treats child state/lease change after the baseline as graph-factual progress", () => {
    const baselineChild = workItem({ id: "child", status: "ready", enteredCurrentStateAt: BEFORE });
    const currentChild = workItem({ id: "child", status: "claimed", lease: lease("engineer-1"), enteredCurrentStateAt: AFTER });
    const d = driver();

    const verdict = evaluateDriverLivenessWatchdog({
      driver: d,
      children: [currentChild],
      driverNextAction: projection(d.id, null),
      baseline: baselineFor([baselineChild], d),
      now: NOW,
      thresholdMs: THRESHOLD_MS,
    });

    expect(verdict.status).toBe("ok");
    expect(verdict.reason).toBe("progress_since_baseline");
    expect(verdict.progress).toMatchObject({ source: "snapshot", kind: "child_state", childId: "child" });
  });

  it("warns on an other-role lane when no typed role-lane dispatch progress exists", () => {
    const child = workItem({ id: "child", status: "ready", enteredCurrentStateAt: BEFORE });
    const d = driver();

    const verdict = evaluateDriverLivenessWatchdog({
      driver: d,
      children: [child],
      driverNextAction: projection(d.id, null),
      roleLaneNextActions: [{ role: "engineer", projection: projection(d.id, child) }],
      baseline: baselineFor([child], d),
      now: NOW,
      thresholdMs: THRESHOLD_MS,
    });

    expect(verdict.status).toBe("warning");
    expect(verdict.action).toMatchObject({ kind: "role_lane_ready", role: "engineer", childId: "child" });
  });

  it("suppresses while a child is legitimately in flight with a live lease and no ready action exists", () => {
    const child = workItem({ id: "child", status: "in_progress", lease: lease("engineer-1"), enteredCurrentStateAt: BEFORE });
    const d = driver();

    const verdict = evaluateDriverLivenessWatchdog({
      driver: d,
      children: [child],
      driverNextAction: projection(d.id, null),
      baseline: baselineFor([child], d),
      now: NOW,
      thresholdMs: THRESHOLD_MS,
    });

    expect(verdict.status).toBe("suppressed");
    expect(verdict.reason).toBe("in_flight_child");
  });

  it("suppresses while a child is blocked with concrete blocker data and no ready action exists", () => {
    const child = workItem({
      id: "child",
      status: "blocked",
      blockedOn: { blockerKind: "external", blockerIds: ["ci"], reason: "waiting for CI capacity" },
      enteredCurrentStateAt: BEFORE,
    });
    const d = driver();

    const verdict = evaluateDriverLivenessWatchdog({
      driver: d,
      children: [child],
      driverNextAction: projection(d.id, null),
      baseline: baselineFor([child], d),
      now: NOW,
      thresholdMs: THRESHOLD_MS,
    });

    expect(verdict.status).toBe("suppressed");
    expect(verdict.reason).toBe("blocked_child");
  });

  it("does not let an unsupported no-action proof suppress a graph-local ready action", () => {
    const child = workItem({ id: "child", status: "ready", enteredCurrentStateAt: BEFORE });
    const d = driver();

    const verdict = evaluateDriverLivenessWatchdog({
      driver: d,
      children: [child],
      driverNextAction: projection(d.id, child),
      baseline: baselineFor([child], d),
      now: NOW,
      thresholdMs: THRESHOLD_MS,
      progressEvents: [{ kind: "graph_no_action_proof", arcId: d.id, occurredAt: AFTER, graphLocal: true, reason: "claimed no work" }],
    });

    expect(verdict.status).toBe("warning");
    expect(verdict.reason).toBe("no_progress_with_ready_action");
  });

  it("accepts a typed role-lane dispatch event as progress", () => {
    const child = workItem({ id: "child", status: "ready", enteredCurrentStateAt: BEFORE });
    const d = driver();

    const verdict = evaluateDriverLivenessWatchdog({
      driver: d,
      children: [child],
      driverNextAction: projection(d.id, null),
      roleLaneNextActions: [{ role: "engineer", projection: projection(d.id, child) }],
      baseline: baselineFor([child], d),
      now: NOW,
      thresholdMs: THRESHOLD_MS,
      progressEvents: [{
        kind: "role_lane_dispatch",
        driverProgressKind: "role_lane_dispatch",
        arcId: d.id,
        sourceDriverId: d.id,
        childId: child.id,
        targetRole: "engineer",
        targetAgentId: null,
        reason: "child ready for engineer lane",
        occurredAt: AFTER,
      }],
    });

    expect(verdict.status).toBe("ok");
    expect(verdict.reason).toBe("progress_since_baseline");
    expect(verdict.progress).toMatchObject({ source: "event", kind: "role_lane_dispatch", childId: "child" });
  });

  it("rejects prose-only / under-specified role-lane dispatch as progress", () => {
    const child = workItem({ id: "child", status: "ready", enteredCurrentStateAt: BEFORE });
    const d = driver();

    const verdict = evaluateDriverLivenessWatchdog({
      driver: d,
      children: [child],
      driverNextAction: projection(d.id, null),
      roleLaneNextActions: [{ role: "engineer", projection: projection(d.id, child) }],
      baseline: baselineFor([child], d),
      now: NOW,
      thresholdMs: THRESHOLD_MS,
      progressEvents: [{
        kind: "role_lane_dispatch",
        arcId: d.id,
        // Missing driverProgressKind/sourceDriverId/targetRole: this represents
        // a generic prose note, not a typed persisted lane dispatch payload.
        childId: child.id,
        reason: "please pick this up",
        occurredAt: AFTER,
      }],
    });

    expect(verdict.status).toBe("warning");
    expect(verdict.reason).toBe("no_progress_with_ready_action");
    expect(verdict.action).toMatchObject({ kind: "role_lane_ready", role: "engineer", childId: "child" });
  });
});


describe("DriverLivenessWatchdogSweeper persistence/readout wiring", () => {
  it("derives a restart-stable baseline and deterministic warning key from graph-factual state", () => {
    const child = workItem({ id: "child", status: "ready", enteredCurrentStateAt: "2026-07-17T00:03:00.000Z" });
    const d = driver({ enteredCurrentStateAt: "2026-07-17T00:02:00.000Z" });
    const baseline = deriveDriverLivenessBaseline(d, [child]);
    const verdict = evaluateDriverLivenessWatchdog({
      driver: d,
      children: [child],
      driverNextAction: projection(d.id, child),
      baseline,
      now: "2026-07-17T00:20:00.000Z",
      thresholdMs: THRESHOLD_MS,
    });

    expect(baseline.recordedAt).toBe("2026-07-17T00:03:00.000Z");
    expect(verdict.status).toBe("warning");
    expect(driverLivenessWarningMigrationSourceId(verdict, baseline)).toBe(
      "driver-liveness-watchdog:driver:2026-07-17T00:03:00.000Z:driver_next_action:child:self",
    );
    expect(warningPayload(verdict, baseline).body).toContain("renew/ack/read/updatedAt do not count as progress");
  });

  it("scans active held arc drivers, uses graph-local next action, and emits one idempotent warning message", async () => {
    const child = workItem({ id: "child", status: "ready", enteredCurrentStateAt: BASELINE });
    const d = driver({ completionDependsOn: [child.id], enteredCurrentStateAt: BASELINE });
    const created: any[] = [];
    const dispatched: any[] = [];
    const workItems = new Map<string, WorkItem>([[d.id, d], [child.id, child]]);

    const sweeper = new DriverLivenessWatchdogSweeper({
      workItem: {
        listWorkItems: async ({ status }: { status?: string }) => ({ items: status === "in_progress" ? [d] : [], truncated: false }),
        getWorkItem: async (id: string) => workItems.get(id) ?? null,
        getNextAction: async (arcId: string, role?: string, agentId?: string) => {
          expect(arcId).toBe(d.id);
          if (role === "architect" && agentId === "architect-1") return projection(d.id, child);
          return projection(d.id, null);
        },
      },
      engineerRegistry: {
        getAgent: async (id: string) => id === "architect-1" ? { id, role: "architect" } : null,
      },
      message: {
        createMessage: async (input: any) => {
          created.push(input);
          return { id: "msg-1", ...input, status: "new", createdAt: NOW, updatedAt: NOW };
        },
      },
      dispatch: async (event, data, selector) => { dispatched.push({ event, data, selector }); },
      now: () => NOW,
    } as any, { thresholdMs: THRESHOLD_MS, intervalMs: 60_000, logger: { warn: vi.fn(), log: vi.fn() } });

    const result = await sweeper.sweepOnce();

    expect(result).toMatchObject({ evaluated: 1, warnings: 1, skipped: 0, truncatedCandidateScan: false });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      kind: "external-injection",
      authorRole: "system",
      authorAgentId: "driver-liveness-watchdog",
      target: { role: "architect" },
      delivery: "push-immediate",
      intent: "driver_liveness_warning",
    });
    expect(created[0].migrationSourceId).toContain("driver-liveness-watchdog:driver:");
    expect(created[0].payload).toMatchObject({
      notificationEvent: "driver-liveness-watchdog-warning",
      arcId: "driver",
      holder: "architect-1",
      reason: "no_progress_with_ready_action",
      action: { kind: "driver_next_action", childId: "child" },
    });
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ event: "message_arrived", selector: { roles: ["architect"] } });
  });

  it("is truncation-honest when the candidate driver scan hits a cap", async () => {
    const child = workItem({ id: "child", status: "ready", enteredCurrentStateAt: BASELINE });
    const d = driver({ completionDependsOn: [child.id], enteredCurrentStateAt: BASELINE });
    const created: any[] = [];
    const warn = vi.fn();
    const workItems = new Map<string, WorkItem>([[d.id, d], [child.id, child]]);

    const sweeper = new DriverLivenessWatchdogSweeper({
      workItem: {
        listWorkItems: async ({ status }: { status?: string }) => ({ items: status === "in_progress" ? [d] : [], truncated: status === "in_progress" }),
        getWorkItem: async (id: string) => workItems.get(id) ?? null,
        getNextAction: async () => projection(d.id, child),
      },
      engineerRegistry: { getAgent: async () => ({ id: "architect-1", role: "architect" }) },
      message: { createMessage: async (input: any) => { created.push(input); return { id: "msg-1", ...input }; } },
      now: () => NOW,
    } as any, { thresholdMs: THRESHOLD_MS, logger: { warn, log: vi.fn() } });

    const result = await sweeper.sweepOnce();

    expect(result.truncatedCandidateScan).toBe(true);
    expect(created[0].payload.truncatedCandidateScan).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("candidate scan hit"));
  });
});
