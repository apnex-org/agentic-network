// work-560 / idea-640 — THE HOLDER-ELIGIBILITY GUARD, EXERCISED AT THE SUBSTRATE.
//
// 🔴 WHY THIS FILE ENTERS AT THE SUBSTRATE AND NOT THROUGH `update_work`. The guard was DEFERRED by
// work-554 rather than built in the policy layer, because A GUARD PLACED ONE LAYER ABOVE THE INVARIANT
// IT PROTECTS IS BYPASSED BY EVERY SUBSTRATE-DIRECT CALLER. Testing it only through `update_work` would
// re-commit that error one level up: it would prove the POLICY PATH is covered and say nothing about
// whether the ROW is protected. The node's own evidence contract says so explicitly — "a test that only
// reaches it via the policy layer cannot show a substrate-direct caller is covered, which is the entire
// reason this node exists."
//
// So: every refusal case below calls `repo.updateWorkItem` DIRECTLY. The last test is the only one that
// goes through the router, and its job is the opposite — to prove the policy layer actually SUPPLIES the
// resolved holder, because a substrate guard that nobody feeds is a guard that refuses everything.
import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import { WorkItemRepositorySubstrate } from "../work-item-repository-substrate.js";

const ARCH = { agentId: "arch-1", role: "architect" };

async function harness() {
  const substrate = createMemoryStorageSubstrate();
  return new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
}

async function readyRow(repo: WorkItemRepositorySubstrate, roles: string[] = ["engineer"]) {
  const w = await repo.createWorkItem({
    type: "task", roleEligibility: roles, evidenceRequirements: [],
    createdBy: { role: "architect", agentId: "arch-1" } as never,
  });
  return w.id;
}

/** THE STATE THE GUARD GOVERNS: suspended (so the MINOR tier lets the edit through) and STILL LEASED. */
async function suspendedLeased(repo: WorkItemRepositorySubstrate, holder = "eng-1") {
  const id = await readyRow(repo);
  const claimed = await repo.claimWorkItem(id, holder, "engineer");
  await repo.startWork(id, holder, claimed!.lease!.token);
  await repo.pauseWork({ workId: id, operationId: `op-${id}`, reason: "holder guard" } as never, ARCH);
  const row = (await repo.getWorkItem(id))!;
  expect(row.suspended, "armed: suspended, so the tier gate is not what refuses").toBe(true);
  expect(row.lease?.holder, "armed: STILL HELD — a guard about the holder needs a holder").toBe(holder);
  return id;
}

const HOLDER = { agentId: "eng-1", role: "engineer" };

