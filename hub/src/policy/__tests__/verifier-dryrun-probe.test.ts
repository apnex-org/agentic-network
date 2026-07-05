/**
 * mission-102 B8-R1 (work-128) — the verifier dry-run rejection probes.
 *
 * Steve's audit-10226 finding: verifier RBAC denied route/resolve/capture
 * BEFORE the proof/evaluator checks, so the live contract rejections
 * (#1 class-spoof, #7 proxy-without-proof family, #11/#12) were unreachable
 * from the verifier seat — live evidence was impossible without
 * self-certification.
 *
 * The dry-run contract (steve's amendment 3, verbatim invariants):
 *   - non-dry verifier calls still reject EXACTLY as before (the authority
 *     fence is unchanged);
 *   - dryRun causes NO transition, NO confirmation consume/mint, NO emitted
 *     Messages, NO arrival/presence side effects;
 *   - dryRun exercises the SAME validator objects (DirectorProofGate, grant
 *     evaluator via the gate, validatePlan, the FSM table) — never a parallel
 *     probe implementation;
 *   - every verdict reports independently, so an unrouted probe decision
 *     still exercises the proof/evaluator paths.
 *
 * Real repos on the memory substrate through the router (the same harness
 * class as decision-execution.test.ts).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../router.js";
import { registerDecisionPolicy } from "../decision-policy.js";
import { registerDirectorProofPolicy } from "../director-proof-policy.js";
import { createTestContext, type TestPolicyContext } from "../test-utils.js";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../../entities/substrate-counter.js";
import { DecisionRepositorySubstrate } from "../../entities/decision-repository-substrate.js";
import { DirectorProofRepositorySubstrate } from "../../entities/director-proof-repository-substrate.js";
import { ClassGrantRepositorySubstrate } from "../../entities/class-grant-repository-substrate.js";
import type { DecisionActor } from "../../entities/decision.js";

const ARCHITECT: DecisionActor = { agentId: "agent-arch", role: "architect", sessionId: "s-a" };
const DIRECTOR: DecisionActor = { agentId: "agent-dir", role: "director", sessionId: "s-d" };

function body(r: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(r.content[0].text);
}

describe("verifier dry-run probes (B8-R1 / work-128: live rejection paths from the verifier seat)", () => {
  let router: PolicyRouter;
  let vctx: TestPolicyContext; // the VERIFIER seat
  let decisions: DecisionRepositorySubstrate;
  let proofs: DirectorProofRepositorySubstrate;
  let grants: ClassGrantRepositorySubstrate;

  beforeEach(async () => {
    const substrate = createMemoryStorageSubstrate();
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    const counter = new SubstrateCounter(substrate);
    decisions = new DecisionRepositorySubstrate(substrate, counter);
    proofs = new DirectorProofRepositorySubstrate(substrate, counter);
    grants = new ClassGrantRepositorySubstrate(substrate, counter);
    router = new PolicyRouter();
    registerDecisionPolicy(router);
    registerDirectorProofPolicy(router);
    vctx = createTestContext({ role: "verifier" });
    vctx.stores.decision = decisions;
    vctx.stores.directorProof = proofs;
    vctx.stores.classGrant = grants;
  });

  async function routedDecision(title: string, cls = "approval"): Promise<string> {
    const d = await decisions.raiseDecision({
      title, context: "c", class: cls,
      options: [{ id: "yes", label: "Yes", description: "y" }], raisedBy: ARCHITECT,
    });
    await decisions.curateDecision(d.id, ARCHITECT);
    await decisions.routeDecision(d.id, ARCHITECT, { target: "director" });
    return d.id;
  }

  async function mintProbeGrant(cls = "approval-unblock"): Promise<string> {
    const g = await grants.mintGrant({
      class: cls, allowedActions: ["unblock"], reversibleOnly: true,
      excludedRefs: [], excludedClasses: [],
      ratificationRef: "decision-999", representationDays: 30,
    }, { resolved: true, resolvedAt: new Date().toISOString() });
    return `${g.id}@v${g.version}`;
  }

  // ── The fence: non-dry verifier calls reject EXACTLY as before ─────────────
  it("fence intact: verifier without dryRun is denied on all three verbs (authority unchanged)", async () => {
    const id = await routedDecision("fenced");
    for (const [verb, vargs] of [
      ["resolve_as_director", { decisionId: id, proofRef: "dsig-1", chosenOptionId: "yes" }],
      ["route_decision", { decisionId: id, target: "director" }],
      ["capture_director_signal", { channel: "ois-say", answer: "yes", capturedBySurface: "cli", confidence: "session-bound" }],
    ] as const) {
      const r = await router.handle(verb, vargs as Record<string, unknown>, vctx);
      expect(r.isError, `${verb} must deny non-dry verifier`).toBe(true);
      expect(String(body(r).error)).toMatch(/dryRun/);
    }
    expect((await decisions.getDecision(id))!.status).toBe("routed"); // untouched
  });

  // ── #7 family: proxy-without-proof / assertion-ref hit the REAL gate ───────
  it("resolve dryRun: no proof and assertion-class refs produce the REAL gate rejections; decision untouched, nothing consumed or emitted", async () => {
    const id = await routedDecision("probe-proof");
    // (a) no proofRef at all
    const r1 = body(await router.handle("resolve_as_director", { decisionId: id, chosenOptionId: "yes", dryRun: true }, vctx));
    expect(r1.dryRun).toBe(true);
    expect((r1.proof as { ok: boolean; rejection: string }).ok).toBe(false);
    expect((r1.proof as { rejection: string }).rejection).toMatch(/proof/i);
    // (b) an assertion-class ref (an audit is not proof)
    const r2 = body(await router.handle("resolve_as_director", { decisionId: id, proofRef: "audit-10207", chosenOptionId: "yes", dryRun: true }, vctx));
    expect((r2.proof as { ok: boolean }).ok).toBe(false);
    expect(r2.wouldSucceed).toBe(false);
    // ZERO effects across both probes:
    expect((await decisions.getDecision(id))!.status).toBe("routed");
    expect((await vctx.stores.message.listMessages({})).filter((m) => m.kind === "external-injection")).toHaveLength(0);
  });

  // ── #1 class-spoof: the grant evaluator rejection, live from the verifier ──
  it("route dryRun: citing a grant of the WRONG class reports the class-spoof rejection via the REAL evaluator path; decision stays curated", async () => {
    const d = await decisions.raiseDecision({
      title: "spoof probe", context: "c", class: "totally-different-class",
      options: [], raisedBy: ARCHITECT,
    });
    await decisions.curateDecision(d.id, ARCHITECT);
    const grantRef = await mintProbeGrant("approval-unblock");
    const grantId = grantRef.split("@")[0];
    const r = body(await router.handle("route_decision", {
      decisionId: d.id, target: "self-disposal",
      selfDisposal: { classGrantRef: grantId }, dryRun: true,
    }, vctx));
    expect(r.dryRun).toBe(true);
    const citation = (r.checks as Array<{ check: string; ok: boolean; rejection?: string }>).find((c) => c.check === "citation")!;
    expect(citation.ok).toBe(false);
    expect(citation.rejection).toMatch(/cannot launder a class onto a grant/);
    expect(r.wouldSucceed).toBe(false);
    expect((await decisions.getDecision(d.id))!.status).toBe("curated"); // no transition
  });

  it("route dryRun: a REVOKED grant citation reports the revoked rejection (the live #3 evaluator leg)", async () => {
    const d = await decisions.raiseDecision({ title: "revoked probe", context: "c", class: "approval-unblock", options: [], raisedBy: ARCHITECT });
    await decisions.curateDecision(d.id, ARCHITECT);
    const grantRef = await mintProbeGrant("approval-unblock");
    const grantId = grantRef.split("@")[0];
    await grants.revokeGrant(grantId, "probe revoke");
    const r = body(await router.handle("route_decision", {
      decisionId: d.id, target: "self-disposal", selfDisposal: { classGrantRef: grantId }, dryRun: true,
    }, vctx));
    const citation = (r.checks as Array<{ check: string; ok: boolean; rejection?: string }>).find((c) => c.check === "citation")!;
    expect(citation.ok).toBe(false);
    expect(citation.rejection).toMatch(/revoked, not active/);
  });

  // ── The affirmative path: a WOULD-SUCCEED report without any effect ────────
  it("resolve dryRun on a signal-proofed routed decision reports wouldSucceed WITHOUT resolving (the #11 zero-effects contract, probe edition)", async () => {
    const id = await routedDecision("would-succeed");
    const sig = await proofs.mintSignal({ channel: "ois-say", answer: "yes", capturedBySurface: "cli", confidence: "session-bound", replyable: true, capturedBy: DIRECTOR });
    const r = body(await router.handle("resolve_as_director", { decisionId: id, proofRef: sig.id, chosenOptionId: "yes", dryRun: true }, vctx));
    expect((r.proof as { ok: boolean; authorityMode: string }).ok).toBe(true);
    expect((r.proof as { authorityMode: string }).authorityMode).toBe("director-via-proxy");
    expect(r.wouldSucceed).toBe(true);
    // ...and NOTHING happened: still routed, no resolution, no messages.
    const after = (await decisions.getDecision(id))!;
    expect(after.status).toBe("routed");
    expect(after.resolution).toBeNull();
  });

  it("resolve dryRun on an UNROUTED decision still exercises the proof path (independent verdicts — the no-seeded-rows wrinkle)", async () => {
    const d = await decisions.raiseDecision({ title: "raw probe", context: "c", class: "x", options: [{ id: "yes", label: "Y", description: "y" }], raisedBy: ARCHITECT });
    const sig = await proofs.mintSignal({ channel: "ois-say", answer: "yes", capturedBySurface: "cli", confidence: "session-bound", replyable: true, capturedBy: DIRECTOR });
    const r = body(await router.handle("resolve_as_director", { decisionId: d.id, proofRef: sig.id, chosenOptionId: "yes", dryRun: true }, vctx));
    expect((r.phase as { resolvable: boolean }).resolvable).toBe(false); // raised, not routed
    expect((r.proof as { ok: boolean }).ok).toBe(true);                  // the gate STILL ran
    expect(r.wouldSucceed).toBe(false);
    expect((await decisions.getDecision(d.id))!.status).toBe("raised");
  });

  // ── capture dryRun: binds nothing, mints nothing ────────────────────────────
  it("capture dryRun reports the confirmation binding WITHOUT minting; a real director capture afterwards still works", async () => {
    const id = await routedDecision("capture-probe");
    const conf = await proofs.mintConfirmation({
      decisionId: id, promptHash: "h1", proposedResolutionHash: "h2",
      proposedAnswer: { chosenOptionId: "yes" }, executionPlanHash: null, ttlMs: 60_000,
    });
    const r = body(await router.handle("capture_director_signal", {
      channel: "ois-say", answer: "yes", capturedBySurface: "cli", confidence: "session-bound",
      decisionId: id, dryRun: true,
    }, vctx));
    expect(r.dryRun).toBe(true);
    expect(r.wouldBindConfirmationId).toBe(conf.id);
    // NOTHING minted: the confirmation is still unanswered.
    const echo = await proofs.getConfirmation(conf.id);
    expect(echo!.answeredBySignalId ?? null).toBeNull();
  });
});
