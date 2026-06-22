/**
 * work-item-policy.test.ts — C1-R2 (mission-94) sub-PR-3b. Tests the POLICY seam
 * (not the repo mechanics — those are real-pg-tested in entities/__tests__): the
 * spoof-proof caller-identity resolution (agentId + role from the session, never from
 * args), the repo-error → errorKind mapping, the result shape (workItem + surfaced
 * leaseToken), and list_ready_work truncation surfacing + role defaulting.
 *
 * Uses a focused stub IWorkItemStore so each behavior (return / throw each error class)
 * is exercised deterministically through the real PolicyRouter dispatch path.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../router.js";
import { registerWorkItemPolicy } from "../work-item-policy.js";
import { createTestContext, type TestPolicyContext } from "../test-utils.js";
import {
  TransitionRejected,
  ClaimRejected,
  WipCapExceeded,
  EvidencePredicateFailed,
} from "../../entities/work-item-repository-substrate.js";
import { LockAcquisitionTimeoutError } from "../../storage-substrate/advisory-lock.js";
import type { IWorkItemStore, WorkItem } from "../../entities/work-item.js";

type Call = { method: string; args: unknown[] };
type StubStore = IWorkItemStore & { calls: Call[] };

/** A stub store: records calls + returns/throws per the supplied per-method overrides. */
function makeStub(overrides: Partial<Record<keyof IWorkItemStore, (...a: unknown[]) => unknown>>): StubStore {
  const calls: Call[] = [];
  const m = (method: keyof IWorkItemStore) => (...args: unknown[]) => {
    calls.push({ method, args });
    const fn = overrides[method];
    return fn ? fn(...args) : null;
  };
  return {
    calls,
    createWorkItem: m("createWorkItem"), getWorkItem: m("getWorkItem"),
    listWorkItems: m("listWorkItems"), listReadyForRole: m("listReadyForRole"),
    claimWorkItem: m("claimWorkItem"), startWork: m("startWork"), blockWork: m("blockWork"),
    resumeWork: m("resumeWork"), renewLease: m("renewLease"), releaseWork: m("releaseWork"),
    abandonWork: m("abandonWork"), completeWork: m("completeWork"),
  } as unknown as StubStore;
}

const sampleItem = (over: Partial<WorkItem> = {}): WorkItem => ({
  id: "work-1", type: "task", priority: "normal", roleEligibility: [], dependsOn: [],
  evidenceRequirements: [], targetRef: null, status: "claimed",
  lease: { holder: "anonymous-engineer", token: "tok-abc", claimedAt: "t", expiresAt: "t", heartbeatAt: "t" },
  evidence: [], blockedOn: null, leaseExpiryCount: 0, createdAt: "t", updatedAt: "t", ...over,
});

function ctxFor(store: IWorkItemStore | undefined, role = "engineer", registry?: unknown): TestPolicyContext {
  const ctx = createTestContext({ role });
  ctx.stores.workItem = store;
  if (registry) ctx.stores.engineerRegistry = registry as TestPolicyContext["stores"]["engineerRegistry"];
  return ctx;
}

/** Minimal IEngineerRegistry stub for the 4b-ii cross-store wiring tests (only the
 *  methods the router path + the handlers call). */
function stubRegistry(over: Record<string, unknown>) {
  return {
    getRole: () => "engineer",
    getAgentForSession: async () => null,
    getAgent: async () => null,
    claimSession: async () => ({ ok: false }),
    recordWorkItemThrash: async () => null,
    resetWorkItemThrash: async () => {},
    clearWorkItemQuarantine: async () => {},
    ...over,
  };
}
function body(r: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(r.content[0].text);
}

