import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import type { WorkItem } from "../work-item.js";
import { WorkItemRepositorySubstrate } from "../work-item-repository-substrate.js";
import {
  WorkRevisionStorageRepositoryV4,
  buildWorkRevisionStorageV4,
  type BuiltWorkRevisionStorageV4,
  type WorkRevisionFamilyRowV4,
} from "../work-revision-storage-v4.js";
import { WorkGraphCurrentnessRejected } from "../workgraph-currentness-fence-v4.js";

const NOW = "2026-07-23T17:00:00.000Z";

function work(id: string, over: Partial<WorkItem> = {}): WorkItem {
  return {
    id,
    type: "task",
    priority: "normal",
    roleEligibility: ["engineer"],
    dependsOn: [],
    completionDependsOn: [],
    evidenceRequirements: [],
    references: [],
    targetRef: { kind: "mission", id: "mission-140" },
    status: "ready",
    lease: null,
    evidence: [],
    frictionReflections: [],
    blockedOn: null,
    leaseExpiryCount: 0,
    enteredCurrentStateAt: NOW,
    stateDurations: { ready: 0, claimed: 0, in_progress: 0, blocked: 0, paused: 0, review: 0 },
    attestationHistory: [],
    attestations: {},
    executorHistory: [],
    createdBy: { role: "architect", agentId: "architect-1" },
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function build(items: WorkItem[], generation: number, previousGeneration: number, operationId: string, families?: Record<string, WorkRevisionFamilyRowV4>): BuiltWorkRevisionStorageV4 {
  return buildWorkRevisionStorageV4({
    workItems: items,
    boundReferencesByPhysicalId: Object.fromEntries(items.map((item) => [item.id, item.boundReferences ?? []])),
    familyScopesByPhysicalId: Object.fromEntries(items.map((item) => [item.id, { kind: "mission", id: "mission-140" }])),
    existingFamiliesByLogicalId: families,
    generation,
    previousGeneration,
    operationId,
    createdAt: NOW,
  });
}

async function stage(storage: WorkRevisionStorageRepositoryV4, built: BuiltWorkRevisionStorageV4): Promise<void> {
  await storage.persistPrepared(built);
  await storage.persistProjectedWorkItems(built);
  await storage.activateGeneration(built.generation.generation, built.generation.operationId, NOW);
}

describe("Mission-140 universal WorkGraph currentness fence v4", () => {
  it("preserves legacy behavior before a head exists", async () => {
    const substrate = createMemoryStorageSubstrate();
    const repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
    const created = await repo.createWorkItem({ type: "task", roleEligibility: ["engineer"] });
    const claimed = await repo.claimWorkItem(created.id, "engineer-1", "engineer");
    expect(claimed?.status).toBe("claimed");
    expect((await repo.startWork(created.id, "engineer-1", claimed!.lease!.token))?.status).toBe("in_progress");
  });

  it("returns exact historical rows but excludes them from projections and makes every legal move false", async () => {
    const substrate = createMemoryStorageSubstrate();
    const storage = new WorkRevisionStorageRepositoryV4(substrate);
    const built = build([work("a")], 1, 0, "activate-1");
    await stage(storage, built);
    const repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
    const current = (await repo.getWorkItem("a"))!;
    await substrate.put("WorkItem", { ...current, id: "a-old", status: "ready", lease: null });

    expect((await repo.getWorkItem("a-old"))?.id).toBe("a-old"); // exact physical read never follows
    const listed = await repo.listWorkItems();
    expect(listed.items.map((item) => item.id)).toEqual(["a"]);
    expect(listed.items[0]).toMatchObject({ observedTopologyGeneration: 1, observedTopologyHash: built.generation.topologyHash });
    const moves = await repo.getLegalMoves("a-old", { agentId: "engineer-1", role: "engineer" });
    expect(moves?.observedTopologyGeneration).toBe(1);
    expect(moves?.moves.every((move) => !move.legal)).toBe(true);
    expect(moves?.moves[0]?.reason).toContain("old_or_draft");
  });

  it("fences all direct creates and old-row writes while current-row lifecycle writes remain legal", async () => {
    const substrate = createMemoryStorageSubstrate();
    const storage = new WorkRevisionStorageRepositoryV4(substrate);
    const built = build([work("a")], 1, 0, "activate-1");
    await stage(storage, built);
    const repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
    const current = (await repo.getWorkItem("a"))!;
    await substrate.put("WorkItem", { ...current, id: "a-old" });

    await expect(repo.createWorkItem({ type: "task", roleEligibility: ["engineer"] }))
      .rejects.toMatchObject({ code: "workgraph.currentness.revision_required" });
    await expect(repo.startWork("a-old", "engineer-1", "stale"))
      .rejects.toMatchObject({ code: "workgraph.currentness.old_or_draft" });
    const claimed = await repo.claimWorkItem("a", "engineer-1", "engineer");
    expect(claimed?.status).toBe("claimed");
    const started = await repo.startWork("a", "engineer-1", claimed!.lease!.token);
    expect(started?.status).toBe("in_progress");
  });

  it("preserves an active holder across a disconnected generation when physical binding and local identity are unchanged", async () => {
    const substrate = createMemoryStorageSubstrate();
    const storage = new WorkRevisionStorageRepositoryV4(substrate);
    const first = build([work("a")], 1, 0, "activate-1");
    await stage(storage, first);
    const repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
    const claimed = await repo.claimWorkItem("a", "engineer-1", "engineer");
    await repo.startWork("a", "engineer-1", claimed!.lease!.token);
    const activeA = (await repo.listWorkItems({ holder: "engineer-1" })).items[0]!;
    expect(activeA.observedTopologyGeneration).toBe(1);
    const familyA = (await storage.getFamily("a"))!;

    const second = build([activeA, work("disconnected")], 2, 1, "activate-2", { a: familyA });
    expect(second.projections.find((p) => p.physicalId === "a")!.localExecutionIdentity).toBe(activeA.localExecutionIdentity);
    await stage(storage, second);
    const renewed = await repo.renewLease("a", "engineer-1", claimed!.lease!.token);
    expect(renewed?.lease?.holder).toBe("engineer-1");
    const listed = await repo.listWorkItems({ holder: "engineer-1" });
    expect(listed.items[0]).toMatchObject({ id: "a", topologyGeneration: 1, observedTopologyGeneration: 2 });
    const exact = (await repo.getWorkItem("a"))!;
    expect(exact.observedTopologyGeneration).toBeUndefined();
    expect(exact.observedTopologyHash).toBeUndefined();
  });

  it("rejects same-logical successor drift on the old physical row with current target metadata", async () => {
    const substrate = createMemoryStorageSubstrate();
    const storage = new WorkRevisionStorageRepositoryV4(substrate);
    const first = build([work("a-r1", { logicalId: "a", revision: 1 })], 1, 0, "activate-1");
    await stage(storage, first);
    const family = (await storage.allocateNextRevision({
      logicalId: "a",
      originPhysicalId: "a-r1",
      originalCreatedBy: { role: "architect", agentId: "architect-1" },
      familyScope: { kind: "mission", id: "mission-140" },
      createdAt: NOW,
    })).family;
    const successor = work("a-r2", {
      logicalId: "a", revision: 2, predecessorPhysicalId: "a-r1",
      runbook: "semantic successor",
      // Deliberate laundering probe: pause authority must resolve immutable family
      // originalCreatedBy, never this successor-local stamp or revisedBy.
      createdBy: { role: "engineer", agentId: "successor-author" },
      revisedBy: { role: "engineer", agentId: "successor-author" },
    });
    const second = build([successor], 2, 1, "activate-2", { a: family });
    await stage(storage, second);
    const repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
    await expect(repo.claimWorkItem("a-r1", "engineer-1", "engineer"))
      .rejects.toMatchObject({
        code: "workgraph.currentness.old_or_draft",
        current: { logicalId: "a", physicalId: "a-r2", revision: 2, generation: 2 },
      });
    await expect(repo.pauseWork({ workId: "a-r1", operationId: "old-pause", reason: "must reject" }, { role: "architect", agentId: "architect-1" }))
      .rejects.toMatchObject({ code: "workgraph.currentness.old_or_draft" });
    const launderedMoves = await repo.getLegalMoves("a-r2", { role: "engineer", agentId: "successor-author" });
    expect(launderedMoves!.moves.find((move) => move.verb === "pause")!.legal).toBe(false);
    await expect(repo.pauseWork({ logicalId: "a", operationId: "laundered-pause", reason: "must reject" }, { role: "engineer", agentId: "successor-author" }))
      .rejects.toThrow("original creator");
    const paused = await repo.pauseWork({
      logicalId: "a", operationId: "logical-pause", reason: "current logical target",
      expectedRevision: 2, expectedGeneration: 2,
    }, { role: "architect", agentId: "architect-1" });
    expect(paused).toMatchObject({ id: "a-r2", status: "paused", revision: 2 });
    await repo.unpauseWork({ logicalId: "a", expectedRevision: 2, expectedGeneration: 2 }, { role: "architect", agentId: "architect-1" });
    const current = await repo.claimWorkItem("a-r2", "engineer-1", "engineer");
    expect(current?.status).toBe("claimed");
  });
});
