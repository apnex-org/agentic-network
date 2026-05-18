/**
 * mission-83 W4.x.5 — MissionRepositorySubstrate integration tests.
 *
 * 2 tests covering Option Y composition + PulseSweeper-via-IMissionStore facade:
 *   1. createMission + getMission + listMissions(status filter) + findByCascadeKey
 *      + updateMission CAS retry via Design v1.4 getWithRevision+putIfMatch +
 *      mergePulsesPreservingBookkeeping (Mission-57 W1 sweeper bookkeeping
 *      preservation discipline)
 *   2. plannedTasks slot transitions (issued + completed) via CAS retry +
 *      PulseSweeper-pattern listMissions(active) filter exercise (per W3.x.2
 *      disposition)
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
import { MissionRepositorySubstrate } from "../mission-repository-substrate.js";
import { SubstrateCounter } from "../substrate-counter.js";
import type { ITaskStore, Task } from "../../state.js";
import type { IIdeaStore, Idea } from "../idea.js";

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

// Stub stores for hydrate() — minimal interface compliance via Partial cast.
const stubTaskStore = { listTasks: async (): Promise<Task[]> => [] } as unknown as ITaskStore;
const stubIdeaStore = { listIdeas: async (): Promise<Idea[]> => [] } as unknown as IIdeaStore;

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

  const subset = ALL_SCHEMAS.filter(s => ["SchemaDef", "Mission"].includes(s.kind));
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
    await pool.query(`DELETE FROM entities WHERE kind IN ($1, $2)`, ["Mission", "Counter"]);
  } finally {
    await pool.end();
  }
});

describe("MissionRepositorySubstrate (W4.x.5 Option Y sibling-pattern)", () => {
  it("createMission + getMission + listMissions + findByCascadeKey + updateMission CAS + mergePulsesPreservingBookkeeping", async () => {
    const counter = new SubstrateCounter(substrate);
    const repo = new MissionRepositorySubstrate(substrate, counter, stubTaskStore, stubIdeaStore);

    // First mission
    const m1 = await repo.createMission("First Mission", "Mission description");
    expect(m1.id).toBe("mission-1");
    expect(m1.status).toBe("proposed");
    expect(m1.correlationId).toBe("mission-1");
    expect(m1.tasks).toEqual([]);
    expect(m1.ideas).toEqual([]);

    // Cascade-spawned mission
    const cascaded = await repo.createMission(
      "Cascade Mission",
      "From thread",
      "docs/design.md",
      { sourceThreadId: "thread-A", sourceActionId: "action-1", sourceThreadSummary: "summary" },
    );
    expect(cascaded.id).toBe("mission-2");
    expect(cascaded.sourceThreadId).toBe("thread-A");
    expect(cascaded.documentRef).toBe("docs/design.md");

    // getMission round-trip
    const fetched = await repo.getMission("mission-1");
    expect(fetched?.title).toBe("First Mission");
    expect(fetched?.status).toBe("proposed");

    // findByCascadeKey via mission_cascade_idx
    const found = await repo.findByCascadeKey({ sourceThreadId: "thread-A", sourceActionId: "action-1" });
    expect(found?.id).toBe("mission-2");
    const notFound = await repo.findByCascadeKey({ sourceThreadId: "thread-A", sourceActionId: "action-99" });
    expect(notFound).toBeNull();

    // updateMission CAS — status flip + plannedTasks set
    const updated = await repo.updateMission("mission-1", {
      status: "active",
      plannedTasks: [
        { sequence: 1, title: "Task 1", description: "Do thing", status: "unissued", issuedTaskId: null },
        { sequence: 2, title: "Task 2", description: "Do other thing", status: "unissued", issuedTaskId: null },
      ],
    });
    expect(updated?.status).toBe("active");
    expect(updated?.plannedTasks).toHaveLength(2);

    // listMissions(status filter) — PulseSweeper-pattern (active missions for pulse-eval)
    const activeMissions = await repo.listMissions("active");
    expect(activeMissions).toHaveLength(1);
    expect(activeMissions[0].id).toBe("mission-1");

    const proposed = await repo.listMissions("proposed");
    expect(proposed).toHaveLength(1);
    expect(proposed[0].id).toBe("mission-2");

    // mergePulsesPreservingBookkeeping — Mission-57 W1 discipline
    // Set engineer-authored pulse via MCP-tool boundary (no bookkeeping)
    await repo.updateMission("mission-1", {
      pulses: {
        engineerPulse: {
          intervalSeconds: 21600,
          message: "engineer pulse msg",
          responseShape: "short_status",
          missedThreshold: 3,
          firstFireDelaySeconds: 21600,
        },
      },
    });
    const withPulse = await repo.getMission("mission-1");
    expect(withPulse?.pulses?.engineerPulse?.intervalSeconds).toBe(21600);
    expect(withPulse?.pulses?.engineerPulse?.lastFiredAt).toBeUndefined();

    // Simulate PulseSweeper direct bookkeeping update (carrying engineer-authored + adding bookkeeping)
    await repo.updateMission("mission-1", {
      pulses: {
        engineerPulse: {
          intervalSeconds: 21600,
          message: "engineer pulse msg",
          responseShape: "short_status",
          missedThreshold: 3,
          firstFireDelaySeconds: 21600,
          lastFiredAt: "2026-05-17T04:00:00Z",
          missedCount: 0,
        },
      },
    });
    const sweepBumped = await repo.getMission("mission-1");
    expect(sweepBumped?.pulses?.engineerPulse?.lastFiredAt).toBe("2026-05-17T04:00:00Z");
    expect(sweepBumped?.pulses?.engineerPulse?.missedCount).toBe(0);

    // Now MCP-tool boundary strips bookkeeping; engineer-authored update should
    // PRESERVE the existing sweeper bookkeeping (mergePulsesPreservingBookkeeping)
    await repo.updateMission("mission-1", {
      pulses: {
        engineerPulse: {
          intervalSeconds: 43200,  // doubled
          message: "engineer pulse msg",
          responseShape: "short_status",
          missedThreshold: 3,
          firstFireDelaySeconds: 21600,
          // no bookkeeping fields (MCP-stripped)
        },
      },
    });
    const merged = await repo.getMission("mission-1");
    expect(merged?.pulses?.engineerPulse?.intervalSeconds).toBe(43200);  // engineer-authored updated
    expect(merged?.pulses?.engineerPulse?.lastFiredAt).toBe("2026-05-17T04:00:00Z");  // bookkeeping PRESERVED
    expect(merged?.pulses?.engineerPulse?.missedCount).toBe(0);  // bookkeeping PRESERVED

    // updateMission on absent returns null
    const noMission = await repo.updateMission("mission-99", { status: "completed" });
    expect(noMission).toBeNull();
  }, 60_000);

  it("plannedTasks slot transitions (issued + completed) via CAS retry", async () => {
    const counter = new SubstrateCounter(substrate);
    const repo = new MissionRepositorySubstrate(substrate, counter, stubTaskStore, stubIdeaStore);

    const m = await repo.createMission(
      "Mission with plan",
      "desc",
      undefined,
      undefined,
      undefined,
      [
        { sequence: 1, title: "W1", description: "Wave 1", status: "unissued", issuedTaskId: null },
        { sequence: 2, title: "W2", description: "Wave 2", status: "unissued", issuedTaskId: null },
      ],
    );
    expect(m.plannedTasks).toHaveLength(2);

    // Issue plannedTask sequence=1
    const issued = await repo.markPlannedTaskIssued("mission-1", 1, "task-100");
    expect(issued?.sequence).toBe(1);
    expect(issued?.status).toBe("issued");
    expect(issued?.issuedTaskId).toBe("task-100");

    // Verify persistence
    const refetched = await repo.getMission("mission-1");
    const slot1 = refetched?.plannedTasks?.find(p => p.sequence === 1);
    expect(slot1?.status).toBe("issued");
    expect(slot1?.issuedTaskId).toBe("task-100");

    // Re-issue on already-issued slot returns null (status-guard)
    const reIssue = await repo.markPlannedTaskIssued("mission-1", 1, "task-200");
    expect(reIssue).toBeNull();

    // Complete the issued task
    const completed = await repo.markPlannedTaskCompleted("mission-1", "task-100");
    expect(completed?.sequence).toBe(1);
    expect(completed?.status).toBe("completed");

    // Re-complete on already-completed slot returns null
    const reComplete = await repo.markPlannedTaskCompleted("mission-1", "task-100");
    expect(reComplete).toBeNull();

    // Complete on absent issuedTaskId returns null
    const noTask = await repo.markPlannedTaskCompleted("mission-1", "task-999");
    expect(noTask).toBeNull();

    // Mark on absent mission returns null
    const noMission = await repo.markPlannedTaskIssued("mission-99", 1, "task-x");
    expect(noMission).toBeNull();
  }, 60_000);
});
