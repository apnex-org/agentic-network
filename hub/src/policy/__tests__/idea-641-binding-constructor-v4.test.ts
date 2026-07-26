// idea-641 — A BINDING PAYLOAD IS REFUSED AT WRITE TIME, NOT AT A LATER GATE.
//
// THE OBSERVED FAILURES, all in one evening, all authored by someone who had a correct row open to
// copy — three different fields, three different gates, and EVERY ROW LOOKED COMPLETE TO A READER:
//   (1) payload as a JSON STRING       -> the decoder opens with isRecord(), so it never ran; the
//                                         store filter matches nested paths, so it never matched.
//                                         Refusal was `binding_missing` with an EMPTY candidate list.
//   (2) changedPaths absent            -> reviewer eligibility refuses, naming neither row nor field.
//   (3) obligationKind absent          -> the row is not even a lookup CANDIDATE, and the refusal
//                                         names binding_target_mismatch against a DIFFERENT row, so
//                                         the operand actively misdirects.
//   (+) an 8-char baseSha prefix       -> validatePrEvidenceBinding compares shas as STRINGS.
//
// Each case below is named after the DEFECT it catches, not after the instance that produced it.
import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../router.js";
import { registerWorkItemPolicy } from "../work-item-policy.js";
import { createTestContext, type TestPolicyContext } from "../test-utils.js";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../../entities/substrate-counter.js";
import { WorkItemRepositorySubstrate } from "../../entities/work-item-repository-substrate.js";
import {
  buildPrWorkGraphBindingPayload,
  PrBindingPayloadInvalid,
  prWorkGraphBindingProofFromWorkItem,
} from "../pr-evidence-admission-binding.js";

const HEAD = "18d0a14b2749c7852d720c9ba8eaa854e67d1cdf";
const BASE = "7b69237c0d2e95cf87c7aa7a5b78deb72b77e701";

/** A real, complete input — the shape work-536 eventually reached after two failed attempts. */
const GOOD = {
  repo: "apnex-org/agentic-network",
  prNumber: 679,
  targetWorkId: "work-533",
  headSha: HEAD,
  baseSha: BASE,
  changedPaths: ["hub/src/entities/work-item-repository-substrate.ts"],
};

function body(r: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(r.content[0].text);
}

describe("idea-641 — the validated binding-payload constructor", () => {
  it("🔴 SUPPLIES obligationKind and version; the caller never provides them", () => {
    const payload = buildPrWorkGraphBindingPayload(GOOD);
    expect(payload.obligationKind).toBe("github_pr_workgraph_binding");
    expect(payload.version).toBe("1");
    // The single property that closes BOTH faces: a caller can neither omit the marker (idea-641)
    // nor forge a different one (bug-383's shape), because the caller does not supply it at all.
    expect(Object.keys(GOOD)).not.toContain("obligationKind");
  });

  it("🔴 does NOT emit a caller-declared provenance (bug-376 is still open; this refuses to feed it)", () => {
    const payload = buildPrWorkGraphBindingPayload({ ...GOOD, provenance: "hub" } as never);
    expect(payload.provenance, "provenance must never originate from caller input").toBeUndefined();
  });

  it("🔴 reports EVERY problem at once, not just the first", () => {
    let err: PrBindingPayloadInvalid | null = null;
    try {
      buildPrWorkGraphBindingPayload({ repo: "not-a-repo", prNumber: 0, targetWorkId: "", headSha: "18d0a14b", baseSha: "", changedPaths: [] });
    } catch (e) { err = e as PrBindingPayloadInvalid; }
    expect(err).toBeInstanceOf(PrBindingPayloadInvalid);
    // SIX problems across six fields (repo, prNumber, targetWorkId, headSha, baseSha,
    // changedPaths). A first-failure-only validator would report one and cost six round-trips —
    // and serial round-trips on this exact shape are the ACTUAL history this constructor ends.
    expect(err!.problems.length).toBe(6);
    expect(err!.message).toContain("MECHANICS:");
    expect(err!.message).toContain("RATIONALE:");
    expect(err!.message).toContain("CONSEQUENCE:");
  });

  it("🔴 refuses an ABBREVIATED sha — the failure mode is silent string inequality", () => {
    expect(() => buildPrWorkGraphBindingPayload({ ...GOOD, baseSha: "7b69237c" }))
      .toThrow(/baseSha must be a FULL 40-char/);
    expect(() => buildPrWorkGraphBindingPayload({ ...GOOD, headSha: HEAD.toUpperCase() }))
      .toThrow(/headSha must be a FULL 40-char/);
  });

  it("🔴 refuses absent changedPaths — the gate that refuses later names neither row nor field", () => {
    expect(() => buildPrWorkGraphBindingPayload({ ...GOOD, changedPaths: [] })).toThrow(/changedPaths/);
    expect(() => buildPrWorkGraphBindingPayload({ ...GOOD, changedPaths: undefined as never })).toThrow(/changedPaths/);
  });

  it("🔴 ROUND-TRIP: what the constructor mints actually DECODES through production's decoder", () => {
    // Without this, every case above could pass while the constructor emitted a shape the real
    // decoder rejects — i.e. a validator that agrees only with itself.
    const payload = buildPrWorkGraphBindingPayload(GOOD);
    const proof = prWorkGraphBindingProofFromWorkItem(
      { id: "work-536", payload, createdBy: { role: "architect", agentId: "lily" } } as never,
      { repo: GOOD.repo, prNumber: GOOD.prNumber },
    );
    expect(proof, "a minted payload MUST decode — otherwise the constructor is self-consistent and useless").not.toBeNull();
    expect(proof!.targetWorkId).toBe("work-533");
    expect(proof!.headSha).toBe(HEAD);
    expect(proof!.provenance).toBe("hub");
  });
});

