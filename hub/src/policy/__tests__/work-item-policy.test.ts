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
import { z } from "zod";
import { PolicyRouter } from "../router.js";
import { registerWorkItemPolicy, blueprintNodeId, EVIDENCE_PRODUCER_PATHS, EVIDENCE_KIND } from "../work-item-policy.js";
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
    createWorkItem: m("createWorkItem"), createBlueprintNode: m("createBlueprintNode"), deleteWorkItem: m("deleteWorkItem"),
    getWorkItem: m("getWorkItem"), getCompletionProgress: m("getCompletionProgress"), getStintProjection: m("getStintProjection"), getLegalMoves: m("getLegalMoves"), entityExists: m("entityExists"),
    listWorkItems: m("listWorkItems"), listReadyForRole: m("listReadyForRole"),
    claimWorkItem: m("claimWorkItem"), startWork: m("startWork"), blockWork: m("blockWork"),
    resumeWork: m("resumeWork"), renewLease: m("renewLease"), releaseWork: m("releaseWork"),
    abandonWork: m("abandonWork"), completeWork: m("completeWork"),
  } as unknown as StubStore;
}

const sampleItem = (over: Partial<WorkItem> = {}): WorkItem => ({
  id: "work-1", type: "task", priority: "normal", roleEligibility: [], dependsOn: [], completionDependsOn: [],
  evidenceRequirements: [], targetRef: null, status: "claimed",
  lease: { holder: "anonymous-engineer", token: "tok-abc", claimedAt: "t", expiresAt: "t", heartbeatAt: "t" },
  evidence: [], blockedOn: null, leaseExpiryCount: 0,
  enteredCurrentStateAt: "t", stateDurations: { ready: 0, claimed: 0, in_progress: 0, blocked: 0, review: 0 },
  createdAt: "t", updatedAt: "t", ...over,
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
    resetWorkItemThrash: async () => 0,
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

  it("registers all 15 tools (create_work + seed_blueprint + get_work + get_current_stint + legal_moves + list_work snapshot + the 9 lifecycle verbs)", () => {
    for (const t of ["create_work", "seed_blueprint", "get_work", "get_current_stint", "legal_moves", "list_work", "claim_work", "list_ready_work", "start_work", "block_work", "resume_work", "renew_lease", "release_work", "abandon_work", "complete_work"]) {
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
    // calls[0] is the work-54 from_status pre-read (getWorkItem); the verb call follows.
    const verbCall = okStub.calls.find((c) => c.method === "completeWork")!;
    expect(verbCall.args).toEqual(["work-1", "anonymous-engineer", "tok-abc", evidence]);

    const failStub = makeStub({ completeWork: () => { throw new EvidencePredicateFailed("requirement r1 uncovered"); } });
    const r = await router.handle("complete_work", { workId: "work-1", leaseToken: "tok-abc", evidence: [] }, ctxFor(failStub, "engineer"));
    expect(r.isError).toBe(true);
    expect(body(r).errorKind).toBe("evidence_predicate_failed");
  });

  it("abandon_work: leaseToken + reason optional (creator-override path)", async () => {
    const stub = makeStub({ abandonWork: () => sampleItem({ status: "abandoned" }) });
    await router.handle("abandon_work", { workId: "work-1", reason: "obsolete" }, ctxFor(stub, "architect"));
    // calls[0] is the work-54 from_status pre-read (getWorkItem); the verb call follows.
    const verbCall = stub.calls.find((c) => c.method === "abandonWork")!;
    expect(verbCall.args).toEqual(["work-1", "anonymous-architect", { reason: "obsolete", leaseToken: undefined }]);
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

  it("list_ready_work scopeToCaller: threads the caller agentId into the agent-scoped projection (AC5 / idea-353 WI-2.1)", async () => {
    const stub = makeStub({ listReadyForRole: () => ({ items: [sampleItem({ status: "ready" })], truncated: false }) });
    const reg = stubRegistry({ getAgent: async () => ({ quarantined: false }) });
    const r = await router.handle("list_ready_work", { scopeToCaller: true }, ctxFor(stub, "engineer", reg));
    const b = body(r);
    expect(b.scopedToCaller).toBe(true);
    expect(b.count).toBe(1);
    expect(stub.calls[0].args[0]).toBe("engineer");          // role
    expect(stub.calls[0].args[2]).toBe("anonymous-engineer"); // caller agentId threaded → WIP-cap parity
  });

  it("list_ready_work scopeToCaller: a QUARANTINED caller gets count 0 + the projection is NOT called (parity with claim_work)", async () => {
    const stub = makeStub({ listReadyForRole: () => ({ items: [sampleItem({ status: "ready" })], truncated: false }) });
    const reg = stubRegistry({ getAgent: async () => ({ quarantined: true }) });
    const r = await router.handle("list_ready_work", { scopeToCaller: true }, ctxFor(stub, "engineer", reg));
    const b = body(r);
    expect(b.count).toBe(0);
    expect(b.items).toEqual([]);
    expect(b.scopedToCaller).toBe(true);
    expect(stub.calls.length).toBe(0); // short-circuited BEFORE the projection, like the claim gate
  });

  // ── work-94 (cold-start spine): the NON-DARK empty digest ──
  it("list_ready_work NON-DARK: a QUARANTINED caller's empty digest carries emptyReason=quarantined + a message", async () => {
    const stub = makeStub({ listReadyForRole: () => ({ items: [], truncated: false }) });
    const reg = stubRegistry({ getAgent: async () => ({ quarantined: true }) });
    const b = body(await router.handle("list_ready_work", { scopeToCaller: true }, ctxFor(stub, "engineer", reg)));
    expect(b.count).toBe(0);
    expect(b.emptyReason).toBe("quarantined");
    expect(String(b.emptyReasonMessage)).toMatch(/clear_work_quarantine/);
  });

  it("list_ready_work NON-DARK: a WIP-capped empty digest carries emptyReason=wip_capped (passed through from the projection)", async () => {
    const stub = makeStub({ listReadyForRole: () => ({ items: [], truncated: false, emptyReason: "wip_capped" }) });
    const reg = stubRegistry({ getAgent: async () => ({ quarantined: false }) });
    const b = body(await router.handle("list_ready_work", { scopeToCaller: true }, ctxFor(stub, "engineer", reg)));
    expect(b.count).toBe(0);
    expect(b.emptyReason).toBe("wip_capped");
    expect(String(b.emptyReasonMessage)).toMatch(/WIP cap/);
  });

  it("list_ready_work NON-DARK: no claimable work carries emptyReason=no_claimable_ready", async () => {
    const stub = makeStub({ listReadyForRole: () => ({ items: [], truncated: false, emptyReason: "no_claimable_ready" }) });
    const reg = stubRegistry({ getAgent: async () => ({ quarantined: false }) });
    const b = body(await router.handle("list_ready_work", { scopeToCaller: true }, ctxFor(stub, "engineer", reg)));
    expect(b.emptyReason).toBe("no_claimable_ready");
    expect(String(b.emptyReasonMessage)).toMatch(/claimable by your role/);
  });

  it("list_ready_work: a NON-empty digest carries NO emptyReason (only an empty digest is non-dark-annotated)", async () => {
    const stub = makeStub({ listReadyForRole: () => ({ items: [sampleItem({ status: "ready" })], truncated: false }) });
    const reg = stubRegistry({ getAgent: async () => ({ quarantined: false }) });
    const b = body(await router.handle("list_ready_work", { scopeToCaller: true }, ctxFor(stub, "engineer", reg)));
    expect(b.count).toBe(1);
    expect(b.emptyReason).toBeUndefined();
    expect(b.emptyReasonMessage).toBeUndefined();
  });

  it("list_ready_work non-scoped NON-DARK: an empty role view carries emptyReason=no_claimable_ready", async () => {
    const stub = makeStub({ listReadyForRole: () => ({ items: [], truncated: false, emptyReason: "no_claimable_ready" }) });
    const b = body(await router.handle("list_ready_work", {}, ctxFor(stub, "engineer")));
    expect(b.emptyReason).toBe("no_claimable_ready");
  });

  it("list_ready_work default (non-scoped): does NOT thread agentId — the role view + D-1 R1 seam preserved", async () => {
    const stub = makeStub({ listReadyForRole: () => ({ items: [], truncated: false }) });
    const r = await router.handle("list_ready_work", {}, ctxFor(stub, "engineer"));
    expect(body(r).scopedToCaller).toBeUndefined();
    expect(stub.calls[0].args[2]).toBeUndefined(); // role-view only, no agent scoping
  });

  it("list_work: org-state snapshot — returns FLAT items incl. the lease column, paginated, filters AND'd through to the store (stint-4 R1 / idea-357-pt3)", async () => {
    const held = sampleItem({ id: "work-held", status: "claimed" }); // sampleItem carries a lease
    const blocked = sampleItem({ id: "work-blocked", status: "blocked" });
    const stub = makeStub({ listWorkItems: () => ({ items: [held, blocked], truncated: false }) });
    const r = await router.handle("list_work", { status: "blocked", role: "engineer", holder: "anonymous-engineer" }, ctxFor(stub, "engineer"));
    expect(r.isError).toBeFalsy();
    const b = body(r);
    // observability: NON-ready items returned (claimed + blocked), each with its lease COLUMN
    expect((b.items as WorkItem[]).map((w) => w.id)).toEqual(["work-held", "work-blocked"]);
    expect((b.items as WorkItem[])[0].lease).not.toBeNull();
    expect((b.items as WorkItem[])[0].lease!.holder).toBe("anonymous-engineer");
    expect(b.total).toBe(2);
    expect(b.truncated).toBe(false);
    // the three filters are AND'd through to the store verbatim (status/role/holder)
    expect(stub.calls[0].method).toBe("listWorkItems");
    expect(stub.calls[0].args[0]).toEqual({ status: "blocked", role: "engineer", holder: "anonymous-engineer" });
  });

  it("list_work: surfaces truncation HONESTLY — a capped scan sets truncated + a note, never silent (tele-4)", async () => {
    const stub = makeStub({ listWorkItems: () => ({ items: [sampleItem()], truncated: true }) });
    const b = body(await router.handle("list_work", {}, ctxFor(stub, "engineer")));
    expect(b.truncated).toBe(true);
    expect(b.truncationNote).toMatch(/INCOMPLETE/);
  });

  it("list_work: a missing workItem store → not_wired (graceful, parity with the other verbs)", async () => {
    const r = await router.handle("list_work", {}, ctxFor(undefined, "engineer"));
    expect(r.isError).toBe(true);
    expect(body(r).errorKind).toBe("not_wired");
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

  it("complete_work resets the agent's thrash + audits a NON-NOOP reset (audit-4133)", async () => {
    const resetCalls: string[] = [];
    const auditActions: string[] = [];
    const store = makeStub({ completeWork: () => sampleItem({ status: "done" }) });
    const reg = stubRegistry({
      getAgentForSession: async () => ({ id: "agent-c" }),
      resetWorkItemThrash: async (id: string) => { resetCalls.push(id); return 2; }, // non-noop: prior thrashCount 2
    });
    const ctx = ctxFor(store, "engineer", reg);
    ctx.stores.audit = { logEntry: async (_a: string, action: string) => { auditActions.push(action); return {} as never; } } as unknown as typeof ctx.stores.audit;
    await router.handle("complete_work", { workId: "w", leaseToken: "t", evidence: [] }, ctx);
    expect(resetCalls).toEqual(["agent-c"]);
    expect(auditActions).toContain("agent_workitem_thrash_reset");
  });

  it("complete_work does NOT audit a no-op thrash reset (prior=0)", async () => {
    const auditActions: string[] = [];
    const store = makeStub({ completeWork: () => sampleItem({ status: "done" }) });
    const reg = stubRegistry({ getAgentForSession: async () => ({ id: "agent-c0" }), resetWorkItemThrash: async () => 0 });
    const ctx = ctxFor(store, "engineer", reg);
    ctx.stores.audit = { logEntry: async (_a: string, action: string) => { auditActions.push(action); return {} as never; } } as unknown as typeof ctx.stores.audit;
    await router.handle("complete_work", { workId: "w", leaseToken: "t", evidence: [] }, ctx);
    expect(auditActions).not.toContain("agent_workitem_thrash_reset");
  });

  it("clear_work_quarantine (admin) clears via the registry + emits a forensic audit (audit-4103)", async () => {
    const clearCalls: string[] = [];
    const reg = stubRegistry({
      getRole: () => "architect", // RBAC [Architect|Director]
      clearWorkItemQuarantine: async (id: string) => { clearCalls.push(id); },
      getAgent: async () => ({ quarantined: false, thrashCount: 0 }),
    });
    const ctx = ctxFor(undefined, "architect", reg);
    const auditCalls: Array<{ action: string; related?: string }> = [];
    ctx.stores.audit = { logEntry: async (_a: string, action: string, _d: string, related?: string) => { auditCalls.push({ action, related }); return {} as never; } } as unknown as typeof ctx.stores.audit;
    const r = await router.handle("clear_work_quarantine", { agentId: "agent-z" }, ctx);
    expect(r.isError).toBeFalsy();
    expect(clearCalls).toEqual(["agent-z"]);
    expect(body(r).quarantined).toBe(false);
    // forensic symmetry with the sweeper's quarantine-SET audit
    expect(auditCalls).toContainEqual({ action: "agent_workitem_quarantine_cleared", related: "agent-z" });
  });

  it("clear_work_quarantine is RBAC-gated — an engineer is rejected", async () => {
    const reg = stubRegistry({ getRole: () => "engineer" });
    const r = await router.handle("clear_work_quarantine", { agentId: "agent-z" }, ctxFor(undefined, "engineer", reg));
    expect(r.isError).toBe(true);
    expect(body(r).error).toMatch(/Authorization denied/);
  });
});

// ── create_work + get_work (C1 NARROW adoption on-ramp; thread-709) ──────────────
describe("work-item-policy on-ramp: create_work + get_work", () => {
  let router: PolicyRouter;
  beforeEach(() => { router = new PolicyRouter(() => {}); registerWorkItemPolicy(router); });

  const readyItem = (over: Partial<WorkItem> = {}) => sampleItem({ status: "ready", lease: null, ...over });
  const createArg = (calls: Call[]) => calls.find((c) => c.method === "createWorkItem")?.args[0] as Record<string, unknown> | undefined;
  const unknownCtx = (store?: IWorkItemStore) => {
    const ctx = createTestContext(undefined, { skipRoleRegister: true }); // getRole → "unknown"
    ctx.stores.workItem = store;
    return ctx;
  };

  // ── create_work [Architect] gate (bug-175 fail-closed posture) ──
  it("create_work: architect creates a ready item with the SPOOF-PROOF provenance", async () => {
    const stub = makeStub({ createWorkItem: () => readyItem({ id: "work-7", type: "task" }) });
    const r = await router.handle("create_work", {
      type: "task", roleEligibility: ["engineer"], priority: "high",
      createdBy: { agentId: "HACKER", role: "architect" }, // spoof attempt in args — must be ignored
    }, ctxFor(stub, "architect"));
    expect(r.isError).toBeFalsy();
    expect((body(r).workItem as WorkItem).id).toBe("work-7");
    const passed = createArg(stub.calls)!;
    expect(passed.createdBy).toMatchObject({ agentId: "anonymous-architect", role: "architect" }); // session, not args
    expect(passed).toMatchObject({ type: "task", roleEligibility: ["engineer"], priority: "high" });
  });

  it("create_work: an ENGINEER is denied at the [Architect] gate (membership-gate)", async () => {
    const stub = makeStub({ createWorkItem: () => readyItem() });
    const r = await router.handle("create_work", { type: "task" }, ctxFor(stub, "engineer"));
    expect(r.isError).toBe(true);
    expect(body(r).error).toMatch(/Authorization denied/);
    expect(stub.calls.length).toBe(0); // gate denies BEFORE the handler/repo
  });

  it("create_work: an UNKNOWN (pre-register_role) caller is denied (no fail-open)", async () => {
    const stub = makeStub({ createWorkItem: () => readyItem() });
    const r = await router.handle("create_work", { type: "task" }, unknownCtx(stub));
    expect(r.isError).toBe(true);
    expect(body(r).error).toMatch(/Authorization denied/);
    expect(stub.calls.length).toBe(0);
  });

  // ── create_work fail-closed validations (repo stores refs OPAQUELY) ──
  it("create_work: a dangling dependsOn is REJECTED (unresolvable_ref — would be permanently unclaimable)", async () => {
    const stub = makeStub({
      getWorkItem: (id: unknown) => (id === "work-real" ? readyItem({ id: "work-real" }) : null),
      createWorkItem: () => readyItem(),
    });
    const r = await router.handle("create_work", { type: "task", dependsOn: ["work-real", "work-ghost"] }, ctxFor(stub, "architect"));
    expect(r.isError).toBe(true);
    expect(body(r).errorKind).toBe("unresolvable_ref");
    expect(stub.calls.some((c) => c.method === "createWorkItem")).toBe(false); // never created
  });

  it("create_work: an existing dependsOn passes the existence-check through to create", async () => {
    const stub = makeStub({ getWorkItem: () => readyItem({ id: "work-real" }), createWorkItem: () => readyItem() });
    const r = await router.handle("create_work", { type: "task", dependsOn: ["work-real"] }, ctxFor(stub, "architect"));
    expect(r.isError).toBeFalsy();
    expect(stub.calls.some((c) => c.method === "createWorkItem")).toBe(true);
  });

  // ── work-88 (arc-node): the COMPLETION-gate edge — completionDependsOn ──
  it("create_work: a dangling completionDependsOn is REJECTED (unresolvable_ref — completion-gate could never close)", async () => {
    const stub = makeStub({
      getWorkItem: (id: unknown) => (id === "work-real" ? readyItem({ id: "work-real" }) : null),
      createWorkItem: () => readyItem(),
    });
    const r = await router.handle("create_work", { type: "task", completionDependsOn: ["work-real", "work-ghost"] }, ctxFor(stub, "architect"));
    expect(r.isError).toBe(true);
    expect(body(r).errorKind).toBe("unresolvable_ref");
    expect(stub.calls.some((c) => c.method === "createWorkItem")).toBe(false); // never created
  });

  it("create_work: an existing completionDependsOn passes the existence-check + is THREADED to createWorkItem (the arc-node spec field)", async () => {
    const stub = makeStub({ getWorkItem: () => readyItem({ id: "work-leaf" }), createWorkItem: () => readyItem() });
    const r = await router.handle("create_work", { type: "task", completionDependsOn: ["work-leaf"] }, ctxFor(stub, "architect"));
    expect(r.isError).toBeFalsy();
    const created = stub.calls.find((c) => c.method === "createWorkItem");
    expect(created).toBeDefined();
    // Mutation-proof: the field is not just accepted — it reaches the store as the arc's gate.
    expect((created!.args[0] as { completionDependsOn?: string[] }).completionDependsOn).toEqual(["work-leaf"]);
  });

  it("create_work: completionDependsOn defaults to [] when omitted (a leaf node — today's behavior)", async () => {
    const stub = makeStub({ createWorkItem: () => readyItem() });
    const r = await router.handle("create_work", { type: "task" }, ctxFor(stub, "architect"));
    expect(r.isError).toBeFalsy();
    const created = stub.calls.find((c) => c.method === "createWorkItem");
    expect((created!.args[0] as { completionDependsOn?: string[] }).completionDependsOn).toEqual([]);
  });

  it("create_work: duplicate evidenceRequirement ids are REJECTED (bind integrity)", async () => {
    const stub = makeStub({ createWorkItem: () => readyItem() });
    const r = await router.handle("create_work", {
      type: "review",
      evidenceRequirements: [{ id: "r1", kind: "review" }, { id: "r1", kind: "audit" }],
    }, ctxFor(stub, "architect"));
    expect(r.isError).toBe(true);
    expect(body(r).errorKind).toBe("invalid_evidence_requirements");
    expect(stub.calls.some((c) => c.method === "createWorkItem")).toBe(false);
  });

  // ── bug-220 (c): producer-path completeness — every demandable kind must be mintable ──
  it("bug-220 (c): EVIDENCE_PRODUCER_PATHS covers every EVIDENCE_KIND — MECHANICALLY pinned via the exported zod enum (audit-9443 #2: no hand-mirrored list)", () => {
    for (const kind of EVIDENCE_KIND.options) {
      expect(EVIDENCE_PRODUCER_PATHS[kind], `evidence kind "${kind}" has no producer path — authoring would fail-closed reject it`).toBeTruthy();
    }
    // exact-set: no stale table entries for kinds the enum no longer carries.
    expect(Object.keys(EVIDENCE_PRODUCER_PATHS).sort()).toEqual([...EVIDENCE_KIND.options].sort());
  });

  // ── create_work: the node-contract (runbook + references) — work-86 (idea-380) ──
  it("create_work: a gate node (type=verifier-gate) WITHOUT a runbook is REJECTED (missing_runbook)", async () => {
    const stub = makeStub({ createWorkItem: () => readyItem() });
    const r = await router.handle("create_work", { type: "verifier-gate" }, ctxFor(stub, "architect"));
    expect(r.isError).toBe(true);
    expect(body(r).errorKind).toBe("missing_runbook");
    expect(stub.calls.some((c) => c.method === "createWorkItem")).toBe(false);
  });

  it("create_work: a node CARRYING references[] but no runbook is REJECTED (missing_runbook)", async () => {
    const stub = makeStub({ createWorkItem: () => readyItem() });
    const r = await router.handle("create_work", {
      type: "task", references: [{ kind: "doc", ref: "the brief", storage: "inline", mode: "read", required: false }],
    }, ctxFor(stub, "architect"));
    expect(r.isError).toBe(true);
    expect(body(r).errorKind).toBe("missing_runbook");
  });

  it("create_work: a plain node (no gate, no references) does NOT require a runbook → created", async () => {
    const stub = makeStub({ createWorkItem: () => readyItem() });
    const r = await router.handle("create_work", { type: "task" }, ctxFor(stub, "architect"));
    expect(r.isError).toBeFalsy();
    expect(stub.calls.some((c) => c.method === "createWorkItem")).toBe(true);
  });

  it("create_work: a required GIT reference that is a mutable branch (not a pinned sha) is REJECTED (FR-36; Hub is git-less)", async () => {
    const stub = makeStub({ createWorkItem: () => readyItem() });
    const r = await router.handle("create_work", {
      type: "task", runbook: "do the thing",
      references: [{ kind: "doc", ref: "main", storage: "git", mode: "read", required: true }],
    }, ctxFor(stub, "architect"));
    expect(r.isError).toBe(true);
    expect(body(r).errorKind).toBe("unresolvable_ref");
    expect(body(r).error).toMatch(/PINNED/);
    expect(stub.calls.some((c) => c.method === "createWorkItem")).toBe(false);
  });

  it("create_work: a required GIT reference that is a pinned 40-hex sha → created (threaded through)", async () => {
    const stub = makeStub({ createWorkItem: () => readyItem() });
    const sha = "a".repeat(40);
    const r = await router.handle("create_work", {
      type: "task", runbook: "do the thing",
      references: [{ kind: "doc", ref: sha, storage: "git", mode: "read", required: true }],
    }, ctxFor(stub, "architect"));
    expect(r.isError).toBeFalsy();
    const passed = createArg(stub.calls)!;
    expect(passed.runbook).toBe("do the thing");
    expect(passed.references).toMatchObject([{ ref: sha, storage: "git" }]);
  });

  it("create_work: a required ENTITY reference that does NOT exist is REJECTED (entityExists=false; kind normalized bug→Bug)", async () => {
    const stub = makeStub({ entityExists: () => false, createWorkItem: () => readyItem() });
    const r = await router.handle("create_work", {
      type: "task", runbook: "x",
      references: [{ kind: "bug", ref: "bug-999", storage: "entity", mode: "read", required: true }],
    }, ctxFor(stub, "architect"));
    expect(r.isError).toBe(true);
    expect(body(r).errorKind).toBe("unresolvable_ref");
    expect(stub.calls.some((c) => c.method === "entityExists" && c.args[0] === "Bug" && c.args[1] === "bug-999")).toBe(true);
  });

  it("create_work: a required ENTITY reference that EXISTS → created", async () => {
    const stub = makeStub({ entityExists: () => true, createWorkItem: () => readyItem() });
    const r = await router.handle("create_work", {
      type: "task", runbook: "x",
      references: [{ kind: "idea", ref: "idea-380", storage: "entity", mode: "read", required: true }],
    }, ctxFor(stub, "architect"));
    expect(r.isError).toBeFalsy();
    expect(stub.calls.some((c) => c.method === "entityExists" && c.args[0] === "Idea")).toBe(true);
  });

  it("create_work: a required ENTITY reference with an UNKNOWN kind is REJECTED (fail-closed, unverifiable)", async () => {
    const stub = makeStub({ entityExists: () => true, createWorkItem: () => readyItem() });
    const r = await router.handle("create_work", {
      type: "task", runbook: "x",
      references: [{ kind: "frobnicator", ref: "x", storage: "entity", mode: "read", required: true }],
    }, ctxFor(stub, "architect"));
    expect(r.isError).toBe(true);
    expect(body(r).errorKind).toBe("unresolvable_ref");
    expect(body(r).error).toMatch(/unverifiable kind/);
    expect(stub.calls.some((c) => c.method === "createWorkItem")).toBe(false);
  });

  it("create_work: an ADVISORY (required:false) unresolvable reference is NOT validated → created", async () => {
    const stub = makeStub({ entityExists: () => false, createWorkItem: () => readyItem() });
    const r = await router.handle("create_work", {
      type: "task", runbook: "x",
      references: [{ kind: "bug", ref: "bug-ghost", storage: "entity", mode: "read", required: false }],
    }, ctxFor(stub, "architect"));
    expect(r.isError).toBeFalsy();                                          // only required:true refs are validated
    expect(stub.calls.some((c) => c.method === "entityExists")).toBe(false); // never even checked
  });

  it("create_work: a required HUB-DOC reference is existence-checked via the Document store", async () => {
    const stub = makeStub({ createWorkItem: () => readyItem() });
    const ctx = ctxFor(stub, "architect");
    (ctx.stores as unknown as { document: unknown }).document = {
      get: async (p: string) => (p === "docs/exists.md" ? { path: p } : null),
    };
    const miss = await router.handle("create_work", {
      type: "task", runbook: "x",
      references: [{ kind: "doc", ref: "docs/missing.md", storage: "hub-doc", mode: "read", required: true }],
    }, ctx);
    expect(miss.isError).toBe(true);
    expect(body(miss).errorKind).toBe("unresolvable_ref");
    const okR = await router.handle("create_work", {
      type: "task", runbook: "x",
      references: [{ kind: "doc", ref: "docs/exists.md", storage: "hub-doc", mode: "read", required: true }],
    }, ctx);
    expect(okR.isError).toBeFalsy();
  });

  it("create_work: a missing workItem store → not_wired", async () => {
    const r = await router.handle("create_work", { type: "task" }, ctxFor(undefined, "architect"));
    expect(r.isError).toBe(true);
    expect(body(r).errorKind).toBe("not_wired");
  });

  // ── create_work schema enum guard (validated at the MCP boundary, not router.handle) ──
  it("create_work: the registered schema rejects a bad `type` enum (MCP-boundary guard)", () => {
    const reg = router.getToolRegistration("create_work")!;
    const schema = z.object(reg.schema);
    expect(schema.safeParse({ type: "bogus" }).success).toBe(false);
    expect(schema.safeParse({ type: "verifier-gate" }).success).toBe(true);
  });

  // GATE-416 (architect steer): CLASS-SCOPED schema↔handler parity guard. create_work is a
  // hot/evolving surface (work-86 added runbook/references; more node-contract fields are likely),
  // so guard the whole "registered schema drifts from the handler → the MCP boundary silently
  // drops a declared field" class — not whack-a-mole per field. A FULLY-POPULATED input parsed
  // through the REAL registered schema must keep EVERY key (Zod z.object strips undeclared keys
  // by default → a key in the input but missing from the parse is an undeclared-field bug; my
  // work-86 edit dropped targetRef this way).
  it("create_work: a fully-populated input survives the MCP boundary parse with NO field stripped (schema↔handler parity)", () => {
    const reg = router.getToolRegistration("create_work")!;
    const full = {
      type: "verifier-gate" as const,
      roleEligibility: ["engineer"],
      priority: "high" as const,
      dependsOn: ["work-1"],
      completionDependsOn: ["work-2"], // work-88 (arc-node): a NEW node-contract field MUST be in `full` or the class-scoped guard doesn't actually parse it (steve GATE-417)
      evidenceRequirements: [{ id: "r1", kind: "pr" as const }],
      runbook: "do it",
      references: [{ kind: "doc", ref: "x", storage: "inline" as const, mode: "read" as const, required: false }],
      targetRef: { kind: "Bug", id: "bug-1" },
      payload: { brief: "b" },
    };
    const parsed = z.object(reg.schema).safeParse(full);
    expect(parsed.success).toBe(true);
    expect(Object.keys((parsed as { data: Record<string, unknown> }).data).sort()).toEqual(Object.keys(full).sort());
  });

  // work-88 (arc-node): the SAME MCP-boundary class for the OTHER field this slice added —
  // get_work.includeCompletionProgress. A registered-schema parse must KEEP it (else the opt-in
  // k/N projection silently never fires through the real adapter, the same drop-class as above).
  it("get_work: includeCompletionProgress survives the registered MCP-boundary parse (schema↔handler parity)", () => {
    const reg = router.getToolRegistration("get_work")!;
    const full = { workId: "work-1", includeCompletionProgress: true };
    const parsed = z.object(reg.schema).safeParse(full);
    expect(parsed.success).toBe(true);
    expect(Object.keys((parsed as { data: Record<string, unknown> }).data).sort()).toEqual(Object.keys(full).sort());
  });

  it("create_work: targetRef is threaded through to createWorkItem (handler regression)", async () => {
    const stub = makeStub({ createWorkItem: () => readyItem() });
    const r = await router.handle("create_work", { type: "task", targetRef: { kind: "Bug", id: "bug-1" } }, ctxFor(stub, "architect"));
    expect(r.isError).toBeFalsy();
    expect(createArg(stub.calls)!.targetRef).toMatchObject({ kind: "Bug", id: "bug-1" });
  });

  // ── get_work [Any] — pins the create=[Architect]→deny / get=[Any]→allow asymmetry ──
  it("get_work: an ENGINEER can read by id ([Any] reachable — the asymmetry vs create)", async () => {
    const stub = makeStub({ getWorkItem: () => readyItem({ id: "work-3" }) });
    const r = await router.handle("get_work", { workId: "work-3" }, ctxFor(stub, "engineer"));
    expect(r.isError).toBeFalsy();
    expect((body(r).workItem as WorkItem).id).toBe("work-3");
  });

  it("get_work: a VERIFIER can also read by id ([Any])", async () => {
    const stub = makeStub({ getWorkItem: () => readyItem({ id: "work-3" }) });
    const r = await router.handle("get_work", { workId: "work-3" }, ctxFor(stub, "verifier"));
    expect(r.isError).toBeFalsy();
    expect((body(r).workItem as WorkItem).id).toBe("work-3");
  });

  it("get_work: does NOT hoist leaseToken to the top level (read affordance ≠ claim affordance)", async () => {
    const claimed = sampleItem({ id: "work-5", status: "claimed" }); // lease.token = tok-abc
    const stub = makeStub({ getWorkItem: () => claimed });
    const b = body(await router.handle("get_work", { workId: "work-5" }, ctxFor(stub, "engineer")));
    expect(b.leaseToken).toBeUndefined();                          // not hoisted on a read
    expect((b.workItem as WorkItem).lease?.token).toBe("tok-abc"); // still on the item for observability
  });

  it("get_work: a non-existent id → not_found", async () => {
    const stub = makeStub({ getWorkItem: () => null });
    const r = await router.handle("get_work", { workId: "ghost" }, ctxFor(stub, "engineer"));
    expect(r.isError).toBe(true);
    expect(body(r).errorKind).toBe("not_found");
  });

  // ── work-88 (arc-node): the opt-in k/N completion-gate projection ──
  it("get_work: WITHOUT includeCompletionProgress → no projection (the common read pays no fan-out)", async () => {
    const stub = makeStub({ getWorkItem: () => readyItem({ id: "work-arc" }), getCompletionProgress: () => ({ done: 1, total: 2, pending: ["work-x"] }) });
    const r = await router.handle("get_work", { workId: "work-arc" }, ctxFor(stub, "engineer"));
    expect(r.isError).toBeFalsy();
    expect(body(r).completionProgress).toBeUndefined();
    expect(stub.calls.some((c) => c.method === "getCompletionProgress")).toBe(false); // never computed
  });

  it("get_work: WITH includeCompletionProgress:true → attaches the {done,total,pending} projection", async () => {
    const stub = makeStub({ getWorkItem: () => readyItem({ id: "work-arc" }), getCompletionProgress: () => ({ done: 1, total: 2, pending: ["work-x"] }) });
    const r = await router.handle("get_work", { workId: "work-arc", includeCompletionProgress: true }, ctxFor(stub, "engineer"));
    expect(r.isError).toBeFalsy();
    expect(body(r).completionProgress).toEqual({ done: 1, total: 2, pending: ["work-x"] });
    expect(stub.calls.some((c) => c.method === "getCompletionProgress")).toBe(true);
  });

  it("get_work: not_found short-circuits BEFORE the projection (a ghost id never fans out)", async () => {
    const stub = makeStub({ getWorkItem: () => null, getCompletionProgress: () => ({ done: 0, total: 0, pending: [] }) });
    const r = await router.handle("get_work", { workId: "ghost", includeCompletionProgress: true }, ctxFor(stub, "engineer"));
    expect(r.isError).toBe(true);
    expect(body(r).errorKind).toBe("not_found");
    expect(stub.calls.some((c) => c.method === "getCompletionProgress")).toBe(false);
  });

  // ── work-94 (cold-start spine, sub-slice 2): get_current_stint ──
  it("get_current_stint: returns the arc projection under `stint` (pass-through)", async () => {
    const proj = { arcId: "work-arc", arcStatus: "in_progress", completion: { done: 1, total: 2, pending: ["c2"] }, gateOpen: false, inFlight: 1, blocked: 0, statusCounts: { done: 1, in_progress: 1 }, children: [] };
    const stub = makeStub({ getStintProjection: () => proj });
    const r = await router.handle("get_current_stint", { workId: "work-arc" }, ctxFor(stub, "engineer"));
    expect(r.isError).toBeFalsy();
    expect(body(r).stint).toMatchObject({ arcId: "work-arc", gateOpen: false, completion: { done: 1, total: 2 } });
  });

  it("get_current_stint: a non-existent arc → not_found", async () => {
    const stub = makeStub({ getStintProjection: () => null });
    const r = await router.handle("get_current_stint", { workId: "ghost" }, ctxFor(stub, "engineer"));
    expect(r.isError).toBe(true);
    expect(body(r).errorKind).toBe("not_found");
  });

  // ── work-94 (cold-start spine, sub-slice 3): legal_moves ──
  it("legal_moves: returns the caller's legal moves under `legalMoves` (pass-through)", async () => {
    const lm = { workId: "work-1", status: "in_progress", isHolder: true, gateMet: true, moves: [{ verb: "complete", legal: true }] };
    const stub = makeStub({ getLegalMoves: () => lm });
    const r = await router.handle("legal_moves", { workId: "work-1" }, ctxFor(stub, "engineer"));
    expect(r.isError).toBeFalsy();
    expect(body(r).legalMoves).toMatchObject({ workId: "work-1", isHolder: true, gateMet: true });
  });

  it("legal_moves: threads the SPOOF-PROOF caller (agentId + role) from the session into the projection", async () => {
    const stub = makeStub({ getLegalMoves: () => ({ workId: "w", status: "ready", isHolder: false, gateMet: true, moves: [] }) });
    await router.handle("legal_moves", { workId: "w" }, ctxFor(stub, "engineer"));
    const call = stub.calls.find((c) => c.method === "getLegalMoves")!;
    expect((call.args[1] as { agentId: string; role: string })).toMatchObject({ agentId: "anonymous-engineer", role: "engineer" });
  });

  it("legal_moves: a non-existent id → not_found", async () => {
    const stub = makeStub({ getLegalMoves: () => null });
    const r = await router.handle("legal_moves", { workId: "ghost" }, ctxFor(stub, "engineer"));
    expect(r.isError).toBe(true);
    expect(body(r).errorKind).toBe("not_found");
  });
});

// ── work-87: seed_blueprint expander — validation guardrails + dry-run + topo orchestration ──
describe("work-item-policy seed_blueprint expander (work-87)", () => {
  let router: PolicyRouter;
  beforeEach(() => { router = new PolicyRouter(() => {}); registerWorkItemPolicy(router); });

  // a stub whose createBlueprintNode records the call + echoes the requested id (created:true);
  // entityExists→true so required refs resolve unless a test overrides it.
  const expandStub = (overrides: Record<string, unknown> = {}) => makeStub({
    createBlueprintNode: (input: unknown) => ({ item: sampleItem({ id: (input as { id: string }).id, status: "ready", lease: null }), created: true }),
    entityExists: async () => true,
    ...overrides,
  });
  const node = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ localId: "n1", type: "task", ...over });
  const bpCalls = (calls: Call[]) => calls.filter((c) => c.method === "createBlueprintNode").map((c) => c.args[0] as Record<string, unknown>);

  it("registers seed_blueprint", () => {
    expect(router.getToolRegistration("seed_blueprint")).toBeDefined();
  });

  it("RBAC: an ENGINEER is denied at the [Architect] gate (no nodes created)", async () => {
    const stub = expandStub();
    const r = await router.handle("seed_blueprint", { runId: "r1", nodes: [node()] }, ctxFor(stub, "engineer"));
    expect(r.isError).toBe(true);
    expect(bpCalls(stub.calls).length).toBe(0);
  });

  it("invalid runId (non-charset) → reject, zero created", async () => {
    const stub = expandStub();
    const r = await router.handle("seed_blueprint", { runId: "bad id!", nodes: [node()] }, ctxFor(stub, "architect"));
    expect(body(r).errorKind).toBe("invalid_blueprint");
    expect(bpCalls(stub.calls).length).toBe(0);
  });

  // COLLISION-SAFETY (steve GATE-418): the no-DASH invariant on runId+localId is what keeps the
  // composite id work-bp-{runId}-{localId} collision-free (dash = the SOLE separator). Pin it on
  // the dash SPECIFICALLY — a generic "bad id!" reject does NOT, because it trips on the space/!
  // even if dashes were allowed. e.g. without the rule: runId 'a-b'+localId 'c' AND runId 'a'+
  // localId 'b-c' BOTH map to work-bp-a-b-c (a real collision). Mutation: widen BLUEPRINT_ID_TOKEN
  // to allow '-' → both router.handle calls below stop rejecting → this test reds.
  // The collision is REAL + FORMABLE: dash is the sole id separator, so two DISTINCT (runId,
  // localId) pairs collapse to the SAME deterministic id once a dash is allowed. This is the WHY
  // behind the no-dash guard (a static demonstration — it documents the hazard the guard closes).
  it("collision-safety: a dash makes work-bp-{runId}-{localId} AMBIGUOUS — ('a-b','c') and ('a','b-c') map to the SAME id", () => {
    expect(blueprintNodeId("a-b", "c")).toBe(blueprintNodeId("a", "b-c")); // both → work-bp-a-b-c
  });

  // The GUARD that closes it, mutation-pinned: a DASH in runId OR localId is rejected. Widening
  // BLUEPRINT_ID_TOKEN to allow '-' stops these rejections → this test reds (proving the guard is
  // load-bearing, not vacuous — steve GATE-418; the #416/#417/#418 invariant-without-a-proof class).
  it("collision-safety: a DASH in runId OR localId is rejected at the boundary (the no-dash guard)", async () => {
    const stub = expandStub();
    expect(body(await router.handle("seed_blueprint", { runId: "a-b", nodes: [node({ localId: "c" })] }, ctxFor(stub, "architect"))).errorKind).toBe("invalid_blueprint"); // would-be collision pair A
    expect(body(await router.handle("seed_blueprint", { runId: "a", nodes: [node({ localId: "b-c" })] }, ctxFor(stub, "architect"))).errorKind).toBe("invalid_blueprint"); // would-be collision pair B
    expect(bpCalls(stub.calls).length).toBe(0); // neither colliding pair ever reaches a create
  });

  it("empty nodes → reject", async () => {
    const r = await router.handle("seed_blueprint", { runId: "r1", nodes: [] }, ctxFor(expandStub(), "architect"));
    expect(body(r).errorKind).toBe("invalid_blueprint");
  });

  it("node-cap exceeded → reject, zero created", async () => {
    const stub = expandStub();
    const many = Array.from({ length: 101 }, (_, i) => ({ localId: `n${i}`, type: "task" }));
    const r = await router.handle("seed_blueprint", { runId: "r1", nodes: many }, ctxFor(stub, "architect"));
    expect(body(r).errorKind).toBe("invalid_blueprint");
    expect(String(body(r).error)).toMatch(/cap/);
    expect(bpCalls(stub.calls).length).toBe(0);
  });

  it("duplicate localId → reject, zero created", async () => {
    const stub = expandStub();
    const r = await router.handle("seed_blueprint", { runId: "r1", nodes: [node({ localId: "a" }), node({ localId: "a" })] }, ctxFor(stub, "architect"));
    expect(body(r).errorKind).toBe("invalid_blueprint");
    expect(bpCalls(stub.calls).length).toBe(0);
  });

  it("dangling dependsOn (unknown localId) → reject, zero created", async () => {
    const stub = expandStub();
    const r = await router.handle("seed_blueprint", { runId: "r1", nodes: [node({ localId: "a", dependsOn: ["ghost"] })] }, ctxFor(stub, "architect"));
    expect(body(r).errorKind).toBe("unresolvable_ref");
    expect(bpCalls(stub.calls).length).toBe(0);
  });

  it("dangling completionDependsOn (unknown localId) → reject", async () => {
    const r = await router.handle("seed_blueprint", { runId: "r1", nodes: [node({ localId: "a", completionDependsOn: ["ghost"] })] }, ctxFor(expandStub(), "architect"));
    expect(body(r).errorKind).toBe("unresolvable_ref");
  });

  it("cycle (dependsOn) → reject, zero created", async () => {
    const stub = expandStub();
    const r = await router.handle("seed_blueprint", { runId: "r1", nodes: [node({ localId: "a", dependsOn: ["b"] }), node({ localId: "b", dependsOn: ["a"] })] }, ctxFor(stub, "architect"));
    expect(body(r).errorKind).toBe("cycle_detected");
    expect(bpCalls(stub.calls).length).toBe(0);
  });

  it("cycle across the UNION (dependsOn + completionDependsOn mixed) → reject", async () => {
    // a --dependsOn--> b ; b --completionDependsOn--> a  => a cross-edge union cycle
    const r = await router.handle("seed_blueprint", { runId: "r1", nodes: [node({ localId: "a", dependsOn: ["b"] }), node({ localId: "b", completionDependsOn: ["a"] })] }, ctxFor(expandStub(), "architect"));
    expect(body(r).errorKind).toBe("cycle_detected");
  });

  it("self-loop → reject (cycle)", async () => {
    const r = await router.handle("seed_blueprint", { runId: "r1", nodes: [node({ localId: "a", dependsOn: ["a"] })] }, ctxFor(expandStub(), "architect"));
    expect(body(r).errorKind).toBe("cycle_detected");
  });

  it("per-node #416: a verifier-gate node WITHOUT a runbook → reject (missing_runbook), zero created", async () => {
    const stub = expandStub();
    const r = await router.handle("seed_blueprint", { runId: "r1", nodes: [node({ localId: "g", type: "verifier-gate" })] }, ctxFor(stub, "architect"));
    expect(body(r).errorKind).toBe("missing_runbook");
    expect(bpCalls(stub.calls).length).toBe(0);
  });

  it("per-node #416: an unresolvable required ENTITY reference → reject, zero created", async () => {
    const stub = makeStub({
      createBlueprintNode: (input: unknown) => ({ item: sampleItem({ id: (input as { id: string }).id }), created: true }),
      entityExists: async () => false, // the required ref does not resolve
    });
    const r = await router.handle("seed_blueprint", { runId: "r1", nodes: [node({ localId: "a", runbook: "do", references: [{ kind: "bug", ref: "bug-9", storage: "entity", mode: "read", required: true }] })] }, ctxFor(stub, "architect"));
    expect(body(r).errorKind).toBe("unresolvable_ref");
    expect(bpCalls(stub.calls).length).toBe(0);
  });

  it("dry-run: validates + returns the PLAN (order + deterministic ids), creates ZERO", async () => {
    const stub = expandStub();
    const r = await router.handle("seed_blueprint", { runId: "run1", dryRun: true, nodes: [node({ localId: "child" }), node({ localId: "arc", completionDependsOn: ["child"] })] }, ctxFor(stub, "architect"));
    expect(r.isError).toBeFalsy();
    const b = body(r);
    expect(b.dryRun).toBe(true);
    expect(b.localIdToWorkId).toEqual({ child: "work-bp-run1-child", arc: "work-bp-run1-arc" });
    const o = b.creationOrder as string[];
    expect(o.indexOf("child")).toBeLessThan(o.indexOf("arc")); // target (child) before source (arc)
    expect(bpCalls(stub.calls).length).toBe(0); // ZERO created
  });

  it("happy-path: creates in topo order, translates BOTH edges' localIds → deterministic work-ids", async () => {
    const stub = expandStub();
    const r = await router.handle("seed_blueprint", {
      runId: "run2",
      nodes: [
        node({ localId: "leaf" }),
        node({ localId: "arc", completionDependsOn: ["leaf"] }),
        node({ localId: "after", dependsOn: ["arc"] }),
      ],
    }, ctxFor(stub, "architect"));
    expect(r.isError).toBeFalsy();
    const b = body(r);
    expect(b.localIdToWorkId).toEqual({ leaf: "work-bp-run2-leaf", arc: "work-bp-run2-arc", after: "work-bp-run2-after" });
    const calls = bpCalls(stub.calls);
    expect(calls.length).toBe(3);
    const order = calls.map((c) => c.id as string);
    expect(order.indexOf("work-bp-run2-leaf")).toBeLessThan(order.indexOf("work-bp-run2-arc"));  // arc completionDependsOn leaf
    expect(order.indexOf("work-bp-run2-arc")).toBeLessThan(order.indexOf("work-bp-run2-after")); // after dependsOn arc
    const arcCall = calls.find((c) => c.id === "work-bp-run2-arc")!;
    expect(arcCall.completionDependsOn).toEqual(["work-bp-run2-leaf"]); // translated localId → work-id
    expect(arcCall.blueprintRunId).toBe("run2");                        // run-key stamped
    const afterCall = calls.find((c) => c.id === "work-bp-run2-after")!;
    expect(afterCall.dependsOn).toEqual(["work-bp-run2-arc"]);          // translated localId → work-id
  });

  // ── C4 (idea-393): nodesRef server-side resolution ─────────────────────────────
  // A large/committed blueprint can be seeded by POINTER (a Hub Document id) instead
  // of inlining ~39KB. The resolved nodes feed the SAME whole-graph validator — the
  // ref is only a fetch+parse in front of the existing expander (zero new trust surface).
  describe("nodesRef server-side resolution (C4 / idea-393)", () => {
    // Inject a Document store keyed by id → raw content string (what the Hub resolves).
    const ctxWithDocs = (store: IWorkItemStore, docs: Record<string, string>, role = "architect") => {
      const ctx = ctxFor(store, role);
      (ctx.stores as unknown as { document: unknown }).document = {
        get: async (id: string) => (id in docs ? { id, content: docs[id] } : null),
      };
      return ctx;
    };

    it("resolves { nodes } from the referenced doc + expands identically to inline", async () => {
      const stub = expandStub();
      const content = JSON.stringify({
        nodes: [node({ localId: "leaf" }), node({ localId: "arc", completionDependsOn: ["leaf"] })],
      });
      const r = await router.handle(
        "seed_blueprint",
        { runId: "rref", nodesRef: "doc-bp" },
        ctxWithDocs(stub, { "doc-bp": content }),
      );
      expect(r.isError).toBeFalsy();
      expect(body(r).localIdToWorkId).toEqual({ leaf: "work-bp-rref-leaf", arc: "work-bp-rref-arc" });
      const arcCall = bpCalls(stub.calls).find((c) => c.id === "work-bp-rref-arc")!;
      expect(arcCall.completionDependsOn).toEqual(["work-bp-rref-leaf"]); // same edge-translation path
    });

    it("accepts a BARE node array as the doc content", async () => {
      const stub = expandStub();
      const r = await router.handle(
        "seed_blueprint",
        { runId: "rbare", nodesRef: "doc-arr" },
        ctxWithDocs(stub, { "doc-arr": JSON.stringify([node({ localId: "solo" })]) }),
      );
      expect(r.isError).toBeFalsy();
      expect(body(r).localIdToWorkId).toEqual({ solo: "work-bp-rbare-solo" });
    });

    it("uses the doc's top-level runId when the arg omits it", async () => {
      const stub = expandStub();
      const content = JSON.stringify({ runId: "docrun", nodes: [node({ localId: "a" })] });
      const r = await router.handle("seed_blueprint", { nodesRef: "doc-rr" }, ctxWithDocs(stub, { "doc-rr": content }));
      expect(r.isError).toBeFalsy();
      expect(body(r).localIdToWorkId).toEqual({ a: "work-bp-docrun-a" });
    });

    it("the explicit runId arg WINS over the doc's runId (caller controls the idempotency key)", async () => {
      const stub = expandStub();
      const content = JSON.stringify({ runId: "docrun", nodes: [node({ localId: "a" })] });
      const r = await router.handle("seed_blueprint", { runId: "argrun", nodesRef: "doc-rr" }, ctxWithDocs(stub, { "doc-rr": content }));
      expect(r.isError).toBeFalsy();
      expect(body(r).localIdToWorkId).toEqual({ a: "work-bp-argrun-a" }); // argrun, not docrun
    });

    it("BOTH nodes[] inline AND nodesRef → reject (ambiguous source), zero created", async () => {
      const stub = expandStub();
      const r = await router.handle(
        "seed_blueprint",
        { runId: "r1", nodes: [node()], nodesRef: "doc-bp" },
        ctxWithDocs(stub, { "doc-bp": JSON.stringify({ nodes: [node()] }) }),
      );
      expect(body(r).errorKind).toBe("invalid_blueprint");
      expect(String(body(r).error)).toMatch(/EITHER/);
      expect(bpCalls(stub.calls).length).toBe(0);
    });

    it("nodesRef document not found → unresolvable_ref, zero created", async () => {
      const stub = expandStub();
      const r = await router.handle("seed_blueprint", { runId: "r1", nodesRef: "doc-missing" }, ctxWithDocs(stub, {}));
      expect(body(r).errorKind).toBe("unresolvable_ref");
      expect(bpCalls(stub.calls).length).toBe(0);
    });

    it("nodesRef content not valid JSON → invalid_blueprint", async () => {
      const stub = expandStub();
      const r = await router.handle("seed_blueprint", { runId: "r1", nodesRef: "doc-bad" }, ctxWithDocs(stub, { "doc-bad": "{not json" }));
      expect(body(r).errorKind).toBe("invalid_blueprint");
      expect(bpCalls(stub.calls).length).toBe(0);
    });

    it("nodesRef content neither array nor { nodes } → invalid_blueprint", async () => {
      const stub = expandStub();
      const r = await router.handle("seed_blueprint", { runId: "r1", nodesRef: "doc-shape" }, ctxWithDocs(stub, { "doc-shape": JSON.stringify({ foo: 1 }) }));
      expect(body(r).errorKind).toBe("invalid_blueprint");
    });

    it("document store not wired → not_wired", async () => {
      const stub = expandStub();
      const r = await router.handle("seed_blueprint", { runId: "r1", nodesRef: "doc-bp" }, ctxFor(stub, "architect"));
      expect(body(r).errorKind).toBe("not_wired");
    });

    it("resolved nodes get the FULL whole-graph validation (a cycle in the doc → cycle_detected, zero created)", async () => {
      const stub = expandStub();
      const content = JSON.stringify({ nodes: [node({ localId: "a", dependsOn: ["b"] }), node({ localId: "b", dependsOn: ["a"] })] });
      const r = await router.handle("seed_blueprint", { runId: "r1", nodesRef: "doc-cyc" }, ctxWithDocs(stub, { "doc-cyc": content }));
      expect(body(r).errorKind).toBe("cycle_detected");
      expect(bpCalls(stub.calls).length).toBe(0);
    });

    // VALIDATION PARITY (steve audit-11721): a nodesRef doc is parsed AFTER the router
    // schema layer, so the resolved nodes must be re-validated against blueprintNodeSchema
    // — else malformed doc content bypasses the per-node contract the inline nodes[] param
    // enforces. Each of these reaches createBlueprintNode uncontracted WITHOUT the fix.
    it("ref-path schema parity: a node MISSING required `type` → invalid_blueprint, zero created", async () => {
      const stub = expandStub();
      const content = JSON.stringify({ runId: "bad", nodes: [{ localId: "n1" }] }); // no `type`
      const r = await router.handle("seed_blueprint", { nodesRef: "doc-notype" }, ctxWithDocs(stub, { "doc-notype": content }));
      expect(body(r).errorKind).toBe("invalid_blueprint");
      expect(String(body(r).error)).toMatch(/schema validation/);
      expect(bpCalls(stub.calls).length).toBe(0); // never reaches createBlueprintNode with type=undefined
    });

    it("ref-path schema parity: an INVALID enum `type` → invalid_blueprint, zero created", async () => {
      const stub = expandStub();
      const content = JSON.stringify({ nodes: [{ localId: "n1", type: "not-a-real-type" }] });
      const r = await router.handle("seed_blueprint", { runId: "r1", nodesRef: "doc-badenum" }, ctxWithDocs(stub, { "doc-badenum": content }));
      expect(body(r).errorKind).toBe("invalid_blueprint");
      expect(bpCalls(stub.calls).length).toBe(0);
    });

    it("ref-path schema parity: a NON-ARRAY dependsOn (malformed field shape) → invalid_blueprint", async () => {
      const stub = expandStub();
      const content = JSON.stringify({ nodes: [{ localId: "n1", type: "task", dependsOn: "a" }] }); // string, not array
      const r = await router.handle("seed_blueprint", { runId: "r1", nodesRef: "doc-baddep" }, ctxWithDocs(stub, { "doc-baddep": content }));
      expect(body(r).errorKind).toBe("invalid_blueprint");
      expect(bpCalls(stub.calls).length).toBe(0);
    });

    it("ref-path schema parity: a NON-ARRAY references (malformed field shape) → invalid_blueprint", async () => {
      const stub = expandStub();
      const content = JSON.stringify({ nodes: [{ localId: "n1", type: "task", references: "nope" }] });
      const r = await router.handle("seed_blueprint", { runId: "r1", nodesRef: "doc-badref" }, ctxWithDocs(stub, { "doc-badref": content }));
      expect(body(r).errorKind).toBe("invalid_blueprint");
      expect(bpCalls(stub.calls).length).toBe(0);
    });

    it("ref-path schema parity: an UNKNOWN node field (strict) → invalid_blueprint", async () => {
      const stub = expandStub();
      const content = JSON.stringify({ nodes: [{ localId: "n1", type: "task", bogusField: 1 }] });
      const r = await router.handle("seed_blueprint", { runId: "r1", nodesRef: "doc-strict" }, ctxWithDocs(stub, { "doc-strict": content }));
      expect(body(r).errorKind).toBe("invalid_blueprint");
      expect(bpCalls(stub.calls).length).toBe(0);
    });

    it("RBAC still gates the ref path: an ENGINEER is denied (no resolve, no create)", async () => {
      const stub = expandStub();
      const r = await router.handle(
        "seed_blueprint",
        { runId: "r1", nodesRef: "doc-bp" },
        ctxWithDocs(stub, { "doc-bp": JSON.stringify({ nodes: [node()] }) }, "engineer"),
      );
      expect(r.isError).toBe(true);
      expect(bpCalls(stub.calls).length).toBe(0);
    });
  });

  it("mid-create infra failure → compensating-delete THIS run's creates + loud id-trail (zero orphans)", async () => {
    let n = 0;
    const deleted: string[] = [];
    const stub = makeStub({
      createBlueprintNode: (input: unknown) => {
        n++;
        if (n === 2) throw new Error("substrate boom"); // the 2nd create fails (post-validation infra fault)
        return { item: sampleItem({ id: (input as { id: string }).id }), created: true };
      },
      deleteWorkItem: (id: unknown) => { deleted.push(id as string); return undefined; },
      entityExists: async () => true,
    });
    // 3 independent nodes → topo order = [a,b,c]; a created, b throws → a is rolled back
    const r = await router.handle("seed_blueprint", { runId: "rollback", nodes: [node({ localId: "a" }), node({ localId: "b" }), node({ localId: "c" })] }, ctxFor(stub, "architect"));
    expect(r.isError).toBe(true);
    const b = body(r);
    expect(b.errorKind).toBe("expansion_failed");
    expect(b.createdAndRolledBack).toEqual(["work-bp-rollback-a"]); // only 'a' minted before the boom
    expect(deleted).toEqual(["work-bp-rollback-a"]);                // compensating-delete ran on it
    expect(b.rollbackFailures).toEqual([]);                         // no orphans
  });

  it("idempotent re-run: when every node already exists (createOnly conflict) → reused:N, created:[], no error", async () => {
    const stub = makeStub({
      createBlueprintNode: (input: unknown) => ({ item: sampleItem({ id: (input as { id: string }).id }), created: false }), // all pre-existing
      entityExists: async () => true,
    });
    const r = await router.handle("seed_blueprint", { runId: "rerun", nodes: [node({ localId: "a" }), node({ localId: "b", dependsOn: ["a"] })] }, ctxFor(stub, "architect"));
    expect(r.isError).toBeFalsy();
    const b = body(r);
    expect(b.created).toEqual([]);
    expect(b.reused).toBe(2);
    expect(b.localIdToWorkId).toEqual({ a: "work-bp-rerun-a", b: "work-bp-rerun-b" });
  });

  // ── work-54 (idea-357 pts 1-2): push-native FSM-transition events ────────────────
  // The verb handlers emit a broadcast external-injection through emitAndPush; these
  // tests exercise the REAL router path with the harness's real memory message store
  // (the dispatch capture proves the bug-192 create+push coupling end-to-end).

  describe("work-54 push events (through the router path)", () => {
    async function storedEvents(ctx: TestPolicyContext) {
      const msgs = await ctx.stores.message.listMessages({});
      return msgs.filter((m) => m.kind === "external-injection").map((m) => m.payload as Record<string, unknown>);
    }

    // ── work-124: role-targeted delivery (the flood stopgap) ────────────────
    async function rawEvents(ctx: TestPolicyContext) {
      const msgs = await ctx.stores.message.listMessages({});
      return msgs.filter((m) => m.kind === "external-injection");
    }

    it("work-124: single-role eligibility targets THAT role; payload shape unchanged from the broadcast era", async () => {
      const stub = makeStub({ claimWorkItem: () => sampleItem({ roleEligibility: ["engineer"] }) });
      const ctx = ctxFor(stub, "engineer");
      await router.handle("claim_work", { workId: "work-1" }, ctx);
      const msgs = await rawEvents(ctx);
      expect(msgs.length).toBe(1);
      expect(msgs[0].target).toEqual({ role: "engineer" });
      // Payload identity: exactly the pre-stopgap key set.
      expect(Object.keys(msgs[0].payload as Record<string, unknown>).sort()).toEqual([
        "actor_agent_id", "actor_role", "body", "from_status", "holder", "lease_expiry_count",
        "notificationEvent", "priority", "role_eligibility", "target_ref", "title", "to_status",
        "type", "verb", "work_id",
      ].sort());
    });

    it("work-124: multi-role eligibility emits ONE message per role with IDENTICAL payloads", async () => {
      const stub = makeStub({ claimWorkItem: () => sampleItem({ roleEligibility: ["engineer", "verifier"] }) });
      const ctx = ctxFor(stub, "engineer");
      await router.handle("claim_work", { workId: "work-1" }, ctx);
      const msgs = await rawEvents(ctx);
      expect(msgs.length).toBe(2);
      expect(msgs.map((m) => m.target)).toEqual([{ role: "engineer" }, { role: "verifier" }]);
      expect(JSON.stringify(msgs[0].payload)).toBe(JSON.stringify(msgs[1].payload));
    });

    it("work-124: empty (any-role) eligibility keeps the broadcast (target null)", async () => {
      const stub = makeStub({ claimWorkItem: () => sampleItem({ roleEligibility: [] }) });
      const ctx = ctxFor(stub, "engineer");
      await router.handle("claim_work", { workId: "work-1" }, ctx);
      const msgs = await rawEvents(ctx);
      expect(msgs.length).toBe(1);
      expect(msgs[0].target).toBeNull();
    });

    it("work-124: the dependency-unblock wake targets the roles that can CLAIM the unblocked item", async () => {
      const dependent = sampleItem({
        id: "work-9", status: "ready", lease: null as unknown as WorkItem["lease"],
        dependsOn: ["work-1"], roleEligibility: ["engineer", "architect"],
      });
      const stub = makeStub({
        getWorkItem: (id: unknown) => (id === "work-1" ? sampleItem({ status: "in_progress", roleEligibility: ["engineer"] }) : null),
        completeWork: () => sampleItem({ status: "done", roleEligibility: ["engineer"] }),
        listWorkItems: () => ({ items: [dependent], truncated: false }),
      });
      const ctx = ctxFor(stub, "engineer");
      await router.handle("complete_work", { workId: "work-1", leaseToken: "tok-abc", evidence: [] }, ctx);
      const msgs = await rawEvents(ctx);
      const unblocks = msgs.filter((m) => (m.payload as Record<string, unknown>).notificationEvent === "work-unblocked-notification");
      expect(unblocks.length).toBe(2);
      expect(unblocks.map((m) => m.target)).toEqual([{ role: "engineer" }, { role: "architect" }]);
      expect(JSON.stringify(unblocks[0].payload)).toBe(JSON.stringify(unblocks[1].payload));
    });

    it("claim_work emits work-transition (ready→claimed) + live-pushes it", async () => {
      const stub = makeStub({ claimWorkItem: () => sampleItem() });
      const ctx = ctxFor(stub, "engineer");
      await router.handle("claim_work", { workId: "work-1" }, ctx);

      const events = await storedEvents(ctx);
      expect(events.length).toBe(1);
      expect(events[0].notificationEvent).toBe("work-transition-notification");
      expect(events[0].verb).toBe("claim_work");
      expect(events[0].from_status).toBe("ready");
      expect(events[0].to_status).toBe("claimed");
      expect(events[0].actor_agent_id).toBe("anonymous-engineer");
      // pushed live, not just persisted (bug-192)
      expect(ctx.dispatchedEvents.some((d) => d.event === "message_arrived")).toBe(true);
    });

    it("complete_work →done emits the transition (from_status via pre-read) AND runs the dependency-unblock scan", async () => {
      const dependent = sampleItem({
        id: "work-9", status: "ready", lease: null as unknown as WorkItem["lease"],
        dependsOn: ["work-1"], roleEligibility: ["engineer"],
      });
      const stub = makeStub({
        getWorkItem: (id: unknown) => (id === "work-1" ? sampleItem({ status: "in_progress" }) : null),
        completeWork: () => sampleItem({ status: "done" }),
        listWorkItems: () => ({ items: [dependent], truncated: false }),
      });
      const ctx = ctxFor(stub, "engineer");
      await router.handle("complete_work", { workId: "work-1", leaseToken: "tok-abc", evidence: [] }, ctx);

      const events = await storedEvents(ctx);
      const transition = events.find((e) => e.notificationEvent === "work-transition-notification")!;
      expect(transition.verb).toBe("complete_work");
      expect(transition.from_status).toBe("in_progress"); // the pre-read supplied it
      expect(transition.to_status).toBe("done");
      const unblocked = events.find((e) => e.notificationEvent === "work-unblocked-notification")!;
      expect(unblocked.work_id).toBe("work-9");
      expect(unblocked.unblocked_by).toBe("work-1");
    });

    it("complete_work parking in review emits the transition but NO unblock scan", async () => {
      const stub = makeStub({
        getWorkItem: () => sampleItem({ status: "in_progress" }),
        completeWork: () => sampleItem({ status: "review" }),
      });
      const ctx = ctxFor(stub, "engineer");
      await router.handle("complete_work", { workId: "work-1", leaseToken: "tok-abc", evidence: [] }, ctx);

      const events = await storedEvents(ctx);
      expect(events.length).toBe(1);
      expect(events[0].to_status).toBe("review");
      expect(stub.calls.some((c) => c.method === "listWorkItems")).toBe(false);
    });

    it("abandon_work from ready (creator-override, bug-219) emits the transition ready→abandoned", async () => {
      const stub = makeStub({
        getWorkItem: () => sampleItem({ status: "ready", lease: null as unknown as WorkItem["lease"] }),
        abandonWork: () => sampleItem({ status: "abandoned", lease: null as unknown as WorkItem["lease"] }),
      });
      const ctx = ctxFor(stub, "architect");
      await router.handle("abandon_work", { workId: "work-1", reason: "Director retired it" }, ctx);

      const events = await storedEvents(ctx);
      expect(events.length).toBe(1);
      expect(events[0].notificationEvent).toBe("work-transition-notification");
      expect(events[0].verb).toBe("abandon_work");
      expect(events[0].from_status).toBe("ready"); // the pre-read supplied it
      expect(events[0].to_status).toBe("abandoned");
    });

    it("a failed verb emits NOTHING (transition never committed)", async () => {
      const stub = makeStub({ claimWorkItem: () => { throw new ClaimRejected("nope"); } });
      const ctx = ctxFor(stub, "engineer");
      await router.handle("claim_work", { workId: "work-1" }, ctx);
      expect((await storedEvents(ctx)).length).toBe(0);
    });

    it("create_work emits the queued (·→ready) claimable signal", async () => {
      const stub = makeStub({
        createWorkItem: () => sampleItem({ id: "work-7", status: "ready", lease: null as unknown as WorkItem["lease"] }),
      });
      const ctx = ctxFor(stub, "architect");
      await router.handle("create_work", { type: "task", payload: { title: "t" } }, ctx);

      const events = await storedEvents(ctx);
      expect(events.length).toBe(1);
      expect(events[0].verb).toBe("create_work");
      expect(events[0].from_status).toBeNull();
      expect(events[0].to_status).toBe("ready");
    });
  });
});
