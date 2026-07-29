/**
 * nodestate0b — steve's INDEPENDENT falsifiers, in their POST-FIX form.
 *
 * PROVENANCE, and why this file is not mine:
 *   The fixtures, imports and structure below are steve's
 *   (`docs/verification/nodestate0-verify-build-independent-falsifiers.test.ts@rv=56700103`,
 *   SHA-256 `3bba25e7...`), reproduced byte-for-byte apart from the assertion lines
 *   and their comments. **The implementer does not choose what an independent falsifier
 *   asserts** — every expectation here was specified by steve after the repair, and he
 *   explicitly REJECTED a bare four-operator inversion of his originals. The bars below
 *   bind exact arms and exact sets, not mere truthiness.
 *
 * 🔴 POLARITY, because it inverts intuition:
 *   His PUBLISHED artifact is IMMUTABLE and stays green on the defective candidate — it
 *   is preserved as NEGATIVE LINEAGE against `7e876d4a`, where each assertion passed BY
 *   PROVING THE CONTRADICTION. This source copy is its mirror: it must FAIL on
 *   `7e876d4a` and PASS on the repair. The two are not in conflict; they are the same
 *   measurement read from opposite sides of the fix.
 *
 * VERIFIED both ways — see the commit message for the exact runs. A file asserted to
 * fail on a specific tree is worth nothing until someone checks out that tree.
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
    type: "task",
    priority: "normal",
    roleEligibility: [],
    evidenceRequirements: [{ id: "e", kind: "freeform", description: "e" }],
    runbook: "r",
    createdBy: CREATOR,
    ...extra,
  } as never);
}

describe("Steve nodestate0 verify_build falsifiers — post-fix forms", () => {
  it("criterion 3: legal_moves agrees with abandonWork for the suspended-ready creator", async () => {
    const { repo } = fixture();
    const w = await item(repo);
    await repo.pauseWork({ workId: w.id, operationId: "creator-pause", reason: "self" }, CREATOR);

    const moves = await repo.getLegalMoves(w.id, CREATOR);
    const advertised = moves!.moves.find((m) => m.verb === "abandon")!;
    // steve's bar: bind the VERB AND the legality together, and require NO refusal reason.
    // A move that is legal but still carries a reason is a half-corrected projection.
    expect(advertised).toMatchObject({ verb: "abandon", legal: true });
    expect(advertised.reason).toBeUndefined();

    const abandoned = await repo.abandonWork(w.id, CREATOR.agentId, { reason: "dispose" });
    expect(abandoned!.status).toBe("abandoned");
    expect(abandoned!.suspended).toBe(false);
  });

  // 🔴 F2 BAR REVISED BY THE VERIFIER 13:42Z, AFTER HE ACCEPTED THE FIDELITY FINDING BELOW.
  // The stepped-clock fixture that follows steps `enteredCurrentStateAt` past the baseline, so it
  // clears the dwell guard BY CONSTRUCTION and CANNOT observe bug-461 -- the real-row case where
  // pause and baseline collide in the same instant and the guard swallows the change (measured:
  // 28/40 real pauses missed). It was authored to falsify the COMPARATOR defect and does that
  // precisely, so it REMAINS as narrower regression evidence -- but per his ruling it CANNOT
  // DISCHARGE F2 ALONE. These two coupling cases are now the load-bearing half of criterion 4.
  //
  // A fixture that supplies the condition it is meant to test cannot fail on that condition.

  it("criterion 4/F9-3 coupling: a REAL pauseWork is reported as child_state progress", async () => {
    const { repo } = fixture();
    const w = await item(repo);
    const before = (await repo.getWorkItem(w.id))!;
    await repo.pauseWork({ workId: w.id, operationId: "coupling", reason: "real pause" }, CREATOR);
    const after = (await repo.getWorkItem(w.id))!;

    const lease = { holder: "h", token: "t", claimedAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", heartbeatAt: "2026-01-01T00:00:00Z" };
    const driver = { id: "driver", status: "in_progress", suspended: false, lease,
      blockedOn: null, evidence: [], enteredCurrentStateAt: before.enteredCurrentStateAt } as never;

    const progress = findDriverProgress({
      driver,
      children: [after as never],
      driverNextAction: { arcId: "driver", nextAction: null, readyCandidates: 0, hasChildren: true } as never,
      baseline: {
        // baselined while the row was LIVE, then the row was suspended -- the real sequence
        recordedAt: before.enteredCurrentStateAt,
        driverFingerprint: fingerprintWorkItemForDriverProgress(driver),
        childFingerprints: { [w.id]: fingerprintWorkItemForDriverProgress(before) },
      },
      now: "2099-01-01T00:00:00Z",
      thresholdMs: 1,
    } as never);

    expect(progress).toEqual({
      source: "snapshot",
      kind: "child_state",
      childId: w.id,
    });
  });

  it("criterion 4/F9-3 coupling: pause and baseline at the SAME instant still report child_state progress", () => {
    // LOAD-BEARING per the verifier: reverting the single dwell-bypass mechanism must red THIS.
    // The realistic case above passes or fails on whether the clock happens to tick, so it cannot
    // be relied on to pin the guard; this one pins `entered === baselineAt` exactly, making the
    // dwell equality the thing under test rather than a race.
    const T = "2026-01-01T00:00:00.000Z";
    const lease = { holder: "h", token: "t", claimedAt: T, expiresAt: "2099-01-01T00:00:00Z", heartbeatAt: T };
    const driver = { id: "driver", status: "in_progress", suspended: false, lease,
      blockedOn: null, evidence: [], enteredCurrentStateAt: T } as never;
    const beforeChild = { id: "child", status: "ready", suspended: false, lease: null,
      blockedOn: null, evidence: [], enteredCurrentStateAt: T } as never;
    const afterChild = { ...(beforeChild as object), suspended: true } as never;

    const progress = findDriverProgress({
      driver,
      children: [afterChild],
      driverNextAction: { arcId: "driver", nextAction: null, readyCandidates: 0, hasChildren: true } as never,
      baseline: {
        recordedAt: T, // identical to the child's dwell marker: `entered <= baselineAt` is TRUE
        driverFingerprint: fingerprintWorkItemForDriverProgress(driver),
        childFingerprints: { child: fingerprintWorkItemForDriverProgress(beforeChild) },
      },
      now: "2026-01-01T12:00:00Z",
      thresholdMs: 1,
    } as never);

    expect(progress).toEqual({
      source: "snapshot",
      kind: "child_state",
      childId: "child",
    });
  });

  it("criterion 4/F9-3 [narrower regression evidence]: stepped-clock suspension-only change is reported as child_state progress", () => {
    const driver = {
      id: "driver", status: "in_progress", suspended: false,
      lease: { holder: "h", token: "t", claimedAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", heartbeatAt: "2026-01-01T00:00:00Z" },
      blockedOn: null, evidence: [], enteredCurrentStateAt: "2026-01-01T00:00:00Z",
    } as never;
    const beforeChild = {
      id: "child", status: "in_progress", suspended: false,
      lease: { holder: "c", token: "t", claimedAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", heartbeatAt: "2026-01-01T00:00:00Z" },
      blockedOn: null, evidence: [], enteredCurrentStateAt: "2026-01-01T00:00:01Z",
    } as never;
    const afterChild = { ...(beforeChild as object), suspended: true } as never;

    expect(fingerprintWorkItemForDriverProgress(beforeChild)).not.toEqual(
      fingerprintWorkItemForDriverProgress(afterChild),
    );

    const progress = findDriverProgress({
      driver,
      children: [afterChild],
      driverNextAction: { arcId: "driver", nextAction: null, readyCandidates: 0, hasChildren: true } as never,
      baseline: {
        recordedAt: "2026-01-01T00:00:00Z",
        driverFingerprint: fingerprintWorkItemForDriverProgress(driver),
        childFingerprints: { child: fingerprintWorkItemForDriverProgress(beforeChild) },
      },
      now: "2026-01-01T12:00:00Z",
      thresholdMs: 1,
    } as never);

    // steve's bar: NOT `not.toBeNull()`. The exact arm and the exact child are bound, so a
    // fix that reports progress for the wrong reason — or against the wrong row — still reds.
    expect(progress).toEqual({
      source: "snapshot",
      kind: "child_state",
      childId: "child",
    });
  });

  it("criterion 2: all-abandoned arc is completable by pending=[] and current_stint agrees gateOpen=true", async () => {
    const { repo } = fixture();
    const child = await item(repo);
    const arc = await item(repo, { completionDependsOn: [child.id] });
    await repo.abandonWork(child.id, CREATOR.agentId, { reason: "dropped" });

    const stint = await repo.getStintProjection(arc.id);
    expect(stint!.completion.pending).toEqual([]); // complete_work's gate passes
    expect(stint!.completion.declared).toEqual([child.id]); // this is an arc, not a leaf
    expect(stint!.completion.droppedAbandoned).toEqual([child.id]);
    // steve: "gateOpen=true means the declared completion gate is satisfied after abandoned
    // edges drop; it does not claim delivery." The projection carries the delivery question.
    expect(stint!.gateOpen).toBe(true);
    expect(stint!.completion.active).toEqual([]);
    expect(stint!.completion.failed).toEqual([]);
  });

  it("criterion 2: a true LEAF keeps gateOpen=false — the control that stops the fix over-reaching", async () => {
    // steve's added control. `total===0` is reached BOTH by a leaf and by an all-abandoned arc;
    // only the second may open. Without this, a bare `pending.length===0` passes the case above
    // while silently flipping every leaf in the system.
    const { repo } = fixture();
    const leaf = await item(repo);
    const stint = await repo.getStintProjection(leaf.id);
    expect(stint!.completion.declared).toEqual([]);
    expect(stint!.completion.pending).toEqual([]);
    expect(stint!.gateOpen).toBe(false);
  });

  it("criterion 2: completion projection exposes active IDs and failed IDs as named sets", async () => {
    const { repo, substrate } = fixture();
    const failed = await item(repo);
    await substrate.put("WorkItem", { ...(await repo.getWorkItem(failed.id))!, status: "failed_sealed", effectiveDisposition: "failed_sealed" });
    const arc = await item(repo, { completionDependsOn: [failed.id] });

    const progress = (await repo.getCompletionProgress(arc.id))!;
    // steve's semantics: `active` is the gate-active set AFTER abandoned edges drop, so a FAILED
    // child belongs in active AND pending AND the narrower `failed`. Asserting exact sets rather
    // than property presence is the point — `toHaveProperty` would pass on an empty array.
    expect(progress.pending).toEqual([failed.id]);
    expect(progress.active).toEqual([failed.id]);
    expect(progress.failed).toEqual([failed.id]);
  });
});
