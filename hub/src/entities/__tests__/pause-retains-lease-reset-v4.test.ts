// idea-640 (A)+(B) — PAUSE RETAINS THE LEASE; UNPAUSE RESTORES THE PHASE; `reset` REVOKES DELIBERATELY.
//
// WHY THE THREE ARE ONE CHANGE. The Director's ratified edit model has three tiers:
//   live                   -> no edits
//   paused + LEASE INTACT  -> minor edits
//   paused + lease revoked -> anything, including evidenceRequirements
// Pause used to set `lease: null`, so EVERY paused row was lease-less and THE MIDDLE TIER COULD NOT
// EXIST. Retaining the lease is what makes the ratified model expressible.
//
// TWO MIRROR-IMAGE ZOMBIE STATES SIT ON EITHER SIDE OF THIS CHANGE, and each is asserted below:
//   `ready` + LIVE lease  -> pauseWork itself calls this corrupt; a held row would sit in the CLAIMABLE
//                            POOL, so a second agent could claim a row another agent holds.
//   lease-held + NO lease -> unclaimable (claim requires `ready`) AND unreapable (expireLease requires
//                            `!!w.lease`). A PERMANENT ZOMBIE nothing can move.
// The second only becomes reachable once BOTH lease-retention and phase-restoration land, via
// pause -> reset -> unpause. It is why the restore target is gated on the LEASE, not on a reset flag.
//
// NON-CLAIM: this does NOT reduce bearer-token exposure. `get_work` returns `lease.token` in plaintext
// to any caller who can read the row, so every claimed/in_progress row already exposes it. Filed
// separately, OUT of this arc's bound.
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

describe("idea-640 (A) — pause retains the lease, unpause restores the phase", () => {
  it("🔴 pause from in_progress RETAINS lease, holder and token", async () => {
    const { repo } = await harness();
    const id = await readyItem(repo);
    const token = await inProgress(repo, id);

    const paused = (await pause(repo, id))!;
    expect(paused.status).toBe("paused");
    expect(paused.lease, "the middle tier requires a retained lease").not.toBeNull();
    expect(paused.lease!.holder).toBe(ENG.agentId);
    expect(paused.lease!.token, "token validity is retained, not just the holder").toBe(token);
  });

  it("🔴 unpause RESTORES in_progress — not `ready` — so the holder resumes without re-claiming", async () => {
    const { repo } = await harness();
    const id = await readyItem(repo);
    await inProgress(repo, id);
    await pause(repo, id);

    const resumed = (await unpause(repo, id))!;
    expect(resumed.status, "restores the PRE-PAUSE phase from recallHistory.at(-1)").toBe("in_progress");
    expect(resumed.lease!.holder).toBe(ENG.agentId);
  });

  it("🔴 NEGATIVE CONTROL: a row paused from `ready` still restores to `ready`", async () => {
    // Without this, "restore the recorded phase" is indistinguishable from "always restore in_progress".
    const { repo } = await harness();
    const id = await readyItem(repo);
    await pause(repo, id);
    expect((await unpause(repo, id))!.status).toBe("ready");
  });

  it("🔴 unpause REFRESHES expiresAt from now — a stale one would be reaped on the next tick", async () => {
    // bug-384's M4 trap on a different verb: a retained lease's expiresAt is frozen at its pre-pause
    // value. Restored verbatim into a LEASE_HELD phase, the row re-enters the sweeper's scan ALREADY
    // EXPIRED. claimedAt is deliberately NOT refreshed — preserving it is what keeps evidence produced
    // before the pause admissible.
    const { repo, substrate } = await harness();
    const id = await readyItem(repo);
    await inProgress(repo, id);
    await pause(repo, id);

    // force the retained lease stale, exactly as a long pause would
    const stale = (await repo.getWorkItem(id))!;
    const claimedAt = stale.lease!.claimedAt;
    await substrate.put("WorkItem", { ...stale, lease: { ...stale.lease!, expiresAt: "2020-01-01T00:00:00.000Z" } } as never);

    const resumed = (await unpause(repo, id))!;
    expect(resumed.status).toBe("in_progress");
    expect(resumed.lease!.expiresAt > new Date().toISOString(), "a resumed lease must not be already-expired").toBe(true);
    expect(resumed.lease!.claimedAt, "claimedAt is PRESERVED — it is the evidence-admissibility baseline").toBe(claimedAt);

    // and the sweeper must not take it
    expect(await repo.expireLease(id, "2099-01-01T00:00:00.000Z", 5)).not.toBe("skipped"); // sanity: it IS sweepable when expired
  });

  it("🔴 a PAUSED row survives the sweeper past its own expiresAt", async () => {
    const { repo, substrate } = await harness();
    const id = await readyItem(repo);
    await inProgress(repo, id);
    await pause(repo, id);
    const stale = (await repo.getWorkItem(id))!;
    await substrate.put("WorkItem", { ...stale, lease: { ...stale.lease!, expiresAt: "2020-01-01T00:00:00.000Z" } } as never);

    // `paused` is absent from LEASE_HELD_PHASES, so both the scan and expireLease skip it. This is the
    // STATUS doing the work, not the (now retained) lease.
    expect(await repo.expireLease(id, "2099-01-01T00:00:00.000Z", 5)).toBe("skipped");
    expect((await repo.getWorkItem(id))!.status).toBe("paused");
    expect((await repo.getWorkItem(id))!.leaseExpiryCount).toBe(0);
  });
});

