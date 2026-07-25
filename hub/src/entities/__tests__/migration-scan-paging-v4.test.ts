// bug-371 / work-517 — THE MIGRATION SCAN MUST BE EXHAUSTIVE.
//
// WHAT THE LIVE RUN DID, and why this file exists:
//   scanned=500  matched=0  wouldWrite=0  skipped=500  truncated=TRUE  exit=1
// The shipped migration called `listWorkItems()` ONCE — a single LIST_CAP-limited read. I cleared
// that caveat as "inert at n=12". n=12 IS THE MATCH COUNT, NOT THE SCAN POPULATION: the corpus is
// 500+ rows, the twelve targets sort beyond the cap, and the scan never reached them. A number
// stated without the population it counts, inside the one caveat we had explicitly cleared.
//
// 🔴 EVERY PRE-EXISTING FIXTURE FITS IN ONE PAGE, so the whole suite passed against a scan that
// could only ever see the first 500 rows. A FIXTURE THAT CANNOT CONSTRUCT THE CONDITION CANNOT
// TEST IT — the same shape as the stale-projection hole on work-513.
//
// WHY NOT A TARGETED QUERY (option b), MEASURED and not to be revisited: `effectiveDisposition` is
// assigned during DECODE and is NOT stored, while `substrate.list` filters evaluate in the storage
// layer BEFORE decode. `failedGateSeal` is stored but null on this whole population. And
// `status.phase` only becomes terminal AFTER the migration — the one stored marker that would
// select the targets is the value being written. Circular. So exhaustiveness must come from
// PAGING, not from a predicate.
import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import type { WorkItem } from "../work-item.js";
import { WorkItemRepositorySubstrate } from "../work-item-repository-substrate.js";

const NOW = "2026-07-25T09:45:00.000Z";
const ARCHITECT = { role: "architect", agentId: "architect-1" };

/** The substrate's own silent clamp — `Math.min(limit ?? 100, 500)`, measured in both impls. */
const CAP = 500;

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

