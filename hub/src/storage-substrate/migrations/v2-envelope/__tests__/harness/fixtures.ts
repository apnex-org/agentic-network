/**
 * mission-88 W0 — test harness fixtures for v2-envelope migration tests.
 *
 * Per thread-639 Q4 disposition: shared testcontainer + substrate fixtures
 * consumed by envelope.test.ts + migration-cursor.test.ts + wire-flow.test.ts.
 * Pattern mirrors hub/src/entities/__tests__/substrate-counter.race.test.ts
 * (testcontainers + Pool + manual migration apply + substrate.close).
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { createPostgresStorageSubstrate, type HubStorageSubstrate } from "../../../../index.js";

const { Pool } = pg;

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "..", "migrations");

/** Apply all *.sql files in the migrations directory, sorted by filename. */
async function applyAllMigrations(connStr: string): Promise<void> {
  const pool = new Pool({ connectionString: connStr });
  try {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith(".sql"))
      .sort();
    for (const f of files) {
      await pool.query(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
    }
  } finally {
    await pool.end();
  }
}

export interface SubstrateFixture {
  container: StartedPostgreSqlContainer;
  substrate: HubStorageSubstrate;
  connStr: string;
}

/** Spin up a fresh postgres container + substrate + apply migrations. */
export async function setupSubstrate(): Promise<SubstrateFixture> {
  const container = await new PostgreSqlContainer("postgres:15-alpine")
    .withUsername("hub")
    .withPassword("hub")
    .withDatabase("hub")
    .start();
  const connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
  await applyAllMigrations(connStr);
  const substrate = createPostgresStorageSubstrate(connStr);
  return { container, substrate, connStr };
}

/** Teardown: close substrate connection pool + stop container. */
export async function teardownSubstrate(fixture: SubstrateFixture): Promise<void> {
  await fixture.substrate.close();
  await fixture.container.stop();
}

/** Clean all rows of given kind from the substrate (between tests). */
export async function cleanKind(connStr: string, kind: string): Promise<void> {
  const pool = new Pool({ connectionString: connStr });
  try {
    await pool.query(`DELETE FROM entities WHERE kind = $1`, [kind]);
  } finally {
    await pool.end();
  }
}
