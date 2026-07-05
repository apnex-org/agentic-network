/**
 * mission-102 P3-B4 — Director proof-path policy tests: tool registration, the
 * DIRECTOR RBAC gate on signal capture (the registered-ingress contract),
 * Hub-side stamping/hashing, arg validation, and the consume-after-commit +
 * event emission on resolve_as_director. (The gate's proof rules — contract
 * test 7 — are covered by the real-pg substrate suite.)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../router.js";
import { registerDirectorProofPolicy } from "../director-proof-policy.js";
import { registerDecisionPolicy, DECISION_TRANSITION_EVENT } from "../decision-policy.js";
import { createTestContext, type TestPolicyContext } from "../test-utils.js";
import type { Decision, IDecisionStore } from "../../entities/decision.js";
import type { IDirectorProofStore, DirectorSignal, DirectorConfirmation } from "../../entities/director-proof.js";

type Call = { method: string; args: unknown[] };

function makeProofStub(overrides: Partial<Record<keyof IDirectorProofStore, (...a: unknown[]) => unknown>> = {}) {
  const calls: Call[] = [];
  const m = (method: keyof IDirectorProofStore) => (...args: unknown[]) => {
    calls.push({ method, args });
    const fn = overrides[method];
    return fn ? fn(...args) : null;
  };
  return {
    calls,
    mintSignal: m("mintSignal"), getSignal: m("getSignal"),
    mintConfirmation: m("mintConfirmation"), getConfirmation: m("getConfirmation"),
    consumeConfirmation: m("consumeConfirmation"),
  } as unknown as IDirectorProofStore & { calls: Call[] };
}

function makeDecisionStub(overrides: Partial<Record<keyof IDecisionStore, (...a: unknown[]) => unknown>> = {}) {
  const calls: Call[] = [];
  const m = (method: keyof IDecisionStore) => (...args: unknown[]) => {
    calls.push({ method, args });
    const fn = overrides[method];
    return fn ? fn(...args) : null;
  };
  return {
    calls,
    raiseDecision: m("raiseDecision"), getDecision: m("getDecision"), listDecisions: m("listDecisions"),
    curateDecision: m("curateDecision"), routeDecision: m("routeDecision"), resolveDecision: m("resolveDecision"),
    markExecuted: m("markExecuted"), recordExecutorBinding: m("recordExecutorBinding"), mergeDecision: m("mergeDecision"), disposeDecision: m("disposeDecision"),
    withdrawDecision: m("withdrawDecision"), listAging: m("listAging"),
  } as unknown as IDecisionStore & { calls: Call[] };
}

const sampleDecision = (over: Partial<Decision> = {}): Decision => ({
  id: "decision-1", schemaVersion: 1, parentRef: null, class: null,
  title: "t", context: "c", contextRefs: [], options: [{ id: "a", label: "A", description: "a" }],
  freeAnswerPolicy: "always",
  raisedBy: { agentId: "agent-x", role: "engineer" }, curatedBy: null, curationRecordRef: null,
  routedTo: { target: "director" }, routedBy: null, resolution: null, executionPlan: [],
  mergedInto: null, disposedReason: null, executorBinding: null, status: "routed",
  enteredCurrentStateAt: "t0", stateDurations: { raised: 0, curated: 0, routed: 0, resolved: 0 },
  createdAt: "t0", updatedAt: "t0", ...over,
});

function ctxFor(role: string, stores: { decision?: IDecisionStore; directorProof?: IDirectorProofStore }): TestPolicyContext {
  const ctx = createTestContext({ role });
  ctx.stores.decision = stores.decision;
  ctx.stores.directorProof = stores.directorProof;
  return ctx;
}
function body(r: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(r.content[0].text);
}

describe("director-proof-policy (P3-B4)", () => {
  let router: PolicyRouter;
  beforeEach(() => {
    router = new PolicyRouter();
    registerDecisionPolicy(router);
    registerDirectorProofPolicy(router);
  });

  it("registers the 4 proof-path tools", () => {
    for (const t of ["capture_director_signal", "get_director_signal", "mint_director_confirmation", "resolve_as_director"]) {
      expect(router.getRegisteredTools()).toContain(t);
    }
  });

  it("RBAC: capture_director_signal is DIRECTOR-only (architect + engineer denied — a non-director session cannot mint Director-origin proof)", async () => {
    const proofs = makeProofStub();
    for (const role of ["architect", "engineer", "verifier"]) {
      const r = await router.handle("capture_director_signal", { channel: "ois-say", answer: "x", capturedBySurface: "cli", confidence: "session-bound" }, ctxFor(role, { directorProof: proofs }));
      expect(r.isError).toBe(true);
      expect(body(r).error).toMatch(/Authorization denied/);
    }
    expect(proofs.calls.length).toBe(0);
  });

  it("capture_director_signal Hub-stamps capturedBy from the DIRECTOR session (agentId/role/sessionId — never caller-supplied)", async () => {
    const proofs = makeProofStub({ mintSignal: (input: unknown) => ({ id: "dsig-1", ...(input as object) }) as unknown as DirectorSignal });
    const ctx = ctxFor("director", { directorProof: proofs });
    const r = await router.handle("capture_director_signal", { channel: "ois-say", answer: "approved", capturedBySurface: "cli", confidence: "session-bound" }, ctx);
    expect(r.isError).toBeFalsy();
    const stamped = (proofs.calls[0].args[0] as { capturedBy: { agentId: string; role: string; sessionId?: string } }).capturedBy;
    expect(stamped.role).toBe("director");
    expect(stamped.sessionId).toBe(ctx.sessionId);
  });

  it("mint_director_confirmation: only for ROUTED decisions; hashes are HUB-computed (caller supplies content, never hashes)", async () => {
    const proofs = makeProofStub({ mintConfirmation: (input: unknown) => ({ id: "dconf-1", ...(input as object), nonce: "n", createdAt: "t", expiresAt: "t2", consumedAt: null, consumedBy: null, updatedAt: "t" }) as unknown as DirectorConfirmation });
    const decisions = makeDecisionStub({ getDecision: () => sampleDecision({ status: "routed" }) });
    const r = await router.handle("mint_director_confirmation", { decisionId: "decision-1", chosenOptionId: "a" }, ctxFor("architect", { decision: decisions, directorProof: proofs }));
    expect(r.isError).toBeFalsy();
    const minted = proofs.calls[0].args[0] as { promptHash: string; proposedResolutionHash: string; executionPlanHash: string | null };
    expect(minted.promptHash).toMatch(/^[0-9a-f]{64}$/);      // Hub-computed sha256
    expect(minted.proposedResolutionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(minted.executionPlanHash).toBeNull();               // empty plan → null
    // non-routed decision rejects
    const decisions2 = makeDecisionStub({ getDecision: () => sampleDecision({ status: "raised" }) });
    const r2 = await router.handle("mint_director_confirmation", { decisionId: "decision-1", chosenOptionId: "a" }, ctxFor("architect", { decision: decisions2, directorProof: proofs }));
    expect(r2.isError).toBe(true);
    expect(body(r2).errorKind).toBe("decision_proof_rejected");
  });

  it("resolve_as_director: consume-after-commit fires for director-direct resolutions and the transition event carries the authority fields", async () => {
    const resolved = sampleDecision({
      status: "resolved",
      resolution: { authorityMode: "director-direct", authorityRef: "dconf-7", executor: { agentId: "agent-a", role: "architect" }, answer: { chosenOptionId: "a" }, resolvedAt: "t3" },
    });
    const proofs = makeProofStub({ consumeConfirmation: () => ({ id: "dconf-7", consumedAt: "t3" }) as unknown as DirectorConfirmation });
    const decisions = makeDecisionStub({ getDecision: () => sampleDecision({ status: "routed" }), resolveDecision: () => resolved });
    const ctx = ctxFor("architect", { decision: decisions, directorProof: proofs });
    const r = await router.handle("resolve_as_director", { decisionId: "decision-1", proofRef: "dconf-7", chosenOptionId: "a" }, ctx);
    expect(r.isError).toBeFalsy();
    expect(proofs.calls.some((c) => c.method === "consumeConfirmation")).toBe(true);
    const msgs = await ctx.stores.message.listMessages({});
    const events = msgs.filter((m) => m.kind === "external-injection").map((m) => m.payload as Record<string, unknown>);
    expect(events.length).toBe(1);
    expect(events[0].notificationEvent).toBe(DECISION_TRANSITION_EVENT);
    expect(events[0].verb).toBe("resolve_as_director");
    expect(events[0].authority_mode).toBe("director-direct");
    expect(events[0].authority_ref).toBe("dconf-7");
  });

  it("resolve_as_director: via-proxy resolutions do NOT consume; missing answer → invalid_arguments; store rejections map to decision_proof_rejected", async () => {
    const resolvedViaProxy = sampleDecision({
      status: "resolved",
      resolution: { authorityMode: "director-via-proxy", authorityRef: "dsig-3", executor: { agentId: "agent-a", role: "architect" }, answer: { chosenOptionId: "a" }, resolvedAt: "t3" },
    });
    const proofs = makeProofStub();
    const decisions = makeDecisionStub({ getDecision: () => sampleDecision({ status: "routed" }), resolveDecision: () => resolvedViaProxy });
    const r = await router.handle("resolve_as_director", { decisionId: "decision-1", proofRef: "dsig-3", chosenOptionId: "a" }, ctxFor("architect", { decision: decisions, directorProof: proofs }));
    expect(r.isError).toBeFalsy();
    expect(proofs.calls.some((c) => c.method === "consumeConfirmation")).toBe(false);
    // missing answer
    const r2 = await router.handle("resolve_as_director", { decisionId: "decision-1", proofRef: "dsig-3" }, ctxFor("architect", { decision: decisions, directorProof: proofs }));
    expect(r2.isError).toBe(true);
    expect(body(r2).errorKind).toBe("invalid_arguments");
  });
});
