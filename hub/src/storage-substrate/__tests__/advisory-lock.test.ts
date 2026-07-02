/**
 * mission-89 Phase 1 — withAdvisoryLock primitive tests.
 *
 * Per Design v1.0 §4 test plan. Coverage:
 *   §4.1 Unit: LOCK_CLASS shape, hashToInt32 determinism + int32 range,
 *               LockAcquisitionTimeoutError discriminability
 *   §4.2 Integration (memory): serialize-same-key, parallelize-different-keys,
 *               fn-throw-still-releases, timeout-fires, latency-warn-fires
 *   §4.2 Integration (testcontainer pg, REQUIRED per Observation 1):
 *               real-pg serialize-same-key (mutex-map fakes can't validate),
 *               LockAcquisitionTimeoutError under real-pg contention,
 *               fn-throw releases pg session-lock
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from "vitest";
import { createTestPool } from "./_pg-test-pool.js";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LOCK_CLASS,
  LockAcquisitionTimeoutError,
  hashToInt32,
  withAdvisoryLock,
  createMemoryStorageSubstrate,
  createPostgresStorageSubstrate,
  type HubStorageSubstrate,
} from "../index.js";

// ─── §4.1 Unit tests (pure; no substrate needed) ─────────────────────────────

describe("LOCK_CLASS — typed namespace constants", () => {
  it("reserves assertIdentity=1 + Counter=2 (per Design §2 Q1)", () => {
    expect(LOCK_CLASS.assertIdentity).toBe(1);
    expect(LOCK_CLASS.Counter).toBe(2);
  });

  it("values are distinct (namespace-isolation invariant)", () => {
    const values = Object.values(LOCK_CLASS);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("hashToInt32 — FNV-1a-32 deterministic string hash", () => {
  it("returns int32-range signed integers (postgres int4 compatible)", () => {
    for (const key of ["a", "fingerprint:lily", "thread-650", "x".repeat(100)]) {
      const h = hashToInt32(key);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(-(2 ** 31));
      expect(h).toBeLessThanOrEqual(2 ** 31 - 1);
    }
  });

  it("is deterministic — same input → same output across calls", () => {
    expect(hashToInt32("fingerprint:lily")).toBe(hashToInt32("fingerprint:lily"));
    expect(hashToInt32("")).toBe(hashToInt32(""));
  });

  it("differs for different inputs (avalanche property)", () => {
    const a = hashToInt32("fingerprint:lily");
    const b = hashToInt32("fingerprint:greg");
    expect(a).not.toBe(b);
  });
});

describe("LockAcquisitionTimeoutError — discriminable error class", () => {
  it("instanceof LockAcquisitionTimeoutError + Error", () => {
    const e = new LockAcquisitionTimeoutError(1, "fp-x", 250);
    expect(e).toBeInstanceOf(LockAcquisitionTimeoutError);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("LockAcquisitionTimeoutError");
  });

  it("exposes lockClass + lockKey + elapsedMs for caller-side disambiguation", () => {
    const e = new LockAcquisitionTimeoutError(2, "Idea", 500);
    expect(e.lockClass).toBe(2);
    expect(e.lockKey).toBe("Idea");
    expect(e.elapsedMs).toBe(500);
  });

  it("is distinct from a generic Error (engineer Q1 sub-disposition)", () => {
    const lockTimeout = new LockAcquisitionTimeoutError(1, "fp", 100);
    const generic = new Error("fn threw");
    expect(lockTimeout).toBeInstanceOf(LockAcquisitionTimeoutError);
    expect(generic).not.toBeInstanceOf(LockAcquisitionTimeoutError);
  });
});

// ─── §4.2 Integration tests — memory substrate (incidental-lock) ────────────

describe("withAdvisoryLock — memory substrate (in-process serialization)", () => {
  let substrate: HubStorageSubstrate;

  beforeEach(() => {
    substrate = createMemoryStorageSubstrate();
  });

  afterEach(async () => {
    await substrate.close();
  });

  it("serializes concurrent calls for the same (class, key)", async () => {
    const order: string[] = [];
    const callA = withAdvisoryLock(substrate, LOCK_CLASS.assertIdentity, "fp-same", async () => {
      order.push("A:in");
      await new Promise((r) => setTimeout(r, 30));
      order.push("A:out");
    });
    const callB = withAdvisoryLock(substrate, LOCK_CLASS.assertIdentity, "fp-same", async () => {
      order.push("B:in");
      await new Promise((r) => setTimeout(r, 30));
      order.push("B:out");
    });
    await Promise.all([callA, callB]);
    // Serialization invariant: no INTERLEAVING. Either A's critical section
    // completes fully before B's, or vice versa. Which goes first is timing-
    // dependent under Promise.all — both orderings are valid serialization.
    expect([
      ["A:in", "A:out", "B:in", "B:out"],
      ["B:in", "B:out", "A:in", "A:out"],
    ]).toContainEqual(order);
  });

  it("parallelizes calls for different lockKey (no false serialization)", async () => {
    const startedAt = Date.now();
    const callA = withAdvisoryLock(substrate, LOCK_CLASS.assertIdentity, "fp-A", async () => {
      await new Promise((r) => setTimeout(r, 60));
      return "A";
    });
    const callB = withAdvisoryLock(substrate, LOCK_CLASS.assertIdentity, "fp-B", async () => {
      await new Promise((r) => setTimeout(r, 60));
      return "B";
    });
    const results = await Promise.all([callA, callB]);
    const elapsed = Date.now() - startedAt;
    expect(results).toEqual(["A", "B"]);
    // Parallel: total elapsed ~= max(60, 60), not sum(120). Allow generous slack.
    expect(elapsed).toBeLessThan(120);
  });

  it("parallelizes across distinct lockClass (namespace isolation)", async () => {
    // Same numeric key, different class → must NOT serialize
    const sharedKey = "shared-name";
    const startedAt = Date.now();
    const callA = withAdvisoryLock(substrate, LOCK_CLASS.assertIdentity, sharedKey, async () => {
      await new Promise((r) => setTimeout(r, 60));
      return "asserted";
    });
    const callB = withAdvisoryLock(substrate, LOCK_CLASS.Counter, sharedKey, async () => {
      await new Promise((r) => setTimeout(r, 60));
      return "counted";
    });
    const results = await Promise.all([callA, callB]);
    const elapsed = Date.now() - startedAt;
    expect(results).toEqual(["asserted", "counted"]);
    expect(elapsed).toBeLessThan(120);
  });

  it("releases lock on fn-throw (try/finally discipline)", async () => {
    const order: string[] = [];

    // Caller A throws inside fn
    const callA = withAdvisoryLock(substrate, LOCK_CLASS.assertIdentity, "fp-throw", async () => {
      order.push("A:in");
      throw new Error("fn threw deliberately");
    }).catch(() => order.push("A:caught"));

    // Caller B should still be able to acquire after A releases (despite throw)
    await callA;
    const callB = withAdvisoryLock(substrate, LOCK_CLASS.assertIdentity, "fp-throw", async () => {
      order.push("B:in");
      return "B-ran";
    });
    const result = await callB;

    expect(result).toBe("B-ran");
    expect(order).toEqual(["A:in", "A:caught", "B:in"]);
  });

  it("throws LockAcquisitionTimeoutError when timeoutMs exceeded", async () => {
    // Caller A holds the lock for 200ms
    const callA = withAdvisoryLock(substrate, LOCK_CLASS.assertIdentity, "fp-busy", async () => {
      await new Promise((r) => setTimeout(r, 200));
      return "A-done";
    });

    // Caller B tries with a 50ms budget — should time out
    await expect(
      withAdvisoryLock(
        substrate,
        LOCK_CLASS.assertIdentity,
        "fp-busy",
        async () => "B-should-not-run",
        { timeoutMs: 50 },
      ),
    ).rejects.toBeInstanceOf(LockAcquisitionTimeoutError);

    // Caller A completes normally
    await expect(callA).resolves.toBe("A-done");
  });

  it("LockAcquisitionTimeoutError carries the lockClass/lockKey context", async () => {
    const callA = withAdvisoryLock(substrate, LOCK_CLASS.assertIdentity, "fp-busy-ctx", async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    try {
      await withAdvisoryLock(
        substrate,
        LOCK_CLASS.assertIdentity,
        "fp-busy-ctx",
        async () => "n/a",
        { timeoutMs: 30 },
      );
      throw new Error("should not reach");
    } catch (e) {
      expect(e).toBeInstanceOf(LockAcquisitionTimeoutError);
      const err = e as LockAcquisitionTimeoutError;
      expect(err.lockClass).toBe(LOCK_CLASS.assertIdentity);
      expect(err.lockKey).toBe(String(hashToInt32("fp-busy-ctx")));
      // setTimeout fires under CI load may resolve 1-2ms early; assert the
      // timeout fired at all (not exact threshold) per advisory-lock test
      // calibration (#25 sub-discipline: pin invariants not timing).
      expect(err.elapsedMs).toBeGreaterThanOrEqual(25);
    }
    await callA;
  });
});

describe("withAdvisoryLock — observability (latency-warn)", () => {
  let substrate: HubStorageSubstrate;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    substrate = createMemoryStorageSubstrate();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    await substrate.close();
  });

  it("emits console.warn when acquire-latency exceeds latencyWarnMs", async () => {
    // Caller A holds the lock long enough that B's wait exceeds threshold
    const callA = withAdvisoryLock(substrate, LOCK_CLASS.assertIdentity, "fp-slow", async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    await withAdvisoryLock(
      substrate,
      LOCK_CLASS.assertIdentity,
      "fp-slow",
      async () => { /* immediate */ },
      { latencyWarnMs: 30 },
    );
    await callA;

    const matchedCall = warnSpy.mock.calls.find((c: unknown[]) =>
      typeof c[0] === "string" && c[0].includes("advisory-lock") && c[0].includes("acquire latency"),
    );
    expect(matchedCall).toBeDefined();
  });

  it("does NOT warn when latencyWarnMs=Infinity (opt-out)", async () => {
    const callA = withAdvisoryLock(substrate, LOCK_CLASS.assertIdentity, "fp-quiet", async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    await withAdvisoryLock(
      substrate,
      LOCK_CLASS.assertIdentity,
      "fp-quiet",
      async () => { /* immediate */ },
      { latencyWarnMs: Infinity },
    );
    await callA;

    const matchedCall = warnSpy.mock.calls.find((c: unknown[]) =>
      typeof c[0] === "string" && c[0].includes("acquire latency"),
    );
    expect(matchedCall).toBeUndefined();
  });
});

