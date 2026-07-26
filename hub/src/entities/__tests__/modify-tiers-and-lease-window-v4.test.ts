// idea-640 impl_modify_retire — THE THREE-TIER MODIFY SCOPE AND THE LEASE-WINDOW REPAIR.
//
// 🔴 EVERY CASE HERE IS EXPRESSIBLE ON BOTH TREES. Not one asserts the presence of a new method,
// because a test written against a new API reds UNCONDITIONALLY on the old one — it reds because the
// symbol is absent, not because the behaviour was wrong, and such a red is indistinguishable from a
// real catch. That defect ate the first falsifier attempt on #683 and it is the reason this file
// drives `updateWorkItem` (which exists on both trees) rather than anything newly added.
//
// THE ATTACK THE FULL-TIER REFUSAL EXISTS TO STOP:
//   claim -> produce non-satisfying evidence -> pause -> reset -> REWRITE the contract to fit -> complete
// Half one is already built (reset clears evidence AND attestations, so nothing can CARRY artifacts
// through). This file is the other half: the tier must REFUSE a row that still holds either.
import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import { WorkItemRepositorySubstrate, TransitionRejected } from "../work-item-repository-substrate.js";
import { WorkGraphCurrentnessRejected } from "../workgraph-currentness-fence-v4.js";

const ARCH = { agentId: "arch-1", role: "architect" };
const NEW_CONTRACT = [{ id: "swapped", kind: "freeform", description: "a rewritten contract" }] as never;

async function harness() {
  const substrate = createMemoryStorageSubstrate();
  return new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
}

async function readyRow(repo: WorkItemRepositorySubstrate) {
  const w = await repo.createWorkItem({
    type: "task", roleEligibility: ["engineer"],
    evidenceRequirements: [{ id: "art", kind: "freeform", description: "original contract" }] as never,
    createdBy: { role: "architect", agentId: ARCH.agentId } as never,
  });
  return w.id;
}

const pause = (repo: WorkItemRepositorySubstrate, id: string) =>
  repo.pauseWork({ workId: id, operationId: `op-${id}-${Math.random()}`, reason: "test" } as never, ARCH);

