// bug-371 — a seal-failed row must carry a REAL TERMINAL PHASE, so the FILTER and the DISPLAY
// agree instead of being reconciled by hand.
//
// PROBE-DEPTH, established before any assertion was written (work-508 survey):
//   substrate.list(filter={status})  <- THE FILTER IS DECIDED HERE, against STORED JSON
//   decode / effectiveDisposition    <- runs AFTERWARDS, on rows already selected
// Therefore NO read-side derivation can fix a FILTER; it can only fix a display. That is why
// work-505 corrected the point-read and left list_work filtering on the stale stored value.
// The fix must therefore be a STORED phase, which makes it a data migration as well as a type
// change. Architect-ruled 2026-07-25: the retention constraint protects the VERDICT (attestations,
// attestationHistory, failedGateSeal, evidence) and NOT the lifecycle field, and the verifier
// measured his baseline to hash exactly those four — so a status-only write leaves it identical.
//
// POPULATION [MEASURED, n=12, complete]: every live sealed row is the PRE-v2 shape — stored
// `ready`, failedGateSeal null, terminal only via derived hasActiveVerifierFail. The seal WRITE
// paths store `review`. Both shapes are covered below; a fixture modelling only one is not a
// control for the other.
import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import type { WorkItem, WorkItemPhase } from "../work-item.js";
import { WorkItemRepositorySubstrate, isFailedGateSealed } from "../work-item-repository-substrate.js";

const NOW = "2026-07-25T08:10:00.000Z";
const ARCHITECT = { role: "architect", agentId: "architect-1" };
const SEALED: WorkItemPhase = "failed_sealed";

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

function failAtt() {
  return {
    verdict: "fail" as const, producedAt: NOW, verifierId: "agent-verifier-1",
    requirementId: "gate", evidenceRefs: [{ ref: "docs/x.md", kind: "evidence" }],
    targetRefHash: "t", evidenceSetHash: "e", requirementHash: "r",
  };
}

/** PRE-v2 — the shape of all twelve LIVE rows: stored `ready`, failedGateSeal null. */
function preV2Sealed(id: string): WorkItem {
  const att = failAtt();
  return work(id, {
    type: "verifier-gate",
    evidenceRequirements: [{ id: "gate", kind: "review", evidenceAuthority: "verifier-attestation" } as never],
    attestations: { gate: att } as never,
    attestationHistory: [att] as never,
    evidence: [{ requirementId: "gate", kind: "doc", ref: "docs/y.md", producedAt: NOW } as never],
  });
}

/** POST-v2 — what the seal WRITE paths actually produce: stored `review`, failedGateSeal set. */
function postV2Sealed(id: string): WorkItem {
  const att = failAtt();
  return work(id, {
    type: "verifier-gate",
    status: "review",
    evidenceRequirements: [{ id: "gate", kind: "review", evidenceAuthority: "verifier-attestation" } as never],
    attestations: { gate: att } as never,
    attestationHistory: [att] as never,
    failedGateSeal: { requirementId: "gate", operationId: "op-1", sealedAt: NOW } as never,
  });
}

function harness() {
  const substrate = createMemoryStorageSubstrate();
  return { substrate, repo: new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate)) };
}

/** The four fields the retention constraint actually protects — steve's baseline scope. */
function verdictBytes(w: WorkItem): string {
  return JSON.stringify({
    a: w.attestations, h: w.attestationHistory, s: w.failedGateSeal, e: w.evidence,
  });
}

async function seed(h: ReturnType<typeof harness>) {
  await h.substrate.put("WorkItem", preV2Sealed("pre") as unknown as Record<string, unknown>);
  await h.substrate.put("WorkItem", postV2Sealed("post") as unknown as Record<string, unknown>);
  await h.substrate.put("WorkItem", work("plain-ready") as unknown as Record<string, unknown>);
}

