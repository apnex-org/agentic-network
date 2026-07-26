// work-553 / bug-390 — THE ROUND TRIP: pause -> modify -> unpause, COMPOSED THROUGH THE POLICY LAYER.
//
// 🔴 WHY THIS FILE EXISTS. Every one of these three verbs already had passing tests. Every one passed
// IN ISOLATION, against the substrate, and the defect was invisible to all of them because
// **THE DEFECT LIVED ONLY IN THE SEQUENCE.** Pause worked. Modify worked. Unpause then REFUSED
// BECAUSE YOU MODIFIED — and the refusal named a remedy (`revise_work`) that #685 retired and that
// never worked on legacy rows anyway. The row was stranded with no exit.
//
// That is the THIRD instance in one day of a green suite covering a shape of the path rather than the
// path: nine stubs mocking `updateWorkItem` (2938 green through a fleet-wide outage) · seven tests
// calling `repo.resetWork()` direct while the verb had no door (work-552) · this. So these tests enter
// through `router.handle(...)` against a REAL repository, in sequence, as a client would.
//
// 🔴 AND THE FIX MUST NOT BE "MAKE THE EDIT ILLEGAL." Refusing at step 2 would make the error vanish
// and would DELETE the capability idea-640 exists to deliver. The edit is correct; the exit was missing.
// The `MINOR-tier edit is still accepted` assertion below is load-bearing for exactly that reason.
import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../router.js";
import { registerWorkItemPolicy } from "../work-item-policy.js";
import { createTestContext, type TestPolicyContext } from "../test-utils.js";
import { createMemoryStorageSubstrate } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../../entities/substrate-counter.js";
import { WorkItemRepositorySubstrate } from "../../entities/work-item-repository-substrate.js";

function body(r: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(r.content[0].text);
}

function realCtx(role: string): { ctx: TestPolicyContext; repo: WorkItemRepositorySubstrate } {
  const ctx = createTestContext({ role });
  const substrate = createMemoryStorageSubstrate();
  const repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
  ctx.stores.workItem = repo;
  return { ctx, repo };
}

/** A LIVE row: claimed and in_progress, holding a lease — the state the arc controller was in. */
async function liveRow(repo: WorkItemRepositorySubstrate, holder = "eng-1") {
  const w = await repo.createWorkItem({
    type: "task", roleEligibility: ["engineer"], evidenceRequirements: [],
    createdBy: { role: "architect", agentId: "arch-1" } as never,
  });
  const claimed = await repo.claimWorkItem(w.id, holder, "engineer");
  await repo.startWork(w.id, holder, claimed!.lease!.token);
  return { id: w.id, token: claimed!.lease!.token };
}

/** A second row to point a completion dependency at. */
async function otherRow(repo: WorkItemRepositorySubstrate) {
  const w = await repo.createWorkItem({
    type: "task", roleEligibility: ["engineer"], evidenceRequirements: [],
    createdBy: { role: "architect", agentId: "arch-1" } as never,
  });
  return w.id;
}

