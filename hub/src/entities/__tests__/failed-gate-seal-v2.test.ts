import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { MessageRepositorySubstrate } from "../message-repository-substrate.js";
import { SubstrateCounter } from "../substrate-counter.js";
import type { EvidenceRequirement, WorkItem } from "../work-item.js";
import {
  FailedGateSealedRejected,
  WorkItemRepositorySubstrate,
  failedGateStateHash,
} from "../work-item-repository-substrate.js";
import { projectPendingFailedSealNotices, type FailedGateProjectorTraceEntry } from "../../policy/failed-gate-notice-projector.js";
import { WorkRevisionStorageRepositoryV4, buildWorkRevisionStorageV4 } from "../work-revision-storage-v4.js";
import type { IPolicyContext } from "../../policy/types.js";

const EXEC: EvidenceRequirement = { id: "exec", kind: "freeform" };
const SEAL: EvidenceRequirement = { id: "seal", kind: "freeform", evidenceAuthority: "verifier-attestation" };
const NO_FRICTION = { observed: false, summary: "no friction observed" } as const;
const HOLDER = "agent-holder";
const VERIFIER = "agent-verifier";
const EVIDENCE_REFS = [{ kind: "evidence" as const, ref: "commit:abc1234" }];

async function fixture() {
  const substrate = createMemoryStorageSubstrate();
  const repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
  await substrate.put("Agent", { id: VERIFIER, role: "verifier" });
  await substrate.put("Agent", { id: HOLDER, role: "engineer" });
  const created = await repo.createWorkItem({
    type: "verifier-gate",
    roleEligibility: ["engineer"],
    evidenceRequirements: [EXEC, SEAL],
    targetRef: { kind: "mission", id: "mission-failed-seal" },
  });
  const claimed = await repo.claimWorkItem(created.id, HOLDER, "engineer");
  const token = claimed!.lease!.token;
  await repo.startWork(created.id, HOLDER, token);
  await repo.completeWork(created.id, HOLDER, token, [{
    requirementId: "exec",
    kind: "freeform",
    ref: "commit:abc1234",
    producedAt: new Date().toISOString(),
  }], NO_FRICTION);
  // Exercise exact blocker preservation even though review normally has none.
  const parked = await repo.getWorkItem(created.id);
  await substrate.put("WorkItem", {
    ...parked!,
    blockedOn: { blockerKind: "external", blockerIds: ["incident-319"], reason: "production FAIL" },
  });
  return { substrate, repo, workId: created.id, token };
}

function policyContext(message: MessageRepositorySubstrate): IPolicyContext {
  return {
    stores: { message } as unknown as IPolicyContext["stores"],
    emit: async () => undefined,
    dispatch: async () => undefined,
    sessionId: "failed-seal-projector-test",
    clientIp: "127.0.0.1",
    role: "system",
    internalEvents: [],
    metrics: { increment: () => undefined } as unknown as IPolicyContext["metrics"],
    clock: { now: () => new Date("2026-07-23T15:00:00.000Z") },
  } as IPolicyContext;
}