describe("idea-640 (B) — reset", () => {
  it("🔴 reset on a PAUSED row clears lease + evidence and STAYS paused", async () => {
    const { repo } = await harness();
    const id = await readyItem(repo);
    const token = await inProgress(repo, id);
    await repo.completeWork(id, ENG.agentId, token,
      [{ requirementId: "art", kind: "freeform", ref: "x", producedAt: new Date().toISOString() }] as never,
      undefined as never).catch(() => undefined); // binds evidence, blocks on missing friction
    await pause(repo, id);

    // 🔴 PROVE THE FIXTURE ENGAGED BEFORE READING THE NULL. Without this, `evidence` might simply never
    // have bound — completeWork above is deliberately allowed to fail — and `toEqual([])` below would
    // pass against a row that never had evidence to clear. An unengaged fixture and a working `reset`
    // are indistinguishable from the assertion alone.
    const armed = (await repo.getWorkItem(id))!;
    expect(armed.evidence, "fixture must actually have bound evidence, or the clear-assertion is vacuous").toHaveLength(1);

    const reset = (await repo.resetWork(id, ARCH))!;
    expect(reset.status, "reset is a SCOPE change, not a lifecycle transition").toBe("paused");
    expect(reset.lease).toBeNull();
    expect(reset.evidence).toEqual([]);
  });

  it("🔴 reset PRESERVES seal history, attestations and provenance", async () => {
    const { repo } = await harness();
    const id = await readyItem(repo);
    await inProgress(repo, id);
    await pause(repo, id);
    const before = (await repo.getWorkItem(id))!;

    const reset = (await repo.resetWork(id, ARCH))!;
    expect(reset.failedGateSeal, "A FAILED GATE IS NEVER ERASED").toEqual(before.failedGateSeal);
    expect(reset.attestations).toEqual(before.attestations);
    expect(reset.attestationHistory).toEqual(before.attestationHistory);
    expect(reset.recallHistory, "append-only provenance survives a scope change").toEqual(before.recallHistory);
    expect(reset.executorHistory).toEqual(before.executorHistory);
  });

  it("🔴 reset on a NON-paused row is REFUSED, with Mechanics/Rationale/Consequence", async () => {
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

  it("🔴🔴 THE MIRROR ZOMBIE: pause → reset → unpause restores `ready`, NOT a lease-held phase", async () => {
    // The state this prevents — `in_progress` with `lease: null` — is unclaimable (claim requires
    // `ready`) AND unreapable (expireLease requires `!!w.lease`). Nothing in the system could move it
    // again. It is reachable ONLY once lease-retention and phase-restoration both land, which is why
    // the restore target is gated on the lease rather than on a reset-specific marker.
    const { repo } = await harness();
    const id = await readyItem(repo);
    await inProgress(repo, id);
    await pause(repo, id);
    await repo.resetWork(id, ARCH);

    const resumed = (await unpause(repo, id))!;
    expect(resumed.status, "a lease-less row must NOT re-enter a lease-held phase").toBe("ready");
    expect(resumed.lease).toBeNull();
    // and it is genuinely claimable again — the row is alive, not a zombie
    const reclaimed = await repo.claimWorkItem(id, ENG.agentId, "engineer");
    expect(reclaimed!.status).toBe("claimed");
  });
});
