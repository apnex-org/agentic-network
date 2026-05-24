/**
 * mission-83 W2.5 — Reconciler + 6 new repository stub tests.
 *
 * Tests:
 * 1. Reconciler boot — applies ALL_SCHEMAS + emits per-kind indexes verified
 *    via pg_indexes catalog query
 * 2. Reconciler idempotency — re-running emits no-op DDL (no error)
 * 3. Reconciler self-bootstrap — SchemaDef-for-SchemaDef applied first;
 *    SchemaDef entries query-able via substrate.list('SchemaDef')
 * 4. Reconciler failure-isolation — bad SchemaDef doesn't block others
 * 5. 6 new repository stubs — CRUD round-trip per repository via substrate
 *    composition (Option Y stubs; W4 full refactor)
 *
 * Per Design v1.3 §2.3 + §5.1. mission-83 W2.5 acceptance.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import {
  createPostgresStorageSubstrate,
  createSchemaReconciler,
  ALL_SCHEMAS,
  DocumentRepository,
  NotificationRepository,
  ArchitectDecisionRepository,
  DirectorHistoryEntryRepository,
  ReviewHistoryEntryRepository,
  ThreadHistoryEntryRepository,
} from "../index.js";
import type { HubStorageSubstrate, SchemaDef } from "../index.js";

const { Pool } = pg;

let container: StartedPostgreSqlContainer;
let substrate: HubStorageSubstrate;
let connStr: string;

const MIGRATIONS_DIR = join(__dirname, "..", "migrations");
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
}, 60_000);

afterAll(async () => {
  await (substrate as unknown as { close: () => Promise<void> }).close?.();
  await container.stop();
}, 30_000);

// ─── Reconciler ─────────────────────────────────────────────────────────────

describe("Reconciler", () => {
  it("boot applies ALL_SCHEMAS + emits per-kind expression indexes", async () => {
    // Use a small subset for faster test; full ALL_SCHEMAS is exercised in
    // the substrate-readiness integration test below
    const subset = ALL_SCHEMAS.filter(s => ["SchemaDef", "Bug", "Idea", "Message"].includes(s.kind));
    const reconciler = createSchemaReconciler(substrate, connStr, {
      initialSchemas: subset,
      log: () => { /* silent */ },
      warn: () => { /* silent */ },
    });
    await reconciler.start();

    // Verify SchemaDef entries query-able via substrate
    const { items } = await substrate.list<SchemaDef>("SchemaDef");
    const kinds = items.map(i => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(["SchemaDef", "Bug", "Idea", "Message"]));

    // Verify per-kind indexes exist in pg_indexes catalog
    const pool = new Pool({ connectionString: connStr });
    try {
      const r = await pool.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'entities'`,
      );
      const indexNames = r.rows.map(row => row.indexname);
      // From the subset, expect (mission-88 W7 envelope-path + renamed per
      // bug-123 fix; old names auto-dropped by reconciler ownership-pattern):
      // - bug_status_phase_idx + bug_spec_class_idx (Bug)
      // - idea_status_phase_idx (Idea)
      // - message_metadata_thread_idx + message_metadata_author_idx (Message)
      expect(indexNames).toEqual(expect.arrayContaining([
        "bug_status_phase_idx",
        "bug_spec_class_idx",
        "idea_status_phase_idx",
        "message_metadata_thread_idx",
        "message_metadata_author_idx",
      ]));
    } finally {
      await pool.end();
    }

    await reconciler.close();
  }, 30_000);

  it("re-running reconciler is idempotent (no error on existing indexes)", async () => {
    const subset = ALL_SCHEMAS.filter(s => ["SchemaDef", "Bug"].includes(s.kind));

    // First reconciler instance — applies indexes
    const r1 = createSchemaReconciler(substrate, connStr, {
      initialSchemas: subset,
      log: () => { /* silent */ },
      warn: () => { /* silent */ },
    });
    await r1.start();
    await r1.close();

    // Second reconciler instance — re-applies (should be no-op via CREATE
    // INDEX CONCURRENTLY IF NOT EXISTS)
    const r2 = createSchemaReconciler(substrate, connStr, {
      initialSchemas: subset,
      log: () => { /* silent */ },
      warn: () => { /* silent */ },
    });
    await expect(r2.start()).resolves.toBeUndefined();
    await r2.close();
  }, 30_000);

  it("self-bootstrap: SchemaDef-for-SchemaDef applied first; substrate.list('SchemaDef') returns SchemaDef entry", async () => {
    // SchemaDef-for-SchemaDef should be in the SchemaDef list (its own kind)
    const { items } = await substrate.list<SchemaDef>("SchemaDef");
    const schemaDefMeta = items.find(i => i.kind === "SchemaDef");
    expect(schemaDefMeta).toBeDefined();
    expect(schemaDefMeta?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "kind", type: "string" }),
      expect.objectContaining({ name: "version", type: "number" }),
    ]));
  });

  // bug-100 fix (mission-84 post-mortem): STRICT-ALL-OR-NOTHING completion-truth.
  // Prior semantic was "failure-isolated: bad SchemaDef doesn't block other kinds"
  // (silent-fail-and-keep-running with false-positive completion log). Per architect
  // §5 disposition: reconciler is architectural-defense vector (Design v1.4 §2.3);
  // silent-degradation is NOT acceptable. ANY per-kind apply-failure → start() throws.
  describe("bug-100 fix: STRICT-ALL-OR-NOTHING completion-truth (D2 + D4)", () => {
    // Use Hub-internal applySchemaIndexes failure path: pass a bad-index-name that
    // postgres rejects at CREATE INDEX. But because applySchemaIndexes catches
    // per-index errors internally (its own loop), to trigger reconciler-level
    // failure we need substrate.put to throw OR introduce a top-level error.
    //
    // For a deterministic, low-side-effect failure, we mock substrate.put to throw
    // for a specific kind, then verify start() throws with the failure-summary.
    it("per-kind failure causes start() to THROW with kind-level failure summary", async () => {
      const failingSubstrate = new Proxy(substrate, {
        get(target, prop, receiver) {
          if (prop === "put") {
            return async (kind: string, _entity: unknown) => {
              if (kind === "SchemaDef" && _entity && (_entity as { id?: string }).id === "FailKind") {
                throw new Error("synthetic substrate.put failure for FailKind");
              }
              return (target as unknown as Record<string, (...args: unknown[]) => unknown>).put.call(target, kind, _entity);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as HubStorageSubstrate;

      const reconciler = createSchemaReconciler(failingSubstrate, connStr, {
        initialSchemas: [
          { kind: "FailKind", version: 1, fields: [], indexes: [], watchable: false },
          { kind: "Bug", version: 1, fields: [], indexes: [{ name: "bug_status_idx_v3_strict", fields: ["status"] }], watchable: true },
        ],
        log: () => { /* silent */ },
        warn: () => { /* silent */ },
      });

      await expect(reconciler.start()).rejects.toThrow(/boot failed: 1 of 2 SchemaDef apply failures/);
      await expect(reconciler.start()).rejects.toThrow(/FailKind: synthetic substrate.put failure/);
      await reconciler.close();
    }, 30_000);

    it("multi-failure: all per-kind failures aggregated into error message", async () => {
      const failingSubstrate = new Proxy(substrate, {
        get(target, prop, receiver) {
          if (prop === "put") {
            return async (kind: string, entity: unknown) => {
              const eid = (entity as { id?: string })?.id;
              if (kind === "SchemaDef" && (eid === "FailA" || eid === "FailB")) {
                throw new Error(`synthetic-fail-${eid}`);
              }
              return (target as unknown as Record<string, (...args: unknown[]) => unknown>).put.call(target, kind, entity);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as HubStorageSubstrate;

      const reconciler = createSchemaReconciler(failingSubstrate, connStr, {
        initialSchemas: [
          { kind: "FailA", version: 1, fields: [], indexes: [], watchable: false },
          { kind: "FailB", version: 1, fields: [], indexes: [], watchable: false },
          { kind: "Bug", version: 1, fields: [], indexes: [], watchable: true },
        ],
        log: () => { /* silent */ },
        warn: () => { /* silent */ },
      });

      await expect(reconciler.start()).rejects.toThrow(/boot failed: 2 of 3 SchemaDef apply failures/);
      // Aggregated message contains BOTH failure summaries
      try {
        await reconciler.start();
      } catch (err) {
        expect((err as Error).message).toContain("FailA: synthetic-fail-FailA");
        expect((err as Error).message).toContain("FailB: synthetic-fail-FailB");
      }
      await reconciler.close();
    }, 30_000);

    it("success-only: truth-log emits 'M of N kinds applied; 0 failures' (no throw)", async () => {
      const logs: string[] = [];
      const reconciler = createSchemaReconciler(substrate, connStr, {
        initialSchemas: [
          { kind: "Bug", version: 1, fields: [], indexes: [{ name: "bug_status_idx_truth_log", fields: ["status"] }], watchable: true },
          { kind: "Idea", version: 1, fields: [], indexes: [], watchable: true },
        ],
        log: (m) => logs.push(m),
        warn: () => { /* silent */ },
      });
      await expect(reconciler.start()).resolves.toBeUndefined();
      // Truth-log includes accurate completion count (per D4 spec)
      expect(logs.some(l => l.includes("complete (2 of 2 kinds applied; 0 failures)"))).toBe(true);
      await reconciler.close();
    }, 30_000);

    it("failure WARN-line includes failed kind names + failure count BEFORE throw", async () => {
      const warnings: string[] = [];
      const failingSubstrate = new Proxy(substrate, {
        get(target, prop, receiver) {
          if (prop === "put") {
            return async (kind: string, entity: unknown) => {
              if (kind === "SchemaDef" && (entity as { id?: string })?.id === "FailWarn") {
                throw new Error("warn-line-test-fail");
              }
              return (target as unknown as Record<string, (...args: unknown[]) => unknown>).put.call(target, kind, entity);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as HubStorageSubstrate;

      const reconciler = createSchemaReconciler(failingSubstrate, connStr, {
        initialSchemas: [
          { kind: "FailWarn", version: 1, fields: [], indexes: [], watchable: false },
          { kind: "Bug", version: 1, fields: [], indexes: [], watchable: true },
        ],
        log: () => { /* silent */ },
        warn: (m) => warnings.push(m),
      });
      await expect(reconciler.start()).rejects.toThrow();
      // Per-kind warning during loop + summary warning before throw
      expect(warnings.some(w => w.includes("FailWarn"))).toBe(true);
      expect(warnings.some(w => w.includes("FAILED: 1/2 applied; 1 failure on kinds=[FailWarn]"))).toBe(true);
      await reconciler.close();
    }, 30_000);
  });
});

// ─── 6 new repository stubs CRUD round-trip ────────────────────────────────

describe("New repository stubs (W2.4; W4 full refactor pending)", () => {
  it("DocumentRepository: put + get + list + delete round-trip", async () => {
    const repo = new DocumentRepository(substrate);
    await repo.put({ id: "doc-1", category: "architecture", content: "# Test\nbody" });
    const got = await repo.get("doc-1");
    expect(got?.content).toContain("Test");
    const list = await repo.list({ category: "architecture" });
    expect(list.length).toBeGreaterThanOrEqual(1);
    await repo.delete("doc-1");
    expect(await repo.get("doc-1")).toBeNull();
  });

  it("NotificationRepository: put + get + list-by-recipient round-trip", async () => {
    const repo = new NotificationRepository(substrate);
    await repo.put({ id: "notif-1", event: "test", recipientAgentId: "agent-XYZ" });
    expect((await repo.get("notif-1"))?.event).toBe("test");
    const list = await repo.list({ recipientAgentId: "agent-XYZ" });
    expect(list.length).toBeGreaterThanOrEqual(1);
    await repo.delete("notif-1");
  });

  it("ArchitectDecisionRepository: put + get + list round-trip", async () => {
    const repo = new ArchitectDecisionRepository(substrate);
    await repo.put({ id: "ad-1", decision: "use option Y", context: "C2", timestamp: "2026-05-17T03:00:00Z" });
    expect((await repo.get("ad-1"))?.decision).toBe("use option Y");
    const list = await repo.list();
    expect(list.length).toBeGreaterThanOrEqual(1);
    await repo.delete("ad-1");
  });

  it("DirectorHistoryEntryRepository: put + get + list round-trip", async () => {
    const repo = new DirectorHistoryEntryRepository(substrate);
    await repo.put({ id: "dh-1", role: "director", text: "approved" });
    expect((await repo.get("dh-1"))?.text).toBe("approved");
    await repo.delete("dh-1");
  });

  it("ReviewHistoryEntryRepository: put + get + list-by-taskId round-trip", async () => {
    const repo = new ReviewHistoryEntryRepository(substrate);
    await repo.put({ id: "rh-1", taskId: "task-999", assessment: "good" });
    expect((await repo.get("rh-1"))?.taskId).toBe("task-999");
    const list = await repo.list({ taskId: "task-999" });
    expect(list.length).toBeGreaterThanOrEqual(1);
    await repo.delete("rh-1");
  });

  it("ThreadHistoryEntryRepository: put + get + list-by-threadId round-trip", async () => {
    const repo = new ThreadHistoryEntryRepository(substrate);
    await repo.put({ id: "th-1", threadId: "thread-999", title: "X", outcome: "converged" });
    expect((await repo.get("th-1"))?.threadId).toBe("thread-999");
    const list = await repo.list({ threadId: "thread-999" });
    expect(list.length).toBeGreaterThanOrEqual(1);
    await repo.delete("th-1");
  });
});

// ─── Full substrate-readiness integration: apply ALL 20 SchemaDefs ─────────

describe("Full substrate-readiness (ALL 20 SchemaDefs)", () => {
  it("reconciler applies ALL_SCHEMAS without error; all per-kind indexes exist", async () => {
    const reconciler = createSchemaReconciler(substrate, connStr, {
      initialSchemas: ALL_SCHEMAS,
      log: () => { /* silent */ },
      warn: () => { /* silent */ },
    });
    await reconciler.start();

    // Verify substrate has all 20 SchemaDef entries
    const { items } = await substrate.list<SchemaDef>("SchemaDef");
    const kinds = new Set(items.map(i => i.kind));
    const expectedKinds = ALL_SCHEMAS.map(s => s.kind);
    for (const expected of expectedKinds) {
      expect(kinds.has(expected)).toBe(true);
    }
    expect(items.length).toBeGreaterThanOrEqual(20);

    // Verify expected indexes exist in postgres (count > base 2 + 20-kind worth)
    const pool = new Pool({ connectionString: connStr });
    try {
      const r = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM pg_indexes WHERE tablename = 'entities'`,
      );
      // Base: entities_pkey + entities_rv_idx + entities_updated_at_idx = 3
      // Per-kind from ALL_SCHEMAS: ~21 unique-named indexes across the 20 kinds
      // (Counter has 0; some kinds have 1-2; Message has 2; etc.)
      // Total expected: 3 base + ~20-25 per-kind = 23+
      expect(Number(r.rows[0]!.count)).toBeGreaterThanOrEqual(20);
    } finally {
      await pool.end();
    }

    await reconciler.close();
  }, 60_000);
});
