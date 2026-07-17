import { describe, expect, it } from "vitest";
import type { NextActionProjection, WorkItem } from "../../src/entities/work-item.js";
import {
  evaluateDriverLivenessWatchdog,
  fingerprintWorkItemForDriverProgress,
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
