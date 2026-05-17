/**
 * mission-83 W3.x.2 — PulseSweeperSubstrate integration tests.
 *
 * 2 tests covering substrate-API integration:
 *   1. Happy path: 1 active mission with pulses.engineerPulse → 1 scanned (stub
 *      evaluatePulse returns "skipped")
 *   2. Edge case: missions without pulses field → 0 scanned (skip-no-pulses
 *      branch)
 *
 * Full evaluatePulse business-logic tests deferred per scope-note in
 * pulse-sweeper-substrate.ts (substantial integration: messageStore + engineerRegistry
 * + onPulseAcked cascade hook).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { createPostgresStorageSubstrate, type HubStorageSubstrate } from "../../storage-substrate/index.js";
import { PulseSweeperSubstrate } from "../pulse-sweeper-substrate.js";
import type { Mission } from "../../entities/index.js";

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
} as unknown as ConstructorParameters<typeof PulseSweeperSubstrate>[1];

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
    await pool.query(`DELETE FROM entities WHERE kind = $1`, ["Mission"]);
  } finally {
    await pool.end();
  }
});

describe("PulseSweeperSubstrate", () => {
  it("happy-path: 1 active mission with pulses.engineerPulse → 1 scanned (stub evaluatePulse skipped)", async () => {
    const now = new Date().toISOString();
    await substrate.put<Mission>("Mission", {
      id: "mission-pulse-1",
      title: "Test mission",
      status: "active",
      pulses: {
        engineerPulse: {
          intervalSeconds: 21600,
          shape: "short_status",
          message: "test pulse",
        },
      },
      updatedAt: now,
      createdAt: now,
    } as unknown as Mission);

    const sweeper = new PulseSweeperSubstrate(substrate, noopContextProvider, {
      logger: { log: () => {}, warn: () => {} },
    });

    const result = await sweeper.tick();

    expect(result.scanned).toBe(1);   // 1 pulse scanned
    expect(result.fired).toBe(0);     // stub returns skipped
    expect(result.skipped).toBe(1);
    expect(result.escalated).toBe(0);
    expect(result.errors).toBe(0);
  }, 30_000);

  it("edge-case: missions without pulses field → 0 scanned (skip-no-pulses branch)", async () => {
    const now = new Date().toISOString();
    await substrate.put<Mission>("Mission", {
      id: "mission-no-pulses",
      title: "Mission without pulses",
      status: "active",
      // pulses field absent
      updatedAt: now,
      createdAt: now,
    } as unknown as Mission);

    const sweeper = new PulseSweeperSubstrate(substrate, noopContextProvider, {
      logger: { log: () => {}, warn: () => {} },
    });

    const result = await sweeper.tick();

    expect(result.scanned).toBe(0);
    expect(result.fired).toBe(0);
    expect(result.errors).toBe(0);
  }, 30_000);
});
