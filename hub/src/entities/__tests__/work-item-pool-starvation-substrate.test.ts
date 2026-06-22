/**
 * C1-R2 audit-4103 (construction HIGH) — connection-pool starvation regression guard (real-pg).
 *
 * withAdvisoryLock pins ONE pool connection for the lock session while claimWorkItem's
 * inner list/CAS each need ANOTHER from the same pool. Per-agent lock keys → N DISTINCT
 * concurrent claimers all acquire immediately → at N>=poolMax every connection is a pinned
 * lock-holder and the inner queries can't acquire → starvation/deadlock. CI never exercised
 * >=10 distinct agents, so the pg default max=10 hid this.
 *
 * BOTH-WAYS guard (per architect): the SAME 12-concurrent-claimer scenario STARVES at the
 * old default max=10 (a real regression guard, not just a green check) but SUCCEEDS at the
 * new default max=20. The starved pool uses a short connectionTimeoutMillis so starvation
 * surfaces as fail-fast errors instead of an indefinite hang.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
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
  let healthy: ReturnType<typeof createPostgresStorageSubstrate>; // default max=20
  let healthyRepo: WorkItemRepositorySubstrate;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub").withPassword("hub").withDatabase("hub").start();
    connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = new Pool({ connectionString: connStr });
    for (const f of MIGRATION_FILES) await pool.query(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
    healthy = createPostgresStorageSubstrate(connStr); // default max=20 (the fix)
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

  it(`STARVES at the old default max=10: <${N} of ${N} concurrent claimers succeed`, async () => {
    // a pool sized like the OLD pg default; a short connection-timeout makes starvation
    // fail-fast (loud) instead of hanging the test.
    const starved = createPostgresStorageSubstrate(connStr, { max: 10, connectionTimeoutMillis: 1500 });
    starved.setFieldTranslator((kind, key) => reconciler.getFieldTranslation(kind, key));
    starved.setWriteEncoder(buildEnvelopeWriteEncoder());
    const starvedRepo = new WorkItemRepositorySubstrate(starved, new SubstrateCounter(starved));
    try {
      const ok = await claimedCount(starvedRepo, "starve");
      expect(ok).toBeLessThan(N); // the old default-10 cannot satisfy N concurrent distinct claimers
    } finally {
      await starved.close();
    }
  }, OP_TIMEOUT);

  it(`SUCCEEDS at the new default max=20: all ${N} of ${N} concurrent claimers succeed`, async () => {
    const ok = await claimedCount(healthyRepo, "heal");
    expect(ok).toBe(N);
  }, OP_TIMEOUT);
});