describe("idea-640 — the FULL tier and the refusal that bounds it", () => {
  it("🔴 ALLOWS evidenceRequirements on a SUSPENDED, lease-revoked, evidence-free row", async () => {
    const repo = await harness();
    const id = await readyRow(repo);
    const claimed = await repo.claimWorkItem(id, "eng-1", "engineer");
    await repo.startWork(id, "eng-1", claimed!.lease!.token);
    await pause(repo, id);
    await repo.resetWork(id, ARCH); // the gateway: revokes the lease AND discards evidence

    const { after } = await repo.updateWorkItem(id, ARCH, { set: { evidenceRequirements: NEW_CONTRACT } });
    expect(after.evidenceRequirements, "the FULL tier is reachable after reset").toEqual(NEW_CONTRACT);
  });

  it("🔴 REFUSES on a LIVE row — the tier is not reachable while the holder is working", async () => {
    const repo = await harness();
    const id = await readyRow(repo);
    const claimed = await repo.claimWorkItem(id, "eng-1", "engineer");
    await repo.startWork(id, "eng-1", claimed!.lease!.token);
    await expect(repo.updateWorkItem(id, ARCH, { set: { evidenceRequirements: NEW_CONTRACT } }))
      .rejects.toThrow(/FULL edit tier|LIVE/);
    expect((await repo.getWorkItem(id))!.evidenceRequirements[0]!.id, "unchanged").toBe("art");
  });

  it("🔴 REFUSES on a SUSPENDED row that still HOLDS THE LEASE — reset is the gateway, pause is not", async () => {
    const repo = await harness();
    const id = await readyRow(repo);
    const claimed = await repo.claimWorkItem(id, "eng-1", "engineer");
    await repo.startWork(id, "eng-1", claimed!.lease!.token);
    await pause(repo, id); // suspended, but the lease is RETAINED — this is the MINOR tier
    expect((await repo.getWorkItem(id))!.lease, "armed: pause retains the lease").not.toBeNull();
    await expect(repo.updateWorkItem(id, ARCH, { set: { evidenceRequirements: NEW_CONTRACT } }))
      .rejects.toThrow(/FULL edit tier/);
  });

  it("🔴 REFUSES a row still carrying EVIDENCE — the anti-gameability control itself", async () => {
    // The row is suspended and lease-free (so the tier's PHASE conditions are met) but evidence
    // stands against the old contract. Rewriting it here is grading your own exam after sitting it.
    const repo = await harness();
    const id = await readyRow(repo);
    const claimed = await repo.claimWorkItem(id, "eng-1", "engineer");
    await repo.startWork(id, "eng-1", claimed!.lease!.token);
    const substrate = (repo as unknown as { substrate: { get: (k: string, i: string) => Promise<unknown>; put: (k: string, v: unknown) => Promise<unknown> } }).substrate;
    const row = (await repo.getWorkItem(id))!;
    await substrate.put("WorkItem", {
      ...row, suspended: true, lease: null,
      evidence: [{ requirementId: "art", kind: "freeform", producedAt: new Date().toISOString() }],
    });
    await expect(repo.updateWorkItem(id, ARCH, { set: { evidenceRequirements: NEW_CONTRACT } }))
      .rejects.toThrow(/evidence-free|FULL edit tier/);
    expect((await repo.getWorkItem(id))!.evidenceRequirements[0]!.id, "the rewrite landed nowhere").toBe("art");
  });

  it("🔴 REFUSES a row carrying attestationHistory — a discharged verdict is not erasable either", async () => {
    const repo = await harness();
    const id = await readyRow(repo);
    const substrate = (repo as unknown as { substrate: { put: (k: string, v: unknown) => Promise<unknown> } }).substrate;
    const row = (await repo.getWorkItem(id))!;
    await substrate.put("WorkItem", {
      ...row, suspended: true, lease: null, evidence: [],
      attestationHistory: [{ requirementId: "art", verdict: "pass", attestedBy: "verifier-1", attestedAt: new Date().toISOString() }],
    });
    await expect(repo.updateWorkItem(id, ARCH, { set: { evidenceRequirements: NEW_CONTRACT } }))
      .rejects.toThrow(/evidence-free|FULL edit tier/);
  });

  it("the tier does not leak: a MINOR-tier field is still refused on a LIVE row, and `priority` still is not", async () => {
    // Control in both directions — proves the FULL-tier work did not widen or narrow its neighbours.
    const repo = await harness();
    const id = await readyRow(repo);
    const claimed = await repo.claimWorkItem(id, "eng-1", "engineer");
    await repo.startWork(id, "eng-1", claimed!.lease!.token);
    await expect(repo.updateWorkItem(id, ARCH, { set: { runbook: "rewritten" } }))
      .rejects.toThrow(WorkGraphCurrentnessRejected);
    const { after } = await repo.updateWorkItem(id, ARCH, { set: { priority: "critical" } });
    expect(after.priority, "decision-11 principle 3: coordination metadata stays live-editable").toBe("critical");
  });
});

describe("idea-640 — leaseWindowMs applies instead of being silently discarded", () => {
  it("🔴 APPLIES on a LIVE row and is reflected in the stored value", async () => {
    // The measured defect: `update_work {set:{priority}, leaseWindowMs}` returned changed:["priority"]
    // and the window stayed 15 minutes. Accepted, validated, dropped. This is the repair.
    const repo = await harness();
    const id = await readyRow(repo);
    const claimed = await repo.claimWorkItem(id, "eng-1", "engineer");
    await repo.startWork(id, "eng-1", claimed!.lease!.token);
    const { after } = await repo.updateWorkItem(id, ARCH, { set: { leaseWindowMs: 3_600_000 } });
    expect(after.leaseWindowMs, "the field actually lands").toBe(3_600_000);
  });

  it("🔴 TAKES EFFECT AT THE NEXT RENEW — the CURRENT lease keeps its expiry", async () => {
    // Deliberate: re-deriving a live lease would let one actor move another seat's expiry, and the
    // dangerous direction is SHORTENING — an instant expiry on a healthy holder mid-turn.
    const repo = await harness();
    const id = await readyRow(repo);
    const claimed = await repo.claimWorkItem(id, "eng-1", "engineer");
    const token = claimed!.lease!.token;
    await repo.startWork(id, "eng-1", token);
    const before = (await repo.getWorkItem(id))!.lease!.expiresAt;

    await repo.updateWorkItem(id, ARCH, { set: { leaseWindowMs: 3_600_000 } });
    expect((await repo.getWorkItem(id))!.lease!.expiresAt, "the CURRENT lease is untouched").toBe(before);

    const renewed = await repo.renewLease(id, "eng-1", token);
    const window = Date.parse(renewed!.lease!.expiresAt) - Date.parse(renewed!.lease!.heartbeatAt!);
    expect(window, "the NEXT grant uses the new window").toBe(3_600_000);
  });
});
