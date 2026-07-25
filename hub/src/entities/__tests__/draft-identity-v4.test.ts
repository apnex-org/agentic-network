// bug-370 / B-prerequisite (1) — a prepared-but-unactivated DRAFT must be distinguishable from a
// genuine LEGACY row.
//
// WHY IT BLOCKS STEP B: B is complete shadow generation — preparing and persisting generations
// WITHOUT activating them. That is not a risk B runs; it is B's normal operating mode. So an
// ambiguity between "draft" and "legacy" would cover the entire shadow population, and step C
// (dual-read to zero unexplained divergence) cannot be executed over rows nobody can classify.
//
// PROBE-DEPTH, established before writing any assertion — measured stage by stage, each in its
// own try, because a multi-stage path in one try cannot attribute a failure:
//   build                      ACCEPTED
//   persistPrepared            ACCEPTED
//   persistProjectedWorkItems  REJECTED  <- the deciding stage for legacy-row admission
//   activateGeneration         REJECTED  (different error, already unreachable by then)
import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import type { WorkItem } from "../work-item.js";
import { WorkItemRepositorySubstrate } from "../work-item-repository-substrate.js";
import { WorkRevisionStorageRepositoryV4, buildWorkRevisionStorageV4 } from "../work-revision-storage-v4.js";

const NOW = "2026-07-25T07:45:00.000Z";
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

function build(items: WorkItem[], generation: number, previousGeneration: number, operationId: string) {
  return buildWorkRevisionStorageV4({
    workItems: items,
    boundReferencesByPhysicalId: Object.fromEntries(items.map((i) => [i.id, i.boundReferences ?? []])),
    familyScopesByPhysicalId: Object.fromEntries(items.map((i) => [i.id, { kind: "mission" as const, id: "m" }])),
    generation, previousGeneration, operationId, createdAt: NOW,
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

/** Activate generation 1, then prepare-and-persist generation 2 WITHOUT activating it. */
async function stageDraft(h: ReturnType<typeof harness>) {
  const first = build([work("published-row")], 1, 0, "op-1");
  await h.storage.persistPrepared(first);
  await h.storage.persistProjectedWorkItems(first);
  await h.storage.activateGeneration(1, "op-1", NOW);
  // carry the STORED row forward — a reconstruction has different immutable identity and is
  // rejected at persistProjectedWorkItems
  const carried = (await h.repo.getWorkItem("published-row"))!;
  const second = build([carried, work("draft-row")], 2, 1, "op-2");
  await h.storage.persistPrepared(second);
  await h.storage.persistProjectedWorkItems(second);
  // deliberately NOT activated
}

describe("bug-370 — draft identity", () => {
  it("CALIBRATION: the three row kinds carry distinct topologyGeneration values", async () => {
    // Proves the discriminator can produce all three outcomes BEFORE any case asserts one.
    const h = harness();
    await h.substrate.put("WorkItem", work("legacy-row") as unknown as Record<string, unknown>);
    await stageDraft(h);
    const legacy = (await h.repo.getWorkItem("legacy-row"))!;
    const published = (await h.repo.getWorkItem("published-row"))!;
    const draft = (await h.repo.getWorkItem("draft-row"))!;
    const head = (await h.storage.getHead())!.head.generation;
    expect((legacy as { topologyGeneration?: number }).topologyGeneration).toBeUndefined();
    expect((published as { topologyGeneration?: number }).topologyGeneration).toBeLessThanOrEqual(head);
    expect((draft as { topologyGeneration?: number }).topologyGeneration).toBeGreaterThan(head);
  });

  it("F1: a DRAFT projects distinguishably — not as a legacy row", async () => {
    const h = harness();
    await stageDraft(h);
    const projected = await h.repo.getCurrentWork("draft-row");
    expect(projected, "a draft must be readable, not hidden behind a null").not.toBeNull();
    expect(projected!.topologyHash, "must not masquerade as legacy").not.toBe("legacy");
    expect(projected!.topologyHash).toBe("draft");
    expect(projected!.generation, "names the generation it is AWAITING").toBe(2);
  });

  it("F2: a genuine LEGACY row still projects legacy — the positive control", async () => {
    // Without this, F1 passes on a change that labels EVERY unbound row a draft.
    const h = harness();
    await h.substrate.put("WorkItem", work("legacy-row") as unknown as Record<string, unknown>);
    await stageDraft(h);
    const projected = await h.repo.getCurrentWork("legacy-row");
    expect(projected).not.toBeNull();
    expect(projected!.topologyHash).toBe("legacy");
    expect(projected!.generation).toBe(0);
  });

  it("F3: a PUBLISHED row is unaffected — second positive control", async () => {
    const h = harness();
    await stageDraft(h);
    const projected = await h.repo.getCurrentWork("published-row");
    expect(projected).not.toBeNull();
    expect(projected!.generation, "resolves at its own generation").toBe(1);
    expect(projected!.topologyHash).not.toBe("draft");
    expect(projected!.topologyHash).not.toBe("legacy");
  });

  it("F4: draft and legacy are DISTINGUISHABLE from each other — the property B needs", async () => {
    // The actual requirement, stated as a comparison rather than two separate assertions: an
    // abandoned partial batch must be identifiable, which means its projection cannot equal a
    // genuine legacy row's.
    const h = harness();
    await h.substrate.put("WorkItem", work("legacy-row") as unknown as Record<string, unknown>);
    await stageDraft(h);
    const legacy = await h.repo.getCurrentWork("legacy-row");
    const draft = await h.repo.getCurrentWork("draft-row");
    expect(legacy).not.toBeNull();
    expect(draft).not.toBeNull();
    expect(
      { hash: draft!.topologyHash, gen: draft!.generation },
      "a crashed partial batch must not be indistinguishable from a legacy row",
    ).not.toEqual({ hash: legacy!.topologyHash, gen: legacy!.generation });
  });

  it("F5: the draft is IDENTIFIABLE for recovery — head comparison, not absence", async () => {
    // Recovery requires enumerating abandoned drafts. The identification predicate is positive:
    // topologyGeneration > head. Asserting it here pins the recovery seam, not just the display.
    const h = harness();
    await stageDraft(h);
    const head = (await h.storage.getHead())!.head.generation;
    const draft = (await h.repo.getWorkItem("draft-row"))!;
    const preparedFor = (draft as { topologyGeneration?: number }).topologyGeneration!;
    expect(preparedFor).toBeGreaterThan(head);
    // and after the generation IS activated, the same row stops being a draft
    await h.storage.activateGeneration(2, "op-2", NOW);
    const after = await h.repo.getCurrentWork("draft-row");
    expect(after!.topologyHash, "activation publishes it; it is no longer a draft").not.toBe("draft");
    expect(after!.generation).toBe(2);
  });
});
