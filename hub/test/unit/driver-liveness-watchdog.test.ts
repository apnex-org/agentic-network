import { describe, expect, it, vi } from "vitest";
import type { NextActionProjection, WorkItem } from "../../src/entities/work-item.js";
import { PolicyRouter } from "../../src/policy/router.js";
import { registerWorkItemPolicy } from "../../src/policy/work-item-policy.js";
import { createTestContext } from "../../src/policy/test-utils.js";
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

/** work-593: the narrow IWorkItemStore surface `get_next_action` touches. */
function makeNextActionStore(projection: NextActionProjection) {
  return { getNextAction: async () => projection };
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

function projection(arcId: string, nextAction: WorkItem | null, readyCandidates = nextAction ? 1 : 0, emptyReason?: "wip_capped"): NextActionProjection {
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
      { kind: "message_claim", arcId: d.id, occurredAt: AFTER },
      { kind: "message_ack", arcId: d.id, occurredAt: AFTER },
      { kind: "state_read", arcId: d.id, occurredAt: AFTER },
      { kind: "stale_notification", arcId: d.id, occurredAt: AFTER },
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

// ── work-593 (B5) — THE QUARANTINE REMOVAL MUST MAKE THIS ALARM REACHABLE ───────
//
// 🔴 THE DEFECT THIS BLOCK PINS. `hasCallerGate` turns a `no_progress_with_ready_action`
// WARNING into a `caller_gated` SUPPRESSION. That is right for a WIP-capped driver — it is
// busy by construction. It was catastrophic for a claim-thrash-quarantined one: the seat
// could not work at all, only an architect could release it, and this branch is exactly what
// stopped anyone being told. THE MECHANISM THAT LOCKED A SEAT OUT ALSO SILENCED ITS ALARM.
//
// ─── TWO FALSIFIERS DOING DIFFERENT WORK (idea-677) ───────────────────────────
//   1 NEGATIVE  what must go RED without the diff?  -> the reachability case below: before
//               the removal, `get_next_action` returned {nextAction:null, emptyReason:
//               "quarantined"} for such a seat, which lands in `caller_gated`.
//   2 POSITIVE  what must be observed to CHANGE?    -> `warning` / `no_progress_with_ready_action`
//               is actually PRODUCED, with the action identified. "Did not suppress" is NOT
//               enough: a watchdog that returned `ok/no_graph_action` would also not suppress,
//               and would be just as silent.
//
// ⚠️ AND THE DISCRIMINATOR THAT STOPS THE LAZY FIX. Deleting `hasCallerGate` outright would
// ALSO make the warning reachable — and would be wrong, because every WIP-capped driver would
// start warning about work it is already doing. So the WIP-CAP SUPPRESSION IS ASSERTED TO
// SURVIVE. Either assertion alone passes a wrong implementation; only the pair pins the
// removal to the quarantine term.
describe("work-593: removing the [A] claim-thrash quarantine restores driver liveness reporting", () => {
  const gatedDriver = () => driver();

  it("🔴 REACHABLE, END-TO-END THROUGH THE POLICY SEAM: a stale-quarantined seat now WARNS", async () => {
    // ⚠️ THIS TEST WAS REWRITTEN AFTER ITS FIRST VERSION WAS MEASURED VACUOUS.
    // v1 built the projection by hand with a non-null nextAction and asserted `warning`. It
    // passed — and it passed IDENTICALLY with the quarantine term restored in hasCallerGate,
    // because a non-null nextAction never reaches that branch at all. It was testing
    // pre-existing behaviour and would have shipped as proof of a change it never exercised.
    // The mutation run is what caught it; reasoning about it did not.
    //
    // The diff only changes the outcome if the projection is PRODUCED BY THE POLICY LAYER,
    // because what the removal changed is the SHAPE get_next_action returns for such a seat:
    //   BEFORE  {nextAction: null, emptyReason: "quarantined"}  -> suppressed/caller_gated
    //   AFTER   {nextAction: child}                              -> warning/no_progress...
    const router = new PolicyRouter(() => {});
    registerWorkItemPolicy(router);

    const child = workItem({ id: "child", status: "ready" });
    const d = driver();
    const store = makeNextActionStore({ arcId: d.id, nextAction: child, readyCandidates: 1, hasChildren: true });
    const ctx = createTestContext({ role: "engineer" });
    ctx.stores.workItem = store as unknown as typeof ctx.stores.workItem;
    // The seat carries the stale flag the retired mechanism used to set.
    ctx.stores.engineerRegistry = {
      getRole: () => "engineer",
      getAgentForSession: async () => null,
      getAgent: async () => ({ quarantined: true }),
      claimSession: async () => ({ ok: false }),
      recordWorkItemThrash: async () => null,
      resetWorkItemThrash: async () => 0,
    } as unknown as typeof ctx.stores.engineerRegistry;

    const res = await router.handle("get_next_action", { workId: d.id }, ctx);
    const projected = JSON.parse(res.content[0].text) as NextActionProjection;

    // The seam itself: the policy layer no longer nulls the action for this seat.
    expect(projected.nextAction).not.toBeNull();

    const verdict = evaluateDriverLivenessWatchdog({
      driver: d,
      children: [child],
      driverNextAction: projected,
      baseline: baselineFor([child], d),
      now: NOW,
      thresholdMs: THRESHOLD_MS,
      progressEvents: [],
    });

    expect(verdict.status).toBe("warning");
    expect(verdict.reason).toBe("no_progress_with_ready_action");
    // Clause 2: the alarm must NAME the work, not merely fire. A warning with no action is
    // unactionable — an operator still could not find the stuck seat.
    expect(verdict.action).toMatchObject({ kind: "driver_next_action", childId: "child" });
  });

  it("🔴 DISCRIMINATOR: the WIP-CAP suppression SURVIVES — the removal was surgical, not a deletion", () => {
    // If `hasCallerGate` had simply been deleted, this goes red. That is the whole point of
    // asserting it: it is the only thing distinguishing "removed the quarantine term" from
    // "removed the function".
    const child = workItem({ id: "child", status: "ready" });
    const d = gatedDriver();
    const verdict = evaluateDriverLivenessWatchdog({
      driver: d,
      children: [child],
      driverNextAction: projection(d.id, null, 1, "wip_capped"),
      baseline: baselineFor([child], d),
      now: NOW,
      thresholdMs: THRESHOLD_MS,
      progressEvents: [],
    });

    expect(verdict.status).toBe("suppressed");
    expect(verdict.reason).toBe("caller_gated");
  });

  it("🔴 the `quarantined` reason code is UNREPRESENTABLE — the union no longer admits it", () => {
    // A TYPE-LEVEL assertion, because the runtime one is unreachable by construction: nothing
    // can produce the value any more. This is the guard against a later re-widening of
    // ReadyEmptyReason quietly re-arming the suppression — the string would flow straight
    // back into hasCallerGate if the term were restored there too.
    const p: NextActionProjection = projection(gatedDriver().id, null, 1, "wip_capped");
    // @ts-expect-error work-593: "quarantined" was removed from the emptyReason union.
    p.emptyReason = "quarantined";
    // The `@ts-expect-error` above IS the assertion: it fails to compile if the union ever
    // re-admits the value, which is precisely the regression worth catching.
    expect(p.readyCandidates).toBe(1);
  });
});
