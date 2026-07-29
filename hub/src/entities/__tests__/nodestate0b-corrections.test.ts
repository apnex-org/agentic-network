/**
 * nodestate0b — the four corrections to candidate `7e876d4a` (steve's independent FAIL).
 *
 * 🔴 THE RULE THIS FILE EXISTS TO OBEY, and the reason the arc needed a second pass:
 *
 *     EVERY ASSERTION HERE RUNS A DECISION PATH. None of them asserts a SHAPE.
 *
 * F2 escaped the first build because its test asserted that the progress fingerprint
 * CONTAINED `suspended`. It did. `hasSnapshotProgress` never read it, so the value was
 * stored and inert, and the fix looked done from the test. A field added to a struct will
 * never red a test that only reads the struct. So each case below drives the real consumer
 * and asserts the OUTCOME changed — a verdict, a gate, a returned set — not that a
 * property is present.
 *
 * The second habit, from the same lineage: F1 and F3 are PARITY defects, where two surfaces
 * answered one question differently. A test that exercises either surface alone cannot see
 * that class at all. So those cases assert the PAIR in a single test, against one fixture.
 */
import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import { WorkItemRepositorySubstrate } from "../work-item-repository-substrate.js";
import {
  findDriverProgress,
  fingerprintWorkItemForDriverProgress,
} from "../../policy/driver-liveness-watchdog.js";

const CREATOR = { role: "engineer", agentId: "creator" };

function fixture() {
  const substrate = createMemoryStorageSubstrate();
  substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
  return { substrate, repo: new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate)) };
}

async function item(repo: WorkItemRepositorySubstrate, extra: Record<string, unknown> = {}) {
  return repo.createWorkItem({
    type: "task", priority: "normal", roleEligibility: [],
    evidenceRequirements: [{ id: "e", kind: "freeform", description: "e" }],
    runbook: "r", createdBy: CREATOR, ...extra,
  } as never);
}

describe("F1 (bug-424) — legal_moves ADVERTISES exactly what abandonWork DOES", () => {
  it("🔴 THE PAIR: the advertisement and the CAS agree for a suspended-ready creator", async () => {
    const { repo } = fixture();
    const w = await item(repo);
    await repo.pauseWork({ workId: w.id, operationId: "p", reason: "self" }, CREATOR);

    // BOTH surfaces, ONE fixture. Testing either alone is what let F1 through.
    const advertised = (await repo.getLegalMoves(w.id, CREATOR))!.moves.find((m) => m.verb === "abandon")!;
    const abandoned = await repo.abandonWork(w.id, CREATOR.agentId, { reason: "dispose" });

    expect(advertised.legal).toBe(true);          // was FALSE — the contradiction steve measured
    expect(abandoned!.status).toBe("abandoned");  // the CAS always permitted it
    expect(advertised.legal).toBe(abandoned !== null); // the invariant: advertise what you will do
  });

  it("🔴 the DENIED arm still agrees, and carries the matrix reason", async () => {
    // A holder whose row a STEWARD suspended must be refused by BOTH surfaces. If the fix
    // had simply allowlisted `abandon`, this case would wrongly advertise legal.
    const { repo } = fixture();
    const w = await item(repo);
    const claimed = await repo.claimWorkItem(w.id, "holder", "engineer");
    expect(claimed?.lease?.holder).toBe("holder"); // the fixture must actually hold the row,
    // else `abandon` is illegal for an unrelated reason and this case proves nothing.
    await repo.pauseWork(
      { workId: w.id, operationId: "steward-pause", reason: "management withdrawal" },
      { role: "architect", agentId: "arch" },
    );

    const caller = { agentId: "holder", role: "engineer" };
    const advertised = (await repo.getLegalMoves(w.id, caller))!.moves.find((m) => m.verb === "abandon")!;
    expect(advertised.legal).toBe(false);
    expect(advertised.reason).toMatch(/holder_after_steward_suspension/);

    await expect(
      repo.abandonWork(w.id, "holder", { reason: "override", leaseToken: claimed?.lease?.token }),
    ).rejects.toThrow(/holder_after_steward_suspension/);
  });

  it("🟢 CONTROL: the allowlist still fails CLOSED for every other verb", async () => {
    // The fix adds ONE conditional exemption. It must not have opened the gate generally.
    const { repo } = fixture();
    const w = await item(repo);
    await repo.pauseWork({ workId: w.id, operationId: "p", reason: "self" }, CREATOR);
    const moves = (await repo.getLegalMoves(w.id, CREATOR))!.moves;
    for (const verb of ["claim", "start", "block", "release", "complete", "renew"]) {
      const m = moves.find((x) => x.verb === verb);
      if (m) expect(m.legal).toBe(false);
    }
  });
});

