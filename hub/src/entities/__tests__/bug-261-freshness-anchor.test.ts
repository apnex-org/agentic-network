/**
 * bug-261 — complete_work freshness anchors on the work item's createdAt, NOT the
 * (possibly forced-late) lease.claimedAt.
 *
 * A dependency-gated node cannot be claimed until its deps complete, so its claim is
 * forced LATE. Honest own-deliverable evidence produced while the work was legitimately
 * underway (incl. a merge done under a Director pre-authorization) then predates the late
 * claim and was WRONGLY rejected as stale. The fix re-anchors freshness on createdAt (the
 * item's existence); createdAt <= claimedAt ALWAYS, so the floor is strictly LOOSER ->
 * zero regression, while admitting the honest-but-forced-late window [createdAt, claimedAt).
 *
 * The two laundering guards lily named are enforced INDEPENDENTLY of the claim-time anchor
 * (the verifier-attestation SEAL fence + the refResolvable relate/relevance check), so the
 * anchor swap cannot weaken them — proven by the RED relocated-stale case here (and by the
 * whole contract-5-verdict-spoof suite staying green). Memory-substrate (no testcontainer).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import { WorkItemRepositorySubstrate } from "../work-item-repository-substrate.js";
import type { EvidenceItem, EvidenceRequirement } from "../work-item.js";

const STALE = "2000-01-01T00:00:00.000Z"; // long before any node's createdAt

describe("bug-261: freshness anchors on createdAt (dependency-gated forced-late claim)", () => {
  let substrate: ReturnType<typeof createMemoryStorageSubstrate>;
  let repo: WorkItemRepositorySubstrate;

  beforeEach(() => {
    substrate = createMemoryStorageSubstrate();
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
  });

  /** create -> claim -> start a commit-evidence node (the b261 node shape). */
  async function startedCommit(agent: string) {
    const reqs: EvidenceRequirement[] = [
      { id: "commit", kind: "commit", refResolvable: true, description: "merge commit" },
    ];
    const w = await repo.createWorkItem({ type: "task", roleEligibility: [], evidenceRequirements: reqs });
    const claimed = await repo.claimWorkItem(w.id, agent);
    const token = claimed!.lease!.token;
    await repo.startWork(w.id, agent, token);
    return { id: w.id, token, createdAt: w.createdAt, claimedAt: claimed!.lease!.claimedAt };
  }
  function commitEv(producedAt: string): EvidenceItem {
    return { requirementId: "commit", kind: "commit", ref: "eb57a685deadbeef", producedAt } as EvidenceItem;
  }

  it("GREEN: honest merge-evidence produced BEFORE the forced-late claim but AFTER createdAt is now accepted", async () => {
    const w = await startedCommit("agent-b261-green");
    // createdAt precedes claimedAt by construction — so evidence at createdAt is < claimedAt
    // (the bug-261 forced-late scenario) yet >= createdAt (now fresh). Under the OLD anchor
    // this exact case was rejected.
    expect(new Date(w.createdAt).getTime()).toBeLessThan(new Date(w.claimedAt).getTime());
    const done = await repo.completeWork(w.id, "agent-b261-green", w.token, [commitEv(w.createdAt)]);
    expect(done!.status).toBe("done");
  });

  it("RED: evidence produced BEFORE createdAt (pre-existence) still fails freshness", async () => {
    const w = await startedCommit("agent-b261-pre");
    await expect(repo.completeWork(w.id, "agent-b261-pre", w.token, [commitEv(STALE)]))
      .rejects.toThrow(/failed freshness/);
  });

  it("RED: a malformed producedAt still fails closed", async () => {
    const w = await startedCommit("agent-b261-bad");
    await expect(repo.completeWork(w.id, "agent-b261-bad", w.token, [commitEv("not-a-timestamp")]))
      .rejects.toThrow(/failed freshness/);
  });

  it("GREEN: a normally-claimed node with fresh post-claim evidence still completes (no regression)", async () => {
    const w = await startedCommit("agent-b261-normal");
    const done = await repo.completeWork(w.id, "agent-b261-normal", w.token, [commitEv(new Date().toISOString())]);
    expect(done!.status).toBe("done");
  });

  it("RED: a RELOCATED-STALE artifact (verifier audit for a DIFFERENT entity, pre-existence stamp) still fails", async () => {
    // A genuine verifier audit about work-99999, bound as this node's verdict with a STALE
    // stamp. Must still reject — the anchor swap is orthogonal to the relate + freshness
    // guards, both of which independently reject this (relocation-laundering stays closed).
    const reqs: EvidenceRequirement[] = [
      { id: "verdict", kind: "review", refResolvable: true, description: "verifier verdict audit" },
    ];
    const w = await repo.createWorkItem({ type: "task", roleEligibility: [], evidenceRequirements: reqs });
    const claimed = await repo.claimWorkItem(w.id, "agent-b261-reloc");
    const token = claimed!.lease!.token;
    await repo.startWork(w.id, "agent-b261-reloc", token);
    await substrate.createOnly("Audit", {
      apiVersion: "core.ois/v1", kind: "Audit", id: "audit-b261-reloc",
      metadata: { actor: "verifier" },
      spec: { action: "verifier_valid_verdict", details: "d", relatedEntity: "work-99999" },
      status: {},
    });
    const relocatedStale: EvidenceItem = {
      requirementId: "verdict", kind: "audit", ref: "audit-b261-reloc",
      producedAt: STALE, producedBy: "agent-f148389d",
    } as EvidenceItem;
    await expect(repo.completeWork(w.id, "agent-b261-reloc", token, [relocatedStale]))
      .rejects.toThrow(/does not RELATE|failed freshness/);
  });
});
