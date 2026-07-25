import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { MessageRepositorySubstrate } from "../message-repository-substrate.js";
import { SubstrateCounter } from "../substrate-counter.js";
import { WorkItemRepositorySubstrate, TransitionRejected, recallStateHash, isPauseOperationReplay } from "../work-item-repository-substrate.js";
import { projectPendingRecallNotices, type RecallProjectorTraceEntry } from "../../policy/recall-notice-projector.js";
import type { IPolicyContext } from "../../policy/types.js";

const ARCH = { agentId: "architect-a", role: "architect" };
const DIRECTOR = { agentId: "director-a", role: "director" };
const HOLDER = "engineer-holder";
const ENGINEER_CREATOR = { agentId: "engineer-creator", role: "engineer" };

async function fixture(createdBy = { role: "architect", agentId: ARCH.agentId }) {
  const substrate = createMemoryStorageSubstrate();
  const repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
  const item = await repo.createWorkItem({
    type: "task", roleEligibility: ["engineer"], evidenceRequirements: [], createdBy,
  });
  return { substrate, repo, item };
}

function ctx(messages: MessageRepositorySubstrate): IPolicyContext {
  return {
    stores: { message: messages } as unknown as IPolicyContext["stores"],
    emit: async () => undefined,
    dispatch: async () => undefined,
    sessionId: "pause-recall-v4", clientIp: "127.0.0.1", role: "system", internalEvents: [],
    metrics: { increment: () => undefined } as unknown as IPolicyContext["metrics"],
    clock: { now: () => new Date("2026-07-24T00:00:00.000Z") },
  } as IPolicyContext;
}

async function driveBlocked(repo: WorkItemRepositorySubstrate, id: string) {
  const claimed = await repo.claimWorkItem(id, HOLDER, "engineer");
  const token = claimed!.lease!.token;
  await repo.startWork(id, HOLDER, token);
  await repo.blockWork(id, HOLDER, token, { blockerKind: "external", blockerIds: ["incident-1"], reason: "waiting" });
  return token;
}

const request = (workId: string, operationId = "pause-op-1", reason = "revise claimant contract") =>
  ({ workId, operationId, reason });

