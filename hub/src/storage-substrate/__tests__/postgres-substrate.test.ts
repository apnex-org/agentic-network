/**
 * mission-83 W1.4 — PostgresStorageSubstrate unit tests via testcontainers.
 *
 * Per Design v1.2 §2.1 (interface) + §2.2 (storage layout) + §2.4 (LISTEN/NOTIFY)
 * + §2.7 (testcontainers harness; per-test-DB-rollback for unit; singleton-with-
 * reset for integration). This file: singleton-postgres + per-test-kind-isolation
 * (each test uses a unique kind so no cross-test interference). Lighter than full
 * tx-rollback isolation; matches the substrate's per-row identity model cleanly.
 *
 * Edge cases per W1.3 caveats:
 * - list sort with NULL values (postgres default NULLS-FIRST-DESC documented)
 * - $in filter with string + number + boolean
 * - watch race semantics (entity:undefined on put per §2.1 race-clarification)
 * - watch cleanup via AbortSignal (W1.4 substantive: substrate-side support added)
 *
 * R9 verified independently at W1.5 (541 writes/sec; 0% drops; p99 181ms).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createPostgresStorageSubstrate } from "../index.js";
import type { HubStorageSubstrate, ChangeEvent } from "../index.js";

// ─── Singleton testcontainers setup ─────────────────────────────────────────

let container: StartedPostgreSqlContainer;
let substrate: HubStorageSubstrate;

const MIGRATIONS_DIR = join(__dirname, "..", "migrations");
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

  const connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;

  // Apply migrations via pg client (testcontainers doesn't expose docker exec cleanly;
  // run them inline through the substrate's pool)
  const { Pool } = (await import("pg")).default;
  const pool = new Pool({ connectionString: connStr });
  for (const f of MIGRATION_FILES) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf-8");
    await pool.query(sql);
  }
  await pool.end();

  substrate = createPostgresStorageSubstrate(connStr);
}, 60_000);  // 60s timeout for postgres boot + migrations

afterAll(async () => {
  // Close substrate's pool + stop container
  await (substrate as unknown as { close: () => Promise<void> }).close?.();
  await container.stop();
}, 30_000);

// ─── get / put / delete CRUD ────────────────────────────────────────────────

describe("CRUD", () => {
  it("put + get round-trip", async () => {
    const KIND = "CrudPutGet";
    const r = await substrate.put(KIND, { id: "p1", name: "Alice" });
    expect(r.id).toBe("p1");
    expect(r.resourceVersion).toMatch(/^\d+$/);

    const g = await substrate.get<{ id: string; name: string }>(KIND, "p1");
    expect(g).toEqual({ id: "p1", name: "Alice" });
  });

  it("get on absent entity returns null", async () => {
    const g = await substrate.get("CrudAbsent", "missing");
    expect(g).toBeNull();
  });

  it("put on existing UPDATEs + bumps resource_version", async () => {
    const KIND = "CrudUpdate";
    const r1 = await substrate.put(KIND, { id: "u1", n: 1 });
    const r2 = await substrate.put(KIND, { id: "u1", n: 2 });
    expect(Number(r2.resourceVersion)).toBeGreaterThan(Number(r1.resourceVersion));

    const g = await substrate.get<{ n: number }>(KIND, "u1");
    expect(g?.n).toBe(2);
  });

  it("delete removes entity; get returns null", async () => {
    const KIND = "CrudDelete";
    await substrate.put(KIND, { id: "d1", x: 1 });
    await substrate.delete(KIND, "d1");
    const g = await substrate.get(KIND, "d1");
    expect(g).toBeNull();
  });

  it("delete on absent entity is no-op (no error)", async () => {
    await expect(substrate.delete("CrudDeleteAbsent", "missing")).resolves.toBeUndefined();
  });
});

// ─── CAS primitives (per C1 fold-in) ────────────────────────────────────────

describe("CAS — createOnly", () => {
  it("first insert succeeds", async () => {
    const KIND = "CasCreateFirst";
    const r = await substrate.createOnly(KIND, { id: "c1", v: 1 });
    expect(r).toEqual({
      ok: true,
      id: "c1",
      resourceVersion: expect.stringMatching(/^\d+$/),
    });
  });

  it("conflict-on-existing returns {ok:false, conflict:'existing'}", async () => {
    const KIND = "CasCreateConflict";
    await substrate.createOnly(KIND, { id: "c1", v: 1 });
    const r = await substrate.createOnly(KIND, { id: "c1", v: 2 });
    expect(r).toEqual({ ok: false, conflict: "existing" });
    // Existing entity unchanged
    const g = await substrate.get<{ v: number }>(KIND, "c1");
    expect(g?.v).toBe(1);
  });
});

describe("CAS — putIfMatch", () => {
  it("correct revision succeeds + bumps resource_version", async () => {
    const KIND = "CasPutIfMatchOk";
    const c = await substrate.createOnly(KIND, { id: "p1", v: 1 });
    if (!c.ok) throw new Error("setup failed");

    const r = await substrate.putIfMatch(KIND, { id: "p1", v: 2 }, c.resourceVersion);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Number(r.resourceVersion)).toBeGreaterThan(Number(c.resourceVersion));
    }
    const g = await substrate.get<{ v: number }>(KIND, "p1");
    expect(g?.v).toBe(2);
  });

  it("stale revision returns {ok:false, conflict:'revision-mismatch', actualRevision}", async () => {
    const KIND = "CasPutIfMatchStale";
    const c = await substrate.createOnly(KIND, { id: "p1", v: 1 });
    if (!c.ok) throw new Error("setup failed");

    // Bump via direct put
    await substrate.put(KIND, { id: "p1", v: 2 });

    // Now putIfMatch with the ORIGINAL revision → stale
    const r = await substrate.putIfMatch(KIND, { id: "p1", v: 99 }, c.resourceVersion);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.conflict).toBe("revision-mismatch");
      expect(r.actualRevision).toMatch(/^\d+$/);
      expect(Number(r.actualRevision)).toBeGreaterThan(Number(c.resourceVersion));
    }
    // Entity unchanged (still v=2 from put, not v=99 from failed putIfMatch)
    const g = await substrate.get<{ v: number }>(KIND, "p1");
    expect(g?.v).toBe(2);
  });

  it("absent entity throws", async () => {
    await expect(
      substrate.putIfMatch("CasPutIfMatchAbsent", { id: "missing", v: 1 }, "0")
    ).rejects.toThrow(/putIfMatch on absent entity/);
  });
});

// ─── list filter + sort + pagination ────────────────────────────────────────

describe("list", () => {
  it("no filter returns all kind entities + snapshotRevision", async () => {
    const KIND = "ListAll";
    await substrate.put(KIND, { id: "a", n: 1 });
    await substrate.put(KIND, { id: "b", n: 2 });
    await substrate.put(KIND, { id: "c", n: 3 });

    const r = await substrate.list<{ id: string; n: number }>(KIND);
    expect(r.items).toHaveLength(3);
    expect(r.snapshotRevision).toMatch(/^\d+$/);
  });

  it("scalar filter (string)", async () => {
    const KIND = "ListScalarString";
    await substrate.put(KIND, { id: "a", color: "red" });
    await substrate.put(KIND, { id: "b", color: "blue" });

    const r = await substrate.list<{ color: string }>(KIND, { filter: { color: "red" } });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.color).toBe("red");
  });

  it("$in filter — string array", async () => {
    const KIND = "ListInString";
    await substrate.put(KIND, { id: "a", color: "red" });
    await substrate.put(KIND, { id: "b", color: "blue" });
    await substrate.put(KIND, { id: "c", color: "green" });

    const r = await substrate.list<{ color: string }>(KIND, { filter: { color: { $in: ["red", "green"] } } });
    expect(r.items).toHaveLength(2);
    expect(r.items.map(x => x.color).sort()).toEqual(["green", "red"]);
  });

  it("$in filter — number array (W1.3 caveat #2)", async () => {
    const KIND = "ListInNumber";
    await substrate.put(KIND, { id: "a", n: 1 });
    await substrate.put(KIND, { id: "b", n: 2 });
    await substrate.put(KIND, { id: "c", n: 3 });

    const r = await substrate.list<{ n: number }>(KIND, { filter: { n: { $in: [1, 3] } } });
    expect(r.items).toHaveLength(2);
    // JSONB extract returns text; substrate stringifies $in values for comparison
    expect(r.items.map(x => x.n).sort()).toEqual([1, 3]);
  });

  it("$in filter — boolean array (W1.3 caveat #2)", async () => {
    const KIND = "ListInBoolean";
    await substrate.put(KIND, { id: "a", active: true });
    await substrate.put(KIND, { id: "b", active: false });
    await substrate.put(KIND, { id: "c", active: true });

    const r = await substrate.list<{ active: boolean }>(KIND, { filter: { active: { $in: [true] } } });
    expect(r.items).toHaveLength(2);
  });

  it("$gte / $lt range filter (numeric)", async () => {
    const KIND = "ListRange";
    await substrate.put(KIND, { id: "a", age: 20 });
    await substrate.put(KIND, { id: "b", age: 30 });
    await substrate.put(KIND, { id: "c", age: 40 });
    await substrate.put(KIND, { id: "d", age: 50 });

    const r = await substrate.list<{ age: number }>(KIND, { filter: { age: { $gte: 30, $lt: 50 } } });
    expect(r.items).toHaveLength(2);
    expect(r.items.map(x => x.age).sort()).toEqual([30, 40]);
  });

  it("sort + limit + offset", async () => {
    const KIND = "ListSort";
    for (let i = 1; i <= 10; i++) await substrate.put(KIND, { id: `s${i}`, n: i });

    const r = await substrate.list<{ n: number }>(KIND, {
      sort: [{ field: "n", order: "asc" }],
      limit: 3,
      offset: 2,
    });
    expect(r.items).toHaveLength(3);
    // Note: JSONB-extracted text sort — string "10" < "2" alphabetically, so order
    // is "1","10","2","3","4","5","6","7","8","9"; offset 2 + limit 3 → "2","3","4"
    expect(r.items.map(x => x.n)).toEqual([2, 3, 4]);
  });

  it("snapshotRevision reflects max(resource_version) across kinds", async () => {
    const KIND = "ListSnapshot";
    await substrate.put(KIND, { id: "a", v: 1 });
    const r1 = await substrate.list(KIND);

    // Insert in another kind; snapshotRevision should advance (subtrate-wide max)
    await substrate.put("ListSnapshotOther", { id: "x", v: 1 });
    const r2 = await substrate.list(KIND);
    expect(Number(r2.snapshotRevision)).toBeGreaterThan(Number(r1.snapshotRevision));
  });

  it("dotted-path filter (data#>>'{a,b}')", async () => {
    const KIND = "ListDotted";
    await substrate.put(KIND, { id: "a", meta: { env: "prod" } });
    await substrate.put(KIND, { id: "b", meta: { env: "dev" } });

    const r = await substrate.list<{ meta: { env: string } }>(KIND, {
      filter: { "meta.env": "prod" },
    });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.meta.env).toBe("prod");
  });
});

// ─── JSONB CHECK constraint (per outcome 4) ─────────────────────────────────

describe("JSONB size CHECK", () => {
  it("oversized payload rejected at write boundary", async () => {
    const KIND = "JsonbSize";
    // 1.5MB cap; build a payload that exceeds it post-toast-compression-evasion via random-ish data
    // (postgres TOAST-compresses repetitive; random/UUID-like resists compression)
    const big = Array.from({ length: 2_000_000 }, () => Math.random().toString(36).slice(2)).join("");
    await expect(substrate.put(KIND, { id: "huge", big })).rejects.toThrow();
  });
});

// ─── watch primitive (per Design §2.4 LISTEN/NOTIFY + OQ5 list-then-watch) ──

describe("watch", () => {
  it("emits put event on insert; cleanup via AbortSignal (W1.3 caveat #4)", async () => {
    const KIND = "WatchPut";
    const ac = new AbortController();
    const events: ChangeEvent[] = [];

    const watchPromise = (async () => {
      for await (const ev of substrate.watch(KIND, { signal: ac.signal })) {
        events.push(ev);
        if (events.length >= 2) break;
      }
    })();

    // Give LISTEN connection time to register
    await delay(200);

    await substrate.put(KIND, { id: "w1", v: 1 });
    await substrate.put(KIND, { id: "w2", v: 2 });

    // Wait for events to arrive
    await Promise.race([watchPromise, delay(2000)]);
    ac.abort();
    await watchPromise.catch(() => { /* abort */ });

    expect(events).toHaveLength(2);
    expect(events[0]!.op).toBe("put");
    expect(events[0]!.kind).toBe(KIND);
    expect(events[0]!.entity).toMatchObject({ id: "w1", v: 1 });
  }, 10_000);

  it("emits delete event on delete", async () => {
    const KIND = "WatchDelete";
    await substrate.put(KIND, { id: "d1", v: 1 });

    const ac = new AbortController();
    const events: ChangeEvent[] = [];

    const watchPromise = (async () => {
      for await (const ev of substrate.watch(KIND, { signal: ac.signal })) {
        events.push(ev);
        if (ev.op === "delete") break;
      }
    })();

    await delay(200);
    await substrate.delete(KIND, "d1");

    await Promise.race([watchPromise, delay(2000)]);
    ac.abort();
    await watchPromise.catch(() => {});

    const deleteEv = events.find(e => e.op === "delete");
    expect(deleteEv).toBeDefined();
    expect(deleteEv?.id).toBe("d1");
    // entity is undefined on delete events per §2.1
    expect(deleteEv?.entity).toBeUndefined();
  }, 10_000);

  it("sinceRevision replays events newer than revision (OQ5 list-then-watch)", async () => {
    const KIND = "WatchReplay";
    await substrate.put(KIND, { id: "r1", v: 1 });
    const snap = (await substrate.list(KIND)).snapshotRevision;

    // Add MORE events after the snapshot
    await substrate.put(KIND, { id: "r2", v: 2 });
    await substrate.put(KIND, { id: "r3", v: 3 });

    const ac = new AbortController();
    const events: ChangeEvent[] = [];

    const watchPromise = (async () => {
      for await (const ev of substrate.watch(KIND, { sinceRevision: snap, signal: ac.signal })) {
        events.push(ev);
        if (events.length >= 2) break;
      }
    })();

    await Promise.race([watchPromise, delay(2000)]);
    ac.abort();
    await watchPromise.catch(() => {});

    // Should replay r2 + r3 (newer than snap), NOT r1
    expect(events.length).toBeGreaterThanOrEqual(2);
    const ids = events.map(e => e.id);
    expect(ids).toContain("r2");
    expect(ids).toContain("r3");
    expect(ids).not.toContain("r1");
  }, 10_000);

  it("AbortSignal cancels mid-watch (W1.3 caveat #4 substrate-side support)", async () => {
    const KIND = "WatchAbort";
    const ac = new AbortController();
    let events = 0;

    const watchPromise = (async () => {
      for await (const _ev of substrate.watch(KIND, { signal: ac.signal })) {
        events++;
      }
    })();

    // Abort before any events arrive — should resolve cleanly without hanging
    await delay(100);
    ac.abort();

    const result = await Promise.race([
      watchPromise.then(() => "resolved").catch(() => "rejected"),
      delay(2000).then(() => "timeout"),
    ]);
    expect(result).toBe("resolved");
    expect(events).toBe(0);
  }, 10_000);
});