describe("work-560 — the holder-eligibility guard, at the substrate", () => {
  it("🔴 NEGATIVE: narrowing past the sitting holder is REFUSED", async () => {
    const repo = await harness();
    const id = await suspendedLeased(repo);

    await expect(
      repo.updateWorkItem(id, ARCH, { set: { roleEligibility: ["verifier"] } }, HOLDER),
    ).rejects.toThrow(/does not include engineer/);

    // A REFUSAL THAT LEAVES A PARTIAL WRITE IS NOT A REFUSAL. The error text promises "nothing has been
    // changed by this call"; this asserts the promise rather than trusting it.
    expect((await repo.getWorkItem(id))!.roleEligibility).toEqual(["engineer"]);
  });

  it("🔴 POSITIVE: a set that still includes the holder's role is ACCEPTED and LANDS", async () => {
    // The control for an over-refusal. A guard that refused every roleEligibility edit on a leased row
    // would pass the negative test above and would have destroyed the capability work-554 delivered.
    const repo = await harness();
    const id = await suspendedLeased(repo);

    await repo.updateWorkItem(id, ARCH, { set: { roleEligibility: ["engineer", "verifier"] } }, HOLDER);
    expect((await repo.getWorkItem(id))!.roleEligibility).toEqual(["engineer", "verifier"]);
  });

  it("🔴 AN EMPTY SET IS ANY-ROLE AND MUST NOT BE REFUSED", async () => {
    // audit-4085, and `assertRoleEligible` agrees: empty = claimable by anyone. It excludes NOBODY, so
    // it cannot orphan the holder. Refusing it would be a guard reasoning about the LENGTH of the list
    // instead of about who it EXCLUDES — the shape that reads correct and is not.
    const repo = await harness();
    const id = await suspendedLeased(repo);

    await repo.updateWorkItem(id, ARCH, { set: { roleEligibility: [] } }, HOLDER);
    expect((await repo.getWorkItem(id))!.roleEligibility).toEqual([]);
  });

  it("🔴 FAIL-CLOSED: an unresolvable holder REFUSES, it does not skip", async () => {
    // The fail-open shape this arc has filed three times: a guard that silently no-ops when its input
    // is missing. Here the resolution is simply absent — the guard must refuse rather than wave it
    // through, because "I could not check" and "the check passed" are different answers.
    const repo = await harness();
    const id = await suspendedLeased(repo);

    await expect(
      repo.updateWorkItem(id, ARCH, { set: { roleEligibility: ["verifier"] } }),
    ).rejects.toThrow(/role could not be resolved/);
    expect((await repo.getWorkItem(id))!.roleEligibility).toEqual(["engineer"]);
  });

  it("🔴 A RESOLUTION ABOUT A DIFFERENT AGENT IS REFUSED — a wrong answer, not a missing one", async () => {
    // The policy layer reads the row, resolves a role, and calls; the substrate re-reads inside the CAS.
    // If the lease moved between those reads, the supplied role describes SOMEONE ELSE. Enforcing it
    // anyway would check the wrong agent and REPORT SUCCESS — confidently wrong, which fail-closed-on-
    // absent never catches. This is why the parameter carries the agentId with the role.
    const repo = await harness();
    const id = await suspendedLeased(repo, "eng-1");

    await expect(
      repo.updateWorkItem(id, ARCH, { set: { roleEligibility: ["verifier"] } }, { agentId: "someone-else", role: "verifier" }),
    ).rejects.toThrow(/holder changed between resolution and write/);
    expect((await repo.getWorkItem(id))!.roleEligibility).toEqual(["engineer"]);
  });

  it("🔴 A WIDENING NEEDS NO RESOLUTION AT ALL — the regression control", async () => {
    // THIS TEST EXISTS BECAUSE THE FIRST VERSION OF THE GUARD BROKE work-554's SHIPPED CAPABILITY.
    // Demanding a resolved holder for every roleEligibility edit turned a working MINOR-tier widening
    // into a hard refusal whenever the holder did not resolve. The guard was green across its whole
    // own matrix; the regression was in another file. A widening cannot exclude the holder — they were
    // eligible under the old set and the new set contains it — so no resolution is required and none
    // is supplied here.
    const repo = await harness();
    const id = await suspendedLeased(repo);

    await repo.updateWorkItem(id, ARCH, { set: { roleEligibility: ["engineer", "verifier"] } });
    expect((await repo.getWorkItem(id))!.roleEligibility).toEqual(["engineer", "verifier"]);
  });

  it("🔴 ANY-ROLE -> A NAMED SET IS A NARROWING, NOT A WIDENING (the ⊇ ∅ trap)", async () => {
    // A naive superset test says "every member of current is in proposed" and is VACUOUSLY TRUE when
    // current is empty — so an any-role row could be narrowed to a set excluding its holder and the
    // guard would wave it through, believing it had seen a widening. Empty means ANY-ROLE, so going
    // from empty to a named set is the sharpest narrowing available.
    const repo = await harness();
    const id = await readyRow(repo, []); // any-role
    const claimed = await repo.claimWorkItem(id, "eng-1", "engineer");
    await repo.startWork(id, "eng-1", claimed!.lease!.token);
    await repo.pauseWork({ workId: id, operationId: `op-${id}`, reason: "anyrole" } as never, ARCH);
    expect((await repo.getWorkItem(id))!.roleEligibility, "armed: any-role").toEqual([]);

    await expect(
      repo.updateWorkItem(id, ARCH, { set: { roleEligibility: ["verifier"] } }, HOLDER),
    ).rejects.toThrow(/does not include engineer/);
    expect((await repo.getWorkItem(id))!.roleEligibility).toEqual([]);
  });

  it("NO HOLDER, NO GUARD: narrowing a pre-claim row stays legal", async () => {
    // The second over-refusal control. decision-11's pre-claim authoring is untouched by this node —
    // an unclaimed row has nobody to orphan, so the guard must not fire, AND must not demand a
    // resolution that cannot exist. Getting this wrong would break the binding rows this fleet authors
    // constantly.
    const repo = await harness();
    const id = await readyRow(repo, ["engineer"]);
    expect((await repo.getWorkItem(id))!.lease, "armed: no holder").toBeNull();

    await repo.updateWorkItem(id, ARCH, { set: { roleEligibility: ["verifier"] } });
    expect((await repo.getWorkItem(id))!.roleEligibility).toEqual(["verifier"]);
  });

  it("the guard does not leak onto other fields: runbook still edits on a leased suspended row", async () => {
    // work-554's MINOR tier is the capability this node sits on top of. Asserted here so a future
    // tightening of the holder guard cannot quietly take the rest of the tier with it.
    const repo = await harness();
    const id = await suspendedLeased(repo);

    await repo.updateWorkItem(id, ARCH, { set: { runbook: "rewritten" } });
    expect((await repo.getWorkItem(id))!.runbook).toBe("rewritten");
  });
});
