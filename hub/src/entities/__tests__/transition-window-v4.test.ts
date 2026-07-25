// work-512 — MEASURE THE POST-DEPLOY-PRE-MIGRATION WINDOW.
//
// THE STATE UNDER TEST IS REAL AND THE DEPLOY PASSES THROUGH IT: bug-371's code is live, the
// migration has NOT yet run in the scenario these fixtures construct, so sealed rows are still
// stored `ready`.
//
// 🔴 THE WINDOW IS UNBOUNDED AND UNOBSERVED, WHICH IS WHY THIS FILE EXISTS. MERGE IS DEPLOY:
// `deploy-hub.yml` triggers on push to main and pushes `hub:latest`; `watchtower-prod` polls every
// 300s and rolls `ois-hub-prod` automatically. Nobody is paged when that happens, and the
// migration is a separate manual step. So the window opens BY ITSELF and stays open until someone
// notices. The original framing — "the window is short, so the regression is tolerable" — was a
// bet on duration with no operator watching to make it good. The surviving requirement does not
// mention duration: THE WINDOW MUST BE HARMLESS.
//
// HISTORICAL NOTE, kept honest: during the window this was made harmless by a transitional
// projection mapping to `failed_sealed`. THAT PROJECTION IS NOW REMOVED (mission-141 residue) —
// production was migrated 2026-07-25T10:53Z, so the stored phase is the terminal phase and there
// is nothing left to project. The cases below survive because they assert properties of the
// UN-MIGRATED shape that never depended on the projection: claimability, verb legality and pulse
// eligibility all key off the SEAL, never the phase.
//
// The claim being measured was originally REASONED, NOT MEASURED: I read the call paths and saw
// they key off derived fields. That is the same shape as my §4 slip, where I read the path
// correctly and named the wrong STAGE. A CLAIMABILITY REGRESSION IS A LIVE HAZARD; A DISPLAY
// REGRESSION IS COSMETIC, and those must not be separated by an inference. So they are separated
// by a measurement here.
//
// (iv) IS THE DELIVERABLE. (i)-(iii) confirm what we already believe; only (iv) can surprise us,
// and it is implemented as an EXHAUSTIVE key-by-key diff of the two states rather than a third
// spot-check — a spot-check would only ever find the paths I already thought of, which is the
// thing it was meant to replace.
import { describe, expect, it } from "vitest";
import { isNodePulseEligible } from "../../policy/pulse-sweeper.js";
import { createMemoryStorageSubstrate } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import type { WorkItem } from "../work-item.js";
import { WorkItemRepositorySubstrate } from "../work-item-repository-substrate.js";

const NOW = "2026-07-25T08:30:00.000Z";
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

/** THE UN-MIGRATED SHAPE — exactly the twelve live rows: stored `ready`, seal null, active FAIL. */
function unmigratedSealed(id: string, over: Partial<WorkItem> = {}): WorkItem {
  const att = {
    verdict: "fail" as const, producedAt: NOW, verifierId: "agent-verifier-1",
    requirementId: "gate", evidenceRefs: [{ ref: "docs/x.md", kind: "evidence" }],
    targetRefHash: "t", evidenceSetHash: "e", requirementHash: "r",
  };
  return work(id, {
    type: "verifier-gate",
    evidenceRequirements: [{ id: "gate", kind: "review", evidenceAuthority: "verifier-attestation" } as never],
    attestations: { gate: att } as never,
    attestationHistory: [att] as never,
    ...over,
  });
}

function harness() {
  const substrate = createMemoryStorageSubstrate();
  return { substrate, repo: new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate)) };
}

