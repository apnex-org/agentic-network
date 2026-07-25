import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/index.js";
import type { WorkItem } from "../work-item.js";
import {
  WorkRevisionStorageError,
  WorkRevisionStorageRepositoryV4,
  assertRevisionSnapshotManifestV4,
  assertRevisionStorageIntegrityV4,
  buildWorkRevisionStorageV4,
  compareShadowGenerationV4,
  createRevisionSnapshotManifestV4,
  type BuildWorkRevisionStorageInputV4,
} from "../work-revision-storage-v4.js";
import { hashCanonicalDomain } from "../work-item-contract-v4.js";
import { decodeEnvelopeToFlat } from "../shape-helpers.js";

const NOW = "2026-07-23T16:00:00.000Z";

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

function input(items: WorkItem[], over: Partial<BuildWorkRevisionStorageInputV4> = {}): BuildWorkRevisionStorageInputV4 {
  return {
    workItems: items,
    boundReferencesByPhysicalId: Object.fromEntries(items.map((w) => [w.id, []])),
    familyScopesByPhysicalId: Object.fromEntries(items.map((w) => [w.id, { kind: "mission", id: "mission-140" }])),
    generation: 1,
    previousGeneration: 0,
    operationId: "op-bootstrap-1",
    createdAt: NOW,
    shardSize: 2,
    ...over,
  };
}

