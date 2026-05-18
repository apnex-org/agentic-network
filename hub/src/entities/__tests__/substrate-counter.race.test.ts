/**
 * mission-83 W5.5 bug-97 fix — SubstrateCounter concurrent-allocation race test.
 *
 * Verifies that N concurrent next() calls produce N distinct monotonic values
 * (no duplicates; no lost-updates). Pre-fix, naive get+put pattern would have
 * produced duplicates under concurrent allocation; the bug-97 fix uses Design
 * v1.4 getWithRevision + putIfMatch CAS retry to guarantee uniqueness.
 *
 * bug-97 root cause: register_role flows + audit-logging on substrate-mode boot
 * raced on Counter.nextAuditId() → both callers received same N → createOnly
 * conflict → ONE entity DROPPED. This test reproduces the race + verifies the
 * fix at the SubstrateCounter primitive level.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { createPostgresStorageSubstrate, type HubStorageSubstrate } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";

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
    await pool.query(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
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
    await pool.query(`DELETE FROM entities WHERE kind = $1`, ["Counter"]);
  } finally {
    await pool.end();
  }
});

describe("SubstrateCounter bug-97 race fix (W5.5)", () => {
  it("sequential next() calls produce monotonic distinct values", async () => {
    const counter = new SubstrateCounter(substrate);
    const values: number[] = [];
    for (let i = 0; i < 10; i++) {
      values.push(await counter.next("testDomain"));
    }
    expect(values).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  }, 30_000);

  it("CONCURRENT next() calls produce N distinct monotonic values (bug-97 race fix)", async () => {
    const counter = new SubstrateCounter(substrate);

    // Pre-fix this would have produced duplicates (concurrent callers read same N + both wrote N).
    // Post-fix CAS retry guarantees uniqueness.
    const N = 20;
    const promises = Array.from({ length: N }, () => counter.next("auditCounter"));
    const values = await Promise.all(promises);

    // Verify N distinct values
    const unique = new Set(values);
    expect(unique.size, "all N concurrent next() return distinct values").toBe(N);

    // Verify monotonic range 1..N (no gaps; no values outside expected range)
    const sorted = [...values].sort((a, b) => a - b);
    expect(sorted, "monotonic 1..N").toEqual(Array.from({ length: N }, (_, i) => i + 1));
  }, 60_000);

  it("interleaved concurrent next() across multiple domains preserves per-domain monotonicity", async () => {
    const counter = new SubstrateCounter(substrate);

    // Mix of domains; each domain's next() calls should return monotonic 1..k within domain.
    const domains = ["auditCounter", "taskCounter", "ideaCounter"];
    const callsPerDomain = 8;

    const promises: Promise<{ domain: string; value: number }>[] = [];
    for (const domain of domains) {
      for (let i = 0; i < callsPerDomain; i++) {
        promises.push(counter.next(domain).then(value => ({ domain, value })));
      }
    }

    const results = await Promise.all(promises);

    // Per-domain verification
    for (const domain of domains) {
      const valuesForDomain = results.filter(r => r.domain === domain).map(r => r.value).sort((a, b) => a - b);
      expect(valuesForDomain, `${domain} monotonic 1..${callsPerDomain}`)
        .toEqual(Array.from({ length: callsPerDomain }, (_, i) => i + 1));
    }
  }, 60_000);
});
