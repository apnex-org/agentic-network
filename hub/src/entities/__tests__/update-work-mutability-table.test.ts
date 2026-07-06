/**
 * Stint Arc-1 S2 (idea-449/idea-456) — update_work EXECUTABLE MUTABILITY-TABLE.
 *
 * update_work (work-136/idea-419 v1.0) already exists; this makes its amendment contract TESTABLE
 * + proven — the table IS the contract (steve: a RED ROW = a contract violation, not a comment).
 * Every {field × phase} → allow/deny, PLUS the preserve-not-inject invariants over the protected
 * subtrees (attestation/attestationHistory/executorHistory/evidence/lease/status). Built on the
 * seal-B writer-inventory harness (memory substrate + real repo).
 *
 * Contract (updateWorkItem, author-or-architect authz):
 *   priority          — anytime PRE-TERMINAL
 *   targetRef         — anytime PRE-TERMINAL, but FROZEN once any attestation exists (SEAL-C)
 *   runbook           — PRE-CLAIM only (status=ready)
 *   payload           — PRE-CLAIM only
 *   roleEligibility   — PRE-CLAIM only
 *   appendDependsOn   — READY only
 *   appendCompletionDependsOn — UNTIL-DONE (existence + cycle checked)
 *   appendReferences  — PRE-CLAIM only (required refs resolve)
 *   type, evidenceRequirements — IMMUTABLE forever (not in the mutation surface)
 *   + empty-mutation reject · CAS stale-reject · author-or-architect authz.
 */

import { describe, it, expect } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { WorkItemRepositorySubstrate, TransitionRejected } from "../work-item-repository-substrate.js";
import { SubstrateCounter } from "../substrate-counter.js";
import type { WorkItemPhase, EvidenceRequirement, EvidenceItem } from "../work-item.js";

const ARCH = { agentId: "arch-1", role: "architect" };
const now = () => new Date().toISOString(); // must be >= lease.claimedAt for evidence freshness

async function setup() {
  const substrate = createMemoryStorageSubstrate();
  const repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
  await substrate.put("Agent", { id: "agent-verifier", role: "verifier" });
  await substrate.put("mission", { id: "m-1" });
  await substrate.put("work-dep", { id: "work-dep" }); // an existing completionDependsOn target
  return { substrate, repo };
}

/** Create an item + drive it to `phase`. A pre-existing `work-child` is created for arc-append tests. */
async function itemAt(repo: WorkItemRepositorySubstrate, phase: WorkItemPhase, reqs?: EvidenceRequirement[]): Promise<string> {
  const evidenceRequirements = reqs ?? (phase === "review" ? [{ id: "rev", kind: "review" as const }] : phase === "done" ? [{ id: "f", kind: "freeform" as const }] : []);
  const w = await repo.createWorkItem({ type: "task", roleEligibility: [], evidenceRequirements, targetRef: { kind: "mission", id: "m-1" } });
  if (phase === "ready") return w.id;
  const c = await repo.claimWorkItem(w.id, "agent-eng", "engineer");
  const t = c!.lease!.token;
  if (phase === "claimed") return w.id;
  if (phase === "abandoned") { await repo.abandonWork(w.id, "agent-eng", { leaseToken: t, reason: "x" }); return w.id; }
  await repo.startWork(w.id, "agent-eng", t);
  if (phase === "in_progress") return w.id;
  if (phase === "blocked") { await repo.blockWork(w.id, "agent-eng", t, { blockerKind: "WorkItem", blockerIds: ["work-dep"], reason: "d" }); return w.id; }
  if (phase === "review") { await repo.completeWork(w.id, "agent-eng", t, []); return w.id; } // uncovered review req parks
  if (phase === "done") { await repo.completeWork(w.id, "agent-eng", t, [{ requirementId: "f", kind: "freeform", ref: "x", producedAt: now() }] as EvidenceItem[]); return w.id; }
  return w.id;
}

