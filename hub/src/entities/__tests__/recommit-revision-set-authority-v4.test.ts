// 🔴 idea-640 — RE-HOMED FROM `d3-revision-authority-matrix-v4`, WHICH DIED WITH `revise_work`.
//
// That file was 14 tests and ~270 lines of harness, THIRTEEN of them asserting `revise_work`
// authority. One did not: batch-recommit authority is a property of `recommitRevisionSet`, WHICH
// SURVIVES THE RETIREMENT. It only lived there because `reviseWork` was how the file produced a
// gen-2 to recommit.
//
// DELETING IT WITH THE FILE WOULD HAVE DROPPED A REAL PROPERTY BECAUSE ITS SETUP GOT HARDER —
// the same trap as deleting a verb that has a guard hidden inside it, one layer up. The scaffolding
// died; the property did not.
//
// WHAT WAS DELIBERATELY NOT CARRIED OVER: the original test's second half attempted a
// successor-author laundering revision and asserted `revision.actor_forbidden`. That is an assertion
// about `revise_work`'s OWN authority classifier and it dies with the verb — there is no longer a
// caller-facing surface that can attempt it. Recorded here rather than silently dropped, because a
// reader comparing old and new should see WHICH coverage ended and WHY.
import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import type { WorkItem } from "../work-item.js";
import { WorkItemRepositorySubstrate } from "../work-item-repository-substrate.js";
import { WorkRevisionStorageRepositoryV4 } from "../work-revision-storage-v4.js";
import { buildSuccessorGeneration } from "./_successor-generation.js";

const NOW = "2026-07-26T09:00:00.000Z";
const CREATOR = { role: "engineer", agentId: "creator-1" };
const ARCHITECT = { role: "architect", agentId: "architect-1" };

function work(id: string, over: Partial<WorkItem> = {}): WorkItem {
  return {
    id, type: "task", priority: "normal", roleEligibility: ["engineer"],
    dependsOn: [], completionDependsOn: [], evidenceRequirements: [], references: [],
    targetRef: { kind: "mission", id: "mission-140" }, status: "ready", lease: null,
    evidence: [], frictionReflections: [], blockedOn: null, leaseExpiryCount: 0,
    enteredCurrentStateAt: NOW,
    stateDurations: { ready: 0, claimed: 0, in_progress: 0, blocked: 0, paused: 0, review: 0 },
    attestationHistory: [], attestations: {}, executorHistory: [], createdBy: CREATOR,
    createdAt: NOW, updatedAt: NOW, ...over,
  };
}

describe("recommitRevisionSet — batch authority survives the revise_work retirement", () => {
  it("🔴 requires architect or Director: the CREATOR is denied, the architect is allowed", async () => {
    const substrate = createMemoryStorageSubstrate();
    const storage = new WorkRevisionStorageRepositoryV4(substrate);
    const repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));

    // gen-1
    await buildSuccessorGeneration({
      storage, workItems: [work("root")],
      generation: 1, previousGeneration: 0, operationId: "bootstrap", createdAt: NOW,
    });
    // gen-2 — the successor `revise_work` used to mint. Built through the storage layer now; the
    // helper performs the revision ALLOCATION the verb used to do, which is the step that is easy
    // to miss when hand-rolling this and the reason the helper exists at all.
    await buildSuccessorGeneration({
      storage,
      workItems: [work("root-r2", { status: "paused", logicalId: "root", revision: 2, predecessorPhysicalId: "root" } as never)],
      generation: 2, previousGeneration: 1, operationId: "revised", createdAt: NOW,
      recommitSet: ["root"],
      existingFamiliesByLogicalId: { root: (await storage.getFamily("root"))! },
    });

    const recommit = {
      logicalIds: ["root"],
      expectedGeneration: 2,
      expectedRevisions: { root: 2 },
      operationId: "batch-recommit",
      reason: "batch authority",
    };

    // THE PROPERTY: batch recommit is architect/Director only. The creator does NOT inherit it.
    await expect(repo.recommitRevisionSet(recommit, CREATOR))
      .rejects.toMatchObject({ code: "revision.director_or_architect_required" });
    await expect(repo.recommitRevisionSet(recommit, ARCHITECT))
      .resolves.toMatchObject({ operationReplay: false });

    // …and the head did not move under the denied attempt — a refusal that advanced the generation
    // would be a refusal in name only.
    expect((await storage.getHead())?.head.generation).toBe(2);
  });
});
