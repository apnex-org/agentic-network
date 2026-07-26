
const NO_FRICTION = { observed: false, summary: "no friction observed" } as const;

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
 *   priority          — anytime PRE-TERMINAL (including paused scalar metadata)
 *   targetRef         — PRE-TERMINAL except paused; also FROZEN once any attestation exists (SEAL-C)
 *   runbook           — PRE-CLAIM only (status=ready)
 *   payload           — PRE-CLAIM only
 *   roleEligibility   — PRE-CLAIM only
 *   appendDependsOn   — READY only
 *   appendCompletionDependsOn — UNTIL-DONE except paused; active-generation edits require revision
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
  if (phase === "paused") {
    await repo.pauseWork({ workId: w.id, operationId: "mutability-paused", reason: "matrix" }, ARCH);
    return w.id;
  }
  const c = await repo.claimWorkItem(w.id, "agent-eng", "engineer");
  const t = c!.lease!.token;
  if (phase === "claimed") return w.id;
  if (phase === "abandoned") { await repo.abandonWork(w.id, "agent-eng", { leaseToken: t, reason: "x" }); return w.id; }
  await repo.startWork(w.id, "agent-eng", t);
  if (phase === "in_progress") return w.id;
  if (phase === "blocked") { await repo.blockWork(w.id, "agent-eng", t, { blockerKind: "WorkItem", blockerIds: ["work-dep"], reason: "d" }); return w.id; }
  if (phase === "review") { await repo.completeWork(w.id, "agent-eng", t, [], NO_FRICTION); return w.id; } // uncovered review req parks
  if (phase === "done") { await repo.completeWork(w.id, "agent-eng", t, [{ requirementId: "f", kind: "freeform", ref: "x", producedAt: now() }] as EvidenceItem[], NO_FRICTION); return w.id; }
  return w.id;
}

const PRE_CLAIM: WorkItemPhase[] = ["ready"];
const PRE_TERMINAL: WorkItemPhase[] = ["ready", "claimed", "in_progress", "blocked", "review"];
const SCALAR_PRE_TERMINAL: WorkItemPhase[] = [...PRE_TERMINAL, "paused"];
const UNTIL_DONE = PRE_TERMINAL; // paused contract/topology is frozen; done + abandoned terminal

// 🔴 decision-11 ⨯ idea-640 — SUPERSESSION. See docs/design/nodefix0-decision-11-supersession.md.
// BOTH contract ids are named here on purpose: the table below is not a stale assertion being
// corrected, it is a RATIFIED CONTRACT BEING REPLACED, and a future reader must find the conflict and
// its resolution in the same place.
//
// decision-11 governed mutability by PHASE (pre-claim / until-terminal / forever). idea-640 governs it
// by MANAGEMENT TIER (live / suspended+lease / suspended+no-lease). Different axes, so every row moves.
//
//   NARROWED   `targetRef` was mutable UNTIL TERMINAL — i.e. on a live, claimed, in-flight row.
//              It is now refused while HELD. THAT IS A REAL CAPABILITY REMOVAL. It appears nowhere in
//              idea-640; it follows by implication from the Director's absolute `LIVE -> modify DOES
//              NOT FUNCTION`, and is recorded as a DECISION so nobody later reports it as a regression.
//   WIDENED    `runbook`/`payload`/`roleEligibility` were PRE-CLAIM ONLY and are now editable on a
//              SUSPENDED row — the amendment decision-11's own out-of-scope list invited:
//              "lease-holder mutation authority (revisit with evidence)". idea-640 is that revisit.
//   UNCHANGED  pre-claim authoring. An unclaimed `ready` row has NO HOLDER, so editing it disturbs
//              nobody. Reading the absolute as "not suspended => refuse" would ALSO delete pre-claim
//              editing — a narrowing the supersession does not record. Measured twice: this table red
//              `targetRef @ ready -> ALLOW` both times that was got wrong.
//
// ⚠️ `priority` IS NOT NARROWED HERE, AND THAT IS A FLAG, NOT A DECISION. The supersession lists it as
// NARROWED to the MINOR tier, but `priority` is not a claimant-contract field — it is scalar metadata,
// absent from `changesClaimantAuthority`, and narrowing it has no anti-gameability or
// contract-stability rationale. Implementing that removal is a behaviour change with a cost and no
// stated benefit, so it is REPORTED rather than taken unilaterally. Table left at the ratified
// decision-11 behaviour for this one field pending a ruling.
//
// SUSPENDED ROWS: `itemAt(repo, "paused")` drives pauseWork, which under the attribute model leaves the
// phase alone and sets `suspended`. A row suspended from `ready` therefore has NO LEASE — the FULL
// tier — so every claimant-contract field is editable there.
const MINOR_TIER: WorkItemPhase[] = [...PRE_CLAIM, "paused"];
const TERMINAL: WorkItemPhase[] = ["done", "abandoned"];
const ALL: WorkItemPhase[] = [...SCALAR_PRE_TERMINAL, ...TERMINAL];