describe("work-item-policy (C1-R2 sub-PR-3b)", () => {
  let router: PolicyRouter;
  beforeEach(() => { router = new PolicyRouter(() => {}); registerWorkItemPolicy(router); });

  it("registers all 9 verbs", () => {
    for (const t of ["claim_work", "list_ready_work", "start_work", "block_work", "resume_work", "renew_lease", "release_work", "abandon_work", "complete_work"]) {
      expect(router.getRegisteredTools()).toContain(t);
    }
  });

  it("claim_work: passes the SPOOF-PROOF caller identity (agentId + role from session, not args) + surfaces leaseToken", async () => {
    const stub = makeStub({ claimWorkItem: () => sampleItem() });
    const r = await router.handle("claim_work", { workId: "work-1", agentId: "HACKER", role: "admin" }, ctxFor(stub, "engineer"));
    expect(r.isError).toBeFalsy();
    const b = body(r);
    expect((b.workItem as WorkItem).id).toBe("work-1");
    expect(b.leaseToken).toBe("tok-abc"); // surfaced for subsequent verbs
    // the stub received the session-derived identity, NOT the spoofed args
    expect(stub.calls[0].args).toEqual(["work-1", "anonymous-engineer", "engineer"]);
  });

  it("claim_work: maps each repo error to its errorKind", async () => {
    const cases: Array<[() => never, string]> = [
      [() => { throw new WipCapExceeded("a", 3, 3); }, "wip_cap_exceeded"],
      [() => { throw new ClaimRejected("not eligible"); }, "claim_rejected"],
      [() => { throw new TransitionRejected("bad phase"); }, "transition_rejected"],
      [() => { throw new LockAcquisitionTimeoutError(3, "k", 5000); }, "lock_timeout"],
    ];
    for (const [thrower, kind] of cases) {
      const r = await router.handle("claim_work", { workId: "w" }, ctxFor(makeStub({ claimWorkItem: thrower }), "engineer"));
      expect(r.isError).toBe(true);
      expect(body(r).errorKind).toBe(kind);
    }
  });

  it("claim_work: absent item → not_found", async () => {
    const r = await router.handle("claim_work", { workId: "ghost" }, ctxFor(makeStub({ claimWorkItem: () => null }), "engineer"));
    expect(r.isError).toBe(true);
    expect(body(r).errorKind).toBe("not_found");
  });

  it("a missing workItem store → not_wired (graceful)", async () => {
    const r = await router.handle("claim_work", { workId: "w" }, ctxFor(undefined, "engineer"));
    expect(r.isError).toBe(true);
    expect(body(r).errorKind).toBe("not_wired");
  });

  it("start_work: agentId from session, leaseToken from args", async () => {
    const stub = makeStub({ startWork: () => sampleItem({ status: "in_progress" }) });
    const r = await router.handle("start_work", { workId: "work-1", leaseToken: "tok-abc" }, ctxFor(stub, "engineer"));
    expect((body(r).workItem as WorkItem).status).toBe("in_progress");
    expect(stub.calls[0].args).toEqual(["work-1", "anonymous-engineer", "tok-abc"]);
  });

  it("block_work: passes the structured blockedOn", async () => {
    const stub = makeStub({ blockWork: () => sampleItem({ status: "blocked" }) });
    const blockedOn = { blockerKind: "WorkItem", blockerIds: ["work-9"], reason: "dep" };
    await router.handle("block_work", { workId: "work-1", leaseToken: "tok-abc", blockedOn }, ctxFor(stub, "engineer"));
    expect(stub.calls[0].args).toEqual(["work-1", "anonymous-engineer", "tok-abc", blockedOn]);
  });

  it("complete_work: passes evidence + maps the evidence-predicate failure", async () => {
    const evidence = [{ requirementId: "r1", kind: "commit", ref: "abc", producedAt: "t" }];
    const okStub = makeStub({ completeWork: () => sampleItem({ status: "done" }) });
    await router.handle("complete_work", { workId: "work-1", leaseToken: "tok-abc", evidence }, ctxFor(okStub, "engineer"));
    expect(okStub.calls[0].args).toEqual(["work-1", "anonymous-engineer", "tok-abc", evidence]);

    const failStub = makeStub({ completeWork: () => { throw new EvidencePredicateFailed("requirement r1 uncovered"); } });
    const r = await router.handle("complete_work", { workId: "work-1", leaseToken: "tok-abc", evidence: [] }, ctxFor(failStub, "engineer"));
    expect(r.isError).toBe(true);
    expect(body(r).errorKind).toBe("evidence_predicate_failed");
  });

  it("abandon_work: leaseToken + reason optional (creator-override path)", async () => {
    const stub = makeStub({ abandonWork: () => sampleItem({ status: "abandoned" }) });
    await router.handle("abandon_work", { workId: "work-1", reason: "obsolete" }, ctxFor(stub, "architect"));
    expect(stub.calls[0].args).toEqual(["work-1", "anonymous-architect", { reason: "obsolete", leaseToken: undefined }]);
  });

  it("list_ready_work: defaults role to the caller; surfaces truncation loudly", async () => {
    const stub = makeStub({ listReadyForRole: () => ({ items: [sampleItem({ status: "ready" })], truncated: true }) });
    const r = await router.handle("list_ready_work", {}, ctxFor(stub, "engineer"));
    const b = body(r);
    expect(b.role).toBe("engineer");           // defaulted to caller
    expect(b.truncated).toBe(true);
    expect(b.truncationNote).toMatch(/INCOMPLETE/);
    expect(stub.calls[0].args[0]).toBe("engineer"); // role passed to the projection
  });

  it("list_ready_work: an explicit role arg overrides the caller's role", async () => {
    const stub = makeStub({ listReadyForRole: () => ({ items: [], truncated: false }) });
    await router.handle("list_ready_work", { role: "verifier" }, ctxFor(stub, "engineer"));
    expect(stub.calls[0].args[0]).toBe("verifier");
  });
});

