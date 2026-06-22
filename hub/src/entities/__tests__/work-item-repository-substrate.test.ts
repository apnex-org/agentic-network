/**
 * C1-R2 (mission-94) — WorkItemRepositorySubstrate integration tests (real-pg).
 *
 * Exercises the storage CRUD through the FULL envelope path (reconciler +
 * write-encoder wired exactly as Hub boot): create → envelope-encode (kinds/
 * WorkItem.ts module) → decode-to-flat (cloneWorkItem) round-trip, + the
 * list_ready_work-shaped reads (status equality + role $contains array-membership
 * over spec.roleEligibility, the C1-R2 operator + GIN). The claim/lease/FSM verbs
 * are sub-PR-3; this proves the kind is storable + queryable end-to-end.
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

describe("WorkItemRepositorySubstrate (real-pg, full envelope path)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let substrate: ReturnType<typeof createPostgresStorageSubstrate>;
  let reconciler: ReturnType<typeof createSchemaReconciler>;
  let repo: WorkItemRepositorySubstrate;

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
    repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    if (reconciler) await reconciler.close();
    if (substrate) await substrate.close();
    if (pool) await pool.end();
    if (container) await container.stop();
  }, OP_TIMEOUT);

  it("createWorkItem + getWorkItem round-trips the flat shape through envelope encode/decode", async () => {
    const created = await repo.createWorkItem({ type: "task", priority: "high", roleEligibility: ["engineer"], dependsOn: ["work-0"] });
    expect(created.id).toMatch(/^work-\d+$/);
    expect(created.status).toBe("ready");
    expect(created.lease).toBeNull();

    const got = await repo.getWorkItem(created.id);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(created.id);
    expect(got!.type).toBe("task");
    expect(got!.priority).toBe("high");
    expect(got!.roleEligibility).toEqual(["engineer"]);
    expect(got!.dependsOn).toEqual(["work-0"]);
    expect(got!.status).toBe("ready");
    expect(got!.lease).toBeNull();
    expect(got!.evidence).toEqual([]);
    expect(got!.leaseExpiryCount).toBe(0);

    // Prove the row is ENVELOPED (not flat) — the module did its job.
    const raw = await pool.query<{ data: Record<string, unknown> }>(`SELECT data FROM entities WHERE kind = 'WorkItem' AND id = $1`, [created.id]);
    const d = raw.rows[0].data as { status?: { phase?: string }; spec?: { roleEligibility?: string[] } };
    expect(d.status?.phase).toBe("ready");
    expect(d.spec?.roleEligibility).toEqual(["engineer"]);
  }, OP_TIMEOUT);

  it("listWorkItems filters by status (equality) and role ($contains array-membership)", async () => {
    const eng = await repo.createWorkItem({ type: "bug", roleEligibility: ["engineer", "verifier"] });
    const arch = await repo.createWorkItem({ type: "review", roleEligibility: ["architect"] });

    const ready = await repo.listWorkItems({ status: "ready" });
    const readyIds = new Set(ready.map((w) => w.id));
    expect(readyIds.has(eng.id)).toBe(true);
    expect(readyIds.has(arch.id)).toBe(true);

    const forEngineer = await repo.listWorkItems({ role: "engineer" });
    const engIds = new Set(forEngineer.map((w) => w.id));
    expect(engIds.has(eng.id)).toBe(true);   // roleEligibility CONTAINS "engineer"
    expect(engIds.has(arch.id)).toBe(false); // architect-only — excluded

    const forArchitect = await repo.listWorkItems({ role: "architect" });
    expect(new Set(forArchitect.map((w) => w.id)).has(arch.id)).toBe(true);
  }, OP_TIMEOUT);
});
