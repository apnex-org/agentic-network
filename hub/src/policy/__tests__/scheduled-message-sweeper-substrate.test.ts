/**
 * mission-83 W3.3 — ScheduledMessageSweeperSubstrate integration tests.
 *
 * Per Design v1.3 §4 W3 row: integration tests against synthetic substrate
 * entities. Sweeper consumes substrate.list('Message', { filter }) directly;
 * verifies fire/cancel behavior matches FS-version sibling.
 *
 * 2 tests per architect-dispatch "happy path + edge case" framing.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { createPostgresStorageSubstrate, type HubStorageSubstrate } from "../../storage-substrate/index.js";
import { ScheduledMessageSweeperSubstrate } from "../scheduled-message-sweeper-substrate.js";
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

// Minimal IAuditStore stub for tests (no-op logEntry)
const noopAuditStore = {
  logEntry: async () => { /* noop */ },
} as unknown as ConstructorParameters<typeof ScheduledMessageSweeperSubstrate>[1];

// Minimal SweeperContextProvider stub (preconditions evaluated against ctx.stores
// which we don't need for these tests since we use no precondition)
const noopContextProvider = {
  forSweeper: () => ({
    stores: {},
    metrics: { increment: () => { /* noop */ } },
  }),
} as unknown as ConstructorParameters<typeof ScheduledMessageSweeperSubstrate>[2];

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
  // Clean Message state between tests
  const pool = new Pool({ connectionString: connStr });
  try {
    await pool.query(`DELETE FROM entities WHERE kind = $1`, ["Message"]);
  } finally {
    await pool.end();
  }
});

// ─── Test 1: Happy path — fireAt-past message gets fired ───────────────────

describe("ScheduledMessageSweeperSubstrate", () => {
  it("happy-path: pending message with fireAt in past transitions to delivered", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();

    // Synthetic substrate state: 2 pending scheduled messages — one past, one future
    await substrate.put<Message>("Message", {
      id: "msg-past",
      kind: "note",
      authorRole: "engineer",
      authorAgentId: "agent-1",
      target: { role: "engineer", agentId: "agent-1" },
      delivery: "scheduled",
      fireAt: past,
      scheduledState: "pending",
      payload: { text: "should-fire" },
    } as Message);

    await substrate.put<Message>("Message", {
      id: "msg-future",
      kind: "note",
      authorRole: "engineer",
      authorAgentId: "agent-1",
      target: { role: "engineer", agentId: "agent-1" },
      delivery: "scheduled",
      fireAt: future,
      scheduledState: "pending",
      payload: { text: "should-not-fire" },
    } as Message);

    const sweeper = new ScheduledMessageSweeperSubstrate(
      substrate,
      noopAuditStore,
      noopContextProvider,
      { logger: { log: () => {}, warn: () => {} } },
    );

    const result = await sweeper.sweep();

    expect(result.scanned).toBe(2);  // both pending messages scanned
    expect(result.fired).toBe(1);    // only past one fired
    expect(result.cancelled).toBe(0);
    expect(result.errors).toBe(0);

    // Verify state transitions
    const past_after = await substrate.get<Message>("Message", "msg-past");
    expect(past_after?.scheduledState).toBe("delivered");

    const future_after = await substrate.get<Message>("Message", "msg-future");
    expect(future_after?.scheduledState).toBe("pending");  // unchanged
  }, 15_000);

  // ─── Test 2: Edge case — malformed (missing fireAt) gets cancelled ─────

  it("edge-case: pending message with MISSING fireAt is cancelled (precondition-failed)", async () => {
    await substrate.put<Message>("Message", {
      id: "msg-malformed",
      kind: "note",
      authorRole: "engineer",
      authorAgentId: "agent-1",
      target: { role: "engineer", agentId: "agent-1" },
      delivery: "scheduled",
      // fireAt intentionally absent (malformed)
      scheduledState: "pending",
      payload: { text: "malformed" },
    } as Message);

    const sweeper = new ScheduledMessageSweeperSubstrate(
      substrate,
      noopAuditStore,
      noopContextProvider,
      { logger: { log: () => {}, warn: () => {} } },
    );

    const result = await sweeper.sweep();

    expect(result.scanned).toBe(1);
    expect(result.fired).toBe(0);
    expect(result.cancelled).toBe(1);  // malformed → cancelled
    expect(result.errors).toBe(0);

    const after = await substrate.get<Message>("Message", "msg-malformed");
    expect(after?.scheduledState).toBe("precondition-failed");
  }, 15_000);
});
