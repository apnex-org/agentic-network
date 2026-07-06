/**
 * SEAL A2 (idea-444) — attest_evidence + verify_attestation authority logic.
 *
 * Exercises the load-bearing kernel against steve's ratification checklist (§4/§5):
 * server-stamped verifier path, executor/holder/creator-HISTORY exclusion, executor-evidence
 * hard fence, non-empty related evidenceRefs, relocation freeze, preserve-not-inject CAS merge,
 * dual-edge review→done reconciliation, fail→pass supersede, and the verify_attestation recompute.
 * Real repo over the memory substrate (the envelope round-trip is proven in A1).
 */

import { describe, it, expect } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import {
  WorkItemRepositorySubstrate,
  AttestationRejected,
  EvidencePredicateFailed,
  TransitionRejected,
} from "../work-item-repository-substrate.js";
import { SubstrateCounter } from "../substrate-counter.js";
import type { EvidenceRequirement, EvidenceItem } from "../work-item.js";

async function setup() {
  const substrate = createMemoryStorageSubstrate();
  const repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
  // resolveAgentRole reads Agent.spec.role; the substrate envelope-wraps a put, routing the flat
  // `role` field into the spec bucket → get().spec.role. (Seeding {spec:{role}} would double-nest.)
  await substrate.put("Agent", { id: "agent-verifier", role: "verifier" });
  await substrate.put("Agent", { id: "agent-eng", role: "engineer" });
  return { substrate, repo };
}

const EXEC: EvidenceRequirement = { id: "exec", kind: "freeform" };
const ATT: EvidenceRequirement = { id: "att", kind: "freeform", evidenceAuthority: "verifier-attestation" };

/** Create → claim(agent-eng) → start → complete(exec evidence): parks in review awaiting attestation. */
async function sealItemInReview(repo: WorkItemRepositorySubstrate, reqs: EvidenceRequirement[] = [EXEC, ATT]) {
  const w = await repo.createWorkItem({ type: "task", roleEligibility: [], evidenceRequirements: reqs, targetRef: { kind: "mission", id: "m-1" } });
  const claimed = await repo.claimWorkItem(w.id, "agent-eng", "engineer");
  const token = claimed!.lease!.token;
  await repo.startWork(w.id, "agent-eng", token);
  const evidence: EvidenceItem[] = reqs.some((r) => r.id === "exec")
    ? [{ requirementId: "exec", kind: "freeform", ref: "pr-1", producedAt: new Date().toISOString() }]
    : [];
  const completed = await repo.completeWork(w.id, "agent-eng", token, evidence);
  return { workId: w.id, completed };
}

