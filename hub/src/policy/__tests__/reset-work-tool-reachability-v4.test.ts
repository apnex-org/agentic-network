// work-552 — `reset_work` IS REACHABLE FROM A CLIENT, AND THE SUBSTRATE'S REFUSALS SURVIVE THE TRIP.
//
// 🔴 WHY THIS FILE EXISTS, AND IT IS THE WHOLE LESSON OF THE DEFECT IT CLOSES.
// `resetWork` was fully implemented on the substrate, advertised as legal by `getLegalMoves`, present
// in the `WorkItemVerb` union — and had NO INVOCATION PATH. Seven tests exercised it, ALL of them
// calling `repo.resetWork(...)` DIRECTLY. Every one passed. Not one could have failed, because
// A TEST THAT CALLS THE SUBSTRATE METHOD DIRECTLY CANNOT NOTICE THE VERB HAS NO DOOR.
// The verifier found it by trying to USE the thing, which is the instrument the suite lacked.
//
// So these tests enter through `router.handle("reset_work", ...)` — the same dispatch a client uses —
// and run against a REAL `WorkItemRepositorySubstrate`, not a stub. A stub store would re-introduce
// the exact blindness twice over: it cannot prove the tool is registered (the router would still be
// asked for a name that must exist) and it cannot prove the substrate's authority gate fires, because
// the stub IS the authority gate in that setup. THE MOCKED PATH IS THE PATH THAT FAILED TODAY —
// nine stubs of `updateWorkItem` let 2938 green tests sail through a fleet-wide outage this morning.
//
// SCOPE, STATED: this file adds no behaviour. `resetWork`'s semantics, authority and throw text are
// unchanged by work-552 — the node registers a door, and these tests check the door opens onto the
// room that was already there.
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

/** A context whose workItem store is the REAL substrate repository. */
function realCtx(role: string): { ctx: TestPolicyContext; repo: WorkItemRepositorySubstrate } {
  const ctx = createTestContext({ role });
  const substrate = createMemoryStorageSubstrate();
  const repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
  ctx.stores.workItem = repo;
  return { ctx, repo };
}

async function suspendedRowWithLeaseAndEvidence(repo: WorkItemRepositorySubstrate) {
  const w = await repo.createWorkItem({
    type: "task", roleEligibility: ["engineer"],
    evidenceRequirements: [{ id: "art", kind: "freeform", description: "original contract" }] as never,
    createdBy: { role: "architect", agentId: "arch-1" } as never,
  });
  const claimed = await repo.claimWorkItem(w.id, "eng-1", "engineer");
  await repo.startWork(w.id, "eng-1", claimed!.lease!.token);
  await repo.pauseWork(
    { workId: w.id, operationId: `op-${w.id}`, reason: "work-552 fixture" } as never,
    { agentId: "arch-1", role: "architect" },
  );
  return w.id;
}