describe("work-553 / bug-390 — pause -> modify -> unpause completes through the policy layer", () => {
  let router: PolicyRouter;
  beforeEach(() => { router = new PolicyRouter(() => {}); registerWorkItemPolicy(router); });

  it("🔴 THE FULL ROUND TRIP: the edge lands AND the row resumes with its lease intact", async () => {
    const { ctx, repo } = realCtx("architect");
    const { id, token } = await liveRow(repo);
    const depId = await otherRow(repo);
    const claimedAtBefore = (await repo.getWorkItem(id))!.lease!.claimedAt;

    // 1 — PAUSE. Suspends the row; the phase is PRESERVED and the lease is RETAINED.
    const paused = await router.handle("pause_work", { workId: id, operationId: "op-rt-1", reason: "round trip" }, ctx);
    expect(paused.isError, JSON.stringify(body(paused))).toBeFalsy();
    const afterPause = (await repo.getWorkItem(id))!;
    expect(afterPause.suspended).toBe(true);
    expect(afterPause.status, "the phase never leaves").toBe("in_progress");
    expect(afterPause.lease, "pause RETAINS the lease").not.toBeNull();

    // 2 — MODIFY. The MINOR tier: an edge append on a suspended row. THIS MUST STAY LEGAL.
    const edited = await router.handle("update_work", { workId: id, appendCompletionDependsOn: [depId] }, ctx);
    expect(edited.isError, JSON.stringify(body(edited))).toBeFalsy();
    expect((await repo.getWorkItem(id))!.completionDependsOn, "the edit landed").toContain(depId);

    // 3 — UNPAUSE. THE STEP THAT REFUSED. Pre-fix: "claimant row or generation edges changed while
    // paused; create a semantic revision" — a remedy whose verb no longer exists.
    const resumed = await router.handle("unpause_work", { workId: id }, ctx);
    expect(resumed.isError, JSON.stringify(body(resumed))).toBeFalsy();

    const after = (await repo.getWorkItem(id))!;
    expect(after.suspended, "suspended cleared").toBe(false);
    expect(after.status, "resumes at the PRE-SUSPENSION phase, not `ready`").toBe("in_progress");
    expect(after.completionDependsOn, "the appended edge SURVIVED the round trip").toContain(depId);
    expect(after.lease, "lease retained").not.toBeNull();
    expect(after.lease!.token, "SAME token — the holder does not re-claim").toBe(token);
    expect(after.lease!.holder).toBe("eng-1");
    expect(after.lease!.claimedAt, "claimedAt preserved — evidence produced pre-suspension stays admissible").toBe(claimedAtBefore);
  });

  it("🔴 THE GUARD IS NOT BLINDED: UNSANCTIONED drift still refuses at unpause", async () => {
    // The whole risk of this fix is turning a trap into a hole. The re-freeze must record a baseline
    // ONLY for edits that passed the gate — drift that never went through `update_work` must still be
    // caught. Here the row is mutated BENEATH the repository (direct substrate write, no gate), which
    // is the corruption case the freeze exists for.
    const { ctx, repo } = realCtx("architect");
    const { id } = await liveRow(repo);
    const depId = await otherRow(repo);
    await router.handle("pause_work", { workId: id, operationId: "op-rt-2", reason: "round trip" }, ctx);

    const substrate = (repo as unknown as { substrate: { put: (k: string, v: unknown) => Promise<unknown> } }).substrate;
    const row = (await repo.getWorkItem(id))!;
    await substrate.put("WorkItem", { ...row, completionDependsOn: [...row.completionDependsOn, depId] });

    const resumed = await router.handle("unpause_work", { workId: id }, ctx);
    expect(resumed.isError, "ungated drift MUST still refuse").toBe(true);
    expect(String(body(resumed).error)).toMatch(/changed while paused|revision/i);
  });

  it("🔴 ROUND TRIP B: pause -> reset -> rewrite evidenceRequirements -> unpause (the FULL tier)", async () => {
    // THE ONE THE ARC EXISTS FOR, and it was not in this node's acceptance because nobody knew it
    // failed. A and B break DIFFERENT HALVES of the same hash:
    //   A  edge append            -> nodeTopologyHash
    //   B  evidenceRequirements   -> nodeContractHash   (it is inside the claimant projection)
    // Since the FULL tier exists SOLELY to edit `evidenceRequirements`, and that field is inside the
    // hash `unpause` demands be unchanged, THE FULL TIER WAS A ONE-WAY DOOR BY CONSTRUCTION — every
    // node a steward reset and re-scoped was stranded by the arc's own primary workflow.
    const { ctx, repo } = realCtx("architect");
    const { id } = await liveRow(repo);
    await router.handle("pause_work", { workId: id, operationId: "op-rt-B", reason: "full tier" }, ctx);
    await router.handle("reset_work", { workId: id }, ctx); // the sanctioned gateway to FULL

    const rewritten = [{ id: "rescoped", kind: "freeform", description: "a rewritten contract" }];
    const edited = await router.handle("update_work", { workId: id, set: { evidenceRequirements: rewritten } }, ctx);
    expect(edited.isError, JSON.stringify(body(edited))).toBeFalsy();

    const resumed = await router.handle("unpause_work", { workId: id }, ctx);
    expect(resumed.isError, JSON.stringify(body(resumed))).toBeFalsy();
    const after = (await repo.getWorkItem(id))!;
    expect(after.suspended).toBe(false);
    expect(after.evidenceRequirements[0]!.id, "the rewritten contract survived").toBe("rescoped");
  });

  it("🔴 RECOVERY: a row ALREADY stranded (no sanctioned baseline) is recoverable via reset", async () => {
    // PREVENTION IS NOT RECOVERY. Rows stranded before this shipped carry no `sanctionedAuthority`, so
    // unpause falls back to a `frozenAuthority` that no longer describes them and still refuses. Three
    // production rows are in exactly that state. Simulated here by stripping the baseline the fix
    // writes — i.e. reproducing a pre-fix row on the post-fix binary.
    const { ctx, repo } = realCtx("architect");
    const { id } = await liveRow(repo);
    const depId = await otherRow(repo);
    await router.handle("pause_work", { workId: id, operationId: "op-rt-R", reason: "strand" }, ctx);
    await router.handle("update_work", { workId: id, appendCompletionDependsOn: [depId] }, ctx);

    const substrate = (repo as unknown as { substrate: { put: (k: string, v: unknown) => Promise<unknown> } }).substrate;
    const row = (await repo.getWorkItem(id))!;
    const stripped = (row.recallHistory ?? []).map(({ sanctionedAuthority: _drop, ...rest }) => rest);
    await substrate.put("WorkItem", { ...row, recallHistory: stripped });

    // ARMED: this is the stranded state — unpause refuses.
    const stuck = await router.handle("unpause_work", { workId: id }, ctx);
    expect(stuck.isError, "armed: the pre-fix row really is stranded").toBe(true);

    // RECOVERY: a steward resets, which re-baselines. Then unpause succeeds.
    const wasReset = await router.handle("reset_work", { workId: id }, ctx);
    expect(wasReset.isError, JSON.stringify(body(wasReset))).toBeFalsy();
    const resumed = await router.handle("unpause_work", { workId: id }, ctx);
    expect(resumed.isError, JSON.stringify(body(resumed))).toBeFalsy();
    expect((await repo.getWorkItem(id))!.suspended).toBe(false);
  });

  it("🔴 THE SYSTEM PROJECTION SEAM re-baselines too — a review edge cannot strand a suspended node", async () => {
    // THE SECOND ENTRY PATH INTO THE RE-FREEZE, and it does NOT clear the tier gate — it SKIPS it
    // (`systemProjectionSeam: true`). Its sanction is that the path is not caller-reachable: one live
    // caller, the PR-review reconciler, which builds its own mutation and stamps a system author.
    //
    // Asserted rather than left as a side effect, because an intended behaviour nobody wrote down is
    // indistinguishable from an accident the next reader will "clean up". Without this, a review
    // obligation landing on a SUSPENDED node moves `nodeTopologyHash` and strands it — bug-390 again,
    // but arriving from the system's own hand, so no human action would explain it.
    //
    // This is also the seam whose #682 change broke `complete_work` fleet-wide: A MUTATION MATRIX
    // PROVES A GUARD FIRES; IT SAYS NOTHING ABOUT WHO ELSE RELIES ON THE PATH. This is that check.
    const { ctx, repo } = realCtx("architect");
    const { id } = await liveRow(repo);
    const reviewId = await otherRow(repo);
    await router.handle("pause_work", { workId: id, operationId: "op-rt-S", reason: "seam" }, ctx);

    await repo.appendSystemProjectionEdge(id, "appendCompletionDependsOn", reviewId);
    expect((await repo.getWorkItem(id))!.completionDependsOn, "the system edge landed").toContain(reviewId);

    const resumed = await router.handle("unpause_work", { workId: id }, ctx);
    expect(resumed.isError, JSON.stringify(body(resumed))).toBeFalsy();
    const after = (await repo.getWorkItem(id))!;
    expect(after.suspended, "the node is NOT stranded by the system's own edge").toBe(false);
    expect(after.completionDependsOn).toContain(reviewId);
  });

  it("a pause with NO edit still round-trips — the untouched path is unchanged", async () => {
    // The control. This is the case that already worked (work-551 was the accidental live control),
    // and a fix that only makes the edited path pass while breaking this one would be no fix.
    const { ctx, repo } = realCtx("architect");
    const { id, token } = await liveRow(repo);
    await router.handle("pause_work", { workId: id, operationId: "op-rt-3", reason: "no edit" }, ctx);
    const resumed = await router.handle("unpause_work", { workId: id }, ctx);

    expect(resumed.isError, JSON.stringify(body(resumed))).toBeFalsy();
    const after = (await repo.getWorkItem(id))!;
    expect(after.suspended).toBe(false);
    expect(after.status).toBe("in_progress");
    expect(after.lease!.token).toBe(token);
  });

  it("the pause-time record is NOT overwritten — `frozenAuthority` still describes the row AT PAUSE", async () => {
    // recallHistory is append-only provenance. The fix adds a SECOND baseline rather than mutating the
    // first, so "what did this row look like when we paused it" stays answerable after an edit.
    const { ctx, repo } = realCtx("architect");
    const { id } = await liveRow(repo);
    const depId = await otherRow(repo);
    await router.handle("pause_work", { workId: id, operationId: "op-rt-4", reason: "round trip" }, ctx);

    const atPause = (await repo.getWorkItem(id))!.recallHistory!.at(-1)!;
    const frozenAtPause = JSON.stringify(atPause.frozenAuthority);

    await router.handle("update_work", { workId: id, appendCompletionDependsOn: [depId] }, ctx);
    const afterEdit = (await repo.getWorkItem(id))!.recallHistory!.at(-1)!;

    expect(JSON.stringify(afterEdit.frozenAuthority), "the historical record is untouched").toBe(frozenAtPause);
    expect(afterEdit.sanctionedAuthority, "a NEW sanctioned baseline was recorded").toBeDefined();
    expect(JSON.stringify(afterEdit.sanctionedAuthority), "and it differs — it describes the EDITED row").not.toBe(frozenAtPause);
  });
});
