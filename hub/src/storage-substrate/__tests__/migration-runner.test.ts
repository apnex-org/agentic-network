/**
 * mission-86 W2 — migration-runner (bug-101 fix) test.
 *
 * Verifies the Hub bootstrap migration-apply: applyMigrations() against a
 * fresh empty postgres creates the substrate schema, and a 2nd run is a
 * clean no-op (idempotency — AG-W2.2.b).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { applyMigrations } from "../migration-runner.js";

describe("migration-runner — bug-101 Hub bootstrap migration-apply", () => {
  let container: StartedPostgreSqlContainer;
  let connStr: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub")
      .withPassword("hub")
      .withDatabase("hub")
      .start();
    connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
  }, 60_000);

  afterAll(async () => {
    await container.stop();
  }, 30_000);

  async function schemaState(): Promise<{ table: boolean; indexes: number }> {
    const client = new pg.Client({ connectionString: connStr });
    await client.connect();
    try {
      const t = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_name = 'entities'`,
      );
      const i = await client.query(
        `SELECT 1 FROM pg_indexes WHERE tablename = 'entities'`,
      );
      return { table: t.rowCount === 1, indexes: i.rowCount ?? 0 };
    } finally {
      await client.end();
    }
  }

  it("bootstraps a fresh empty postgres — entities table + indexes created", async () => {
    expect((await schemaState()).table).toBe(false);

    await applyMigrations(connStr, () => {});

    const state = await schemaState();
    expect(state.table).toBe(true);
    expect(state.indexes).toBeGreaterThan(0);
  });

  it("is idempotent — a 2nd run against the migrated postgres is a clean no-op", async () => {
    await applyMigrations(connStr, () => {}); // re-run; must not throw
    expect((await schemaState()).table).toBe(true);
  });
});
