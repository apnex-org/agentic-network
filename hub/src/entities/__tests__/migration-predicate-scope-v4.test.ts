// bug-371 / predicate scope — THE MIGRATION MUST MATCH THE DEFECT, NOT A LARGER CLAIM.
//
// 🔴 FOUND BY THE FIRST COMPLETE PRODUCTION DRY RUN, after the paging fix let the scan reach the
// whole corpus for the first time:
//   scanned=1565  truncated=false  matched=24  before={ready:12, abandoned:8, paused:4}
// The gate expected 12. THE POPULATION WAS NEVER TWELVE — twelve was the count of sealed rows
// visible through `list_work(status="ready")`, i.e. THE EXACT BIASED FILTER bug-371 EXISTS TO FIX.
// We counted the defect's victims using the defect's own instrument.
//
// The 12 extra rows are GENUINELY SEALED — measured over the complete populations (356 abandoned
// across four proven-contiguous pages, 24 paused in one), all with a real `fail` verdict,
// attestationHistory length 1, failedGateSeal null. `isFailedGateSealed` is NOT over-matching.
//
// 🔴 THE PREDICATE WAS. bug-371's defect is "A SEALED ROW STORED `ready` LOOKS CLAIMABLE". The
// shipped predicate encoded "every sealed row should be stored failed_sealed" — a strictly larger
// and PARTLY DESTRUCTIVE claim:
//   - stored `abandoned` -> rewriting loses that a PERSON ended it. `abandoned` is a DECISION,
//     `failed_sealed` is a VERDICT. Both terminal, both unclaimable, both in TERMINAL_WORK_PHASES,
//     so nothing downstream treats them differently — the ONLY thing a rewrite changes is that we
//     can no longer tell which happened. Irreversible provenance loss for zero operational gain.
//   - stored `paused` -> converting reversible dormancy to terminal is a LIFECYCLE MUTATION riding
//     a DISPLAY correction. Same bundling hazard this arc already diagnosed and unbundled.
// Neither group exhibits bug-371: neither is claimable, neither misrepresents itself as `ready`.
//
// Architect ruling 2026-07-25: LEAVE BOTH. Narrow to SEALED **AND STORED `ready`**.
import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import type { WorkItem, WorkItemPhase } from "../work-item.js";
import { WorkItemRepositorySubstrate, isFailedGateSealed, projectSealedStatus } from "../work-item-repository-substrate.js";

const NOW = "2026-07-25T10:15:00.000Z";
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

/**
 * The live pre-v2 sealed shape at an arbitrary stored phase. MEASURED against production: every
 * one of the 24 carries a real `fail` verdict, attestationHistory length 1, failedGateSeal null.
 */
function sealedAt(id: string, phase: WorkItemPhase): WorkItem {
  const att = {
    verdict: "fail" as const, producedAt: NOW, verifierId: "agent-verifier-1",
    requirementId: "gate", evidenceRefs: [{ ref: "docs/reviews/x.md", kind: "evidence" }],
    targetRefHash: "t", evidenceSetHash: "e", requirementHash: "r",
  };
  return work(id, {
    type: "verifier-gate",
    status: phase,
    evidenceRequirements: [{ id: "gate", kind: "review", evidenceAuthority: "verifier-attestation" } as never],
    attestations: { gate: att } as never,
    attestationHistory: [att] as never,
  });
}

function harness() {
  const substrate = createMemoryStorageSubstrate();
  return { substrate, repo: new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate)) };
}

async function seed(h: ReturnType<typeof harness>, items: WorkItem[]) {
  for (const i of items) await h.substrate.put("WorkItem", i as unknown as Record<string, unknown>);
}

