/**
 * mission-83 W3.x.3 — CascadeReplaySweeperSubstrate integration tests.
 *
 * 2 tests: happy path (no committed actions → marker cleared) + edge case
 * (cascadePending: false thread → not scanned).
 *
 * NOTE: full runCascade(ctx, thread, committedActions, summary) integration
 * requires substantial PolicyContext machinery (engineer registry, mission
 * store, etc.). Tests use no-committed-actions path which exercises the
 * substrate-API integration (listCascadePending equivalent + markCascadeCompleted
 * equivalent) without triggering runCascade. Full runCascade integration test
 * deferred to W4 (when repositories compose substrate; PolicyContext machinery
 * naturally available).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { createPostgresStorageSubstrate, type HubStorageSubstrate } from "../../storage-substrate/index.js";
import { CascadeReplaySweeperSubstrate } from "../cascade-replay-sweeper-substrate.js";
import type { Thread } from "../../state.js";

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

const noopContextProvider = {
  forSweeper: () => ({
    stores: {},
    metrics: { increment: () => { /* noop */ } },
  }),
} as unknown as ConstructorParameters<typeof CascadeReplaySweeperSubstrate>[1];

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
    await pool.query(`DELETE FROM entities WHERE kind = $1`, ["Thread"]);
  } finally {
    await pool.end();
  }
});

describe("CascadeReplaySweeperSubstrate", () => {
  it("happy-path: thread with cascadePending=true but no committed actions → marker cleared", async () => {
    const threadId = "thread-cr-1";
    const now = new Date().toISOString();
    await substrate.put<Thread>("Thread", {
      id: threadId,
      title: "Cascade pending thread",
      cascadePending: true,
      convergenceActions: [],  // no committed actions
      summary: "test summary",
      updatedAt: now,
      createdAt: now,
    } as unknown as Thread);

    const sweeper = new CascadeReplaySweeperSubstrate(substrate, noopContextProvider, {
      logger: { log: () => {}, warn: () => {} },
    });

    const result = await sweeper.fullSweep();

    expect(result.scanned).toBe(1);   // 1 thread with cascadePending: true
    expect(result.replayed).toBe(1);  // marker-clear path counts as replayed
    expect(result.errors).toBe(0);

    // Verify marker cleared (cascadePending: false)
    const updated = await substrate.get<Thread & { cascadePending?: boolean }>("Thread", threadId);
    expect(updated?.cascadePending).toBe(false);
  }, 30_000);

  it("edge-case: thread without cascadePending: true → not scanned", async () => {
    const threadId = "thread-cr-2";
    const now = new Date().toISOString();
    await substrate.put<Thread>("Thread", {
      id: threadId,
      title: "No cascade pending",
      // cascadePending: false (or absent) — should not be scanned
      cascadePending: false,
      convergenceActions: [],
      summary: "",
      updatedAt: now,
      createdAt: now,
    } as unknown as Thread);

    const sweeper = new CascadeReplaySweeperSubstrate(substrate, noopContextProvider, {
      logger: { log: () => {}, warn: () => {} },
    });

    const result = await sweeper.fullSweep();

    expect(result.scanned).toBe(0);  // filter excludes cascadePending=false
    expect(result.replayed).toBe(0);
    expect(result.errors).toBe(0);
  }, 30_000);
});
