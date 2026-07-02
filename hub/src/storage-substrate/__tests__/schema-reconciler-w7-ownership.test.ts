/**
 * mission-88 W7 (bug-123 fix) — SchemaReconciler ownership-pattern unit tests.
 *
 * Locks the W7 Q3 refinement: hard-drop owned-but-undeclared indexes
 * matching `indexOwnershipPattern`; leave foreign indexes (not matching
 * pattern) alone.
 *
 * Per W7 Design v1.0 + impl-guide. Uses testcontainer postgres to verify
 * actual pg_indexes catalog state post-reconcile.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { createTestPool } from "./_pg-test-pool.js";
import {
  createPostgresStorageSubstrate,
  createSchemaReconciler,
} from "../index.js";
import type { SchemaDef } from "../types.js";

const TEST_SETUP_TIMEOUT = 90_000;
const TEST_OP_TIMEOUT = 30_000;

const MIGRATIONS_DIR = join(__dirname, "..", "migrations");
const MIGRATION_FILES = [
  "001-entities-table.sql",
  "002-notify-trigger.sql",
  "003-jsonb-size-check.sql",
];

let container: StartedPostgreSqlContainer;
let pool: Pool;
let connStr: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:15-alpine")
    .withUsername("hub")
    .withPassword("hub")
    .withDatabase("hub")
    .start();
  connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;

  pool = createTestPool(connStr, "schema-reconciler-w7-ownership");
  for (const f of MIGRATION_FILES) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf-8");
    await pool.query(sql);
  }
}, TEST_SETUP_TIMEOUT);

afterAll(async () => {
  if (pool) await pool.end();
  if (container) await container.stop();
}, TEST_OP_TIMEOUT);

describe("W7 SchemaReconciler ownership-pattern (bug-123 fix)", () => {
  it("creates declared indexes + drops owned-but-undeclared (envelope-rename pattern)", async () => {
    const substrate = createPostgresStorageSubstrate(connStr);

    // Pre-seed a LEGACY index name (simulating production state pre-W7)
    await pool.query(`CREATE INDEX IF NOT EXISTS w7test_legacy_idx ON entities ((data->>'state')) WHERE kind = 'W7Test'`);

    const schema: SchemaDef = {
      kind: "W7Test",
      version: 1,
      fields: [],
      indexes: [
        { name: "w7test_status_phase_idx", fields: ["status.phase"] },
      ],
      indexOwnershipPattern: "^w7test_",
      watchable: true,
    };

    const reconciler = createSchemaReconciler(substrate, connStr, {
      initialSchemas: [schema],
      log: () => {},
      warn: () => {},
    });
    await reconciler.start();
    await reconciler.close();
    await (substrate as unknown as { close: () => Promise<void> }).close?.();

    const result = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'entities' AND indexname LIKE 'w7test_%'`,
    );
    const names = result.rows.map((r) => r.indexname);

    expect(names).toContain("w7test_status_phase_idx");
    expect(names).not.toContain("w7test_legacy_idx");
  }, TEST_OP_TIMEOUT);

  it("leaves foreign indexes (not matching pattern) alone", async () => {
    const substrate = createPostgresStorageSubstrate(connStr);

    await pool.query(`CREATE INDEX IF NOT EXISTS ops_debug_xyz_idx ON entities ((data->>'foo')) WHERE kind = 'W7TestForeign'`);

    const schema: SchemaDef = {
      kind: "W7TestForeign",
      version: 1,
      fields: [],
      indexes: [
        { name: "w7testforeign_status_phase_idx", fields: ["status.phase"] },
      ],
      indexOwnershipPattern: "^w7testforeign_",
      watchable: true,
    };

    const reconciler = createSchemaReconciler(substrate, connStr, {
      initialSchemas: [schema],
      log: () => {},
      warn: () => {},
    });
    await reconciler.start();
    await reconciler.close();
    await (substrate as unknown as { close: () => Promise<void> }).close?.();

    const result = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'entities'`,
    );
    const names = result.rows.map((r) => r.indexname);

    expect(names).toContain("ops_debug_xyz_idx");
    expect(names).toContain("w7testforeign_status_phase_idx");
  }, TEST_OP_TIMEOUT);

  it("no-op for SchemaDef without indexOwnershipPattern", async () => {
    const substrate = createPostgresStorageSubstrate(connStr);

    await pool.query(`CREATE INDEX IF NOT EXISTS w7testnopattern_legacy_idx ON entities ((data->>'old')) WHERE kind = 'W7TestNoPattern'`);

    const schema: SchemaDef = {
      kind: "W7TestNoPattern",
      version: 1,
      fields: [],
      indexes: [
        { name: "w7testnopattern_new_idx", fields: ["status.phase"] },
      ],
      watchable: true,
    };

    const reconciler = createSchemaReconciler(substrate, connStr, {
      initialSchemas: [schema],
      log: () => {},
      warn: () => {},
    });
    await reconciler.start();
    await reconciler.close();
    await (substrate as unknown as { close: () => Promise<void> }).close?.();

    const result = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'entities' AND indexname LIKE 'w7testnopattern_%'`,
    );
    const names = result.rows.map((r) => r.indexname);

    expect(names).toContain("w7testnopattern_legacy_idx");
    expect(names).toContain("w7testnopattern_new_idx");
  }, TEST_OP_TIMEOUT);

  it("Thread negative-lookahead pattern protects threadhist_* from drop", async () => {
    const substrate = createPostgresStorageSubstrate(connStr);

    await pool.query(`CREATE INDEX IF NOT EXISTS threadhist_protect_test_idx ON entities ((data->>'threadId')) WHERE kind = 'Thread7TestHist'`);

    const threadSchema: SchemaDef = {
      kind: "Thread7Test",
      version: 1,
      fields: [],
      indexes: [
        { name: "thread7test_status_phase_idx", fields: ["status.phase"] },
      ],
      indexOwnershipPattern: "^thread_(?!hist_)",
      watchable: true,
    };

    const reconciler = createSchemaReconciler(substrate, connStr, {
      initialSchemas: [threadSchema],
      log: () => {},
      warn: () => {},
    });
    await reconciler.start();
    await reconciler.close();
    await (substrate as unknown as { close: () => Promise<void> }).close?.();

    const result = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE indexname = 'threadhist_protect_test_idx'`,
    );
    expect(result.rows).toHaveLength(1);  // negative-lookahead protected it
  }, TEST_OP_TIMEOUT);

  it("handles invalid regex pattern gracefully (warns + skips drop pass)", async () => {
    const substrate = createPostgresStorageSubstrate(connStr);

    let warnedAboutPattern = false;
    const schema: SchemaDef = {
      kind: "W7TestBadRegex",
      version: 1,
      fields: [],
      indexes: [
        { name: "w7testbadregex_idx", fields: ["status.phase"] },
      ],
      indexOwnershipPattern: "^w7testbadregex_(?<bad",
      watchable: true,
    };

    const reconciler = createSchemaReconciler(substrate, connStr, {
      initialSchemas: [schema],
      log: () => {},
      warn: (msg) => {
        if (msg.includes("indexOwnershipPattern")) warnedAboutPattern = true;
      },
    });
    await reconciler.start();
    await reconciler.close();
    await (substrate as unknown as { close: () => Promise<void> }).close?.();

    expect(warnedAboutPattern).toBe(true);

    const result = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE indexname = 'w7testbadregex_idx'`,
    );
    expect(result.rows).toHaveLength(1);
  }, TEST_OP_TIMEOUT);
});
