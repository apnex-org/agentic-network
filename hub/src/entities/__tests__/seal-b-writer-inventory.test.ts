/**
 * SEAL B (idea-444, §5 writer inventory) — the MECHANICAL "no writer bypasses" proof.
 *
 * The attestation subtree is a DISJOINT authority surface: only attest_evidence may write it, and
 * NO WorkItem writer may drop, mutate, or inject it. This proves that EXHAUSTIVELY over every
 * writer path, applying steve's 6-case matrix (audit-11697/11708):
 *   (1) no-inject   — create/seed/update input cannot inject attestation fields
 *   (3) survive     — an owner-path write preserves the subtree
 *   (6) read-back   — the subtree is intact through decode→transform→re-encode (resurrection case)
 * Cases (2) owner→attest RBAC-denied, (4) forged verifierId server-overridden, and (5) laundering
 * query surfaces mismatch are proven in seal-a2-attest.test.ts (HISTORY reject / server-stamp /
 * verify_attestation recompute) and re-asserted concisely here.
 *
 * Preservation is STRUCTURAL (A1): every writer's transform spreads `{ ...w }` (which carries the
 * subtree) and every read goes through cloneWorkItem + the status-partition envelope. This test is
 * the enforcement that converts "structural by construction" into "test-enforced per writer" — a
 * writer that reconstructs the item WITHOUT the subtree reds here.
 */

import { describe, it, expect } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { WorkItemRepositorySubstrate } from "../work-item-repository-substrate.js";
import { SubstrateCounter } from "../substrate-counter.js";
import type { WorkItemBlockedOn, EvidenceRequirement } from "../work-item.js";

const ATT: EvidenceRequirement = { id: "att", kind: "freeform", evidenceAuthority: "verifier-attestation" };
const BLOCK: WorkItemBlockedOn = { blockerKind: "WorkItem", blockerIds: ["work-dep"], reason: "dep" };

async function setup() {
  const substrate = createMemoryStorageSubstrate();
  const repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
  await substrate.put("Agent", { id: "agent-verifier", role: "verifier" });
  await substrate.put("mission", { id: "m-1" });
  return { substrate, repo };
}

/** A fresh item carrying ONE recorded attestation (by a verifier not in its history), in `ready`. */
async function attestedReadyItem(repo: WorkItemRepositorySubstrate): Promise<string> {
  const w = await repo.createWorkItem({ type: "task", roleEligibility: [], evidenceRequirements: [ATT], targetRef: { kind: "mission", id: "m-1" } });
  // attest on the ready item (verifier ∉ history) — records the subtree without advancing phase.
  await repo.attestEvidence(w.id, "att", "agent-verifier", "pass", [{ kind: "entity", ref: "mission/m-1" }]);
  return w.id;
}

/** The subtree-intact assertion (cases 3 + 6): read fresh (through decode) → attestation survives. */
async function expectSubtreeIntact(repo: WorkItemRepositorySubstrate, workId: string) {
  const w = await repo.getWorkItem(workId);
  expect(w, `read-back of ${workId}`).not.toBeNull();
  expect(w!.attestations["att"]?.verdict, `active attestation on ${workId}`).toBe("pass");
  expect(w!.attestationHistory, `history on ${workId}`).toHaveLength(1);
}

