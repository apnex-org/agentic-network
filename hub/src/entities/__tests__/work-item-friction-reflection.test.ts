import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { WorkItemRepositorySubstrate, EvidencePredicateFailed } from "../work-item-repository-substrate.js";
import { SubstrateCounter } from "../substrate-counter.js";
import type { EvidenceItem, EvidenceRequirement } from "../work-item.js";

async function setup() {
  const substrate = createMemoryStorageSubstrate();
  const repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
  return { repo };
}

const req: EvidenceRequirement = { id: "commit", kind: "commit" };
const evidence = (): EvidenceItem[] => [{ requirementId: "commit", kind: "commit", ref: "abc123", producedAt: new Date().toISOString() }];

async function started(repo: WorkItemRepositorySubstrate, requirements: EvidenceRequirement[] = [req]) {
  const w = await repo.createWorkItem({ type: "task", roleEligibility: ["engineer"], evidenceRequirements: requirements });
  const claimed = await repo.claimWorkItem(w.id, "agent-eng", "engineer");
  const token = claimed!.lease!.token;
  await repo.startWork(w.id, "agent-eng", token);
  return { workId: w.id, token };
}

describe("A10 friction reflection capture", () => {
  it("stores an explicit no-friction reflection on complete_work", async () => {
    const { repo } = await setup();
    const { workId, token } = await started(repo);

    const done = await repo.completeWork(workId, "agent-eng", token, evidence(), {
      observed: false,
      summary: "no friction observed",
      suggestedFollowUp: { kind: "none" },
    });

    expect(done!.status).toBe("done");
    expect(done!.frictionReflections).toEqual([
      expect.objectContaining({
        producedBy: "agent-eng",
        sourceVerb: "complete_work",
        observed: false,
        summary: "no friction observed",
        compatibility: "explicit",
      }),
    ]);
  });

  it("accepts missing legacy clients but marks the stored reflection", async () => {
    const { repo } = await setup();
    const { workId, token } = await started(repo);

    const done = await repo.completeWork(workId, "agent-eng", token, evidence());

    expect(done!.status).toBe("done");
    expect(done!.frictionReflections[0]).toEqual(expect.objectContaining({
      observed: false,
      summary: "not provided by legacy client",
      categories: ["other"],
      compatibility: "missing_legacy_client",
    }));
  });

  it("rejects observed=true without a non-empty summary", async () => {
    const { repo } = await setup();
    const { workId, token } = await started(repo);

    await expect(repo.completeWork(workId, "agent-eng", token, evidence(), { observed: true, summary: "  " }))
      .rejects.toThrow(EvidencePredicateFailed);
  });

  it("preserves friction reflection when completion parks in review", async () => {
    const { repo } = await setup();
    const reviewReq: EvidenceRequirement = { id: "review", kind: "review" };
    const { workId, token } = await started(repo, [req, reviewReq]);

    const parked = await repo.completeWork(workId, "agent-eng", token, evidence(), {
      observed: true,
      summary: "review gate was manual",
      categories: ["manual_step", "evidence_pain"],
      suggestedFollowUp: { kind: "idea", text: "streamline verifier gate parking" },
    });

    expect(parked!.status).toBe("review");
    expect(parked!.frictionReflections[0]).toEqual(expect.objectContaining({
      observed: true,
      summary: "review gate was manual",
      categories: ["manual_step", "evidence_pain"],
      compatibility: "explicit",
    }));
  });

  it("rolls up leaf friction in get_current_stint projection", async () => {
    const { repo } = await setup();
    const { workId: childId, token } = await started(repo);
    await repo.completeWork(childId, "agent-eng", token, evidence(), {
      observed: true,
      summary: "evidence was awkward",
      categories: ["evidence_pain"],
    });
    const arc = await repo.createWorkItem({ type: "task", roleEligibility: ["architect"], evidenceRequirements: [req], completionDependsOn: [childId] });

    const stint = await repo.getStintProjection(arc.id);

    expect(stint!.friction).toEqual({
      total: 1,
      observed: 1,
      missingLegacy: 0,
      categories: { evidence_pain: 1 },
    });
  });
});