describe("pause/recall-v4 authority and exact state", () => {
  it("atomically captures the full blocked before-state, clears live authority, and never persists the bearer token", async () => {
    const { repo, item } = await fixture();
    const token = await driveBlocked(repo, item.id);
    const exactBefore = (await repo.getWorkItem(item.id))!;
    const paused = (await repo.pauseWork(request(item.id), ARCH))!;

    expect(paused.status).toBe("paused");
    expect(paused.lease).toBeNull();
    expect(paused.blockedOn).toBeNull();
    expect(paused.recallHistory).toHaveLength(1);
    const recall = paused.recallHistory![0];
    expect(recall.before).toMatchObject({
      physicalId: item.id, logicalId: item.id, revision: 1, topologyGeneration: null,
      phase: "blocked", blockedOn: { blockerKind: "external", blockerIds: ["incident-1"], reason: "waiting" },
      lease: { holder: HOLDER, claimedAt: exactBefore.lease!.claimedAt, expiresAt: exactBefore.lease!.expiresAt, heartbeatAt: exactBefore.lease!.heartbeatAt },
    });
    expect(recall.before.stateHash).toBe(recallStateHash(exactBefore));
    expect(recall.beforeStateHash).toBe(recall.before.stateHash);
    expect(recall.before.lease!.tokenFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(paused)).not.toContain(token);
    expect(paused.pendingRecallIntents).toHaveLength(1);
    expect(paused.pendingRecallIntents![0]).toMatchObject({ exactHolderAgentId: HOLDER, operationId: "pause-op-1", projectedMessageId: null });
    expect(paused.recallNoticePending).toBe(true);
  });

  it("allows ready original creator/architect/Director, but active recall only architect/Director", async () => {
    const readyCreator = await fixture({ role: "engineer", agentId: ENGINEER_CREATOR.agentId });
    expect((await readyCreator.repo.pauseWork(request(readyCreator.item.id, "ready-creator"), ENGINEER_CREATOR))!.status).toBe("paused");

    for (const [actor, operationId] of [[ARCH, "active-arch"], [DIRECTOR, "active-director"]] as const) {
      const f = await fixture(); await driveBlocked(f.repo, f.item.id);
      expect((await f.repo.pauseWork(request(f.item.id, operationId), actor))!.status).toBe("paused");
    }

    const denied = await fixture({ role: "engineer", agentId: ENGINEER_CREATOR.agentId });
    await driveBlocked(denied.repo, denied.item.id);
    await expect(denied.repo.pauseWork(request(denied.item.id, "active-creator"), ENGINEER_CREATOR)).rejects.toThrow("architect or Director for active recall");
    await expect(denied.repo.pauseWork(request(denied.item.id, "active-holder"), { agentId: HOLDER, role: "engineer" })).rejects.toThrow(TransitionRejected);
  });

  it("rejects review/terminal states and failed seals before raw-phase authority", async () => {
    for (const status of ["review", "done", "abandoned"] as const) {
      const { substrate, repo, item } = await fixture();
      await substrate.put("WorkItem", { ...(await repo.getWorkItem(item.id))!, status });
      await expect(repo.pauseWork(request(item.id, `forbid-${status}`), ARCH)).rejects.toThrow(TransitionRejected);
    }
    const { substrate, repo, item } = await fixture();
    await substrate.put("WorkItem", { ...(await repo.getWorkItem(item.id))!, effectiveDisposition: "failed_sealed" });
    await expect(repo.pauseWork(request(item.id, "forbid-fail"), DIRECTOR)).rejects.toThrow(/failed_sealed|failed-gate sealed/);
  });

  it("makes same-operation replay read-only even after unpause and rejects changed duplicate bytes", async () => {
    const { repo, item } = await fixture();
    const first = (await repo.pauseWork(request(item.id), ARCH))!;
    const replay = (await repo.pauseWork(request(item.id), ARCH))!;
    expect(isPauseOperationReplay(first)).toBe(false);
    expect(isPauseOperationReplay(replay)).toBe(true);
    expect(JSON.stringify(replay)).not.toContain("pause-operation-replay");
    expect(replay.recallHistory).toEqual(first.recallHistory);
    await expect(repo.pauseWork(request(item.id, "pause-op-1", "changed"), ARCH)).rejects.toThrow("different bytes");
    await repo.unpauseWork({ workId: item.id }, ARCH);
    const lateReplay = (await repo.pauseWork(request(item.id), ARCH))!;
    expect(lateReplay.status).toBe("ready");
    expect(lateReplay.recallHistory).toHaveLength(1);
  });

  it("invalidates every old-token holder verb immediately after active pause", async () => {
    const { repo, item } = await fixture(); const token = await driveBlocked(repo, item.id);
    await repo.pauseWork(request(item.id), ARCH);
    const calls = [
      () => repo.startWork(item.id, HOLDER, token),
      () => repo.blockWork(item.id, HOLDER, token, { blockerKind: "x", reason: "x" }),
      () => repo.resumeWork(item.id, HOLDER, token),
      () => repo.renewLease(item.id, HOLDER, token),
      () => repo.releaseWork(item.id, HOLDER, token),
      () => repo.completeWork(item.id, HOLDER, token, [], { observed: false, summary: "none" }),
      () => repo.abandonWork(item.id, HOLDER, { leaseToken: token }),
    ];
    for (const call of calls) await expect(call()).rejects.toThrow(/no active lease|lease holder mismatch|lease-holder \(none\)|abandon requires the lease-holder/);
    expect((await repo.getWorkItem(item.id))!.status).toBe("paused");
  });

  it("linearizes pause against every holder verb and the expiry sweeper without zombie authority", async () => {
    const cases = ["start", "renew", "block", "resume", "release", "complete", "abandon", "sweep"] as const;
    const trace: Array<Record<string, unknown>> = [];
    for (const verb of cases) {
      const { substrate, repo, item } = await fixture();
      const claimed = await repo.claimWorkItem(item.id, HOLDER, "engineer");
      const token = claimed!.lease!.token;
      if (["block", "complete"].includes(verb)) await repo.startWork(item.id, HOLDER, token);
      if (verb === "resume") {
        await repo.startWork(item.id, HOLDER, token);
        await repo.blockWork(item.id, HOLDER, token, { blockerKind: "race", reason: "race" });
      }
      if (verb === "sweep") {
        await substrate.put("WorkItem", { ...(await repo.getWorkItem(item.id))!, lease: { ...(await repo.getWorkItem(item.id))!.lease!, expiresAt: "2020-01-01T00:00:00.000Z" } });
      }
      const holderVerb = () => {
        switch (verb) {
          case "start": return repo.startWork(item.id, HOLDER, token);
          case "renew": return repo.renewLease(item.id, HOLDER, token);
          case "block": return repo.blockWork(item.id, HOLDER, token, { blockerKind: "race", reason: "race" });
          case "resume": return repo.resumeWork(item.id, HOLDER, token);
          case "release": return repo.releaseWork(item.id, HOLDER, token);
          case "complete": return repo.completeWork(item.id, HOLDER, token, [], { observed: false, summary: "none" });
          case "abandon": return repo.abandonWork(item.id, HOLDER, { leaseToken: token });
          case "sweep": return repo.expireLease(item.id, "2030-01-01T00:00:00.000Z", 3);
        }
      };
      const [pauseResult, holderResult] = await Promise.allSettled([
        repo.pauseWork(request(item.id, `race-${verb}`), ARCH),
        holderVerb(),
      ]);
      const final = (await repo.getWorkItem(item.id))!;
      trace.push({ verb, pause: pauseResult.status, holder: holderResult.status, final: final.status, recalledFrom: final.recallHistory?.[0]?.before.phase ?? null });
      if (["complete", "abandon"].includes(verb)) {
        expect([pauseResult.status, holderResult.status].filter((status) => status === "fulfilled")).toHaveLength(1);
        expect(["paused", "done", "abandoned"]).toContain(final.status);
      } else {
        expect(pauseResult.status).toBe("fulfilled");
        expect(final.status).toBe("paused");
        expect(final.recallHistory).toHaveLength(1);
      }
      expect(final.lease).toBeNull();
      await expect(repo.renewLease(item.id, HOLDER, token)).rejects.toThrow();
    }
    expect(trace.map((entry) => entry.verb)).toEqual(cases);
  });

  it("validates expected revision/generation and exact locator cardinality", async () => {
    const { repo, item } = await fixture();
    await expect(repo.pauseWork({ ...request(item.id), expectedRevision: 2 }, ARCH)).rejects.toThrow("expected revision 2");
    await expect(repo.pauseWork({ ...request(item.id), expectedGeneration: 1 }, ARCH)).rejects.toThrow("expected generation 1");
    await expect(repo.pauseWork({ workId: item.id, logicalId: item.id, operationId: "both", reason: "bad" }, ARCH)).rejects.toThrow("exactly one");
  });
});

