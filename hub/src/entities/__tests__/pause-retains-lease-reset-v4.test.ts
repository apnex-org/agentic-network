// idea-640 / nodefix0 — SUSPENSION IS A MANAGEMENT ATTRIBUTE, NOT A LIFECYCLE PHASE.
//
// Director-ratified two-axis model. `status: in_progress` + `suspended: true` reads as "at the
// in_progress stage, not currently executing". THE PAIR IS THE TRUTH; NEITHER FIELD ALONE IS.
//
// WHY THE PIECES ARE ONE CHANGE. The ratified edit model has three tiers — live (nothing), suspended
// with the lease intact (minor edits), suspended with the lease revoked by `reset` (anything). Pause
// used to set `lease: null`, so EVERY paused row was lease-less and THE MIDDLE TIER COULD NOT EXIST.
// Lease retention is what makes the ratified model expressible; it is not, by itself, a bug fix.
//
// 🔴 WHAT MOVING THE PHASE OUT OF `paused` COSTS, AND WHY EVERY GUARD BELOW EXISTS. Before this change,
// suspension protections were FREE: `paused` was absent from LEASE_HELD_PHASES, and `paused !== ready`.
// Once the phase stays put, EVERY ONE OF THOSE PROTECTIONS EVAPORATES SILENTLY. Two were found, one of
// them only by classifying a failure that looked identical to eight stale assertions:
//   the SWEEPER  — a suspended row would be reaped mid-pause (bug-381/384, inside the arc closing them)
//   CLAIMABILITY — a row suspended from `ready` keeps `status: "ready"`, so the ready scan LISTS it and
//                  claimWorkItem ACCEPTS it. SUSPENSION WOULD HAVE BEEN ADVISORY.
//
// SUPERSEDED AND DELETED, NOT RENAMED: unpause's phase restoration from `recallHistory` and its
// lease-gated mirror-zombie guard. Under the attribute model the phase never leaves, so there is
// nothing to restore. Those were a correct workaround for a modelling error; the one-time migration
// reads the same history from its OWN code and dies with it.
//
// NON-CLAIM: this does NOT reduce bearer-token exposure. `get_work` returns `lease.token` in plaintext
// to any reader of any live row. Filed separately, OUT of this arc's bound.
import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import { WorkItemRepositorySubstrate, TransitionRejected } from "../work-item-repository-substrate.js";

const ARCH = { agentId: "arch-1", role: "architect" };
const ENG = { agentId: "eng-1", role: "engineer" };

async function harness() {
  const substrate = createMemoryStorageSubstrate();
  const repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
  return { substrate, repo };
}

async function readyItem(repo: WorkItemRepositorySubstrate) {
  const w = await repo.createWorkItem({
    type: "task", roleEligibility: ["engineer"],
    evidenceRequirements: [{ id: "art", kind: "freeform", description: "an artifact" }] as never,
    createdBy: { role: "architect", agentId: ARCH.agentId } as never,
  });
  return w.id;
}

/** Drive a row to in_progress and return its lease token. */
async function inProgress(repo: WorkItemRepositorySubstrate, id: string) {
  const claimed = await repo.claimWorkItem(id, ENG.agentId, "engineer");
  const token = claimed!.lease!.token;
  await repo.startWork(id, ENG.agentId, token);
  return token;
}

const pause = (repo: WorkItemRepositorySubstrate, id: string) =>
  repo.pauseWork({ workId: id, operationId: `op-${id}-${Math.random()}`, reason: "test pause" } as never, ARCH);
const unpause = (repo: WorkItemRepositorySubstrate, id: string) =>
  repo.unpauseWork({ workId: id } as never, ARCH);

