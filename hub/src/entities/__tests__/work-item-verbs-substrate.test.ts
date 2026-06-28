/**
 * C1-R2 (mission-94) sub-PR-3a — WorkItem claim/lease/FSM verb tests (real-pg).
 *
 * Exercises the actuation layer end-to-end through the FULL substrate (advisory
 * lock + per-row CAS + envelope encode/decode): the FSM happy-path walk, every
 * illegal-edge guard (→ TransitionRejected), the holder+token guard, the
 * abandon creator-override, terminal immutability, and — the load-bearing proofs
 * (Steve's threat-model audit-4082 concurrency matrix) — the WIP cap holding
 * under PARALLEL same-agent claims (advisory-lock serialization, no over-cap),
 * two different agents racing ONE item (per-row CAS arbitrates → one winner), and
 * the STALE-TOKEN fence (a zombie old-process with the right agentId but an old
 * token is rejected — the #355 split-brain mechanism). complete_work + the
 * evidence predicate are sub-PR-3a-ii.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestPool } from "../../storage-substrate/__tests__/_pg-test-pool.js";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { createPostgresStorageSubstrate, createSchemaReconciler, ALL_SCHEMAS, buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import { WorkItemRepositorySubstrate, TransitionRejected, WipCapExceeded } from "../work-item-repository-substrate.js";
import type { WorkItemBlockedOn } from "../work-item.js";

const SETUP_TIMEOUT = 90_000;
const OP_TIMEOUT = 120_000;
const MIGRATIONS_DIR = join(__dirname, "..", "..", "storage-substrate", "migrations");
const MIGRATION_FILES = ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"];

const WIP_CAP = 3; // mirrors DEFAULT_WIP_CAP in the repo (no per-role override yet)
const BLOCK: WorkItemBlockedOn = { blockerKind: "WorkItem", blockerIds: ["work-dep"], reason: "waiting on dep" };

describe("WorkItem verbs (real-pg: claim / lease / FSM)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let substrate: ReturnType<typeof createPostgresStorageSubstrate>;
  let reconciler: ReturnType<typeof createSchemaReconciler>;
  let repo: WorkItemRepositorySubstrate;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub").withPassword("hub").withDatabase("hub").start();
    const connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = createTestPool(connStr, "work-item-verbs-substrate");
    for (const f of MIGRATION_FILES) await pool.query(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
    substrate = createPostgresStorageSubstrate(connStr);
    reconciler = createSchemaReconciler(substrate, connStr, { initialSchemas: ALL_SCHEMAS });
    await reconciler.start();
    substrate.setFieldTranslator((kind, key) => reconciler.getFieldTranslation(kind, key));
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    if (reconciler) await reconciler.close();
    if (substrate) await substrate.close();
    if (pool) await pool.end();
    if (container) await container.stop();
  }, OP_TIMEOUT);

  // any-role items (empty roleEligibility) keep these FSM/lease/WIP tests focused — the
  // claim role-eligibility + dependency enforcement (audit-4085 #1) has its own suite.
  const ready = () => repo.createWorkItem({ type: "task", roleEligibility: [] });
  /** claim + return {id, token} for token-threading. */
  async function claim(agent: string, role?: string): Promise<{ id: string; token: string }> {
    const w = await ready();
    const claimed = await repo.claimWorkItem(w.id, agent, role);
    return { id: w.id, token: claimed!.lease!.token };
  }

  it("happy-path FSM walk: ready→claim→start→block→resume→release→ready", async () => {
    const agent = "agent-walk";
    const w = await ready();
    const claimed = await repo.claimWorkItem(w.id, agent);
    expect(claimed!.status).toBe("claimed");
    expect(claimed!.lease!.holder).toBe(agent);
    expect(claimed!.lease!.token).toMatch(/[0-9a-f-]{36}/); // minted nonce
    expect(claimed!.lease!.expiresAt > claimed!.lease!.claimedAt).toBe(true);
    const token = claimed!.lease!.token;

    expect((await repo.startWork(w.id, agent, token))!.status).toBe("in_progress");

    const blocked = await repo.blockWork(w.id, agent, token, BLOCK);
    expect(blocked!.status).toBe("blocked");
    expect(blocked!.blockedOn).toEqual(BLOCK);

    const resumed = await repo.resumeWork(w.id, agent, token);
    expect(resumed!.status).toBe("in_progress");
    expect(resumed!.blockedOn).toBeNull();

    const released = await repo.releaseWork(w.id, agent, token);
    expect(released!.status).toBe("ready");
    expect(released!.lease).toBeNull();
    expect(released!.blockedOn).toBeNull();
  }, OP_TIMEOUT);

  it("claim → abandon (holder + token) is terminal + clears the lease", async () => {
    const agent = "agent-abandon";
    const { id, token } = await claim(agent);
    const abandoned = await repo.abandonWork(id, agent, { reason: "obsolete", leaseToken: token });
    expect(abandoned!.status).toBe("abandoned");
    expect(abandoned!.lease).toBeNull();
  }, OP_TIMEOUT);

  it("FSM guards: every illegal source phase throws TransitionRejected", async () => {
    const agent = "agent-guards";
    const w = await ready();
    // start/resume on a still-READY (unclaimed) item — lease is null so the holder
    // guard fires first; either way it rejects.
    await expect(repo.startWork(w.id, agent, "no-token")).rejects.toThrow(TransitionRejected);
    await expect(repo.resumeWork(w.id, agent, "no-token")).rejects.toThrow(TransitionRejected);

    const claimed = await repo.claimWorkItem(w.id, agent);                 // ready → claimed
    const token = claimed!.lease!.token;
    await expect(repo.claimWorkItem(w.id, "agent-other")).rejects.toThrow(/claim requires ready/); // re-claim illegal
    await expect(repo.resumeWork(w.id, agent, token)).rejects.toThrow(/resume requires blocked/);  // not blocked
    await expect(repo.blockWork(w.id, agent, token, BLOCK)).rejects.toThrow(/block requires in_progress/); // claimed, not in_progress

    await repo.startWork(w.id, agent, token);                              // claimed → in_progress
    await expect(repo.startWork(w.id, agent, token)).rejects.toThrow(/start requires claimed/);    // already started
  }, OP_TIMEOUT);

  it("illegal edges leave the row UNCHANGED (atomic fail, audit-4085 #2)", async () => {
    const agent = "agent-unchanged";
    const w = await ready();
    const claimed = await repo.claimWorkItem(w.id, agent);
    const token = claimed!.lease!.token;
    const before = await repo.getWorkItem(w.id);
    // a battery of rejected verbs from `claimed` (wrong-phase, non-holder, stale-token)
    await expect(repo.resumeWork(w.id, agent, token)).rejects.toThrow(TransitionRejected);      // not blocked
    await expect(repo.blockWork(w.id, agent, token, BLOCK)).rejects.toThrow(TransitionRejected); // not in_progress
    await expect(repo.startWork(w.id, "intruder", token)).rejects.toThrow(TransitionRejected);   // non-holder
    await expect(repo.startWork(w.id, agent, "stale-token")).rejects.toThrow(TransitionRejected); // stale token
    await expect(repo.completeWork(w.id, agent, token, [])).rejects.toThrow(TransitionRejected);  // not completable
    const after = await repo.getWorkItem(w.id);
    expect(after).toEqual(before); // byte-identical after every rejected verb — nothing wrote
  }, OP_TIMEOUT);

  it("holder guard: a non-holder cannot drive a claimed item", async () => {
    const { id, token } = await claim("agent-owner");
    await expect(repo.startWork(id, "agent-intruder", token)).rejects.toThrow(/requires the lease-holder/);
    await expect(repo.renewLease(id, "agent-intruder", token)).rejects.toThrow(/requires the lease-holder/);
    await expect(repo.releaseWork(id, "agent-intruder", token)).rejects.toThrow(/requires the lease-holder/);
  }, OP_TIMEOUT);

  it("STALE-TOKEN fence: the right agent with an OLD token is rejected (zombie-process, audit-4082 #1)", async () => {
    const agent = "agent-zombie";
    // First claim mints T1; a clean release; a re-claim mints T2. T1 is now stale.
    const w = await ready();
    const c1 = await repo.claimWorkItem(w.id, agent);
    const t1 = c1!.lease!.token;
    await repo.releaseWork(w.id, agent, t1);                  // back to ready, lease cleared
    const c2 = await repo.claimWorkItem(w.id, agent);         // re-claim → T2
    const t2 = c2!.lease!.token;
    expect(t2).not.toBe(t1);
    // The zombie holding T1 is the SAME agentId but is fenced by the token mismatch:
    await expect(repo.startWork(w.id, agent, t1)).rejects.toThrow(/stale lease token/);
    await expect(repo.renewLease(w.id, agent, t1)).rejects.toThrow(/stale lease token/);
    // The live holder with T2 proceeds:
    expect((await repo.startWork(w.id, agent, t2))!.status).toBe("in_progress");
  }, OP_TIMEOUT);

  it("abandon creator-override: the creator (no token) can abandon a held item; a random party cannot", async () => {
    const creator = { role: "architect", agentId: "agent-creator" };
    const w = await repo.createWorkItem({ type: "task", roleEligibility: [], createdBy: creator });
    await repo.claimWorkItem(w.id, "agent-holder");                        // held by someone else
    const abandoned = await repo.abandonWork(w.id, "agent-creator", { reason: "creator pulled it" });
    expect(abandoned!.status).toBe("abandoned");
    // a random third party (not holder, not creator) cannot abandon
    const { id } = await claim("agent-holder2");
    await expect(repo.abandonWork(id, "agent-random")).rejects.toThrow(/lease-holder .* or the creator/);
  }, OP_TIMEOUT);

  it("terminal immutability: an abandoned item rejects further transitions", async () => {
    const creator = { role: "architect", agentId: "agent-term" };
    const w = await repo.createWorkItem({ type: "task", roleEligibility: [], createdBy: creator });
    const claimed = await repo.claimWorkItem(w.id, "agent-term");
    const token = claimed!.lease!.token;
    await repo.abandonWork(w.id, "agent-term", { leaseToken: token });     // → abandoned
    // creator re-abandon hits the phase guard (proves terminal, not a lease-null artifact)
    await expect(repo.abandonWork(w.id, "agent-term", { leaseToken: token })).rejects.toThrow(/was abandoned/);
    await expect(repo.startWork(w.id, "agent-term", token)).rejects.toThrow(TransitionRejected);
  }, OP_TIMEOUT);

  it("renewLease extends expiresAt + heartbeatAt, keeps phase + holder + token", async () => {
    const agent = "agent-renew";
    const w = await ready();
    const claimed = await repo.claimWorkItem(w.id, agent);
    const token = claimed!.lease!.token;
    await repo.startWork(w.id, agent, token);
    const renewed = await repo.renewLease(w.id, agent, token);
    expect(renewed!.status).toBe("in_progress");                          // phase unchanged
    expect(renewed!.lease!.holder).toBe(agent);
    expect(renewed!.lease!.token).toBe(token);                            // token stable across renew
    expect(renewed!.lease!.claimedAt).toBe(claimed!.lease!.claimedAt);    // claimedAt preserved
    expect(renewed!.lease!.expiresAt >= claimed!.lease!.expiresAt).toBe(true);
  }, OP_TIMEOUT);

  it("a verb on an absent workId returns null (not throw)", async () => {
    expect(await repo.startWork("work-nonexistent", "agent-x", "tok")).toBeNull();
    expect(await repo.claimWorkItem("work-nonexistent", "agent-x")).toBeNull();
  }, OP_TIMEOUT);

  it("WIP cap: sequential claims beyond the cap throw WipCapExceeded", async () => {
    const agent = "agent-wip-seq";
    const items = await Promise.all(Array.from({ length: WIP_CAP + 1 }, () => ready()));
    for (let i = 0; i < WIP_CAP; i++) {
      expect((await repo.claimWorkItem(items[i].id, agent))!.status).toBe("claimed");
    }
    await expect(repo.claimWorkItem(items[WIP_CAP].id, agent)).rejects.toThrow(WipCapExceeded);
  }, OP_TIMEOUT);

  it("WIP cap COUNTS blocked items (audit-4082 #2: no hoard-then-claim-past-cap)", async () => {
    const agent = "agent-wip-blocked";
    // claim+start+block one item; it still holds a lease → counts toward WIP.
    const w0 = await ready();
    const c0 = await repo.claimWorkItem(w0.id, agent);
    await repo.startWork(w0.id, agent, c0!.lease!.token);
    await repo.blockWork(w0.id, agent, c0!.lease!.token, BLOCK);          // blocked, lease held
    // now claim (cap-1) more → at cap; the next claim must reject (blocked one counted).
    const more = await Promise.all(Array.from({ length: WIP_CAP }, () => ready()));
    for (let i = 0; i < WIP_CAP - 1; i++) await repo.claimWorkItem(more[i].id, agent);
    await expect(repo.claimWorkItem(more[WIP_CAP - 1].id, agent)).rejects.toThrow(WipCapExceeded);
  }, OP_TIMEOUT);

  it("WIP cap HOLDS under parallel same-agent claims (advisory-lock serialization → no over-cap)", async () => {
    const agent = "agent-wip-par";
    const n = WIP_CAP + 2;
    const items = await Promise.all(Array.from({ length: n }, () => ready()));
    const results = await Promise.allSettled(items.map((it) => repo.claimWorkItem(it.id, agent)));
    const claimed = results.filter((r) => r.status === "fulfilled" && r.value !== null);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(claimed.length).toBe(WIP_CAP);                                 // EXACTLY the cap, never more
    expect(rejected.length).toBe(n - WIP_CAP);
    for (const r of rejected) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(WipCapExceeded);
  }, OP_TIMEOUT);

  it("two agents racing ONE item: exactly one wins, the other gets TransitionRejected (CAS arbitration)", async () => {
    const w = await ready();
    const results = await Promise.allSettled([
      repo.claimWorkItem(w.id, "agent-raceA"),
      repo.claimWorkItem(w.id, "agent-raceB"),
    ]);
    const winners = results.filter((r) => r.status === "fulfilled" && r.value !== null);
    const losers = results.filter((r) => r.status === "rejected");
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);
    expect((losers[0] as PromiseRejectedResult).reason).toBeInstanceOf(TransitionRejected);
    const final = await repo.getWorkItem(w.id);
    expect(final!.status).toBe("claimed");
    expect(["agent-raceA", "agent-raceB"]).toContain(final!.lease!.holder);
  }, OP_TIMEOUT);

  it("renewLease rejects an ALREADY-EXPIRED lease (audit-4103) — it's the sweeper's to re-queue", async () => {
    // an expired-lease item (verb-reached state → direct put), held by agent-re/tok-re.
    await substrate.put("WorkItem", {
      id: "work-renew-expired", type: "task", priority: "normal", roleEligibility: [], dependsOn: [],
      evidenceRequirements: [], targetRef: null, status: "claimed",
      lease: { holder: "agent-re", token: "tok-re", claimedAt: "2020-01-01T00:00:00.000Z", expiresAt: "2020-01-01T00:05:00.000Z", heartbeatAt: "2020-01-01T00:00:00.000Z" },
      evidence: [], blockedOn: null, leaseExpiryCount: 0, createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z",
    });
    await expect(repo.renewLease("work-renew-expired", "agent-re", "tok-re")).rejects.toThrow(/already expired/);
  }, OP_TIMEOUT);

  // ── work-88 (arc-node): the subtree-coupled transitive-heartbeat ────────────────
  // A renew on a node propagates UP the ancestor chain (every arc that lists it,
  // transitively, in completionDependsOn), bumping their leases — so an arc does NOT
  // tick toward expiry while ANY descendant is actively renewing (regardless of holder).
  // The unchanged sweeper + stall-warning naturally relax because expiresAt stays fresh
  // (F3: the bump IS the relaxation). THE airtight invariant: a renew NEVER resurrects an
  // already-expired ancestor (no zombie; expireLease stays the sole expiry authority).
  describe("transitive-heartbeat (arc-node nested lease)", () => {
    const FROZEN = "2026-06-01T00:00:00.000Z";
    /** put an arc-node with a CONTROLLED lease — the only clean way to pin expiresAt for
     *  the heartbeat assertions. status=in_progress, held by `holder`. */
    async function putArc(id: string, completionDependsOn: string[], lease: { holder: string; token: string; expiresAt: string }): Promise<void> {
      await substrate.put("WorkItem", {
        id, type: "task", priority: "normal", roleEligibility: [], dependsOn: [], completionDependsOn,
        evidenceRequirements: [], targetRef: null, status: "in_progress",
        lease: { holder: lease.holder, token: lease.token, claimedAt: FROZEN, expiresAt: lease.expiresAt, heartbeatAt: FROZEN },
        evidence: [], blockedOn: null, leaseExpiryCount: 0, createdAt: FROZEN, updatedAt: FROZEN,
      });
    }
    const soon = () => new Date(Date.now() + 60_000).toISOString(); // a live arc ~about to lapse (+60s)

    it("child-renew bumps the DIRECT parent arc — fork-A: ANY holder (arc held by a different agent)", async () => {
      const child = await claim("agent-leaf-1");                              // child: live lease + token
      await putArc("work-arc-1", [child.id], { holder: "agent-arc-1", token: "tok-arc-1", expiresAt: soon() });
      const before = await repo.getWorkItem("work-arc-1");
      const renewed = await repo.renewLease(child.id, "agent-leaf-1", child.token); // renew the CHILD
      expect(renewed).not.toBeNull();                                         // F2: the renew itself succeeds
      const after = await repo.getWorkItem("work-arc-1");
      const childAfter = await repo.getWorkItem(child.id);
      expect(after!.lease!.expiresAt > before!.lease!.expiresAt).toBe(true);  // arc pushed FORWARD (kept alive)
      // bumped to the SAME fresh full TTL the child got (subtree-coupled) — not hardcoding the TTL const
      expect(Math.abs(new Date(after!.lease!.expiresAt).getTime() - new Date(childAfter!.lease!.expiresAt).getTime())).toBeLessThan(5000);
      // a HEARTBEAT, not a re-claim: holder + token + phase unchanged
      expect(after!.lease!.holder).toBe("agent-arc-1");
      expect(after!.lease!.token).toBe("tok-arc-1");
      expect(after!.status).toBe("in_progress");
    }, OP_TIMEOUT);

    it("child-renew bumps ancestors TRANSITIVELY (leaf → parent arc → grand-arc)", async () => {
      const leaf = await claim("agent-leaf-2");
      await putArc("work-arc-2", [leaf.id], { holder: "agent-arc-2", token: "tok-arc-2", expiresAt: soon() });
      await putArc("work-grandarc-2", ["work-arc-2"], { holder: "agent-grand-2", token: "tok-grand-2", expiresAt: soon() });
      const beforeArc = await repo.getWorkItem("work-arc-2");
      const beforeGrand = await repo.getWorkItem("work-grandarc-2");
      await repo.renewLease(leaf.id, "agent-leaf-2", leaf.token);
      expect((await repo.getWorkItem("work-arc-2"))!.lease!.expiresAt > beforeArc!.lease!.expiresAt).toBe(true);          // direct parent
      expect((await repo.getWorkItem("work-grandarc-2"))!.lease!.expiresAt > beforeGrand!.lease!.expiresAt).toBe(true);  // grandparent (transitive)
    }, OP_TIMEOUT);

    it("child-renew bumps ALL parent arcs that bracket it (the GIN reverse-lookup returns every parent)", async () => {
      const child = await claim("agent-leaf-3");
      await putArc("work-arc-3a", [child.id], { holder: "agent-3a", token: "tok-3a", expiresAt: soon() });
      await putArc("work-arc-3b", [child.id], { holder: "agent-3b", token: "tok-3b", expiresAt: soon() });
      const before3a = await repo.getWorkItem("work-arc-3a");
      const before3b = await repo.getWorkItem("work-arc-3b");
      await repo.renewLease(child.id, "agent-leaf-3", child.token);
      expect((await repo.getWorkItem("work-arc-3a"))!.lease!.expiresAt > before3a!.lease!.expiresAt).toBe(true);
      expect((await repo.getWorkItem("work-arc-3b"))!.lease!.expiresAt > before3b!.lease!.expiresAt).toBe(true);
    }, OP_TIMEOUT);

    it("AIRTIGHT: a child-renew does NOT resurrect an ALREADY-EXPIRED ancestor (no zombie; expireLease stays sole authority)", async () => {
      const child = await claim("agent-leaf-4");
      const dead = "2020-01-01T00:05:00.000Z"; // long past
      await putArc("work-arc-dead", [child.id], { holder: "agent-dead", token: "tok-dead", expiresAt: dead });
      await repo.renewLease(child.id, "agent-leaf-4", child.token);
      const arc = await repo.getWorkItem("work-arc-dead");
      expect(arc!.lease!.expiresAt).toBe(dead); // UNCHANGED — the already-expired guard held
    }, OP_TIMEOUT);

    it("a QUIET subtree does NOT keep the arc alive — an expired arc with no descendant-renew is reaped by expireLease (F3)", async () => {
      const child = await claim("agent-leaf-5"); // a held child, but we NEVER renew it (quiet subtree)
      await putArc("work-arc-quiet", [child.id], { holder: "agent-quiet", token: "tok-quiet", expiresAt: "2020-01-01T00:05:00.000Z" });
      const verdict = await repo.expireLease("work-arc-quiet", new Date().toISOString(), 3); // sweeper unchanged
      expect(verdict).toBe("requeued");
      expect((await repo.getWorkItem("work-arc-quiet"))!.status).toBe("ready");
    }, OP_TIMEOUT);

    it("regression: a leaf with NO parent arc renews normally (propagation is a no-op, never fails the renew)", async () => {
      const leaf = await claim("agent-leaf-6");
      const renewed = await repo.renewLease(leaf.id, "agent-leaf-6", leaf.token);
      expect(renewed!.status).toBe("claimed");
      expect(renewed!.lease!.holder).toBe("agent-leaf-6");
    }, OP_TIMEOUT);
  });

  // ── work-87 (seed_blueprint): the createBlueprintNode createOnly-dedup idempotency primitive ──
  describe("createBlueprintNode (deterministic-id createOnly + run-key)", () => {
    it("createOnly dedup: first call created:true; a re-run created:false reusing the SAME node; arc wiring round-trips", async () => {
      const leafId = "work-bp-itest-leaf";
      const arcId = "work-bp-itest-arc";
      const leaf1 = await repo.createBlueprintNode({ id: leafId, blueprintRunId: "itest", type: "task", roleEligibility: [] });
      expect(leaf1.created).toBe(true);
      expect(leaf1.item.id).toBe(leafId);
      expect(leaf1.item.blueprintRunId).toBe("itest");           // run-key stamped + round-trips
      const arc1 = await repo.createBlueprintNode({ id: arcId, blueprintRunId: "itest", type: "task", roleEligibility: [], completionDependsOn: [leafId] });
      expect(arc1.created).toBe(true);
      expect(arc1.item.completionDependsOn).toEqual([leafId]);   // arc-node edge round-trips (envelope decode)

      // RE-RUN the same ids → createOnly conflict → created:false, the existing node reused (no double-create)
      const leaf2 = await repo.createBlueprintNode({ id: leafId, blueprintRunId: "itest", type: "task", roleEligibility: [] });
      expect(leaf2.created).toBe(false);
      expect(leaf2.item.id).toBe(leafId);
      const arc2 = await repo.createBlueprintNode({ id: arcId, blueprintRunId: "itest", type: "task", roleEligibility: [], completionDependsOn: [leafId] });
      expect(arc2.created).toBe(false);
      expect(arc2.item.completionDependsOn).toEqual([leafId]);   // the existing arc, reused
    }, OP_TIMEOUT);

    it("deleteWorkItem removes a blueprint node (the compensating-delete primitive) + is idempotent on a missing id", async () => {
      const id = "work-bp-del-1";
      await repo.createBlueprintNode({ id, blueprintRunId: "del", type: "task", roleEligibility: [] });
      expect(await repo.getWorkItem(id)).not.toBeNull();
      await repo.deleteWorkItem(id);
      expect(await repo.getWorkItem(id)).toBeNull();
      await repo.deleteWorkItem(id);                  // idempotent — a missing id is a no-op, no throw
      await repo.deleteWorkItem("work-bp-never-existed");
    }, OP_TIMEOUT);
  });
});
