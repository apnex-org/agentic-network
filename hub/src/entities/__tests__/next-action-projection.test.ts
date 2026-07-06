/**
 * W2 (idea-451 / work-182) — getNextAction: the graph-projected "next action".
 *
 * ANTI-INVERT structural proof: for an arc-node, the projection returns the
 * HIGHEST-PRIORITY READY completionDependsOn child. Selecting a lower-priority
 * ready child over a higher-priority ready one is UNREPRESENTABLE (priority-ordered,
 * head returned) — the corrective for the last stint's scope-inversion (choosing
 * "what next" from memory). Non-ready children (unmet start-gate, claimed, blocked,
 * paused, done) are excluded by construction — they are not in listReadyForRole.
 */

import { describe, it, expect } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { WorkItemRepositorySubstrate } from "../work-item-repository-substrate.js";
import { SubstrateCounter } from "../substrate-counter.js";
import type { WorkItemPriority } from "../work-item.js";

async function setup() {
  const substrate = createMemoryStorageSubstrate();
  const repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
  return { repo };
}
async function child(repo: WorkItemRepositorySubstrate, priority: WorkItemPriority, dependsOn: string[] = []) {
  return repo.createWorkItem({ type: "task", priority, roleEligibility: ["engineer"], dependsOn, evidenceRequirements: [] });
}

describe("W2 getNextAction — highest-priority READY child (anti-invert)", () => {
  it("returns the highest-priority READY child; a lower-priority pick is unrepresentable; unmet-start-gate child excluded", async () => {
    const { repo } = await setup();
    const dep = await child(repo, "normal");            // a NOT-done dependency
    const cHigh = await child(repo, "high");
    const cCrit = await child(repo, "critical");
    const cGated = await child(repo, "critical", [dep.id]); // unmet dep → NOT claim-ready
    const arc = await repo.createWorkItem({ type: "task", roleEligibility: [], evidenceRequirements: [], completionDependsOn: [cHigh.id, cCrit.id, cGated.id] });

    const proj = (await repo.getNextAction(arc.id, "engineer"))!;
    expect(proj.hasChildren).toBe(true);
    // the highest-priority READY child is cCrit (critical), NOT cHigh — inversion is impossible.
    expect(proj.nextAction!.id).toBe(cCrit.id);
    expect(proj.nextAction!.priority).toBe("critical");
    // cGated (unmet dependsOn = start-gate) is excluded → only cHigh + cCrit are candidates.
    expect(proj.readyCandidates).toBe(2);
  });

  it("once the top child is claimed (no longer READY), the next-highest READY child becomes next-action", async () => {
    const { repo } = await setup();
    const cHigh = await child(repo, "high");
    const cCrit = await child(repo, "critical");
    const arc = await repo.createWorkItem({ type: "task", roleEligibility: [], evidenceRequirements: [], completionDependsOn: [cHigh.id, cCrit.id] });
    await repo.claimWorkItem(cCrit.id, "eng-1", "engineer"); // cCrit → claimed → excluded from listReadyForRole
    const proj = (await repo.getNextAction(arc.id, "engineer"))!;
    expect(proj.nextAction!.id).toBe(cHigh.id);
    expect(proj.readyCandidates).toBe(1);
  });

  it("a leaf (no completionDependsOn children) → hasChildren:false, nextAction:null", async () => {
    const { repo } = await setup();
    const leaf = await repo.createWorkItem({ type: "task", roleEligibility: [], evidenceRequirements: [] });
    const proj = (await repo.getNextAction(leaf.id, "engineer"))!;
    expect(proj.hasChildren).toBe(false);
    expect(proj.nextAction).toBeNull();
  });

  it("an absent arc → null", async () => {
    const { repo } = await setup();
    expect(await repo.getNextAction("work-nope", "engineer")).toBeNull();
  });

  // steve #546 blocker-1: a ready arc child ranked BEYOND the global ready-scan window
  // (READY_SCAN_CAP=500) must still be found. The OLD assembly — children ∩
  // listReadyForRole(role, 500) — sliced the first 500 globally-ready rows, so a child at
  // insertion-position 511 was DROPPED (nextAction:null / readyCandidates:0 while raw scope
  // held a ready child). Child-local point-gets the arc's children directly → position-immune.
  it("child-local: a ready arc child BEYOND the 500-row global ready-scan window is still found", async () => {
    const { repo } = await setup();
    for (let i = 0; i < 510; i++) {
      await repo.createWorkItem({ type: "task", priority: "normal", roleEligibility: ["engineer"], evidenceRequirements: [] });
    }
    const cCrit = await child(repo, "critical"); // the 511th ready item — beyond the old 500-window
    const arc = await repo.createWorkItem({ type: "task", roleEligibility: [], evidenceRequirements: [], completionDependsOn: [cCrit.id] });
    const proj = (await repo.getNextAction(arc.id, "engineer"))!;
    expect(proj.nextAction!.id).toBe(cCrit.id); // the old capped intersection returned null here
    expect(proj.readyCandidates).toBe(1);
  });

  // Agent-scoped WIP-cap short-circuit: a maxed caller can claim nothing → non-dark wip_capped,
  // never a nextAction claim_work would reject. The role-only projection (no agentId) is exempt.
  it("agent-scoped: a WIP-maxed caller gets nextAction:null + emptyReason:wip_capped; role-only still sees the child", async () => {
    const { repo } = await setup();
    const cCrit = await child(repo, "critical");
    const arc = await repo.createWorkItem({ type: "task", roleEligibility: [], evidenceRequirements: [], completionDependsOn: [cCrit.id] });
    // Max out eng-1's WIP by claiming its cap worth of unrelated ready items.
    const cap = 3; // engineer WIP cap (wipCap("engineer")); claim that many to hit the ceiling
    for (let i = 0; i < cap; i++) {
      const w = await child(repo, "normal");
      await repo.claimWorkItem(w.id, "eng-1", "engineer");
    }
    const scoped = (await repo.getNextAction(arc.id, "engineer", "eng-1"))!;
    expect(scoped.nextAction).toBeNull();
    expect(scoped.emptyReason).toBe("wip_capped");
    // role-only (no caller) is not WIP-gated — it reports the raw claimable scope.
    const roleOnly = (await repo.getNextAction(arc.id, "engineer"))!;
    expect(roleOnly.nextAction!.id).toBe(cCrit.id);
    expect(roleOnly.emptyReason).toBeUndefined();
  });
});