describe("F2 (bug-423 F9-3) — the watchdog DECIDES on suspension, not merely records it", () => {
  it("🔴 findDriverProgress returns progress when suspension is the ONLY change", () => {
    const lease = { holder: "h", token: "t", expiresAt: "2099-01-01T00:00:00Z" };
    const driver = { id: "drv", status: "in_progress", suspended: false, lease,
      blockedOn: null, evidence: [], enteredCurrentStateAt: "2026-01-01T00:00:00Z" } as never;
    const before = { id: "c", status: "in_progress", suspended: false, lease,
      blockedOn: null, evidence: [], enteredCurrentStateAt: "2026-01-01T00:00:01Z" } as never;
    const after = { ...(before as object), suspended: true } as never;

    // THE DECISION PATH. The old test asserted the fingerprints differed — they always did.
    const progress = findDriverProgress({
      driver, children: [after],
      driverNextAction: { arcId: "drv", nextAction: null, readyCandidates: 0, hasChildren: true } as never,
      baseline: {
        recordedAt: "2026-01-01T00:00:00Z",
        driverFingerprint: fingerprintWorkItemForDriverProgress(driver),
        childFingerprints: { c: fingerprintWorkItemForDriverProgress(before) },
      },
      now: "2026-01-01T12:00:00Z", thresholdMs: 1,
    } as never);

    expect(progress).not.toBeNull();
    expect(progress!.childId).toBe("c");
  });

  it("🔴 bug-461 COUPLING: a REAL pauseWork is detected — not a fixture that steps the clock itself", async () => {
    // WHY THIS EXISTS, and why the two cases above are NOT enough:
    //
    // `hasSnapshotProgress` early-returns when `enteredCurrentStateAt <= baselineAt`. The comparator
    // fix is only REACHED because `pauseWork` happens to move that marker (it calls
    // accrueExitingState) — while pauseWork's own comment says the phase deliberately does NOT move.
    // So F2's sufficiency rests on a behaviour that CONTRADICTS ITS OWN DOCUMENTED INTENT and that
    // nobody deliberately chose (bug-461).
    //
    // A future reader "correcting" that inconsistency — a defensible cleanup, consistent with the
    // orthogonal-suspension model this arc shipped — would make the dwell guard fire, the comparator
    // never run, and this fix silently stop working. EVERY fixture-based test above would STILL PASS,
    // because a fixture that steps the timestamp itself never exercises the dependency.
    //
    // This case drives the REAL verb and takes its baseline from the REAL pre-pause marker, so the
    // coupling is EXECUTED against the real verb rather than a hand-built row.
    //
    // 🔴 CORRECTED (verifier, nodestate0b-v2): this comment used to claim "if pauseWork stops
    // moving `enteredCurrentStateAt`, this reds". THAT IS NO LONGER TRUE, and the reason is the
    // fix itself — the suspension flip is now decided BEFORE the dwell guard, so progress is
    // INDEPENDENT of whether the marker moves. This case would survive that change.
    // The DETERMINISTIC same-instant case below is the load-bearing guard for bug-461; this one
    // is realistic-path evidence. A test comment that describes a dependency the fix deliberately
    // removed is exactly the stale-artefact defect this arc keeps meeting.
    const { repo } = fixture();
    const w = await item(repo);
    const before = (await repo.getWorkItem(w.id))!;
    await repo.pauseWork({ workId: w.id, operationId: "coupling", reason: "real pause" }, CREATOR);
    const after = (await repo.getWorkItem(w.id))!;

    expect(before.suspended).not.toBe(true);
    expect(after.suspended).toBe(true);

    const lease = { holder: "h", token: "t", expiresAt: "2099-01-01T00:00:00Z" };
    const driver = { id: "drv", status: "in_progress", suspended: false, lease,
      blockedOn: null, evidence: [], enteredCurrentStateAt: before.enteredCurrentStateAt } as never;
    const progress = findDriverProgress({
      driver, children: [after as never],
      driverNextAction: { arcId: "drv", nextAction: null, readyCandidates: 0, hasChildren: true } as never,
      baseline: {
        // the REAL shape: baselined while the row was live, then the row was suspended
        recordedAt: before.enteredCurrentStateAt,
        driverFingerprint: fingerprintWorkItemForDriverProgress(driver),
        childFingerprints: { [w.id]: fingerprintWorkItemForDriverProgress(before) },
      },
      now: "2099-01-01T00:00:00Z", thresholdMs: 1,
    } as never);

    expect(progress).not.toBeNull();
    expect(progress!.childId).toBe(w.id);
  });

  it("🔴 bug-461 DETERMINISTIC: the SAME-MILLISECOND case — dwell marker unmoved, suspension flipped", () => {
    // The coupling test above drives the real verb, which makes it REALISTIC but timing-dependent:
    // it only exercises the collision when the clock happens not to tick. MEASURED: with the
    // comparator fix alone, a real pause collided ~70% of the time and the watchdog MISSED 28/40.
    // This case pins the collision EXACTLY — baseline recordedAt == the row's own dwell marker —
    // so the dwell guard is guaranteed to be the thing under test rather than a race.
    const T = "2026-01-01T00:00:00.000Z";
    const lease = { holder: "h", token: "t", expiresAt: "2099-01-01T00:00:00Z" };
    const driver = { id: "drv", status: "in_progress", suspended: false, lease,
      blockedOn: null, evidence: [], enteredCurrentStateAt: T } as never;
    const before = { id: "c", status: "ready", suspended: false, lease: null,
      blockedOn: null, evidence: [], enteredCurrentStateAt: T } as never;
    const after = { ...(before as object), suspended: true } as never;

    const progress = findDriverProgress({
      driver, children: [after],
      driverNextAction: { arcId: "drv", nextAction: null, readyCandidates: 0, hasChildren: true } as never,
      baseline: {
        recordedAt: T, // identical to the child's dwell marker: `entered <= baselineAt` is TRUE
        driverFingerprint: fingerprintWorkItemForDriverProgress(driver),
        childFingerprints: { c: fingerprintWorkItemForDriverProgress(before) },
      },
      now: "2026-01-01T12:00:00Z", thresholdMs: 1,
    } as never);

    // Without the pre-guard suspension check this is null EVERY time, not 70% of the time.
    expect(progress).not.toBeNull();
    expect(progress!.childId).toBe("c");
  });

  it("🟢 CONTROL: a same-millisecond row with NO suspension change is still NOT progress", () => {
    // The bypass must be narrow: it exempts a suspension FLIP from the dwell guard, not everything.
    // If it leaked, stale `ready` churn would read as progress and the watchdog would go blind.
    const T = "2026-01-01T00:00:00.000Z";
    const lease = { holder: "h", token: "t", expiresAt: "2099-01-01T00:00:00Z" };
    const driver = { id: "drv", status: "in_progress", suspended: false, lease,
      blockedOn: null, evidence: [], enteredCurrentStateAt: T } as never;
    const child = { id: "c", status: "ready", suspended: false, lease: null,
      blockedOn: null, evidence: [], enteredCurrentStateAt: T } as never;
    const progress = findDriverProgress({
      driver, children: [child],
      driverNextAction: { arcId: "drv", nextAction: null, readyCandidates: 0, hasChildren: true } as never,
      baseline: { recordedAt: T,
        driverFingerprint: fingerprintWorkItemForDriverProgress(driver),
        childFingerprints: { c: fingerprintWorkItemForDriverProgress(child) } },
      now: "2026-01-01T12:00:00Z", thresholdMs: 1,
    } as never);
    expect(progress).toBeNull();
  });

  it("🟢 CONTROL: an unchanged child still reports NO progress", () => {
    // Accuracy, not a blanket "always progress" that would defeat the watchdog.
    const lease = { holder: "h", token: "t", expiresAt: "2099-01-01T00:00:00Z" };
    const driver = { id: "drv", status: "in_progress", suspended: false, lease,
      blockedOn: null, evidence: [], enteredCurrentStateAt: "2026-01-01T00:00:00Z" } as never;
    const child = { id: "c", status: "in_progress", suspended: false, lease,
      blockedOn: null, evidence: [], enteredCurrentStateAt: "2026-01-01T00:00:01Z" } as never;
    const progress = findDriverProgress({
      driver, children: [child],
      driverNextAction: { arcId: "drv", nextAction: null, readyCandidates: 0, hasChildren: true } as never,
      baseline: {
        recordedAt: "2026-01-01T00:00:00Z",
        driverFingerprint: fingerprintWorkItemForDriverProgress(driver),
        childFingerprints: { c: fingerprintWorkItemForDriverProgress(child) },
      },
      now: "2026-01-01T12:00:00Z", thresholdMs: 1,
    } as never);
    expect(progress).toBeNull();
  });
});

