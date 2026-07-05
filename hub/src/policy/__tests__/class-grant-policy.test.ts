/**
 * mission-102 P3-B3 — ClassGrant policy tests: registration, RBAC (mint is
 * architect-gated; revoke architect|director), and the DIRECTOR-grade
 * ratification fail-closed rule (a t5/class-grant resolution cannot ratify a
 * grant — no self-amplifying delegation). Evaluator semantics are covered by
 * the real-pg substrate suite.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../router.js";
import { registerClassGrantPolicy } from "../class-grant-policy.js";
import { createTestContext, type TestPolicyContext } from "../test-utils.js";
import type { Decision, IDecisionStore } from "../../entities/decision.js";
import type { ClassGrant, IClassGrantStore } from "../../entities/class-grant.js";
import { DecisionTransitionRejected } from "../../entities/decision-repository-substrate.js";
import { canonicalGrantSpecHash, GRANT_SPEC_HASH_MARKER } from "../../entities/class-grant-repository-substrate.js";

type Call = { method: string; args: unknown[] };

function makeGrantStub(overrides: Partial<Record<keyof IClassGrantStore, (...a: unknown[]) => unknown>> = {}) {
  const calls: Call[] = [];
  const m = (method: keyof IClassGrantStore) => (...args: unknown[]) => {
    calls.push({ method, args });
    const fn = overrides[method];
    return fn ? fn(...args) : null;
  };
  return {
    calls,
    mintGrant: m("mintGrant"), getGrant: m("getGrant"), listGrants: m("listGrants"),
    revokeGrant: m("revokeGrant"), markSuperseded: m("markSuperseded"),
  } as unknown as IClassGrantStore & { calls: Call[] };
}

const resolvedDecision = (authorityMode: string): Decision => ({
  id: "decision-9", schemaVersion: 1, parentRef: null, class: "approval-unblock",
  title: "ratify grant", context: `ratify the approval-unblock grant. ${GRANT_SPEC_HASH_MARKER}${MINT_SPEC_HASH}`, contextRefs: [], options: [], freeAnswerPolicy: "always",
  raisedBy: { agentId: "a", role: "architect" }, curatedBy: null, curationRecordRef: null,
  routedTo: { target: "director" }, routedBy: null,
  resolution: { authorityMode: authorityMode as Decision["resolution"] extends null ? never : NonNullable<Decision["resolution"]>["authorityMode"], authorityRef: "dsig-1", executor: { agentId: "a", role: "architect" }, answer: { chosenOptionId: "yes" }, resolvedAt: "t" },
  executionPlan: [], mergedInto: null, disposedReason: null, executorBinding: null, status: "resolved",
  enteredCurrentStateAt: "t", stateDurations: { raised: 0, curated: 0, routed: 0, resolved: 0 },
  createdAt: "t", updatedAt: "t",
});

function ctxFor(role: string, stores: { decision?: Partial<IDecisionStore>; classGrant?: IClassGrantStore }): TestPolicyContext {
  const ctx = createTestContext({ role });
  ctx.stores.decision = stores.decision as IDecisionStore | undefined;
  ctx.stores.classGrant = stores.classGrant;
  return ctx;
}
function body(r: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(r.content[0].text);
}

const MINT_ARGS = {
  class: "approval-unblock", allowedActions: ["unblock", "approve"],
  ratificationRef: "decision-9", representationDays: 90,
};
/** The canonical hash of MINT_ARGS' spec (defaults applied as the handler does). */
const MINT_SPEC_HASH = canonicalGrantSpecHash({
  class: "approval-unblock", allowedActions: ["unblock", "approve"], reversibleOnly: true,
  parentKinds: null, excludedRefs: [], excludedClasses: [], representationDays: 90,
});

