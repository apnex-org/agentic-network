/**
 * C1-R2 audit-4103 (construction HIGH) — connection-pool starvation regression guard (real-pg).
 *
 * withAdvisoryLock pins ONE pool connection for the lock session while claimWorkItem's
 * inner list/CAS each need ANOTHER from the same pool. Per-agent lock keys → N DISTINCT
 * concurrent claimers all acquire immediately → at N>=poolMax every connection is a pinned
 * lock-holder and the inner queries can't acquire → starvation/deadlock. CI never exercised
 * >=10 distinct agents, so the pg default max=10 hid this.
 *
 * BOTH-WAYS guard (per architect): STARVES — at max=10 all 10 connections pin → the 11th
 * acquire cannot proceed (the deadlock root, asserted deterministically at the pool level
 * with fully-awaited cleanup — no connectionTimeoutMillis, so no pg-pool zombie-connect
 * teardown race). SUCCEEDS — 12 concurrent claims succeed at the new default max=25 (a
 * revert to a too-small max deadlocks→times-out→fails this, so it stays a real guard).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { createPostgresStorageSubstrate, createSchemaReconciler, ALL_SCHEMAS, buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import { WorkItemRepositorySubstrate } from "../work-item-repository-substrate.js";

const SETUP_TIMEOUT = 90_000;
const OP_TIMEOUT = 120_000;
const MIGRATIONS_DIR = join(__dirname, "..", "..", "storage-substrate", "migrations");
const MIGRATION_FILES = ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"];
const N = 12; // > the old pg default max=10

describe("WorkItem pool-starvation regression guard (real-pg)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let connStr: string;
  let reconciler: ReturnType<typeof createSchemaReconciler>;
  let healthy: ReturnType<typeof createPostgresStorageSubstrate>; // default max=25
  let healthyRepo: WorkItemRepositorySubstrate;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub").withPassword("hub").withDatabase("hub").start();
    connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = new Pool({ connectionString: connStr });
    for (const f of MIGRATION_FILES) await pool.query(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
    healthy = createPostgresStorageSubstrate(connStr); // default max=25 (the fix)
    reconciler = createSchemaReconciler(healthy, connStr, { initialSchemas: ALL_SCHEMAS });
    await reconciler.start();
    healthy.setFieldTranslator((kind, key) => reconciler.getFieldTranslation(kind, key));
    healthy.setWriteEncoder(buildEnvelopeWriteEncoder());
    healthyRepo = new WorkItemRepositorySubstrate(healthy, new SubstrateCounter(healthy));
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    if (reconciler) await reconciler.close();
    if (healthy) await healthy.close();
    if (pool) await pool.end();
    if (container) await container.stop();
  }, OP_TIMEOUT);

  async function claimedCount(repo: WorkItemRepositorySubstrate, tag: string): Promise<number> {
    const items = await Promise.all(Array.from({ length: N }, () => repo.createWorkItem({ type: "task", roleEligibility: [] })));
    const results = await Promise.allSettled(items.map((it, i) => repo.claimWorkItem(it.id, `agent-${tag}-${i}`)));
    return results.filter((r) => r.status === "fulfilled" && r.value !== null).length;
  }

  it(`STARVES at the old default max=10: with all 10 connections pinned, the 11th acquire cannot proceed`, async () => {
    // The deadlock ROOT, demonstrated cleanly at the pool level (no connectionTimeoutMillis
    // → no pg-pool zombie-connect teardown race): withAdvisoryLock pins a connection while
    // the inner list/CAS need another, so at N>=max every connection is a pinned holder and
    // the next acquire starves. Here we pin all `max` connections directly + show the next
    // acquire blocks, then FULLY-AWAIT cleanup (release held → drain the pending → end).
    const starved = new Pool({ connectionString: connStr, max: 10 });
    try {
      const held: PoolClient[] = [];
      for (let i = 0; i < 10; i++) held.push(await starved.connect()); // pin all 10
      const eleventh = starved.connect(); // no free connection → blocks
      const outcome = await Promise.race([
        eleventh.then(() => "acquired" as const, () => "error" as const),
        new Promise<"starved">((r) => setTimeout(() => r("starved"), 1000)),
      ]);
      expect(outcome).toBe("starved"); // pool exhausted at max — the WorkItem deadlock's root
      // clean, fully-awaited teardown: free the held → the pending 11th now resolves → release it.
      held.forEach((c) => c.release());
      (await eleventh).release();
    } finally {
      await starved.end();
    }
  }, OP_TIMEOUT);

  it(`SUCCEEDS at the new default (25): all ${N} of ${N} concurrent claimers succeed (a revert to a too-small max deadlocks this)`, async () => {
    const ok = await claimedCount(healthyRepo, "heal");
    expect(ok).toBe(N);
  }, OP_TIMEOUT);
});
