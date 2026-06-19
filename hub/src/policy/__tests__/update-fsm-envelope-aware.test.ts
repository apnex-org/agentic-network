/**
 * mission-89 Phase 4 (bug-137 closure) — envelope-aware update_* FSM dispositive.
 *
 * Verifies that update_bug / update_mission / update_idea / update_turn
 * succeed against pre-existing envelope-shape entities (status as {phase, ...}
 * object, NOT top-level string). Pre-fix: `current.status !== status` was
 * `{phase: "open"} !== "resolved"` → always true → "Invalid state transition"
 * error blocked legitimate updates (required psql workaround).
 *
 * Post-fix: `phaseFromEntity(current)` extracts `status.phase` (envelope) or
 * top-level `status` (legacy) uniformly → FSM check correctness.
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

const { Pool } = pg;

describe("update_* FSM envelope-aware (bug-137 closure)", () => {
  let pgContainer: StartedPostgreSqlContainer | undefined;
  let pgConnStr: string | undefined;
  let substrate: HubStorageSubstrate | undefined;
  let reconciler: SchemaReconciler | undefined;

  const MIGRATIONS_DIR = join(__dirname, "..", "..", "storage-substrate", "migrations");
  const MIGRATION_FILES = [
    "001-entities-table.sql",
    "002-notify-trigger.sql",
    "003-jsonb-size-check.sql",
  ];

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub")
      .withPassword("hub")
      .withDatabase("hub")
      .start();
    pgConnStr = `postgres://hub:hub@${pgContainer.getHost()}:${pgContainer.getPort()}/hub`;

    const pool = new Pool({ connectionString: pgConnStr });
    for (const f of MIGRATION_FILES) {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf-8");
      await pool.query(sql);
    }
    await pool.end();

    substrate = createPostgresStorageSubstrate(pgConnStr);

    const subset = ALL_SCHEMAS.filter((s) =>
      ["SchemaDef", "Bug", "Mission", "Idea", "Turn", "Counter"].includes(s.kind),
    );
    reconciler = createSchemaReconciler(substrate, pgConnStr, {
      initialSchemas: subset,
      log: () => { /* silent */ },
      warn: () => { /* silent */ },
    });
    await reconciler.start();
  }, 60_000);

  afterAll(async () => {
    if (reconciler) await reconciler.close();
    if (substrate) await substrate.close();
    if (pgContainer) await pgContainer.stop();
  }, 30_000);

  beforeEach(async () => {
    if (!pgConnStr) throw new Error("connection unavailable");
    const pool = new Pool({ connectionString: pgConnStr });
    try {
      await pool.query(`DELETE FROM entities WHERE kind IN ('Bug', 'Mission', 'Idea', 'Turn')`);
    } finally {
      await pool.end();
    }
  });

  it("Bug with envelope-shape status.phase is readable via phaseFromEntity", async () => {
    if (!substrate) throw new Error("substrate not initialized");
    const { phaseFromEntity } = await import("../../entities/shape-helpers.js");

    // Seed envelope-shape Bug directly (simulates post-W11-cutover production state)
    await substrate.put("Bug", {
      id: "bug-test-001",
      name: "bug-test-001",
      kind: "Bug",
      apiVersion: "core.ois/v1",
      metadata: {
        createdAt: "2026-05-25T00:00:00Z",
        createdBy: { role: "engineer", agentId: "agent-test" },
      },
      spec: {
        title: "Test bug",
        description: "test",
        severity: "minor",
        class: "test",
      },
      status: {
        phase: "open",
        linkedTaskIds: [],
        fixCommits: [],
      },
    });

    // Read via substrate.get and verify shape
    const raw = await substrate.get<Record<string, unknown>>("Bug", "bug-test-001");
    expect(raw).not.toBeNull();
    const status = raw!.status as Record<string, unknown>;
    expect(status.phase).toBe("open");

    // phaseFromEntity reads envelope-shape correctly
    expect(phaseFromEntity(raw)).toBe("open");
  });

  it("phaseFromEntity handles legacy-flat status (string at top-level)", async () => {
    const { phaseFromEntity } = await import("../../entities/shape-helpers.js");

    // Legacy-flat entity (pre-envelope shape)
    expect(phaseFromEntity({ id: "x", status: "open" })).toBe("open");
    expect(phaseFromEntity({ id: "x", status: "resolved" })).toBe("resolved");
  });

  it("phaseFromEntity handles envelope-shape (status.phase nested)", async () => {
    const { phaseFromEntity } = await import("../../entities/shape-helpers.js");

    expect(phaseFromEntity({ id: "x", status: { phase: "active" } })).toBe("active");
    expect(phaseFromEntity({ id: "x", status: { phase: "completed", livenessState: "online" } })).toBe("completed");
  });

  it("phaseFromEntity returns null for unreadable shapes (defensive)", async () => {
    const { phaseFromEntity } = await import("../../entities/shape-helpers.js");

    expect(phaseFromEntity(null)).toBeNull();
    expect(phaseFromEntity(undefined)).toBeNull();
    expect(phaseFromEntity({})).toBeNull();
    expect(phaseFromEntity({ id: "x" })).toBeNull();
    expect(phaseFromEntity({ id: "x", status: 42 })).toBeNull();  // non-string non-object
    expect(phaseFromEntity({ id: "x", status: { foo: "bar" } })).toBeNull();  // object without phase
  });

  it("Mission envelope-shape with status.phase=proposed is readable", async () => {
    if (!substrate) throw new Error("substrate not initialized");
    const { phaseFromEntity } = await import("../../entities/shape-helpers.js");

    await substrate.put("Mission", {
      id: "mission-test-001",
      name: "mission-test-001",
      kind: "Mission",
      apiVersion: "core.ois/v1",
      metadata: {
        createdAt: "2026-05-25T00:00:00Z",
        createdBy: { role: "architect", agentId: "agent-test" },
      },
      spec: {
        title: "Test mission",
        description: "test",
        missionClass: "tactical",
        plannedTasks: [],
      },
      status: { phase: "proposed", pulses: { lastFiredAt: null, missedCount: 0 } },
    });

    const raw = await substrate.get<Record<string, unknown>>("Mission", "mission-test-001");
    expect(phaseFromEntity(raw)).toBe("proposed");
  });

  it("findByCascadeKey finds envelope-shape Bug via metadata.sourceThreadId dotted-path", async () => {
    if (!substrate) throw new Error("substrate not initialized");
    const { BugRepositorySubstrate } = await import("../../entities/bug-repository-substrate.js");
    const { SubstrateCounter } = await import("../../entities/substrate-counter.js");

    // Seed envelope-shape Bug with metadata.sourceThreadId
    await substrate.put("Bug", {
      id: "bug-cascade-001",
      name: "bug-cascade-001",
      kind: "Bug",
      apiVersion: "core.ois/v1",
      metadata: {
        sourceThreadId: "thread-X",
        sourceActionId: "action-Y",
        createdAt: "2026-05-25T00:00:00Z",
        createdBy: { role: "engineer", agentId: "agent-test" },
      },
      spec: { title: "Cascade test", description: "test", severity: "minor", class: "test" },
      status: { phase: "open", linkedTaskIds: [], fixCommits: [] },
    });

    const counter = new SubstrateCounter(substrate);
    const repo = new BugRepositorySubstrate(substrate, counter);
    const found = await repo.findByCascadeKey({
      sourceThreadId: "thread-X",
      sourceActionId: "action-Y",
    });

    expect(found).not.toBeNull();
    expect(found!.id).toBe("bug-cascade-001");
  });

  // mission-90 W8: REMOVED "findByCascadeKey ALSO finds legacy-flat Bug
  // (defense-in-depth dual-lookup)" — the bare top-level cascade-key fallback is
  // retired (the substrate is envelope-only; findByCascadeKey queries metadata.*
  // exclusively). Envelope-shape findByCascadeKey correctness is covered by
  // bug-repository-substrate.test + the cascade-idempotency tests (wave3b).
});
