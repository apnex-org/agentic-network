/**
 * mission-83 W4.x.4 — MessageRepositorySubstrate integration tests.
 *
 * 2 tests covering Option Y composition pattern (most complex sweep slice):
 *   1. createMessage round-trip with per-thread sequence allocation +
 *      listMessages thread-scoped ordering + replayFromCursor ULID-cursor +
 *      findByMigrationSourceId idempotency
 *   2. CAS transitions: claimMessage (new → received + claimedBy) +
 *      ackMessage (received → acked) + markScheduledState (Mission-51 W4);
 *      idempotent-by-state semantics + winner-takes-all race
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createTestPool } from "../../storage-substrate/__tests__/_pg-test-pool.js";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPostgresStorageSubstrate,
  createSchemaReconciler,
  buildEnvelopeWriteEncoder,
  ALL_SCHEMAS,
  type HubStorageSubstrate,
  type SchemaReconciler,
  type PostgresSubstrate,
} from "../../storage-substrate/index.js";
import { MessageRepositorySubstrate } from "../message-repository-substrate.js";
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

  const pool = createTestPool(connStr, "message-repository-substrate");
  for (const f of MIGRATION_FILES) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf-8");
    await pool.query(sql);
  }
  await pool.end();

  substrate = createPostgresStorageSubstrate(connStr);

  const subset = ALL_SCHEMAS.filter(s => ["SchemaDef", "Message"].includes(s.kind));
  reconciler = createSchemaReconciler(substrate, connStr, {
    initialSchemas: subset,
    log: () => { /* silent */ },
    warn: () => { /* silent */ },
  });
  await reconciler.start();
  // mission-90 W8 (audit MG2): match prod boot — envelope writes + bare-key→
  // envelope-path translation, so this postgres test seeds + decodes ENVELOPE rows
  // on the real Postgres-JSONB path (was storing legacy-flat = flat→flat passthrough,
  // never exercising the envelope→flat decode the prod substrate runs).
  const pgSub = substrate as PostgresSubstrate;
  pgSub.setFieldTranslator((kind, key) => reconciler.getFieldTranslation(kind, key));
  pgSub.setWriteEncoder(buildEnvelopeWriteEncoder());
}, 60_000);

afterAll(async () => {
  await reconciler.close();
  await (substrate as unknown as { close: () => Promise<void> }).close?.();
  await container.stop();
}, 30_000);

beforeEach(async () => {
  const pool = createTestPool(connStr, "message-repository-substrate");
  try {
    await pool.query(`DELETE FROM entities WHERE kind = $1`, ["Message"]);
  } finally {
    await pool.end();
  }
});

