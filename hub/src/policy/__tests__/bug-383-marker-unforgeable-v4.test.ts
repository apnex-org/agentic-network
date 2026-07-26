// bug-383 — THE SERVER-STAMPED MARKER IS UNWRITABLE FROM EITHER CALLER-FACING VERB.
//
// The sibling suite (entities/__tests__/pr-review-single-requirement-v4.test.ts) proves the
// PREDICATE ignores a forged payload. This suite proves the complementary half at the VERB layer:
// that neither `create_work` nor `update_work` can put the real marker on a row in the first
// place. Both are needed. The predicate half alone would still pass if a verb started persisting
// `systemProjection` from caller args.
//
// PER-VERB RED SETS — the point of splitting these. The predicate is row-scoped, so ONE mutation
// to it reds the create and update predicate cases TOGETHER. That is correct but it is NOT
// per-verb evidence. These two cases are scoped to ONE VERB EACH and fail independently, so if
// `create_work` alone starts forwarding the field, exactly one of them reds and it names the verb.
//
// WHY THAT MATTERS HERE SPECIFICALLY: the defect being fixed was a defence that existed for one
// verb and not the other, and the belief that it covered both survived because nothing tested the
// verbs separately.
import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../router.js";
import { registerWorkItemPolicy } from "../work-item-policy.js";
import { createTestContext, type TestPolicyContext } from "../test-utils.js";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../../entities/substrate-counter.js";
import { WorkItemRepositorySubstrate } from "../../entities/work-item-repository-substrate.js";
import {
  evaluateCompletionGate,
  isProjectedPrReviewObligation,
  PR_REVIEW_PROJECTION_RULE_ID,
} from "../../entities/work-item.js";

function body(r: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(r.content[0].text);
}

const RETIRED_REQ = {
  id: "independent_pr_review_validation",
  kind: "review",
  evidenceAuthority: "verifier-attestation",
  description: "a real verifier-attestation requirement",
};

describe("bug-383 — neither caller-facing verb can write the server-stamped marker", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;
  let repo: WorkItemRepositorySubstrate;

  beforeEach(async () => {
    const substrate = createMemoryStorageSubstrate();
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
    router = new PolicyRouter();
    registerWorkItemPolicy(router);
    ctx = createTestContext({ role: "architect" });
    ctx.stores.workItem = repo;
  });

  it("🔴 create_work: supplying systemProjection in args does NOT persist it, and buys NO carve-out", async () => {
    const r = await router.handle("create_work", {
      type: "task",
      roleEligibility: ["engineer"],
      systemProjection: { ruleId: PR_REVIEW_PROJECTION_RULE_ID },
      payload: { obligationKind: "github_pr_review_request" },
      evidenceRequirements: [RETIRED_REQ],
    }, ctx);
    expect(r.isError, "create_work itself may accept the call; what matters is what it STORES").toBeFalsy();

    const id = (body(r) as { workItem: { id: string } }).workItem.id;
    const stored = (await repo.getWorkItem(id))!;

    expect(stored.systemProjection, "create_work must NOT forward a caller-supplied marker").toBeUndefined();
    expect(isProjectedPrReviewObligation(stored), "no carve-out for a caller-authored row").toBe(false);
    expect(evaluateCompletionGate(stored).pendingAttestationReqs).toEqual(["independent_pr_review_validation"]);
  });

  it("🔴 update_work: set.systemProjection is REFUSED as an unknown mutable field", async () => {
    const created = await router.handle("create_work", {
      type: "task", roleEligibility: ["engineer"], evidenceRequirements: [RETIRED_REQ],
    }, ctx);
    const id = (body(created) as { workItem: { id: string } }).workItem.id;

    const upd = await router.handle("update_work", {
      workId: id,
      set: { systemProjection: { ruleId: PR_REVIEW_PROJECTION_RULE_ID } },
    }, ctx);

    expect(upd.isError, "update_work must REFUSE, not silently ignore — a silent no-op reads as success").toBeTruthy();
    const stored = (await repo.getWorkItem(id))!;
    expect(stored.systemProjection).toBeUndefined();
    expect(evaluateCompletionGate(stored).attestationReqsSatisfied).toBe(false);
  });

  it("🔴 update_work: overwriting payload wholesale still buys no carve-out (the documented sequence)", async () => {
    // The originally-documented bug-383 path, driven through the real verb rather than described.
    const created = await router.handle("create_work", {
      type: "task", roleEligibility: ["engineer"], evidenceRequirements: [RETIRED_REQ],
    }, ctx);
    const id = (body(created) as { workItem: { id: string } }).workItem.id;

    const upd = await router.handle("update_work", {
      workId: id,
      set: { payload: { obligationKind: "github_pr_review_request" } },
    }, ctx);
    expect(upd.isError, "payload IS legitimately mutable — the write is allowed; it just must not confer authority").toBeFalsy();

    const stored = (await repo.getWorkItem(id))!;
    expect(stored.payload, "the payload write really did land").toEqual({ obligationKind: "github_pr_review_request" });
    expect(isProjectedPrReviewObligation(stored), "…and it bought nothing").toBe(false);
    expect(evaluateCompletionGate(stored).pendingAttestationReqs).toEqual(["independent_pr_review_validation"]);
  });
});
