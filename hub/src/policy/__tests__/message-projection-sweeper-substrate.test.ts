/**
 * mission-83 W3.x.1 — MessageProjectionSweeperSubstrate integration tests.
 *
 * Per Design v1.3 §4 W3 row: integration tests against synthetic substrate
 * entities. Sweeper consumes substrate.list('Thread') + substrate.get('Thread')
 * + substrate.list('Message', { filter: { migrationSourceId } }) +
 * substrate.put('Message') directly.
 *
 * 2 tests per architect-dispatch "happy path + edge case" framing.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { createPostgresStorageSubstrate, type HubStorageSubstrate } from "../../storage-substrate/index.js";
import { MessageProjectionSweeperSubstrate } from "../message-projection-sweeper-substrate.js";
import type { Thread } from "../../state.js";
import type { Message } from "../../entities/index.js";

const { Pool } = pg;

let container: StartedPostgreSqlContainer;
let substrate: HubStorageSubstrate;
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
}, 60_000);

afterAll(async () => {
  await (substrate as unknown as { close: () => Promise<void> }).close?.();
  await container.stop();
}, 30_000);

beforeEach(async () => {
  const pool = new Pool({ connectionString: connStr });
  try {
    await pool.query(`DELETE FROM entities WHERE kind IN ($1, $2)`, ["Thread", "Message"]);
  } finally {
    await pool.end();
  }
});

describe("MessageProjectionSweeperSubstrate", () => {
  it("happy-path: thread with 2 messages + no prior projection → both messages projected + marker advanced", async () => {
    // Synthetic substrate state: 1 thread with messages[] embedded; no
    // lastMessageProjectedAt → all messages need projection
    const threadId = "thread-mp-1";
    const now = new Date().toISOString();
    await substrate.put<Thread>("Thread", {
      id: threadId,
      title: "Test thread",
      messages: [
        { author: "engineer", authorAgentId: "agent-1", text: "first", intent: null, semanticIntent: null, converged: false },
        { author: "architect", authorAgentId: "agent-2", text: "second", intent: null, semanticIntent: null, converged: false },
      ],
      // lastMessageProjectedAt absent (never projected)
      updatedAt: now,
      createdAt: now,
    } as Thread);

    const sweeper = new MessageProjectionSweeperSubstrate(substrate, {
      logger: { log: () => {}, warn: () => {} },
    });

    const result = await sweeper.sweep();

    expect(result.threadsScanned).toBe(1);
    expect(result.threadsProjected).toBe(1);
    expect(result.messagesProjected).toBe(2);
    expect(result.errors).toBe(0);

    // Verify 2 messages exist with correct migrationSourceId
    const { items: projected } = await substrate.list<Message & { migrationSourceId: string }>("Message", {
      filter: { threadId },
    });
    expect(projected).toHaveLength(2);
    const sourceIds = projected.map(m => m.migrationSourceId).sort();
    expect(sourceIds).toEqual([`thread-message:${threadId}/1`, `thread-message:${threadId}/2`]);

    // Verify thread marker advanced
    const updatedThread = await substrate.get<Thread>("Thread", threadId);
    expect(updatedThread?.lastMessageProjectedAt).toBe(now);
  }, 30_000);

  it("edge-case: thread already up-to-date (lastMessageProjectedAt >= updatedAt) → no projection", async () => {
    const threadId = "thread-mp-uptodate";
    const now = new Date().toISOString();
    await substrate.put<Thread>("Thread", {
      id: threadId,
      title: "Up to date thread",
      messages: [
        { author: "engineer", authorAgentId: "agent-1", text: "x", intent: null, semanticIntent: null, converged: false },
      ],
      lastMessageProjectedAt: now,  // already projected
      updatedAt: now,
      createdAt: now,
    } as Thread);

    const sweeper = new MessageProjectionSweeperSubstrate(substrate, {
      logger: { log: () => {}, warn: () => {} },
    });

    const result = await sweeper.sweep();

    expect(result.threadsScanned).toBe(1);
    expect(result.threadsProjected).toBe(0);  // skipped (already up-to-date)
    expect(result.messagesProjected).toBe(0);
    expect(result.errors).toBe(0);

    // Verify NO messages were created
    const { items: projected } = await substrate.list<Message>("Message", { filter: { threadId } });
    expect(projected).toHaveLength(0);
  }, 30_000);
});