describe("bug-371 — real terminal phase for seal-failed rows", () => {
  it("CALIBRATION: the instrument distinguishes sealed from clean BEFORE anything is migrated", async () => {
    // Without this, a filter returning nothing is equally consistent with a correct filter and a
    // dead one. Also pins the premise: BOTH sealed shapes exist and BOTH are isFailedGateSealed.
    const h = harness();
    await seed(h);
    const pre = (await h.repo.getWorkItem("pre"))!;
    const post = (await h.repo.getWorkItem("post"))!;
    const plain = (await h.repo.getWorkItem("plain-ready"))!;
    expect(isFailedGateSealed(pre)).toBe(true);
    expect(isFailedGateSealed(post)).toBe(true);
    expect(isFailedGateSealed(plain)).toBe(false);
    expect(pre.status, "the live twelve are stored ready").toBe("ready");
    expect(post.status, "the seal write path stores review, NOT ready").toBe("review");
  });

  // PREDICATE NARROWED (architect ruling 2026-07-25): the migration matches a sealed row ONLY when
  // its STORED phase is `ready` — bug-371's actual defect. The `post` fixture is stored `review`,
  // which is NOT claimable and therefore does NOT misrepresent itself, so it is deliberately left
  // alone. This case previously asserted BOTH shapes migrate; that encoded the over-broad
  // predicate the first complete production dry run exposed (24 matched where 12 were expected).
  it("F1: list filtered by the terminal phase returns the migrated stored-`ready` shape", async () => {
    const h = harness();
    await seed(h);
    await h.repo.migrateSealedRowsToFailedPhase();
    const { items } = await h.repo.listWorkItems({ status: SEALED });
    expect(items.map((i) => i.id), "an auditor filtering terminal finds the row that exhibited the defect").toEqual(["pre"]);
    // and the review-stored sealed row is UNTOUCHED — narrowing asserted, not merely un-asserted
    expect((await h.repo.getWorkItem("post"))!.status, "a sealed `review` row is not claimable, so not migrated").toBe("review");
  });

  it("F2: list filtered by `ready` no longer returns them, and returns nothing terminal", async () => {
    const h = harness();
    await seed(h);
    await h.repo.migrateSealedRowsToFailedPhase();
    const { items } = await h.repo.listWorkItems({ status: "ready" });
    expect(items.map((i) => i.id)).toEqual(["plain-ready"]);
    expect(items.every((i) => i.status === "ready"), "no row on a ready page may carry a terminal phase").toBe(true);
  });

  // OBSERVED-RED NOTE: F3 and CALIBRATION PASSED BEFORE THIS CHANGE EXISTED. That is correct and
  // is recorded rather than hidden — the seal guard already refused every verb (the D3 repair),
  // so F3 is a REGRESSION GUARD proving the phase write does not grant a capability. IT IS NOT
  // EVIDENCE FOR THIS CHANGE. Only F1/F2/F4/F5/F6/F7 went red on the stub.
  it("F3 REGRESSION GUARD: every lifecycle verb remains illegal, refusing via THE SEAL — all ten", async () => {
    const h = harness();
    await seed(h);
    await h.repo.migrateSealedRowsToFailedPhase();
    const id = "pre", agent = "agent-x", token = "no-such-token";
    // REAL signatures. A catch-all `catch` would score a TypeError as "refused" and turn every
    // defect in this case into a pass — so the refusal must be THE SEAL REFUSAL specifically.
    const verbs: Array<[string, () => Promise<unknown>]> = [
      ["claim", () => h.repo.claimWorkItem(id, agent, "engineer")],
      ["start", () => h.repo.startWork(id, agent, token)],
      ["block", () => h.repo.blockWork(id, agent, token, { blockerKind: "dependency", reason: "x" } as never)],
      ["resume", () => h.repo.resumeWork(id, agent, token)],
      ["renew", () => h.repo.renewLease(id, agent, token)],
      ["release", () => h.repo.releaseWork(id, agent, token)],
      ["abandon", () => h.repo.abandonWork(id, agent, { reason: "x", leaseToken: token })],
      ["complete", () => h.repo.completeWork(id, agent, token, [])],
      ["pause", () => h.repo.pauseWork({ workId: id, operationId: "op-f3", reason: "x" } as never, ARCHITECT)],
      ["unpause", () => h.repo.unpauseWork({ workId: id } as never, ARCHITECT)],
    ];
    const becameLegal: string[] = [];
    const wrongRefusal: string[] = [];
    for (const [name, call] of verbs) {
      try {
        await call();
        becameLegal.push(name);
      } catch (error) {
        const msg = String((error as Error)?.message ?? error);
        const ename = String((error as Error)?.name ?? "");
        if (!(ename === "FailedGateSealedRejected" || msg.includes("failed_sealed"))) {
          wrongRefusal.push(`${name}: ${ename || msg.slice(0, 60)}`);
        }
      }
    }
    expect(becameLegal, `verbs that became LEGAL after the phase write: ${becameLegal.join(", ")}`).toEqual([]);
    expect(wrongRefusal, `refused but NOT via the seal, so not evidence the seal held: ${wrongRefusal.join(" | ")}`).toEqual([]);
  });

  it("F4: the FOUR PROTECTED FIELDS are byte-identical across the migration", async () => {
    // Steve measured his baseline to hash exactly {attestations, attestationHistory,
    // failedGateSeal, evidence}. This asserts the same scope. The status change is asserted
    // SEPARATELY below — an unchanged-everything test would pass on a migration that did nothing.
    const h = harness();
    await seed(h);
    const beforePre = verdictBytes((await h.repo.getWorkItem("pre"))!);
    const beforePost = verdictBytes((await h.repo.getWorkItem("post"))!);
    await h.repo.migrateSealedRowsToFailedPhase();
    const afterPre = (await h.repo.getWorkItem("pre"))!;
    const afterPost = (await h.repo.getWorkItem("post"))!;
    expect(verdictBytes(afterPre)).toBe(beforePre);
    expect(verdictBytes(afterPost)).toBe(beforePost);
    // ...and the migration DID something — otherwise the byte-identity above is vacuous.
    expect(afterPre.status).toBe(SEALED);
    // PREDICATE NARROWED: the review-stored sealed row is deliberately NOT migrated — `review` is
    // not claimable, so it does not exhibit bug-371. Asserting it stays `review` makes the
    // narrowing explicit rather than merely dropping the old expectation.
    expect(afterPost.status, "a sealed `review` row is left exactly as found").toBe("review");
    // the seal still derives, so the row stays terminal for every guard that consults it
    expect(afterPre.effectiveDisposition).toBe("failed_sealed");
    expect(isFailedGateSealed(afterPre)).toBe(true);
  });

  it("F5 POSITIVE CONTROL: an independently-constructed ready row is untouched", async () => {
    // Deliberately unrelated to this arc. The live ready population is 12/12 sealed rows, so it
    // controls nothing. Without this, F1/F2 both pass on a migration that rewrites EVERY row.
    const h = harness();
    await seed(h);
    const before = (await h.repo.getWorkItem("plain-ready"))!;
    const result = await h.repo.migrateSealedRowsToFailedPhase();
    const after = (await h.repo.getWorkItem("plain-ready"))!;
    expect(after.status).toBe("ready");
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(result.migrated.map((r) => r.id)).toEqual(["pre"]);
    expect(result.skipped, "the clean row is skipped, not silently rewritten").toContain("plain-ready");
    expect(result.skipped, "and so is the review-stored sealed row").toContain("post");
    const ready = await h.repo.listReadyForRole("engineer", 100);
    expect(ready.items.map((i) => i.id)).toContain("plain-ready");
  });

  it("F6: the new variant is TERMINAL to every terminal-set literal, not just to the filter", async () => {
    // Restated per architect: there are NO exhaustive switches and no Record<WorkItemPhase,...>
    // in this codebase, so "check for exhaustive switches" is unrunnable. The runnable form is
    // to enumerate the TERMINAL-SET LITERALS and assert the new value is in them. Asserted
    // BEHAVIOURALLY through the exported predicates, not by grepping for the string.
    const { isTerminalPhase } = await import("../../policy/message-consumption-projection.js");
    expect(isTerminalPhase(SEALED), "message-consumption-projection terminal set").toBe(true);
    expect(isTerminalPhase("done")).toBe(true);
    expect(isTerminalPhase("abandoned")).toBe(true);
    expect(isTerminalPhase("ready"), "positive control — not everything is terminal").toBe(false);
    const { TERMINAL_WORK_PHASES } = await import("../work-item.js");
    expect(TERMINAL_WORK_PHASES.has(SEALED), "shared terminal set").toBe(true);
    expect(TERMINAL_WORK_PHASES.has("ready")).toBe(false);
  });

  it("F8: --dry-run reports what it WOULD write and writes NOTHING", async () => {
    // Collect-mode claiming zero effects is a claim, so it is asserted rather than trusted: the
    // stored rows must be byte-identical after a dry run, AND the report must be non-empty —
    // without the second half this passes on a dry run that simply does nothing and reports
    // nothing, which is the failure mode that makes a dry run useless as a pre-deploy check.
    const h = harness();
    await seed(h);
    const before = JSON.stringify([
      await h.repo.getWorkItem("pre"), await h.repo.getWorkItem("post"), await h.repo.getWorkItem("plain-ready"),
    ]);
    const dry = await h.repo.migrateSealedRowsToFailedPhase({ dryRun: true });
    const after = JSON.stringify([
      await h.repo.getWorkItem("pre"), await h.repo.getWorkItem("post"), await h.repo.getWorkItem("plain-ready"),
    ]);
    expect(after, "a dry run must leave storage byte-identical").toBe(before);
    expect(dry.dryRun).toBe(true);
    expect(dry.migrated.map((r) => r.id), "and must still REPORT the rows it would write").toEqual(["pre"]);
    expect(dry.migrated.find((r) => r.id === "pre")!.before).toBe("ready");
    // and a real run afterwards still works — the dry run did not consume anything
    const real = await h.repo.migrateSealedRowsToFailedPhase();
    expect(real.migrated.map((r) => r.id)).toEqual(["pre"]);
    expect((await h.repo.getWorkItem("pre"))!.status).toBe(SEALED);
  });

  it("F7: the migration is IDEMPOTENT and records reversible per-row before/after", async () => {
    // A5: the prior stored status must be recoverable exactly, and re-running must not churn.
    const h = harness();
    await seed(h);
    const first = await h.repo.migrateSealedRowsToFailedPhase();
    expect(first.migrated.map((r) => r.id)).toEqual(["pre"]);
    expect(first.migrated[0].before, "every `before` is `ready` under the narrowed predicate").toBe("ready");
    expect(first.migrated.every((r) => r.after === SEALED)).toBe(true);
    const second = await h.repo.migrateSealedRowsToFailedPhase();
    expect(second.migrated, "a second run must be a no-op, not a rewrite").toEqual([]);
    // 🔴 SEMANTIC CHANGE WORTH KNOWING: `matched` now counts rows that STILL EXHIBIT THE DEFECT, so
    // after a successful migration a re-run reports matched=0 — that is the SUCCESS signal, not a
    // regression. Under the old predicate it would have reported the full sealed count forever.
    expect(second.matched, "nothing still misrepresents itself").toBe(0);
    expect(second.skipped.sort()).toEqual(["plain-ready", "post", "pre"]);
  });
});
