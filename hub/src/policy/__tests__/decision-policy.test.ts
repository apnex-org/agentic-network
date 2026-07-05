/**
 * mission-102 P3-B1 — Decision policy tests: tool registration, RBAC gates,
 * Hub-stamped actor identity (never caller-supplied), the fail-closed resolve
 * posture, and decision-transition-notification emission through the real
 * router path (the work-54 event vocabulary extended by one member).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../router.js";
import { registerDecisionPolicy, DECISION_TRANSITION_EVENT } from "../decision-policy.js";
import { createTestContext, type TestPolicyContext } from "../test-utils.js";
import type { Decision, IDecisionStore } from "../../entities/decision.js";
import { DecisionTransitionRejected } from "../../entities/decision-repository-substrate.js";

type Call = { method: string; args: unknown[] };
type StubStore = IDecisionStore & { calls: Call[] };

function makeStub(overrides: Partial<Record<keyof IDecisionStore, (...a: unknown[]) => unknown>>): StubStore {
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
  } as unknown as StubStore;
}

const sampleDecision = (over: Partial<Decision> = {}): Decision => ({
  id: "decision-1", schemaVersion: 1, parentRef: null, class: null,
  title: "t", context: "c", contextRefs: [], options: [], freeAnswerPolicy: "always",
  raisedBy: { agentId: "agent-x", role: "engineer" }, curatedBy: null, curationRecordRef: null,
  routedTo: null, routedBy: null, resolution: null, executionPlan: [],
  mergedInto: null, disposedReason: null, executorBinding: null, status: "raised",
  enteredCurrentStateAt: "t0", stateDurations: { raised: 0, curated: 0, routed: 0, resolved: 0 },
  createdAt: "t0", updatedAt: "t0", ...over,
});

function ctxFor(store: IDecisionStore | undefined, role = "engineer"): TestPolicyContext {
  const ctx = createTestContext({ role });
  ctx.stores.decision = store;
  return ctx;
}
function body(r: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(r.content[0].text);
}

describe("decision-policy (P3-B1)", () => {
  let router: PolicyRouter;
  beforeEach(() => {
    router = new PolicyRouter();
    registerDecisionPolicy(router);
  });

  it("registers all 9 tools", () => {
    for (const t of ["raise_decision", "get_decision", "list_decisions", "curate_decision", "route_decision", "resolve_decision", "merge_decision", "dispose_decision", "withdraw_decision"]) {
      expect(router.getRegisteredTools()).toContain(t);
    }
  });

  it("RBAC: curate/route/merge/dispose are architect-gated (engineer denied); raise/withdraw are [Any]", async () => {
    const stub = makeStub({ raiseDecision: () => sampleDecision(), withdrawDecision: () => sampleDecision({ status: "withdrawn" }) });
    for (const t of ["curate_decision", "route_decision", "merge_decision", "dispose_decision"]) {
      const r = await router.handle(t, { decisionId: "decision-1", target: "director", intoRef: "decision-2", reason: "r" }, ctxFor(stub, "engineer"));
      expect(r.isError).toBe(true);
      expect(body(r).error).toMatch(/Authorization denied/);
    }
    const raised = await router.handle("raise_decision", { title: "t", context: "c" }, ctxFor(stub, "engineer"));
    expect(raised.isError).toBeFalsy();
    const withdrawn = await router.handle("withdraw_decision", { decisionId: "decision-1" }, ctxFor(stub, "engineer"));
    expect(withdrawn.isError).toBeFalsy();
  });

  it("raise_decision Hub-stamps the actor from the SESSION (agentId + role + sessionId) — no caller-supplied identity path exists", async () => {
    const stub = makeStub({ raiseDecision: (input: unknown) => sampleDecision({ raisedBy: (input as { raisedBy: Decision["raisedBy"] }).raisedBy }) });
    const ctx = ctxFor(stub, "engineer");
    await router.handle("raise_decision", { title: "t", context: "c" }, ctx);
    const call = stub.calls.find((c) => c.method === "raiseDecision")!;
    const stamped = (call.args[0] as { raisedBy: { agentId: string; role: string; sessionId?: string } }).raisedBy;
    expect(stamped.role).toBe("engineer");
    expect(stamped.agentId).toBeTruthy();
    expect(stamped.sessionId).toBe(ctx.sessionId);
  });

  it("resolve_decision: NO authorityMode parameter on the schema; fail-closed gate rejects (proof machinery = B3/B4)", async () => {
    // schema-level: a caller supplying authorityMode is a validation error (strict object).
    const stub = makeStub({
      getDecision: () => sampleDecision({ status: "routed" }),
      resolveDecision: () => { throw new DecisionTransitionRejected("resolve rejected: authority proof machinery is not yet available (DirectorSignal/Confirmation = slice B4; ClassGrant evaluator = slice B3) — no resolution flows without proof"); },
    });
    const r = await router.handle("resolve_decision", { decisionId: "decision-1", customAnswer: "x" }, ctxFor(stub, "architect"));
    expect(r.isError).toBe(true);
    expect(body(r).errorKind).toBe("decision_transition_rejected");
    expect(body(r).error).toMatch(/proof machinery is not yet available/);
  });

  it("raise_decision fail-closed validates REQUIRED entity contextRefs (dangling → unresolvable_ref, store never called)", async () => {
    const stub = makeStub({ raiseDecision: () => sampleDecision() });
    const ctx = ctxFor(stub, "engineer");
    ctx.stores.workItem = { entityExists: async () => false } as unknown as TestPolicyContext["stores"]["workItem"];
    const r = await router.handle("raise_decision", {
      title: "t", context: "c",
      contextRefs: [{ kind: "bug", ref: "bug-ghost", storage: "entity", mode: "read", required: true }],
    }, ctx);
    expect(r.isError).toBe(true);
    expect(body(r).errorKind).toBe("unresolvable_ref");
    expect(stub.calls.some((c) => c.method === "raiseDecision")).toBe(false);
  });

  describe("decision-transition events (through the real router path)", () => {
    async function storedEvents(ctx: TestPolicyContext) {
      const msgs = await ctx.stores.message.listMessages({});
      return msgs.filter((m) => m.kind === "external-injection").map((m) => m.payload as Record<string, unknown>);
    }

    it("raise_decision emits ·→raised + live-pushes it", async () => {
      const stub = makeStub({ raiseDecision: (input: unknown) => sampleDecision({ raisedBy: (input as { raisedBy: Decision["raisedBy"] }).raisedBy }) });
      const ctx = ctxFor(stub, "engineer");
      await router.handle("raise_decision", { title: "t", context: "c" }, ctx);
      const events = await storedEvents(ctx);
      expect(events.length).toBe(1);
      expect(events[0].notificationEvent).toBe(DECISION_TRANSITION_EVENT);
      expect(events[0].verb).toBe("raise_decision");
      expect(events[0].from_status).toBeNull();
      expect(events[0].to_status).toBe("raised");
      expect(ctx.dispatchedEvents.some((d) => d.event === "message_arrived")).toBe(true);
    });

    it("curate_decision emits raised→curated (pre-read supplies from_status)", async () => {
      const stub = makeStub({
        getDecision: () => sampleDecision({ status: "raised" }),
        curateDecision: () => sampleDecision({ status: "curated" }),
      });
      const ctx = ctxFor(stub, "architect");
      await router.handle("curate_decision", { decisionId: "decision-1" }, ctx);
      const events = await storedEvents(ctx);
      expect(events.length).toBe(1);
      expect(events[0].from_status).toBe("raised");
      expect(events[0].to_status).toBe("curated");
    });

    it("a rejected verb emits NOTHING (transition never committed)", async () => {
      const stub = makeStub({
        getDecision: () => sampleDecision({ status: "resolved" }),
        disposeDecision: () => { throw new DecisionTransitionRejected("dispose rejected: no resolved→disposed edge"); },
      });
      const ctx = ctxFor(stub, "architect");
      const r = await router.handle("dispose_decision", { decisionId: "decision-1", reason: "r" }, ctx);
      expect(r.isError).toBe(true);
      expect((await storedEvents(ctx)).length).toBe(0);
    });
  });
});
