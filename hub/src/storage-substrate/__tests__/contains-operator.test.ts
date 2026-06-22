/**
 * contains-operator.test.ts — C1-R2 sub-PR-1, the general `$contains` JSONB
 * array-membership operator (the inverse of $in: "the stored array CONTAINS this
 * scalar", `data#>'{path}' @> to_jsonb($v)`).
 *
 * Covers the substrate surfaces on a FAITHFUL real-Postgres harness (testcontainers,
 * per cal-79/82) + the in-process memory-substrate parity:
 *   - postgres SQL translator: value-round-trip (match returned, decoy excluded);
 *   - GIN index DDL (IndexDef.type:"gin") actually CREATEs `USING gin` via the reconciler;
 *   - memory-substrate matchesFilter parity (the WATCH/list surface).
 * The WorkItem roleEligibility round-trip lands in the R4a oracle at sub-PR-2 (when
 * the kind exists); this proves the operator itself, standalone + governor-ready.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { createPostgresStorageSubstrate, createSchemaReconciler } from "../index.js";
import { createMemoryStorageSubstrate } from "../memory-substrate.js";
import type { SchemaDef } from "../types.js";

const TEST_SETUP_TIMEOUT = 90_000;
const TEST_OP_TIMEOUT = 120_000;
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");
const MIGRATION_FILES = ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"];

describe("C1-R2 $contains operator (real-pg)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let substrate: ReturnType<typeof createPostgresStorageSubstrate>;
  let connStr: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub").withPassword("hub").withDatabase("hub").start();
    connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = new Pool({ connectionString: connStr });
    for (const f of MIGRATION_FILES) await pool.query(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
    substrate = createPostgresStorageSubstrate(connStr);
  }, TEST_SETUP_TIMEOUT);

  afterAll(async () => {
    if (substrate) await substrate.close();
    if (pool) await pool.end();
    if (container) await container.stop();
  }, TEST_OP_TIMEOUT);

  it("value-round-trips: a row whose array CONTAINS the scalar is returned; a decoy is excluded", async () => {
    await substrate.put("TArr", { id: "tarr-match", tags: ["engineer", "verifier"] });
    await substrate.put("TArr", { id: "tarr-decoy", tags: ["architect"] });
    await substrate.put("TArr", { id: "tarr-empty", tags: [] });

    const { items } = await substrate.list<{ id: string }>("TArr", { filter: { tags: { $contains: "engineer" } }, limit: 100 });
    const ids = new Set(items.map((r) => r.id));
    expect(ids.has("tarr-match")).toBe(true);
    expect(ids.has("tarr-decoy")).toBe(false);
    expect(ids.has("tarr-empty")).toBe(false);
  }, TEST_OP_TIMEOUT);

  it("matches on a nested (dotted) array path", async () => {
    await substrate.put("TArrN", { id: "n-match", spec: { roles: ["engineer"] } });
    await substrate.put("TArrN", { id: "n-decoy", spec: { roles: ["architect"] } });
    const { items } = await substrate.list<{ id: string }>("TArrN", { filter: { "spec.roles": { $contains: "engineer" } }, limit: 100 });
    const ids = new Set(items.map((r) => r.id));
    expect(ids.has("n-match")).toBe(true);
    expect(ids.has("n-decoy")).toBe(false);
  }, TEST_OP_TIMEOUT);

  it("GIN IndexDef.type:'gin' CREATEs a real USING gin index via the reconciler", async () => {
    const ginKind: SchemaDef = {
      kind: "TGin", version: 1, fields: [], watchable: false,
      indexes: [{ name: "tgin_roles_gin_idx", fields: ["spec.roles"], type: "gin" }],
      indexOwnershipPattern: "^tgin_",
      renameMap: {},
    } as unknown as SchemaDef;
    const reconciler = createSchemaReconciler(substrate, connStr, { initialSchemas: [ginKind] });
    try {
      await reconciler.start();
      const { rows } = await pool.query(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'tgin_roles_gin_idx'`,
      );
      expect(rows.length).toBe(1);
      expect(String(rows[0].indexdef).toLowerCase()).toContain("using gin");
    } finally {
      await reconciler.close();
    }
  }, TEST_OP_TIMEOUT);
});

describe("C1-R2 $contains operator (memory-substrate parity — the watch/list surface)", () => {
  it("memory matchesFilter array-membership mirrors postgres (match + decoy)", async () => {
    const mem = createMemoryStorageSubstrate({ rawWrites: true });
    await mem.put("TArr", { id: "m-match", tags: ["engineer"] });
    await mem.put("TArr", { id: "m-decoy", tags: ["architect"] });
    const { items } = await mem.list<{ id: string }>("TArr", { filter: { tags: { $contains: "engineer" } }, limit: 100 });
    const ids = new Set(items.map((r) => r.id));
    expect(ids.has("m-match")).toBe(true);
    expect(ids.has("m-decoy")).toBe(false);
  });
});