describe("pause/recall-v4 exact-holder outbox", () => {
  it("is persist-first, exact-agent-only, restart-idempotent across the after-message crash gap", async () => {
    const { substrate, repo, item } = await fixture(); const token = await driveBlocked(repo, item.id);
    await repo.pauseWork(request(item.id), ARCH);
    const messages = new MessageRepositorySubstrate(substrate);
    const firstTrace: RecallProjectorTraceEntry[] = [];
    const first = await projectPendingRecallNotices(ctx(messages), repo, {
      workId: item.id,
      failpoint: (entry) => { firstTrace.push(entry); if (entry.step === "after_message_persist") throw new Error("crash-after-message"); },
    });
    expect(first.errors).toHaveLength(1);
    expect(firstTrace.map((entry) => entry.step)).toEqual(["after_intent_read", "before_message_persist", "after_message_persist"]);
    expect((await repo.listPendingRecallNoticeItems()).items.map((entry) => entry.id)).toEqual([item.id]);

    const restartedRepo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
    const restartTrace: RecallProjectorTraceEntry[] = [];
    const second = await projectPendingRecallNotices(ctx(new MessageRepositorySubstrate(substrate)), restartedRepo, {
      workId: item.id, failpoint: (entry) => { restartTrace.push(entry); },
    });
    expect(second.errors).toEqual([]);
    expect(restartTrace.map((entry) => entry.step)).toEqual(["after_intent_read", "after_message_persist", "before_intent_mark", "after_intent_mark"]);
    const holderMessages = await messages.listMessages({ targetAgentId: HOLDER });
    expect(holderMessages).toHaveLength(1);
    expect(holderMessages[0].target).toEqual({ agentId: HOLDER });
    expect(JSON.stringify(holderMessages[0].payload)).not.toContain(token);
    expect((holderMessages[0].payload as Record<string, unknown>).obsoleteToken).toBe(true);
    expect(await messages.listMessages({ targetRole: "engineer" })).toEqual([]);
    expect((await restartedRepo.getWorkItem(item.id))!.recallNoticePending).toBe(false);
    expect((await projectPendingRecallNotices(ctx(messages), restartedRepo, { workId: item.id })).candidates).toBe(0);
  });
});

describe("scalar unpause authority", () => {
  it("allows same creator only for the unchanged row they paused; successor/reviser/holder laundering fails", async () => {
    const f = await fixture({ role: "engineer", agentId: ENGINEER_CREATOR.agentId });
    await f.repo.pauseWork(request(f.item.id), ENGINEER_CREATOR);
    expect((await f.repo.unpauseWork({ workId: f.item.id, expectedRevision: 1, expectedGeneration: 0 }, ENGINEER_CREATOR))!.status).toBe("ready");

    const successor = await fixture({ role: "engineer", agentId: ENGINEER_CREATOR.agentId });
    await successor.repo.pauseWork(request(successor.item.id, "successor-pause"), ENGINEER_CREATOR);
    await successor.substrate.put("WorkItem", { ...(await successor.repo.getWorkItem(successor.item.id))!, predecessorPhysicalId: "prior-row", revisedBy: { role: "engineer", agentId: ENGINEER_CREATOR.agentId } });
    await expect(successor.repo.unpauseWork({ workId: successor.item.id }, ENGINEER_CREATOR)).rejects.toThrow("holder/reviser status grants no authority");
    expect((await successor.repo.unpauseWork({ workId: successor.item.id }, ARCH))!.status).toBe("ready");
  });
});