const upd = (repo: WorkItemRepositorySubstrate, id: string, mutation: Parameters<WorkItemRepositorySubstrate["updateWorkItem"]>[2]) =>
  repo.updateWorkItem(id, ARCH, mutation);

/** A field's mutation payload + the allowed-phase set. */
const FIELDS: Array<{ name: string; allowed: WorkItemPhase[]; mut: () => Parameters<WorkItemRepositorySubstrate["updateWorkItem"]>[2]; assertApplied: (after: any) => void }> = [
  { name: "priority", allowed: SCALAR_PRE_TERMINAL, mut: () => ({ set: { priority: "high" } }), assertApplied: (a) => expect(a.priority).toBe("high") },
  { name: "targetRef", allowed: MINOR_TIER, mut: () => ({ set: { targetRef: { kind: "mission", id: "m-2" } } }), assertApplied: (a) => expect(a.targetRef).toEqual({ kind: "mission", id: "m-2" }) },
  { name: "runbook", allowed: MINOR_TIER, mut: () => ({ set: { runbook: "amended" } }), assertApplied: (a) => expect(a.runbook).toBe("amended") },
  { name: "payload", allowed: MINOR_TIER, mut: () => ({ set: { payload: { v: 1 } } }), assertApplied: (a) => expect(a.payload).toEqual({ v: 1 }) },
  { name: "roleEligibility", allowed: MINOR_TIER, mut: () => ({ set: { roleEligibility: ["engineer"] } }), assertApplied: (a) => expect(a.roleEligibility).toEqual(["engineer"]) },
  { name: "appendDependsOn", allowed: MINOR_TIER, mut: () => ({ appendDependsOn: ["work-dep"] }), assertApplied: (a) => expect(a.dependsOn).toContain("work-dep") },
  { name: "appendCompletionDependsOn", allowed: MINOR_TIER, mut: () => ({ appendCompletionDependsOn: ["work-dep"] }), assertApplied: (a) => expect(a.completionDependsOn).toContain("work-dep") },
  { name: "appendReferences", allowed: MINOR_TIER, mut: () => ({ appendReferences: [{ kind: "doc", ref: "d", storage: "inline", mode: "read", required: false }] }), assertApplied: (a) => expect(a.references.length).toBeGreaterThan(0) },
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
        } else if (TERMINAL.includes(phase)) {
          // terminal rows reject all mutation, unchanged by the supersession
          await expect(upd(repo, id, field.mut())).rejects.toThrow(TransitionRejected);
        } else {
          // LIVE AND HELD — the tier refusal. Carries the currentness code and names the remedy.
          await expect(upd(repo, id, field.mut())).rejects.toMatchObject({
            code: "workgraph.currentness.revision_required",
          });
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

  it("🔴 targetRef is FROZEN once an attestation exists — SEAL-C, ON THE PATH WHERE IT NOW MATTERS", async () => {
    // 🔴 decision-11 ⨯ idea-640 — THE SUPERSESSION MOVED SEAL-C'S LOAD-BEARING PATH, AND THAT IS EASY
    // TO MISS. On a LIVE HELD row, targetRef is now refused by the TIER gate first, so SEAL-C never
    // runs there — it is shadowed, not removed. But the supersession WIDENED targetRef to SUSPENDED
    // rows, and on those the tier ALLOWS the edit, so SEAL-C at :1103 is the ONLY thing standing
    // between an attested row and a relocation that would launder a pass verdict onto a different
    // deliverable. THE GUARD DID NOT CHANGE; THE PATH THAT DEPENDS ON IT DID.
    const { repo } = await setup();
    const id = await itemAt(repo, "in_progress", [{ id: "att", kind: "freeform", evidenceAuthority: "verifier-attestation" }]);
    await repo.attestEvidence(id, "att", "agent-verifier", "pass", [{ kind: "entity", ref: "mission/m-1" }]);

    // (a) LIVE + HELD: refused by the tier, before SEAL-C is reached.
    await expect(upd(repo, id, { set: { targetRef: { kind: "mission", id: "m-2" } } }))
      .rejects.toMatchObject({ code: "workgraph.currentness.revision_required" });

    // (b) SUSPENDED: the tier now ALLOWS a targetRef edit — and SEAL-C must refuse it anyway.
    // Without this case, the widening silently opens a relocation path on every attested row.
    await repo.pauseWork({ workId: id, operationId: "sealc-suspend", reason: "seal-c path" } as never, ARCH);
    await expect(upd(repo, id, { set: { targetRef: { kind: "mission", id: "m-2" } } }))
      .rejects.toThrow(TransitionRejected);
    expect((await repo.getWorkItem(id))!.targetRef, "the relocation did not land").toEqual({ kind: "mission", id: "m-1" });

    // ...and a non-frozen field still amends fine while attested + suspended.
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