describe("idea-641 — the write-time gate on BOTH write verbs", () => {
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

  const create = (payload: unknown) => router.handle("create_work", { type: "freeform", roleEligibility: ["architect"], payload }, ctx);

  it("🔴 CALIBRATION: a payload that does NOT claim to be a binding passes untouched", async () => {
    // Load-bearing. Without it, a refusal below could mean "the gate rejects everything" rather
    // than "the gate rejects malformed BINDINGS", and every other case here would be vacuous.
    const r = await create({ arc: "mission-141", anything: [1, 2, 3] });
    expect(r.isError).toBeFalsy();
    const stored = (await repo.getWorkItem((body(r) as { workItem: { id: string } }).workItem.id))!;
    expect(stored.payload).toEqual({ arc: "mission-141", anything: [1, 2, 3] });
  });

  it("🔴 CALIBRATION: a well-formed binding is ACCEPTED and stored as an object", async () => {
    const r = await create(buildPrWorkGraphBindingPayload(GOOD));
    expect(r.isError, "the constructor's own output must survive the gate it feeds").toBeFalsy();
    const stored = (await repo.getWorkItem((body(r) as { workItem: { id: string } }).workItem.id))!;
    expect(typeof stored.payload).toBe("object");
  });

  it("🔴 create_work REFUSES a JSON-STRING binding payload", async () => {
    const r = await create(JSON.stringify(buildPrWorkGraphBindingPayload(GOOD)));
    expect(r.isError).toBeTruthy();
    expect(JSON.stringify(body(r))).toMatch(/JSON STRING that decodes to a PR binding/);
  });

  it("🔴 create_work REFUSES a binding missing changedPaths, naming the field", async () => {
    const { changedPaths: _drop, ...rest } = buildPrWorkGraphBindingPayload(GOOD) as Record<string, unknown>;
    const r = await create(rest);
    expect(r.isError).toBeTruthy();
    expect(JSON.stringify(body(r))).toMatch(/changedPaths/);
  });

  it("🔴 create_work REFUSES an abbreviated baseSha, naming the field", async () => {
    const r = await create({ ...buildPrWorkGraphBindingPayload(GOOD), baseSha: "7b69237c" });
    expect(r.isError).toBeTruthy();
    expect(JSON.stringify(body(r))).toMatch(/baseSha/);
  });

  it("🔴 update_work REFUSES the same malformed binding (per-verb: this fails independently of create)", async () => {
    const created = await create({ placeholder: true });
    const id = (body(created) as { workItem: { id: string } }).workItem.id;
    const r = await router.handle("update_work", {
      workId: id,
      set: { payload: { ...buildPrWorkGraphBindingPayload(GOOD), baseSha: "7b69237c" } },
    }, ctx);
    expect(r.isError).toBeTruthy();
    expect(JSON.stringify(body(r))).toMatch(/baseSha/);
    const stored = (await repo.getWorkItem(id))!;
    expect(stored.payload, "the bad write must not have landed").toEqual({ placeholder: true });
  });

  it("🔴 update_work ACCEPTS a well-formed binding (positive control for the update verb)", async () => {
    const created = await create({ placeholder: true });
    const id = (body(created) as { workItem: { id: string } }).workItem.id;
    const r = await router.handle("update_work", { workId: id, set: { payload: buildPrWorkGraphBindingPayload(GOOD) } }, ctx);
    expect(r.isError, "a correct binding must still be settable via update_work").toBeFalsy();
  });
});
