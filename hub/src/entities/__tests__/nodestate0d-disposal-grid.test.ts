/**
 * bug-468 — THE DISPOSAL AUTHORITY GRID, GENERATED RATHER THAN ENUMERATED.
 *
 * 🔴 THE RULING THIS FILE IMPLEMENTS (verifier, verify_v4):
 *
 *     "context DISCOVERY is judgment, but once a gate FREEZES a finite factor set, coverage
 *      of that set is MECHANISABLE and must FAIL ON OMISSION. Merely labeling contexts is not
 *      enough; this green table omitted the forbidden active counterpart."
 *
 * He is right and my previous table is the proof. I proposed that the context axis was
 * "irreducibly a review question". It is not — the DISCOVERY of the factors is, but once the
 * factors are named their PRODUCT is arithmetic. The previous file named
 * `suspended ∈ {yes,no}` × `phase ∈ {ready, active}` and then hand-listed THREE of the four
 * cells. A hand-written list of cells cannot report the cell nobody wrote.
 *
 *     THE DISTINCTION IS NOT LAYER-vs-CONTEXT. IT IS ENUMERATED-vs-GENERATED.
 *
 * So: the factors are declared, the product is COMPUTED, and every generated cell must have a
 * declared expectation. Add a phase or an actor and the grid grows; the expectation map does
 * not, and `coverage` fails naming the missing cells. Omission is now a RED, not an absence.
 */
import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import {
  WorkItemRepositorySubstrate,
  evaluateSuspendedDisposalAuthority,
  isActivelyWithdrawn,
} from "../work-item-repository-substrate.js";

// ─── THE FROZEN FACTOR SET ────────────────────────────────────────────────────────────────
const PHASES = ["ready", "claimed", "in_progress", "blocked"] as const;
const SUSPENSION = [false, true] as const;
const ACTORS = ["creator", "holder", "architect", "director", "stranger"] as const;

type Phase = (typeof PHASES)[number];
type Actor = (typeof ACTORS)[number];

/** ⚠️ A FOURTH FACTOR EXISTS AND IS DELIBERATELY FIXED HERE, NOT SILENTLY COLLAPSED:
 *  WHO suspended the row. This grid always suspends via a STEWARD, so the holder rows below are
 *  the `holder_after_steward_suspension` arm. The `holder_after_self_suspension` arm — where the
 *  same holder is ALLOWED — is covered in nodestate0b-steward-parity.test.ts. Naming the fixed
 *  factor is the point: an unstated fixed factor is exactly how bug-468's cell went missing. */
const SUSPENDED_BY = { role: "architect", agentId: "suspending-architect" } as const;

const CREATOR = { role: "engineer", agentId: "creator" } as const;
const HOLDER = { role: "engineer", agentId: "holder" } as const;
const CALLER: Record<Actor, { role: string; agentId: string }> = {
  creator: CREATOR,
  holder: HOLDER,
  architect: { role: "architect", agentId: "unrelated-architect" },
  director: { role: "director", agentId: "unrelated-director" },
  stranger: { role: "engineer", agentId: "nobody" },
};

// ─── THE DECLARED POLICY, one entry per generated cell ────────────────────────────────────
// key: `${actor}|${phase}|${suspended}`.  Director-ratified scope: `abandon if PAUSED` for
// stewards. holder = RELEASABLE phases. creator = RELEASABLE or ready, UNCONDITIONAL.
const EXPECT: Record<string, boolean> = {};
const declare = (actor: Actor, phase: Phase, suspended: boolean, allow: boolean) => {
  EXPECT[`${actor}|${phase}|${suspended}`] = allow;
};
for (const phase of PHASES) {
  const active = phase !== "ready";
  // creator: unconditional over RELEASABLE + ready. On a SUSPENDED row the matrix only grants
  // `creator_of_suspended_ready` (ready + no lease), so a suspended ACTIVE row is refused.
  declare("creator", phase, false, true);
  declare("creator", phase, true, !active);
  // holder: only where a lease exists; suspended-by-STEWARD refuses them (management outranks).
  declare("holder", phase, false, active);
  declare("holder", phase, true, false);
  // stewards: SUSPENDED ONLY, any phase. The unsuspended row is bug-468.
  for (const s of ["architect", "director"] as const) {
    declare(s, phase, false, false);
    declare(s, phase, true, true);
  }
  // never
  declare("stranger", phase, false, false);
  declare("stranger", phase, true, false);
}

function fixture() {
  const substrate = createMemoryStorageSubstrate();
  substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
  return new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
}

/** Drives a row to (phase, suspended) and returns the holder's token if one exists. */
async function driveTo(repo: WorkItemRepositorySubstrate, phase: Phase, suspended: boolean) {
  const w = await repo.createWorkItem({
    type: "task", priority: "normal", roleEligibility: [],
    evidenceRequirements: [{ id: "e", kind: "freeform", description: "e" }],
    runbook: "r", createdBy: CREATOR,
  } as never);
  let token: string | undefined;
  if (phase !== "ready") {
    const claimed = await repo.claimWorkItem(w.id, HOLDER.agentId, HOLDER.role);
    token = claimed!.lease!.token;
    if (phase === "in_progress" || phase === "blocked") await repo.startWork(w.id, HOLDER.agentId, token!);
    if (phase === "blocked") {
      await repo.blockWork(w.id, HOLDER.agentId, token!, { blockerKind: "external", blockerIds: [], reason: "grid" });
    }
  }
  if (suspended) {
    await repo.pauseWork({ workId: w.id, operationId: `grid-${w.id}`, reason: "grid" }, SUSPENDED_BY);
  }
  const row = (await repo.getWorkItem(w.id))!;
  expect(row.status).toBe(phase);            // the fixture built what it claims to have built
  expect(isActivelyWithdrawn(row)).toBe(suspended);
  return { row, token };
}