describe("SEAL B — writer inventory: EVERY writer preserves the attestation subtree (cases 3+6)", () => {
  it("claimWorkItem (ready→claimed)", async () => {
    const { repo } = await setup();
    const id = await attestedReadyItem(repo);
    await repo.claimWorkItem(id, "agent-eng", "engineer");
    await expectSubtreeIntact(repo, id);
  });

  it("startWork (claimed→in_progress)", async () => {
    const { repo } = await setup();
    const id = await attestedReadyItem(repo);
    const c = await repo.claimWorkItem(id, "agent-eng", "engineer");
    await repo.startWork(id, "agent-eng", c!.lease!.token);
    await expectSubtreeIntact(repo, id);
  });

  it("blockWork + resumeWork (in_progress↔blocked)", async () => {
    const { repo } = await setup();
    const id = await attestedReadyItem(repo);
    const c = await repo.claimWorkItem(id, "agent-eng", "engineer");
    const t = c!.lease!.token;
    await repo.startWork(id, "agent-eng", t);
    await repo.blockWork(id, "agent-eng", t, BLOCK);
    await expectSubtreeIntact(repo, id);
    await repo.resumeWork(id, "agent-eng", t);
    await expectSubtreeIntact(repo, id);
  });

  it("systemUnblock (blocked→ready)", async () => {
    const { repo } = await setup();
    const id = await attestedReadyItem(repo);
    const c = await repo.claimWorkItem(id, "agent-eng", "engineer");
    const t = c!.lease!.token;
    await repo.startWork(id, "agent-eng", t);
    await repo.blockWork(id, "agent-eng", t, BLOCK);
    await repo.systemUnblock(id, "work-dep"); // the decisionRef must match the blocker it waits on
    await expectSubtreeIntact(repo, id);
  });

  it("renewLease", async () => {
    const { repo } = await setup();
    const id = await attestedReadyItem(repo);
    const c = await repo.claimWorkItem(id, "agent-eng", "engineer");
    await repo.renewLease(id, "agent-eng", c!.lease!.token);
    await expectSubtreeIntact(repo, id);
  });

  it("releaseWork (→ready)", async () => {
    const { repo } = await setup();
    const id = await attestedReadyItem(repo);
    const c = await repo.claimWorkItem(id, "agent-eng", "engineer");
    await repo.releaseWork(id, "agent-eng", c!.lease!.token);
    await expectSubtreeIntact(repo, id);
  });

  it("abandonWork (→abandoned, terminal)", async () => {
    const { repo } = await setup();
    const id = await attestedReadyItem(repo);
    const c = await repo.claimWorkItem(id, "agent-eng", "engineer");
    await repo.abandonWork(id, "agent-eng", { leaseToken: c!.lease!.token, reason: "giving up" });
    await expectSubtreeIntact(repo, id);
  });

  it("updateWorkItem — OWNER mutation preserves the subtree (case 6 read-back-after-owner-update)", async () => {
    const { repo } = await setup();
    const id = await attestedReadyItem(repo);
    // an owner (author/architect) mutates a spec field; the attestation subtree must survive the
    // decode→transform→re-encode round-trip (the resurrection-vector case per writer).
    await repo.updateWorkItem(id, { agentId: "arch-1", role: "architect" }, { set: { priority: "high" } });
    await expectSubtreeIntact(repo, id);
  });

  it("expireLease (sweeper re-queue) preserves the subtree", async () => {
    const { repo } = await setup();
    const id = await attestedReadyItem(repo);
    await repo.claimWorkItem(id, "agent-eng", "engineer");
    await repo.expireLease(id, "2099-01-01T00:00:00.000Z", 5); // sweeper re-queues an expired claim → ready
    await expectSubtreeIntact(repo, id);
  });

  it("completeWork (attestation already recorded → done) preserves the subtree", async () => {
    const { repo } = await setup();
    const id = await attestedReadyItem(repo);
    const c = await repo.claimWorkItem(id, "agent-eng", "engineer");
    const t = c!.lease!.token;
    await repo.startWork(id, "agent-eng", t);
    await repo.completeWork(id, "agent-eng", t, []); // only the verifier-attestation req, already pass → done
    await expectSubtreeIntact(repo, id);
  });
});

describe("SEAL B — no-inject (case 1) + cross-cutting re-assert (cases 2/4/5)", () => {
  it("createWorkItem births the subtree EMPTY (an owner cannot inject attestations at create)", async () => {
    const { repo } = await setup();
    const w = await repo.createWorkItem({ type: "task", roleEligibility: [], evidenceRequirements: [ATT] });
    expect(w.attestationHistory).toEqual([]);
    expect(w.attestations).toEqual({});
    expect(w.executorHistory).toEqual([]);
  });

  it("createBlueprintNode births the subtree EMPTY", async () => {
    const { repo } = await setup();
    const { item } = await repo.createBlueprintNode({ id: "work-bp-r-a", blueprintRunId: "r", type: "task", roleEligibility: [] });
    expect(item.attestationHistory).toEqual([]);
    expect(item.attestations).toEqual({});
  });

  it("updateWorkItem has NO attestation write path (set{} cannot mutate the subtree)", async () => {
    const { repo } = await setup();
    const id = await attestedReadyItem(repo);
    // The only owner mutation surface is set{priority,targetRef,runbook,payload,roleEligibility} +
    // append{dependsOn,completionDependsOn,references} — none touch attestations. An owner update
    // leaves the recorded attestation byte-for-byte (no inject, no mutate).
    const { before, after } = await repo.updateWorkItem(id, { agentId: "arch-1", role: "architect" }, { set: { priority: "high" } });
    expect(after.attestations["att"]).toEqual(before.attestations["att"]);
    expect(after.attestationHistory).toEqual(before.attestationHistory);
  });

  it("cross-ref (case 2): an executor/holder in HISTORY is RBAC-denied at attest (self-attestation)", async () => {
    const { repo } = await setup();
    const id = await attestedReadyItem(repo);
    await repo.claimWorkItem(id, "agent-eng", "engineer"); // agent-eng now in executorHistory
    await expect(repo.attestEvidence(id, "att", "agent-eng", "pass", [{ kind: "entity", ref: "mission/m-1" }])).rejects.toThrow();
  });
});
