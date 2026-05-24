/**
 * mission-87 W3 (idea-302) — migrate-task-engineerid-to-agentid tests.
 *
 * Pins:
 *   - the migration renames the Task `assignedEngineerId` JSONB key →
 *     `assignedAgentId`, value preserved (incl. explicit null)
 *   - it is idempotent (re-run renames 0 rows, no error)
 *   - it drops the orphaned `task_assigned_agent_idx` index
 *   - it is Task-scoped (other kinds untouched) + leaves an unclaimed
 *     Task (no assignment key) alone
 *   - `--dry-run` reports the count without writing
 *   - Task SchemaDef v2 shape — version 2, field `assignedAgentId`,
 *     index `task_agent_idx` (SchemaDef-v2-compat)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { migrateTaskAgentId } from "../migrate-task-engineerid-to-agentid.js";
import { ALL_SCHEMAS } from "../../src/storage-substrate/index.js";

const { Pool } = pg;

const MIGRATIONS_DIR = join(__dirname, "..", "..", "src", "storage-substrate", "migrations");
const MIGRATION_FILES = ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"];

let container: StartedPostgreSqlContainer;
let pool: pg.Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:15-alpine")
    .withUsername("hub")
    .withPassword("hub")
    .withDatabase("hub")
    .start();
  pool = new Pool({
    connectionString: `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`,
  });
  for (const f of MIGRATION_FILES) {
    await pool.query(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
  }
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

async function insert(kind: string, id: string, data: Record<string, unknown>): Promise<void> {
  await pool.query(`INSERT INTO entities (kind, id, data) VALUES ($1, $2, $3::jsonb)`, [
    kind,
    id,
    JSON.stringify(data),
  ]);
}

async function getData(kind: string, id: string): Promise<Record<string, unknown> | null> {
  const r = await pool.query<{ data: Record<string, unknown> }>(
    `SELECT data FROM entities WHERE kind = $1 AND id = $2`,
    [kind, id],
  );
  return r.rows[0]?.data ?? null;
}

beforeEach(async () => {
  await pool.query(`TRUNCATE entities`);
  await pool.query(`DROP INDEX IF EXISTS task_assigned_agent_idx`);
  await pool.query(`DROP INDEX IF EXISTS task_agent_idx`);
});

describe("migrate-task-engineerid-to-agentid", () => {
  it("renames assignedEngineerId → assignedAgentId, value preserved", async () => {
    await insert("Task", "task-1", { id: "task-1", status: "working", assignedEngineerId: "agent-greg" });
    const renamed = await migrateTaskAgentId(pool);
    expect(renamed).toBe(1);
    const data = await getData("Task", "task-1");
    expect(data?.assignedAgentId).toBe("agent-greg");
    expect("assignedEngineerId" in (data ?? {})).toBe(false);
  });

  it("migrates an explicit-null assignment (key exists, value null)", async () => {
    await insert("Task", "task-null", { id: "task-null", status: "pending", assignedEngineerId: null });
    await migrateTaskAgentId(pool);
    const data = await getData("Task", "task-null");
    expect("assignedAgentId" in (data ?? {})).toBe(true);
    expect(data?.assignedAgentId).toBeNull();
    expect("assignedEngineerId" in (data ?? {})).toBe(false);
  });

  it("leaves a Task with no assignment key untouched", async () => {
    await insert("Task", "task-bare", { id: "task-bare", status: "pending" });
    await migrateTaskAgentId(pool);
    const data = await getData("Task", "task-bare");
    expect("assignedAgentId" in (data ?? {})).toBe(false);
    expect("assignedEngineerId" in (data ?? {})).toBe(false);
  });

  it("is Task-scoped — does not touch other kinds", async () => {
    await insert("Mission", "mission-1", { id: "mission-1", assignedEngineerId: "agent-x" });
    await migrateTaskAgentId(pool);
    const data = await getData("Mission", "mission-1");
    expect(data?.assignedEngineerId).toBe("agent-x");
    expect("assignedAgentId" in (data ?? {})).toBe(false);
  });

  it("is idempotent — re-run renames 0 rows without error", async () => {
    await insert("Task", "task-1", { id: "task-1", assignedEngineerId: "agent-greg" });
    expect(await migrateTaskAgentId(pool)).toBe(1);
    expect(await migrateTaskAgentId(pool)).toBe(0);
    const data = await getData("Task", "task-1");
    expect(data?.assignedAgentId).toBe("agent-greg");
  });

  it("drops the orphaned task_assigned_agent_idx index", async () => {
    await pool.query(
      `CREATE INDEX task_assigned_agent_idx ON entities ((data->>'assignedEngineerId')) WHERE kind = 'Task'`,
    );
    await insert("Task", "task-1", { id: "task-1", assignedEngineerId: "agent-greg" });
    await migrateTaskAgentId(pool);
    const idx = await pool.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'task_assigned_agent_idx'`);
    expect(idx.rowCount).toBe(0);
  });

  it("--dry-run reports the count without writing", async () => {
    await insert("Task", "task-1", { id: "task-1", assignedEngineerId: "agent-greg" });
    const count = await migrateTaskAgentId(pool, { dryRun: true });
    expect(count).toBe(1);
    const data = await getData("Task", "task-1");
    expect(data?.assignedEngineerId).toBe("agent-greg"); // unchanged
    expect("assignedAgentId" in (data ?? {})).toBe(false);
  });
});

describe("Task SchemaDef v2 (SchemaDef-v2-compat)", () => {
  const task = ALL_SCHEMAS.find((s) => s.kind === "Task");

  it("is version 2", () => {
    expect(task?.version).toBe(2);
  });

  it("has the renamed field assignedAgentId, not assignedEngineerId", () => {
    const fieldNames = task?.fields.map((f) => f.name) ?? [];
    expect(fieldNames).toContain("assignedAgentId");
    expect(fieldNames).not.toContain("assignedEngineerId");
  });

  it("has index task_spec_agent_idx on spec.assignedAgentId, not task_assigned_agent_idx (mission-88 W7 envelope-path rename)", () => {
    const idxNames = task?.indexes.map((i) => i.name) ?? [];
    expect(idxNames).toContain("task_spec_agent_idx");
    expect(idxNames).not.toContain("task_assigned_agent_idx");
    expect(idxNames).not.toContain("task_agent_idx");  // pre-W7 name; auto-dropped by ownership-pattern
    expect(task?.indexes.find((i) => i.name === "task_spec_agent_idx")?.fields).toEqual(["spec.assignedAgentId"]);
  });
});