describe("idea-640 — suspension is an attribute; the phase does not move", () => {
  it("🔴 pause from in_progress SETS suspended, LEAVES the phase, and RETAINS lease/holder/token", async () => {
    const { repo } = await harness();
    const id = await readyItem(repo);
    const token = await inProgress(repo, id);

    const paused = (await pause(repo, id))!;
    expect(paused.status, "the LIFECYCLE phase does not move — that is the whole model").toBe("in_progress");
    expect(paused.suspended, "the ATTRIBUTE is what changes").toBe(true);
    expect(paused.lease, "the middle edit tier requires a retained lease").not.toBeNull();
    expect(paused.lease!.holder).toBe(ENG.agentId);
    expect(paused.lease!.token, "token validity is retained, not just the holder").toBe(token);
  });

  it("🔴 unpause CLEARS suspended and still does not move the phase", async () => {
    const { repo } = await harness();
    const id = await readyItem(repo);
    await inProgress(repo, id);
    await pause(repo, id);

    const resumed = (await unpause(repo, id))!;
    expect(resumed.suspended).toBe(false);
    expect(resumed.status, "the holder resumes in place, with no re-claim").toBe("in_progress");
    expect(resumed.lease!.holder).toBe(ENG.agentId);
  });

  it("🔴 NEGATIVE CONTROL: suspending a `ready` row leaves it `ready`, not `in_progress`", async () => {
    // Without this, "the phase does not move" is indistinguishable from "the phase is always in_progress".
    const { repo } = await harness();
    const id = await readyItem(repo);
    const paused = (await pause(repo, id))!;
    expect(paused.status).toBe("ready");
    expect(paused.suspended).toBe(true);
    expect((await unpause(repo, id))!.status).toBe("ready");
  });

  it("🔴 a SUSPENDED row survives the sweeper past its own expiresAt — at the ACT", async () => {
    const { repo, substrate } = await harness();
    const id = await readyItem(repo);
    await inProgress(repo, id);
    await pause(repo, id);
    const stale = (await repo.getWorkItem(id))!;
    await substrate.put("WorkItem", { ...stale, lease: { ...stale.lease!, expiresAt: "2020-01-01T00:00:00.000Z" } } as never);

    // The phase is `in_progress` and the lease IS expired — so ONLY the `suspended` check stops this.
    // Before the model change `paused` being absent from LEASE_HELD_PHASES did it for free.
    expect(await repo.expireLease(id, "2099-01-01T00:00:00.000Z", 5)).toBe("skipped");
    expect((await repo.getWorkItem(id))!.leaseExpiryCount).toBe(0);
  });

  it("🔴 a SUSPENDED row is not even LISTED by the expired-lease scan — at the SCAN", async () => {
    const { repo, substrate } = await harness();
    const id = await readyItem(repo);
    await inProgress(repo, id);
    await pause(repo, id);
    const stale = (await repo.getWorkItem(id))!;
    await substrate.put("WorkItem", { ...stale, lease: { ...stale.lease!, expiresAt: "2020-01-01T00:00:00.000Z" } } as never);

    const expired = await repo.listExpiredLeaseItems("2099-01-01T00:00:00.000Z", 50);
    expect(expired.map((i) => i.id), "defence in depth: the scan must not surface what the act refuses").not.toContain(id);
  });

  it("🔴🔴 A SUSPENDED ROW IS NOT CLAIMABLE — the defect that would have made suspension ADVISORY", async () => {
    // A row suspended from `ready` KEEPS `status: "ready"`. The ready scan filters on that status and
    // claimWorkItem gates on `status !== "ready"` — so without an explicit suspension check the scan
    // LISTS it and the verb ACCEPTS it. An operator suspends a row precisely to stop work starting.
    const { repo } = await harness();
    const id = await readyItem(repo);
    await pause(repo, id);

    const { items } = await repo.listReadyForRole("engineer", 50);
    expect(items.map((i) => i.id), "the SCAN is a projection and must not advertise it").not.toContain(id);
    await expect(repo.claimWorkItem(id, ENG.agentId, "engineer")).rejects.toThrow(/SUSPENDED/);
  });

  it("🔴 SUSPENDED time accrues to the `paused` bucket, not to the lifecycle phase", async () => {
    // Without this a suspended `in_progress` row banks an operator's suspension as the HOLDER'S
    // execution time — destroying the property that let a ten-hour wedge stop counting as work-time.
    const { repo } = await harness();
    const id = await readyItem(repo);
    await inProgress(repo, id);
    await pause(repo, id);
    const before = (await repo.getWorkItem(id))!.stateDurations;
    await unpause(repo, id);
    const after = (await repo.getWorkItem(id))!.stateDurations;

    expect(after.paused, "suspended dwell lands in its own bucket").toBeGreaterThanOrEqual(before.paused);
    expect(after.in_progress, "…and NOT in the phase the row was frozen at").toBe(before.in_progress);
  });
});

