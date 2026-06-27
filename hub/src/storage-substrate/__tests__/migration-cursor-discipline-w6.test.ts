/**
 * mission-90 W6-prep — re-migration cursor discipline (Design §3.2 step-3).
 *
 * Validates the dirty-cursor-trap mitigation the cutover REQUIRES (preflight c2,
 * PROVEN lexical checkpoint-skip): the runner resumes from `lastMigratedId` and
 * skips any row whose id is lexically `<=` it (migration-runner.ts:107). A post-
 * cutover row whose id sorts BEFORE a stale checkpoint (e.g. "bug-137" <= "bug-99"
 * string-ordered) is permanently skipped — silently under-migrated.
 *
 * Mitigation (the W6 tooling built here): `runner.resetAllCheckpoints()` clears
 * EVERY registered kind's cursor (single-authority over registeredKinds(), exposed
 * via the CLI `--reset-checkpoints`), run BEFORE a loop-until-migrated=0 re-migrate.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { createTestPool } from "./_pg-test-pool.js";
import { createPostgresStorageSubstrate, ALL_SCHEMAS, type HubStorageSubstrate } from "../index.js";
import { MigrationRunner } from "../migrations/v2-envelope/migration-runner.js";
import { MigrationCursorRepository } from "../../entities/migration-cursor-repository.js";
import { isEnvelopeShape } from "../migrations/v2-envelope/shared/envelope.js";
import { createBugMigrationModule } from "../migrations/v2-envelope/kinds/Bug.js";
import { createIdeaMigrationModule } from "../migrations/v2-envelope/kinds/Idea.js";

const SETUP_TIMEOUT = 90_000;
const OP_TIMEOUT = 60_000;
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");
const MIGRATION_FILES = ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"];
const schemaFor = (kind: string) => ALL_SCHEMAS.find((s) => s.kind === kind)!;

describe("W6-prep re-migration cursor discipline (§3.2 step-3 dirty-cursor-trap mitigation)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let substrate: HubStorageSubstrate; // NO write-encoder wired → seeded bare rows STAY bare (so there's something to migrate)
  let runner: MigrationRunner;
  let cursors: MigrationCursorRepository;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub").withPassword("hub").withDatabase("hub").start();
    const connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = createTestPool(connStr, "migration-cursor-discipline-w6");
    for (const f of MIGRATION_FILES) await pool.query(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
    substrate = createPostgresStorageSubstrate(connStr);
    runner = new MigrationRunner(substrate);
    runner.register(createBugMigrationModule(schemaFor("Bug")));
    runner.register(createIdeaMigrationModule(schemaFor("Idea")));
    cursors = new MigrationCursorRepository(substrate);
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    if (substrate) await substrate.close();
    if (pool) await pool.end();
    if (container) await container.stop();
  }, OP_TIMEOUT);

  it("resetAllCheckpoints() clears EVERY registered kind's cursor (single-authority over registeredKinds)", async () => {
    await cursors.advanceCheckpoint("Bug", "bug-50", "seed");
    await cursors.advanceCheckpoint("Idea", "idea-50", "seed");
    expect(await cursors.getCheckpoint("Bug")).not.toBeNull();
    expect(await cursors.getCheckpoint("Idea")).not.toBeNull();

    const reset = await runner.resetAllCheckpoints();
    expect(reset.sort()).toEqual(["Bug", "Idea"]); // == registeredKinds(), no hand-list
    expect(await cursors.getCheckpoint("Bug")).toBeNull();
    expect(await cursors.getCheckpoint("Idea")).toBeNull();
  }, OP_TIMEOUT);

  it("dirty-cursor TRAP reproduced + resetAllCheckpoints + loop-until-0 mitigation converges", async () => {
    // A bare Bug whose id sorts lexically BEFORE a stale checkpoint.
    await substrate.put("Bug", { id: "bug-137", title: "t", severity: "minor", class: "c", status: "open" });
    expect("bug-137" <= "bug-99").toBe(true); // the lexical trap condition (string order)

    // Stale/dirty checkpoint at "bug-99" → the runner skips "bug-137" (id <= resumeFrom).
    await cursors.advanceCheckpoint("Bug", "bug-99", "dirty");
    const trapped = await runner.runKind("Bug", { waveId: "w6prep" });
    expect(trapped.rowsMigrated, "TRAP: lexically-smaller id silently skipped on dirty cursor").toBe(0);
    expect(isEnvelopeShape(await substrate.get("Bug", "bug-137")), "still bare — under-migrated").toBe(false);

    // MITIGATION: resetAllCheckpoints (clears the dirty cursor) THEN loop-until-migrated=0.
    await runner.resetAllCheckpoints();
    let totalMigrated = 0;
    let passes = 0;
    let migratedThisPass: number;
    do {
      const r = await runner.runKind("Bug", { waveId: "w6prep" });
      migratedThisPass = r.rowsMigrated;
      totalMigrated += migratedThisPass;
      passes++;
      expect(passes, "loop must converge, not run away").toBeLessThanOrEqual(5);
    } while (migratedThisPass > 0);

    expect(totalMigrated, "the trapped row migrated after reset").toBe(1);
    expect(isEnvelopeShape(await substrate.get("Bug", "bug-137")), "now envelope — converged").toBe(true);
    expect(passes, "loop terminates at migrated=0 (1 productive pass + 1 zero pass)").toBe(2);
  }, OP_TIMEOUT);
});
