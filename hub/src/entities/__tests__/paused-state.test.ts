/** Mission-140 pause/recall state integration: dormancy projections and scalar recommit. */
import { describe, it, expect } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { WorkItemRepositorySubstrate, TransitionRejected } from "../work-item-repository-substrate.js";
import { SubstrateCounter } from "../substrate-counter.js";

const CREATOR = { agentId: "arch-1", role: "architect" };
const DIRECTOR = { agentId: "director-1", role: "director" };
const STRANGER = { agentId: "rando", role: "engineer" };
let serial = 0;

async function setup() {
  const substrate = createMemoryStorageSubstrate();
  const repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
  return { substrate, repo };
}
async function readyItem(repo: WorkItemRepositorySubstrate, dependsOn: string[] = []) {
  const w = await repo.createWorkItem({ type: "task", roleEligibility: [], dependsOn, evidenceRequirements: [], createdBy: { role: "architect", agentId: "arch-1" } });
  return w.id;
}
const pause = (repo: WorkItemRepositorySubstrate, workId: string, actor = CREATOR) =>
  repo.pauseWork({ workId, operationId: `pause-old-suite-${++serial}`, reason: "test pause" }, actor);
const unpause = (repo: WorkItemRepositorySubstrate, workId: string, actor = CREATOR) =>
  repo.unpauseWork({ workId }, actor);

describe("paused-state — FSM + authority", () => {
  it("ready → paused records recall without a lease notice", async () => {
    const { repo } = await setup();
    const id = await readyItem(repo);
    const w = await pause(repo, id);
    expect(w!.status).toBe("paused");
    expect(w!.lease).toBeNull();
    expect(w!.recallHistory).toHaveLength(1);
    expect(w!.recallHistory![0].before.phase).toBe("ready");
    expect(w!.pendingRecallIntents).toEqual([]);
  });

  it("Director may pause ready work; unrelated engineer may not", async () => {
    const { repo } = await setup();
    expect((await pause(repo, await readyItem(repo), DIRECTOR))!.status).toBe("paused");
    await expect(pause(repo, await readyItem(repo), STRANGER)).rejects.toThrow(TransitionRejected);
  });

  it("architect may force-pause claimed/in_progress/blocked and clears live state", async () => {
    const { repo } = await setup();
    for (const drive of [
      async (id: string) => repo.claimWorkItem(id, "agent-eng", "engineer"),
      async (id: string) => { const c = await repo.claimWorkItem(id, "agent-eng", "engineer"); return repo.startWork(id, "agent-eng", c!.lease!.token); },
      async (id: string) => { const c = await repo.claimWorkItem(id, "agent-eng", "engineer"); await repo.startWork(id, "agent-eng", c!.lease!.token); return repo.blockWork(id, "agent-eng", c!.lease!.token, { blockerKind: "x", reason: "y" }); },
    ]) {
      const id = await readyItem(repo);
      await drive(id);
      const w = await pause(repo, id);
      expect(w!.status).toBe("paused");
      expect(w!.lease).toBeNull();
      expect(w!.blockedOn).toBeNull();
      expect(w!.pendingRecallIntents).toHaveLength(1);
    }
  });

  it("scalar unpause allows same pausing creator/architect/Director, rejects holder-only identity", async () => {
    const { repo } = await setup();
    const id = await readyItem(repo);
    await pause(repo, id);
    await expect(unpause(repo, id, STRANGER)).rejects.toMatchObject({ code: "revision.actor_forbidden" });
    expect((await unpause(repo, id))!.status).toBe("ready");
    await expect(unpause(repo, id)).rejects.toThrow(TransitionRejected);
  });
});

describe("paused-state — digest, dwell, projection, and start-gate separation", () => {
  it("paused is excluded from ready digest", async () => {
    const { repo } = await setup(); const id = await readyItem(repo);
    expect((await repo.listReadyForRole("engineer", 50)).items.map((w) => w.id)).toContain(id);
    await pause(repo, id);
    expect((await repo.listReadyForRole("engineer", 50)).items.map((w) => w.id)).not.toContain(id);
  });

  it("paused dwell accrues on scalar recommit", async () => {
    const { repo } = await setup(); const id = await readyItem(repo);
    await pause(repo, id); await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await unpause(repo, id))!.stateDurations.paused).toBeGreaterThan(0);
  });

  it("stint projection surfaces a paused child", async () => {
    const { repo } = await setup(); const child = await readyItem(repo); await pause(repo, child);
    const arc = await repo.createWorkItem({ type: "task", roleEligibility: [], completionDependsOn: [child], evidenceRequirements: [], createdBy: { role: "architect", agentId: "arch-1" } });
    const projection = await repo.getStintProjection(arc.id);
    expect(projection!.statusCounts.paused).toBe(1);
    expect(projection!.children.find((entry) => entry.id === child)!.status).toBe("paused");
  });

  it("unpause does not bypass unmet start gates", async () => {
    const { repo } = await setup(); const dep = await readyItem(repo); const id = await readyItem(repo, [dep]);
    await pause(repo, id); await unpause(repo, id);
    expect((await repo.listReadyForRole("engineer", 50, "agent-eng")).items.map((w) => w.id)).not.toContain(id);
    await expect(repo.claimWorkItem(id, "agent-eng", "engineer")).rejects.toThrow();
  });

  it("legal moves expose pause@ready and unpause@paused", async () => {
    const { repo } = await setup(); const id = await readyItem(repo);
    expect((await repo.getLegalMoves(id, CREATOR))!.moves.find((m) => m.verb === "pause")!.legal).toBe(true);
    await pause(repo, id);
    expect((await repo.getLegalMoves(id, CREATOR))!.moves.find((m) => m.verb === "unpause")!.legal).toBe(true);
    expect((await repo.getLegalMoves(id, STRANGER))!.moves.find((m) => m.verb === "unpause")!.legal).toBe(false);
  });
});
