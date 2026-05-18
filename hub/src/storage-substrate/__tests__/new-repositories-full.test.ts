/**
 * mission-83 W4.x.12-17 — 6 new-repository full-impl integration tests.
 *
 * Per architect-dispatch (thread-569 round 1): 6 new repositories get full
 * substantive per-entity logic via substrate composition. The W2.4 stubs at
 * hub/src/storage-substrate/new-repositories.ts already implement substantive
 * CRUD via substrate composition — these tests verify they're production-ready
 * + flag remaining W5 cutover-side integration work.
 *
 * Tests per kind (6 kinds × 1 round-trip test = 6 tests):
 *   1. DocumentRepository — put/get/list/delete with category filter
 *   2. NotificationRepository — put/get/list with recipientAgentId filter
 *      (hub-networking.ts direct-write-path absorption deferred to W5 cutover)
 *   3. ArchitectDecisionRepository — put/get/list
 *   4. DirectorHistoryEntryRepository — put/get/list (append-only history pattern)
 *   5. ReviewHistoryEntryRepository — put/get/list with taskId filter
 *   6. ThreadHistoryEntryRepository — put/get/list with threadId filter
 *
 * W4.x.12-17 COMPLETES W4.x sweep. Next milestone: W4.x complete surface on
 * thread-569 (W5 cutover dispatch ready-fire per architect's W5-pre-stage at
 * commit 6649f66).
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
  DocumentRepository,
  NotificationRepository,
  ArchitectDecisionRepository,
  DirectorHistoryEntryRepository,
  ReviewHistoryEntryRepository,
  ThreadHistoryEntryRepository,
  type HubStorageSubstrate,
  type SchemaReconciler,
} from "../index.js";

const { Pool } = pg;

let container: StartedPostgreSqlContainer;
let substrate: HubStorageSubstrate;
let reconciler: SchemaReconciler;
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

  // Apply ALL new-repo SchemaDefs via reconciler
  const subset = ALL_SCHEMAS.filter(s =>
    ["SchemaDef", "Document", "Notification", "ArchitectDecision",
     "DirectorHistoryEntry", "ReviewHistoryEntry", "ThreadHistoryEntry"].includes(s.kind)
  );
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
    await pool.query(`DELETE FROM entities WHERE kind IN ($1, $2, $3, $4, $5, $6)`, [
      "Document", "Notification", "ArchitectDecision",
      "DirectorHistoryEntry", "ReviewHistoryEntry", "ThreadHistoryEntry",
    ]);
  } finally {
    await pool.end();
  }
});

describe("6 new-repository full-impl (W4.x.12-17 Option Y composition)", () => {
  it("DocumentRepository — put/get/list/delete with category filter", async () => {
    const repo = new DocumentRepository(substrate);

    const doc1 = { id: "doc-A", category: "design", content: "# Design doc\nbody" };
    const doc2 = { id: "doc-B", category: "review", content: "# Review\nbody" };
    const doc3 = { id: "doc-C", category: "design", content: "# Another design" };

    await repo.put(doc1);
    await repo.put(doc2);
    await repo.put(doc3);

    const fetched = await repo.get("doc-A");
    expect(fetched?.content).toBe("# Design doc\nbody");

    const all = await repo.list();
    expect(all).toHaveLength(3);

    const designOnly = await repo.list({ category: "design" });
    expect(designOnly).toHaveLength(2);
    expect(designOnly.map(d => d.id).sort()).toEqual(["doc-A", "doc-C"]);

    await repo.delete("doc-B");
    expect(await repo.get("doc-B")).toBeNull();
    expect((await repo.list())).toHaveLength(2);
  }, 60_000);

  it("NotificationRepository — put/get/list with recipientAgentId filter (hub-networking.ts absorption deferred to W5)", async () => {
    const repo = new NotificationRepository(substrate);

    const n1 = { id: "notif-1", event: "task_assigned", recipientAgentId: "agent-greg", payload: { taskId: "task-1" } };
    const n2 = { id: "notif-2", event: "thread_message", recipientAgentId: "agent-lily", payload: { threadId: "thread-1" } };
    const n3 = { id: "notif-3", event: "pulse_fired", recipientAgentId: "agent-greg", payload: {} };

    await repo.put(n1);
    await repo.put(n2);
    await repo.put(n3);

    const all = await repo.list();
    expect(all).toHaveLength(3);

    const greg = await repo.list({ recipientAgentId: "agent-greg" });
    expect(greg).toHaveLength(2);
    expect(greg.map(n => n.id).sort()).toEqual(["notif-1", "notif-3"]);

    const fetched = await repo.get("notif-2");
    expect(fetched?.event).toBe("thread_message");
  }, 60_000);

  it("ArchitectDecisionRepository — put/get/list", async () => {
    const repo = new ArchitectDecisionRepository(substrate);

    const d1 = { id: "decision-1", decision: "Adopt substrate", context: "mission-83", timestamp: "2026-05-17T03:00:00Z" };
    const d2 = { id: "decision-2", decision: "Bump Design v1.4", context: "engineer-surface", timestamp: "2026-05-17T03:40:00Z" };

    await repo.put(d1);
    await repo.put(d2);

    const fetched = await repo.get("decision-1");
    expect(fetched?.decision).toBe("Adopt substrate");

    const all = await repo.list();
    expect(all).toHaveLength(2);
  }, 60_000);

  it("DirectorHistoryEntryRepository — append-only history pattern", async () => {
    const repo = new DirectorHistoryEntryRepository(substrate);

    const e1 = { id: "dh-1", role: "Director", text: "Initial directive" };
    const e2 = { id: "dh-2", role: "Director", text: "Follow-up directive" };
    const e3 = { id: "dh-3", role: "Director", text: "Closing remark" };

    await repo.put(e1);
    await repo.put(e2);
    await repo.put(e3);

    const fetched = await repo.get("dh-2");
    expect(fetched?.text).toBe("Follow-up directive");

    const all = await repo.list();
    expect(all).toHaveLength(3);
  }, 60_000);

  it("ReviewHistoryEntryRepository — list-by-taskId filter", async () => {
    const repo = new ReviewHistoryEntryRepository(substrate);

    const r1 = { id: "rh-1", taskId: "task-1", assessment: "v1 needs work" };
    const r2 = { id: "rh-2", taskId: "task-1", assessment: "v2 looks good" };
    const r3 = { id: "rh-3", taskId: "task-2", assessment: "approved" };

    await repo.put(r1);
    await repo.put(r2);
    await repo.put(r3);

    const all = await repo.list();
    expect(all).toHaveLength(3);

    const task1Reviews = await repo.list({ taskId: "task-1" });
    expect(task1Reviews).toHaveLength(2);
    expect(task1Reviews.map(r => r.id).sort()).toEqual(["rh-1", "rh-2"]);

    const task2Reviews = await repo.list({ taskId: "task-2" });
    expect(task2Reviews).toHaveLength(1);
  }, 60_000);

  it("ThreadHistoryEntryRepository — list-by-threadId filter (W1.1 engineer-blind-discovery)", async () => {
    const repo = new ThreadHistoryEntryRepository(substrate);

    const h1 = { id: "th-1", threadId: "thread-1", title: "Open", outcome: "converged", timestamp: "2026-05-17T03:00:00Z" };
    const h2 = { id: "th-2", threadId: "thread-1", title: "Reply round", outcome: "active", timestamp: "2026-05-17T03:10:00Z" };
    const h3 = { id: "th-3", threadId: "thread-2", title: "Other", outcome: "round_limit", timestamp: "2026-05-17T03:20:00Z" };

    await repo.put(h1);
    await repo.put(h2);
    await repo.put(h3);

    const all = await repo.list();
    expect(all).toHaveLength(3);

    const thread1History = await repo.list({ threadId: "thread-1" });
    expect(thread1History).toHaveLength(2);
    expect(thread1History.map(h => h.id).sort()).toEqual(["th-1", "th-2"]);

    const fetched = await repo.get("th-3");
    expect(fetched?.title).toBe("Other");
    expect(fetched?.outcome).toBe("round_limit");
  }, 60_000);
});
