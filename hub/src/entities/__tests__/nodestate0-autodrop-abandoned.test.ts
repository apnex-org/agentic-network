/**
 * bug-433 — AUTO-DROP ABANDONED CHILDREN (work-bp-nodestate0-impl_autodrop).
 *
 * Director: *"DependsOn should only engage against live nodes … That mechanism exists to
 * encode heirarchy, not to poison or block abandon nodes forever."* Clarified:
 * *"I meant abandoned or canceled nodes."*
 *
 * THE TABLE UNDER TEST (steve F7). Every row is asserted, because the value of this
 * change is concentrated in WHICH resolutions drop and which do NOT:
 *
 *   done                                            SATISFIED
 *   abandoned                                       DYNAMICALLY DROPPED
 *   failed_sealed                                   PENDING, BLOCKING
 *   ready|claimed|in_progress|blocked|paused|review PENDING, BLOCKING
 *   missing                                         PENDING, FAIL-CLOSED
 *
 * 🔴 The `failed_sealed` row is the one most likely to regress, because the obvious
 * implementation (`TERMINAL_WORK_PHASES`) contains it and would silently invert the
 * ruling — a gate that drops its own failures is not a gate.
 */
import { describe, it, expect } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { SubstrateCounter } from "../substrate-counter.js";
import {
  WorkItemRepositorySubstrate,
  classifyGateChild,
} from "../work-item-repository-substrate.js";

const ARCHITECT = { role: "architect", agentId: "agent-arch" };

function mkRepo() {
  const substrate = createMemoryStorageSubstrate();
  return new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
}

async function mkItem(repo: WorkItemRepositorySubstrate, extra: Record<string, unknown> = {}) {
  return repo.createWorkItem({
    type: "task",
    runbook: "r",
    priority: "normal",
    roleEligibility: ["engineer"],
    evidenceRequirements: [{ id: "e1", kind: "freeform", description: "d" }],
    createdBy: ARCHITECT,
    ...extra,
  } as never);
}

describe("bug-433: classifyGateChild — the classification table, exactly", () => {
  it("done => satisfied", () => {
    expect(classifyGateChild({ status: "done" })).toBe("satisfied");
  });

  it("abandoned => dropped_abandoned", () => {
    expect(classifyGateChild({ status: "abandoned" })).toBe("dropped_abandoned");
  });

  it("🔴 failed_sealed => pending (BLOCKING) — a gate that drops its own failures is not a gate", () => {
    // The implementation must NOT key off TERMINAL_WORK_PHASES, which contains this.
    expect(classifyGateChild({ status: "failed_sealed" })).toBe("pending");
  });

  it("every live phase => pending (BLOCKING)", () => {
    for (const s of ["ready", "claimed", "in_progress", "blocked", "paused", "review"] as const) {
      expect(classifyGateChild({ status: s })).toBe("pending");
    }
  });

  it("missing => missing, from BOTH representations of absence", () => {
    expect(classifyGateChild(null)).toBe("missing");
    expect(classifyGateChild(undefined)).toBe("missing");
    // the stint projection's pre-resolved sentinel must classify identically
    expect(classifyGateChild({ status: "missing" })).toBe("missing");
  });

  it("🔴 DISCRIMINATOR: abandoned and failed_sealed must NOT classify alike", () => {
    // If a future edit reaches for a shared 'terminal' set, this reddens. Both are
    // terminal; only one is a DECISION.
    expect(classifyGateChild({ status: "abandoned" })).not.toBe(
      classifyGateChild({ status: "failed_sealed" }),
    );
  });

  it("🔴 DISCRIMINATOR: dropped and missing must NOT classify alike", () => {
    // One is an absence, the other a decision. Merging them hides a vanished row.
    expect(classifyGateChild({ status: "abandoned" })).not.toBe(classifyGateChild(null));
  });
});

describe("bug-433: the COMPLETION gate drops abandoned children", () => {
  it("an abandoned child no longer blocks, and stays VISIBLE as dropped", async () => {
    const repo = mkRepo();
    const child = await mkItem(repo);
    const parent = await mkItem(repo, { completionDependsOn: [child.id] });

    const before = await repo.getCompletionProgress(parent.id);
    expect(before!.pending).toEqual([child.id]); // blocking while live

    await repo.abandonWork(child.id, ARCHITECT.agentId, { reason: "deliberate" });

    const after = await repo.getCompletionProgress(parent.id);
    expect(after!.pending).toEqual([]); // ⇐ THE RULING: no longer poisoned
    expect(after!.total).toBe(0); // active set is empty
    expect(after!.done).toBe(0);

    // ⚠️ AND THE ACCEPTANCE BAR: 0 active / N abandoned must not read as "all delivered".
    expect(after!.droppedAbandoned).toEqual([child.id]);
    expect(after!.declared).toEqual([child.id]); // declared topology NOT mutated
    expect(after!.missing).toEqual([]);
  });

  it("a failed_sealed-shaped child is NOT dropped — asserted at the classifier", () => {
    // Constructing a real sealed row needs the verifier-attestation path; the gate
    // consumes the classifier, and the classifier is asserted directly above.
    expect(classifyGateChild({ status: "failed_sealed" })).toBe("pending");
  });

  it("a MISSING child still blocks, and is reported separately from dropped", async () => {
    const repo = mkRepo();
    const parent = await mkItem(repo, { completionDependsOn: ["work-does-not-exist"] });
    const p = await repo.getCompletionProgress(parent.id);
    expect(p!.pending).toEqual(["work-does-not-exist"]); // fail-CLOSED, unchanged
    expect(p!.missing).toEqual(["work-does-not-exist"]);
    expect(p!.droppedAbandoned).toEqual([]); // NOT conflated with a decision
  });
});

describe("bug-433: the START gate drops abandoned dependencies", () => {
  it("an abandoned dependency no longer blocks a claim", async () => {
    const repo = mkRepo();
    const dep = await mkItem(repo);
    const gated = await mkItem(repo, { dependsOn: [dep.id] });

    await expect(repo.claimWorkItem(gated.id, "agent-e", "engineer")).rejects.toThrow();

    await repo.abandonWork(dep.id, ARCHITECT.agentId, { reason: "deliberate" });

    const claimed = await repo.claimWorkItem(gated.id, "agent-e", "engineer");
    expect(claimed).not.toBeNull(); // ⇐ start gate yields to a DECIDED dependency
  });
});

describe("CONTROL — the fixtures are real and these assertions can fail", () => {
  it("a live child genuinely blocks before anything is abandoned", async () => {
    const repo = mkRepo();
    const child = await mkItem(repo);
    const parent = await mkItem(repo, { completionDependsOn: [child.id] });
    const p = await repo.getCompletionProgress(parent.id);
    // Without this, the drop assertions could pass vacuously against an empty gate set.
    expect(p!.total).toBe(1);
    expect(p!.pending.length).toBe(1);
  });
});
