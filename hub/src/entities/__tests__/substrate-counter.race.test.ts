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
import { createTestPool } from "../../storage-substrate/__tests__/_pg-test-pool.js";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { createPostgresStorageSubstrate, type HubStorageSubstrate } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
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
  const pool = createTestPool(connStr, "substrate-counter.race");
  for (const f of MIGRATION_FILES) {
    await pool.query(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
  }
  await pool.end();
  substrate = createPostgresStorageSubstrate(connStr);
}, 60_000);

afterAll(async () => {
  // bug-110 — substrate.close() is a typed interface member; close the pool
  // deterministically before the testcontainer is torn down (no `as unknown`
  // cast, no optional-chain that would silently no-op a missing teardown).
  await substrate.close();
  await container.stop();
}, 30_000);

beforeEach(async () => {
  const pool = createTestPool(connStr, "substrate-counter.race");
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

  // ─── mission-88 W3 envelope-shape atomic-ship coverage (A1) ───────────

  it("envelope-shape: first-write creates envelope-shape Counter entity", async () => {
    const counter = new SubstrateCounter(substrate);

    expect(await counter.next("envelopeTestDomain")).toBe(1);

    const raw = await substrate.get<Record<string, unknown>>("Counter", "counter");
    expect(raw).not.toBeNull();
    // Verify envelope-shape persisted post-W3 atomic ship
    expect(raw!.kind).toBe("Counter");
    expect(raw!.apiVersion).toBe("core.ois/v1");
    expect(raw!.metadata).toEqual({});
    expect(raw!.spec).toEqual({});
    const status = raw!.status as Record<string, unknown>;
    expect(status.phase).toBe("active");
    expect(status.counters).toEqual({ envelopeTestDomain: 1 });
  });

  it("envelope-shape: subsequent writes preserve envelope structure + advance counter", async () => {
    const counter = new SubstrateCounter(substrate);
    await counter.next("seqDomain"); // creates envelope row
    await counter.next("seqDomain"); // updates envelope row

    const raw = await substrate.get<Record<string, unknown>>("Counter", "counter");
    expect(raw!.kind).toBe("Counter");
    const status = raw!.status as Record<string, unknown>;
    expect(status.phase).toBe("active");
    expect(status.counters).toEqual({ seqDomain: 2 });
  });

  it("envelope counter: reads status.counters + advances monotonically (W8: legacy-flat tolerance retired)", async () => {
    // mission-90 W8: the Counter is envelope-only (status.counters); the pre-W3
    // legacy-flat top-level-numeric read is retired.
    await substrate.put("Counter", { id: "counter", kind: "Counter", apiVersion: "core.ois/v1", metadata: {}, spec: {}, status: { counters: { legacyDomain: 5 }, phase: "active" } });

    const counter = new SubstrateCounter(substrate);
    // next() reads status.counters.legacyDomain=5 + advances to 6.
    expect(await counter.next("legacyDomain")).toBe(6);

    const raw = await substrate.get<Record<string, unknown>>("Counter", "counter");
    expect(raw!.kind).toBe("Counter");
    const status = raw!.status as Record<string, unknown>;
    expect((status.counters as Record<string, number>).legacyDomain).toBe(6);
  });

  // ─── mission-89 Phase 3 — advisory-lock primitive integration (bug-97 sibling) ──

  it("PR 2 dispositive: same-domain concurrent next() calls serialize through advisory-lock (no CAS retries needed for intra-domain race)", async () => {
    if (!substrate) throw new Error("substrate not initialized");
    const counter = new SubstrateCounter(substrate);

    // Pre-mission-89: bug-97 surfaced when concurrent same-domain callers raced
    // on the shared Counter row + both lost the putIfMatch CAS → retry loop.
    // Post-mission-89: per-domain advisory-lock serializes intra-domain callers
    // so they NEVER race on putIfMatch (single attempt always succeeds).
    //
    // We can't directly observe "no retries happened" without instrumenting the
    // counter; instead assert the strict invariant: N concurrent same-domain
    // next() calls return EXACTLY 1..N with no gaps or duplicates, under
    // bounded total time (lock-serialization should be fast even at high N).
    const N = 20;
    const startedAt = Date.now();
    const promises = Array.from({ length: N }, () => counter.next("phase3LockDomain"));
    const values = await Promise.all(promises);
    const elapsed = Date.now() - startedAt;

    // Same correctness invariants as bug-97 race-fix test (uniqueness + monotonicity)
    expect(new Set(values).size).toBe(N);
    expect([...values].sort((a, b) => a - b)).toEqual(Array.from({ length: N }, (_, i) => i + 1));

    // Lock-serialized + single-attempt path → bounded elapsed (~N * pg-round-trip;
    // ~5ms each typical); allow generous 10s for testcontainer overhead.
    expect(elapsed).toBeLessThan(10_000);
  }, 30_000);

  it("envelope-shape: concurrent writes across multiple domains preserve all counters", async () => {
    const counter = new SubstrateCounter(substrate);
    const domains = ["envA", "envB", "envC"];
    const N = 5;

    const promises: Promise<{ domain: string; value: number }>[] = [];
    for (const domain of domains) {
      for (let i = 0; i < N; i++) {
        promises.push(counter.next(domain).then(value => ({ domain, value })));
      }
    }
    await Promise.all(promises);

    // Verify all domains preserved in envelope.status.counters map
    const raw = await substrate.get<Record<string, unknown>>("Counter", "counter");
    const counters = (raw!.status as Record<string, unknown>).counters as Record<string, number>;
    for (const domain of domains) {
      expect(counters[domain], `${domain} preserved in envelope`).toBe(N);
    }
  }, 60_000);
});