// ─── §4.2 Integration tests — testcontainer postgres (REAL contention) ──────
//
// Per Design §4.2 Observation 1: memory substrate is contention-mute (in-
// process Map-mutex doesn't reflect real-pg session-lock semantics). Tests
// verifying real serialization-correctness MUST hit testcontainer postgres.

describe("withAdvisoryLock — postgres substrate (real pg_advisory_lock)", () => {
  let pgContainer: StartedPostgreSqlContainer | undefined;
  let pgConnStr: string | undefined;
  let substrate: HubStorageSubstrate | undefined;

  const MIGRATIONS_DIR = join(__dirname, "..", "migrations");
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
    const pool = createTestPool(pgConnStr, "advisory-lock");
    for (const f of MIGRATION_FILES) {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf-8");
      await pool.query(sql);
    }
    await pool.end();

    substrate = createPostgresStorageSubstrate(pgConnStr);
  }, 60_000);

  afterAll(async () => {
    if (substrate) await substrate.close();
    if (pgContainer) await pgContainer.stop();
  }, 30_000);

  it("serializes concurrent calls for the same (class, key) via real pg_try_advisory_lock", async () => {
    if (!substrate) throw new Error("substrate not initialized");
    const order: string[] = [];
    const callA = withAdvisoryLock(substrate, LOCK_CLASS.assertIdentity, "fp-pg-serial", async () => {
      order.push("A:in");
      await new Promise((r) => setTimeout(r, 50));
      order.push("A:out");
    });
    const callB = withAdvisoryLock(substrate, LOCK_CLASS.assertIdentity, "fp-pg-serial", async () => {
      order.push("B:in");
      await new Promise((r) => setTimeout(r, 50));
      order.push("B:out");
    });
    await Promise.all([callA, callB]);
    // Serialization invariant: no INTERLEAVING. One critical section completes
    // fully before the other enters; which-goes-first is timing-dependent
    // (both orderings valid under real-pg poll-acquire race).
    expect([
      ["A:in", "A:out", "B:in", "B:out"],
      ["B:in", "B:out", "A:in", "A:out"],
    ]).toContainEqual(order);
  }, 30_000);

  it("parallelizes calls across distinct (class, key) — no cross-class serialization", async () => {
    if (!substrate) throw new Error("substrate not initialized");
    // De-flake: the original used 100ms sleeps with a `< 200` bound. The bound
    // equals the 2-way-serialized floor (2×100), so the only headroom was the
    // per-call lock overhead — and under full-suite concurrent-testcontainer load
    // that overhead (~100ms for 3 simultaneous pg advisory-lock round-trips)
    // closed the margin to exactly 200 → "expected 200 to be less than 200".
    // Widening the per-call sleep makes the fixed overhead small relative to the
    // parallel-vs-serial gap: parallel ≈ SLEEP_MS (+overhead, ~100ms); the bound
    // is 2×SLEEP_MS, so it still catches even 2-way serialization while leaving
    // ~SLEEP_MS of load headroom above the parallel floor.
    const SLEEP_MS = 300;
    const startedAt = Date.now();
    const callA = withAdvisoryLock(substrate, LOCK_CLASS.assertIdentity, "fp-pg-parA", async () => {
      await new Promise((r) => setTimeout(r, SLEEP_MS));
      return "A";
    });
    const callB = withAdvisoryLock(substrate, LOCK_CLASS.Counter, "fp-pg-parA", async () => {
      await new Promise((r) => setTimeout(r, SLEEP_MS));
      return "B";
    });
    const callC = withAdvisoryLock(substrate, LOCK_CLASS.assertIdentity, "fp-pg-parC", async () => {
      await new Promise((r) => setTimeout(r, SLEEP_MS));
      return "C";
    });
    const results = await Promise.all([callA, callB, callC]);
    const elapsed = Date.now() - startedAt;
    expect(results).toEqual(["A", "B", "C"]);
    // Parallel ≈ SLEEP_MS (+overhead); 2-way serial = 2×SLEEP_MS, full serial = 3×.
    expect(elapsed).toBeLessThan(2 * SLEEP_MS);
  }, 30_000);

  it("releases pg session-lock on fn-throw (try/finally discipline; B can acquire after A throws)", async () => {
    if (!substrate) throw new Error("substrate not initialized");
    await expect(
      withAdvisoryLock(substrate, LOCK_CLASS.assertIdentity, "fp-pg-throw", async () => {
        throw new Error("synthetic fn throw");
      }),
    ).rejects.toThrow(/synthetic fn throw/);

    // B must be able to acquire after A's session-lock was released by the finally block
    const result = await withAdvisoryLock(
      substrate,
      LOCK_CLASS.assertIdentity,
      "fp-pg-throw",
      async () => "B-acquired",
    );
    expect(result).toBe("B-acquired");
  }, 30_000);

  it("throws LockAcquisitionTimeoutError under real-pg contention", async () => {
    if (!substrate) throw new Error("substrate not initialized");
    // bug-153: deterministic acquisition ORDERING. A's fn body only runs AFTER
    // the lock is acquired, so signalling from inside it guarantees A holds the
    // lock before B attempts — B reliably contends + times out, instead of racing
    // the poll-acquire timing (under parallel-pg CI load B could otherwise WIN the
    // race, run "B-should-not-run", resolve with no timeout → this assertion fails;
    // and the un-awaited callA would then poll into afterAll's pool.end() →
    // "pool after end" at postgres-substrate.ts withAdvisoryLock).
    let signalAcquired!: () => void;
    const aAcquired = new Promise<void>((resolve) => { signalAcquired = resolve; });
    // A holds the lock for 300ms; B times out at 50ms.
    const callA = withAdvisoryLock(substrate, LOCK_CLASS.assertIdentity, "fp-pg-timeout", async () => {
      signalAcquired();
      await new Promise((r) => setTimeout(r, 300));
      return "A-done";
    });
    try {
      await aAcquired; // B contends only once A demonstrably holds the lock
      await expect(
        withAdvisoryLock(
          substrate,
          LOCK_CLASS.assertIdentity,
          "fp-pg-timeout",
          async () => "B-should-not-run",
          { timeoutMs: 50 },
        ),
      ).rejects.toBeInstanceOf(LockAcquisitionTimeoutError);
    } finally {
      // Keep the pool alive until A settles — never leak a polling op into
      // teardown, even if the assertion above throws (bug-153 (b)).
      await expect(callA).resolves.toBe("A-done");
    }
  }, 30_000);
});
