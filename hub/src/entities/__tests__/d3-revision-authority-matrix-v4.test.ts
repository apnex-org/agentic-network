import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import type { WorkItem, WorkItemReference } from "../work-item.js";
import { WorkItemRepositorySubstrate } from "../work-item-repository-substrate.js";
import { WorkRevisionStorageRepositoryV4, buildWorkRevisionStorageV4 } from "../work-revision-storage-v4.js";
import { bindWorkItemReferencesV4, type BoundWorkItemReferenceV4 } from "../work-item-contract-v4.js";

const NOW = "2026-07-23T22:45:00.000Z";
const CREATOR = { role: "engineer", agentId: "creator-1" };
const ARCHITECT = { role: "architect", agentId: "architect-1" };
const DIRECTOR = { role: "director", agentId: "director-1" };

function work(id: string, over: Partial<WorkItem> = {}): WorkItem {
  return {
    id, type: "task", priority: "normal", roleEligibility: ["engineer"],
    dependsOn: [], completionDependsOn: [], evidenceRequirements: [], references: [],
    targetRef: { kind: "bug", id: "bug-origin" }, status: "ready", lease: null,
    evidence: [], frictionReflections: [], blockedOn: null, leaseExpiryCount: 0,
    enteredCurrentStateAt: NOW,
    stateDurations: { ready: 0, claimed: 0, in_progress: 0, blocked: 0, paused: 0, review: 0 },
    attestationHistory: [], attestations: {}, executorHistory: [], createdBy: CREATOR,
    createdAt: NOW, updatedAt: NOW, ...over,
  };
}

type Scope = { kind: "mission" | "standalone"; id: string };

async function setup(options: {
  rootScope?: Scope;
  dependentScope?: Scope;
  withDependent?: boolean;
  withTarget?: boolean;
  root?: Partial<WorkItem>;
  withRequiredDocument?: boolean;
} = {}) {
  const substrate = createMemoryStorageSubstrate();
  const storage = new WorkRevisionStorageRepositoryV4(substrate);
  let reference: WorkItemReference | undefined;
  let bound: BoundWorkItemReferenceV4 | undefined;
  if (options.withRequiredDocument) {
    const document = { id: "docs/d3/required.md", path: "docs/d3/required.md", content: "required authority input", category: "test", createdBy: ARCHITECT, createdAt: NOW, updatedAt: NOW };
    const stored = await substrate.put("Document", document);
    reference = { kind: "doc", ref: document.path, storage: "hub-doc", mode: "read", required: true };
    bound = bindWorkItemReferencesV4([reference], [{ storage: "hub-doc", path: document.path, resourceVersion: stored.resourceVersion, content: document.content, snapshotToken: "d3-snapshot" }], "d3-snapshot")[0]!;
  }
  const root = work("root", {
    ...(reference && bound ? { references: [reference], boundReferences: [bound] } : {}),
    ...options.root,
  });
  const items = [
    root,
    ...(options.withDependent ? [work("dependent", { dependsOn: ["root"] })] : []),
    ...(options.withTarget ? [work("target")] : []),
  ];
  const rootScope = options.rootScope ?? { kind: "standalone", id: "root" };
  const dependentScope = options.dependentScope ?? rootScope;
  const built = buildWorkRevisionStorageV4({
    workItems: items,
    boundReferencesByPhysicalId: Object.fromEntries(items.map((item) => [item.id, item.boundReferences ?? []])),
    familyScopesByPhysicalId: Object.fromEntries(items.map((item) => [item.id, item.id === "root" ? rootScope : dependentScope])),
    generation: 1, previousGeneration: 0, operationId: "d3-bootstrap", createdAt: NOW,
  });
  await storage.persistPrepared(built);
  await storage.persistProjectedWorkItems(built);
  await storage.activateGeneration(1, "d3-bootstrap", NOW);
  return { storage, repo: new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate)) };
}