/** The live pre-v2 sealed shape: stored `ready`, failedGateSeal null, terminal via active FAIL. */
function sealed(id: string): WorkItem {
  const att = {
    verdict: "fail" as const, producedAt: NOW, verifierId: "agent-verifier-1",
    requirementId: "gate", evidenceRefs: [], targetRefHash: "t", evidenceSetHash: "e", requirementHash: "r",
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

/**
 * Seed `filler` clean rows, then the sealed targets LAST. Ids are zero-padded so insertion order
 * and id order agree — the targets genuinely sort beyond the first page rather than landing there
 * by luck of ordering.
 */
async function seedCorpus(h: ReturnType<typeof harness>, filler: number, targets: number) {
  for (let i = 0; i < filler; i += 1) {
    await h.substrate.put("WorkItem", work(`filler-${String(i).padStart(6, "0")}`) as unknown as Record<string, unknown>);
  }
  const ids: string[] = [];
  for (let i = 0; i < targets; i += 1) {
    const id = `zzz-target-${String(i).padStart(6, "0")}`;
    ids.push(id);
    await h.substrate.put("WorkItem", sealed(id) as unknown as Record<string, unknown>);
  }
  return ids;
}

describe("bug-371 — the migration scan is exhaustive", () => {
  it("CALIBRATION: a corpus larger than one page really is larger, and the targets are not in page one", async () => {
    // Proves the fixture constructs the condition BEFORE anything asserts a scan result. Without
    // this, a passing beyond-cap case is indistinguishable from a fixture that quietly fit in one
    // page — which is exactly how the shipped defect survived its own test suite.
    const h = harness();
    const ids = await seedCorpus(h, CAP + 20, 3);
    const firstPage = await h.substrate.list<WorkItem>("WorkItem", { limit: CAP, offset: 0 });
    expect(firstPage.items.length, "page one is full — so there IS a second page").toBe(CAP);
    const firstPageIds = new Set(firstPage.items.map((i) => i.id));
    for (const id of ids) {
      expect(firstPageIds.has(id), `${id} MUST NOT be in page one, or the case proves nothing`).toBe(false);
    }
  });

  it("🔴 F-BEYOND-CAP: a target sitting past the first page is FOUND and MIGRATED", async () => {
    // THE ONE THAT MATTERS. Goes RED against the shipped single-page scan: it reported
    // matched=0 on exactly this shape in production.
    const h = harness();
    const ids = await seedCorpus(h, CAP + 20, 3);
    const result = await h.repo.migrateSealedRowsToFailedPhase();

    expect(result.truncated, "an exhaustive scan must not report truncation").toBe(false);
    expect(result.scanned, "every row traversed, not just the first page").toBe(CAP + 23);
    expect(result.matched, "the sealed rows past the cap were SEEN").toBe(3);
    expect(result.migrated.map((r) => r.id).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect((await h.repo.getWorkItem(id))!.status, `${id} written`).toBe("failed_sealed");
    }
  });

  it("BOUNDARY: a corpus of EXACTLY one page", async () => {
    const h = harness();
    const ids = await seedCorpus(h, CAP - 2, 2);   // exactly CAP rows total
    const result = await h.repo.migrateSealedRowsToFailedPhase();
    expect(result.scanned).toBe(CAP);
    expect(result.truncated).toBe(false);
    expect(result.migrated.map((r) => r.id).sort()).toEqual([...ids].sort());
  });

  it("BOUNDARY: a corpus that is an EXACT MULTIPLE of the page size", async () => {
    // The case that breaks a loop terminating on an EMPTY page rather than a SHORT one: at exactly
    // 2*CAP the second page is full, so termination requires a third read returning zero.
    const h = harness();
    const ids = await seedCorpus(h, 2 * CAP - 2, 2);   // exactly 2*CAP rows
    const result = await h.repo.migrateSealedRowsToFailedPhase();
    expect(result.scanned).toBe(2 * CAP);
    expect(result.truncated).toBe(false);
    expect(result.migrated.map((r) => r.id).sort()).toEqual([...ids].sort());
  });

  it("IDEMPOTENT ACROSS PAGES: a second full run matches but writes nothing", async () => {
    const h = harness();
    const ids = await seedCorpus(h, CAP + 20, 3);
    const first = await h.repo.migrateSealedRowsToFailedPhase();
    expect(first.migrated.length).toBe(3);

    const second = await h.repo.migrateSealedRowsToFailedPhase();
    // 🔴 PREDICATE NARROWED: `matched` counts rows that STILL EXHIBIT bug-371 (sealed AND stored
    // `ready`). After a successful migration they store `failed_sealed`, so a re-run reports
    // matched=0. THAT IS THE SUCCESS SIGNAL, not a regression — under the old predicate this
    // reported the full sealed count forever and could never indicate completion.
    expect(second.matched, "nothing still misrepresents itself after the first run").toBe(0);
    expect(second.migrated, "and writes nothing on the second pass").toEqual([]);
    expect(second.skipped.length).toBe(CAP + 23);
    for (const id of ids) {
      expect((await h.repo.getWorkItem(id))!.status).toBe("failed_sealed");
    }
  });

  it("DRY-RUN EQUALS REAL ACROSS PAGE BOUNDARIES — the property that makes it a STOP condition", async () => {
    // The architect gates the production run on `matched: 12`. That is only usable if dry and real
    // agree by construction, INCLUDING for rows past the first page.
    const h = harness();
    const ids = await seedCorpus(h, CAP + 20, 3);

    const dry = await h.repo.migrateSealedRowsToFailedPhase({ dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.scanned).toBe(CAP + 23);
    expect(dry.matched).toBe(3);
    expect(dry.migrated.map((r) => r.id).sort()).toEqual([...ids].sort());
    // ...and it wrote NOTHING
    for (const id of ids) {
      expect((await h.repo.getWorkItem(id))!.status, "dry run must not write").toBe("ready");
    }

    const real = await h.repo.migrateSealedRowsToFailedPhase();
    expect(real.migrated.map((r) => r.id).sort(), "real writes EXACTLY what dry reported")
      .toEqual(dry.migrated.map((r) => r.id).sort());
    expect(real.matched).toBe(dry.matched);
    expect(real.scanned).toBe(dry.scanned);
  });

  it("POSITIVE CONTROL: a clean corpus with no targets migrates nothing and reports no truncation", async () => {
    // Without this, every case above passes on a scan that marks everything sealed.
    const h = harness();
    await seedCorpus(h, CAP + 20, 0);
    const result = await h.repo.migrateSealedRowsToFailedPhase();
    expect(result.scanned).toBe(CAP + 20);
    expect(result.matched, "nothing sealed => nothing matched").toBe(0);
    expect(result.migrated).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});