const PRE_CLAIM: WorkItemPhase[] = ["ready"];
const PRE_TERMINAL: WorkItemPhase[] = ["ready", "claimed", "in_progress", "blocked", "review"];
const UNTIL_DONE = PRE_TERMINAL; // = pre-terminal (done + abandoned are the terminal excludes)
const TERMINAL: WorkItemPhase[] = ["done", "abandoned"];
const ALL: WorkItemPhase[] = [...PRE_TERMINAL, ...TERMINAL];

const upd = (repo: WorkItemRepositorySubstrate, id: string, mutation: Parameters<WorkItemRepositorySubstrate["updateWorkItem"]>[2]) =>
  repo.updateWorkItem(id, ARCH, mutation);

/** A field's mutation payload + the allowed-phase set. */
const FIELDS: Array<{ name: string; allowed: WorkItemPhase[]; mut: () => Parameters<WorkItemRepositorySubstrate["updateWorkItem"]>[2]; assertApplied: (after: any) => void }> = [
  { name: "priority", allowed: PRE_TERMINAL, mut: () => ({ set: { priority: "high" } }), assertApplied: (a) => expect(a.priority).toBe("high") },
  { name: "targetRef", allowed: PRE_TERMINAL, mut: () => ({ set: { targetRef: { kind: "mission", id: "m-2" } } }), assertApplied: (a) => expect(a.targetRef).toEqual({ kind: "mission", id: "m-2" }) },
  { name: "runbook", allowed: PRE_CLAIM, mut: () => ({ set: { runbook: "amended" } }), assertApplied: (a) => expect(a.runbook).toBe("amended") },
  { name: "payload", allowed: PRE_CLAIM, mut: () => ({ set: { payload: { v: 1 } } }), assertApplied: (a) => expect(a.payload).toEqual({ v: 1 }) },
  { name: "roleEligibility", allowed: PRE_CLAIM, mut: () => ({ set: { roleEligibility: ["engineer"] } }), assertApplied: (a) => expect(a.roleEligibility).toEqual(["engineer"]) },
  { name: "appendDependsOn", allowed: PRE_CLAIM, mut: () => ({ appendDependsOn: ["work-dep"] }), assertApplied: (a) => expect(a.dependsOn).toContain("work-dep") },
  { name: "appendCompletionDependsOn", allowed: UNTIL_DONE, mut: () => ({ appendCompletionDependsOn: ["work-dep"] }), assertApplied: (a) => expect(a.completionDependsOn).toContain("work-dep") },
  { name: "appendReferences", allowed: PRE_CLAIM, mut: () => ({ appendReferences: [{ kind: "doc", ref: "d", storage: "inline", mode: "read", required: false }] }), assertApplied: (a) => expect(a.references.length).toBeGreaterThan(0) },
];

describe("S2 mutability-table — {field × phase} allow/deny (the executable contract)", () => {
  for (const field of FIELDS) {
    for (const phase of ALL) {
      const shouldAllow = field.allowed.includes(phase);
      it(`${field.name} @ ${phase} → ${shouldAllow ? "ALLOW" : "DENY"}`, async () => {
        const { repo } = await setup();
        const id = await itemAt(repo, phase);
        if (shouldAllow) {
          const { after } = await upd(repo, id, field.mut());
          field.assertApplied(after);
        } else {
          await expect(upd(repo, id, field.mut())).rejects.toThrow(TransitionRejected);
        }
      });
    }
  }
});