describe("F3 (bug-433) — gateOpen and the completion gate answer the SAME question", () => {
  it("🔴 THE PAIR: an all-abandoned arc is completable AND reports gateOpen TRUE", async () => {
    const { repo } = fixture();
    const child = await item(repo);
    const arc = await item(repo, { completionDependsOn: [child.id] });
    await repo.abandonWork(child.id, CREATOR.agentId, { reason: "dropped" });

    const stint = await repo.getStintProjection(arc.id);
    expect(stint!.completion.pending).toEqual([]);              // complete_work's gate passes
    expect(stint!.completion.declared).toEqual([child.id]);     // an ARC, not a leaf
    expect(stint!.completion.droppedAbandoned).toEqual([child.id]);
    expect(stint!.gateOpen).toBe(true);                         // was FALSE — the contradiction
    // The invariant, stated directly: for a declared arc the two must never disagree.
    expect(stint!.gateOpen).toBe(stint!.completion.pending.length === 0);
  });

  it("🟢 CONTROL: a LEAF still reports gateOpen FALSE — 'no arc-gate', not 'open'", async () => {
    // The discriminator is DECLARED topology. A bare `pending.length === 0` would flip every
    // leaf in the system to true and silently redefine the field.
    const { repo } = fixture();
    const leaf = await item(repo);
    const stint = await repo.getStintProjection(leaf.id);
    expect(stint!.completion.declared).toEqual([]);
    expect(stint!.completion.pending).toEqual([]);
    expect(stint!.gateOpen).toBe(false);
  });

  it("🟢 CONTROL: a FAILED child still holds the gate SHUT (fail-closed preserved)", async () => {
    const { repo, substrate } = fixture();
    const failed = await item(repo);
    await substrate.put("WorkItem", {
      ...(await repo.getWorkItem(failed.id))!, status: "failed_sealed", effectiveDisposition: "failed_sealed",
    });
    const arc = await item(repo, { completionDependsOn: [failed.id] });
    const stint = await repo.getStintProjection(arc.id);
    expect(stint!.completion.pending).toEqual([failed.id]);
    expect(stint!.gateOpen).toBe(false);
  });
});

