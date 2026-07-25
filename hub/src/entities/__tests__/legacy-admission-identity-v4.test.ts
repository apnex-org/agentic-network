// bug-364 / bug-372 — ABSENT IS NOT DIFFERENT.
//
// `existing.X !== row.X` is true when X is DIFFERENT and when X is ABSENT, and those mean opposite
// things. Every row written before the v4 identity existed carries all of them undefined, so the
// persist-time comparison read "unidentified" as "conflicting" and refused it — stranding, for
// good, every row that exists today. That is bug-364, and it is what makes bug-372's eight paused
// rows immobile: their only named escape is a semantic revision, which this refusal blocks.
//
// OPERANDS, printed before any of this was written (work-513 probe, reproduced independently of
// steve's work-510 on this base):
//   EXISTING (stored legacy row)   9/9 ABSENT
//   CANDIDATE (production's own row construction)  9/9 POPULATED, real derived hashes
//   SEAL/IDENTITY FIELD OVERLAP    0
//   stage 3 persistProjectedWorkItems  REJECTED storage.immutable_conflict   <- F1's observed red
//
// 🔴 A CORRECTION TO THE PREMISE, carried here because the round number is repeated in several
// docs: it was never "nine fields conflated". The old comparison coerced
// `existing.boundReferences ?? []`, so an ABSENT boundReferences already compared EQUAL to an empty
// candidate. EIGHT were conflated; boundReferences was already tolerant. The refusal was always
// driven by the other eight. That is why absence is tested with `=== undefined` and nothing
// looser — `boundReferences: []` is PRESENT-and-empty and must never read as unidentified.
import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import type { WorkItem } from "../work-item.js";
import { WorkItemRepositorySubstrate } from "../work-item-repository-substrate.js";
import { WorkRevisionStorageRepositoryV4, buildWorkRevisionStorageV4 } from "../work-revision-storage-v4.js";

const NOW = "2026-07-25T09:20:00.000Z";
const ARCHITECT = { role: "architect", agentId: "architect-1" };

const IDENTITY_FIELDS = [
  "logicalId", "revision", "nodeContractHashVersion", "nodeContractHash",
  "nodeTopologyHashVersion", "nodeTopologyHash", "localExecutionIdentity",
  "topologyGeneration", "boundReferences",
] as const;

/** The four the retention constraint protects. Overlap with IDENTITY_FIELDS is asserted to be 0. */
const SEAL_FIELDS = ["attestations", "attestationHistory", "failedGateSeal", "evidence"] as const;

function base(id: string, over: Partial<WorkItem> = {}): WorkItem {
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

// ── F6: the FOUR REAL LIVE SHAPES ────────────────────────────────────────────────────────────
// Modelled field-by-field on rows read from the live Hub, NOT invented. steve's population was
// synthetic (two shapes); these are the shapes we are actually reasoning about.

/** work-465 — a bug-372 stranded row. MEASURED: freeform, paused, payload-bearing, NO identity. */
function pausedStampless(id: string): WorkItem {
  return base(id, {
    type: "freeform",
    status: "paused",
    roleEligibility: ["architect"],
    targetRef: { id: "work-bp-target", kind: "workitem" },
    payload: {
      repo: "apnex/mission-kit", prNumber: 13, provenance: "hub",
      obligationKind: "github_pr_workgraph_binding",
    },
  } as Partial<WorkItem>);
}

/** work-469 — a retained FAIL row. MEASURED: verifier-gate, stored `ready`, active FAIL, seal null. */
function sealedRow(id: string): WorkItem {
  const att = {
    verdict: "fail" as const, producedAt: NOW, verifierId: "agent-verifier-1",
    requirementId: "gate", evidenceRefs: [{ ref: "docs/reviews/x.md", kind: "evidence" }],
    targetRefHash: "t", evidenceSetHash: "e", requirementHash: "r",
  };
  return base(id, {
    type: "verifier-gate",
    evidenceRequirements: [{ id: "gate", kind: "review", evidenceAuthority: "verifier-attestation" } as never],
    attestations: { gate: att } as never,
    attestationHistory: [att] as never,
    evidence: [{ requirementId: "gate", kind: "doc", ref: "docs/y.md", producedAt: NOW } as never],
  });
}

/** An ACTIVE row — claimed and started, lease held. */
function activeRow(id: string): WorkItem {
  return base(id, {
    status: "in_progress",
    lease: { token: "tok", holder: "agent-x", claimedAt: NOW, expiresAt: NOW, heartbeatAt: NOW } as never,
    executorHistory: ["agent-x"],
  });
}

/** A DONE row — completed with evidence and a friction reflection. */
function doneRow(id: string): WorkItem {
  return base(id, {
    status: "done",
    evidence: [{ requirementId: "commit", kind: "commit", ref: "abc1234", producedAt: NOW } as never],
    frictionReflections: [{ summary: "x", observed: true, producedAt: NOW, producedBy: "agent-x" } as never],
    executorHistory: ["agent-x"],
  });
}

function harness() {
  const substrate = createMemoryStorageSubstrate();
  return {
    substrate,
    storage: new WorkRevisionStorageRepositoryV4(substrate),
    repo: new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate)),
  };
}

