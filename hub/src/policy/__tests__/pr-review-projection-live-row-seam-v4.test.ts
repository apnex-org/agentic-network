// 🔴 REGRESSION — THE SYSTEM-PROJECTION SEAM MUST WORK ON A **LIVE** ROW.
//
// WHAT SHIPPED AND BROKE PRODUCTION. idea-640's three-tier edit gate counts EVERY structural edge
// append as claimant-authority-significant and requires the row to be SUSPENDED. But `complete_work`
// projects a review obligation onto the row it is completing by appending a `completionDependsOn`
// edge — and a row being completed is BY DEFINITION LIVE. The predicate therefore refused the
// system's own projection, and every PR-evidence completion in the fleet was blocked, along with the
// inbound repo-event review projection, which reaches the same function with `appendDependsOn`.
//
// 🔴 WHY 2938 TESTS, 14 CONTRACT ORACLES AND SIX PROVEN MUTATIONS ALL MISSED IT. Not an overlooked
// case — a STRUCTURAL HOLE between two suites:
//   - the policy suites drive `complete_work` against a STUBBED store, so the real repository seam
//     (and therefore the real gate) is never executed;
//   - the substrate suites execute the real gate but never enter through the policy layer, and
//     `pr_review_required` blocks BEFORE the substrate anyway.
// NOTHING drove the policy layer against the REAL substrate with PR evidence. This file is that
// missing edge, and it is the deliverable — the predicate change is the footnote.
//
// THE LESSON, WHICH IS THE INVERSE OF THE ONE THIS STREAM WAS BUILT ON:
//   A MUTATION MATRIX PROVES A GUARD FIRES. IT SAYS NOTHING ABOUT WHO ELSE RELIED ON THE THING IT
//   NOW REFUSES. Mutation-proofing, positive controls and falsifiers all test a guard's SUBJECT.
//   None of them tests its BLAST RADIUS. The guard was not removed from something load-bearing — it
//   was ADDED across a seam the system itself uses.
//
// WHY THE EXEMPTION IS NOT A HOLE: the gate's own rationale is "an executor working to a runbook must
// not have it change mid-turn." This edge is appended SYNCHRONOUSLY BY THE HOLDER'S OWN complete_work
// call, as the completion gate they are invoking — it cannot surprise the holder, because the holder
// caused it. NOT AN EXCEPTION TO THE RULE; A BOUNDARY THE RULE WAS NEVER MEANT TO CROSS.
import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../../entities/substrate-counter.js";
import { WorkItemRepositorySubstrate } from "../../entities/work-item-repository-substrate.js";
import { PR_REVIEW_PROJECTION_AUTHOR_AGENT_ID } from "../../entities/work-item.js";
import { WorkGraphCurrentnessRejected } from "../../entities/workgraph-currentness-fence-v4.js";
import { reconcilePrReviewProjection } from "../pr-review-workitem-projection.js";

const ARCH = { agentId: "arch-1", role: "architect" };

