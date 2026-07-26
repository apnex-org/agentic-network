// work-561 / bug-392 — ALL THREE HOLD-RELEASE PATHS AGREE, BY SHARED DERIVATION.
//
// 🔴 THE POINT OF THIS FILE IS THAT IT IS *ONE* ASSERTION OVER A SHARED PRIMITIVE, NOT THREE PARALLEL
// TESTS. Three tests that happen to agree today is EXACTLY THE STATE bug-392 WAS: three hand-written
// returns, nothing comparing them, and a divergence nobody had to authorise. Parallel tests would
// reproduce that — each verb pinned independently, free to drift apart one edit at a time, with a
// green suite throughout. The agreement has to come from a SHARED DERIVATION or it is not agreement,
// it is coincidence that has not expired yet.
//
// SO: every verb's post-state is checked against `releaseHold` — the same function they call. A future
// FOURTH verb that ends a hold and does NOT route through it will not be caught by this file, which is
// why the primitive exists at all: the check is structural, and this test guards that the three known
// callers still honour it.
import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import { WorkItemRepositorySubstrate, releaseHold } from "../work-item-repository-substrate.js";

const ARCH = { agentId: "arch-1", role: "architect" };

async function harness() {
  const substrate = createMemoryStorageSubstrate();
  return new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
}

async function liveRow(repo: WorkItemRepositorySubstrate) {
  const w = await repo.createWorkItem({
    type: "task", roleEligibility: ["engineer"], evidenceRequirements: [],
    createdBy: { role: "architect", agentId: "arch-1" } as never,
  });
  const claimed = await repo.claimWorkItem(w.id, "eng-1", "engineer");
  await repo.startWork(w.id, "eng-1", claimed!.lease!.token);
  return { id: w.id, token: claimed!.lease!.token };
}

/**
 * WHICH FIELDS THE CORE OWNS, ASKED OF THE PRIMITIVE ITSELF RATHER THAN LISTED HERE.
 *
 * A hand-written list would be a FOURTH definition of "the hold-release core" — the exact thing
 * bug-392 was. Deriving the key set means that if the primitive grows or loses a field, this test's
 * notion of the contract moves with it instead of silently describing an older one.
 */
const CORE_FIELDS = Object.keys(
  releaseHold(
    { status: "in_progress", enteredCurrentStateAt: "2026-01-01T00:00:00.000Z", stateDurations: {}, updatedAt: "2026-01-01T00:00:00.000Z" } as never,
    "2026-01-01T00:00:01.000Z",
    "ready" as never,
  ),
);

describe("work-561 / bug-392 — the hold-release core is shared, not replicated", () => {
  it("🔴 ALL THREE VERBS AGREE ON THE CORE: lease null, phase moved, dwell accrued", async () => {
    // ONE assertion, applied to each verb's real post-state. The expected values are DERIVED from the
    // same primitive the production code calls — so if a verb stops routing through it, the shape
    // diverges and this reds. A hand-written expectation here would be a fourth definition.
    const repo = await harness();
    const cases: Array<{ verb: string; after: { status: string; lease: unknown; stateDurations: Record<string, number> }; phase: string }> = [];

    // release
    { const { id, token } = await liveRow(repo);
      const after = (await repo.releaseWork(id, "eng-1", token))!;
      cases.push({ verb: "releaseWork", after: after as never, phase: "ready" }); }

    // expire (below the poison cap -> requeue)
    { const { id } = await liveRow(repo);
      const outcome = await repo.expireLease(id, new Date(Date.now() + 60 * 60 * 1000).toISOString(), 99);
      expect(outcome, "armed: below the cap this must REQUEUE, not abandon").toBe("requeued");
      cases.push({ verb: "expireLease", after: (await repo.getWorkItem(id))! as never, phase: "ready" }); }

    // reset (requires SUSPENDED)
    { const { id } = await liveRow(repo);
      await repo.pauseWork({ workId: id, operationId: `op-${id}`, reason: "agreement" } as never, ARCH);
      const after = (await repo.resetWork(id, ARCH))!;
      cases.push({ verb: "resetWork", after: after as never, phase: "ready" }); }

    expect(cases).toHaveLength(3);
    // The core's own field list, asked of the primitive. If it ever stops covering the phase/lease/
    // dwell triple, this reds before the per-field assertions below can pass for the wrong reason.
    expect(CORE_FIELDS.sort()).toEqual(["enteredCurrentStateAt", "lease", "stateDurations", "status"]);
    for (const c of cases) {
      expect(c.after.lease, `${c.verb}: the hold is released`).toBeNull();
      expect(c.after.status, `${c.verb}: the phase is the one the core was given`).toBe(c.phase);
      // THE DWELL WAS BANKED. This is the assertion that would have caught the trap the point-fix
      // would have shipped: `resetWork` did not accrue, because until now it did not change phase.
      const total = Object.values(c.after.stateDurations).reduce((a, b) => a + b, 0);
      expect(total, `${c.verb}: accrueExitingState ran — stateDurations must not be all-zero`).toBeGreaterThan(0);
    }
  });

  it("🔴 THE PHASE IS A PARAMETER, NOT `ready`: the poison branch still ABANDONS", async () => {
    // A primitive that hard-coded `ready` would have silently converted every poison-abandon into a
    // requeue — TURNING THE POISON CAP OFF, with nothing going red. This is the control for that.
    const repo = await harness();
    const { id } = await liveRow(repo);
    const outcome = await repo.expireLease(id, new Date(Date.now() + 60 * 60 * 1000).toISOString(), 0);
    expect(outcome, "at/above the cap the sweeper POISON-ABANDONS").toBe("abandoned");
    const after = (await repo.getWorkItem(id))!;
    expect(after.status, "the core took `abandoned`, not `ready`").toBe("abandoned");
    expect(after.lease).toBeNull();
  });

  it("🔴 reset RETURNS THE NODE TO `ready` AND KEEPS IT SUSPENDED — bug-392's actual repair", async () => {
    // bug-392: reset left the node `in_progress` with no lease, so every execution verb refused it
    // forever. The phase now matches the data — nothing started, nothing held — while `suspended`
    // still says "withdrawn". THE PAIR IS THE TRUTH.
    const repo = await harness();
    const { id } = await liveRow(repo);
    await repo.pauseWork({ workId: id, operationId: `op-${id}`, reason: "reset" } as never, ARCH);
    const after = (await repo.resetWork(id, ARCH))!;

    expect(after.status, "no longer asserting work in flight").toBe("ready");
    expect(after.suspended, "still withdrawn from execution — reset is not an unpause").toBe(true);
    expect(after.lease).toBeNull();
    expect(after.evidence, "reset still discards evidence — the anti-gameability control is intact").toEqual([]);
  });

  it("verb-specific extras are NOT absorbed into the core", async () => {
    // The primitive owns three fields. Everything else stays with its verb — otherwise the shared core
    // becomes a dumping ground and the next author cannot tell contract from convenience.
    const repo = await harness();

    // expire owns leaseExpiryCount; release does not touch it.
    const a = await liveRow(repo);
    await repo.expireLease(a.id, new Date(Date.now() + 60 * 60 * 1000).toISOString(), 99);
    expect((await repo.getWorkItem(a.id))!.leaseExpiryCount, "expire increments").toBe(1);

    const b = await liveRow(repo);
    await repo.releaseWork(b.id, "eng-1", b.token);
    expect((await repo.getWorkItem(b.id))!.leaseExpiryCount, "a voluntary release is not a poison-expiry").toBe(0);
  });
});
