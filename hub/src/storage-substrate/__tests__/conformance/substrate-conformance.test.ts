/**
 * SubstrateConformanceSuite runner — mission-84 W1.
 *
 * Wires `runSubstrateConformanceSuite` over [memoryFactory, postgresFactory] via
 * `describe.each` so both impls run the identical suite. Per Design v1.0 §2.2
 * ratify-criterion: both factories must pass the suite for substrate-impl
 * acceptance.
 *
 * memoryFactory: createMemoryStorageSubstrate (skip restart-safety + race-
 *   correctness — single-threaded JS event-loop semantic doesn't validate real
 *   contention; memory has no persistence to restart).
 *
 * postgresFactory: testcontainers-backed; singleton container for the suite run;
 *   per-test-kind-isolation (each test uses uniqueKind() so no cross-test interference).
 *   Mirrors mission-83 W1.4 postgres-substrate.test.ts harness pattern.
 *
 * NOTE on postgres-factory restart-safety: the runner skip-flag covers the in-
 * suite placeholder. The real restart-safety exercise lives at this test file's
 * own `describe("PostgresStorageSubstrate restart-safety", ...)` block — needs
 * connection-string captured at suite setup to recreate the substrate post-
 * teardown. Implemented as a separate block per category-coupling discipline.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createMemoryStorageSubstrate, createPostgresStorageSubstrate } from "../../index.js";
import type { HubStorageSubstrate } from "../../types.js";
import {
  runSubstrateConformanceSuite,
  type SubstrateFactory,
  type SubstrateConformanceSuiteOptions,
} from "./runSubstrateConformanceSuite.js";

// ─── Postgres testcontainers setup (singleton across suite run) ─────────────

let pgContainer: StartedPostgreSqlContainer | undefined;
let pgConnStr: string | undefined;
let pgSubstrate: HubStorageSubstrate | undefined;

const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");
const MIGRATION_FILES = [
  "001-entities-table.sql",
  "002-notify-trigger.sql",
  "003-jsonb-size-check.sql",
];

beforeAll(async () => {
  pgContainer = await new PostgreSqlContainer("postgres:15-alpine")
    .withUsername("hub")
    .withPassword("hub")
    .withDatabase("hub")
    .start();
  pgConnStr = `postgres://hub:hub@${pgContainer.getHost()}:${pgContainer.getPort()}/hub`;

  const { Pool } = (await import("pg")).default;
  const pool = new Pool({ connectionString: pgConnStr });
  for (const f of MIGRATION_FILES) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf-8");
    await pool.query(sql);
  }
  await pool.end();

  pgSubstrate = createPostgresStorageSubstrate(pgConnStr);
}, 60_000);

afterAll(async () => {
  if (pgSubstrate) {
    await (pgSubstrate as unknown as { close: () => Promise<void> }).close?.();
  }
  if (pgContainer) {
    await pgContainer.stop();
  }
}, 30_000);

// ─── Factory wiring (postgres returns the singleton; memory returns fresh per call) ─

const memoryFactory: SubstrateFactory = () => createMemoryStorageSubstrate();
const postgresFactory: SubstrateFactory = () => {
  if (!pgSubstrate) throw new Error("postgresFactory called before beforeAll completed");
  return pgSubstrate;
};

// Memory options: skip restart-safety (no persistence) + race-correctness (single-
// threaded JS event-loop doesn't validate real contention). Race-correctness tests
// using putIfMatch still verify the protocol shape; postgres exercises real contention.
const memoryOptions: SubstrateConformanceSuiteOptions = { skipRestartSafety: true };
const postgresOptions: SubstrateConformanceSuiteOptions = { skipRestartSafety: true };
// NOTE: restart-safety implemented as a separate describe block below (postgres-only;
// requires substrate-recreation cycle that conflicts with singleton-container pattern).

// ─── Run conformance suite over both factories ──────────────────────────────

describe.each([
  ["memoryFactory", memoryFactory, memoryOptions],
  ["postgresFactory", postgresFactory, postgresOptions],
] as const)("SubstrateConformanceSuite — %s", (_name, factory, options) => {
  runSubstrateConformanceSuite(factory, options);
});

// ─── PostgresStorageSubstrate restart-safety (postgres-only; runner-level) ──

describe("restart-safety — postgres-only (recreate substrate against same connection)", () => {
  it("entities persist across substrate teardown + recreate", async () => {
    if (!pgConnStr) throw new Error("connection string unavailable");

    // Write via substrate instance A
    const instanceA = createPostgresStorageSubstrate(pgConnStr);
    await instanceA.put("RestartPersist", { id: "p", v: 42 });
    await (instanceA as unknown as { close: () => Promise<void> }).close?.();

    // Recreate substrate instance B against same connection
    const instanceB = createPostgresStorageSubstrate(pgConnStr);
    const got = await instanceB.get<{ id: string; v: number }>("RestartPersist", "p");
    expect(got).toEqual({ id: "p", v: 42 });
    await (instanceB as unknown as { close: () => Promise<void> }).close?.();
  }, 30_000);

  it("resourceVersion counter survives restart (continues from pre-restart value)", async () => {
    if (!pgConnStr) throw new Error("connection string unavailable");

    const instanceA = createPostgresStorageSubstrate(pgConnStr);
    const r1 = await instanceA.put("RestartRv", { id: "p", v: 1 });
    await (instanceA as unknown as { close: () => Promise<void> }).close?.();

    const instanceB = createPostgresStorageSubstrate(pgConnStr);
    const r2 = await instanceB.put("RestartRv", { id: "p", v: 2 });
    expect(Number(r2.resourceVersion)).toBeGreaterThan(Number(r1.resourceVersion));
    await (instanceB as unknown as { close: () => Promise<void> }).close?.();
  }, 30_000);

  it("CAS-ifRevision against pre-restart revision still works post-restart", async () => {
    if (!pgConnStr) throw new Error("connection string unavailable");

    const instanceA = createPostgresStorageSubstrate(pgConnStr);
    const r1 = await instanceA.put("RestartCas", { id: "p", v: 1 });
    await (instanceA as unknown as { close: () => Promise<void> }).close?.();

    const instanceB = createPostgresStorageSubstrate(pgConnStr);
    const r2 = await instanceB.putIfMatch("RestartCas", { id: "p", v: 2 }, r1.resourceVersion);
    expect(r2.ok).toBe(true);
    await (instanceB as unknown as { close: () => Promise<void> }).close?.();
  }, 30_000);
});
