// idea-635 — a failed_sealed row must stop PROJECTING as `ready`.
//
// SCOPE, measured before implementing and narrower than the node was seeded with: sealed rows
// are ALREADY excluded from the claimable surface — substrate:~1984 filters isFailedGateSealed
// out of listReadyForRole (the D3 seal-derived repair), and the idle-wake digest is driven by
// list_ready_work so it inherits that. So "does not appear in list_ready_work" CANNOT go red and
// is not evidence for this change. The defect that remains is that a reader of get_work /
// list_work is shown `status: "ready"` on a row with zero legal verbs, and must reconcile it
// against effectiveDisposition by hand. F1 below tests THAT.
//
// All cases drive production code against the in-memory substrate. Nothing greps source.
import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import type { WorkItem } from "../work-item.js";
import {
  WorkItemRepositorySubstrate,
  isFailedGateSealed,
  projectSealedStatus,
} from "../work-item-repository-substrate.js";

const NOW = "2026-07-25T07:35:00.000Z";
const ARCHITECT = { role: "architect", agentId: "architect-1" };

function work(id: string, over: Partial<WorkItem> = {}): WorkItem {
  return {
    id, type: "task", priority: "normal", roleEligibility: ["engineer"],
    dependsOn: [], completionDependsOn: [], evidenceRequirements: [], references: [],
    targetRef: null, status: "ready", lease: null,
    evidence: [], frictionReflections: [], blockedOn: null, leaseExpiryCount: 0,
    enteredCurrentStateAt: NOW,
    stateDurations: { ready: 0, claimed: 0, in_progress: 0, blocked: 0, paused: 0, review: 0 },
    attestationHistory: [], attestations: {}, executorHistory: [], createdBy: ARCHITECT,
    createdAt: NOW, updatedAt: NOW, ...over,
  } as WorkItem;
}

/** A row bearing an ACTIVE verifier FAIL — the shape that derives effectiveDisposition. */
function sealedRow(id: string): WorkItem {
  const att = {
    verdict: "fail" as const, producedAt: NOW, verifierId: "agent-verifier-1",
    requirementId: "gate", evidenceRefs: [],
    targetRefHash: "t", evidenceSetHash: "e", requirementHash: "r",
  };
  return work(id, {
    type: "verifier-gate",
    evidenceRequirements: [{ id: "gate", kind: "review", evidenceAuthority: "verifier-attestation" } as never],
    attestations: { gate: att } as never,
    attestationHistory: [att] as never,
  });
}

function harness() {
  const substrate = createMemoryStorageSubstrate();
  return { substrate, repo: new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate)) };
}

