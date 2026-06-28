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
    createWorkItem: m("createWorkItem"), getWorkItem: m("getWorkItem"), getCompletionProgress: m("getCompletionProgress"), entityExists: m("entityExists"),
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

  it("registers all 12 tools (create_work + get_work + list_work snapshot + the 9 lifecycle verbs)", () => {
    for (const t of ["create_work", "get_work", "list_work", "claim_work", "list_ready_work", "start_work", "block_work", "resume_work", "renew_lease", "release_work", "abandon_work", "complete_work"]) {
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
});
