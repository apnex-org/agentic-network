/**
 * work-590 / bug-398 — identity resolution must issue ZERO `list()` calls.
 *
 * 🔴 THE CRITERION IS "ZERO list() CALLS", NOT "THE QUERY IS SMALLER".
 *
 * bug-343 already optimised `getAgentForSession` once — whole-kind scan →
 * pinpointed filter — and the identity failure SURVIVED that fix. The reason is
 * that the storage list-admission gate is GLOBAL across every list operation of
 * every kind and STRICT FIFO with no priority lane (work-587: maxActive 8,
 * maxQueued 128, 30s timeout). A two-row identity lookup cannot overtake an
 * unrelated 500-row scan, so a cheaper query queues exactly as long as an
 * expensive one. **The dependency was the defect, not the cost** — which is why
 * a test asserting "fewer rows" or "a narrower filter" would have passed against
 * the broken code and is worthless here.
 *
 * The instrument is therefore a COUNTING substrate wrapper: it records every
 * `list()` the resolution path makes. `get()` / `getWithRevision()` are NOT
 * admission-gated, so they are free.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createMemoryStorageSubstrate,
  buildEnvelopeWriteEncoder,
  type HubStorageSubstrate,
} from "../../storage-substrate/index.js";
import { AgentRepositorySubstrate } from "../agent-repository-substrate.js";

/** Counts substrate calls by shape so the test can assert on the GATED one specifically. */
/** Narrow the AssertIdentityResult union so `agentId` is readable. */
function assertOk(r: import("../../state.js").AssertIdentityResult) {
  if (!r.ok) throw new Error(`assertIdentity failed: ${JSON.stringify(r)}`);
  return r;
}

function countingSubstrate(inner: HubStorageSubstrate) {
  const calls = { list: 0, get: 0 };
  const wrapped = new Proxy(inner, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== "function") return orig;
      if (prop === "list") {
        return (...args: unknown[]) => { calls.list++; return (orig as Function).apply(target, args); };
      }
      if (prop === "get") {
        return (...args: unknown[]) => { calls.get++; return (orig as Function).apply(target, args); };
      }
      return (orig as Function).bind(target);
    },
  }) as HubStorageSubstrate;
  return { wrapped, calls };
}

const CM = {
  clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0",
} as unknown as import("../../state.js").AgentClientMetadata;

function makeRepo() {
  const mem = createMemoryStorageSubstrate();
  mem.setWriteEncoder(buildEnvelopeWriteEncoder());
  const { wrapped, calls } = countingSubstrate(mem);
  return { repo: new AgentRepositorySubstrate(wrapped), calls };
}

describe("work-590: identity resolution is OFF the admission-gated list path", () => {
  let repo: AgentRepositorySubstrate;
  let calls: { list: number; get: number };

  beforeEach(() => {
    ({ repo, calls } = makeRepo());
  });

  it("🔴 resolves a session with ZERO list() calls after the in-memory map is gone", async () => {
    const sessionId = "sess-w590-primary";
    const asserted = assertOk(await repo.assertIdentity({ role: "engineer", name: "greg", clientMetadata: CM }, sessionId));

    // Simulate the process restart / map wipe that bug-230 exists for: the
    // in-memory sessionToEngineerId cache is gone, so resolution MUST go to
    // persisted state. This is the path that used to issue two list() calls.
    repo.forgetSession(sessionId);

    calls.list = 0;
    calls.get = 0;
    const resolved = await repo.getAgentForSession(sessionId);

    expect(resolved?.id).toBe(asserted.agentId);
    // THE ASSERTION THE NODE EXISTS FOR.
    expect(calls.list).toBe(0);
    // And prove the resolution actually happened through the ungated lane
    // rather than by doing nothing at all — a zero/zero result would satisfy
    // the list assertion vacuously.
    expect(calls.get).toBeGreaterThan(0);
  });

  it("still resolves a SUPERSEDED (non-current) session — router.ts auto-claim depends on it (bug-409)", async () => {
    // router.ts:174-181's back-compat implicit auto-claim fires precisely when a
    // resolved agent's currentSessionId differs from the caller's session. If this
    // change narrowed resolution to current-only, that path would silently die.
    const first = "sess-w590-old";
    const second = "sess-w590-new";
    const asserted = assertOk(await repo.assertIdentity({ role: "engineer", name: "greg", clientMetadata: CM }, first));
    await repo.claimSession(asserted.agentId, second, "first_tool_call");

    repo.forgetSession(first);
    calls.list = 0;

    const resolved = await repo.getAgentForSession(first);
    expect(resolved?.id).toBe(asserted.agentId);
    expect(resolved?.currentSessionId).toBe(second);   // non-current, still resolvable
    expect(calls.list).toBe(0);
  });

  it("a DISPLACED session stops resolving — the pointer row is revoked with its registration", async () => {
    // claimSession filters the displaced session out of registeredSessions; the
    // pointer row must go with it, or a revoked session would keep resolving.
    const a = "sess-w590-displaced";
    const b = "sess-w590-successor";
    const asserted = assertOk(await repo.assertIdentity({ role: "engineer", name: "greg", clientMetadata: CM }, a));
    await repo.claimSession(asserted.agentId, a, "first_tool_call");
    await repo.claimSession(asserted.agentId, b, "first_tool_call");

    repo.forgetSession(a);
    calls.list = 0;

    expect(await repo.getAgentForSession(a)).toBeNull();
    expect(calls.list).toBe(0);
  });

  it("an unknown session resolves to null without a list() — no invented identity", async () => {
    calls.list = 0;
    expect(await repo.getAgentForSession("sess-w590-never-registered")).toBeNull();
    expect(calls.list).toBe(0);
  });

  it("backfill makes PRE-EXISTING registrations resolvable — the rollout-safety path", async () => {
    // The deploy hazard: sessions registered before this code shipped have no
    // pointer row. Without a backfill the first deploy resolves every live seat
    // to null at once — bug-398 reproduced fleet-wide by its own fix.
    const sessionId = "sess-w590-legacy";
    const asserted = assertOk(await repo.assertIdentity({ role: "engineer", name: "greg", clientMetadata: CM }, sessionId));

    // Delete the pointer row to recreate the pre-deploy state (registration
    // present on the Agent row, pointer row absent).
    await (repo as unknown as { substrate: HubStorageSubstrate }).substrate
      .delete("AgentSessionBinding", sessionId);
    repo.forgetSession(sessionId);
    expect(await repo.getAgentForSession(sessionId)).toBeNull();   // the hazard, demonstrated

    const result = await repo.backfillSessionBindings();
    expect(result.bindings).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);

    repo.forgetSession(sessionId);
    calls.list = 0;
    const resolved = await repo.getAgentForSession(sessionId);
    expect(resolved?.id).toBe(asserted.agentId);
    expect(calls.list).toBe(0);
  });
});
