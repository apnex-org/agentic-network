
const NO_FRICTION = { observed: false, summary: "no friction observed" } as const;

/**
 * C1-R2 (mission-94) audit-4085 #1/#3 — claim_work AUTHORITY enforcement (real-pg).
 *
 * claim_work is the claim authority (a direct claim-by-ID bypasses the list_ready_work
 * projection), so it MUST re-enforce, fail-closed, UNDER the claim's atomic envelope:
 *   #1a role-eligibility — the agent's role ∈ spec.roleEligibility (empty = any-role)
 *   #1b dependency-readiness — every spec.dependsOn[] in phase=done (absent = unmet)
 * + #3 the WorkItem-claim-specific advisory-lock timeout (a held WIP lock → fail-closed
 *   LockAcquisitionTimeoutError, never an unlocked claim).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestPool } from "../../storage-substrate/__tests__/_pg-test-pool.js";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { createPostgresStorageSubstrate, createSchemaReconciler, ALL_SCHEMAS, buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { withAdvisoryLock, LOCK_CLASS, LockAcquisitionTimeoutError } from "../../storage-substrate/advisory-lock.js";
import { SubstrateCounter } from "../substrate-counter.js";
import { WorkItemRepositorySubstrate, ClaimRejected } from "../work-item-repository-substrate.js";

const SETUP_TIMEOUT = 90_000;
const OP_TIMEOUT = 120_000;
const MIGRATIONS_DIR = join(__dirname, "..", "..", "storage-substrate", "migrations");
const MIGRATION_FILES = ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"];

describe("WorkItem claim_work authority enforcement (real-pg)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let substrate: ReturnType<typeof createPostgresStorageSubstrate>;
  let reconciler: ReturnType<typeof createSchemaReconciler>;
  let repo: WorkItemRepositorySubstrate;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub").withPassword("hub").withDatabase("hub").start();
    const connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = createTestPool(connStr, "work-item-claim-eligibility-substrate");
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

  /** Drive an any-role item all the way to phase=done (for dependency fixtures). */
  async function doneItem(agent: string): Promise<string> {
    const w = await repo.createWorkItem({ type: "task", roleEligibility: [] });
    const c = await repo.claimWorkItem(w.id, agent);
    await repo.startWork(w.id, agent, c!.lease!.token);
    await repo.completeWork(w.id, agent, c!.lease!.token, [{ requirementId: "x", kind: "freeform", producedAt: new Date().toISOString() }], NO_FRICTION);
    return w.id;
  }

  // ── #1a role-eligibility ────────────────────────────────────────────────────

  it("eligible role claims; ineligible role is ClaimRejected", async () => {
    const eng = await repo.createWorkItem({ type: "task", roleEligibility: ["engineer", "verifier"] });
    expect((await repo.claimWorkItem(eng.id, "agent-e", "engineer"))!.status).toBe("claimed");

    const arch = await repo.createWorkItem({ type: "task", roleEligibility: ["engineer"] });
    await expect(repo.claimWorkItem(arch.id, "agent-a", "architect")).rejects.toThrow(ClaimRejected);
    // and the row is untouched (still ready, no lease)
    const after = await repo.getWorkItem(arch.id);
    expect(after!.status).toBe("ready");
    expect(after!.lease).toBeNull();
  }, OP_TIMEOUT);

  it("a role-gated item with NO role presented is ClaimRejected (fail-closed)", async () => {
    const gated = await repo.createWorkItem({ type: "task", roleEligibility: ["engineer"] });
    await expect(repo.claimWorkItem(gated.id, "agent-norole")).rejects.toThrow(/not in roleEligibility/);
  }, OP_TIMEOUT);

  it("empty roleEligibility = any-role (claims with or without a role)", async () => {
    const any1 = await repo.createWorkItem({ type: "task", roleEligibility: [] });
    expect((await repo.claimWorkItem(any1.id, "agent-x"))!.status).toBe("claimed"); // no role
    const any2 = await repo.createWorkItem({ type: "task", roleEligibility: [] });
    expect((await repo.claimWorkItem(any2.id, "agent-y", "anything"))!.status).toBe("claimed"); // any role
  }, OP_TIMEOUT);

  // ── #1b dependency-readiness ────────────────────────────────────────────────

  it("all dependencies done → claimable", async () => {
    const d1 = await doneItem("agent-dep1");
    const d2 = await doneItem("agent-dep2");
    const w = await repo.createWorkItem({ type: "task", roleEligibility: [], dependsOn: [d1, d2] });
    expect((await repo.claimWorkItem(w.id, "agent-claimer"))!.status).toBe("claimed");
  }, OP_TIMEOUT);

  it("a not-done dependency → ClaimRejected (listing the unmet dep); row unchanged", async () => {
    const done = await doneItem("agent-dep3");
    const pending = await repo.createWorkItem({ type: "task", roleEligibility: [] }); // stays ready (not done)
    const w = await repo.createWorkItem({ type: "task", roleEligibility: [], dependsOn: [done, pending.id] });
    await expect(repo.claimWorkItem(w.id, "agent-claimer2")).rejects.toThrow(new RegExp(`dependencies not done:.*${pending.id}`));
    const after = await repo.getWorkItem(w.id);
    expect(after!.status).toBe("ready");
    expect(after!.lease).toBeNull();
  }, OP_TIMEOUT);

  it("an absent dependency counts as unmet → ClaimRejected (fail-closed)", async () => {
    const w = await repo.createWorkItem({ type: "task", roleEligibility: [], dependsOn: ["work-does-not-exist"] });
    await expect(repo.claimWorkItem(w.id, "agent-claimer3")).rejects.toThrow(/dependencies not done:.*work-does-not-exist/);
  }, OP_TIMEOUT);

  it("once a blocking dependency reaches done, the dependent becomes claimable", async () => {
    // dep starts ready; the dependent is un-claimable; complete the dep; now claimable.
    const dep = await repo.createWorkItem({ type: "task", roleEligibility: [] });
    const w = await repo.createWorkItem({ type: "task", roleEligibility: [], dependsOn: [dep.id] });
    await expect(repo.claimWorkItem(w.id, "agent-c")).rejects.toThrow(ClaimRejected);
    // drive the dep to done
    const dc = await repo.claimWorkItem(dep.id, "agent-depdriver");
    await repo.startWork(dep.id, "agent-depdriver", dc!.lease!.token);
    await repo.completeWork(dep.id, "agent-depdriver", dc!.lease!.token, [{ requirementId: "x", kind: "freeform", producedAt: new Date().toISOString() }], NO_FRICTION);
    expect((await repo.claimWorkItem(w.id, "agent-c"))!.status).toBe("claimed");
  }, OP_TIMEOUT);

  // ── #3 claim-specific advisory-lock timeout (fail-closed) ───────────────────

  it("a held WIP lock makes a same-agent claim fail-CLOSED with LockAcquisitionTimeoutError", async () => {
    const agent = "agent-lockheld";
    const w = await repo.createWorkItem({ type: "task", roleEligibility: [] });
    let release!: () => void;
    const held = new Promise<void>((res) => { release = res; });
    // hold the SAME (class, key) the claim hashes to — keyed on agentId.
    const holder = withAdvisoryLock(substrate, LOCK_CLASS.workItemWip, agent, () => held);
    await new Promise((r) => setTimeout(r, 200)); // let the holder acquire
    try {
      await expect(repo.claimWorkItem(w.id, agent)).rejects.toBeInstanceOf(LockAcquisitionTimeoutError);
      // claim never proceeded unlocked — the item is still ready
      expect((await repo.getWorkItem(w.id))!.status).toBe("ready");
    } finally {
      release();
      await holder;
    }
  }, OP_TIMEOUT);

  // ── work-94 (cold-start spine): the non-dark emptyReason on the agent-scoped projection ──
  describe("listReadyForRole non-dark emptyReason", () => {
    const CAP = 3; // DEFAULT_WIP_CAP

    it("wip_capped: a MAXED agent's scoped projection short-circuits empty WITH emptyReason=wip_capped", async () => {
      const agent = "agent-ncr-cap";
      for (let i = 0; i < CAP; i++) {
        const w = await repo.createWorkItem({ type: "task", roleEligibility: [] });
        await repo.claimWorkItem(w.id, agent); // fills the agent's in-flight count to the cap
      }
      const res = await repo.listReadyForRole("engineer", 50, agent);
      expect(res.items).toEqual([]);             // short-circuited before the scan (AC5 parity)
      expect(res.emptyReason).toBe("wip_capped"); // non-dark: says WHY, not a silent zero
    }, OP_TIMEOUT);

    it("non-empty: a not-capped agent with claimable work gets items + NO emptyReason", async () => {
      const agent = "agent-ncr-fresh";
      await repo.createWorkItem({ type: "task", roleEligibility: [] }); // a claimable any-role ready item
      const res = await repo.listReadyForRole("engineer", 50, agent);
      expect(res.items.length).toBeGreaterThan(0);
      expect(res.emptyReason).toBeUndefined();    // a non-empty digest is not annotated
    }, OP_TIMEOUT);
  });
});