describe("MessageRepositorySubstrate (W4.x.4 Option Y sibling-pattern)", () => {
  it("createMessage + per-thread sequence allocation + listByThread + replayFromCursor + findByMigrationSourceId", async () => {
    const repo = new MessageRepositorySubstrate(substrate);

    // 3 messages in thread-A — sequence 0/1/2
    const m1 = await repo.createMessage({
      kind: "note",
      authorRole: "engineer",
      authorAgentId: "agent-greg",
      target: null,
      delivery: "push-immediate",
      payload: { body: "Hello" },
      threadId: "thread-A",
    });
    expect(m1.id).toMatch(/^[0-9A-Z]{26}$/);  // ULID shape
    expect(m1.sequenceInThread).toBe(0);
    expect(m1.status).toBe("new");

    const m2 = await repo.createMessage({
      kind: "note",
      authorRole: "architect",
      authorAgentId: "agent-lily",
      target: { role: "engineer", agentId: "agent-greg" },
      delivery: "push-immediate",
      payload: { body: "Reply" },
      threadId: "thread-A",
    });
    expect(m2.sequenceInThread).toBe(1);

    const m3 = await repo.createMessage({
      kind: "note",
      authorRole: "engineer",
      authorAgentId: "agent-greg",
      target: null,
      delivery: "push-immediate",
      payload: { body: "Third" },
      threadId: "thread-A",
    });
    expect(m3.sequenceInThread).toBe(2);

    // 1 message in thread-B — sequence 0 (separate sequence space per thread)
    const mB = await repo.createMessage({
      kind: "note",
      authorRole: "engineer",
      authorAgentId: "agent-greg",
      target: null,
      delivery: "push-immediate",
      payload: { body: "Thread B start" },
      threadId: "thread-B",
    });
    expect(mB.sequenceInThread).toBe(0);

    // 1 non-threaded message
    await repo.createMessage({
      kind: "note",
      authorRole: "system",
      authorAgentId: "hub-system",
      target: null,
      delivery: "push-immediate",
      payload: { body: "System note" },
    });

    // listByThread returns thread-A messages ordered by sequenceInThread asc
    const threadA = await repo.listMessages({ threadId: "thread-A" });
    expect(threadA).toHaveLength(3);
    expect(threadA.map(m => m.sequenceInThread)).toEqual([0, 1, 2]);
    expect(threadA[0].id).toBe(m1.id);
    expect(threadA[2].id).toBe(m3.id);

    // listByThread on thread-B
    const threadB = await repo.listMessages({ threadId: "thread-B" });
    expect(threadB).toHaveLength(1);
    expect(threadB[0].id).toBe(mB.id);

    // listMessages (no threadId) — applies additional filters
    const greg = await repo.listMessages({ authorAgentId: "agent-greg" });
    expect(greg.length).toBe(3);  // m1 + m3 + mB

    // replayFromCursor: cursor-based pagination via ULID lex-sort
    const allReplay = await repo.replayFromCursor({ limit: 100 });
    expect(allReplay.length).toBe(5);
    // ULID lex-sort = time-monotonic; m1 should be first (oldest)
    expect(allReplay[0].id).toBe(m1.id);

    // since cursor excludes prior messages strictly
    const after_m1 = await repo.replayFromCursor({ since: m1.id, limit: 100 });
    expect(after_m1.length).toBe(4);
    expect(after_m1.find(m => m.id === m1.id)).toBeUndefined();

    // limit cap
    const top2 = await repo.replayFromCursor({ limit: 2 });
    expect(top2.length).toBe(2);

    // findByMigrationSourceId — idempotency hook
    const migrated = await repo.createMessage({
      kind: "note",
      authorRole: "system",
      authorAgentId: "hub-system",
      target: null,
      delivery: "push-immediate",
      payload: { body: "Migrated message" },
      migrationSourceId: "audit-42",
    });
    expect(migrated.migrationSourceId).toBe("audit-42");

    // Re-call with same migrationSourceId returns existing
    const dup = await repo.createMessage({
      kind: "note",
      authorRole: "system",
      authorAgentId: "hub-system",
      target: null,
      delivery: "push-immediate",
      payload: { body: "Should NOT write" },
      migrationSourceId: "audit-42",
    });
    expect(dup.id).toBe(migrated.id);

    const found = await repo.findByMigrationSourceId("audit-42");
    expect(found?.id).toBe(migrated.id);
    expect(await repo.findByMigrationSourceId("audit-99")).toBeNull();
  }, 60_000);

  it("CAS transitions: claimMessage + ackMessage + markScheduledState via Design v1.4 getWithRevision + putIfMatch", async () => {
    const repo = new MessageRepositorySubstrate(substrate);

    // Create a new message
    const m = await repo.createMessage({
      kind: "note",
      authorRole: "engineer",
      authorAgentId: "agent-greg",
      target: { role: "architect", agentId: "agent-lily" },
      delivery: "push-immediate",
      payload: { body: "Claim me" },
    });
    expect(m.status).toBe("new");
    expect(m.claimedBy).toBeUndefined();

    // claimMessage: new → received + claimedBy set
    const claimed = await repo.claimMessage(m.id, "agent-lily");
    expect(claimed?.status).toBe("received");
    expect(claimed?.claimedBy).toBe("agent-lily");

    // Idempotent: re-claim returns existing (no overwrite of claimedBy)
    const reclaimed = await repo.claimMessage(m.id, "agent-other");
    expect(reclaimed?.status).toBe("received");
    expect(reclaimed?.claimedBy).toBe("agent-lily");  // winner preserved

    // ackMessage: received → acked
    const acked = await repo.ackMessage(m.id);
    expect(acked?.status).toBe("acked");

    // Idempotent: re-ack returns existing
    const reAcked = await repo.ackMessage(m.id);
    expect(reAcked?.status).toBe("acked");

    // ackMessage on absent returns null
    expect(await repo.ackMessage("01HXXXXXXXXXXXXXXXXXXXXXXXXX")).toBeNull();

    // markScheduledState — create a scheduled message
    const scheduled = await repo.createMessage({
      kind: "note",
      authorRole: "system",
      authorAgentId: "hub-system",
      target: null,
      delivery: "scheduled",
      fireAt: new Date(Date.now() + 60_000).toISOString(),
      payload: { body: "Future fire" },
    });
    expect(scheduled.scheduledState).toBe("pending");

    // Mark as fired
    const fired = await repo.markScheduledState(scheduled.id, "delivered");
    expect(fired?.scheduledState).toBe("delivered");

    // Idempotent: re-mark same state returns unchanged
    const reFired = await repo.markScheduledState(scheduled.id, "delivered");
    expect(reFired?.scheduledState).toBe("delivered");

    // markScheduledState on absent returns null
    expect(await repo.markScheduledState("01HXXXXXXXXXXXXXXXXXXXXXXXXX", "delivered")).toBeNull();
  }, 60_000);

  it("bug-104: listMessages + replayFromCursor filter substrate-side — matches beyond the LIST_PREFETCH_CAP window are found", async () => {
    const repo = new MessageRepositorySubstrate(substrate);

    // Seed >LIST_PREFETCH_CAP (500) filler messages targeted at engineer, then
    // a small architect-targeted "needle" batch with the newest ULIDs. The
    // pre-bug-104 listFiltered prefetched an unordered LIMIT-500 window then
    // filtered client-side — a needle beyond that window was invisible
    // (production repro: list_messages{targetRole:architect} → 1 of 88).
    const FILLER = 500;
    for (let i = 0; i < FILLER; i++) {
      await repo.createMessage({
        kind: "note", authorRole: "engineer", authorAgentId: "agent-greg",
        target: { role: "engineer" }, delivery: "push-immediate",
        payload: { body: `filler-${i}` },
      });
    }
    const needles: string[] = [];
    for (let i = 0; i < 5; i++) {
      const m = await repo.createMessage({
        kind: "note", authorRole: "engineer", authorAgentId: "agent-greg",
        target: { role: "architect" }, delivery: "push-immediate",
        payload: { body: `needle-${i}` },
      });
      needles.push(m.id);
    }

    // targetRole filter — all 5 architect-targeted found despite sitting beyond
    // the 500-row prefetch window; returned ascending by ULID.
    const architect = await repo.listMessages({ targetRole: "architect" });
    expect(architect.map(m => m.id)).toEqual(needles);

    // replayFromCursor — ULID `since` cursor pushed substrate-side (`id > since`,
    // text comparison; ULID lex-order = time-order) combined with targetRole +
    // status. Strict cursor: needles[0] excluded.
    const afterFirstNeedle = await repo.replayFromCursor({
      since: needles[0], targetRole: "architect", status: "new", limit: 100,
    });
    expect(afterFirstNeedle.map(m => m.id)).toEqual(needles.slice(1));
  }, 60_000);
});