describe("bug-371 — the migration predicate matches the DEFECT, not every sealed row", () => {
  it("CALIBRATION: all three are equally SEALED — so any difference is the PHASE, not the seal", async () => {
    // Pins the premise the whole ruling rests on: the abandoned and paused rows are NOT excluded
    // because they are less sealed. They are excluded because they do not exhibit the defect.
    const h = harness();
    await seed(h, [sealedAt("c-ready", "ready"), sealedAt("c-aband", "abandoned"), sealedAt("c-paused", "paused")]);
    for (const id of ["c-ready", "c-aband", "c-paused"]) {
      const row = (await h.repo.getWorkItem(id))!;
      expect(isFailedGateSealed(row), `${id} IS sealed`).toBe(true);
      expect(row.effectiveDisposition).toBe("failed_sealed");
    }
    // and a plain row is not — the instrument discriminates
    await seed(h, [work("c-plain")]);
    expect(isFailedGateSealed((await h.repo.getWorkItem("c-plain"))!)).toBe(false);
  });

  it("🔴 a sealed stored-`abandoned` row is NOT MATCHED and NOT WRITTEN", async () => {
    // Two assertions on purpose: NOT-MATCHED and NOT-WRITTEN are DIFFERENT FAILURES. A predicate
    // that matches then declines to write would report a misleading `matched` to the operator's
    // stop condition while leaving storage correct — green where it should be loud.
    const h = harness();
    await seed(h, [sealedAt("keep-abandoned", "abandoned")]);
    const before = (await h.repo.getWorkItem("keep-abandoned"))!;
    const result = await h.repo.migrateSealedRowsToFailedPhase();

    expect(result.matched, "NOT MATCHED — it does not exhibit bug-371").toBe(0);
    expect(result.migrated, "NOT WRITTEN").toEqual([]);
    expect(result.skipped).toContain("keep-abandoned");
    const after = (await h.repo.getWorkItem("keep-abandoned"))!;
    expect(after.status, "the DECISION that a person ended it survives").toBe("abandoned");
    expect(JSON.stringify(after), "byte-identical — nothing touched").toBe(JSON.stringify(before));
    // AND THE READ PATH MUST NOT COLLAPSE IT EITHER. Storage keeping the truth is not enough if
    // the projection rewrites it on the way out — measured live: a `paused`/`abandoned` filter was
    // returning rows that DISPLAY `failed_sealed`, so the two harms refused at the write were
    // already present in the read.
    expect(projectSealedStatus(after).status, "DISPLAYS abandoned, not a verdict").toBe("abandoned");
  });

  it("🔴 a sealed stored-`paused` row is NOT MATCHED and NOT WRITTEN", async () => {
    const h = harness();
    await seed(h, [sealedAt("keep-paused", "paused")]);
    const before = (await h.repo.getWorkItem("keep-paused"))!;
    const result = await h.repo.migrateSealedRowsToFailedPhase();

    expect(result.matched, "NOT MATCHED — a paused row is not claimable").toBe(0);
    expect(result.migrated, "NOT WRITTEN — no lifecycle mutation rides a display fix").toEqual([]);
    expect(result.skipped).toContain("keep-paused");
    const after = (await h.repo.getWorkItem("keep-paused"))!;
    expect(after.status).toBe("paused");
    expect(JSON.stringify(after), "byte-identical — nothing touched").toBe(JSON.stringify(before));
    expect(projectSealedStatus(after).status, "DISPLAYS paused — reversible dormancy, not terminal").toBe("paused");
  });

  it("the stored-`ready` rows STILL match, and every `before` is `ready`", async () => {
    // The positive half. Without it the two exclusions above pass on a predicate that matches
    // NOTHING — which would also leave abandoned and paused untouched, for the wrong reason.
    const h = harness();
    await seed(h, [sealedAt("fix-a", "ready"), sealedAt("fix-b", "ready"), work("plain")]);
    const result = await h.repo.migrateSealedRowsToFailedPhase();

    expect(result.matched).toBe(2);
    expect(result.migrated.map((r) => r.id).sort()).toEqual(["fix-a", "fix-b"]);
    expect(result.migrated.every((r) => r.before === "ready"), "every before is `ready`").toBe(true);
    expect(result.migrated.every((r) => r.after === "failed_sealed")).toBe(true);
    expect(result.skipped, "the clean row is skipped, not rewritten").toContain("plain");
  });

  it("MIXED POPULATION — the production shape: ready migrates, abandoned and paused do not", async () => {
    // The actual live distribution in miniature: 12 ready / 8 abandoned / 4 paused, scaled down.
    // A per-phase assertion, because a total-count assertion alone would pass if the predicate
    // migrated an abandoned row and missed a ready one.
    const h = harness();
    await seed(h, [
      sealedAt("r1", "ready"), sealedAt("r2", "ready"), sealedAt("r3", "ready"),
      sealedAt("a1", "abandoned"), sealedAt("a2", "abandoned"),
      sealedAt("p1", "paused"),
      work("clean-1"), work("clean-2"),
    ]);
    const result = await h.repo.migrateSealedRowsToFailedPhase();

    expect(result.matched).toBe(3);
    expect(result.migrated.map((r) => r.id).sort()).toEqual(["r1", "r2", "r3"]);
    expect((await h.repo.getWorkItem("a1"))!.status).toBe("abandoned");
    expect((await h.repo.getWorkItem("a2"))!.status).toBe("abandoned");
    expect((await h.repo.getWorkItem("p1"))!.status).toBe("paused");
    expect((await h.repo.getWorkItem("clean-1"))!.status).toBe("ready");
  });

  it("🔴 THE LIVE REPRODUCTION: a `paused` filter must stop returning rows that SAY failed_sealed", async () => {
    // Directly reproduces the read the architect ran against production:
    //   list_work(status="paused") -> total 24, DISPLAYED: 20 paused + 4 FAILED_SEALED
    // The storage filter is correct pre-decode; the projection then rewrote what they said. This
    // asserts the projected phase of every row a `paused` filter selects is still `paused`.
    const h = harness();
    await seed(h, [
      sealedAt("lp1", "paused"), sealedAt("lp2", "paused"),
      work("lp3", { status: "paused" }), work("lp4", { status: "paused" }),
    ]);
    const { items } = await h.repo.listWorkItems({ status: "paused" });
    expect(items.length, "the storage filter selects all four").toBe(4);
    const displayed = items.map((i) => projectSealedStatus(i).status).sort();
    expect(displayed, "NO row selected by a `paused` filter may display anything else")
      .toEqual(["paused", "paused", "paused", "paused"]);
  });

  it("the stored-`ready` sealed rows STILL DISPLAY failed_sealed — the projection keeps working", async () => {
    // The positive control on the projection half. Without it, the two display exclusions above
    // pass on a change that guts projectSealedStatus entirely and reverts work-505.
    const h = harness();
    await seed(h, [sealedAt("disp-ready", "ready"), work("disp-plain")]);
    const sealedRow = (await h.repo.getWorkItem("disp-ready"))!;
    expect(projectSealedStatus(sealedRow).status, "a sealed stored-`ready` row still projects terminal")
      .toBe("failed_sealed");
    const plain = (await h.repo.getWorkItem("disp-plain"))!;
    expect(projectSealedStatus(plain), "an unsealed row is returned by identity").toBe(plain);
  });

  it("dry-run reports the SAME narrowed set — the operator's stop condition stays honest", async () => {
    const h = harness();
    await seed(h, [sealedAt("d1", "ready"), sealedAt("d2", "abandoned"), sealedAt("d3", "paused")]);
    const dry = await h.repo.migrateSealedRowsToFailedPhase({ dryRun: true });
    expect(dry.matched, "dry must narrow identically, or `matched: N` is not a usable STOP").toBe(1);
    expect(dry.migrated.map((r) => r.id)).toEqual(["d1"]);
    const real = await h.repo.migrateSealedRowsToFailedPhase();
    expect(real.matched).toBe(dry.matched);
    expect(real.migrated.map((r) => r.id)).toEqual(dry.migrated.map((r) => r.id));
  });
});