describe("Mission-140 work revision storage v4", () => {
  it("projects legacy rows deterministically without mutation and builds complete forward/reverse topology", () => {
    const a = work("a", { dependsOn: ["b"], completionDependsOn: ["c"] });
    const b = work("b");
    const c = work("c");
    const before = structuredClone([a, b, c]);
    const built = buildWorkRevisionStorageV4(input([a, b, c]));

    expect([a, b, c]).toEqual(before); // no write-on-read / projection mutation
    expect(built.generation.dependsOn).toEqual({ a: ["b"], b: [], c: [] });
    expect(built.generation.reverseDependsOn).toEqual({ a: [], b: ["a"], c: [] });
    expect(built.generation.reverseCompletionDependsOn).toEqual({ a: [], b: [], c: ["a"] });
    expect(built.families.map((f) => [f.logicalId, f.originPhysicalId, f.latestAllocatedRevision])).toEqual([
      ["a", "a", 1], ["b", "b", 1], ["c", "c", 1],
    ]);
    expect(built.projections.every((p) => p.revisionFields.nodeContractHashVersion === "node-contract-v4")).toBe(true);
    expect(built.projections.every((p) => p.revisionFields.nodeTopologyHashVersion === "node-topology-v4")).toBe(true);
    expect(built.projections.every((p) => /^[0-9a-f]{64}$/.test(p.localExecutionIdentity))).toBe(true);
    expect(built.shards.map((s) => s.logicalIds)).toEqual([["a", "b"], ["c"]]);
    expect(built.generation.shardHashes).toEqual(built.shards.map((s) => s.shardHash));
    expect(built.edges).toHaveLength(2);
  });

  it("scans, binds, shadows, and CAS-migrates legacy rows without lifecycle loss before activation", async () => {
    const substrate = createMemoryStorageSubstrate();
    const repo = new WorkRevisionStorageRepositoryV4(substrate);
    const legacy = work("legacy", { evidence: [{ requirementId: "x", kind: "freeform", ref: "kept", producedAt: NOW }] });
    await substrate.put("WorkItem", legacy);
    const seenTokens: string[] = [];
    const built = await repo.bootstrapLegacyShadow({
      generation: 1,
      previousGeneration: 0,
      operationId: "legacy-bootstrap-1",
      createdAt: NOW,
      bindReferences: async (_item, snapshotToken) => { seenTokens.push(snapshotToken); return []; },
    });
    expect(seenTokens).toHaveLength(1);
    expect(seenTokens[0]).toMatch(/^\d+$/);
    expect((await substrate.get<WorkItem>("WorkItem", "legacy"))!.logicalId).toBeUndefined();
    await repo.migrateLegacyProjectedWorkItems(built);
    const migratedRaw = (await substrate.get<WorkItem>("WorkItem", "legacy"))!;
    const migrated = decodeEnvelopeToFlat(migratedRaw as unknown as Record<string, unknown>, "WorkItem") as unknown as WorkItem;
    expect(migrated).toMatchObject({ logicalId: "legacy", revision: 1, status: "ready", evidence: legacy.evidence });
    await repo.migrateLegacyProjectedWorkItems(built); // exact retry is read-only
    expect((await repo.activateGeneration(1, "legacy-bootstrap-1", NOW)).generation).toBe(1);
  });

  it("separates disconnected generation churn from local identity while direct-target contract changes invalidate the source", () => {
    const base = [work("a", { dependsOn: ["b"] }), work("b"), work("c")];
    const first = buildWorkRevisionStorageV4(input(base));
    const disconnected = buildWorkRevisionStorageV4(input([
      base[0]!, base[1]!, work("c", { runbook: "changed disconnected contract" }),
    ], { generation: 2, previousGeneration: 1, operationId: "op-2" }));
    const directTarget = buildWorkRevisionStorageV4(input([
      base[0]!, work("b", { runbook: "changed direct target contract" }), base[2]!,
    ], { generation: 2, previousGeneration: 1, operationId: "op-3" }));

    const local = (built: typeof first, id: string) => built.projections.find((p) => p.logicalId === id)!.localExecutionIdentity;
    expect(local(disconnected, "a")).toBe(local(first, "a"));
    expect(local(disconnected, "b")).toBe(local(first, "b"));
    expect(local(disconnected, "c")).not.toBe(local(first, "c"));
    expect(local(directTarget, "a")).not.toBe(local(first, "a"));
  });

  it("fails closed on unbound references, dangling edges, duplicate edges, and mixed-edge cycles", () => {
    const referenced = work("ref", { references: [{ kind: "doc", ref: "docs/x.md", storage: "hub-doc", mode: "read", required: true }] });
    expect(() => buildWorkRevisionStorageV4(input([referenced]))).toThrowError(/storage.reference_unbound/);
    expect(() => buildWorkRevisionStorageV4(input([work("a", { dependsOn: ["missing"] })]))).toThrowError(/storage.dangling_edge/);
    expect(() => buildWorkRevisionStorageV4(input([work("a", { dependsOn: ["b", "b"] }), work("b")]))).toThrowError(/duplicate/);
    expect(() => buildWorkRevisionStorageV4(input([
      work("a", { dependsOn: ["b"] }),
      work("b", { completionDependsOn: ["a"] }),
    ]))).toThrowError(/storage.cycle/);
    expect(() => buildWorkRevisionStorageV4(input([work("a")], {
      generation: 3, previousGeneration: 1,
    }))).toThrowError(/storage.pointer_rollback/);
  });

  it("builds uncapped complete reverse indexes and deterministic <=500-row shards", () => {
    const sources = Array.from({ length: 601 }, (_, i) => work(`source-${String(i).padStart(3, "0")}`, { dependsOn: ["target"] }));
    const built = buildWorkRevisionStorageV4(input([work("target"), ...sources], { shardSize: 500 }));
    expect(built.generation.reverseDependsOn.target).toHaveLength(601);
    expect(built.edges).toHaveLength(601);
    expect(built.shards).toHaveLength(2);
    expect(built.shards[0]!.logicalIds).toHaveLength(500);
    expect(built.shards[1]!.logicalIds).toHaveLength(102);
  });

  it("derives legacy active FAIL before raw phase/currentness without write-on-read", () => {
    const failed = work("failed", {
      type: "verifier-gate",
      status: "ready",
      evidenceRequirements: [{ id: "seal", kind: "review", evidenceAuthority: "verifier-attestation" }],
      attestations: {
        seal: {
          requirementId: "seal", verifierId: "verifier-1", verdict: "fail", producedAt: NOW,
          evidenceRefs: [{ kind: "external", ref: "trace" }], requirementHash: "r", targetRefSnapshot: { kind: "mission", id: "mission-140" },
          targetRefHash: "t", evidenceSetHash: "e",
        },
      },
    });
    const before = structuredClone(failed);
    const built = buildWorkRevisionStorageV4(input([failed]));
    expect(built.projections[0]!.effectiveDisposition).toBe("failed_sealed");
    expect(failed).toEqual(before);
  });

  it("dual-read shadow comparison names exact divergent dimensions", () => {
    const i = input([work("a"), work("b", { dependsOn: ["a"] })]);
    const built = buildWorkRevisionStorageV4(i);
    expect(compareShadowGenerationV4(i, built.generation)).toMatchObject({ equal: true, divergences: [] });
    const corrupted = structuredClone(built.generation);
    corrupted.reverseDependsOn.a = [];
    expect(compareShadowGenerationV4(i, corrupted)).toMatchObject({ equal: false, divergences: ["reverseDependsOn"] });
  });

  it("snapshot/restore guard binds head, manifest, shards, reverse edges, families, operations, and notices", () => {
    const notice = {
      intentId: "notice-1", operationId: "op-bootstrap-1", generation: 1,
      logicalId: "a", physicalId: "a", exactHolderAgentId: "agent-1",
      payloadHash: hashCanonicalDomain("notice-payload-v4", { a: 1 }), createdAt: NOW,
    };
    const built = buildWorkRevisionStorageV4(input([work("a"), work("b", { dependsOn: ["a"] })], { notices: [notice] }));
    const head = {
      id: "global-v1" as const, domain: "global-v1" as const, generation: 1,
      manifestId: built.generation.id, topologyHash: built.generation.topologyHash,
      operationId: built.generation.operationId, activatedAt: NOW,
    };
    const snapshot = {
      head, generation: built.generation, shards: built.shards, edges: built.edges,
      families: built.families, operation: { ...built.operation, state: "committed" as const, committedAt: NOW }, notices: built.notices,
    };
    expect(() => assertRevisionStorageIntegrityV4(snapshot)).not.toThrow();
    const manifest = createRevisionSnapshotManifestV4(snapshot);
    expect(() => assertRevisionSnapshotManifestV4(snapshot, manifest)).not.toThrow();

    const corruptReverse = structuredClone(snapshot);
    corruptReverse.generation.reverseDependsOn.a = [];
    expect(() => assertRevisionStorageIntegrityV4(corruptReverse)).toThrowError(/reverseDependsOn/);
    const corruptShard = structuredClone(snapshot);
    corruptShard.shards[0]!.bindings.a!.revision = 99;
    expect(() => assertRevisionStorageIntegrityV4(corruptShard)).toThrowError(/shard/);
    const corruptHead = structuredClone(snapshot);
    corruptHead.head!.topologyHash = "0".repeat(64);
    expect(() => assertRevisionStorageIntegrityV4(corruptHead)).toThrowError(/head/);
  });

  it("allocates family revisions monotonically without reuse and rejects immutable identity drift", async () => {
    const substrate = createMemoryStorageSubstrate();
    const repo = new WorkRevisionStorageRepositoryV4(substrate);
    const input = {
      logicalId: "family-a",
      originPhysicalId: "family-a-rev-1",
      originalCreatedBy: { role: "architect", agentId: "architect-1" },
      familyScope: { kind: "mission" as const, id: "mission-140" },
      createdAt: NOW,
    };
    const first = await repo.allocateNextRevision(input);
    expect(first.revision).toBe(1);
    const allocated = await Promise.all(Array.from({ length: 12 }, () => repo.allocateNextRevision(input)));
    expect(allocated.map((entry) => entry.revision).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 2),
    );
    await expect(repo.allocateNextRevision({ ...input, originPhysicalId: "spoofed" }))
      .rejects.toMatchObject({ code: "storage.family_identity_conflict" });
  });

  it("persists immutable prepared rows, supports exact operation/notice lookup, and publishes head once under CAS", async () => {
    const substrate = createMemoryStorageSubstrate();
    const repo = new WorkRevisionStorageRepositoryV4(substrate);
    const notice = {
      intentId: "notice-1", operationId: "op-bootstrap-1", generation: 1,
      logicalId: "a", physicalId: "a", exactHolderAgentId: "agent-1",
      payloadHash: hashCanonicalDomain("notice-payload-v4", { a: 1 }), createdAt: NOW,
    };
    const built = buildWorkRevisionStorageV4(input([work("a")], { notices: [notice] }));
    await repo.persistPrepared(built);
    await repo.persistPrepared(built); // exact retry is read-only/idempotent
    await expect(repo.activateGeneration(1, "op-bootstrap-1", NOW))
      .rejects.toMatchObject({ code: "storage.integrity" });
    expect(await repo.getHead()).toBeNull();
    await repo.persistProjectedWorkItems(built);
    expect(await repo.getOperation("op-bootstrap-1")).toMatchObject({ state: "prepared", generation: 1 });
    expect(await repo.getNotice("notice-1")).toMatchObject({ projected: false, exactHolderAgentId: "agent-1" });
    expect(await repo.listPendingNotices()).toHaveLength(1);

    const head = await repo.activateGeneration(1, "op-bootstrap-1", NOW);
    expect(head.generation).toBe(1);
    expect((await repo.getOperation("op-bootstrap-1"))!.state).toBe("committed");
    // Simulate process death after the authoritative head CAS but before its
    // non-authoritative operation projection; retry repairs the exact window.
    await substrate.put("WorkGraphRevisionOperation", { ...built.operation, state: "prepared" });
    expect((await repo.activateGeneration(1, "op-bootstrap-1", NOW)).generation).toBe(1);
    expect((await repo.getOperation("op-bootstrap-1"))!.state).toBe("committed");
    await expect(repo.activateGeneration(0, "op-bootstrap-1", NOW)).rejects.toThrow();
    const projected = await repo.markNoticeProjected("notice-1", "message-1", NOW);
    expect(projected.projected).toBe(true);
    await repo.persistPrepared(built); // post-commit/projection retry preserves mutable projections
    expect((await repo.getNotice("notice-1"))!.projected).toBe(true);
    expect(await repo.listPendingNotices()).toHaveLength(0);
    const committedOperation = (await repo.getOperation("op-bootstrap-1"))!;
    expect(() => assertRevisionStorageIntegrityV4({
      head, generation: built.generation, shards: built.shards, edges: built.edges,
      families: built.families, operation: committedOperation, notices: [projected],
    })).not.toThrow();
  });

  it("rejects immutable same-id replay with changed bytes", async () => {
    const substrate = createMemoryStorageSubstrate();
    const repo = new WorkRevisionStorageRepositoryV4(substrate);
    const built = buildWorkRevisionStorageV4(input([work("a")]));
    await repo.persistPrepared(built);
    const changed = structuredClone(built);
    changed.families[0]!.familyScope.id = "other-mission";
    await expect(repo.persistPrepared(changed)).rejects.toBeInstanceOf(WorkRevisionStorageError);
  });
});