describe("class-grant-policy (P3-B3)", () => {
  let router: PolicyRouter;
  beforeEach(() => {
    router = new PolicyRouter();
    registerClassGrantPolicy(router);
  });

  it("registers the 4 grant tools; mint is architect-gated; revoke allows architect|director but not engineer", async () => {
    for (const t of ["mint_class_grant", "get_class_grant", "list_class_grants", "revoke_class_grant"]) {
      expect(router.getRegisteredTools()).toContain(t);
    }
    const grants = makeGrantStub();
    const rMint = await router.handle("mint_class_grant", MINT_ARGS, ctxFor("engineer", { classGrant: grants }));
    expect(rMint.isError).toBe(true);
    expect(body(rMint).error).toMatch(/Authorization denied/);
    const rRevoke = await router.handle("revoke_class_grant", { grantId: "grant-1", reason: "r" }, ctxFor("engineer", { classGrant: grants }));
    expect(rRevoke.isError).toBe(true);
    const rRevokeDir = await router.handle("revoke_class_grant", { grantId: "grant-1", reason: "r" }, ctxFor("director", { classGrant: makeGrantStub({ revokeGrant: () => ({ id: "grant-1", state: "revoked" } as unknown as ClassGrant) }) }));
    expect(rRevokeDir.isError).toBeFalsy();
  });

  it("mint fail-closed: a resolution WITHOUT director-grade authority cannot ratify (architect-t5 / class-grant rejected; director-via-proxy accepted)", async () => {
    const grants = makeGrantStub({
      mintGrant: (input: unknown, ratification: unknown) => {
        if (!(ratification as { resolved: boolean }).resolved) throw new DecisionTransitionRejected("mint rejected: ratificationRef decision-9 does not resolve to a resolved/executed Decision — a grant exists only as ratified cargo of the rail");
        return { id: "grant-1", version: 1, state: "active", ...(input as object) } as unknown as ClassGrant;
      },
    });
    for (const mode of ["architect-t5", "class-grant"]) {
      const ctx = ctxFor("architect", { decision: { getDecision: async () => resolvedDecision(mode) }, classGrant: grants });
      const r = await router.handle("mint_class_grant", MINT_ARGS, ctx);
      expect(r.isError).toBe(true);
      expect(body(r).errorKind).toBe("grant_rejected");
    }
    const ok = await router.handle("mint_class_grant", MINT_ARGS,
      ctxFor("architect", { decision: { getDecision: async () => resolvedDecision("director-via-proxy") }, classGrant: grants }));
    expect(ok.isError).toBeFalsy();
    // unresolved / non-terminal decision also rejects
    const unresolved = { ...resolvedDecision("director-direct"), status: "routed" as const, resolution: null };
    const r2 = await router.handle("mint_class_grant", MINT_ARGS,
      ctxFor("architect", { decision: { getDecision: async () => unresolved }, classGrant: grants }));
    expect(r2.isError).toBe(true);
  });

  it("PR #488 finding 1 regressions: an UNRELATED Director-grade decision cannot mint (no spec-hash marker); ALTERED fields diverge the hash and reject", async () => {
    const grants = makeGrantStub({ mintGrant: (input: unknown) => ({ id: "grant-1", version: 1, state: "active", ...(input as object) } as unknown as ClassGrant) });
    // (a) unrelated decision: director-grade + resolved, but its context carries no marker
    const unrelated = { ...resolvedDecision("director-direct"), context: "some other ratification entirely" };
    const rA = await router.handle("mint_class_grant", MINT_ARGS,
      ctxFor("architect", { decision: { getDecision: async () => unrelated }, classGrant: grants }));
    expect(rA.isError).toBe(true);
    expect(body(rA).error).toMatch(/does not bind this exact grant spec/);
    // (b) altered fields: the real ratification, but the mint asks for MORE than ratified
    const altered = { ...MINT_ARGS, excludedClasses: [] as string[], allowedActions: ["unblock", "approve"], representationDays: 365 };
    const rB = await router.handle("mint_class_grant", altered,
      ctxFor("architect", { decision: { getDecision: async () => resolvedDecision("director-direct") }, classGrant: grants }));
    expect(rB.isError).toBe(true);
    expect(body(rB).error).toMatch(/does not bind this exact grant spec/);
    // the exact ratified spec mints fine
    const rC = await router.handle("mint_class_grant", MINT_ARGS,
      ctxFor("architect", { decision: { getDecision: async () => resolvedDecision("director-direct") }, classGrant: grants }));
    expect(rC.isError).toBeFalsy();
    expect(grants.calls.filter((c) => c.method === "mintGrant").length).toBe(1); // only the bound mint reached the store
  });
});
