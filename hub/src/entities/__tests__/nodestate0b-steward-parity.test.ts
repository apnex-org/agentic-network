/**
 * nodestate0b-v2 criterion 3 — DISPOSAL PARITY ACROSS ALL THREE LAYERS.
 *
 * 🔴 WHY THIS FILE EXISTS, in the verifier's words:
 *
 *     "they test the pure matrix's steward ALLOW, creator parity, and holder denial
 *      SEPARATELY, but never compare the steward decision ACROSS matrix, legal-moves,
 *      and repository execution."
 *
 * EVERY LAYER WAS INDIVIDUALLY CORRECT. The matrix allowed steward disposal and a test
 * asserted that. legal_moves was tested. The repository was tested. Nothing compared the
 * SAME decision across all three, so two layers could disagree with the first and every
 * test stayed green.
 *
 * My earlier F1 work asserted THE PAIR for the creator and holder arms — that instinct was
 * right and those arms are still fixed. The gap: `steward` is a THIRD actor class beside
 * creator and holder, and it needed its own comparison. Fixing a class of defect for the
 * instances you know about leaves the instances you have not enumerated.
 *
 * So this file does not add more per-layer cases. It adds ONE helper that drives all three
 * layers for a given (row, caller) and returns their verdicts together, and then asserts
 * AGREEMENT for every actor class. A new actor class added later gets a row here and is
 * checked on all three layers by construction.
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

const CREATOR = { role: "engineer", agentId: "creator" };
const STEWARD = { role: "architect", agentId: "arch" };
const DIRECTOR = { role: "director", agentId: "dir" };
const STRANGER = { role: "engineer", agentId: "nobody" };

function fixture() {
  const substrate = createMemoryStorageSubstrate();
  substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
  return new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
}

async function item(repo: WorkItemRepositorySubstrate) {
  return repo.createWorkItem({
    type: "task", priority: "normal", roleEligibility: [],
    evidenceRequirements: [{ id: "e", kind: "freeform", description: "e" }],
    runbook: "r", createdBy: CREATOR,
  } as never);
}

type Verdicts = { matrix: boolean | null; advertised: boolean; executed: boolean };

/** Drives the disposal decision through ALL THREE layers for one (row, caller) and returns
 *  their verdicts side by side. `abandonWork` is terminal, so it is called LAST. */
async function disposalVerdicts(
  repo: WorkItemRepositorySubstrate,
  workId: string,
  caller: { role: string; agentId: string },
  opts: { leaseToken?: string } = {},
): Promise<Verdicts> {
  const row = (await repo.getWorkItem(workId))!;
  const matrix = isActivelyWithdrawn(row)
    ? evaluateSuspendedDisposalAuthority(row, caller, opts).allowed
    : null; // the matrix only adjudicates SUSPENDED rows; null = "not this layer's question"
  const advertised = (await repo.getLegalMoves(workId, caller))!
    .moves.find((m) => m.verb === "abandon")!.legal;
  let executed = false;
  try {
    const result = await repo.abandonWork(workId, caller.agentId, {
      reason: "disposal", actorRole: caller.role, leaseToken: opts.leaseToken,
    });
    executed = result?.status === "abandoned";
  } catch {
    executed = false;
  }
  return { matrix, advertised, executed };
}

/** The invariant the whole criterion reduces to: every layer that has an opinion agrees. */
function expectAgreement(v: Verdicts, expected: boolean) {
  expect(v.advertised).toBe(expected);
  expect(v.executed).toBe(expected);
  if (v.matrix !== null) expect(v.matrix).toBe(expected);
}

