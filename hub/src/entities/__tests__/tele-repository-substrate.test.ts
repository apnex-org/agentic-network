/**
 * mission-83 W4.x.9 — TeleRepositorySubstrate integration tests.
 *
 * 2 tests covering Option Y composition + supersede/retire FSM:
 *   1. defineTele + getTele + listTele round-trip via substrate-API + SubstrateCounter
 *      ID allocation (tele-N shape)
 *   2. supersedeTele + retireTele CAS via Design v1.4 getWithRevision + putIfMatch;
 *      successor-existence pre-check; retired-tele rejection of supersede
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
import { TeleRepositorySubstrate } from "../tele-repository-substrate.js";
import { SubstrateCounter } from "../substrate-counter.js";

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

  const subset = ALL_SCHEMAS.filter(s => ["SchemaDef", "Tele"].includes(s.kind));
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
    await pool.query(`DELETE FROM entities WHERE kind IN ($1, $2)`, ["Tele", "Counter"]);
  } finally {
    await pool.end();
  }
});

describe("TeleRepositorySubstrate (W4.x.9 Option Y sibling-pattern)", () => {
  it("defineTele + getTele + listTele round-trip via substrate-API + SubstrateCounter", async () => {
    const counter = new SubstrateCounter(substrate);
    const repo = new TeleRepositorySubstrate(substrate, counter);

    const t1 = await repo.defineTele("Tele-1", "First tele", "criterion 1");
    expect(t1.id).toBe("tele-1");
    expect(t1.name).toBe("Tele-1");
    expect(t1.status).toBe("active");
    expect(t1.successCriteria).toBe("criterion 1");

    const t2 = await repo.defineTele("Tele-2", "Second tele", "criterion 2");
    expect(t2.id).toBe("tele-2");

    // getTele round-trip + normalizeTele
    const fetched = await repo.getTele("tele-1");
    expect(fetched?.name).toBe("Tele-1");
    expect(fetched?.status).toBe("active");

    // listTele
    const all = await repo.listTele();
    expect(all).toHaveLength(2);
    expect(all.map(t => t.id).sort()).toEqual(["tele-1", "tele-2"]);

    // getTele on absent
    expect(await repo.getTele("tele-99")).toBeNull();
  }, 60_000);

  it("supersedeTele + retireTele CAS via Design v1.4; successor-existence + retired-rejection", async () => {
    const counter = new SubstrateCounter(substrate);
    const repo = new TeleRepositorySubstrate(substrate, counter);

    const t1 = await repo.defineTele("Original", "v1 description", "v1 criterion");
    const t2 = await repo.defineTele("Successor", "v2 description", "v2 criterion");

    // supersedeTele
    const superseded = await repo.supersedeTele(t1.id, t2.id);
    expect(superseded.status).toBe("superseded");
    expect(superseded.supersededBy).toBe(t2.id);

    // Verify persistence
    const fetched = await repo.getTele(t1.id);
    expect(fetched?.status).toBe("superseded");
    expect(fetched?.supersededBy).toBe(t2.id);

    // supersedeTele on absent successor throws
    await expect(repo.supersedeTele(t2.id, "tele-99")).rejects.toThrow(/Successor tele not found/);

    // supersedeTele on absent source throws
    await expect(repo.supersedeTele("tele-99", t1.id)).rejects.toThrow(/Tele not found/);

    // retireTele on t2
    const retired = await repo.retireTele(t2.id);
    expect(retired.status).toBe("retired");
    expect(retired.retiredAt).toBeDefined();

    // supersedeTele on retired throws
    const t3 = await repo.defineTele("New tele", "x", "y");
    await expect(repo.supersedeTele(t2.id, t3.id)).rejects.toThrow(/retired.*cannot be superseded/);

    // retireTele idempotent (no-op transform; CAS still succeeds with new retiredAt)
    const reRetired = await repo.retireTele(t2.id);
    expect(reRetired.status).toBe("retired");
  }, 60_000);
});
