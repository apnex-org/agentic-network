import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import type { WorkItem } from "../work-item.js";
import { WorkItemRepositorySubstrate } from "../work-item-repository-substrate.js";
import { WorkRevisionStorageRepositoryV4, buildWorkRevisionStorageV4 } from "../work-revision-storage-v4.js";
import { bindWorkItemReferencesV4, type BoundWorkItemReferenceV4 } from "../work-item-contract-v4.js";

const NOW = "2026-07-23T22:00:00.000Z";
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

async function setup(options?: { documentContent?: string }) {
  const substrate = createMemoryStorageSubstrate();
  const storage = new WorkRevisionStorageRepositoryV4(substrate);
  let bReference: { reference: NonNullable<WorkItem["references"]>[number]; bound: BoundWorkItemReferenceV4 } | undefined;
  if (options?.documentContent !== undefined) {
    const document = { id: "docs/revision/input.md", path: "docs/revision/input.md", content: options.documentContent, category: "test", createdBy: ARCHITECT, createdAt: NOW, updatedAt: NOW };
    const stored = await substrate.put("Document", document);
    const reference = { kind: "doc", ref: document.path, storage: "hub-doc" as const, mode: "read" as const, required: true };
    bReference = { reference, bound: bindWorkItemReferencesV4([reference], [{ storage: "hub-doc", path: document.path, resourceVersion: stored.resourceVersion, content: document.content, snapshotToken: "snapshot-1" }], "snapshot-1")[0]! };
  }
  const items = [
    work("b", bReference ? { references: [bReference.reference], boundReferences: [bReference.bound], runbook: "read the bound input" } : {}),
    work("a", { dependsOn: ["b"] }),
    work("p", { completionDependsOn: ["a"] }),
    work("c"),
  ];
  const built = buildWorkRevisionStorageV4({
    workItems: items,
    boundReferencesByPhysicalId: Object.fromEntries(items.map((item) => [item.id, item.boundReferences ?? []])),
    familyScopesByPhysicalId: Object.fromEntries(items.map((item) => [item.id, { kind: "mission" as const, id: "mission-140" }])),
    generation: 1, previousGeneration: 0, operationId: "bootstrap", createdAt: NOW,
  });
  await storage.persistPrepared(built);
  await storage.persistProjectedWorkItems(built);
  await storage.activateGeneration(1, "bootstrap", NOW);
  return { substrate, storage, repo: new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate)) };
}

const reviseRequest = {
  logicalId: "b",
  operationId: "revise-b-2",
  reason: "semantic contract correction",
  expectedGeneration: 1,
  expectedAffectedSet: ["a", "b", "p"],
  set: { runbook: "execute corrected semantics" },
};

