/**
 * work-221 — agent-registry robustness.
 *
 * bug-264 (dead-seat tombstoning): the Agent reaper must TOMBSTONE (archive,
 * append-only) dead seats rather than hard-delete them, the default get_agents
 * view must hide tombstoned seats (so the live fleet is legible — ~4 live, not
 * ~19 with zombies), an explicit escape hatch must still surface the graveyard,
 * a briefly-offline seat must NOT be reaped (no-false-reap), and a returning
 * seat must self-un-archive on re-register (tombstone = view filter, not amnesia).
 *
 * bug-263 (pagination): get_agents must honor limit/offset like every other
 * list_* tool — page 2 must be DISTINCT agents, not page 1 re-served.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../../src/policy/router.js";
import { registerSessionPolicy } from "../../src/policy/session-policy.js";
import { createTestContext, type TestPolicyContext } from "../../src/policy/test-utils.js";
import { AgentRepositorySubstrate } from "../../src/entities/agent-repository-substrate.js";
import { createMemoryStorageSubstrate } from "../../src/storage-substrate/index.js";
import type { RegisterAgentPayload } from "../../src/state.js";

const CLIENT = {
  clientName: "test-client",
  clientVersion: "0.0.0",
  proxyName: "@apnex/test-plugin",
  proxyVersion: "0.0.0",
  sdkVersion: "@apnex/network-adapter@test",
};
function payload(name: string, role: "engineer" | "architect" = "engineer"): RegisterAgentPayload {
  return { name, role, clientMetadata: CLIENT, advisoryTags: {} };
}

// ── bug-264: append-only tombstone + un-archive + no-false-reap (repo level) ──

describe("work-221 bug-264 — agent tombstoning (append-only) + self-un-archive", () => {
  let reg: AgentRepositorySubstrate;
  beforeEach(() => {
    reg = new AgentRepositorySubstrate(createMemoryStorageSubstrate());
  });

  it("archiveAgent tombstones append-only — the record SURVIVES with archived=true (idempotent)", async () => {
    const r = await reg.registerAgent("s1", "engineer", payload("seat-arch"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await reg.getAgent(r.agentId))!.archived).toBe(false);

    expect(await reg.archiveAgent(r.agentId)).toBe(true);
    const after = await reg.getAgent(r.agentId);
    expect(after).not.toBeNull(); // NOT deleted — append-only registry invariant
    expect(after!.archived).toBe(true);

    // Idempotent — archiving again is a no-op success, still archived.
    expect(await reg.archiveAgent(r.agentId)).toBe(true);
    expect((await reg.getAgent(r.agentId))!.archived).toBe(true);
  });

  it("archiveAgent returns false for an unknown agent (nothing to tombstone)", async () => {
    expect(await reg.archiveAgent("agent-does-not-exist")).toBe(false);
  });

  it("a returning seat SELF-UN-ARCHIVES on re-register (view filter, not amnesia)", async () => {
    const r = await reg.registerAgent("s1", "engineer", payload("seat-return"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await reg.archiveAgent(r.agentId);
    expect((await reg.getAgent(r.agentId))!.archived).toBe(true);

    // Same name (same fingerprint) re-registers on a fresh session — the seat is back.
    const r2 = await reg.registerAgent("s2", "engineer", payload("seat-return"));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.agentId).toBe(r.agentId); // same identity
    expect((await reg.getAgent(r.agentId))!.archived).toBe(false); // un-archived by construction
  });

  it("no-false-reap: a briefly-offline seat is NOT a tombstone candidate within the grace", async () => {
    const r = await reg.registerAgent("s1", "engineer", payload("seat-blip"));
    if (!r.ok) return;
    await reg.markAgentOffline("s1"); // offline now, lastSeenAt ~ now
    // A generous 24h grace: a just-offline seat is far too recent to reap.
    const stale = await reg.listOfflineAgentsOlderThan(24 * 60 * 60 * 1000);
    expect(stale.find((a) => a.id === r.agentId)).toBeUndefined();
  });

  it("an offline seat aged past the grace IS a tombstone candidate", async () => {
    const r = await reg.registerAgent("s1", "engineer", payload("seat-dead"));
    if (!r.ok) return;
    await reg.markAgentOffline("s1");
    // -1ms grace: any offline seat is 'older than' → selected (the aged path the
    // reaper walks). Requires offline state — the no-false-reap gate above proves
    // a recent one is excluded.
    const staleAged = await reg.listOfflineAgentsOlderThan(-1);
    expect(staleAged.find((a) => a.id === r.agentId)).toBeDefined();
  });

  it("an ALREADY-archived offline+aged seat is NOT re-selected as a reaper candidate (no re-audit loop)", async () => {
    // steve's #599 watchpoint: archiveAgent is idempotent-true for archived rows,
    // so if a tombstoned seat stayed a candidate, each sweep would re-unpin +
    // re-archive + re-log agent_reaper_archived forever. Once archived it must
    // drop out of the candidate set.
    const r = await reg.registerAgent("s1", "engineer", payload("seat-tombstoned"));
    if (!r.ok) return;
    await reg.markAgentOffline("s1");
    await reg.archiveAgent(r.agentId);
    // Even with a -1ms grace (which selects ANY offline-aged seat), an already-
    // tombstoned row must NOT come back as a candidate.
    const staleAged = await reg.listOfflineAgentsOlderThan(-1);
    expect(staleAged.find((a) => a.id === r.agentId)).toBeUndefined();
  });
});

// ── bug-263 pagination + bug-264 escape hatch (router level) ──

describe("work-221 bug-263 — get_agents pagination + bug-264 escape hatch", () => {
  let router: PolicyRouter;
  beforeEach(() => {
    router = new PolicyRouter(() => {});
    registerSessionPolicy(router);
  });

  async function seed(ctx: TestPolicyContext, n: number): Promise<string[]> {
    const reg = ctx.stores.engineerRegistry as AgentRepositorySubstrate;
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const r = await reg.registerAgent(`seed-s${i}`, "engineer", payload(`seed-seat-${i}`));
      if (r.ok) ids.push(r.agentId);
    }
    return ids;
  }
  function parse(res: { content: { text: string }[] }): Record<string, unknown> {
    return JSON.parse(res.content[0].text);
  }

  it("get_agents honors limit/offset — page 2 is DISTINCT from page 1 (bug-263)", async () => {
    const ctx = createTestContext({ role: "architect" });
    const ids = await seed(ctx, 15);
    expect(ids.length).toBe(15);

    const p1 = parse(await router.handle("get_agents", { limit: 10, offset: 0 }, ctx));
    const p2 = parse(await router.handle("get_agents", { limit: 10, offset: 10 }, ctx));

    expect(p1.total).toBe(15);
    expect(p1.count).toBe(10);
    expect(p1.offset).toBe(0);
    expect(p1.limit).toBe(10);
    expect((p1.agents as unknown[]).length).toBe(10);

    expect(p2.offset).toBe(10);
    expect(p2.count).toBe(5); // remaining after the first page
    expect((p2.agents as unknown[]).length).toBe(5);

    // The core bug-263 guarantee: page 2 must be DIFFERENT agents, not page 1 again.
    const p1ids = new Set((p1.agents as { id: string }[]).map((a) => a.id));
    const p2ids = (p2.agents as { id: string }[]).map((a) => a.id);
    expect(p2ids.every((id) => !p1ids.has(id))).toBe(true);
    // And the two pages together cover the full fleet — nothing is unreachable.
    expect(new Set([...p1ids, ...p2ids]).size).toBe(15);
  });

  it("default get_agents HIDES archived seats; includeTombstoned/includeAll surfaces them (bug-264)", async () => {
    const ctx = createTestContext({ role: "architect" });
    const ids = await seed(ctx, 3);
    await (ctx.stores.engineerRegistry as AgentRepositorySubstrate).archiveAgent(ids[0]);

    const def = parse(await router.handle("get_agents", {}, ctx));
    expect(def.total).toBe(2);
    expect((def.agents as { id: string }[]).find((a) => a.id === ids[0])).toBeUndefined();

    const withTomb = parse(await router.handle("get_agents", { includeTombstoned: true }, ctx));
    expect(withTomb.total).toBe(3);
    expect((withTomb.agents as { id: string }[]).find((a) => a.id === ids[0])).toBeDefined();

    const withAll = parse(await router.handle("get_agents", { includeAll: true }, ctx));
    expect(withAll.total).toBe(3);
  });

  it("an explicit livenessState:offline filter surfaces archived offline seats (no surprise-empty)", async () => {
    const ctx = createTestContext({ role: "architect" });
    const reg = ctx.stores.engineerRegistry as AgentRepositorySubstrate;
    const ids = await seed(ctx, 2);
    await reg.markAgentOffline("seed-s0"); // ensure livenessState=offline
    await reg.archiveAgent(ids[0]);

    // Default view hides the tombstoned seat…
    const def = parse(await router.handle("get_agents", {}, ctx));
    expect((def.agents as { id: string }[]).find((a) => a.id === ids[0])).toBeUndefined();

    // …but an explicit request for the offline tier surfaces it (dead-tier bypass),
    // so get_agents(filter:{livenessState:'offline'}) never returns a false empty.
    const offlineQ = parse(
      await router.handle("get_agents", { filter: { livenessState: "offline" } }, ctx),
    );
    expect((offlineQ.agents as { id: string }[]).find((a) => a.id === ids[0])).toBeDefined();
  });
});