describe("criterion 3 — the disposal decision agrees across matrix, legal_moves and execution", () => {
  it("🔴 ARM 1: STEWARD over a suspended ACTIVE row held by someone else — all three ALLOW", async () => {
    // Was: legal_moves FALSE while abandonWork SUCCEEDED. The base legal_moves predicate
    // admitted only holder|creator, so the suspended post-filter — which can only DOWNGRADE
    // a move — never reached the matrix's steward arm.
    const repo = fixture();
    const w = await item(repo);
    await repo.claimWorkItem(w.id, "holder", "engineer");
    await repo.pauseWork({ workId: w.id, operationId: "sp", reason: "management withdrawal" }, STEWARD);
    expectAgreement(await disposalVerdicts(repo, w.id, STEWARD), true);
  });

  it("🔴 ARM 2: STEWARD over a suspended READY row — all three ALLOW", async () => {
    // Was: matrix ALLOWED, legal_moves FALSE, and the repository's ready-phase gate REJECTED.
    // TWO layers below the matrix disagreed with it, so this arm needed both repairs.
    const repo = fixture();
    const w = await item(repo);
    await repo.pauseWork({ workId: w.id, operationId: "srp", reason: "management withdrawal" }, STEWARD);
    expectAgreement(await disposalVerdicts(repo, w.id, STEWARD), true);
  });

  it("🔴 the DIRECTOR arm agrees too — steward is a role class, not one account", async () => {
    const repo = fixture();
    const w = await item(repo);
    await repo.pauseWork({ workId: w.id, operationId: "dp", reason: "management withdrawal" }, DIRECTOR);
    expectAgreement(await disposalVerdicts(repo, w.id, DIRECTOR), true);
  });

  it("🟢 REGRESSION: the CREATOR arm still agrees on a suspended-ready row", async () => {
    const repo = fixture();
    const w = await item(repo);
    await repo.pauseWork({ workId: w.id, operationId: "cp", reason: "self" }, CREATOR);
    expectAgreement(await disposalVerdicts(repo, w.id, CREATOR), true);
  });

  it("🟢 THE DENY ARM MUST ALSO AGREE: holder after a STEWARD suspension — all three REFUSE", async () => {
    // The fix must not have opened disposal generally. A holder whose row a steward withdrew
    // is still refused, and refused at every layer rather than only at the CAS.
    const repo = fixture();
    const w = await item(repo);
    const claimed = await repo.claimWorkItem(w.id, "holder", "engineer");
    await repo.pauseWork({ workId: w.id, operationId: "sp2", reason: "management withdrawal" }, STEWARD);
    const v = await disposalVerdicts(repo, w.id, { role: "engineer", agentId: "holder" },
      { leaseToken: claimed?.lease?.token });
    expectAgreement(v, false);
  });

  it("🔴 bug-462 SCOPE: a steward over an UNSUSPENDED ready row is refused by all three", async () => {
    // THE CONTEXT THIS TABLE ORIGINALLY OMITTED. Every row above suspends first, so the
    // steward arms were only ever exercised WITH the withdrawal present — and the fix that
    // satisfied them dropped the suspension conjunct without a single row noticing.
    // The helper compares all three LAYERS; it cannot tell me I forgot a CONTEXT. Enumerating
    // (actor x context), not just actor, is the part that was missing.
    const repo = fixture();
    const w = await item(repo);
    expect((await repo.getWorkItem(w.id))!.suspended).not.toBe(true);
    expectAgreement(await disposalVerdicts(repo, w.id, STEWARD), false);
    expect((await repo.getWorkItem(w.id))!.status).toBe("ready"); // and nothing was terminalized
  });

  it("🔴 bug-462 SCOPE: a DIRECTOR over an UNSUSPENDED ready row is refused by all three", async () => {
    const repo = fixture();
    const w = await item(repo);
    expectAgreement(await disposalVerdicts(repo, w.id, DIRECTOR), false);
    expect((await repo.getWorkItem(w.id))!.status).toBe("ready");
  });

  it("🟢 CONTROL: the CREATOR arm from ready is UNCONDITIONAL — it must NOT have been narrowed", async () => {
    // bug-219 fix (c): a role-gated ready row with no eligible seat is otherwise unclaimable
    // and un-closeable, so the creator needs no suspension. Narrowing BOTH arms to `suspended`
    // would have satisfied the scope bar and reintroduced that dead-end.
    const repo = fixture();
    const w = await item(repo);
    expect((await repo.getWorkItem(w.id))!.suspended).not.toBe(true);
    expectAgreement(await disposalVerdicts(repo, w.id, CREATOR), true);
  });

  it("🟢 an UNRELATED caller is refused by all three", async () => {
    const repo = fixture();
    const w = await item(repo);
    await repo.pauseWork({ workId: w.id, operationId: "sp3", reason: "management withdrawal" }, STEWARD);
    expectAgreement(await disposalVerdicts(repo, w.id, STRANGER), false);
  });

  it("🟢 a steward's advertised ALLOW carries NO refusal reason", async () => {
    // A move that is legal but still carries a reason is a half-corrected projection — the
    // same bar the verifier set for the creator arm, applied to the steward arm.
    const repo = fixture();
    const w = await item(repo);
    await repo.pauseWork({ workId: w.id, operationId: "sp4", reason: "management withdrawal" }, STEWARD);
    const advertised = (await repo.getLegalMoves(w.id, STEWARD))!.moves.find((m) => m.verb === "abandon")!;
    expect(advertised).toMatchObject({ verb: "abandon", legal: true });
    expect(advertised.reason).toBeUndefined();
  });
});