describe("Mission-140 public semantic revision + atomic recommit v4", () => {
  it("revises the exhaustive mixed-edge reverse closure, preserves history, and resolves current explicitly", async () => {
    const { repo, storage } = await setup();
    const result = await repo.reviseWork(reviseRequest, ARCHITECT);
    expect(result).toMatchObject({ generation: 2, previousGeneration: 1, affectedSet: ["a", "b", "p"], recommitSet: ["a", "b", "p"], operationReplay: false });
    expect(result.current.every((entry) => entry.revision === 2)).toBe(true);
    expect((await repo.getWorkItem("b"))?.status).toBe("ready"); // exact history, never redirected
    expect((await repo.getCurrentWork("b"))?.workItem).toMatchObject({ status: "paused", runbook: "execute corrected semantics", predecessorPhysicalId: "b", evidence: [], attestationHistory: [] });
    expect((await repo.getCurrentWork("c"))?.physicalId).toBe("c");
    expect((await storage.getOperation("revise-b-2"))?.recommitSet).toEqual(["a", "b", "p"]);

    await expect(repo.claimWorkItem("b", "engineer-1", "engineer")).rejects.toMatchObject({ code: "workgraph.currentness.old_or_draft" });
    const replay = await repo.reviseWork(reviseRequest, ARCHITECT);
    expect(replay.operationReplay).toBe(true);
    expect(replay.current).toEqual(result.current);
  });

  it("recovers a process-death window after durable preparation but before head CAS", async () => {
    const { repo, substrate } = await setup();
    const original = WorkRevisionStorageRepositoryV4.prototype.activateGeneration;
    let interrupted = true;
    WorkRevisionStorageRepositoryV4.prototype.activateGeneration = async function (...args: Parameters<typeof original>) {
      if (interrupted && args[1] === reviseRequest.operationId) {
        interrupted = false;
        throw new Error("simulated process death before head CAS");
      }
      return original.apply(this, args);
    };
    try {
      await expect(repo.reviseWork(reviseRequest, ARCHITECT)).rejects.toThrow("simulated process death");
    } finally {
      WorkRevisionStorageRepositoryV4.prototype.activateGeneration = original;
    }
    const afterRestart = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
    const recovered = await afterRestart.reviseWork(reviseRequest, ARCHITECT);
    expect(recovered).toMatchObject({ generation: 2, operationReplay: true, affectedSet: ["a", "b", "p"] });
    expect((await afterRestart.getCurrentWork("b"))?.workItem.status).toBe("paused");
  });

  it("atomically recommits the exact successor set and restart-style retry is read-only", async () => {
    const { repo, storage, substrate } = await setup();
    const revised = await repo.reviseWork(reviseRequest, ARCHITECT);
    const expectedRevisions = Object.fromEntries(revised.current.map((entry) => [entry.logicalId, entry.revision]));
    const request = {
      logicalIds: revised.affectedSet,
      expectedRevisions,
      expectedGeneration: revised.generation,
      operationId: "recommit-b-2",
      reason: "activate exact revised closure",
    };
    const committed = await repo.recommitRevisionSet(request, ARCHITECT);
    expect(committed.operationReplay).toBe(false);
    expect(committed.workItems.map((item) => item.status)).toEqual(["ready", "ready", "ready"]);
    expect(await storage.getOperation("revise-b-2")).toMatchObject({ recommitSet: [], recommittedSet: ["a", "b", "p"], recommitOperationId: "recommit-b-2" });

    const afterRestart = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
    const replay = await afterRestart.recommitRevisionSet(request, ARCHITECT);
    expect(replay.operationReplay).toBe(true);
    expect(replay.workItems.every((item) => item.status === "ready")).toBe(true);
  });

  it("rejects non-exhaustive closure and cycles before head publication", async () => {
    const { repo, storage } = await setup();
    await expect(repo.reviseWork({ ...reviseRequest, operationId: "bad-closure", expectedAffectedSet: ["b"] }, ARCHITECT))
      .rejects.toMatchObject({ code: "workgraph.currentness.head_changed" });
    await expect(repo.reviseWork({ ...reviseRequest, operationId: "cycle", expectedAffectedSet: undefined, dependsOn: ["p"] }, ARCHITECT))
      .rejects.toMatchObject({ code: "storage.cycle" });
    expect((await storage.getHead())?.head.generation).toBe(1);
  });

  it("fails closed when a same-path mutable document is overwritten after admission", async () => {
    const { repo, substrate, storage } = await setup({ documentContent: "admitted bytes" });
    await substrate.put("Document", { id: "docs/revision/input.md", path: "docs/revision/input.md", content: "overwritten bytes", category: "test", createdBy: ARCHITECT, createdAt: NOW, updatedAt: NOW });
    await expect(repo.reviseWork(reviseRequest, ARCHITECT)).rejects.toMatchObject({ code: "workgraph.currentness.identity_mismatch" });
    expect((await storage.getHead())?.head.generation).toBe(1);
    expect((await repo.getCurrentWork("b"))?.physicalId).toBe("b");
  });

  it("authoritatively rebinds a changed Hub-document locator from fresh bytes", async () => {
    const { repo, substrate } = await setup({ documentContent: "old bytes" });
    await substrate.put("Document", { id: "docs/revision/new.md", path: "docs/revision/new.md", content: "new authoritative bytes", category: "test", createdBy: ARCHITECT, createdAt: NOW, updatedAt: NOW });
    await repo.reviseWork({
      ...reviseRequest,
      operationId: "document-rebind",
      references: [{ kind: "doc", ref: "docs/revision/new.md", storage: "hub-doc", mode: "read", required: true }],
    }, ARCHITECT);
    const current = await repo.getCurrentWork("b");
    expect(current?.workItem.boundReferences?.[0]).toMatchObject({ locator: "docs/revision/new.md", contentIdentity: { path: "docs/revision/new.md", utf8Bytes: 23 } });
  });

  it.each(["github-issue", "decision", "pr-review", "incident", "calibration", "skill"])("revises generic %s entity bindings without evidence migration", async (kind) => {
    const { repo } = await setup();
    const result = await repo.reviseWork({ ...reviseRequest, operationId: `entity-${kind}`, set: { targetRef: { kind, id: `${kind}-42` } } }, ARCHITECT);
    const current = await repo.getCurrentWork("b");
    expect(result.affectedSet).toEqual(["a", "b", "p"]);
    expect(current?.workItem).toMatchObject({ targetRef: { kind, id: `${kind}-42` }, status: "paused", evidence: [], attestationHistory: [] });
  });

  it("serializes revise-vs-revise and lets only one expected-generation writer publish", async () => {
    const { repo, storage } = await setup();
    const attempts = await Promise.allSettled([
      repo.reviseWork(reviseRequest, ARCHITECT),
      repo.reviseWork({ logicalId: "c", operationId: "revise-c-2", reason: "competing semantic edit", expectedGeneration: 1, set: { runbook: "other" } }, ARCHITECT),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    expect((await storage.getHead())?.head.generation).toBe(2);
  });

  it("fences a concurrent claim behind revision publication so the historical row cannot win", async () => {
    const { repo } = await setup();
    const revisionPromise = repo.reviseWork(reviseRequest, ARCHITECT);
    const claimPromise = repo.claimWorkItem("b", "engineer-1", "engineer");
    await expect(revisionPromise).resolves.toMatchObject({ generation: 2 });
    await expect(claimPromise).rejects.toMatchObject({ code: "workgraph.currentness.old_or_draft" });
    expect((await repo.getCurrentWork("b"))?.workItem.status).toBe("paused");
  });

  it("computes and publishes a 1001-node reverse closure without a 500-row truncation", async () => {
    const substrate = createMemoryStorageSubstrate();
    const storage = new WorkRevisionStorageRepositoryV4(substrate);
    const items = Array.from({ length: 1001 }, (_, index) => work(`n-${String(index).padStart(4, "0")}`, index === 0 ? {} : { dependsOn: [`n-${String(index - 1).padStart(4, "0")}`] }));
    const built = buildWorkRevisionStorageV4({
      workItems: items,
      boundReferencesByPhysicalId: Object.fromEntries(items.map((item) => [item.id, []])),
      familyScopesByPhysicalId: Object.fromEntries(items.map((item) => [item.id, { kind: "mission" as const, id: "mission-140" }])),
      generation: 1, previousGeneration: 0, operationId: "large-bootstrap", createdAt: NOW,
    });
    await storage.persistPrepared(built);
    await storage.persistProjectedWorkItems(built);
    await storage.activateGeneration(1, "large-bootstrap", NOW);
    const repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
    const result = await repo.reviseWork({
      logicalId: "n-0000", operationId: "large-revision", reason: "scale proof",
      expectedGeneration: 1, set: { runbook: "large corrected root" },
    }, ARCHITECT);
    expect(result.affectedSet).toHaveLength(1001);
    expect(result.affectedSet[0]).toBe("n-0000");
    expect(result.affectedSet.at(-1)).toBe("n-1000");
    expect((await storage.loadEdgesComplete(2))).toHaveLength(1000);
  }, 120_000);

  it("does not publish a partial ready set when the atomic batch loses one CAS", async () => {
    const { repo } = await setup();
    const revised = await repo.reviseWork(reviseRequest, ARCHITECT);
    await expect(repo.recommitRevisionSet({
      logicalIds: revised.affectedSet,
      expectedRevisions: { a: 2, b: 999, p: 2 },
      expectedGeneration: 2,
      operationId: "bad-recommit",
      reason: "must fail closed",
    }, ARCHITECT)).rejects.toBeTruthy();
    expect((await Promise.all(revised.affectedSet.map((id) => repo.getCurrentWork(id)))).map((row) => row?.workItem.status)).toEqual(["paused", "paused", "paused"]);
  });
});
