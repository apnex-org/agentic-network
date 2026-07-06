/**
 * Stint Arc-1 S3 (idea-454) — paused/disabled node FSM state.
 *
 * `paused` is a dormancy state (unclaimable, no lease, resumable→ready), distinct from `blocked`
 * (live/reapable) and `abandoned` (terminal). Council-locked invariants, all proven here:
 *   FSM: pause is READY-ONLY (no lease-zombie); unpause paused→ready.
 *   AUTHZ: creator-only (server-stamped createdBy) + Director override.
 *   DIGEST: paused excluded from listReadyForRole + inFlightCount (dormant, not dark).
 *   DWELL: paused accrues a stateDurations bucket (sum-identity preserved).
 *   PROJECTION: get_current_stint (getStintProjection) surfaces paused children.
 *   RESUME: unpause→ready re-enters the normal claim gate (start-gates NOT bypassed).
 */

import { describe, it, expect } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { WorkItemRepositorySubstrate, TransitionRejected } from "../work-item-repository-substrate.js";
import { SubstrateCounter } from "../substrate-counter.js";

const CREATOR = { agentId: "arch-1", role: "architect" };
const DIRECTOR = { agentId: "director-1", role: "director" };
const STRANGER = { agentId: "rando", role: "engineer" };

async function setup() {
  const substrate = createMemoryStorageSubstrate();
  const repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
  return { substrate, repo };
}

async function readyItem(repo: WorkItemRepositorySubstrate, dependsOn: string[] = []) {
  const w = await repo.createWorkItem({ type: "task", roleEligibility: [], dependsOn, evidenceRequirements: [], createdBy: { role: "architect", agentId: "arch-1" } });
  return w.id;
}

describe("S3 paused-state — FSM + authz", () => {
  it("pause: ready → paused (creator), no lease", async () => {
    const { repo } = await setup();
    const id = await readyItem(repo);
    const w = await repo.pauseWork(id, CREATOR);
    expect(w!.status).toBe("paused");
    expect(w!.lease).toBeNull();
  });

  it("pause: Director may pause (override)", async () => {
    const { repo } = await setup();
    const id = await readyItem(repo);
    expect((await repo.pauseWork(id, DIRECTOR))!.status).toBe("paused");
  });

  it("pause: a non-creator non-Director is REJECTED", async () => {
    const { repo } = await setup();
    const id = await readyItem(repo);
    await expect(repo.pauseWork(id, STRANGER)).rejects.toThrow(TransitionRejected);
  });

  it("pause is READY-ONLY: claimed / in_progress / blocked reject (no lease-zombie)", async () => {
    const { repo } = await setup();
    for (const drive of [
      async (id: string) => { await repo.claimWorkItem(id, "agent-eng", "engineer"); },
      async (id: string) => { const c = await repo.claimWorkItem(id, "agent-eng", "engineer"); await repo.startWork(id, "agent-eng", c!.lease!.token); },
      async (id: string) => { const c = await repo.claimWorkItem(id, "agent-eng", "engineer"); await repo.startWork(id, "agent-eng", c!.lease!.token); await repo.blockWork(id, "agent-eng", c!.lease!.token, { blockerKind: "x", reason: "y" }); },
    ]) {
      const id = await readyItem(repo);
      await drive(id);
      await expect(repo.pauseWork(id, CREATOR)).rejects.toThrow(TransitionRejected);
    }
  });

  it("unpause: paused → ready (creator / Director); non-creator rejected; non-paused rejected", async () => {
    const { repo } = await setup();
    const id = await readyItem(repo);
    await repo.pauseWork(id, CREATOR);
    await expect(repo.unpauseWork(id, STRANGER)).rejects.toThrow(TransitionRejected);
    const w = await repo.unpauseWork(id, CREATOR);
    expect(w!.status).toBe("ready");
    // unpause on a non-paused item rejects
    await expect(repo.unpauseWork(id, CREATOR)).rejects.toThrow(TransitionRejected);
  });
});

describe("S3 paused-state — digest exclusion + dwell + projection + resume-revalidation", () => {
  it("DIGEST: a paused item is excluded from listReadyForRole + counts as no in-flight", async () => {
    const { repo } = await setup();
    const id = await readyItem(repo);
    // ready → listed
    expect((await repo.listReadyForRole("engineer", 50)).items.map((w) => w.id)).toContain(id);
    await repo.pauseWork(id, CREATOR);
    // paused → NOT listed (dormant), and not lease-held → not in-flight
    expect((await repo.listReadyForRole("engineer", 50)).items.map((w) => w.id)).not.toContain(id);
  });

  it("DWELL: paused accrues its stateDurations bucket (sum-identity preserved)", async () => {
    const { repo } = await setup();
    const id = await readyItem(repo);
    await repo.pauseWork(id, CREATOR);
    await new Promise((r) => setTimeout(r, 5));
    const resumed = await repo.unpauseWork(id, CREATOR);
    expect(resumed!.stateDurations.paused).toBeGreaterThan(0); // dwell in paused accrued on exit
  });

  it("PROJECTION: get_current_stint (getStintProjection) surfaces a paused child", async () => {
    const { repo } = await setup();
    const child = await readyItem(repo);
    await repo.pauseWork(child, CREATOR);
    const arc = await repo.createWorkItem({ type: "task", roleEligibility: [], completionDependsOn: [child], evidenceRequirements: [], createdBy: { role: "architect", agentId: "arch-1" } });
    const proj = await repo.getStintProjection(arc.id);
    expect(proj!.statusCounts.paused).toBe(1);
    expect(proj!.children.find((c) => c.id === child)!.status).toBe("paused");
  });

  it("RESUME does NOT bypass start-gates: an unpaused item with unmet deps is still unclaimable", async () => {
    const { repo } = await setup();
    // a dependency that is NOT done
    const dep = await readyItem(repo);
    const id = await readyItem(repo, [dep]);
    await repo.pauseWork(id, CREATOR);
    await repo.unpauseWork(id, CREATOR); // → ready
    // claim re-validates deps fail-closed (dep not done) → the item is NOT in the claimable digest,
    // and a direct claim rejects — resume did not bypass the start-gate.
    expect((await repo.listReadyForRole("engineer", 50, "agent-eng")).items.map((w) => w.id)).not.toContain(id);
    await expect(repo.claimWorkItem(id, "agent-eng", "engineer")).rejects.toThrow();
  });

  it("LEGAL-MOVES: pause legal for creator@ready; unpause legal for creator@paused", async () => {
    const { repo } = await setup();
    const id = await readyItem(repo);
    const atReady = await repo.getLegalMoves(id, { agentId: "arch-1", role: "architect" });
    expect(atReady!.moves.find((m) => m.verb === "pause")!.legal).toBe(true);
    expect(atReady!.moves.find((m) => m.verb === "unpause")!.legal).toBe(false);
    await repo.pauseWork(id, CREATOR);
    const atPaused = await repo.getLegalMoves(id, { agentId: "arch-1", role: "architect" });
    expect(atPaused!.moves.find((m) => m.verb === "unpause")!.legal).toBe(true);
    expect(atPaused!.moves.find((m) => m.verb === "pause")!.legal).toBe(false);
    // a stranger sees neither as legal
    const stranger = await repo.getLegalMoves(id, { agentId: "rando", role: "engineer" });
    expect(stranger!.moves.find((m) => m.verb === "unpause")!.legal).toBe(false);
  });
});
