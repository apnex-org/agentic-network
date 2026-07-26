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
    // idea-640: THE PAIR IS THE TRUTH. The phase does not move; the attribute is what changes.
    // Asserting only `suspended` would pass even if the phase HAD moved, so both are pinned.
    expect(w!.status, "the lifecycle phase stays put").toBe("ready");
    expect(w!.suspended, "the management attribute carries the suspension").toBe(true);
    expect(w!.lease, "a ready row had no lease to retain").toBeNull();
    expect(w!.recallHistory).toHaveLength(1);
    expect(w!.recallHistory![0].before.phase).toBe("ready");
    // 🔴 work-540: WAS `toEqual([])`. A row suspended from `ready` has NO HOLDER, so the holder
    // channel notified nobody and this asserted that silence. The AUTHOR is now notified — which is
    // precisely the case the Director asked for and the one the holder channel structurally cannot
    // cover. The test name still says "without a lease notice" and that remains true: there is no
    // HOLDER notice, because there is no holder.
    expect(w!.pendingRecallIntents).toHaveLength(1);
    expect(w!.pendingRecallIntents![0]).toMatchObject({ recipientKind: "author", exactHolderAgentId: "arch-1" });
    expect(w!.recallNoticePending, "an unprojected author notice must flag as pending").toBe(true);
  });

  it("Director may pause ready work; unrelated engineer may not", async () => {
    const { repo } = await setup();
    expect((await pause(repo, await readyItem(repo), DIRECTOR))!.suspended).toBe(true);
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
      expect(w!.suspended, "suspended is the attribute that changes").toBe(true);
      expect(w!.status, "…and the phase is PRESERVED, which is the whole model").toBe(
        (await repo.getWorkItem(id))!.status);
      // idea-640 (A): was `expect(w!.lease).toBeNull()`. Pause RETAINS lease + holder + token so the
      // ratified middle tier (paused WITH the lease = minor edits) can exist at all; `reset` is what
      // revokes it. The row is still inert — every holder verb gates on STATUS, and `paused` is in no
      // phase set — so "clears live state" is now true of AUTHORITY-TO-ACT, not of the lease field.
      expect(w!.lease, "pause retains the lease").not.toBeNull();
      expect(w!.lease!.holder).toBe("agent-eng");
      expect(w!.blockedOn).toBeNull();
      // work-540: holder (agent-eng) AND author (arch-1) are different agents here, so BOTH are
      // notified — one notice each, never two for one recipient.
      expect(w!.pendingRecallIntents).toHaveLength(2);
      expect(new Set(w!.pendingRecallIntents!.map((i) => i.exactHolderAgentId))).toEqual(new Set(["agent-eng", "arch-1"]));
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
    // 🔴 REAL DEFECT, not a stale assertion: statusCounts bucketed on the PHASE, so `paused` went
    // permanently 0 AND a suspended in_progress child stayed inside `inFlight` — the projection
    // reporting a withdrawn row as EXECUTING to the architect who withdrew it. Now bucketed on the
    // pair, by the same rule as duration accrual.
    expect(projection!.statusCounts.paused, "the suspension bucket must still count it").toBe(1);
    const entry = projection!.children.find((e) => e.id === child)!;
    expect(entry.suspended, "the child carries the attribute").toBe(true);
    expect(entry.status, "…and reports its true phase alongside it").toBe("ready");
    expect(projection!.inFlight, "a suspended child is NOT in flight").toBe(0);
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
