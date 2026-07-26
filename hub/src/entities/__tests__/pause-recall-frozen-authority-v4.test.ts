import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { SubstrateCounter } from "../substrate-counter.js";
import { WorkItemRepositorySubstrate } from "../work-item-repository-substrate.js";
import {
  WorkRevisionStorageRepositoryV4,
  buildWorkRevisionStorageV4,
} from "../work-revision-storage-v4.js";
import type { WorkItem } from "../work-item.js";

const CREATOR = { role: "engineer", agentId: "engineer-creator" };
const ARCH = { role: "architect", agentId: "architect-1" };
const NOW = "2026-07-23T19:20:00.000Z";

function work(id: string, createdBy = CREATOR): WorkItem {
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
    createdBy,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

async function activeGenerationFixture() {
  const substrate = createMemoryStorageSubstrate();
  const repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
  const parent = work("parent");
  const stable = work("stable");
  const child = work("child", ARCH);
  const items = [parent, stable, child];
  const built = buildWorkRevisionStorageV4({
    workItems: items,
    boundReferencesByPhysicalId: Object.fromEntries(items.map((item) => [item.id, []])),
    familyScopesByPhysicalId: Object.fromEntries(items.map((item) => [item.id, { kind: "mission" as const, id: "mission-140" }])),
    generation: 1,
    previousGeneration: 0,
    operationId: "pause-frozen-generation-1",
    createdAt: NOW,
  });
  const storage = new WorkRevisionStorageRepositoryV4(substrate);
  await storage.persistPrepared(built);
  await storage.persistProjectedWorkItems(built);
  await storage.activateGeneration(1, built.operation.operationId, NOW);
  return { substrate, repo, parent, stable, child };
}

const pause = (repo: WorkItemRepositorySubstrate, workId: string, operationId: string) =>
  repo.pauseWork({ workId, operationId, reason: "frozen generation repair proof", expectedRevision: 1, expectedGeneration: 1 }, CREATOR);

describe("Mission-140 frozen paused-generation authority", () => {
  it("freezes every public update_work claimant/edge alias while allowing priority-only scalar amendment", async () => {
    const { repo, parent, child } = await activeGenerationFixture();
    const paused = (await pause(repo, parent.id, "freeze-aliases"))!;
    const frozen = paused.recallHistory?.at(-1)?.frozenAuthority;
    expect(frozen).toMatchObject({
      version: "frozen-recall-authority-v4",
      mode: "generation",
      physicalId: parent.id,
      revision: 1,
      generation: 1,
      dependsOnLogicalIds: [],
      completionDependsOnLogicalIds: [],
    });
    expect(frozen?.authorityHash).toMatch(/^[0-9a-f]{64}$/);

    const mutations: Array<Parameters<WorkItemRepositorySubstrate["updateWorkItem"]>[2]> = [
      { set: { targetRef: { kind: "mission", id: "mission-other" } } },
      { set: { runbook: "changed" } },
      { set: { payload: { changed: true } } },
      { set: { roleEligibility: ["director"] } },
      { appendDependsOn: [child.id] },
      { appendCompletionDependsOn: [child.id] },
      { appendReferences: [{ kind: "doc", ref: "frozen", storage: "inline", mode: "read", required: false }] },
    ];
    for (const mutation of mutations) {
      await expect(repo.updateWorkItem(parent.id, CREATOR, mutation)).rejects.toMatchObject({
        code: "workgraph.currentness.revision_required",
      });
    }

    const scalar = await repo.updateWorkItem(parent.id, CREATOR, { set: { priority: "high" } });
    expect(scalar.after).toMatchObject({ suspended: true, priority: "high" });
    const unpaused = (await repo.unpauseWork({ workId: parent.id, expectedRevision: 1, expectedGeneration: 1 }, CREATOR))!;
    expect(unpaused).toMatchObject({ status: "ready", priority: "high", targetRef: { kind: "mission", id: "mission-140" } });
    expect(unpaused.completionDependsOn).toEqual([]);
    expect(unpaused.recallHistory).toEqual(paused.recallHistory);
  });

  it("rejects Steve's persisted targetRef+completion-edge falsifier after restart without losing history", async () => {
    const { substrate, repo, parent, child } = await activeGenerationFixture();
    const paused = (await pause(repo, parent.id, "steve-falsifier"))!;
    const exactHistory = structuredClone(paused.recallHistory);
    const exactAttestations = structuredClone(paused.attestationHistory);

    // Reproduce the old candidate's unsafe end-state directly: actual claimant fields
    // change while every stored node/topology/local identity hash stays byte-identical.
    await substrate.put("WorkItem", {
      ...paused,
      targetRef: { kind: "mission", id: "mission-other" },
      completionDependsOn: [child.id],
    } as WorkItem);

    const restarted = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
    await expect(restarted.unpauseWork(
      { workId: parent.id, expectedRevision: 1, expectedGeneration: 1 },
      CREATOR,
    )).rejects.toMatchObject({ code: "workgraph.currentness.revision_required" });

    const retained = (await restarted.getWorkItem(parent.id))!;
    expect(retained).toMatchObject({
      suspended: true,
      targetRef: { kind: "mission", id: "mission-other" },
      completionDependsOn: [child.id],
      lease: null,
    });
    expect(retained.recallHistory).toEqual(exactHistory);
    expect(retained.attestationHistory).toEqual(exactAttestations);
    expect(retained.recallHistory).toHaveLength(1);
  });

  it("serializes unpause versus every semantic mutation alias; mutation cannot win before or after unpause", async () => {
    const aliases: Array<[string, (childId: string) => Parameters<WorkItemRepositorySubstrate["updateWorkItem"]>[2]]> = [
      ["targetRef", () => ({ set: { targetRef: { kind: "mission", id: "mission-race" } } })],
      ["runbook", () => ({ set: { runbook: "race" } })],
      ["payload", () => ({ set: { payload: { race: true } } })],
      ["roleEligibility", () => ({ set: { roleEligibility: ["director"] } })],
      ["dependsOn", (childId) => ({ appendDependsOn: [childId] })],
      ["completionDependsOn", (childId) => ({ appendCompletionDependsOn: [childId] })],
      ["references", () => ({ appendReferences: [{ kind: "doc", ref: "race", storage: "inline", mode: "read", required: false }] })],
    ];
    for (const [name, mutation] of aliases) {
      const { repo, parent, child } = await activeGenerationFixture();
      await pause(repo, parent.id, `race-${name}`);
      const [unpauseResult, mutationResult] = await Promise.allSettled([
        repo.unpauseWork({ workId: parent.id, expectedRevision: 1, expectedGeneration: 1 }, CREATOR),
        repo.updateWorkItem(parent.id, CREATOR, mutation(child.id)),
      ]);
      expect(unpauseResult.status).toBe("fulfilled");
      expect(mutationResult.status).toBe("rejected");
      if (mutationResult.status === "rejected") {
        expect(mutationResult.reason).toMatchObject({ code: "workgraph.currentness.revision_required" });
      }
      const final = (await repo.getWorkItem(parent.id))!;
      expect(final).toMatchObject({ status: "ready", targetRef: { kind: "mission", id: "mission-140" } });
      expect(final.dependsOn).toEqual([]);
      expect(final.completionDependsOn).toEqual([]);
      expect(final.references).toEqual([]);
      expect(final.recallHistory).toHaveLength(1);
    }
  });

  it("fails closed when frozen pause authority is missing or internally changed", async () => {
    for (const variant of ["missing", "changed"] as const) {
      const { substrate, repo, stable } = await activeGenerationFixture();
      const paused = (await pause(repo, stable.id, `frozen-${variant}`))!;
      const history = structuredClone(paused.recallHistory)!;
      if (variant === "missing") delete history[0].frozenAuthority;
      else history[0].frozenAuthority!.nodeContractHash = "0".repeat(64);
      await substrate.put("WorkItem", { ...paused, recallHistory: history } as WorkItem);
      const restarted = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
      await expect(restarted.unpauseWork(
        { workId: stable.id, expectedRevision: 1, expectedGeneration: 1 },
        CREATOR,
      )).rejects.toMatchObject({ code: "workgraph.currentness.revision_required" });
      expect((await restarted.getWorkItem(stable.id))!.suspended).toBe(true);
    }
  });
});