describe("idea-640 (B) — reset", () => {
  it("🔴 reset on a SUSPENDED row clears lease + evidence and stays suspended", async () => {
    const { repo } = await harness();
    const id = await readyItem(repo);
    const token = await inProgress(repo, id);
    await repo.completeWork(id, ENG.agentId, token,
      [{ requirementId: "art", kind: "freeform", ref: "x", producedAt: new Date().toISOString() }] as never,
      undefined as never).catch(() => undefined); // binds evidence, blocks on missing friction
    await pause(repo, id);

    // 🔴 PROVE THE FIXTURE ENGAGED BEFORE READING THE NULL. `completeWork` above is deliberately allowed
    // to fail; if evidence never bound, `toEqual([])` below would pass against a row that had none.
    const armed = (await repo.getWorkItem(id))!;
    expect(armed.evidence, "fixture must have bound evidence, or the clear-assertion is vacuous").toHaveLength(1);

    const reset = (await repo.resetWork(id, ARCH))!;
    expect(reset.suspended, "reset is a SCOPE change, not a lifecycle transition").toBe(true);
    expect(reset.lease).toBeNull();
    expect(reset.evidence).toEqual([]);
  });

  it("🔴🔴 reset CLEARS attestations — the counter-control that pays for the evidenceRequirements widening", async () => {
    // decision-11 ⨯ idea-640 §3/§4. decision-11 principle 1 held `evidenceRequirements` IMMUTABLE
    // FOREVER because "a mutable evidence contract guts anti-gameability". idea-640 makes it mutable at
    // the FULL tier. THE RULE CHANGED; THE REASON DID NOT. The attack is bug-383's class via another verb:
    //   claim -> produce evidence that does NOT satisfy the contract -> pause -> reset
    //         -> REWRITE evidenceRequirements to match it -> unpause -> complete
    // Closed by ONE property: the FULL tier is reachable only on an evidence-free row, and getting there
    // COSTS you the artifacts. Attestations clear for the same reason — an attestation is a verifier's
    // statement AGAINST A SPECIFIC CONTRACT, so carrying one across a rewrite leaves a hole exactly the
    // width of what was left behind.
    //
    // ⚠️ IF THIS TEST IS EVER "FIXED" BY MAKING reset PRESERVE THESE, bug-383's CLASS REOPENS. Preserving
    // them looks like a kindness — the same instinct that correctly drove claimedAt preservation all
    // through this arc — and here it is exactly backwards.
    const { repo, substrate } = await harness();
    const id = await readyItem(repo);
    await inProgress(repo, id);
    await pause(repo, id);
    const planted = (await repo.getWorkItem(id))!;
    await substrate.put("WorkItem", {
      ...planted,
      attestations: { art: { verdict: "pass", verifierId: "ver-1", at: "2020-01-01T00:00:00.000Z" } },
      attestationHistory: [{ requirementId: "art", verdict: "pass", verifierId: "ver-1", at: "2020-01-01T00:00:00.000Z" }],
    } as never);
    const before = (await repo.getWorkItem(id))!;
    expect(Object.keys(before.attestations), "fixture must be ARMED or this is vacuous").toHaveLength(1);
    expect(before.attestationHistory).toHaveLength(1);

    const reset = (await repo.resetWork(id, ARCH))!;
    expect(reset.attestations, "FORWARD-SATISFYING artifacts CLEAR").toEqual({});
    expect(reset.attestationHistory, "…including the append-only attestation record").toEqual([]);
    // ADVERSE HISTORICAL FACTS PERSIST — the other half of the same rule.
    expect(reset.recallHistory, "provenance of what happened TO the row survives").toEqual(before.recallHistory);
    expect(reset.executorHistory).toEqual(before.executorHistory);
  });

  it("🔴 reset is REFUSED OUTRIGHT on a failed-sealed row — protected by REFUSAL, not preservation", async () => {
    // FOUND BY AN ARMED FIXTURE, NOT BY DESIGN. An earlier version planted a seal and asserted reset
    // carried it through; it never gets the chance — `assertNotFailedSealed` refuses first. That is
    // STRONGER than preservation and matches the standing position that a failed gate is terminal.
    const { repo, substrate } = await harness();
    const id = await readyItem(repo);
    await inProgress(repo, id);
    await pause(repo, id);
    const planted = (await repo.getWorkItem(id))!;
    await substrate.put("WorkItem", {
      ...planted,
      attestations: { art: { verdict: "fail", verifierId: "ver-1", at: "2020-01-01T00:00:00.000Z" } },
      attestationHistory: [{ requirementId: "art", verdict: "fail", verifierId: "ver-1", at: "2020-01-01T00:00:00.000Z" }],
      failedGateSeal: { sealedAt: "2020-01-01T00:00:00.000Z", requirementId: "art", verifierId: "ver-1" },
    } as never);

    await expect(repo.resetWork(id, ARCH)).rejects.toThrow(/failed_sealed/);
    const after = (await repo.getWorkItem(id))!;
    expect(after.failedGateSeal, "the refused reset touched nothing").not.toBeNull();
    expect(after.lease, "…including the lease it would otherwise have revoked").not.toBeNull();
  });

  it("🔴 reset does NOT replicate pauseWork's `blockedOn: null` data loss", async () => {
    // 🔴 WHY THIS NEEDS A PLANTED FIXTURE. A mutation making reset null `blockedOn` RED NOTHING at
    // first — proven engaged by probe. `pauseWork` ITSELF nulls it, so by the time reset runs there is
    // never a blocker left to destroy: THE REQUIREMENT IS UNOBSERVABLE THROUGH THE NORMAL PATH. The
    // loss happens at PAUSE, is filed as observed-not-investigated, and is NOT this arc's to fix. This
    // pins reset's half so the guarantee is real when pause's half is repaired.
    const { repo, substrate } = await harness();
    const id = await readyItem(repo);
    await inProgress(repo, id);
    await pause(repo, id);
    const planted = (await repo.getWorkItem(id))!;
    await substrate.put("WorkItem", {
      ...planted,
      blockedOn: { blockerKind: "external", blockerIds: ["incident-9"], reason: "waiting on vendor" },
    } as never);
    expect((await repo.getWorkItem(id))!.blockedOn, "fixture must be ARMED or this is vacuous").not.toBeNull();

    const reset = (await repo.resetWork(id, ARCH))!;
    expect(reset.blockedOn, "reset must not repeat a sibling verb's data loss").not.toBeNull();
    expect(reset.blockedOn!.blockerIds).toEqual(["incident-9"]);
    expect(reset.evidence, "…while still doing its own job").toEqual([]);
    expect(reset.lease).toBeNull();
  });

  it("🔴 reset on a NOT-suspended row is REFUSED, with Mechanics/Rationale/Consequence", async () => {
    const { repo } = await harness();
    const id = await readyItem(repo);
    await inProgress(repo, id);
    await expect(repo.resetWork(id, ARCH)).rejects.toThrow(TransitionRejected);
    await expect(repo.resetWork(id, ARCH)).rejects.toThrow(/MECHANICS:[\s\S]*RATIONALE:[\s\S]*CONSEQUENCE:/);
    expect((await repo.getWorkItem(id))!.status, "nothing changed by the refused call").toBe("in_progress");
  });

  it("🔴 reset by a NON-steward is REFUSED — an executor cannot weaken its own bar", async () => {
    const { repo } = await harness();
    const id = await readyItem(repo);
    await inProgress(repo, id);
    await pause(repo, id);
    await expect(repo.resetWork(id, ENG)).rejects.toThrow(/requires architect or Director/);
    expect((await repo.getWorkItem(id))!.lease, "the refused reset revoked nothing").not.toBeNull();
  });
});