describe("work-552 — reset_work is registered and reachable through the policy router", () => {
  let router: PolicyRouter;
  beforeEach(() => { router = new PolicyRouter(() => {}); registerWorkItemPolicy(router); });

  it("🔴 THE DEFECT ITSELF: the tool is registered — before work-552 this name did not resolve", () => {
    expect(router.getRegisteredTools()).toContain("reset_work");
    // The description must carry the authority, because `getLegalMoves` advertising `reset` is a
    // PROJECTION and this registration is the AUTHORITY. A caller reading only the tool must learn
    // that a live row rejects; that is the ordering the whole three-tier model rests on.
    const desc = router.getToolRegistration("reset_work")!.description;
    expect(desc).toMatch(/Architect\|Director/);
    expect(desc).toMatch(/SUSPENDED/);
  });

  it("🔴 END TO END: an architect resets a suspended row THROUGH THE TOOL — lease revoked, evidence discarded, row still paused", async () => {
    const { ctx, repo } = realCtx("architect");
    const id = await suspendedRowWithLeaseAndEvidence(repo);
    const before = (await repo.getWorkItem(id))!;
    expect(before.lease, "armed: pause RETAINS the lease, so reset has something to revoke").not.toBeNull();

    const r = await router.handle("reset_work", { workId: id }, ctx);
    expect(r.isError, JSON.stringify(body(r))).toBeFalsy();

    const after = (await repo.getWorkItem(id))!;
    expect(after.lease, "the lease is revoked").toBeNull();
    expect(after.evidence, "submitted evidence is nullified").toEqual([]);
    expect(after.suspended, "reset LEAVES THE ROW PAUSED — a scope change, not a lifecycle move").toBe(true);
    // The response must SAY what it destroyed; a caller cannot otherwise tell a reset from a no-op.
    expect(body(r).revoked).toMatchObject({ lease: true });
  });

  // ── AUTHORITY IS GATED TWICE, AND THE TWO TESTS BELOW SAY WHICH GATE DOES WHAT ──────────────
  // The `[Architect|Director]` prefix on the registration is not documentation: `PolicyRouter`
  // PARSES it into `tool.roles` and enforces RBAC at :152, BEFORE the handler runs. So for an
  // engineer calling the tool, THE SUBSTRATE'S CHECK IS NEVER REACHED — the router refuses first.
  //
  // I am splitting these rather than writing one test that says "the authority refusal fires through
  // the new door", which is what I first wrote and which is FALSE. It would have passed — `isError`
  // is true either way — while attributing the refusal to the wrong mechanism. A test that passes
  // for the wrong reason is how a gate quietly becomes dead code: if the substrate check were
  // deleted tomorrow, that phrasing would still be green.
  //
  // The prefix is chosen deliberately over the `[Any]` its siblings use. `pause_work` CANNOT use it
  // because its authority is ROW-DEPENDENT (ready → creator too; claimed → steward only), so the
  // static gate would be wrong in one direction or the other. Reset's rule is flat and unconditional,
  // so the declarative gate states exactly the real invariant and fails closed earlier.

  it("🔴 THROUGH THE TOOL: an engineer is refused by the ROUTER's RBAC, before the handler runs", async () => {
    const { ctx, repo } = realCtx("engineer");
    const id = await suspendedRowWithLeaseAndEvidence(repo);

    const r = await router.handle("reset_work", { workId: id }, ctx);
    expect(r.isError).toBe(true);
    expect(String(body(r).error)).toMatch(/Authorization denied.*architect\|director.*engineer/);
    expect((await repo.getWorkItem(id))!.lease, "the denied call changed NOTHING").not.toBeNull();
  });

  it("🔴 THE SUBSTRATE GATE IS STILL LIVE, NOT DEAD CODE THE ROUTER MADE UNREACHABLE", async () => {
    // work-552 was forbidden from re-implementing authority in the policy layer, and did not. But the
    // router prefix means no ENGINEER request can reach the substrate check through this tool, and an
    // unreachable guard is a CLAIM, not a control. So the deeper gate is exercised directly: it
    // protects every non-tool caller (today: none; the writer-fence recursion and any future internal
    // caller tomorrow), and this is the test that keeps it honest if the prefix is ever relaxed.
    const { repo } = realCtx("engineer");
    const id = await suspendedRowWithLeaseAndEvidence(repo);
    await expect(repo.resetWork(id, { agentId: "eng-1", role: "engineer" }))
      .rejects.toThrow(/architect or Director/);
    expect((await repo.getWorkItem(id))!.lease, "and it changed nothing either").not.toBeNull();
  });

  it("🔴 THE SUSPENDED GATE STILL FIRES THROUGH THE NEW DOOR — a LIVE row rejects", async () => {
    const { ctx, repo } = realCtx("architect");
    const w = await repo.createWorkItem({
      type: "task", roleEligibility: ["engineer"], evidenceRequirements: [],
      createdBy: { role: "architect", agentId: "arch-1" } as never,
    });
    const claimed = await repo.claimWorkItem(w.id, "eng-1", "engineer");
    await repo.startWork(w.id, "eng-1", claimed!.lease!.token);

    const r = await router.handle("reset_work", { workId: w.id }, ctx);
    expect(r.isError).toBe(true);
    expect(body(r).errorKind).toBe("transition_rejected");
    // The refusal must keep NAMING THE REMEDY — this text is the only place a caller learns the
    // pause-then-reset ordering, and it is load-bearing for the FULL edit tier.
    expect(String(body(r).error)).toMatch(/pause the row first/i);
    expect((await repo.getWorkItem(w.id))!.lease, "the live holder keeps their lease").not.toBeNull();
  });

  it("a missing row surfaces as not_found rather than a throw", async () => {
    const { ctx } = realCtx("architect");
    const r = await router.handle("reset_work", { workId: "work-does-not-exist" }, ctx);
    expect(r.isError).toBe(true);
    expect(body(r).errorKind).toBe("not_found");
  });
});
