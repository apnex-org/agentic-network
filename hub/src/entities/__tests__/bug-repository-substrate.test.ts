/**
 * mission-83 W4 — BugRepositorySubstrate integration tests.
 *
 * 2 tests covering Option Y composition pattern:
 *   1. createBug + getBug round-trip via substrate-API + SubstrateCounter
 *      ID allocation
 *   2. updateBug CAS retry loop + listBugs with filter
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { createPostgresStorageSubstrate, type HubStorageSubstrate } from "../../storage-substrate/index.js";
import { BugRepositorySubstrate } from "../bug-repository-substrate.js";
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
    await pool.query(`DELETE FROM entities WHERE kind IN ($1, $2)`, ["Bug", "Counter"]);
  } finally {
    await pool.end();
  }
});

describe("BugRepositorySubstrate (W4 Option Y sibling-pattern)", () => {
  it("createBug + getBug round-trip via substrate-API + SubstrateCounter ID allocation", async () => {
    const counter = new SubstrateCounter(substrate);
    const repo = new BugRepositorySubstrate(substrate, counter);

    const bug1 = await repo.createBug("Test bug 1", "Description 1", "minor", { classHint: "missing-feature" });
    expect(bug1.id).toBe("bug-1");
    expect(bug1.status).toBe("open");
    expect(bug1.severity).toBe("minor");
    expect(bug1.class).toBe("missing-feature");

    const bug2 = await repo.createBug("Test bug 2", "Description 2", "major");
    expect(bug2.id).toBe("bug-2");  // counter advanced

    // Round-trip via getBug
    const fetched1 = await repo.getBug("bug-1");
    expect(fetched1?.title).toBe("Test bug 1");
    expect(fetched1?.severity).toBe("minor");

    const fetched2 = await repo.getBug("bug-2");
    expect(fetched2?.severity).toBe("major");

    // getBug on absent
    expect(await repo.getBug("bug-99")).toBeNull();
  }, 30_000);

  it("updateBug CAS retry + listBugs with filter", async () => {
    const counter = new SubstrateCounter(substrate);
    const repo = new BugRepositorySubstrate(substrate, counter);

    await repo.createBug("Bug A", "desc A", "minor", { classHint: "missing-feature" });
    await repo.createBug("Bug B", "desc B", "major", { classHint: "data-loss" });
    await repo.createBug("Bug C", "desc C", "critical", { classHint: "missing-feature" });

    // Update bug-1 status open → resolved
    const updated = await repo.updateBug("bug-1", { status: "resolved", fixCommits: ["abc123"] });
    expect(updated?.status).toBe("resolved");
    expect(updated?.fixCommits).toEqual(["abc123"]);

    // Re-fetch verifies persistence
    const refetched = await repo.getBug("bug-1");
    expect(refetched?.status).toBe("resolved");

    // List by filter
    const openBugs = await repo.listBugs({ status: "open" });
    expect(openBugs).toHaveLength(2);  // bug-2 + bug-3

    const featureBugs = await repo.listBugs({ class: "missing-feature" });
    expect(featureBugs).toHaveLength(2);  // bug-1 + bug-3

    // updateBug on absent returns null
    const noBug = await repo.updateBug("bug-99", { status: "wontfix" });
    expect(noBug).toBeNull();
  }, 30_000);
});