function build(items: WorkItem[], generation: number, previousGeneration: number, operationId: string) {
  return buildWorkRevisionStorageV4({
    workItems: items,
    boundReferencesByPhysicalId: Object.fromEntries(items.map((i) => [i.id, []])),
    familyScopesByPhysicalId: Object.fromEntries(items.map((i) => [i.id, { kind: "mission" as const, id: "m" }])),
    generation, previousGeneration, operationId, createdAt: NOW,
  });
}

/** Push a row straight into storage — a LEGACY row, never through a generation. */
async function seedLegacy(h: ReturnType<typeof harness>, item: WorkItem) {
  await h.substrate.put("WorkItem", item as unknown as Record<string, unknown>);
}

/** The four protected fields, serialised the way the baseline records them (idea-638 scope). */
function sealBytes(w: WorkItem): string {
  return JSON.stringify({
    a: w.attestations, h: w.attestationHistory, s: w.failedGateSeal, e: w.evidence,
  });
}

function absentCount(w: WorkItem): number {
  return IDENTITY_FIELDS.filter((f) => (w as unknown as Record<string, unknown>)[f] === undefined).length;
}

/** Run the real 3-stage path and return the error code, or null on success. */
async function persistAndCatch(h: ReturnType<typeof harness>, built: ReturnType<typeof build>): Promise<string | null> {
  await h.storage.persistPrepared(built);
  try {
    await h.storage.persistProjectedWorkItems(built);
    return null;
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    return message.split(":")[0];
  }
}

