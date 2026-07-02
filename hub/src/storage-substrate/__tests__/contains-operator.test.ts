/**
 * contains-operator.test.ts — C1-R2 sub-PR-1, the general `$contains` JSONB
 * array-membership operator + the audit-4054 cross-surface parity hardening.
 *
 * Steve's parity matrix (audit-4054): SQL-list × PG-watch × memory over
 * {empty array, absent field, string/number/bool TYPING, match/decoy, nested} +
 * the fail-loud unknown-operator guard + a GIN @> EXPLAIN-planner smoke. The
 * policy-helper (applyQueryFilter) surface is in policy/__tests__/list-filters-contains.test.ts.
 *
 * $contains = "the stored array CONTAINS this scalar" (the inverse of $in), TYPED
 * (SameValueZero — [3] does NOT match "3", ['true'] does NOT match true), matching
 * the typed JSONB `@>`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { createTestPool } from "./_pg-test-pool.js";
import { createPostgresStorageSubstrate, createSchemaReconciler } from "../index.js";
import { createMemoryStorageSubstrate } from "../memory-substrate.js";
import type { SchemaDef } from "../types.js";

const TEST_SETUP_TIMEOUT = 90_000;
const TEST_OP_TIMEOUT = 120_000;
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");
const MIGRATION_FILES = ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"];

describe("C1-R2 $contains operator (real-pg list + watch-replay)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let substrate: ReturnType<typeof createPostgresStorageSubstrate>;
  let connStr: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub").withPassword("hub").withDatabase("hub").start();
    connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = createTestPool(connStr, "contains-operator");
    for (const f of MIGRATION_FILES) await pool.query(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
    substrate = createPostgresStorageSubstrate(connStr);
  }, TEST_SETUP_TIMEOUT);

  afterAll(async () => {
    if (substrate) await substrate.close();
    if (pool) await pool.end();
    if (container) await container.stop();
  }, TEST_OP_TIMEOUT);

  async function listIds(kind: string, filter: Record<string, unknown>): Promise<Set<string>> {
    const { items } = await substrate.list<{ id: string }>(kind, { filter: filter as never, limit: 100 });
    return new Set(items.map((r) => r.id));
  }

  it("SQL-list: string match/decoy + empty-array + absent-field", async () => {
    await substrate.put("CStr", { id: "s-match", tags: ["engineer", "verifier"] });
    await substrate.put("CStr", { id: "s-decoy", tags: ["architect"] });
    await substrate.put("CStr", { id: "s-empty", tags: [] });
    await substrate.put("CStr", { id: "s-absent" }); // no tags field
    const ids = await listIds("CStr", { tags: { $contains: "engineer" } });
    expect(ids.has("s-match")).toBe(true);
    expect(ids.has("s-decoy")).toBe(false);
    expect(ids.has("s-empty")).toBe(false);
    expect(ids.has("s-absent")).toBe(false);
  }, TEST_OP_TIMEOUT);

  it("SQL-list: TYPED — [3] matches 3 but NOT \"3\"; [true] matches true but NOT \"true\"", async () => {
    await substrate.put("CNum", { id: "num", tags: [3] });
    await substrate.put("CNum", { id: "bool", tags: [true] });
    expect((await listIds("CNum", { tags: { $contains: 3 } })).has("num")).toBe(true);
    expect((await listIds("CNum", { tags: { $contains: "3" } })).has("num")).toBe(false);
    expect((await listIds("CNum", { tags: { $contains: true } })).has("bool")).toBe(true);
    expect((await listIds("CNum", { tags: { $contains: "true" } })).has("bool")).toBe(false);
  }, TEST_OP_TIMEOUT);

  it("SQL-list: nested dotted array path", async () => {
    await substrate.put("CNest", { id: "n-match", spec: { roles: ["engineer"] } });
    await substrate.put("CNest", { id: "n-decoy", spec: { roles: ["architect"] } });
    const ids = await listIds("CNest", { "spec.roles": { $contains: "engineer" } });
    expect(ids.has("n-match")).toBe(true);
    expect(ids.has("n-decoy")).toBe(false);
  }, TEST_OP_TIMEOUT);

  it("PG-WATCH (replay): $contains filters the replay stream — match emitted, decoy NOT (audit-4054 #1)", async () => {
    const { snapshotRevision: snap } = await substrate.list("CSnap", { limit: 1 });
    await substrate.put("CWatch", { id: "w-match", tags: ["engineer"] });
    await substrate.put("CWatch", { id: "w-decoy", tags: ["architect"] });
    const ac = new AbortController();
    const seen: string[] = [];
    // Replay from the snapshot with a $contains filter; the postgres matchesFilter
    // MUST exclude the decoy (the bug was: no $contains branch -> fell through -> emitted it).
    const timer = setTimeout(() => ac.abort(), 8000);
    try {
      for await (const ev of substrate.watch<{ id: string }>("CWatch", { sinceRevision: snap, filter: { tags: { $contains: "engineer" } } as never, signal: ac.signal })) {
        if (ev.op === "put" && ev.entity) seen.push(ev.entity.id);
        if (seen.includes("w-match")) break;
      }
    } catch { /* abort */ } finally { clearTimeout(timer); ac.abort(); }
    expect(seen).toContain("w-match");
    expect(seen).not.toContain("w-decoy");
  }, TEST_OP_TIMEOUT);

  it("FAIL-LOUD: an unknown operator throws on the watch-replay path (no silent-true)", async () => {
    const { snapshotRevision: snap } = await substrate.list("CSnap", { limit: 1 });
    await substrate.put("CGuard", { id: "g1", tags: ["x"] });
    const ac = new AbortController();
    await expect((async () => {
      for await (const _ev of substrate.watch("CGuard", { sinceRevision: snap, filter: { tags: { $bogus: "x" } } as never, signal: ac.signal })) { /* should throw before yielding */ }
    })()).rejects.toThrow(/unknown operator/i);
    ac.abort();
  }, TEST_OP_TIMEOUT);

  it("GIN: IndexDef.type:'gin' CREATEs USING gin + the @> planner can use it", async () => {
    const ginKind: SchemaDef = {
      kind: "CGin", version: 1, fields: [], watchable: false,
      indexes: [{ name: "cgin_roles_gin_idx", fields: ["spec.roles"], type: "gin" }],
      indexOwnershipPattern: "^cgin_", renameMap: {},
    } as unknown as SchemaDef;
    const reconciler = createSchemaReconciler(substrate, connStr, { initialSchemas: [ginKind] });
    try {
      await reconciler.start();
      const { rows } = await pool.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'cgin_roles_gin_idx'`);
      expect(rows.length).toBe(1);
      expect(String(rows[0].indexdef).toLowerCase()).toContain("using gin");
      // Planner-USAGE smoke (not just DDL existence): at VOLUME the GIN's @>
      // selectivity beats the pkey-on-kind scan (which would return every CGin row
      // then heap-filter @>). Bulk-load 2000 rows where 'engineer' is rare (5),
      // ANALYZE, then the planner picks the GIN with NO forcing. (On a tiny table
      // the pkey-on-kind bitmap is correctly cheaper — that's postgres being right,
      // not a defect; this proves the index genuinely SERVES @> at realistic scale.)
      await pool.query(
        `INSERT INTO entities (kind, id, data)
         SELECT 'CGin', 'bulk-' || g,
           jsonb_build_object('id', 'bulk-' || g, 'spec', jsonb_build_object('roles',
             jsonb_build_array(CASE WHEN g <= 5 THEN 'engineer' ELSE 'role' || (g % 50)::text END)))
         FROM generate_series(1, 2000) g
         ON CONFLICT (kind, id) DO NOTHING`,
      );
      await pool.query(`ANALYZE entities`);
      const plan = await pool.query(
        `EXPLAIN SELECT data FROM entities WHERE kind = 'CGin' AND (data#>'{spec,roles}') @> '"engineer"'::jsonb`,
      );
      const planText = plan.rows.map((r) => r["QUERY PLAN"]).join("\n").toLowerCase();
      expect(planText).toContain("cgin_roles_gin_idx");
    } finally {
      await reconciler.close();
    }
  }, TEST_OP_TIMEOUT);
});