describe("SEAL A2 — attest_evidence authority", () => {
  it("DUAL-EDGE: a verifier pass attestation advances review→done in the same write", async () => {
    const { repo } = await setup();
    const { workId, completed } = await sealItemInReview(repo);
    expect(completed!.status).toBe("review"); // parked: verifier-attestation req pending
    const { item, attestation } = await repo.attestEvidence(workId, "att", "agent-verifier", "pass", [workId]);
    expect(attestation.verifierId).toBe("agent-verifier");
    expect(item.status).toBe("done");
    expect(item.attestations["att"].verdict).toBe("pass");
    expect(item.attestationHistory).toHaveLength(1);
  });

  it("HISTORY check: an agent who executed the item CANNOT attest it (release-then-attest closed)", async () => {
    const { repo } = await setup();
    const { workId } = await sealItemInReview(repo);
    await expect(repo.attestEvidence(workId, "att", "agent-eng", "pass", [workId])).rejects.toThrow(AttestationRejected);
  });

  it("HARD FENCE: executor evidence bound to a verifier-attestation req is rejected at complete_work", async () => {
    const { repo } = await setup();
    const w = await repo.createWorkItem({ type: "task", roleEligibility: [], evidenceRequirements: [ATT] });
    const claimed = await repo.claimWorkItem(w.id, "agent-eng", "engineer");
    const token = claimed!.lease!.token;
    await repo.startWork(w.id, "agent-eng", token);
    await expect(
      repo.completeWork(w.id, "agent-eng", token, [{ requirementId: "att", kind: "freeform", ref: "x", producedAt: new Date().toISOString() }]),
    ).rejects.toThrow(EvidencePredicateFailed);
  });

  it("attest on an executor-evidence (default) requirement is rejected", async () => {
    const { repo } = await setup();
    const { workId } = await sealItemInReview(repo);
    await expect(repo.attestEvidence(workId, "exec", "agent-verifier", "pass", [workId])).rejects.toThrow(AttestationRejected);
  });

  it("empty evidenceRefs rejected (no trust-by-prose verdict)", async () => {
    const { repo } = await setup();
    const { workId } = await sealItemInReview(repo);
    await expect(repo.attestEvidence(workId, "att", "agent-verifier", "pass", [])).rejects.toThrow(AttestationRejected);
  });

  it("unrelated evidenceRefs rejected (must bind to concrete work evidence)", async () => {
    const { repo } = await setup();
    const { workId } = await sealItemInReview(repo);
    await expect(repo.attestEvidence(workId, "att", "agent-verifier", "pass", ["totally-unrelated"])).rejects.toThrow(AttestationRejected);
  });

  it("evidenceRef relates via an evidence entry ref / targetRef id (not just the item id)", async () => {
    const { repo } = await setup();
    const { workId } = await sealItemInReview(repo);
    const viaEvidence = await repo.attestEvidence(workId, "att", "agent-verifier", "pass", ["pr-1"]);
    expect(viaEvidence.item.status).toBe("done");
  });

  it("FAIL keeps the item in review; a later PASS supersedes + unparks to done (append-only)", async () => {
    const { repo } = await setup();
    const { workId } = await sealItemInReview(repo);
    const failed = await repo.attestEvidence(workId, "att", "agent-verifier", "fail", [workId]);
    expect(failed.item.status).toBe("review");
    const passed = await repo.attestEvidence(workId, "att", "agent-verifier", "pass", [workId]);
    expect(passed.item.status).toBe("done");
    expect(passed.attestation.supersedes).toBeDefined();
    expect(passed.item.attestationHistory).toHaveLength(2); // history is append-only
    expect(passed.item.attestations["att"].verdict).toBe("pass"); // active projection repointed
  });

  it("PRESERVE-NOT-INJECT: attesting one requirement merges into the map, preserving the other", async () => {
    const { repo } = await setup();
    const att2: EvidenceRequirement = { id: "att2", kind: "freeform", evidenceAuthority: "verifier-attestation" };
    const { workId } = await sealItemInReview(repo, [EXEC, ATT, att2]);
    await repo.attestEvidence(workId, "att", "agent-verifier", "pass", [workId]);
    const second = await repo.attestEvidence(workId, "att2", "agent-verifier", "pass", [workId]);
    expect(second.item.attestations["att"].verdict).toBe("pass"); // first preserved
    expect(second.item.attestations["att2"].verdict).toBe("pass");
    expect(second.item.status).toBe("done"); // both cleared → done
  });

  it("RELOCATION guard: targetRef is frozen once an attestation exists (updateWork rejects)", async () => {
    const { repo } = await setup();
    const { workId } = await sealItemInReview(repo);
    await repo.attestEvidence(workId, "att", "agent-verifier", "pass", [workId]);
    await expect(
      repo.updateWorkItem(workId, { agentId: "arch-1", role: "architect" }, { set: { targetRef: { kind: "mission", id: "m-2" } } }),
    ).rejects.toThrow(TransitionRejected);
  });
});

describe("SEAL A2 — verify_attestation (recompute)", () => {
  it("a valid attestation → valid:true with the active record", async () => {
    const { repo } = await setup();
    const { workId } = await sealItemInReview(repo);
    await repo.attestEvidence(workId, "att", "agent-verifier", "pass", [workId]);
    const v = await repo.verifyAttestation(workId, "att");
    expect(v.valid).toBe(true);
    expect(v.active?.verdict).toBe("pass");
    expect(v.invalidReasons).toEqual([]);
  });

  it("flags a verifier that does not resolve to a verifier role", async () => {
    const { repo } = await setup();
    const { workId } = await sealItemInReview(repo);
    await repo.attestEvidence(workId, "att", "agent-ghost", "pass", [workId]); // not seeded as verifier
    const v = await repo.verifyAttestation(workId, "att");
    expect(v.valid).toBe(false);
    expect(v.invalidReasons.some((r) => r.includes("verifier"))).toBe(true);
  });

  it("reports NO active attestation as invalid", async () => {
    const { repo } = await setup();
    const { workId } = await sealItemInReview(repo);
    const v = await repo.verifyAttestation(workId, "att");
    expect(v.valid).toBe(false);
    expect(v.active).toBeNull();
    expect(v.invalidReasons.some((r) => r.includes("no active attestation"))).toBe(true);
  });
});