function request(operationId: string, patch: Record<string, unknown> = {}) {
  return {
    logicalId: "root",
    operationId,
    reason: "D3 matrix test",
    expectedGeneration: 1,
    set: { runbook: `revision ${operationId}` },
    ...patch,
  };
}

async function expectDenied(
  promise: Promise<unknown>,
  code: string,
  storage: WorkRevisionStorageRepositoryV4,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
  expect((await storage.getHead())?.head.generation).toBe(1);
  expect((await storage.getFamily("root"))?.latestAllocatedRevision).toBe(1);
}

describe("Mission-140 V2 D3 exact server-derived revision authority matrix", () => {
  it("denies creator revision of a mission-scoped family", async () => {
    const { repo, storage } = await setup({ rootScope: { kind: "mission", id: "mission-140" } });
    await expectDenied(repo.reviseWork(request("creator-mission"), CREATOR), "revision.architect_required", storage);
  });

  it("allows the narrow creator standalone single-node contract revision", async () => {
    const { repo } = await setup();
    const revised = await repo.reviseWork(request("creator-standalone"), CREATOR);
    expect(revised).toMatchObject({ affectedSet: ["root"], generation: 2 });
  });

  it("denies creator topology replacement before allocation", async () => {
    const { repo, storage } = await setup({ withTarget: true });
    await expectDenied(repo.reviseWork(request("creator-edge", { dependsOn: ["target"], expectedAffectedSet: ["root"] }), CREATOR), "revision.architect_required", storage);
  });

  it("denies creator required-reference removal", async () => {
    const { repo, storage } = await setup({ withRequiredDocument: true });
    await expectDenied(repo.reviseWork(request("creator-reference", { references: [] }), CREATOR), "revision.authority_expansion_forbidden", storage);
  });

  it("denies creator lease and pulse escalation", async () => {
    const lease = await setup({ root: { leaseWindowMs: 300_000 } });
    await expectDenied(repoPromise(lease.repo, request("creator-lease", { set: { leaseWindowMs: 86_400_000 } }), CREATOR), "revision.authority_expansion_forbidden", lease.storage);

    const pulse = await setup({ root: { nodeConfig: { pulse: { intervalSeconds: 300, message: "status", responseShape: "ack", missedThreshold: 2 } } } });
    await expectDenied(repoPromise(pulse.repo, request("creator-pulse", { set: { nodeConfig: { pulse: { intervalSeconds: 60, message: "status", responseShape: "ack", missedThreshold: 5 } } } }), CREATOR), "revision.authority_expansion_forbidden", pulse.storage);
  });

  it("denies creator target-scope and role expansion", async () => {
    const target = await setup();
    await expectDenied(repoPromise(target.repo, request("creator-target", { set: { targetRef: { kind: "mission", id: "mission-foreign" } } }), CREATOR), "revision.authority_expansion_forbidden", target.storage);

    const role = await setup();
    await expectDenied(repoPromise(role.repo, request("creator-role", { set: { roleEligibility: ["engineer", "architect"] } }), CREATOR), "revision.authority_expansion_forbidden", role.storage);
  });

  it("denies architect and Director cross-scope closures but permits one same-mission closure", async () => {
    const mixed = await setup({ withDependent: true, rootScope: { kind: "mission", id: "mission-140" }, dependentScope: { kind: "standalone", id: "dependent" } });
    await expectDenied(mixed.repo.reviseWork(request("architect-mixed", { expectedAffectedSet: ["dependent", "root"] }), ARCHITECT), "revision.cross_scope_forbidden", mixed.storage);

    const crossMission = await setup({ withDependent: true, rootScope: { kind: "mission", id: "mission-140" }, dependentScope: { kind: "mission", id: "mission-other" } });
    await expectDenied(crossMission.repo.reviseWork(request("director-cross", { expectedAffectedSet: ["dependent", "root"] }), DIRECTOR), "revision.cross_scope_forbidden", crossMission.storage);

    const sameMission = await setup({ withDependent: true, rootScope: { kind: "mission", id: "mission-140" }, dependentScope: { kind: "mission", id: "mission-140" } });
    await expect(sameMission.repo.reviseWork(request("architect-same", { expectedAffectedSet: ["dependent", "root"] }), ARCHITECT)).resolves.toMatchObject({ affectedSet: ["dependent", "root"], generation: 2 });
  });

  it("denies unrelated, creator-stamp-mismatched, and former-holder actors with exact codes", async () => {
    const unrelated = await setup();
    await expectDenied(unrelated.repo.reviseWork(request("unrelated"), { role: "verifier", agentId: "other" }), "revision.actor_forbidden", unrelated.storage);

    const mismatch = await setup();
    await expectDenied(mismatch.repo.reviseWork(request("creator-role-spoof"), { role: "verifier", agentId: CREATOR.agentId }), "revision.family_owner_mismatch", mismatch.storage);

    const holder = await setup({ root: { executorHistory: ["former-holder"] } });
    await expectDenied(holder.repo.reviseWork(request("former-holder"), { role: "engineer", agentId: "former-holder" }), "revision.holder_has_no_authority", holder.storage);
  });

  it("permits architect and Director same-mission revision while fencing target scope", async () => {
    const architect = await setup({ rootScope: { kind: "mission", id: "mission-140" } });
    await expect(architect.repo.reviseWork(request("architect-single"), ARCHITECT)).resolves.toMatchObject({ generation: 2 });

    const director = await setup({ rootScope: { kind: "mission", id: "mission-140" } });
    await expect(director.repo.reviseWork(request("director-single"), DIRECTOR)).resolves.toMatchObject({ generation: 2 });

    const crossing = await setup({ rootScope: { kind: "mission", id: "mission-140" } });
    await expectDenied(repoPromise(crossing.repo, request("architect-target-cross", { set: { targetRef: { kind: "mission", id: "mission-other" } } }), ARCHITECT), "revision.cross_scope_forbidden", crossing.storage);
  });

  it("requires architect or Director for batch recommit and rejects successor-author laundering", async () => {
    const batch = await setup({ rootScope: { kind: "mission", id: "mission-140" } });
    const revised = await batch.repo.reviseWork(request("batch-source"), ARCHITECT);
    const recommit = {
      logicalIds: revised.affectedSet,
      expectedGeneration: revised.generation,
      expectedRevisions: Object.fromEntries(revised.current.map((entry) => [entry.logicalId, entry.revision])),
      operationId: "batch-recommit",
      reason: "D3 exact batch authority",
    };
    await expect(batch.repo.recommitRevisionSet(recommit, CREATOR)).rejects.toMatchObject({ code: "revision.director_or_architect_required" });
    await expect(batch.repo.recommitRevisionSet(recommit, ARCHITECT)).resolves.toMatchObject({ operationReplay: false });

    await expect(batch.repo.reviseWork({ ...request("successor-author-launder"), expectedGeneration: 2 }, { role: "engineer", agentId: ARCHITECT.agentId }))
      .rejects.toMatchObject({ code: "revision.family_owner_mismatch" });
    expect((await batch.storage.getHead())?.head.generation).toBe(2);
  });

  it("uses exact affected-set and currentness denial taxonomy", async () => {
    const mismatch = await setup({ withDependent: true });
    await expectDenied(mismatch.repo.reviseWork(request("affected-mismatch", { expectedAffectedSet: ["root"] }), ARCHITECT), "revision.affected_set_mismatch", mismatch.storage);

    const stale = await setup();
    await expectDenied(stale.repo.reviseWork({ ...request("stale-generation"), expectedGeneration: 99 }, ARCHITECT), "revision.currentness_mismatch", stale.storage);
  });
});

function repoPromise(
  repo: WorkItemRepositorySubstrate,
  value: ReturnType<typeof request>,
  actor: { role: string; agentId: string },
) {
  return repo.reviseWork(value, actor);
}