describe("work-item-policy 4b-ii thrash-quarantine wiring", () => {
  let router: PolicyRouter;
  beforeEach(() => { router = new PolicyRouter(() => {}); registerWorkItemPolicy(router); });

  it("claim_work REJECTS a quarantined agent (errorKind quarantined; the repo is NOT called)", async () => {
    const store = makeStub({ claimWorkItem: () => sampleItem() });
    const reg = stubRegistry({ getAgentForSession: async () => ({ id: "agent-q" }), getAgent: async () => ({ quarantined: true }) });
    const r = await router.handle("claim_work", { workId: "w" }, ctxFor(store, "engineer", reg));
    expect(r.isError).toBe(true);
    expect(body(r).errorKind).toBe("quarantined");
    expect(store.calls.length).toBe(0); // guarded BEFORE the repo
  });

  it("complete_work resets the agent's thrash counter on success", async () => {
    const resetCalls: string[] = [];
    const store = makeStub({ completeWork: () => sampleItem({ status: "done" }) });
    const reg = stubRegistry({
      getAgentForSession: async () => ({ id: "agent-c" }),
      resetWorkItemThrash: async (id: string) => { resetCalls.push(id); },
    });
    await router.handle("complete_work", { workId: "w", leaseToken: "t", evidence: [] }, ctxFor(store, "engineer", reg));
    expect(resetCalls).toEqual(["agent-c"]);
  });

  it("clear_work_quarantine (admin) clears via the registry", async () => {
    const clearCalls: string[] = [];
    const reg = stubRegistry({
      getRole: () => "architect", // RBAC [Architect|Director]
      clearWorkItemQuarantine: async (id: string) => { clearCalls.push(id); },
      getAgent: async () => ({ quarantined: false, thrashCount: 0 }),
    });
    const r = await router.handle("clear_work_quarantine", { agentId: "agent-z" }, ctxFor(undefined, "architect", reg));
    expect(r.isError).toBeFalsy();
    expect(clearCalls).toEqual(["agent-z"]);
    expect(body(r).quarantined).toBe(false);
  });

  it("clear_work_quarantine is RBAC-gated — an engineer is rejected", async () => {
    const reg = stubRegistry({ getRole: () => "engineer" });
    const r = await router.handle("clear_work_quarantine", { agentId: "agent-z" }, ctxFor(undefined, "engineer", reg));
    expect(r.isError).toBe(true);
    expect(body(r).error).toMatch(/Authorization denied/);
  });
});
