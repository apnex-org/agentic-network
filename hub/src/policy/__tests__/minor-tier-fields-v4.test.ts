// work-554 — THE MINOR TIER: runbook / payload / roleEligibility EDITABLE ON A SUSPENDED NODE.
//
// 🔴 WHY THIS FILE EXISTS. Q3 SPECIFIED this widening, the implementation AGREED WITH IT IN WRITING at
// :1069, and then twenty-five lines below did the opposite — three `!preClaim` guards that never
// consult `suspendedForEdit`. THE TIER GATE WAS BUILT; THE WIDENING THE GATE EXISTS TO ENABLE WAS NOT.
// The suite stayed green throughout, because nothing asserted the tier THROUGH THE POLICY LAYER.
//
// ROOT CAUSE, and it is the thing Q3 said it was avoiding: Q3's operand was the POLICY layer's
// `ALLOWED_SET`, and its stated rationale was that a second list "would create two overlapping
// definitions of safe-to-change". THE SECOND DEFINITION ALREADY EXISTED, ONE LAYER DOWN, on these
// exact fields.
//   AN ALLOW-LIST AT ONE LAYER IS NOT A CAPABILITY CLAIM ABOUT THE LAYER BENEATH IT.
// `ALLOWED_SET` says which keys `update_work` may CARRY. It says nothing about what the substrate DOES
// with them. So these tests enter through `router.handle` against a REAL repository — a stub store
// would re-assert the policy layer's opinion and learn nothing about the substrate's.
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

/** A LIVE node: claimed, in_progress, lease held. */
async function liveRow(repo: WorkItemRepositorySubstrate) {
  const w = await repo.createWorkItem({
    type: "task", roleEligibility: ["engineer"], evidenceRequirements: [],
    createdBy: { role: "architect", agentId: "arch-1" } as never,
  });
  const claimed = await repo.claimWorkItem(w.id, "eng-1", "engineer");
  await repo.startWork(w.id, "eng-1", claimed!.lease!.token);
  return w.id;
}

/** THE MINOR-TIER STATE: suspended, lease RETAINED. */
async function suspendedLeased(repo: WorkItemRepositorySubstrate, ctx: TestPolicyContext, router: PolicyRouter) {
  const id = await liveRow(repo);
  await router.handle("pause_work", { workId: id, operationId: `op-${id}`, reason: "minor tier" }, ctx);
  const row = (await repo.getWorkItem(id))!;
  expect(row.suspended, "armed: suspended").toBe(true);
  expect(row.lease, "armed: THE LEASE IS RETAINED — this is MINOR, not FULL").not.toBeNull();
  expect(row.status, "armed: the phase never leaves, which is why `preClaim` was false").toBe("in_progress");
  return id;
}

// `expected` is stated LITERALLY rather than derived from `value`. A derived expectation can agree
// with itself while the write never happened; a literal one cannot.
const CASES = [
  { field: "runbook", value: "rewritten runbook", expected: "rewritten runbook", read: (w: { runbook?: string }) => w.runbook },
  { field: "payload", value: { title: "rewritten" }, expected: "rewritten", read: (w: { payload?: unknown }) => (w.payload as { title?: string })?.title },
  { field: "roleEligibility", value: ["engineer", "verifier"], expected: "engineer,verifier", read: (w: { roleEligibility: string[] }) => w.roleEligibility.join(",") },
] as const;

describe("work-554 — the MINOR tier per-field matrix, through the policy layer", () => {
  let router: PolicyRouter;
  beforeEach(() => { router = new PolicyRouter(() => {}); registerWorkItemPolicy(router); });

  for (const c of CASES) {
    it(`🔴 ${c.field}: REFUSED on a LIVE node`, async () => {
      const { ctx, repo } = realCtx("architect");
      const id = await liveRow(repo);
      const r = await router.handle("update_work", { workId: id, set: { [c.field]: c.value } }, ctx);
      expect(r.isError, `${c.field} must stay frozen on a live claimant`).toBe(true);
    });

    it(`🔴 ${c.field}: ACCEPTED on a SUSPENDED + LEASED node — the tier idea-640 promised`, async () => {
      const { ctx, repo } = realCtx("architect");
      const id = await suspendedLeased(repo, ctx, router);
      const r = await router.handle("update_work", { workId: id, set: { [c.field]: c.value } }, ctx);
      expect(r.isError, JSON.stringify(body(r))).toBeFalsy();

      const after = (await repo.getWorkItem(id))!;
      expect(c.read(after as never), "the edit actually landed").toBe(c.expected);
      expect(after.lease, "the lease is STILL HELD — MINOR does not revoke it").not.toBeNull();
    });
  }

  it("🔴 THE REFUSAL NO LONGER TEACHES A REMEDY THAT FAILS", async () => {
    // The live-row message said "CONSEQUENCE: pause the row, then edit." Following it produced a SECOND
    // refusal — A TRAP WITH AN INSTRUCTION MANUAL POINTING INTO IT. This asserts the whole instruction
    // now works end to end, which is the only honest way to test a remedy: FOLLOW IT.
    const { ctx, repo } = realCtx("architect");
    const id = await liveRow(repo);

    const refused = await router.handle("update_work", { workId: id, set: { runbook: "x" } }, ctx);
    expect(refused.isError).toBe(true);
    expect(String(body(refused).error), "the message must still name the remedy").toMatch(/pause the (row|node), then edit/i);

    // Now DO what it says.
    await router.handle("pause_work", { workId: id, operationId: "op-remedy", reason: "following the remedy" }, ctx);
    const retried = await router.handle("update_work", { workId: id, set: { runbook: "x" } }, ctx);
    expect(retried.isError, "the remedy the error teaches must WORK").toBeFalsy();
  });

  it("the tier does not leak downward: `priority` is still editable on a LIVE node", async () => {
    // decision-11 principle 3's carve-out. Explicitly NOT touched by this node, and asserted so that a
    // future narrowing of these guards cannot quietly take `priority` with it — the :1069 comment
    // claimed `priority` HAD been narrowed to MINOR, and that claim was false.
    const { ctx, repo } = realCtx("architect");
    const id = await liveRow(repo);
    const r = await router.handle("update_work", { workId: id, set: { priority: "critical" } }, ctx);
    expect(r.isError, JSON.stringify(body(r))).toBeFalsy();
    expect((await repo.getWorkItem(id))!.priority).toBe("critical");
  });

  it("edges still append on a suspended node — the widening did not disturb what already worked", async () => {
    const { ctx, repo } = realCtx("architect");
    const id = await suspendedLeased(repo, ctx, router);
    const dep = await liveRow(repo);
    const r = await router.handle("update_work", { workId: id, appendCompletionDependsOn: [dep] }, ctx);
    expect(r.isError, JSON.stringify(body(r))).toBeFalsy();
    expect((await repo.getWorkItem(id))!.completionDependsOn).toContain(dep);
  });
});