describe("🔴 idea-640 — getLegalMoves: THE SURFACE THAT ISSUES THE CALL, NOT ONE THAT ACCEPTS IT", () => {
  // Every other suspension guard in this arc REFUSES a bad call. This one would HAND OUT the bad
  // call: legal_moves is the affordance API agents read to decide what to do next. It held no
  // suspension concept of its own and was protected purely by `paused` occupying the phase slot.
  // The same defect I proved on list_ready_work — the scan is a projection, the verb is the
  // authority — on the surface that DRIVES behaviour rather than merely lists it.
  const movesOf = async (repo: WorkItemRepositorySubstrate, id: string, caller: { agentId: string; role?: string }) =>
    Object.fromEntries((await repo.getLegalMoves(id, caller))!.moves.map((m) => [m.verb, m.legal]));

  it("does not advertise ANY holder verb on a suspended in_progress row — abandon above all", async () => {
    const { repo } = await harness();
    const id = await readyItem(repo);
    await inProgress(repo, id);
    const live = await movesOf(repo, id, ENG);
    expect(live.abandon, "armed fixture: abandon IS legal here while live").toBe(true);
    expect(live.complete || live.block || live.renew || live.release).toBe(true);

    await pause(repo, id);
    const susp = await movesOf(repo, id, ENG);
    // abandon is TERMINAL AND IRREVERSIBLE, and would have been advertised at three phases.
    for (const verb of ["abandon", "complete", "block", "renew", "release", "start", "claim", "resume", "pause"]) {
      expect(susp[verb], `${verb} must not be advertised on a suspended row`).toBe(false);
    }
    expect((await repo.getWorkItem(id))!.status, "the phase is still in_progress — that is WHY this was exposed").toBe("in_progress");
  });

  it("a suspended row ADVERTISES ITS OWN EXITS — under-advertising is a dead end, not a safe default", async () => {
    const { repo } = await harness();
    const id = await readyItem(repo);
    await inProgress(repo, id);
    await pause(repo, id);
    // Gating unpause on `status === "paused"` would be permanently false under the attribute model:
    // the row would advertise NO WAY OUT OF ITS OWN SUSPENSION. Both directions, or the fix is half.
    const arch = await movesOf(repo, id, ARCH);
    expect(arch.unpause, "unpause must stay legal").toBe(true);
    expect(arch.reset, "reset is the arc's new verb and was absent from this surface entirely").toBe(true);
    // ...and the exits still respect their own authority: an engineer gets neither.
    const eng = await movesOf(repo, id, ENG);
    expect(eng.unpause).toBe(false);
    expect(eng.reset).toBe(false);
  });

  it("a row suspended from READY stops advertising claim (the claimability hole, at the affordance)", async () => {
    const { repo } = await harness();
    const id = await readyItem(repo);
    expect((await movesOf(repo, id, ENG)).claim, "armed: claimable before suspension").toBe(true);
    await pause(repo, id);
    expect((await repo.getWorkItem(id))!.status, "phase stays ready — the hole").toBe("ready");
    expect((await movesOf(repo, id, ENG)).claim, "but claim is no longer advertised").toBe(false);
  });
});
