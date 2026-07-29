/**
 * bug-462 — THE AUTHORITY SCOPE BAR. steve's artefact, fixtures byte-for-byte
 * (`docs/verification/nodestate0c-verify-v3-authority-scope-bar.test.ts@rv=56705406`,
 * SHA `9738c302...`). It was 2/2 RED on candidate `d2435549` and must be 2/2 GREEN here.
 *
 * 🔴 WHAT IT GUARDS, AND WHY I GOT IT WRONG:
 *
 * Fixing the two steward-parity arms, I added a steward clause to both ready-phase
 * predicates and OMITTED the suspension condition. On a plain `ready` row — unsuspended,
 * unleased, engineer creator — an UNRELATED architect or director then saw
 * `abandon.legal = true` and could drive the row terminal. That exceeded three separate
 * boundaries: criterion 3 case (iv) is scoped to a SUSPENDED ready row, bug-424's scope is
 * live WITHDRAWAL, and the public `abandon_work` contract says only the CREATOR may abandon
 * from `ready`.
 *
 * I argued at the time that it was NOT a widening, because the identity check at the top of
 * `abandonWork` already admitted stewards on any row and only the phase gate refused them.
 *
 *     THAT ARGUMENT WAS WRONG. AN EARLY IDENTITY GUARD IS ONLY ONE CONJUNCT, AND EFFECTIVE
 *     AUTHORITY IS THE CONJUNCTION. Before the change the phase guard made the effective
 *     ready-row decision DENY; after it, ALLOW. Removing the denying conjunct IS the
 *     widening, whatever the admitting one said in isolation.
 *
 * A guard that could only SUBTRACT was the thing holding the boundary. That is the mirror of
 * the lesson I had just written down for the repair side — "a post-filter that can only
 * subtract cannot repair a predicate that under-admits" — and I reasoned single-conjunct on
 * the boundary while reasoning compositionally on the fix.
 *
 * The creator arm is UNCONDITIONAL by design (bug-219 fix (c)): a role-gated ready row with
 * no eligible seat is otherwise unclaimable and un-closeable. The steward arm is NOT, because
 * a steward's standing on a ready row comes from having WITHDRAWN it, not from the role alone.
 */
import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import { WorkItemRepositorySubstrate } from "../work-item-repository-substrate.js";

const CREATOR = { role: "engineer", agentId: "creator" };
const STEWARDS = [
  { role: "architect", agentId: "architect" },
  { role: "director", agentId: "director" },
];

function fixture() {
  const substrate = createMemoryStorageSubstrate();
  substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
  return new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
}

async function readyItem(repo: WorkItemRepositorySubstrate) {
  return repo.createWorkItem({
    type: "task", priority: "normal", roleEligibility: [],
    evidenceRequirements: [{ id: "e", kind: "freeform", description: "e" }],
    runbook: "r", createdBy: CREATOR,
  } as never);
}

describe("bug-462 authority-scope bar", () => {
  for (const steward of STEWARDS) {
    it(`${steward.role} override does not terminalize another creator's ordinary ready row`, async () => {
      const repo = fixture();
      const w = await readyItem(repo);
      expect(w).toMatchObject({ status: "ready" });
      expect(w.suspended).not.toBe(true);

      const abandon = (await repo.getLegalMoves(w.id, steward))!.moves.find((m) => m.verb === "abandon")!;
      expect(abandon.legal).toBe(false);
      await expect(repo.abandonWork(w.id, steward.agentId, {
        actorRole: steward.role,
        reason: "scope bar",
      })).rejects.toThrow(/abandon requires an active claim/);
      // the row SURVIVES — the check is that nothing was terminalized, not merely that a
      // call threw. A refusal that still mutated would pass a throws-assertion alone.
      expect((await repo.getWorkItem(w.id))!.status).toBe("ready");
    });
  }
});