describe("C1-R2 $contains operator (memory-substrate parity)", () => {
  function mem() { return createMemoryStorageSubstrate({ rawWrites: true }); }
  async function listIds(s: ReturnType<typeof mem>, kind: string, filter: Record<string, unknown>): Promise<Set<string>> {
    const { items } = await s.list<{ id: string }>(kind, { filter: filter as never, limit: 100 });
    return new Set(items.map((r) => r.id));
  }

  it("string match/decoy + empty + absent (parity with SQL)", async () => {
    const s = mem();
    await s.put("M", { id: "m-match", tags: ["engineer"] });
    await s.put("M", { id: "m-decoy", tags: ["architect"] });
    await s.put("M", { id: "m-empty", tags: [] });
    await s.put("M", { id: "m-absent" });
    const ids = await listIds(s, "M", { tags: { $contains: "engineer" } });
    expect(ids.has("m-match")).toBe(true);
    expect(ids.has("m-decoy")).toBe(false);
    expect(ids.has("m-empty")).toBe(false);
    expect(ids.has("m-absent")).toBe(false);
  });

  it("TYPED — [3] matches 3 not \"3\"; [true] matches true not \"true\" (audit-4054 #3)", async () => {
    const s = mem();
    await s.put("M", { id: "num", tags: [3] });
    await s.put("M", { id: "bool", tags: [true] });
    expect((await listIds(s, "M", { tags: { $contains: 3 } })).has("num")).toBe(true);
    expect((await listIds(s, "M", { tags: { $contains: "3" } })).has("num")).toBe(false);
    expect((await listIds(s, "M", { tags: { $contains: true } })).has("bool")).toBe(true);
    expect((await listIds(s, "M", { tags: { $contains: "true" } })).has("bool")).toBe(false);
  });

  it("FAIL-LOUD: an unknown operator throws (no silent-true)", async () => {
    const s = mem();
    await s.put("M", { id: "g1", tags: ["x"] });
    await expect(listIds(s, "M", { tags: { $bogus: "x" } })).rejects.toThrow(/unknown operator/i);
  });

  it("FAIL-CLOSED: a forbidden-only op ($regex) matches NOTHING — no throw, no row-leak (audit-4070)", async () => {
    // The memory matchesFilter mirrors the policy matchField fail-CLOSED contract:
    // assertKnownFilterOps does NOT throw for a FORBIDDEN op (that's the Zod-layer
    // rejection), but the matcher must then match-NOTHING — never fall through to the
    // `return true` tail that leaks every row (the prior fail-OPEN hole).
    const s = mem();
    await s.put("M", { id: "f1", tags: ["x"] });
    await s.put("M", { id: "f2", tags: ["y"] });
    const ids = await listIds(s, "M", { tags: { $regex: "x" } });
    expect(ids.size).toBe(0); // not {f1, f2}
  });
});
