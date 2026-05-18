/**
 * mission-83 W4.x.11 — TurnRepositorySubstrate integration tests.
 *
 * 2 tests covering Option Y composition + virtual-view hydration:
 *   1. createTurn + getTurn + listTurns + updateTurn CAS via Design v1.4
 *      getWithRevision + putIfMatch
 *   2. hydrate virtual-view (missionIds + taskIds filtered by turnId via stub
 *      stores)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import {
  createPostgresStorageSubstrate,
  createSchemaReconciler,
  ALL_SCHEMAS,
  type HubStorageSubstrate,
  type SchemaReconciler,
} from "../../storage-substrate/index.js";
import { TurnRepositorySubstrate } from "../turn-repository-substrate.js";
import { SubstrateCounter } from "../substrate-counter.js";
import type { ITaskStore, Task } from "../../state.js";
import type { IMissionStore } from "../mission.js";
import type { Mission } from "../mission.js";

const { Pool } = pg;

let container: StartedPostgreSqlContainer;
let substrate: HubStorageSubstrate;
let reconciler: SchemaReconciler;
let connStr: string;

const MIGRATIONS_DIR = join(__dirname, "..", "..", "storage-substrate", "migrations");
const MIGRATION_FILES = [
  "001-entities-table.sql",
  "002-notify-trigger.sql",
  "003-jsonb-size-check.sql",
];

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:15-alpine")
    .withUsername("hub")
    .withPassword("hub")
    .withDatabase("hub")
    .start();
  connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;

  const pool = new Pool({ connectionString: connStr });
  for (const f of MIGRATION_FILES) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf-8");
    await pool.query(sql);
  }
  await pool.end();

  substrate = createPostgresStorageSubstrate(connStr);

  const subset = ALL_SCHEMAS.filter(s => ["SchemaDef", "Turn"].includes(s.kind));
  reconciler = createSchemaReconciler(substrate, connStr, {
    initialSchemas: subset,
    log: () => { /* silent */ },
    warn: () => { /* silent */ },
  });
  await reconciler.start();
}, 60_000);

afterAll(async () => {
  await reconciler.close();
  await (substrate as unknown as { close: () => Promise<void> }).close?.();
  await container.stop();
}, 30_000);

beforeEach(async () => {
  const pool = new Pool({ connectionString: connStr });
  try {
    await pool.query(`DELETE FROM entities WHERE kind IN ($1, $2)`, ["Turn", "Counter"]);
  } finally {
    await pool.end();
  }
});

describe("TurnRepositorySubstrate (W4.x.11 Option Y sibling-pattern)", () => {
  it("createTurn + getTurn + listTurns + updateTurn CAS", async () => {
    const counter = new SubstrateCounter(substrate);
    const stubMission = { listMissions: async (): Promise<Mission[]> => [] } as unknown as IMissionStore;
    const stubTask = { listTasks: async (): Promise<Task[]> => [] } as unknown as ITaskStore;
    const repo = new TurnRepositorySubstrate(substrate, counter, stubMission, stubTask);

    const t1 = await repo.createTurn("Turn one", "Wave 1 scope", ["tele-1", "tele-2"]);
    expect(t1.id).toBe("turn-1");
    expect(t1.title).toBe("Turn one");
    expect(t1.status).toBe("planning");
    expect(t1.tele).toEqual(["tele-1", "tele-2"]);
    expect(t1.correlationId).toBe("turn-1");
    expect(t1.missionIds).toEqual([]);
    expect(t1.taskIds).toEqual([]);

    const t2 = await repo.createTurn("Turn two", "Wave 2 scope");
    expect(t2.id).toBe("turn-2");

    // getTurn round-trip
    const fetched = await repo.getTurn("turn-1");
    expect(fetched?.title).toBe("Turn one");

    // listTurns + status filter
    const all = await repo.listTurns();
    expect(all).toHaveLength(2);

    const planning = await repo.listTurns("planning");
    expect(planning).toHaveLength(2);

    // updateTurn CAS
    const updated = await repo.updateTurn("turn-1", { status: "active", scope: "updated scope" });
    expect(updated?.status).toBe("active");
    expect(updated?.scope).toBe("updated scope");

    const refetched = await repo.getTurn("turn-1");
    expect(refetched?.status).toBe("active");

    const activeOnly = await repo.listTurns("active");
    expect(activeOnly).toHaveLength(1);
    expect(activeOnly[0].id).toBe("turn-1");

    // updateTurn on absent returns null
    const noTurn = await repo.updateTurn("turn-99", { status: "completed" });
    expect(noTurn).toBeNull();
  }, 60_000);

  it("hydrate virtual-view (missionIds + taskIds filtered by turnId)", async () => {
    const counter = new SubstrateCounter(substrate);

    // Stub stores: missions m-1 (turn-1), m-2 (turn-2); tasks t-1 (turn-1), t-2 (turn-1), t-3 (turn-2)
    const missions = [
      { id: "m-1", turnId: "turn-1" } as Mission,
      { id: "m-2", turnId: "turn-2" } as Mission,
    ];
    const tasks = [
      { id: "t-1", turnId: "turn-1" } as Task,
      { id: "t-2", turnId: "turn-1" } as Task,
      { id: "t-3", turnId: "turn-2" } as Task,
    ];
    const stubMission = { listMissions: async (): Promise<Mission[]> => missions } as unknown as IMissionStore;
    const stubTask = { listTasks: async (): Promise<Task[]> => tasks } as unknown as ITaskStore;
    const repo = new TurnRepositorySubstrate(substrate, counter, stubMission, stubTask);

    const t1 = await repo.createTurn("Turn 1", "scope");
    expect(t1.missionIds).toEqual(["m-1"]);  // filtered by turnId=turn-1
    expect(t1.taskIds).toEqual(["t-1", "t-2"]);  // filtered by turnId=turn-1

    const t2 = await repo.createTurn("Turn 2", "scope");
    expect(t2.missionIds).toEqual(["m-2"]);  // filtered by turnId=turn-2
    expect(t2.taskIds).toEqual(["t-3"]);

    // listTurns hydrates each
    const all = await repo.listTurns();
    const tA = all.find(t => t.id === "turn-1");
    const tB = all.find(t => t.id === "turn-2");
    expect(tA?.missionIds).toEqual(["m-1"]);
    expect(tA?.taskIds).toEqual(["t-1", "t-2"]);
    expect(tB?.missionIds).toEqual(["m-2"]);
    expect(tB?.taskIds).toEqual(["t-3"]);
  }, 60_000);
});