describe("F4 (bug-433) — the projection names ACTIVE and FAILED as their own ID sets", () => {
  it("🔴 a failed child is RETRIEVABLE from a named `failed` set, not merged into pending", async () => {
    const { repo, substrate } = fixture();
    const failed = await item(repo);
    await substrate.put("WorkItem", {
      ...(await repo.getWorkItem(failed.id))!, status: "failed_sealed", effectiveDisposition: "failed_sealed",
    });
    const arc = await item(repo, { completionDependsOn: [failed.id] });

    const progress = (await repo.getCompletionProgress(arc.id))!;
    expect(progress.failed).toEqual([failed.id]);   // the set that did not exist
    expect(progress.active).toEqual([failed.id]);   // still active: failure is not a drop
    expect(progress.pending).toEqual([failed.id]);  // and still holds the gate
    expect(progress.droppedAbandoned).toEqual([]);
  });

  it("🔴 the five sets separate a DROPPED child from an ACTIVE one on one arc", async () => {
    // '0 active / N abandoned must be impossible to mistake for all work delivered' — with the
    // gate now OPENING on all-abandoned, these sets carry that meaning alone.
    const { repo } = fixture();
    const dropped = await item(repo);
    const live = await item(repo);
    const arc = await item(repo, { completionDependsOn: [dropped.id, live.id] });
    await repo.abandonWork(dropped.id, CREATOR.agentId, { reason: "dropped" });

    const p = (await repo.getCompletionProgress(arc.id))!;
    expect(p.declared).toEqual([dropped.id, live.id]);
    expect(p.droppedAbandoned).toEqual([dropped.id]);
    expect(p.active).toEqual([live.id]);
    expect(p.failed).toEqual([]);
    expect(p.total).toBe(1);
  });

  it("🟢 PARITY: getStintProjection.completion and getCompletionProgress agree on all five sets", async () => {
    // The two are computed in PARALLEL for perf. F3/F4 both arose from them drifting, so the
    // agreement is asserted directly rather than assumed.
    const { repo } = fixture();
    const dropped = await item(repo);
    const live = await item(repo);
    const arc = await item(repo, { completionDependsOn: [dropped.id, live.id] });
    await repo.abandonWork(dropped.id, CREATOR.agentId, { reason: "dropped" });

    const stint = (await repo.getStintProjection(arc.id))!.completion;
    const direct = (await repo.getCompletionProgress(arc.id))!;
    expect(stint).toEqual(direct);
  });
});
