// bug-384 — EVIDENCE PRODUCED UNDER A PRIOR LEASE OF THE SAME HOLDER.
//
// FIXTURE TIMESTAMPS ARE DELIBERATELY IN 2020. The repository uses the REAL system clock for
// claimWorkItem, so a fixture stamped near the actual run time makes the whole suite
// TIME-DEPENDENT: the negative controls pass or fail depending on the minute you run them. Caught
// because both controls went green when they had to be red. Keep these far in the past.
//
// bug-222 already ruled that a re-claim must not invalidate a holder's legitimate evidence. But it
// keyed on evidence having been BOUND, and evidence never binds if completion keeps being refused:
// A RELIEF VALVE THAT ONLY OPENS FOR EVIDENCE THAT ALREADY GOT THROUGH IS CLOSED TO EXACTLY THE
// CASE THAT NEEDS IT. Two live rows sat blocked on real, correctly-timestamped artifacts for that
// reason — a merged PR and a merge commit, neither of which can be re-produced to fit a window.
//
// Every case drives PRODUCTION code through the real WorkItemRepositorySubstrate. Nothing here
// re-implements the predicate.
import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import type { WorkItem } from "../work-item.js";
import { WorkItemRepositorySubstrate } from "../work-item-repository-substrate.js";

const T0 = "2020-01-01T00:00:00.000Z"; // node created — DELIBERATELY far in the past
const T1 = "2020-01-01T00:10:00.000Z"; // FIRST lease claimed
const T2 = "2020-01-01T00:20:00.000Z"; // artifact produced under the first lease
const T3 = "2020-01-01T00:30:00.000Z"; // first lease ends (pause or expiry)
const ME = "agent-greg";
const OTHER = "agent-someone-else";

function harness() {
  const substrate = createMemoryStorageSubstrate();
  return { substrate, repo: new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate)) };
}

/** A row whose FIRST lease (holder `leaseHolder`) is recorded in recallHistory and then gone. */
function rowWithPriorLease(id: string, leaseHolder: string, over: Partial<WorkItem> = {}): WorkItem {
  return {
    id, type: "task", priority: "normal", roleEligibility: ["engineer"],
    dependsOn: [], completionDependsOn: [], references: [], targetRef: null,
    evidenceRequirements: [{ id: "pr", kind: "pr", description: "the merged PR" }] as never,
    status: "ready", lease: null, evidence: [], frictionReflections: [], blockedOn: null,
    leaseExpiryCount: 1, enteredCurrentStateAt: T3,
    stateDurations: { ready: 0, claimed: 0, in_progress: 0, blocked: 0, paused: 0, review: 0 },
    attestationHistory: [], attestations: [] as never, executorHistory: [leaseHolder],
    recallHistory: [{
      operationId: "prior", requestHash: "h", actor: { role: "system", agentId: "lease-expiry-sweeper" },
      reason: "lapsed", recalledAt: T3, beforeStateHash: "s",
      before: {
        physicalId: id, logicalId: id, revision: 1, topologyGeneration: null, phase: "in_progress",
        resourceVersion: "1", stateHash: "s", blockedOn: null,
        lease: { holder: leaseHolder, claimedAt: T1, expiresAt: T3, heartbeatAt: T1, tokenFingerprint: "f" },
      },
      frozenAuthority: null, holderNoticeIntentId: null,
    }] as never,
    createdBy: { role: "architect", agentId: "arch" }, createdAt: T0, updatedAt: T3, ...over,
  } as WorkItem;
}

