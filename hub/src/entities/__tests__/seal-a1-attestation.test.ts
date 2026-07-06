/**
 * SEAL A1 (idea-444) — attestation-subtree PRESERVATION + the pure completion gate.
 *
 * A1 is the structural foundation the authority logic (A2: attest_evidence) builds on.
 * It must prove — BEFORE any write path exists — that the attestation subtree:
 *   (1) partitions into the envelope STATUS bucket (never silently into spec — the
 *       envelope.ts pickPartition resurrection trap), and
 *   (2) survives the decode→transform→re-encode membrane that EVERY owner-path write
 *       (claim/start/update/complete/... via cloneWorkItem + the write-encoder) crosses —
 *       the read-back-after-owner-update case.
 * Plus the pure, level-triggered `evaluateCompletionGate` (A2 wires it dual-edge).
 */

import { describe, it, expect } from "vitest";
import { ALL_SCHEMAS } from "../../storage-substrate/index.js";
import { createWorkItemMigrationModule } from "../../storage-substrate/migrations/v2-envelope/kinds/WorkItem.js";
import { decodeEnvelopeToFlat } from "../shape-helpers.js";
import { evaluateCompletionGate, type WorkItem, type Attestation, type EvidenceRequirement } from "../work-item.js";

const workItemSchema = ALL_SCHEMAS.find((s) => s.kind === "WorkItem")!;
const module = createWorkItemMigrationModule(workItemSchema);

function attestation(over: Partial<Attestation> = {}): Attestation {
  return {
    requirementId: "r1",
    verifierId: "agent-verifier",
    verdict: "pass",
    producedAt: "2026-01-01T00:00:00.000Z",
    evidenceRefs: [{ kind: "evidence", ref: "pr-1" }],
    requirementHash: "rh",
    targetRefSnapshot: null,
    targetRefHash: "th",
    evidenceSetHash: "eh",
    ...over,
  };
}

/** A minimal flat WorkItem carrying an attestation subtree. */
function flatItem(over: Partial<WorkItem> = {}): Record<string, unknown> {
  const att = attestation();
  const base: WorkItem = {
    id: "work-seal-1",
    type: "task",
    priority: "normal",
    roleEligibility: [],
    dependsOn: [],
    completionDependsOn: [],
    evidenceRequirements: [],
    targetRef: null,
    status: "in_progress",
    lease: null,
    evidence: [],
    blockedOn: null,
    leaseExpiryCount: 0,
    enteredCurrentStateAt: "2026-01-01T00:00:00.000Z",
    stateDurations: { ready: 0, claimed: 0, in_progress: 0, blocked: 0, review: 0 },
    attestationHistory: [att],
    attestations: { r1: att },
    executorHistory: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
  return base as unknown as Record<string, unknown>;
}

describe("SEAL A1 — attestation subtree preservation (envelope round-trip)", () => {
  it("partitions the attestation subtree into STATUS, never spec (the resurrection-vector trap)", () => {
    const enc = module.migrateOne(flatItem()) as { spec?: Record<string, unknown>; status?: Record<string, unknown> };
    // Landed in status...
    expect((enc.status?.attestations as Record<string, Attestation>).r1.verdict).toBe("pass");
    expect((enc.status?.attestationHistory as Attestation[]).length).toBe(1);
    // ...and NOT in spec (an un-partitioned status field silently falls into spec → the trap).
    expect(enc.spec?.attestations).toBeUndefined();
    expect(enc.spec?.attestationHistory).toBeUndefined();
  });

  it("survives encode→decode intact", () => {
    const dec = decodeEnvelopeToFlat(module.migrateOne(flatItem()) as Record<string, unknown>, "WorkItem") as unknown as WorkItem;
    expect(dec.attestations.r1.verdict).toBe("pass");
    expect(dec.attestations.r1.verifierId).toBe("agent-verifier");
    expect(dec.attestationHistory).toHaveLength(1);
  });

  it("READ-BACK AFTER OWNER-UPDATE: the subtree is intact through decode→owner-mutate→re-encode", () => {
    // Simulate the owner write path: decode the stored row, mutate an OWNER field (status/phase),
    // NEVER touch attestations, re-encode (the cloneWorkItem + write-encoder membrane), decode again.
    const enc1 = module.migrateOne(flatItem({ status: "in_progress" })) as Record<string, unknown>;
    const decoded = decodeEnvelopeToFlat(enc1, "WorkItem") as unknown as WorkItem;
    const ownerMutated = { ...decoded, status: "review" as const, updatedAt: "2026-01-02T00:00:00.000Z" };
    const enc2 = module.migrateOne(ownerMutated as unknown as Record<string, unknown>) as { status?: Record<string, unknown> };
    const final = decodeEnvelopeToFlat(enc2 as Record<string, unknown>, "WorkItem") as unknown as WorkItem;
    // Owner change applied...
    expect(final.status).toBe("review");
    // ...and the attestation subtree survived, still in status, unmutated.
    expect((enc2.status?.attestations as Record<string, Attestation>).r1.verdict).toBe("pass");
    expect(final.attestations.r1.verdict).toBe("pass");
    expect(final.attestationHistory).toHaveLength(1);
  });
});

describe("SEAL A1 — evaluateCompletionGate (pure, level-triggered)", () => {
  const req = (over: Partial<EvidenceRequirement> = {}): EvidenceRequirement => ({ id: "r1", kind: "freeform", ...over });
  const gate = (reqs: EvidenceRequirement[], attestations: Record<string, Attestation>) =>
    evaluateCompletionGate({ evidenceRequirements: reqs, attestations });

  it("no verifier-attestation requirements → satisfied (gate is inert for executor-evidence reqs)", () => {
    expect(gate([req(), req({ id: "r2", evidenceAuthority: "executor-evidence" })], {})).toEqual({
      attestationReqsSatisfied: true,
      pendingAttestationReqs: [],
    });
  });

  it("a verifier-attestation requirement with NO active attestation → pending (parks in review)", () => {
    expect(gate([req({ evidenceAuthority: "verifier-attestation" })], {})).toEqual({
      attestationReqsSatisfied: false,
      pendingAttestationReqs: ["r1"],
    });
  });

  it("a verifier-attestation requirement with an active PASS attestation → satisfied", () => {
    expect(gate([req({ evidenceAuthority: "verifier-attestation" })], { r1: attestation({ verdict: "pass" }) })).toEqual({
      attestationReqsSatisfied: true,
      pendingAttestationReqs: [],
    });
  });

  it("a verifier-attestation requirement with an active FAIL attestation → pending", () => {
    expect(gate([req({ evidenceAuthority: "verifier-attestation" })], { r1: attestation({ verdict: "fail" }) })).toEqual({
      attestationReqsSatisfied: false,
      pendingAttestationReqs: ["r1"],
    });
  });

  it("mixed: only the unsatisfied verifier-attestation reqs are pending; executor-evidence reqs ignored", () => {
    const reqs = [
      req({ id: "exec", evidenceAuthority: "executor-evidence" }),
      req({ id: "passed", evidenceAuthority: "verifier-attestation" }),
      req({ id: "unmet", evidenceAuthority: "verifier-attestation" }),
    ];
    expect(gate(reqs, { passed: attestation({ requirementId: "passed", verdict: "pass" }) })).toEqual({
      attestationReqsSatisfied: false,
      pendingAttestationReqs: ["unmet"],
    });
  });
});
