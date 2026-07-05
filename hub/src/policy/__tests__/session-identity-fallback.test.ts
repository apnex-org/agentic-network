/**
 * work-137 (bug-230) — session-grounded actor identity for rail verbs.
 *
 * The live failure (2026-07-05): a rail verb after a hub restart (or from an
 * unclaimed bridge session) stamped mintedBy/executor as anonymous-<role>,
 * because the session→agent binding lived ONLY in the in-memory
 * sessionToEngineerId map — the register_role handshake never persisted it
 * (only claim_session persists currentSessionId). The bug-229 signal-captured
 * wake was correctly minter-targeted and went to a dead-letter id; the
 * Director had to ask "silent?".
 *
 * The scoped fix under test:
 *   - assertIdentity (the NAMED register) persists the binding in the new
 *     additive Agent.registeredSessions (rolling, cap 8) — the claim/
 *     displacement discipline around currentSessionId is untouched;
 *   - getAgentForSession falls back to the PERSISTED bindings on a map miss
 *     (currentSessionId OR registeredSessions) and rehydrates the map;
 *   - a genuinely unregistered session still resolves to null → the
 *     anonymous stamp (no invented identity).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../router.js";
import { registerDecisionPolicy } from "../decision-policy.js";
import { registerDirectorProofPolicy } from "../director-proof-policy.js";
import { createTestContext, type TestPolicyContext } from "../test-utils.js";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../../entities/substrate-counter.js";
import { AgentRepositorySubstrate } from "../../entities/agent-repository-substrate.js";
import { DecisionRepositorySubstrate } from "../../entities/decision-repository-substrate.js";
import { DirectorProofRepositorySubstrate } from "../../entities/director-proof-repository-substrate.js";
import type { DecisionActor } from "../../entities/decision.js";

const META = {
  clientName: "test", clientVersion: "1", proxyName: "t", proxyVersion: "1",
  transport: "test", hostname: "test-host", platform: "linux", pid: 1,
  sdkVersion: "t", sdkCommitSha: "t", proxyCommitSha: "t", sdkDirty: false, proxyDirty: false,
};

function wipeMap(registry: AgentRepositorySubstrate): void {
  // The restart simulation: the process's in-memory binding dies; the rows survive.
  (registry as unknown as { sessionToEngineerId: Map<string, string> }).sessionToEngineerId.clear();
}

describe("session-identity fallback (work-137 / bug-230)", () => {
  let registry: AgentRepositorySubstrate;

  beforeEach(() => {
    const substrate = createMemoryStorageSubstrate();
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    registry = new AgentRepositorySubstrate(substrate);
  });

  it("the restart replay: a NAMED register survives the map wipe — getAgentForSession resolves via the persisted binding and rehydrates the map", async () => {
    const r = await registry.assertIdentity({ name: "lily-test", role: "architect", clientMetadata: META }, "sess-bridge-1");
    expect(r.ok).toBe(true);
    const agentId = (r as { agentId: string }).agentId;
    wipeMap(registry);
    const resolved = await registry.getAgentForSession("sess-bridge-1");
    expect(resolved?.id).toBe(agentId); // NOT null → no anonymous stamp
    // ...and the map is rehydrated (the scan runs once per unknown session).
    const map = (registry as unknown as { sessionToEngineerId: Map<string, string> }).sessionToEngineerId;
    expect(map.get("sess-bridge-1")).toBe(agentId);
  });

  it("an unregistered session stays null (the anonymous stamp is kept — no invented identity)", async () => {
    await registry.assertIdentity({ name: "someone", role: "engineer", clientMetadata: META }, "sess-real");
    wipeMap(registry);
    expect(await registry.getAgentForSession("sess-never-registered")).toBeNull();
  });

  it("the binding list is ROLLING (cap 8): the oldest handshake session ages out; the newest 8 all resolve", async () => {
    for (let i = 1; i <= 9; i++) {
      const r = await registry.assertIdentity({ name: "roller", role: "engineer", clientMetadata: META }, `sess-${i}`);
      expect(r.ok).toBe(true);
    }
    wipeMap(registry);
    expect(await registry.getAgentForSession("sess-1")).toBeNull();          // evicted
    expect((await registry.getAgentForSession("sess-2"))?.name).toBe("roller"); // oldest surviving
    wipeMap(registry);
    expect((await registry.getAgentForSession("sess-9"))?.name).toBe("roller"); // newest
  });

  it("re-registering the SAME session dedupes (no cap-eating duplicates)", async () => {
    for (let i = 0; i < 12; i++) {
      await registry.assertIdentity({ name: "steady", role: "engineer", clientMetadata: META }, "sess-same");
    }
    const agent = await registry.getAgentForSession("sess-same");
    expect((agent?.registeredSessions ?? []).filter((s) => s === "sess-same")).toHaveLength(1);
    wipeMap(registry);
    expect((await registry.getAgentForSession("sess-same"))?.name).toBe("steady");
  });

  it("displacement REVOKES the persisted binding (the mission-19 invariant holds through the fallback): only the new session resolves", async () => {
    const r1 = await registry.assertIdentity({ name: "mover", role: "engineer", clientMetadata: META }, "sess-old");
    expect(r1.ok).toBe(true);
    await registry.claimSession((r1 as { agentId: string }).agentId, "sess-old", "explicit");
    // The agent restarts: a NEW session claims, displacing the old one.
    await registry.claimSession((r1 as { agentId: string }).agentId, "sess-new", "explicit");
    wipeMap(registry);
    expect(await registry.getAgentForSession("sess-old")).toBeNull();               // revoked — no zombie resolution
    expect((await registry.getAgentForSession("sess-new"))?.name).toBe("mover");    // the live session resolves
  });

  it("END TO END (the bug-230 specimen): after a map wipe, mint_director_confirmation stamps the REAL registered identity — the bug-229 wake targets a reachable agent, not anonymous-architect", async () => {
    const substrate = createMemoryStorageSubstrate();
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    const counter = new SubstrateCounter(substrate);
    const decisions = new DecisionRepositorySubstrate(substrate, counter);
    const proofs = new DirectorProofRepositorySubstrate(substrate, counter);
    const router = new PolicyRouter();
    registerDecisionPolicy(router);
    registerDirectorProofPolicy(router);
    const ctx: TestPolicyContext = createTestContext({ role: "architect" });
    ctx.stores.decision = decisions;
    ctx.stores.directorProof = proofs;
    const reg = ctx.stores.engineerRegistry as AgentRepositorySubstrate;
    // The bridge handshake: the session NAMED-registers as a real agent...
    const asserted = await reg.assertIdentity({ name: "bridge-lily", role: "architect", clientMetadata: META }, ctx.sessionId);
    expect(asserted.ok).toBe(true);
    const realId = (asserted as { agentId: string }).agentId;
    // ...the hub restarts (map wiped; role re-registered by the reconnect, the live pattern)...
    wipeMap(reg);
    reg.setSessionRole(ctx.sessionId, "architect");
    // ...and the rail verb still stamps the REAL identity.
    const raiser: DecisionActor = { agentId: "agent-arch", role: "architect", sessionId: "s-a" };
    const d = await decisions.raiseDecision({ title: "t", context: "c", class: "x", options: [{ id: "y", label: "Y", description: "y" }], raisedBy: raiser });
    await decisions.curateDecision(d.id, raiser);
    await decisions.routeDecision(d.id, raiser, { target: "director" });
    const minted = await router.handle("mint_director_confirmation", { decisionId: d.id, chosenOptionId: "y" }, ctx);
    expect(minted.isError).toBeFalsy();
    const conf = (JSON.parse(minted.content[0].text) as { confirmation: { mintedBy: { agentId: string } } }).confirmation;
    expect(conf.mintedBy.agentId).toBe(realId);          // the reachable channel
    expect(conf.mintedBy.agentId).not.toMatch(/^anonymous-/); // the dead-letter id is gone
  });
});