/** Claim → start → complete with ONE `pr` evidence item stamped `producedAt`. Returns phase or the error. */
async function claimStartComplete(row: WorkItem, agent: string, producedAt: string): Promise<string> {
  const h = harness();
  await h.substrate.put("Agent", { id: agent, role: "engineer" });
  await h.substrate.put("WorkItem", row as unknown as Record<string, unknown>);
  const claimed = await h.repo.claimWorkItem(row.id, agent, "engineer");
  const token = claimed!.lease!.token;
  await h.repo.startWork(row.id, agent, token);
  try {
    await h.repo.completeWork(row.id, agent, token, [
      { requirementId: "pr", kind: "pr", ref: "https://github.com/x/y/pull/1", producedAt } as never,
    ], { summary: "s", observed: false } as never);
  } catch (error) {
    // Slice generously: an earlier 60-char cut TRUNCATED THE MESSAGE BEFORE THE WORD THE
    // ASSERTION LOOKS FOR, so a correct refusal read as a failed test. The instrument must not
    // clip the evidence it is about to be judged on.
    return `THREW:${String((error as Error).message).slice(0, 400)}`;
  }
  return (await h.repo.getWorkItem(row.id))!.status;
}

describe("bug-384 — acceptance, BOTH directions", () => {
  it("🔴 ADMITS evidence produced under a PRIOR lease of the SAME holder", async () => {
    // The live case: artifact at T2, under a first lease claimed at T1 that no longer exists.
    // Before this fix the re-claim reset the baseline to `now` and refused a real artifact.
    const phase = await claimStartComplete(rowWithPriorLease("w-same", ME), ME, T2);
    expect(phase, "a genuinely-produced artifact must survive a re-claim by its producer").toBe("done");
  });

  it("🔴 THE ALREADY-CLAIMED ROW — the case commit 2 exists for, and the only one that isolates it", async () => {
    // WHY THIS CASE EXISTS: the mutation matrix caught that every other test here passes even with
    // the prior-lease clause DISABLED, because the same-holder re-claim preserves claimedAt and
    // ordinary freshness then succeeds. COMMIT 3 WAS MASKING COMMIT 2 COMPLETELY.
    //
    // The clause is load-bearing only for a row ALREADY HOLDING A LATE lease — one claimed before
    // the preservation shipped, whose claimedAt is therefore AFTER the artifact. That is exactly
    // the shape of the live rows this series was written to rescue: claimed hours after the work,
    // holding artifacts that cannot be re-produced. No re-claim happens here, so nothing preserves
    // the baseline for us — the floor must come from recallHistory at COMPLETION time.
    const h = harness();
    const LATE = "2020-01-02T00:00:00.000Z"; // lease claimed a day AFTER the artifact at T2
    await h.substrate.put("Agent", { id: ME, role: "engineer" });
    await h.substrate.put("WorkItem", rowWithPriorLease("w-late", ME, {
      status: "in_progress",
      lease: { holder: ME, token: "late-token", claimedAt: LATE, expiresAt: "2099-01-01T00:00:00.000Z", heartbeatAt: LATE } as never,
    }) as unknown as Record<string, unknown>);

    await h.repo.completeWork("w-late", ME, "late-token", [
      { requirementId: "pr", kind: "pr", ref: "https://github.com/x/y/pull/1", producedAt: T2 } as never,
    ], { summary: "s", observed: false } as never);

    expect(
      (await h.repo.getWorkItem("w-late"))!.status,
      "an artifact produced under a recorded prior lease must be admitted even though the CURRENT lease postdates it",
    ).toBe("done");
  });

  it("🔴 EARLIEST-WINS: with MULTIPLE prior leases, the floor is the OLDEST, not the newest", async () => {
    // ARCHITECT-FLAGGED, AND MY EXISTING FIXTURES COULD NOT HAVE CAUGHT IT — they carry ONE
    // recallHistory entry, so earliest and latest are the same value and a latest-wins bug reads
    // as green. Implemented is not enforced.
    //
    // THE LIVE SHAPE THAT PROVOKED IT: m140_residue accumulated a SECOND entry when it was paused
    // during the identity outage. Its entries are [12:22:43 (the original), 23:21:52 (the
    // post-re-claim pause)] and its artifacts are 12:36/12:38/12:52. Take the LATEST and the floor
    // becomes 23:21:52 — AFTER the artifacts — and the predicate fails on the one row the whole
    // series was written to rescue. A second pause is all it takes; no code change required.
    const h = harness();
    const OLD = "2020-01-01T00:10:00.000Z"; // original lease — artifact at T2 postdates this
    const NEW = "2020-01-03T00:00:00.000Z"; // a later pause — artifact at T2 PREDATES this
    const twoEntry = rowWithPriorLease("w-two", ME, {
      status: "in_progress",
      lease: { holder: ME, token: "cur", claimedAt: "2020-01-04T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", heartbeatAt: NEW } as never,
      recallHistory: [
        { operationId: "old", requestHash: "h", actor: { role: "system", agentId: "s" }, reason: "expiry", recalledAt: OLD, beforeStateHash: "s",
          before: { physicalId: "w-two", logicalId: "w-two", revision: 1, topologyGeneration: null, phase: "in_progress", resourceVersion: "1", stateHash: "s", blockedOn: null,
            lease: { holder: ME, claimedAt: OLD, expiresAt: NEW, heartbeatAt: OLD, tokenFingerprint: "f" } },
          frozenAuthority: null, holderNoticeIntentId: null },
        { operationId: "new", requestHash: "h", actor: { role: "architect", agentId: "arch" }, reason: "protective pause", recalledAt: NEW, beforeStateHash: "s",
          before: { physicalId: "w-two", logicalId: "w-two", revision: 1, topologyGeneration: null, phase: "in_progress", resourceVersion: "2", stateHash: "s", blockedOn: null,
            lease: { holder: ME, claimedAt: NEW, expiresAt: NEW, heartbeatAt: NEW, tokenFingerprint: "f" } },
          frozenAuthority: null, holderNoticeIntentId: null },
      ] as never,
    });
    await h.substrate.put("Agent", { id: ME, role: "engineer" });
    await h.substrate.put("WorkItem", twoEntry as unknown as Record<string, unknown>);

    await h.repo.completeWork("w-two", ME, "cur", [
      { requirementId: "pr", kind: "pr", ref: "https://github.com/x/y/pull/1", producedAt: T2 } as never,
    ], { summary: "s", observed: false } as never);

    expect(
      (await h.repo.getWorkItem("w-two"))!.status,
      "the floor must be the OLDEST prior lease; a later pause must not raise it above the artifact",
    ).toBe("done");
  });

  it("🔴 NEGATIVE CONTROL: REFUSES the same artifact for a DIFFERENT agent", async () => {
    // The prior lease belongs to ME; OTHER claims and submits the same timestamp. A new holder
    // must never inherit a predecessor's baseline — without this the fix is a global relaxation.
    const result = await claimStartComplete(rowWithPriorLease("w-diff", ME), OTHER, T2);
    expect(result.startsWith("THREW:"), `expected refusal, got phase=${result}`).toBe(true);
    expect(result).toContain("freshness");
  });

  it("🔴 NEGATIVE CONTROL: REFUSES when NO prior lease of this holder is recorded", async () => {
    // The unrescuable case, asserted so the limit is enforced rather than merely documented:
    // a row whose lease died before this shipped has an EMPTY recallHistory and stays refused.
    const bare = rowWithPriorLease("w-none", ME, { recallHistory: [] as never });
    const result = await claimStartComplete(bare, ME, T2);
    expect(result.startsWith("THREW:"), `expected refusal, got phase=${result}`).toBe(true);
  });

  it("a same-holder re-claim PRESERVES claimedAt AND grants a full fresh expiresAt window", async () => {
    const h = harness();
    await h.substrate.put("Agent", { id: ME, role: "engineer" });
    await h.substrate.put("WorkItem", rowWithPriorLease("w-lease", ME) as unknown as Record<string, unknown>);
    const claimed = await h.repo.claimWorkItem("w-lease", ME, "engineer");
    expect(claimed!.lease!.claimedAt, "baseline carried forward from the first lease").toBe(T1);
    // THE TRAP THE COMMENT FIX EXISTS FOR: expiresAt must come from NOW, not from the preserved
    // claimedAt — deriving it from T1 would mint a lease already expired at the moment of claim.
    expect(
      Date.parse(claimed!.lease!.expiresAt) > Date.parse(claimed!.lease!.claimedAt) + 60_000,
      `expiresAt ${claimed!.lease!.expiresAt} must be a FULL window from now, not claimedAt + TTL`,
    ).toBe(true);
    expect(Date.parse(claimed!.lease!.expiresAt) > Date.now(), "the fresh lease must not be already-expired").toBe(true);
  });

  it("a DIFFERENT holder's claim resets claimedAt (no inherited baseline)", async () => {
    const h = harness();
    await h.substrate.put("Agent", { id: OTHER, role: "engineer" });
    await h.substrate.put("WorkItem", rowWithPriorLease("w-reset", ME) as unknown as Record<string, unknown>);
    const claimed = await h.repo.claimWorkItem("w-reset", OTHER, "engineer");
    expect(claimed!.lease!.claimedAt, "a new holder starts their own baseline").not.toBe(T1);
  });
});

