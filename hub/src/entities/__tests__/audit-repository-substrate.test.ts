/**
 * mission-83 W4.x.2 — AuditRepositorySubstrate integration tests.
 *
 * 2 tests covering Option Y composition pattern:
 *   1. logEntry + listEntries round-trip via substrate-API + SubstrateCounter
 *      ID allocation (`audit-${N}` shape per mission-49 thread-304 Point A);
 *      counter-sort desc ordering preserved (newest-first)
 *   2. listEntries(actor) filter via substrate audit_actor_idx (Audit SchemaDef
 *      v2 shape-correction; architect-blind fix) + limit slicing
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
import { AuditRepositorySubstrate } from "../audit-repository-substrate.js";
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

  const subset = ALL_SCHEMAS.filter(s => ["SchemaDef", "Audit"].includes(s.kind));
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
    await pool.query(`DELETE FROM entities WHERE kind IN ($1, $2)`, ["Audit", "Counter"]);
  } finally {
    await pool.end();
  }
});

describe("AuditRepositorySubstrate (W4.x.2 Option Y sibling-pattern)", () => {
  it("logEntry + listEntries round-trip via substrate-API + counter-sort desc ordering", async () => {
    const counter = new SubstrateCounter(substrate);
    const repo = new AuditRepositorySubstrate(substrate, counter);

    // Log 3 entries with distinct actor/action/details
    const entry1 = await repo.logEntry("architect", "design_v1.0_ratified", "Design ratified after round-1+round-2 audit", "thread-563");
    expect(entry1.id).toBe("audit-1");
    expect(entry1.actor).toBe("architect");
    expect(entry1.action).toBe("design_v1.0_ratified");
    expect(entry1.relatedEntity).toBe("thread-563");
    expect(entry1.timestamp).toBeDefined();

    const entry2 = await repo.logEntry("engineer", "wave_shipped", "W4.x.1 AgentRepositorySubstrate at 125c4f9");
    expect(entry2.id).toBe("audit-2");  // counter advanced
    expect(entry2.relatedEntity).toBeNull();  // optional param omitted

    const entry3 = await repo.logEntry("hub", "thread_cascade_fired", "thread-570 close_no_action committed", "thread-570");
    expect(entry3.id).toBe("audit-3");

    // listEntries (no filter) — counter-sort desc: audit-3 → audit-2 → audit-1
    const all = await repo.listEntries();
    expect(all).toHaveLength(3);
    expect(all.map(e => e.id)).toEqual(["audit-3", "audit-2", "audit-1"]);
    expect(all[0].action).toBe("thread_cascade_fired");

    // Limit slicing
    const top2 = await repo.listEntries(2);
    expect(top2).toHaveLength(2);
    expect(top2.map(e => e.id)).toEqual(["audit-3", "audit-2"]);
  }, 60_000);

  it("listEntries(actor) filter via substrate audit_actor_idx (Audit SchemaDef v2 shape-correction)", async () => {
    const counter = new SubstrateCounter(substrate);
    const repo = new AuditRepositorySubstrate(substrate, counter);

    // 5 entries across 3 actors
    await repo.logEntry("architect", "audit_round_1", "round-1 findings");
    await repo.logEntry("engineer", "ship_commit", "W1.3 commit");
    await repo.logEntry("hub", "sweeper_run", "PulseSweeper scan");
    await repo.logEntry("engineer", "ship_commit", "W2.1 commit");
    await repo.logEntry("architect", "audit_round_2", "round-2 verification");

    // Filter by actor — substrate-side filter (audit_actor_idx hot-path)
    const architectEntries = await repo.listEntries(50, "architect");
    expect(architectEntries).toHaveLength(2);
    expect(architectEntries.map(e => e.id)).toEqual(["audit-5", "audit-1"]);  // counter-sort desc
    expect(architectEntries[0].action).toBe("audit_round_2");

    const engineerEntries = await repo.listEntries(50, "engineer");
    expect(engineerEntries).toHaveLength(2);
    expect(engineerEntries.map(e => e.id)).toEqual(["audit-4", "audit-2"]);

    const hubEntries = await repo.listEntries(50, "hub");
    expect(hubEntries).toHaveLength(1);
    expect(hubEntries[0].action).toBe("sweeper_run");

    // limit + actor combo
    const oneArchitect = await repo.listEntries(1, "architect");
    expect(oneArchitect).toHaveLength(1);
    expect(oneArchitect[0].id).toBe("audit-5");
  }, 60_000);
});