describe("failed-gate-seal-v2", () => {
  it("keeps a persist-first exact-holder notice projectable after the failed row becomes historical", async () => {
    const { substrate, repo, workId } = await fixture();
    await repo.attestEvidence(workId, "seal", VERIFIER, "fail", EVIDENCE_REFS);
    const failed = (await repo.getWorkItem(workId))!;
    const storage = new WorkRevisionStorageRepositoryV4(substrate);
    const first = buildWorkRevisionStorageV4({
      workItems: [failed],
      boundReferencesByPhysicalId: { [workId]: [] },
      familyScopesByPhysicalId: { [workId]: { kind: "mission", id: "mission-failed-seal" } },
      generation: 1, previousGeneration: 0, operationId: "failed-history-1", createdAt: "2026-07-23T15:00:00.000Z",
    });
    await storage.persistPrepared(first);
    await storage.migrateLegacyProjectedWorkItems(first);
    await storage.activateGeneration(1, "failed-history-1", "2026-07-23T15:00:00.000Z");

    const existingFamily = (await storage.getFamily(workId))!;
    const allocation = await storage.allocateNextRevision({
      logicalId: workId,
      originPhysicalId: existingFamily.originPhysicalId,
      originalCreatedBy: existingFamily.originalCreatedBy,
      familyScope: existingFamily.familyScope,
      createdAt: existingFamily.createdAt,
    });
    const successor = JSON.parse(JSON.stringify(failed)) as WorkItem;
    for (const field of ["nodeContractHashVersion", "nodeContractHash", "nodeTopologyHashVersion", "nodeTopologyHash", "boundReferences", "localExecutionIdentity", "topologyGeneration"] as const) {
      delete successor[field];
    }
    Object.assign(successor, {
      id: `${workId}-repair-r2`, logicalId: workId, revision: 2, predecessorPhysicalId: workId,
      runbook: "distinct repair revision", status: "ready", lease: null, evidence: [], blockedOn: null,
      effectiveDisposition: null, failedGatePreClearReceipt: null, failedGateSeal: null,
      failedSealNoticePending: false, pendingFailedSealNotices: [], attestations: {}, attestationHistory: [],
      updatedAt: "2026-07-23T15:01:00.000Z",
    });
    const second = buildWorkRevisionStorageV4({
      workItems: [successor],
      boundReferencesByPhysicalId: { [successor.id]: [] },
      familyScopesByPhysicalId: { [successor.id]: { kind: "mission", id: "mission-failed-seal" } },
      existingFamiliesByLogicalId: { [workId]: allocation.family },
      generation: 2, previousGeneration: 1, operationId: "failed-history-2", createdAt: "2026-07-23T15:01:00.000Z",
    });
    await storage.persistPrepared(second);
    await storage.persistProjectedWorkItems(second);
    await storage.activateGeneration(2, "failed-history-2", "2026-07-23T15:01:00.000Z");

    const pending = await repo.listPendingFailedSealNoticeItems();
    expect(pending.items.map((item) => item.id)).toContain(workId);
    const intentId = failed.failedGateSeal!.holderNoticeIntentId;
    expect(intentId).not.toBeNull();
    await repo.markFailedSealNoticeProjected(workId, intentId!, "message-historical-fail");
    const historical = (await repo.getWorkItem(workId))!;
    expect(historical.failedSealNoticePending).toBe(false);
    expect(historical.pendingFailedSealNotices?.[0]?.projectedMessageId).toBe("message-historical-fail");
  });

  it("commits FAIL authority, exact pre-clear snapshot, cleanup, and holder intent in one successful CAS", async () => {
    const { substrate, repo, workId, token } = await fixture();
    const before = (await repo.getWorkItem(workId))!;
    const binding = await substrate.getWithRevision<WorkItem>("WorkItem", workId);
    let workItemCasCount = 0;
    const original = substrate.putIfMatch.bind(substrate);
    substrate.putIfMatch = async (kind, entity, revision) => {
      if (kind === "WorkItem") workItemCasCount++;
      return original(kind, entity, revision);
    };

    const failed = await repo.attestEvidence(workId, "seal", VERIFIER, "fail", EVIDENCE_REFS);
    expect(workItemCasCount).toBe(1);
    expect(failed.item.status).toBe("review");
    expect(failed.item.effectiveDisposition).toBe("failed_sealed");
    expect(failed.item.lease).toBeNull();
    expect(failed.item.blockedOn).toBeNull();
    expect(failed.item.attestationHistory).toHaveLength(1);
    expect(failed.item.attestations.seal.verdict).toBe("fail");

    const seal = failed.item.failedGateSeal!;
    expect(seal.version).toBe(2);
    expect(seal.receipt).toMatchObject({
      workId,
      logicalId: workId,
      revision: 1,
      topologyGeneration: 0,
      requirementId: "seal",
      verifierId: VERIFIER,
      verdict: "fail",
      before: {
        phase: "review",
        holder: HOLDER,
        claimedAt: before.lease!.claimedAt,
        expiresAt: before.lease!.expiresAt,
        heartbeatAt: before.lease!.heartbeatAt,
        blockedOn: before.blockedOn,
        stateHash: failedGateStateHash(before),
        resourceVersion: binding!.resourceVersion,
      },
      after: {
        phase: "review",
        effectiveDisposition: "failed_sealed",
        leaseCleared: true,
        blockedOnCleared: true,
      },
      attestationHistoryIndex: 0,
    });
    expect(seal.receipt.before.tokenFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(seal.receipt.before.tokenFingerprint).not.toBe(token);
    expect(JSON.stringify(seal)).not.toContain(token);
    expect(failed.item.pendingFailedSealNotices).toHaveLength(1);
    expect(failed.item.failedSealNoticePending).toBe(true);
    expect(failed.item.pendingFailedSealNotices![0]).toMatchObject({
      intentId: seal.holderNoticeIntentId,
      exactHolderAgentId: HOLDER,
      sealHash: seal.sealHash,
      projectedMessageId: null,
    });
  });

  it("same operation is a read-only idempotent replay; later same-row attestation is rejected", async () => {
    const { substrate, repo, workId } = await fixture();
    await repo.attestEvidence(workId, "seal", VERIFIER, "fail", EVIDENCE_REFS);
    const afterFirst = await substrate.getWithRevision<WorkItem>("WorkItem", workId);
    const replay = await repo.attestEvidence(workId, "seal", VERIFIER, "fail", EVIDENCE_REFS);
    const afterReplay = await substrate.getWithRevision<WorkItem>("WorkItem", workId);
    expect(afterReplay!.resourceVersion).toBe(afterFirst!.resourceVersion);
    expect(replay.item.attestationHistory).toHaveLength(1);
    await expect(repo.attestEvidence(workId, "seal", VERIFIER, "pass", EVIDENCE_REFS))
      .rejects.toBeInstanceOf(FailedGateSealedRejected);
    const fresh = await repo.getWorkItem(workId);
    expect(fresh!.attestationHistory).toHaveLength(1);
    expect(fresh!.attestations.seal.verdict).toBe("fail");
  });

  it("restart after seal CAS replays no authority effect", async () => {
    const { substrate, repo, workId } = await fixture();
    const original = substrate.putIfMatch.bind(substrate);
    let crashAfterSuccessfulCas = true;
    substrate.putIfMatch = async (kind, entity, revision) => {
      const result = await original(kind, entity, revision);
      if (kind === "WorkItem" && result.ok && crashAfterSuccessfulCas) {
        crashAfterSuccessfulCas = false;
        throw new Error("FAILPOINT:after_seal_cas_before_return");
      }
      return result;
    };
    await expect(repo.attestEvidence(workId, "seal", VERIFIER, "fail", EVIDENCE_REFS))
      .rejects.toThrow("FAILPOINT:after_seal_cas_before_return");
    const committed = await repo.getWorkItem(workId);
    expect(committed!.effectiveDisposition).toBe("failed_sealed");
    expect(committed!.attestationHistory).toHaveLength(1);
    const retried = await repo.attestEvidence(workId, "seal", VERIFIER, "fail", EVIDENCE_REFS);
    expect(retried.item.failedGateSeal!.sealHash).toBe(committed!.failedGateSeal!.sealHash);
    expect(retried.item.attestationHistory).toHaveLength(1);
  });

  it("restart after Message persistence produces exactly one exact-holder Message and an exact failpoint trace", async () => {
    const { substrate, repo, workId, token } = await fixture();
    await repo.attestEvidence(workId, "seal", VERIFIER, "fail", EVIDENCE_REFS);
    const messages = new MessageRepositorySubstrate(substrate);
    const ctx = policyContext(messages);
    const firstTrace: FailedGateProjectorTraceEntry[] = [];
    await expect(projectPendingFailedSealNotices(ctx, repo, {
      workId,
      failpoint: (entry) => {
        firstTrace.push(entry);
        if (entry.stage === "after_message_persist") throw new Error("FAILPOINT:after_message_persist");
      },
    })).rejects.toThrow("FAILPOINT:after_message_persist");
    expect(firstTrace.map((entry) => entry.stage)).toEqual([
      "after_intent_read", "before_message_persist", "after_message_persist",
    ]);
    expect((await repo.getWorkItem(workId))!.pendingFailedSealNotices![0].projectedMessageId).toBeNull();
    expect((await repo.listPendingFailedSealNoticeItems()).items.map((item) => item.id)).toEqual([workId]);

    const restartTrace: FailedGateProjectorTraceEntry[] = [];
    const restarted = await projectPendingFailedSealNotices(ctx, repo, {
      workId,
      failpoint: (entry) => { restartTrace.push(entry); },
    });
    expect(restarted).toMatchObject({ candidates: 1, projected: 0, alreadyProjected: 1 });
    expect(restartTrace.map((entry) => entry.stage)).toEqual([
      "after_intent_read", "after_message_persist", "before_intent_mark", "after_intent_mark",
    ]);
    expect((await repo.getWorkItem(workId))!.failedSealNoticePending).toBe(false);
    expect((await repo.listPendingFailedSealNoticeItems()).items).toHaveLength(0);
    const holderMessages = await messages.listMessages({ targetAgentId: HOLDER });
    expect(holderMessages).toHaveLength(1);
    expect(holderMessages[0].target).toEqual({ agentId: HOLDER });
    expect(holderMessages[0].migrationSourceId).toBe((await repo.getWorkItem(workId))!.failedGateSeal!.holderNoticeIntentId);
    expect(JSON.stringify(holderMessages[0].payload)).not.toContain(token);
    expect((holderMessages[0].payload as Record<string, unknown>).recovery).toBe("distinct-repair-only");

    const third = await projectPendingFailedSealNotices(ctx, repo, { workId });
    expect(third.candidates).toBe(0);
    expect(await messages.listMessages({ targetAgentId: HOLDER })).toHaveLength(1);
  });

  it("derives legacy active FAIL before sweep, never requeues, and backfills the immutable seal", async () => {
    const { substrate, repo, workId } = await fixture();
    const born = await repo.attestEvidence(workId, "seal", VERIFIER, "fail", EVIDENCE_REFS);
    const receipt = born.item.failedGateSeal!.receipt;
    const { failedGateSeal: _seal, pendingFailedSealNotices: _pending, effectiveDisposition: _effective, ...legacy } = born.item;
    await substrate.put("WorkItem", {
      ...legacy,
      status: "review",
      lease: {
        holder: HOLDER,
        token: "legacy-obsolete-token",
        claimedAt: receipt.before.claimedAt!,
        heartbeatAt: receipt.before.heartbeatAt!,
        expiresAt: "2026-01-01T00:00:00.000Z",
      },
      blockedOn: receipt.before.blockedOn,
    });

    const derived = await repo.getWorkItem(workId);
    expect(derived!.failedGateSeal).toBeNull();
    expect(derived!.effectiveDisposition).toBe("failed_sealed");
    const outcome = await repo.expireLease(workId, "2026-07-23T15:00:00.000Z", 3);
    expect(outcome).toBe("failed_sealed");
    const reconciled = await repo.getWorkItem(workId);
    expect(reconciled!.status).toBe("review");
    expect(reconciled!.effectiveDisposition).toBe("failed_sealed");
    expect(reconciled!.failedGateSeal?.version).toBe(2);
    expect(reconciled!.lease).toBeNull();
    expect(reconciled!.blockedOn).toBeNull();
    expect(reconciled!.attestationHistory).toHaveLength(1);
    expect(reconciled!.pendingFailedSealNotices).toHaveLength(1);
  });

  it("a raw-ready legacy FAIL is not listable or claimable", async () => {
    const { substrate, repo, workId } = await fixture();
    const born = await repo.attestEvidence(workId, "seal", VERIFIER, "fail", EVIDENCE_REFS);
    const { failedGateSeal: _seal, pendingFailedSealNotices: _pending, effectiveDisposition: _effective, ...legacy } = born.item;
    await substrate.put("WorkItem", { ...legacy, status: "ready", lease: null, blockedOn: null });
    const ready = await repo.listReadyForRole("engineer", 100);
    expect(ready.items.map((item) => item.id)).not.toContain(workId);
    await expect(repo.claimWorkItem(workId, "other-engineer", "engineer"))
      .rejects.toBeInstanceOf(FailedGateSealedRejected);
  });
});