describe("idea-635 — failed_sealed status projection", () => {
  it("CALIBRATION: the predicate discriminates, and the STORED status really is `ready`", async () => {
    // Establishes the instrument can tell the two row kinds apart BEFORE any case asserts a
    // difference, and pins the premise the fix rests on: the stored status is stale, not absent.
    const { substrate, repo } = harness();
    await substrate.put("WorkItem", sealedRow("cal-sealed") as unknown as Record<string, unknown>);
    await substrate.put("WorkItem", work("cal-plain") as unknown as Record<string, unknown>);
    const sealed = (await repo.getWorkItem("cal-sealed"))!;
    const plain = (await repo.getWorkItem("cal-plain"))!;
    expect(isFailedGateSealed(sealed)).toBe(true);
    expect(isFailedGateSealed(plain)).toBe(false);
    expect(sealed.effectiveDisposition).toBe("failed_sealed");
    expect(plain.effectiveDisposition).toBeNull();
    expect(sealed.status, "the stored status is the stale `ready` this fix projects over").toBe("ready");
  });

  it("F1: a failed_sealed row PROJECTS terminal, not `ready`", async () => {
    const { substrate, repo } = harness();
    await substrate.put("WorkItem", sealedRow("f1-sealed") as unknown as Record<string, unknown>);
    const stored = (await repo.getWorkItem("f1-sealed"))!;
    const projected = projectSealedStatus(stored);
    expect(projected.status, "must not present as workable").not.toBe("ready");
    expect(projected.status).toBe("abandoned");
    expect(projected.effectiveDisposition, "the reason survives alongside the projection").toBe("failed_sealed");
  });

  it("F2: EVERY lifecycle verb remains illegal — all ten, enumerated, not spot-checked", async () => {
    const { substrate, repo } = harness();
    await substrate.put("WorkItem", sealedRow("f2-sealed") as unknown as Record<string, unknown>);
    const id = "f2-sealed";
    const agent = "agent-x";
    const token = "no-such-token";
    // REAL signatures. An earlier version of this case called them with WRONG arities: every call
    // threw a TypeError, a bare `catch` scored each as "refused", and the case went GREEN while
    // testing nothing. tsc caught it; the green run did not. So this now (a) uses the true
    // signatures and (b) requires the refusal to be THE SEAL REFUSAL — a generic error, a typo,
    // or a wrong-phase rejection must NOT count as evidence that the seal held.
    const verbs: Array<[string, () => Promise<unknown>]> = [
      ["claim",    () => repo.claimWorkItem(id, agent, "engineer")],
      ["start",    () => repo.startWork(id, agent, token)],
      ["block",    () => repo.blockWork(id, agent, token, { blockerKind: "dependency", reason: "x" } as never)],
      ["resume",   () => repo.resumeWork(id, agent, token)],
      ["renew",    () => repo.renewLease(id, agent, token)],
      ["release",  () => repo.releaseWork(id, agent, token)],
      ["abandon",  () => repo.abandonWork(id, agent, { reason: "x", leaseToken: token })],
      ["complete", () => repo.completeWork(id, agent, token, [])],
      ["pause",    () => repo.pauseWork({ workId: id, operationId: "op-f2", reason: "x" } as never, ARCHITECT)],
      ["unpause",  () => repo.unpauseWork({ workId: id } as never, ARCHITECT)],
    ];
    const becameLegal: string[] = [];
    const refusedForTheWrongReason: string[] = [];
    for (const [name, call] of verbs) {
      try {
        await call();
        becameLegal.push(name);
      } catch (error) {
        const msg = String((error as Error)?.message ?? error);
        const name_ = String((error as Error)?.name ?? "");
        const isSealRefusal = name_ === "FailedGateSealedRejected" || msg.includes("failed_sealed");
        if (!isSealRefusal) refusedForTheWrongReason.push(`${name}: ${name_ || msg.slice(0, 60)}`);
      }
    }
    expect(becameLegal, `verbs that became LEGAL on a sealed row: ${becameLegal.join(", ")}`).toEqual([]);
    expect(
      refusedForTheWrongReason,
      `these refused but NOT via the seal, so they are not evidence the seal held: ${refusedForTheWrongReason.join(" | ")}`,
    ).toEqual([]);
  });

  it("F3: attestations / attestationHistory / failedGateSeal / evidence are untouched by the projection", async () => {
    const { substrate, repo } = harness();
    await substrate.put("WorkItem", sealedRow("f3-sealed") as unknown as Record<string, unknown>);
    const before = (await repo.getWorkItem("f3-sealed"))!;
    const beforeJson = JSON.stringify({
      attestations: before.attestations, attestationHistory: before.attestationHistory,
      failedGateSeal: before.failedGateSeal, evidence: before.evidence,
    });
    const after = projectSealedStatus(before);
    const afterJson = JSON.stringify({
      attestations: after.attestations, attestationHistory: after.attestationHistory,
      failedGateSeal: after.failedGateSeal, evidence: after.evidence,
    });
    expect(afterJson).toBe(beforeJson);
    // and the STORED row is unchanged — the projection returns a copy, it does not write
    const reread = (await repo.getWorkItem("f3-sealed"))!;
    expect(reread.status, "storage must still hold the original status").toBe("ready");
  });

  it("F4 POSITIVE CONTROL: an independently-constructed ready row is unaffected", async () => {
    // Deliberately unrelated to this arc: the live population of genuinely-ready rows is
    // currently just this node's own successors, which is far too thin and self-referential to
    // control anything. Without this case, F1 and F2 both pass on a change that hides EVERY row.
    const { substrate, repo } = harness();
    await substrate.put("WorkItem", work("f4-unrelated-ready") as unknown as Record<string, unknown>);
    const stored = (await repo.getWorkItem("f4-unrelated-ready"))!;
    const projected = projectSealedStatus(stored);
    expect(projected.status, "a genuinely ready row must still project ready").toBe("ready");
    expect(projected).toBe(stored);   // untouched rows are returned by identity, not copied
    const ready = await repo.listReadyForRole("engineer", 100);
    expect(ready.items.map((i) => i.id)).toContain("f4-unrelated-ready");
  });

  it("REGRESSION GUARD on the D3 repair (work-480) — NOT evidence for this change", async () => {
    // This asserts prior work still holds: the claimable surface already excluded sealed rows
    // BEFORE this node, via isFailedGateSealed in listReadyForRole. Labelled explicitly so it is
    // never read as certifying the idea-635 projection — a test that certifies someone else's
    // fix while appearing to certify yours is the same defect as a vacuous falsifier.
    const { substrate, repo } = harness();
    await substrate.put("WorkItem", sealedRow("guard-sealed") as unknown as Record<string, unknown>);
    await substrate.put("WorkItem", work("guard-plain") as unknown as Record<string, unknown>);
    const ready = await repo.listReadyForRole("engineer", 100);
    const ids = ready.items.map((i) => i.id);
    expect(ids, "D3: sealed rows must stay out of the claimable surface").not.toContain("guard-sealed");
    expect(ids, "positive control — the scan is not simply empty").toContain("guard-plain");
  });
});
