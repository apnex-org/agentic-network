
const NO_FRICTION = { observed: false, summary: "no friction observed" } as const;

/**
 * work-136 (idea-419) — update_work per the RATIFIED contract v1.0
 * (decision-11, director-direct via dconf-9, 2026-07-05; the design's C4
 * dual-home twin lives at docs/designs/update-work-contract.md).
 *
 * One test per rejection row of the field-mutability table + the canonical
 * positive: the work-133 replay (the live incident this verb exists to make
 * impossible — a ready item shipped with an empty dependsOn that could not be
 * retrofitted, repaired by a claim+block workaround).
 *
 * Real WorkItem repo on the memory substrate through the router.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../router.js";
import { registerWorkItemPolicy } from "../work-item-policy.js";
import { WORK_UPDATED_EVENT } from "../work-item-events.js";
import { createTestContext, type TestPolicyContext } from "../test-utils.js";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../../entities/substrate-counter.js";
import { WorkItemRepositorySubstrate } from "../../entities/work-item-repository-substrate.js";
import { AuditRepositorySubstrate } from "../../entities/audit-repository-substrate.js";

function body(r: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(r.content[0].text);
}

describe("update_work (work-136 / idea-419: the ratified WorkItem mutation contract)", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;        // the AUTHOR seat (architect creates work here)
  let strangerCtx: TestPolicyContext; // non-author, non-architect
  let repo: WorkItemRepositorySubstrate;

  beforeEach(async () => {
    const substrate = createMemoryStorageSubstrate();
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    const counter = new SubstrateCounter(substrate);
    repo = new WorkItemRepositorySubstrate(substrate, counter);
    router = new PolicyRouter();
    registerWorkItemPolicy(router);
    ctx = createTestContext({ role: "architect" });
    strangerCtx = createTestContext({ role: "engineer" });
    for (const c of [ctx, strangerCtx]) {
      c.stores.workItem = repo;
      c.stores.audit = ctx.stores.audit;
      c.stores.message = ctx.stores.message;
    }
  });

  async function created(over: Record<string, unknown> = {}): Promise<string> {
    const r = await router.handle("create_work", { type: "task", roleEligibility: ["engineer"], ...over }, ctx);
    expect(r.isError).toBeFalsy();
    return (body(r) as { workItem: { id: string } }).workItem.id;
  }

  // ── THE CANONICAL POSITIVE: the work-133 replay ─────────────────────────────
  it("work-133 replay: appendDependsOn on a READY item re-gates it; the unblock-wake fires when the dep completes", async () => {
    const dep = await created({ payload: "the sweep", roleEligibility: [] });     // incomplete blocker (any-role: the repo-direct claim below carries no registry role)
    const item = await created({ payload: "the post-arc fix" }); // shipped with empty dependsOn — the incident
    // The retrofit that was impossible on 2026-07-05:
    const r = await router.handle("update_work", { workId: item, appendDependsOn: [dep] }, ctx);
    expect(r.isError).toBeFalsy();
    expect((body(r) as { workItem: { dependsOn: string[] } }).workItem.dependsOn).toEqual([dep]);
    // RE-GATED: claim now rejects on dependency-readiness (the real graph edge).
    const claim = await router.handle("claim_work", { workId: item }, strangerCtx);
    expect(claim.isError).toBe(true);
    // The dep completes THROUGH THE ROUTER under one seat (the lease holder) —
    // the unblock scan lives on the complete_work verb path.
    const claimR = body(await router.handle("claim_work", { workId: dep }, strangerCtx)) as { workItem: { lease: { token: string } } };
    await router.handle("start_work", { workId: dep, leaseToken: claimR.workItem.lease.token }, strangerCtx);
    const done = await router.handle("complete_work", { workId: dep, leaseToken: claimR.workItem.lease.token, evidence: [{ requirementId: "any", kind: "freeform", producedAt: new Date().toISOString(), note: "done" }], frictionReflection: NO_FRICTION }, strangerCtx);
    expect(done.isError).toBeFalsy();
    const msgs = await ctx.stores.message.listMessages({});
    const unblock = msgs.find((m) => (m.payload as Record<string, unknown>)?.notificationEvent === "work-unblocked-notification" && (m.payload as Record<string, unknown>)?.work_id === item);
    expect(unblock).toBeDefined();
    // ...and the claim goes through.
    const claim2 = await router.handle("claim_work", { workId: item }, strangerCtx);
    expect(claim2.isError).toBeFalsy();
  });

  it("loudness: an accepted mutation writes ONE audit entry (before→after) and ONE role-targeted work-updated event", async () => {
    const item = await created();
    await router.handle("update_work", { workId: item, set: { priority: "high" } }, ctx);
    const audits = await ctx.stores.audit.listEntries();
    const entry = audits.find((a) => a.action === "work_updated" && a.relatedEntity === item);
    expect(entry).toBeDefined();
    expect(entry!.details).toContain('"priority"');
    expect(entry!.details).toContain("normal"); // before
    expect(entry!.details).toContain("high");   // after
    const events = (await ctx.stores.message.listMessages({})).filter((m) => (m.payload as Record<string, unknown>)?.notificationEvent === WORK_UPDATED_EVENT);
    expect(events).toHaveLength(1);
    expect(events[0].target).toEqual({ role: "engineer" }); // work-124 scoping, never broadcast for role-scoped items
    expect((events[0].payload as Record<string, unknown>).changed_fields).toEqual(["priority"]);
  });

  // ── The rejection rows, one test each ───────────────────────────────────────
  it("rejects: unknown field in set (strict schema — status/evidence/type are not reachable)", async () => {
    const item = await created();
    for (const bad of [{ status: "done" }, { evidenceRequirements: [] }, { type: "verifier-gate" }]) {
      const r = await router.handle("update_work", { workId: item, set: bad }, ctx);
      expect(r.isError, `set=${JSON.stringify(bad)} must reject`).toBe(true);
    }
  });

  it("audit-10445: an out-of-domain priority value rejects at the handler (the router runs no zod)", async () => {
    const item = await created();
    const r = await router.handle("update_work", { workId: item, set: { priority: "urgent" } }, ctx);
    expect(r.isError).toBe(true);
    expect(String(body(r).error)).toMatch(/not in the domain/);
    // ...and the row is untouched.
    const row = await repo.getWorkItem(item);
    expect(row!.priority).toBe("normal");
  });

  it("rejects: empty mutation (a no-op call is a caller bug)", async () => {
    const item = await created();
    const r = await router.handle("update_work", { workId: item }, ctx);
    expect(r.isError).toBe(true);
    expect(String(body(r).error)).toMatch(/empty mutation/);
  });

  it("rejects: terminal items (done and abandoned) refuse all mutation", async () => {
    const item = await created({ roleEligibility: [] });
    const claimed = await repo.claimWorkItem(item, "agent-x");
    await repo.startWork(item, "agent-x", claimed!.lease!.token);
    await repo.completeWork(item, "agent-x", claimed!.lease!.token, [{ requirementId: "any", kind: "freeform", producedAt: new Date().toISOString() } as never], NO_FRICTION);
    const r = await router.handle("update_work", { workId: item, set: { priority: "high" } }, ctx);
    expect(r.isError).toBe(true);
    expect(String(body(r).error)).toMatch(/terminal/);
  });

  it("rejects: runbook/payload/roleEligibility on a CLAIMED item (the claimant's contract froze)", async () => {
    const item = await created({ roleEligibility: [] });
    await repo.claimWorkItem(item, "agent-x");
    for (const set of [{ runbook: "rewrite" }, { payload: "swap" }, { roleEligibility: ["verifier"] }]) {
      const r = await router.handle("update_work", { workId: item, set }, ctx);
      expect(r.isError, `${Object.keys(set)[0]} post-claim must reject`).toBe(true);
      expect(String(body(r).error)).toMatch(/pre-claim/);
    }
    // ...but coordination metadata stays mutable post-claim:
    const ok = await router.handle("update_work", { workId: item, set: { priority: "critical" } }, ctx);
    expect(ok.isError).toBeFalsy();
  });

  it("rejects: dangling appended edges (both kinds) — mirrors create_work's posture", async () => {
    const item = await created();
    const r1 = await router.handle("update_work", { workId: item, appendDependsOn: ["work-99999"] }, ctx);
    expect(r1.isError).toBe(true);
    expect(String(body(r1).error)).toMatch(/non-existent/);
    const r2 = await router.handle("update_work", { workId: item, appendCompletionDependsOn: ["work-99999"] }, ctx);
    expect(r2.isError).toBe(true);
  });

  it("rejects: a cyclic appendDependsOn (A→B appended when B already depends on A, transitively)", async () => {
    const a = await created();
    const b = await created({ dependsOn: [a] });     // B gates on A
    const c = await created({ dependsOn: [b] });     // C gates on B
    const r = await router.handle("update_work", { workId: a, appendDependsOn: [c] }, ctx); // A→C closes A→C→B→A
    expect(r.isError).toBe(true);
    expect(String(body(r).error)).toMatch(/cycle/);
  });

  it("rejects: unclaimable roleEligibility (unknown role) — empty (any-role) is allowed", async () => {
    const item = await created();
    const bad = await router.handle("update_work", { workId: item, set: { roleEligibility: ["engineer", "ghost-role"] } }, ctx);
    expect(bad.isError).toBe(true);
    expect(String(body(bad).error)).toMatch(/not a claimable role/);
    const anyRole = await router.handle("update_work", { workId: item, set: { roleEligibility: [] } }, ctx);
    expect(anyRole.isError).toBeFalsy(); // empty = any-role = claimable by all
  });

  it("rejects: a caller who is neither the author nor an architect (Hub-derived, not caller-asserted)", async () => {
    const item = await created();
    const r = await router.handle("update_work", { workId: item, set: { priority: "high" } }, strangerCtx);
    expect(r.isError).toBe(true);
    expect(String(body(r).error)).toMatch(/neither the item's author nor an architect|author \(|architect/);
  });

  it("rejects: appended REQUIRED references that do not resolve (the seed-time rule travels)", async () => {
    const item = await created();
    const r = await router.handle("update_work", {
      workId: item,
      appendReferences: [{ ref: "docs/nope/missing.md", kind: "doc", mode: "read", storage: "hub-doc", required: true }],
    }, ctx);
    expect(r.isError).toBe(true);
    expect(String(body(r).error)).toMatch(/does not resolve|not wired/); // fail-closed either way
  });

  it("rejects: stale CAS — the row changed under the caller (single-shot, no silent retry)", async () => {
    const item = await created();
    // Force staleness deterministically: capture the row, mutate it once, then
    // attempt an update through a repo whose read happened BEFORE... simulate
    // by monkey-patching putIfMatch to fail once (the substrate-level contract).
    const substrateAny = (repo as unknown as { substrate: { putIfMatch: (k: string, e: unknown, v: string) => Promise<{ ok: boolean }> } }).substrate;
    const real = substrateAny.putIfMatch.bind(substrateAny);
    substrateAny.putIfMatch = async () => ({ ok: false });
    const r = await router.handle("update_work", { workId: item, set: { priority: "high" } }, ctx);
    substrateAny.putIfMatch = real;
    expect(r.isError).toBe(true);
    expect(String(body(r).error)).toMatch(/stale write/);
    // ...and after the conflict clears, the same call succeeds.
    const retry = await router.handle("update_work", { workId: item, set: { priority: "high" } }, ctx);
    expect(retry.isError).toBeFalsy();
  });

  it("append-only by shape: dependsOn is unreachable through set (no rewrite path exists)", async () => {
    const dep = await created();
    const item = await created({ dependsOn: [dep] });
    const r = await router.handle("update_work", { workId: item, set: { dependsOn: [] } as never }, ctx);
    expect(r.isError).toBe(true); // strict set rejects the unknown key — removal is a recreate
  });
});