describe("bug-364 — absent-vs-different at the persist admission gate", () => {
  it("CALIBRATION: the instrument sees all three populations, and seal/identity overlap is ZERO", async () => {
    // Before any case asserts an outcome: prove the absence predicate can produce 9, 0 and a
    // middling value. Without this, a 9 is a bare number rather than a discriminated reading.
    const h = harness();
    await seedLegacy(h, base("cal-legacy"));
    const legacy = (await h.repo.getWorkItem("cal-legacy"))!;
    expect(absentCount(legacy), "a legacy row: all nine absent").toBe(9);

    // the version literals are the REAL ones the builder emits, measured by the work-513 probe —
    // they are literal-typed, so an invented placeholder would not even compile
    const fullyIdentified = base("cal-full", {
      logicalId: "cal-full", revision: 1,
      nodeContractHashVersion: "node-contract-v4", nodeContractHash: "h",
      nodeTopologyHashVersion: "node-topology-v4", nodeTopologyHash: "h",
      localExecutionIdentity: "lei", topologyGeneration: 1, boundReferences: [],
    } as Partial<WorkItem>);
    expect(absentCount(fullyIdentified), "a fully identified row: none absent").toBe(0);

    const mixed = base("cal-mixed", { logicalId: "cal-mixed", revision: 1 } as Partial<WorkItem>);
    expect(absentCount(mixed), "a mixed row: strictly between").toBe(7);

    // the disjointness the whole design rests on, measured rather than inherited
    const overlap = (IDENTITY_FIELDS as readonly string[]).filter((f) => (SEAL_FIELDS as readonly string[]).includes(f));
    expect(overlap, "identity and seal fields MUST NOT overlap").toEqual([]);
  });

  it("F1: a LEGACY row (all nine absent) is ADMITTED and its identity materialized", async () => {
    const h = harness();
    await seedLegacy(h, base("legacy-a"));
    const before = (await h.repo.getWorkItem("legacy-a"))!;
    expect(absentCount(before), "precondition: the row really is unidentified").toBe(9);

    const code = await persistAndCatch(h, build([before], 1, 0, "op-1"));
    expect(code, "a legacy row must PERSIST — this is the red that observed first").toBeNull();

    const after = (await h.repo.getWorkItem("legacy-a"))!;
    expect(absentCount(after), "and it is now fully identified").toBe(0);
    expect(after.logicalId).toBe("legacy-a");
    expect(after.revision).toBe(1);
    expect(typeof after.localExecutionIdentity).toBe("string");
    expect((after.localExecutionIdentity as string).length).toBeGreaterThan(16);
  });

  it("F2: a FULLY IDENTIFIED row whose identity genuinely DIFFERS is still refused — immutable_conflict", async () => {
    // ASSERT WHICH REFUSAL. A generic throw would satisfy "it refused" while proving nothing about
    // which of the two diagnoses fired, and the two mean opposite things.
    const h = harness();
    await seedLegacy(h, base("legacy-b"));
    const stored = (await h.repo.getWorkItem("legacy-b"))!;
    await persistAndCatch(h, build([stored, base("sibling")], 1, 0, "op-1"));

    // now it is identified; hand-corrupt ONE identity field and re-admit
    const identified = (await h.repo.getWorkItem("legacy-b"))!;
    expect(absentCount(identified)).toBe(0);
    await h.substrate.put("WorkItem", {
      ...identified, nodeContractHash: "a-genuinely-different-hash",
    } as unknown as Record<string, unknown>);

    const code = await persistAndCatch(h, build([identified, base("sibling")], 2, 1, "op-2"));
    expect(code, "a real mismatch is a real immutable_conflict — UNCHANGED behaviour").toBe("storage.immutable_conflict");
  });

  it("F3: a MIXED row is refused with the NEW distinct code, naming the absent fields", async () => {
    const h = harness();
    // some populated, some absent — neither a first materialization nor a full identity
    await seedLegacy(h, base("legacy-c", { logicalId: "legacy-c", revision: 1 } as Partial<WorkItem>));
    const stored = (await h.repo.getWorkItem("legacy-c"))!;
    expect(absentCount(stored), "precondition: genuinely mixed").toBeGreaterThan(0);
    expect(absentCount(stored)).toBeLessThan(9);

    let message = "";
    await h.storage.persistPrepared(build([stored], 1, 0, "op-1"));
    try {
      await h.storage.persistProjectedWorkItems(build([stored], 1, 0, "op-1"));
    } catch (error) { message = String((error as Error)?.message ?? error); }

    expect(message.split(":")[0], "a DISTINCT code — not immutable_conflict").toBe("storage.partial_identity");
    expect(message, "and it NAMES the absent fields so the refusal is actionable").toContain("nodeContractHash");
    expect(message).toContain("localExecutionIdentity");
    // and it is NOT silently healed
    const after = (await h.repo.getWorkItem("legacy-c"))!;
    expect(absentCount(after), "a mixed row must be left exactly as found").toBe(absentCount(stored));
  });

  it("F4: the FOUR SEALED FIELDS are byte-identical across admission", async () => {
    const h = harness();
    await seedLegacy(h, sealedRow("sealed-a"));
    const before = (await h.repo.getWorkItem("sealed-a"))!;
    const sealedBefore = sealBytes(before);

    const code = await persistAndCatch(h, build([before], 1, 0, "op-1"));
    expect(code, "a sealed legacy row is admitted like any other").toBeNull();

    const after = (await h.repo.getWorkItem("sealed-a"))!;
    expect(sealBytes(after), "attestations/attestationHistory/failedGateSeal/evidence UNTOUCHED").toBe(sealedBefore);
    // ...and the admission DID something, or the byte-identity above is vacuous
    expect(absentCount(after)).toBe(0);
    // the seal still derives, so the row stays terminal for every guard that reads it
    expect(after.effectiveDisposition).toBe("failed_sealed");
  });

  it("F5: admission is IDEMPOTENT — a second pass takes case 2 and compares equal", async () => {
    const h = harness();
    await seedLegacy(h, base("legacy-d"));
    const stored = (await h.repo.getWorkItem("legacy-d"))!;
    expect(await persistAndCatch(h, build([stored], 1, 0, "op-1"))).toBeNull();

    const identified = (await h.repo.getWorkItem("legacy-d"))!;
    const snapshot = JSON.stringify(identified);
    // re-admit the SAME row into the next generation: now fully identified, so case 2 compares
    const code = await persistAndCatch(h, build([identified], 2, 1, "op-2"));
    expect(code, "re-running must not conflict — it takes case 2 and matches").toBeNull();
    expect(JSON.stringify(await h.repo.getWorkItem("legacy-d")), "and writes nothing further").toBe(snapshot);
  });

  it("F6: ALL FOUR REAL LIVE SHAPES fit case 1 and are admitted", async () => {
    // sealed / paused-stampless(bug-372) / active / done — modelled on rows read from the live
    // Hub, not invented. If any real shape did NOT fit the three cases, that is the finding and it
    // would be reported rather than forced. Measured: all four are all-nine-absent.
    const h = harness();
    const shapes: Array<[string, WorkItem]> = [
      ["sealed", sealedRow("real-sealed")],
      ["paused-stampless", pausedStampless("real-paused")],
      ["active", activeRow("real-active")],
      ["done", doneRow("real-done")],
    ];
    for (const [, item] of shapes) await seedLegacy(h, item);

    const stored = await Promise.all(shapes.map(([, i]) => h.repo.getWorkItem(i.id)));
    for (const [i, row] of stored.entries()) {
      expect(absentCount(row!), `${shapes[i][0]} must be all-nine-absent (case 1)`).toBe(9);
    }

    const code = await persistAndCatch(h, build(stored.map((r) => r!), 1, 0, "op-1"));
    expect(code, "every real shape is admitted").toBeNull();

    for (const [, item] of shapes) {
      const after = (await h.repo.getWorkItem(item.id))!;
      expect(absentCount(after), `${item.id} is now identified`).toBe(0);
    }
    // the stranded bug-372 row keeps its paused status — admission is not a lifecycle change
    const paused = (await h.repo.getWorkItem("real-paused"))!;
    expect(paused.status, "admission must not move the row's lifecycle state").toBe("paused");
    expect(paused.type).toBe("freeform");
  });

  it("POSITIVE CONTROL: admission does not rewrite live lifecycle state", async () => {
    // Without this, F1/F6 pass on a change that spreads the CANDIDATE's projected workItem over
    // the stored row — which would silently reset status, lease and history to the projection.
    const h = harness();
    await seedLegacy(h, activeRow("live-a"));
    const before = (await h.repo.getWorkItem("live-a"))!;
    expect(await persistAndCatch(h, build([before], 1, 0, "op-1"))).toBeNull();
    const after = (await h.repo.getWorkItem("live-a"))!;
    expect(after.status, "status preserved").toBe("in_progress");
    expect(after.lease?.holder, "lease preserved").toBe("agent-x");
    expect(after.executorHistory, "history preserved").toEqual(["agent-x"]);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it("🔴 STALE-PROJECTION CONTROL: the row moved AFTER the generation was built", async () => {
    // ADDED BECAUSE THE MUTATION MATRIX FOUND THE HOLE. Spreading the candidate's `workItem` over
    // the stored row went GREEN against every case above — because those build the generation FROM
    // the current stored row, so candidate and stored AGREE BY CONSTRUCTION and no spread could
    // ever be observed. The control above was written to catch exactly this and could not.
    //
    // The discriminating scenario is a STALE projection: build from a snapshot, let the row move,
    // then persist. Now candidate.workItem and the stored row genuinely differ, and writing the
    // candidate would silently roll the row back to the snapshot.
    const h = harness();
    await seedLegacy(h, base("stale-a", { status: "ready" }));
    const snapshot = (await h.repo.getWorkItem("stale-a"))!;
    const built = build([snapshot], 1, 0, "op-1");          // built against `ready`

    // the row moves on: claimed, leased, executor recorded — all AFTER the build
    await h.substrate.put("WorkItem", {
      ...snapshot, status: "in_progress",
      lease: { token: "t2", holder: "agent-live", claimedAt: NOW, expiresAt: NOW, heartbeatAt: NOW },
      executorHistory: ["agent-live"],
    } as unknown as Record<string, unknown>);

    await h.storage.persistPrepared(built);
    await h.storage.persistProjectedWorkItems(built);

    const after = (await h.repo.getWorkItem("stale-a"))!;
    expect(after.status, "the LIVE status must survive — not the snapshot's `ready`").toBe("in_progress");
    expect(after.lease?.holder, "the LIVE lease must survive").toBe("agent-live");
    expect(after.executorHistory, "the LIVE history must survive").toEqual(["agent-live"]);
    // ...and the identity was still materialized, so this is not passing by doing nothing
    expect(absentCount(after), "identity still written").toBe(0);
  });
});
