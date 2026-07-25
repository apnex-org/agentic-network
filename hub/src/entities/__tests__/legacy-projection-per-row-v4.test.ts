// idea-633 Part 1 — per-row legacy projection (V2 §2.1) in the currentness fence.
//
// §2.1 is UNCONDITIONAL about projection: "Legacy rows project logicalId=physicalId, revision 1,
// and a deterministic v4 contract without write-on-read." The implementation made it conditional
// on the GLOBAL pin (fence:102 keys only on head existence), so activating the FIRST head made
// every row absent from that generation return null — silently, because getCurrentWork returns
// rather than throws.
//
// All three cases drive the REAL WorkItemRepositorySubstrate against the in-memory substrate.
// Nothing greps source for markers. Nothing touches a live Hub, and NO HEAD IS CREATED except
// inside these throwaway in-memory substrates.
import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import type { WorkItem } from "../work-item.js";
import { WorkItemRepositorySubstrate } from "../work-item-repository-substrate.js";
import { WorkRevisionStorageRepositoryV4, buildWorkRevisionStorageV4 } from "../work-revision-storage-v4.js";

const NOW = "2026-07-25T06:50:00.000Z";
const ARCHITECT = { role: "architect", agentId: "architect-1" };

function work(id: string, over: Partial<WorkItem> = {}): WorkItem {
  return {
    id, type: "task", priority: "normal", roleEligibility: ["engineer"],
    dependsOn: [], completionDependsOn: [], evidenceRequirements: [], references: [],
    targetRef: { kind: "mission", id: "mission-140" }, status: "ready", lease: null,
    evidence: [], frictionReflections: [], blockedOn: null, leaseExpiryCount: 0,
    enteredCurrentStateAt: NOW,
    stateDurations: { ready: 0, claimed: 0, in_progress: 0, blocked: 0, paused: 0, review: 0 },
    attestationHistory: [], attestations: {}, executorHistory: [], createdBy: ARCHITECT,
    createdAt: NOW, updatedAt: NOW, ...over,
  };
}

async function bootstrapGeneration(storage: WorkRevisionStorageRepositoryV4, items: WorkItem[], op = "bootstrap") {
  const built = buildWorkRevisionStorageV4({
    workItems: items,
    boundReferencesByPhysicalId: Object.fromEntries(items.map((i) => [i.id, i.boundReferences ?? []])),
    familyScopesByPhysicalId: Object.fromEntries(items.map((i) => [i.id, { kind: "mission" as const, id: "mission-140" }])),
    generation: 1, previousGeneration: 0, operationId: op, createdAt: NOW,
  });
  await storage.persistPrepared(built);
  await storage.persistProjectedWorkItems(built);
  await storage.activateGeneration(1, op, NOW);
  return built;
}

function harness() {
  const substrate = createMemoryStorageSubstrate();
  return {
    substrate,
    storage: new WorkRevisionStorageRepositoryV4(substrate),
    repo: new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate)),
  };
}

describe("idea-633 Part 1 — per-row legacy projection", () => {
  it("CALIBRATION: with NO head, an ordinary row resolves as legacy (gen 0)", async () => {
    // Establishes that the instrument can SEE a resolving row before any case claims one
    // stopped resolving. Without this, F-A's 'resolves' could be an artefact of a harness that
    // resolves everything.
    const { substrate, repo } = harness();
    await substrate.put("WorkItem", work("cal-row") as unknown as Record<string, unknown>);
    const got = await repo.getCurrentWork("cal-row");
    expect(got).not.toBeNull();
    expect(got!.generation).toBe(0);
    expect(got!.topologyHash).toBe("legacy");
  });

  it("F-A: after a bootstrap, a row OUTSIDE the bound set STILL RESOLVES", async () => {
    // THE MEASURED REGRESSION. Pre-fix this returned null: the unbound row went
    // RESOLVES gen=0 -> NULL the moment a generation was activated.
    const { substrate, storage, repo } = harness();
    const bound = work("bound-row");
    const orphan = work("orphan-row");
    await substrate.put("WorkItem", orphan as unknown as Record<string, unknown>);
    await bootstrapGeneration(storage, [bound]);

    const gotOrphan = await repo.getCurrentWork("orphan-row");
    expect(gotOrphan, "unbound row must not vanish when a head exists").not.toBeNull();
    expect(gotOrphan!.generation).toBe(0);
    expect(gotOrphan!.topologyHash).toBe("legacy");
    expect(gotOrphan!.physicalId).toBe("orphan-row");
  });

  it("F-B: a row INSIDE the set resolves at the NEW generation, not legacy", async () => {
    // Guards the fallback SHADOWING a real binding — if legacy won here, every bound row would
    // silently report generation 0 and the whole generation mechanism would be inert.
    const { storage, repo } = harness();
    const bound = work("bound-row");
    await bootstrapGeneration(storage, [bound]);

    const got = await repo.getCurrentWork("bound-row");
    expect(got).not.toBeNull();
    expect(got!.generation, "bound row must resolve at its generation, NOT legacy").toBe(1);
    expect(got!.topologyHash).not.toBe("legacy");
  });

  it("F-C: SUPERSESSION IS NOT SHADOWED — a revised logicalId returns the SUCCESSOR, never the legacy predecessor", async () => {
    // THE FIX'S OWN FAILURE MODE, and the one that would be silent-and-green: if the fallback
    // ever won over an existing binding, get_current_work would hand back the PREDECESSOR after
    // a revision — the row still exists at its old physical id, so nothing would error.
    // ARMED: the predecessor is deliberately still present in the substrate, so a shadowing bug
    // has something wrong to return. A test that deleted it could not distinguish the failure.
    const { storage, repo } = harness();
    const original = work("subject", { runbook: "original" });
    await bootstrapGeneration(storage, [original]);

    const before = await repo.getCurrentWork("subject");
    expect(before!.physicalId).toBe("subject");

    await repo.reviseWork({
      logicalId: "subject", operationId: "rev-1", reason: "semantic correction",
      expectedGeneration: 1, set: { runbook: "corrected" },
    }, ARCHITECT);

    const after = await repo.getCurrentWork("subject");
    expect(after, "revised logicalId must still resolve").not.toBeNull();
    // The successor is a NEW physical row; the predecessor's id must NOT be what we get back.
    expect(after!.physicalId, "must return the SUCCESSOR, not the legacy predecessor").not.toBe("subject");
    expect(after!.generation, "successor resolves at the new generation, not legacy 0").toBe(2);
    expect(after!.topologyHash).not.toBe("legacy");
    expect(after!.workItem.runbook).toBe("corrected");
    // and the predecessor is still reachable by EXACT physical id (§1 invariant 3)
    const predecessor = await repo.getWorkItem("subject");
    expect(predecessor, "predecessor must remain reachable by exact physical id").not.toBeNull();
  });

  // A :2624 case was written, run, and REMOVED. It asserted that a child whose completion parent
  // is an unbound legacy row completes rather than throwing — and it was VACUOUS: the mutation
  // matrix returned GREEN when the :2624 fallback was reverted, which is impossible for a sound
  // test. Measured cause: buildWorkRevisionStorageV4 rejects a generation carrying an edge to an
  // unbound target (storage.dangling_edge), and for a bound child whose parent was never in the
  // set reverseCompletionDependsOn is []. So the edge does not exist in the generation at all and
  // the `!binding` branch is unreachable — the case could never produce the observation it
  // claimed to test. The real defect is the opposite: such a parent is INVISIBLE and silently
  // never bumped. Filed as bug-370; deliberately NOT tested here, because there is nothing in
  // this node's diff for such a test to defend.
});