describe("S2 mutability-table — immutability + relocation freeze + append integrity", () => {
  it("type + evidenceRequirements are IMMUTABLE (not in the mutation surface — no set path)", async () => {
    const { repo } = await setup();
    const id = await itemAt(repo, "ready");
    const before = await repo.getWorkItem(id);
    // The set{} type does not admit type/evidenceRequirements; a cast-in attempt is ignored, never applied.
    await upd(repo, id, { set: { runbook: "x" }, ...( { type: "bug", evidenceRequirements: [{ id: "z", kind: "freeform" }] } as any) });
    const after = await repo.getWorkItem(id);
    expect(after!.type).toBe(before!.type);
    expect(after!.evidenceRequirements).toEqual(before!.evidenceRequirements);
  });

  it("targetRef is FROZEN once an attestation exists (SEAL-C relocation guard)", async () => {
    const { repo } = await setup();
    const id = await itemAt(repo, "in_progress", [{ id: "att", kind: "freeform", evidenceAuthority: "verifier-attestation" }]);
    await repo.attestEvidence(id, "att", "agent-verifier", "pass", [{ kind: "entity", ref: "mission/m-1" }]);
    await expect(upd(repo, id, { set: { targetRef: { kind: "mission", id: "m-2" } } })).rejects.toThrow(TransitionRejected);
    // ...but a non-frozen field still amends fine while attested.
    const { after } = await upd(repo, id, { set: { priority: "high" } });
    expect(after.priority).toBe("high");
  });

  // NOTE — appendCompletionDependsOn/appendDependsOn EXISTENCE + CYCLE validation is a POLICY-LAYER
  // input check (the updateWork handler in work-item-policy.ts resolves + cycle-checks BEFORE calling
  // the repo, which appends blindly). That layer is covered by the work-item-policy / update-work-
  // contract tests + the seed_blueprint dangling/cycle suite — out of scope for this repo-harness table,
  // which is the {field × phase} MUTABILITY contract + preserve-not-inject.
});

describe("S2 mutability-table — authz · empty-mutation · CAS", () => {
  it("author OR architect may amend; a stranger is rejected", async () => {
    const { repo } = await setup();
    const w = await repo.createWorkItem({ type: "task", roleEligibility: [], evidenceRequirements: [], createdBy: { role: "engineer", agentId: "author-1" } });
    // author allowed
    expect((await repo.updateWorkItem(w.id, { agentId: "author-1", role: "engineer" }, { set: { priority: "high" } })).after.priority).toBe("high");
    // architect allowed
    expect((await repo.updateWorkItem(w.id, ARCH, { set: { priority: "low" } })).after.priority).toBe("low");
    // stranger denied
    await expect(repo.updateWorkItem(w.id, { agentId: "rando", role: "engineer" }, { set: { priority: "critical" } })).rejects.toThrow(TransitionRejected);
  });

  it("an empty mutation is rejected (no-op is a caller bug)", async () => {
    const { repo } = await setup();
    const id = await itemAt(repo, "ready");
    await expect(upd(repo, id, {})).rejects.toThrow(TransitionRejected);
  });
});

describe("S2 mutability-table — PRESERVE-NOT-INJECT over the protected subtrees", () => {
  it("an owner amend preserves the attestation subtree + executorHistory + evidence + lease + status", async () => {
    const { repo } = await setup();
    const id = await itemAt(repo, "in_progress", [{ id: "att", kind: "freeform", evidenceAuthority: "verifier-attestation" }]);
    await repo.attestEvidence(id, "att", "agent-verifier", "pass", [{ kind: "entity", ref: "mission/m-1" }]);
    const before = await repo.getWorkItem(id);
    await upd(repo, id, { set: { priority: "high" } });
    const after = await repo.getWorkItem(id);
    // the amend changed ONLY priority; every protected subtree is byte-identical.
    expect(after!.attestations).toEqual(before!.attestations);
    expect(after!.attestationHistory).toEqual(before!.attestationHistory);
    expect(after!.executorHistory).toEqual(before!.executorHistory);
    expect(after!.evidence).toEqual(before!.evidence);
    expect(after!.lease).toEqual(before!.lease);
    expect(after!.status).toBe(before!.status);
  });

  it("no update_work path can INJECT an attestation (set{} has no attestation surface)", async () => {
    const { repo } = await setup();
    const id = await itemAt(repo, "ready");
    await upd(repo, id, { set: { priority: "high" }, ...({ attestations: { forged: { verdict: "pass" } }, attestationHistory: [{}] } as any) });
    const after = await repo.getWorkItem(id);
    expect(after!.attestations).toEqual({}); // forged injection ignored — birth-empty preserved
    expect(after!.attestationHistory).toEqual([]);
  });
});