describe("bug-384 — expireLease records the lease the timer would destroy", () => {
  it("🔴 an expiry preserves holder+claimedAt in recallHistory, and mints NO holder notice", async () => {
    const h = harness();
    await h.substrate.put("Agent", { id: ME, role: "engineer" });
    const row = rowWithPriorLease("w-exp", ME, {
      recallHistory: [] as never, leaseExpiryCount: 0, status: "in_progress",
      lease: { holder: ME, token: "tok", claimedAt: T1, expiresAt: T3, heartbeatAt: T1 } as never,
    });
    await h.substrate.put("WorkItem", row as unknown as Record<string, unknown>);

    const outcome = await h.repo.expireLease("w-exp", "2020-01-01T01:00:00.000Z", 5);
    expect(outcome).toBe("requeued");

    const after = (await h.repo.getWorkItem("w-exp"))!;
    expect(after.lease, "the lapsed lease is still cleared").toBeNull();
    const recorded = (after.recallHistory ?? [])[0];
    expect(recorded, "the expiring lease must be RECORDED, not destroyed").toBeTruthy();
    expect(recorded.before.lease!.holder).toBe(ME);
    expect(recorded.before.lease!.claimedAt, "the freshness baseline survives the timer").toBe(T1);
    // Notices are driven by pendingRecallIntents, never by scanning recallHistory — a timer lapse
    // must not page the holder as though an operator had recalled their work.
    expect(after.pendingRecallIntents ?? [], "a timer lapse mints no holder notice").toEqual([]);
    expect(after.recallNoticePending ?? false).toBe(false);
  });

  it("🔴 END TO END: expire, re-claim, and the artifact produced under the LAPSED lease is admitted", async () => {
    // The whole point, in one case: the timer takes the lease, the holder comes back, and work
    // they genuinely did survives. Before this series it did not.
    const h = harness();
    await h.substrate.put("Agent", { id: ME, role: "engineer" });
    await h.substrate.put("WorkItem", rowWithPriorLease("w-e2e", ME, {
      recallHistory: [] as never, leaseExpiryCount: 0, status: "in_progress",
      lease: { holder: ME, token: "tok", claimedAt: T1, expiresAt: T3, heartbeatAt: T1 } as never,
    }) as unknown as Record<string, unknown>);

    expect(await h.repo.expireLease("w-e2e", "2020-01-01T01:00:00.000Z", 5)).toBe("requeued");

    const claimed = await h.repo.claimWorkItem("w-e2e", ME, "engineer");
    const token = claimed!.lease!.token;
    await h.repo.startWork("w-e2e", ME, token);
    await h.repo.completeWork("w-e2e", ME, token, [
      { requirementId: "pr", kind: "pr", ref: "https://github.com/x/y/pull/1", producedAt: T2 } as never,
    ], { summary: "s", observed: false } as never);

    expect((await h.repo.getWorkItem("w-e2e"))!.status, "artifact from the lapsed lease must be admitted").toBe("done");
  });
});
