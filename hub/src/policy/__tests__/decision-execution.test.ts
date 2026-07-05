/**
 * mission-102 P3-B5 — atomic resolve+execute tests (memory substrate, REAL repos
 * end to end through the router: Decision + DirectorProof + WorkItem + Proposal).
 *
 * The two G2-BINDING contract tests this slice owns:
 *   #11 atomicity — ANY proof/plan-validation failure → whole-transition reject
 *       with ZERO effects (decision stays routed; no target touched);
 *   #12 plan-hash — a confirmation whose executionPlanHash does not match the
 *       decision's stored plan REJECTS (exact-binding through the B4 machinery).
 * Plus: the happy path (resolved+executed in one verb call; both registry
 * actions fire), the tight unblock authority (only what waits on THIS decision),
 * and the failure-park (executePlan failure → resolved + executorBinding.ok=false,
 * never executed, never silent).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../router.js";
import { registerDecisionPolicy } from "../decision-policy.js";
import { registerDirectorProofPolicy } from "../director-proof-policy.js";
import { createTestContext, type TestPolicyContext } from "../test-utils.js";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { SubstrateCounter } from "../../entities/substrate-counter.js";
import { DecisionRepositorySubstrate } from "../../entities/decision-repository-substrate.js";
import { DirectorProofRepositorySubstrate, hashProposedResolution, canonicalPromptHash } from "../../entities/director-proof-repository-substrate.js";
import { WorkItemRepositorySubstrate } from "../../entities/work-item-repository-substrate.js";
import { ProposalRepositorySubstrate } from "../../entities/proposal-repository-substrate.js";
import { executePlan } from "../../entities/decision-executor.js";
import type { DecisionActor } from "../../entities/decision.js";
import type { WorkItemBlockedOn } from "../../entities/work-item.js";

const ARCHITECT: DecisionActor = { agentId: "agent-arch", role: "architect", sessionId: "s-a" };
const DIRECTOR: DecisionActor = { agentId: "agent-dir", role: "director", sessionId: "s-d" };

function body(r: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(r.content[0].text);
}

describe("decision execution (P3-B5: registry + atomic resolve+execute)", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;
  let decisions: DecisionRepositorySubstrate;
  let proofs: DirectorProofRepositorySubstrate;
  let workItems: WorkItemRepositorySubstrate;
  let proposals: ProposalRepositorySubstrate;

  beforeEach(async () => {
    const substrate = createMemoryStorageSubstrate();
    const counter = new SubstrateCounter(substrate);
    decisions = new DecisionRepositorySubstrate(substrate, counter);
    proofs = new DirectorProofRepositorySubstrate(substrate, counter);
    workItems = new WorkItemRepositorySubstrate(substrate, counter);
    proposals = new ProposalRepositorySubstrate(substrate, counter);
    router = new PolicyRouter();
    registerDecisionPolicy(router);
    registerDirectorProofPolicy(router);
    ctx = createTestContext({ role: "architect" });
    ctx.stores.decision = decisions;
    ctx.stores.directorProof = proofs;
    ctx.stores.workItem = workItems;
    ctx.stores.proposal = proposals;
  });

  /** A work item blocked ON the given decision + a submitted proposal. */
  async function targetsFor(decisionId: string) {
    const w = await workItems.createWorkItem({ type: "task", roleEligibility: [] });
    const claimed = await workItems.claimWorkItem(w.id, "agent-holder");
    await workItems.startWork(w.id, "agent-holder", claimed!.lease!.token);
    const blocked: WorkItemBlockedOn = { blockerKind: "Decision", blockerIds: [decisionId], reason: "awaiting director decision" };
    await workItems.blockWork(w.id, "agent-holder", claimed!.lease!.token, blocked);
    const p = await proposals.submitProposal("t", "s", "b");
    return { workId: w.id, proposalId: p.id };
  }

  /** raise→curate→route a decision whose plan targets the two entities. */
  async function armedDecision() {
    const d = await decisions.raiseDecision({
      title: "unblock+approve", context: "ctx", class: "approval-unblock",
      options: [{ id: "yes", label: "Yes", description: "do it" }],
      raisedBy: ARCHITECT,
    });
    const t = await targetsFor(d.id);
    await decisions.curateDecision(d.id, ARCHITECT);
    await decisions.routeDecision(d.id, ARCHITECT, { target: "director" }, [
      { action: "unblock", targetRef: t.workId },
      { action: "approve", targetRef: t.proposalId },
    ]);
    return { decisionId: d.id, ...t };
  }

  it("happy path: signal-proofed resolve fires BOTH registry actions and lands EXECUTED in one verb call (the CL-1 seam closed)", async () => {
    const { decisionId, workId, proposalId } = await armedDecision();
    const sig = await proofs.mintSignal({ channel: "ois-say", answer: "yes", capturedBySurface: "cli", confidence: "session-bound", replyable: true, capturedBy: DIRECTOR });
    const r = await router.handle("resolve_as_director", { decisionId, proofRef: sig.id, chosenOptionId: "yes" }, ctx);
    expect(r.isError).toBeFalsy();
    const d = (body(r) as { decision: { status: string; executorBinding: { ok: boolean } } }).decision;
    expect(d.status).toBe("executed");
    expect(d.executorBinding.ok).toBe(true);
    expect((await workItems.getWorkItem(workId))!.status).toBe("in_progress"); // unblocked
    expect((await workItems.getWorkItem(workId))!.blockedOn).toBeNull();
    const p = await proposals.getProposal(proposalId);
    expect((p as unknown as { status?: string }).status ?? JSON.stringify(p)).toMatch(/approved/i);
  });

  // ── CONTRACT TEST 11 (G2-BINDING): zero effects on ANY proof failure ─────────
  it("contract #11: proof failure → whole-transition REJECT, zero effects (decision routed; target still blocked; proposal untouched)", async () => {
    const { decisionId, workId, proposalId } = await armedDecision();
    // (a) no proof at all
    const r1 = await router.handle("resolve_as_director", { decisionId, chosenOptionId: "yes" }, ctx);
    expect(r1.isError).toBe(true);
    // (b) assertion-class ref
    const r2 = await router.handle("resolve_as_director", { decisionId, proofRef: "audit-1", chosenOptionId: "yes" }, ctx);
    expect(r2.isError).toBe(true);
    // ZERO effects across both attempts:
    expect((await decisions.getDecision(decisionId))!.status).toBe("routed");
    expect((await decisions.getDecision(decisionId))!.executorBinding).toBeNull();
    expect((await workItems.getWorkItem(workId))!.status).toBe("blocked");
    const p = await proposals.getProposal(proposalId);
    expect((p as unknown as { status?: string }).status ?? "submitted").not.toMatch(/approved/i);
  });

  it("contract #11b: plan-validation failure (unblock target NOT blocked on this decision) rejects BEFORE the decision transitions", async () => {
    const d = await decisions.raiseDecision({ title: "bad plan", context: "c", class: "x", options: [], raisedBy: ARCHITECT });
    // a work item blocked on a DIFFERENT blocker
    const w = await workItems.createWorkItem({ type: "task", roleEligibility: [] });
    const claimed = await workItems.claimWorkItem(w.id, "agent-h2");
    await workItems.startWork(w.id, "agent-h2", claimed!.lease!.token);
    await workItems.blockWork(w.id, "agent-h2", claimed!.lease!.token, { blockerKind: "external", blockerIds: ["something-else"], reason: "r" });
    await decisions.curateDecision(d.id, ARCHITECT);
    await decisions.routeDecision(d.id, ARCHITECT, { target: "director" }, [{ action: "unblock", targetRef: w.id }]);
    const sig = await proofs.mintSignal({ channel: "ois-say", answer: "yes", capturedBySurface: "cli", confidence: "session-bound", replyable: true, capturedBy: DIRECTOR });
    const r = await router.handle("resolve_as_director", { decisionId: d.id, proofRef: sig.id, customAnswer: "yes" }, ctx);
    expect(r.isError).toBe(true);
    expect(body(r).error).toMatch(/not blocked ON this decision/);
    expect((await decisions.getDecision(d.id))!.status).toBe("routed"); // never transitioned
    expect((await workItems.getWorkItem(w.id))!.status).toBe("blocked"); // untouched
  });

  // ── CONTRACT TEST 12 (G2-BINDING): plan-hash mismatch rejects ────────────────
  it("contract #12: a confirmation whose executionPlanHash mismatches the stored plan REJECTS with zero effects", async () => {
    const { decisionId, workId } = await armedDecision();
    const decision = (await decisions.getDecision(decisionId))!;
    // Mint a confirmation binding the RIGHT prompt/answer but the WRONG plan hash
    // (as if the Director confirmed a different plan than the one now stored).
    const c = await proofs.mintConfirmation({
      decisionId,
      promptHash: canonicalPromptHash(decision),
      proposedResolutionHash: hashProposedResolution({ chosenOptionId: "yes" }),
      executionPlanHash: "0".repeat(64), // divergent
      ttlMs: 60_000,
    });
    await proofs.mintSignal({ channel: "ois-say", answer: "confirmed", capturedBySurface: "cli", confidence: "session-bound", replyable: true, capturedBy: DIRECTOR, confirmationId: c.id });
    const r = await router.handle("resolve_as_director", { decisionId, proofRef: c.id, chosenOptionId: "yes" }, ctx);
    expect(r.isError).toBe(true);
    expect(body(r).error).toMatch(/hash mismatch/);
    expect((await decisions.getDecision(decisionId))!.status).toBe("routed");
    expect((await workItems.getWorkItem(workId))!.status).toBe("blocked"); // zero effects
  });

  it("failure-park: an effect failing mid-plan leaves the decision RESOLVED with executorBinding.ok=false — visible, never executed, never silent", async () => {
    // Unit-level: executePlan against a target that throws (the vanished/raced case).
    const d = await decisions.raiseDecision({ title: "park", context: "c", class: "x", options: [], raisedBy: ARCHITECT });
    await decisions.curateDecision(d.id, ARCHITECT);
    await decisions.routeDecision(d.id, ARCHITECT, { target: "director" }, [{ action: "unblock", targetRef: "work-vanished" }]);
    const sig = await proofs.mintSignal({ channel: "ois-say", answer: "yes", capturedBySurface: "cli", confidence: "session-bound", replyable: true, capturedBy: DIRECTOR });
    // resolve at the STORE level (bypassing policy validation to simulate the
    // validate→execute race where the target vanished after validation)
    const { DirectorProofGate } = await import("../../entities/director-proof-repository-substrate.js");
    const resolved = (await decisions.resolveDecision(d.id, ARCHITECT, { customAnswer: "yes" }, new DirectorProofGate(proofs), { claimedAuthorityRef: sig.id }))!;
    const outcome = await executePlan(resolved, { workItem: workItems, proposal: proposals });
    expect(outcome.ok).toBe(false);
    const bound = (await decisions.recordExecutorBinding(d.id, { executor: ARCHITECT, boundAt: new Date().toISOString(), ok: outcome.ok, results: outcome.results }))!;
    expect(bound.status).toBe("resolved");           // parked, NOT executed
    expect(bound.executorBinding!.ok).toBe(false);   // failure visible to aging
    expect(bound.executorBinding!.results[0].detail).toMatch(/does not resolve|vanished|requires blocked|not found/i);
  });
});
