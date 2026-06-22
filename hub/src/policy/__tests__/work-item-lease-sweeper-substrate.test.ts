/**
 * C1-R2 (mission-94) sub-PR-4a — WorkItem lease-expiry sweeper (real-pg).
 *
 * Injected `nowISO` is the testable clock (no 15-min waits): a claim sets
 * expiresAt = claimedAt + LEASE_TTL; sweeping with a future nowISO makes the lease
 * lapsed. Covers: expired → re-queue + leaseExpiryCount++; a valid lease left
 * untouched; POISON-ABANDON at the cap; and the renew-vs-sweeper CAS one-winner
 * (expireLease re-checks expiry on the fresh row → a lease pushed past nowISO is
 * skipped, never double-swept).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { createPostgresStorageSubstrate, createSchemaReconciler, ALL_SCHEMAS, buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../../entities/substrate-counter.js";
import { AuditRepositorySubstrate } from "../../entities/audit-repository-substrate.js";
import { WorkItemRepositorySubstrate } from "../../entities/work-item-repository-substrate.js";
import { WorkItemLeaseSweeper } from "../work-item-lease-sweeper.js";
import { createMetricsCounter } from "../../observability/metrics.js";
import type { IPolicyContext } from "../types.js";

const SETUP_TIMEOUT = 90_000;
const OP_TIMEOUT = 120_000;
const MIGRATIONS_DIR = join(__dirname, "..", "..", "storage-substrate", "migrations");
const MIGRATION_FILES = ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"];
const FUTURE = "2099-01-01T00:00:00.000Z"; // past any real claim's expiresAt → lease lapsed

const ctxProvider = {
  forSweeper: (): IPolicyContext => ({
    stores: {} as never, metrics: createMetricsCounter(),
    emit: async () => {}, dispatch: async () => {},
    sessionId: "test-lease-sweeper", clientIp: "127.0.0.1", role: "system", internalEvents: [],
  } as unknown as IPolicyContext),
};

describe("WorkItemLeaseSweeper (real-pg)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let substrate: ReturnType<typeof createPostgresStorageSubstrate>;
  let reconciler: ReturnType<typeof createSchemaReconciler>;
  let repo: WorkItemRepositorySubstrate;
  let audit: AuditRepositorySubstrate;
  let sweeper: WorkItemLeaseSweeper;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub").withPassword("hub").withDatabase("hub").start();
    const connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = new Pool({ connectionString: connStr });
    for (const f of MIGRATION_FILES) await pool.query(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
    substrate = createPostgresStorageSubstrate(connStr);
    reconciler = createSchemaReconciler(substrate, connStr, { initialSchemas: ALL_SCHEMAS });
    await reconciler.start();
    substrate.setFieldTranslator((kind, key) => reconciler.getFieldTranslation(kind, key));
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    const counter = new SubstrateCounter(substrate);
    repo = new WorkItemRepositorySubstrate(substrate, counter);
    audit = new AuditRepositorySubstrate(substrate, counter);
    sweeper = new WorkItemLeaseSweeper(repo, ctxProvider, { audit });
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    sweeper?.stop();
    if (reconciler) await reconciler.close();
    if (substrate) await substrate.close();
    if (pool) await pool.end();
    if (container) await container.stop();
  }, OP_TIMEOUT);

  const ready = () => repo.createWorkItem({ type: "task", roleEligibility: [] });

  it("sweeps an expired lease back to ready + increments leaseExpiryCount", async () => {
    const w = await ready();
    await repo.claimWorkItem(w.id, "agent-1");
    const res = await sweeper.fullSweep(FUTURE);
    expect(res.requeued).toBeGreaterThanOrEqual(1);
    const after = await repo.getWorkItem(w.id);
    expect(after!.status).toBe("ready");
    expect(after!.lease).toBeNull();
    expect(after!.leaseExpiryCount).toBe(1);
  }, OP_TIMEOUT);

  it("leaves a STILL-VALID lease untouched (nowISO before expiresAt)", async () => {
    const w = await ready();
    const c = await repo.claimWorkItem(w.id, "agent-2");
    // sweep at claimedAt (== now < expiresAt) — the item is not expired.
    await sweeper.fullSweep(c!.lease!.claimedAt);
    const after = await repo.getWorkItem(w.id);
    expect(after!.status).toBe("claimed");
    expect(after!.leaseExpiryCount).toBe(0);
  }, OP_TIMEOUT);

  it("POISON-ABANDONS an item after poisonCap lease-expiry cycles", async () => {
    const sweeper2 = new WorkItemLeaseSweeper(repo, ctxProvider, { audit, poisonCap: 2 });
    const w = await ready();
    await repo.claimWorkItem(w.id, "agent-p1");
    expect((await sweeper2.fullSweep(FUTURE)).abandoned).toBe(0); // count 1 (< 2) → requeue
    expect((await repo.getWorkItem(w.id))!.status).toBe("ready");
    expect((await repo.getWorkItem(w.id))!.leaseExpiryCount).toBe(1);

    await repo.claimWorkItem(w.id, "agent-p2"); // re-claim (poison counter persists at 1)
    const res = await sweeper2.fullSweep(FUTURE);                 // count 2 (>= 2) → abandon
    expect(res.abandoned).toBeGreaterThanOrEqual(1);
    const after = await repo.getWorkItem(w.id);
    expect(after!.status).toBe("abandoned");
    expect(after!.leaseExpiryCount).toBe(2);
    expect(after!.lease).toBeNull();
  }, OP_TIMEOUT);

  it("renew-vs-sweeper CAS one-winner: expireLease re-checks expiry on the fresh row", async () => {
    const w = await ready();
    const c = await repo.claimWorkItem(w.id, "agent-race");
    const expiresAt = c!.lease!.expiresAt;
    // a sweep whose nowISO is BEFORE the (renewed-out) expiry → SKIP, item untouched.
    const before = new Date(Date.parse(expiresAt) - 1000).toISOString();
    expect(await repo.expireLease(w.id, before, 3)).toBe("skipped");
    expect((await repo.getWorkItem(w.id))!.status).toBe("claimed");
    // a sweep whose nowISO is AFTER the expiry → re-queue.
    const after = new Date(Date.parse(expiresAt) + 1000).toISOString();
    expect(await repo.expireLease(w.id, after, 3)).toBe("requeued");
    expect((await repo.getWorkItem(w.id))!.status).toBe("ready");
  }, OP_TIMEOUT);

  it("expireLease on an absent item → skipped (no throw)", async () => {
    expect(await repo.expireLease("work-ghost", FUTURE, 3)).toBe("skipped");
  }, OP_TIMEOUT);
});