describe("bug-468 — disposal authority grid, GENERATED from the frozen factor set", () => {
  const cells = PHASES.flatMap((phase) =>
    SUSPENSION.flatMap((suspended) => ACTORS.map((actor) => ({ phase, suspended, actor }))));

  it(`🔴 COVERAGE: every generated cell has a declared expectation (${PHASES.length}x${SUSPENSION.length}x${ACTORS.length})`, () => {
    // THE GUARD THAT MAKES OMISSION A RED. Add a phase or an actor and this fails naming the
    // cell nobody declared, instead of the suite silently shrinking its own domain.
    const missing = cells
      .filter((c) => EXPECT[`${c.actor}|${c.phase}|${c.suspended}`] === undefined)
      .map((c) => `${c.actor}|${c.phase}|suspended=${c.suspended}`);
    expect(missing).toEqual([]);
    expect(cells).toHaveLength(PHASES.length * SUSPENSION.length * ACTORS.length);
  });

  for (const { phase, suspended, actor } of cells) {
    const expected = EXPECT[`${actor}|${phase}|${suspended}`];
    const label = `${actor} on ${suspended ? "SUSPENDED" : "unsuspended"} ${phase} => ${expected ? "ALLOW" : "DENY"}`;
    it(label, async () => {
      const repo = fixture();
      const { row, token } = await driveTo(repo, phase, suspended);
      const caller = CALLER[actor];

      // LAYER 2 — the advertisement
      const advertised = (await repo.getLegalMoves(row.id, caller))!
        .moves.find((m) => m.verb === "abandon")!;

      // LAYER 3 — the authoritative CAS
      let executed = false;
      try {
        const r = await repo.abandonWork(row.id, caller.agentId, {
          reason: "grid", actorRole: caller.role,
          leaseToken: actor === "holder" ? token : undefined,
        });
        executed = r?.status === "abandoned";
      } catch { executed = false; }

      expect(advertised.legal).toBe(expected);
      expect(executed).toBe(expected);
      if (expected) expect(advertised.reason).toBeUndefined();

      // A DENY must leave the row INTACT. A refusal that still mutated would pass a
      // throws-assertion; only re-reading the row proves nothing was terminalized.
      if (!expected) expect((await repo.getWorkItem(row.id))!.status).toBe(phase);
    });
  }
});

describe("bug-468 second finding — the matrix verdict is REPORTED, never null-masked", () => {
  // The previous helper returned `matrix: null` for unsuspended rows, on my judgement that the
  // matrix "had no opinion" there. The verifier found that CONCEALED a real disagreement: on an
  // unsuspended-ready row the matrix answers ALLOW/steward while both lower layers DENY.
  // A helper built to surface cross-surface disagreement must not decide for itself that one
  // surface is silent. So the verdict is reported, and its JURISDICTION is asserted explicitly.
  for (const actor of ["architect", "director"] as const) {
    it(`${actor}: the matrix ALLOWS off-jurisdiction (unsuspended-ready) while both layers DENY`, async () => {
      const repo = fixture();
      const { row } = await driveTo(repo, "ready", false);
      const caller = CALLER[actor];

      const matrix = evaluateSuspendedDisposalAuthority(row, caller, {});
      const advertised = (await repo.getLegalMoves(row.id, caller))!
        .moves.find((m) => m.verb === "abandon")!;

      // REPORTED, not suppressed: the matrix does not itself test suspension, so off its
      // jurisdiction it still answers "steward". That is a real divergence and it is now visible.
      expect(matrix).toEqual({ allowed: true, reason: "steward" });
      expect(advertised.legal).toBe(false);
      expect(isActivelyWithdrawn(row)).toBe(false);

      // ⚠️ THE INVARIANT IS JURISDICTIONAL, NOT UNIVERSAL EQUALITY. The matrix adjudicates
      // SUSPENDED rows; `abandonWork` and `getLegalMoves` only consult it when the row is
      // suspended. Whether the matrix should instead refuse off-jurisdiction rows outright is a
      // DESIGN question about what the matrix means, and it belongs to the verifier/architect —
      // flagged rather than decided here, because "make the three agree" could be satisfied by
      // changing the matrix in a way that breaks the creator arm (creator on unsuspended-ready
      // is legitimately ALLOW at both layers while the matrix has no creator grant there).
    });
  }

  it("🟢 ON-jurisdiction the three surfaces DO agree: steward + suspended row", async () => {
    const repo = fixture();
    const { row } = await driveTo(repo, "in_progress", true);
    const caller = CALLER.architect;
    const matrix = evaluateSuspendedDisposalAuthority(row, caller, {});
    const advertised = (await repo.getLegalMoves(row.id, caller))!
      .moves.find((m) => m.verb === "abandon")!;
    const executed = await repo.abandonWork(row.id, caller.agentId, { reason: "grid", actorRole: caller.role });
    expect(matrix.allowed).toBe(true);
    expect(advertised.legal).toBe(true);
    expect(executed!.status).toBe("abandoned");
  });
});