describe("system-projection seam — a review obligation must attach to a LIVE row", () => {
  let repo: WorkItemRepositorySubstrate;

  beforeEach(() => {
    const substrate = createMemoryStorageSubstrate();
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
  });

  /** Drive a row to in_progress — i.e. exactly the state complete_work runs in. */
  async function liveRow(): Promise<string> {
    const w = await repo.createWorkItem({
      type: "task",
      roleEligibility: ["engineer"],
      evidenceRequirements: [{ id: "pr", kind: "pr", description: "PR url" }] as never,
      createdBy: { role: "architect", agentId: ARCH.agentId } as never,
    });
    const claimed = await repo.claimWorkItem(w.id, "eng-1", "engineer");
    await repo.startWork(w.id, "eng-1", claimed!.lease!.token);
    return w.id;
  }

  async function readyRow(): Promise<string> {
    const w = await repo.createWorkItem({
      type: "task", roleEligibility: ["engineer"], evidenceRequirements: [] as never,
      createdBy: { role: "architect", agentId: ARCH.agentId } as never,
    });
    return w.id;
  }

  async function reviewRow(): Promise<string> {
    const w = await repo.createWorkItem({
      type: "task",
      roleEligibility: ["architect"],
      evidenceRequirements: [] as never,
      createdBy: { role: "architect", agentId: ARCH.agentId } as never,
    });
    return w.id;
  }

  it("🔴 appendCompletionDependsOn: the seam ATTACHES to a live in_progress row — THE REGRESSION", async () => {
    const target = await liveRow();
    const review = await reviewRow();
    const before = (await repo.getWorkItem(target))!;
    expect(before.status, "armed: the row is LIVE, which is the whole point").toBe("in_progress");
    expect(before.lease, "…and held").not.toBeNull();
    expect(before.suspended ?? false, "…and NOT suspended").toBe(false);

    await repo.appendSystemProjectionEdge(target, "appendCompletionDependsOn", review);

    const after = (await repo.getWorkItem(target))!;
    expect(after.completionDependsOn, "the review obligation is attached").toContain(review);
    expect(after.status, "phase untouched").toBe("in_progress");
    expect(after.lease?.holder, "holder untouched").toBe("eng-1");
    expect(after.suspended ?? false, "suspension untouched").toBe(false);
  });

  it("🔴 appendDependsOn on a live row STILL REFUSES — and for a PRE-EXISTING reason that is NOT mine", async () => {
    // MEASURED, against the report rather than accepting it. The webhook entry point
    // (repo-event-pr-review-requested-handler.ts:336) uses `appendDependsOn`, and it was reported to
    // me as collateral damage from idea-640. IT IS NOT. `git log -S` puts this guard at #504
    // (work-136 / decision-11), and `git show a673512a:` — the sha deployed BEFORE #682 — has it at
    // :1020. dependsOn appends have been refused on every non-ready row since long before this arc.
    //
    // AND THE SEAM DELIBERATELY DOES NOT LIFT IT. Its rationale — "re-gating a claimed item would
    // yank a claimant's floor" — DOES reach the system projection: adding a start-gate to a claimed
    // row really would re-gate it. Unlike the tier refusal, this guard was meant to cover this case.
    // Exempting it would be me widening a fix past its own defect, using an incident as licence.
    const target = await liveRow();
    const review = await reviewRow();
    await expect(repo.appendSystemProjectionEdge(target, "appendDependsOn", review))
      .rejects.toThrow(/dependsOn appends only while ready/);
    expect((await repo.getWorkItem(target))!.dependsOn, "nothing attached").not.toContain(review);
  });

  it("appendDependsOn via the seam DOES attach on a `ready` row — the guard is phase-scoped, not seam-scoped", async () => {
    // The positive control for the case above: the seam is not broken for dependsOn, it is correctly
    // subject to a different, older phase rule. Without this, the refusal above could equally mean
    // "the seam cannot do dependsOn at all", which is a different and wrong conclusion.
    const target = await readyRow();
    const review = await reviewRow();
    await repo.appendSystemProjectionEdge(target, "appendDependsOn", review);
    expect((await repo.getWorkItem(target))!.dependsOn).toContain(review);
  });

  it("🔴 THE PUBLIC SEAM IS UNCHANGED — the same edge via update_work on the same live row still REFUSES", async () => {
    // This is the control that proves the exemption is scoped to THE SEAM and not to THE RELATION.
    // If this ever goes green, the fix has been generalised into the hole it was avoiding.
    const target = await liveRow();
    const review = await reviewRow();
    await expect(
      repo.updateWorkItem(target, ARCH, { appendCompletionDependsOn: [review] }),
    ).rejects.toMatchObject({ code: "workgraph.currentness.revision_required" });
    await expect(
      repo.updateWorkItem(target, ARCH, { appendDependsOn: [review] }),
    ).rejects.toThrow(WorkGraphCurrentnessRejected);
    const after = (await repo.getWorkItem(target))!;
    expect(after.completionDependsOn, "the refused append landed nowhere").not.toContain(review);
    expect(after.dependsOn).not.toContain(review);
  });

  it("🔴 THE EXEMPTION BUYS THE EDGE AND STRUCTURALLY NOTHING ELSE — there is no `set` to pass", async () => {
    // The seam takes (relation, id), NOT a mutation. The system principal cannot move targetRef,
    // runbook, payload or roleEligibility on a live row THROUGH THIS PATH even by mistake: that is
    // not a check someone could forget to write, it is an argument that does not exist.
    const target = await liveRow();
    const review = await reviewRow();
    await repo.appendSystemProjectionEdge(target, "appendCompletionDependsOn", review);
    const after = (await repo.getWorkItem(target))!;
    expect(after.runbook, "runbook untouched by the projection").toBeUndefined();
    expect(after.roleEligibility, "eligibility untouched").toEqual(["engineer"]);

    // …and the same principal going through the PUBLIC verb still cannot set those on a live row.
    await expect(
      repo.updateWorkItem(target, { agentId: "system-pr-review-rule", role: "architect" }, { set: { runbook: "rewritten" } }),
    ).rejects.toThrow(WorkGraphCurrentnessRejected);
    expect((await repo.getWorkItem(target))!.runbook, "still untouched").toBeUndefined();
  });

  it("every OTHER protection survives the seam: a terminal row still refuses the projection", async () => {
    // The exemption skips the LIVE-row tier refusal ONLY. Terminal refusal, failed-seal refusal,
    // currentness and the CAS are all still in force on this path.
    const target = await liveRow();
    const review = await reviewRow();
    const claimed = (await repo.getWorkItem(target))!;
    await repo.abandonWork(target, "eng-1", { leaseToken: claimed.lease!.token });
    expect((await repo.getWorkItem(target))!.status).toBe("abandoned");
    await expect(
      repo.appendSystemProjectionEdge(target, "appendCompletionDependsOn", review),
    ).rejects.toThrow(/terminal/);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // 🔴 THE BOTH-TREE FALSIFIER. THE CASE ABOVE CANNOT SERVE AS ONE AND THAT NEARLY GOT BANKED.
  //
  // Tests written against `appendSystemProjectionEdge` are UNCONDITIONALLY RED on the broken tree —
  // not because the behaviour was wrong but because the METHOD DOES NOT EXIST THERE
  // (`TypeError: repo.appendSystemProjectionEdge is not a function`). A red indistinguishable from
  // "the API is missing" is not evidence about the regression; it is the saturated-instrument defect
  // wearing a falsifier's clothes.
  //
  // THIS case goes through `reconcilePrReviewProjection`, which exists IDENTICALLY on both trees. So
  // it is a genuine single-variable read:
  //     5182e062 (broken) -> materialized:false, fallbackReason "relation_failed:...revision_required"
  //     with the seam     -> materialized:true, edge attached
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  it("🔴 FALSIFIER (both trees): reconcilePrReviewProjection MATERIALISES onto a live row", async () => {
    const target = await liveRow();
    const review = await reviewRow();

    const result = await reconcilePrReviewProjection({
      store: repo as never,
      projection: {
        action: "reuse_existing_review_workitem",
        projectionKey: "seam-regression-key",
        existingWorkId: review,
        existingStatus: "ready",
      },
      binding: { targetWorkId: target } as never,
      sourceMessageId: `pr-evidence:${target}:pr`,
      relation: "appendCompletionDependsOn",
    });

    expect(result.fallbackReason, "no relation_failed — this is the exact string production returned").toBeUndefined();
    expect(result.materialized, "the review obligation MATERIALISES on a live row").toBe(true);
    expect((await repo.getWorkItem(target))!.completionDependsOn).toContain(review);
  });

  it("🔴 ITEM 4 — the reserved projection id is RESERVED BY PROPERTY, not by format coincidence", async () => {
    // NOTE ON SCOPE, so this is not later credited with more than it does: the seam's exemption keys
    // on WHICH METHOD WAS CALLED, not on this id, so no forged principal can reach it regardless.
    // What this DOES defend is the legacy `createdBy.agentId` branch of isProjectedPrReviewObligation
    // (work-item.ts), which is a genuine authority read on the id.
    //
    // The safety today rests on "every minted agentId looks like agent-{8hex}, and this does not."
    // THAT IS A DESCRIPTION OF TWO MINTING PATHS, NOT AN INVARIANT — bug-385 put `anonymous-architect`
    // on the wire in production tonight, which does not match that shape either. This asserts the
    // property so a future fallback, migration or system-seeding path cannot re-open it green.
    const agents = await repo.listWorkItems();
    void agents;
    const forged = await repo.createWorkItem({
      type: "task", roleEligibility: ["engineer"], evidenceRequirements: [] as never,
      createdBy: { role: "architect", agentId: PR_REVIEW_PROJECTION_AUTHOR_AGENT_ID } as never,
    });
    // A row may CARRY that author string, but carrying it must buy no seam access: the public verb
    // still refuses the live-row append under that exact principal.
    const target = await liveRow();
    const review = await reviewRow();
    await expect(
      repo.updateWorkItem(target, { agentId: PR_REVIEW_PROJECTION_AUTHOR_AGENT_ID, role: "architect" }, { appendCompletionDependsOn: [review] }),
    ).rejects.toThrow(WorkGraphCurrentnessRejected);
    expect((await repo.getWorkItem(target))!.completionDependsOn, "the forged principal attached nothing").not.toContain(review);
    expect(forged.id, "fixture was armed").toBeTruthy();
  });
});