describe("work-512 — the post-deploy / pre-migration window", () => {
  it("CALIBRATION: the un-migrated row really is in the window — stored `ready`, sealed, un-migrated", async () => {
    // Pins the premise. If the fixture were already migrated, every case below would pass while
    // testing the wrong state entirely.
    const h = harness();
    await h.substrate.put("WorkItem", unmigratedSealed("w") as unknown as Record<string, unknown>);
    const row = (await h.repo.getWorkItem("w"))!;
    expect(row.status, "STORED phase is still the stale ready").toBe("ready");
    expect(row.failedGateSeal, "pre-v2 shape: no seal object").toBeNull();
    expect(row.effectiveDisposition, "but it IS terminal, derived").toBe("failed_sealed");
  });

  it("(i) an un-migrated sealed row is ABSENT from the claimable surface", async () => {
    const h = harness();
    await h.substrate.put("WorkItem", unmigratedSealed("sealed") as unknown as Record<string, unknown>);
    await h.substrate.put("WorkItem", work("clean") as unknown as Record<string, unknown>);
    const ready = await h.repo.listReadyForRole("engineer", 100);
    const ids = ready.items.map((i) => i.id);
    expect(ids, "CLAIMABILITY MUST NOT REGRESS IN THE WINDOW").not.toContain("sealed");
    expect(ids, "positive control — the scan is not simply empty").toContain("clean");
  });

  it("(ii) ALL TEN lifecycle verbs still refuse, VIA THE SEAL", async () => {
    const h = harness();
    await h.substrate.put("WorkItem", unmigratedSealed("sealed") as unknown as Record<string, unknown>);
    const id = "sealed", agent = "agent-x", token = "no-such-token";
    const verbs: Array<[string, () => Promise<unknown>]> = [
      ["claim", () => h.repo.claimWorkItem(id, agent, "engineer")],
      ["start", () => h.repo.startWork(id, agent, token)],
      ["block", () => h.repo.blockWork(id, agent, token, { blockerKind: "dependency", reason: "x" } as never)],
      ["resume", () => h.repo.resumeWork(id, agent, token)],
      ["renew", () => h.repo.renewLease(id, agent, token)],
      ["release", () => h.repo.releaseWork(id, agent, token)],
      ["abandon", () => h.repo.abandonWork(id, agent, { reason: "x", leaseToken: token })],
      ["complete", () => h.repo.completeWork(id, agent, token, [])],
      ["pause", () => h.repo.pauseWork({ workId: id, operationId: "op-w", reason: "x" } as never, ARCHITECT)],
      ["unpause", () => h.repo.unpauseWork({ workId: id } as never, ARCHITECT)],
    ];
    const becameLegal: string[] = [];
    const wrongRefusal: string[] = [];
    for (const [name, call] of verbs) {
      try { await call(); becameLegal.push(name); } catch (error) {
        const msg = String((error as Error)?.message ?? error);
        const ename = String((error as Error)?.name ?? "");
        if (!(ename === "FailedGateSealedRejected" || msg.includes("failed_sealed"))) {
          wrongRefusal.push(`${name}: ${ename || msg.slice(0, 60)}`);
        }
      }
    }
    expect(becameLegal, `LEGAL in the window: ${becameLegal.join(", ")}`).toEqual([]);
    expect(wrongRefusal, `refused but NOT via the seal: ${wrongRefusal.join(" | ")}`).toEqual([]);
  });

  it("(iii) an un-migrated sealed node is PULSE-INELIGIBLE — via production's own predicate", async () => {
    const h = harness();
    const pulse = { nodeConfig: { pulse: { kind: "status_check", intervalMs: 1000 } } } as unknown as Partial<WorkItem>;
    await h.substrate.put("WorkItem", unmigratedSealed("sealed", pulse) as unknown as Record<string, unknown>);
    await h.substrate.put("WorkItem", work("clean", pulse) as unknown as Record<string, unknown>);
    const sealed = (await h.repo.getWorkItem("sealed"))!;
    const clean = (await h.repo.getWorkItem("clean"))!;
    expect(isNodePulseEligible(sealed), "a sealed node must not pulse in the window").toBe(false);
    expect(isNodePulseEligible(clean), "positive control — the predicate CAN return true").toBe(true);
  });


  it("🔴 (iv) THE ONLY OBSERVABLE DIFFERENCE FROM THE MIGRATED STATE IS `status` — exhaustive diff", async () => {
    // The deliverable. Not a list of paths I thought to check: an enumeration of EVERY key of the
    // decoded row in both states, diffed. If the migration changes anything beyond the phase, this
    // names it — including a field neither of us anticipated.
    const h = harness();
    await h.substrate.put("WorkItem", unmigratedSealed("w") as unknown as Record<string, unknown>);
    const before = (await h.repo.getWorkItem("w"))!;
    await h.repo.migrateSealedRowsToFailedPhase();
    const after = (await h.repo.getWorkItem("w"))!;

    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    const differing = keys.filter(
      (k) => JSON.stringify((before as unknown as Record<string, unknown>)[k])
          !== JSON.stringify((after as unknown as Record<string, unknown>)[k]),
    );

    expect(
      differing,
      `keys differing between the un-migrated and migrated states — MUST be exactly ["status"]. ` +
      `Anything else means the window is NOT display-only and the transitional projection goes back in.`,
    ).toEqual(["status"]);
    expect(before.status).toBe("ready");
    expect(after.status).toBe("failed_sealed");

    // CALIBRATION FOR THE DIFF ITSELF: the instrument must be able to REPORT a difference, or an
    // empty/one-key result is a bare zero. Prove it detects a second changed key when one exists.
    const mutated = { ...after, priority: "low" } as WorkItem;
    const calKeys = keys.filter(
      (k) => JSON.stringify((before as unknown as Record<string, unknown>)[k])
          !== JSON.stringify((mutated as unknown as Record<string, unknown>)[k]),
    );
    expect(calKeys.sort(), "the diff must be able to see more than one key").toEqual(["priority", "status"]);
  });
});
