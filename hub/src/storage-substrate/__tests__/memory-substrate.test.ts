/**
 * mission-84 W0.2 — MemoryHubStorageSubstrate per-method parity baseline.
 *
 * Each test exercises one HubStorageSubstrate primitive in isolation, verifying
 * the memory impl produces semantically identical behavior to postgres impl per
 * the interface contract at ../types.ts. This is the baseline that W1's
 * SubstrateConformanceSuite (PORT-then-EXTEND from packages/storage-provider/
 * test/conformance.ts) generalizes via describe.each([memoryFactory, postgresFactory]).
 *
 * Not a replacement for the conformance suite — that runs both impls under
 * identical assertions. This file: focused unit-test of memory-only behavior +
 * shape-conformance smoke (every primitive callable; expected error types thrown).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStorageSubstrate } from "../memory-substrate.js";
import type { HubStorageSubstrate, ChangeEvent } from "../types.js";

describe("MemoryHubStorageSubstrate — per-method parity baseline", () => {
  let substrate: HubStorageSubstrate;

  beforeEach(() => {
    // mission-90 W8: raw storage — this suite tests the substrate PRIMITIVE
    // (put/get/CAS/watch round-trip + matchesFilter) below the envelope contract.
    substrate = createMemoryStorageSubstrate({ rawWrites: true });
  });

  // ── get + put ─────────────────────────────────────────────────────────────

  describe("get + put", () => {
    it("get returns null for absent kind+id", async () => {
      expect(await substrate.get("Bug", "bug-1")).toBeNull();
    });

    it("put then get returns the entity (deep-equal)", async () => {
      await substrate.put("Bug", { id: "bug-1", status: "open", title: "leak" });
      const got = await substrate.get<{ id: string; status: string; title: string }>("Bug", "bug-1");
      expect(got).toEqual({ id: "bug-1", status: "open", title: "leak" });
    });

    it("put returns {id, resourceVersion}", async () => {
      const r = await substrate.put("Bug", { id: "bug-2", status: "open" });
      expect(r.id).toBe("bug-2");
      expect(r.resourceVersion).toMatch(/^\d+$/);
    });

    it("put advances resourceVersion monotonically across kinds", async () => {
      const a = await substrate.put("Bug", { id: "bug-3" });
      const b = await substrate.put("Idea", { id: "idea-1" });
      const c = await substrate.put("Bug", { id: "bug-3", v: 2 });
      expect(Number(a.resourceVersion)).toBeLessThan(Number(b.resourceVersion));
      expect(Number(b.resourceVersion)).toBeLessThan(Number(c.resourceVersion));
    });

    it("get returns defensive copy (caller mutation does not affect store)", async () => {
      await substrate.put("Bug", { id: "bug-4", status: "open" });
      const got = await substrate.get<{ id: string; status: string }>("Bug", "bug-4");
      got!.status = "MUTATED";
      const reread = await substrate.get<{ id: string; status: string }>("Bug", "bug-4");
      expect(reread!.status).toBe("open");
    });

    it("Counter kind special-case: id always 'counter'", async () => {
      await substrate.put("Counter", { bugCounter: 5 });
      const r = await substrate.get<{ bugCounter: number }>("Counter", "counter");
      expect(r).toEqual({ bugCounter: 5 });
    });

    it("non-Counter kind requires entity.id", async () => {
      await expect(substrate.put("Bug", { status: "open" })).rejects.toThrow(/missing required 'id'/);
    });
  });

  // ── getWithRevision ───────────────────────────────────────────────────────

  describe("getWithRevision", () => {
    it("returns null for absent kind+id", async () => {
      expect(await substrate.getWithRevision("Bug", "bug-x")).toBeNull();
    });

    it("returns {entity, resourceVersion} for present", async () => {
      const put = await substrate.put("Bug", { id: "bug-5", status: "open" });
      const got = await substrate.getWithRevision<{ id: string; status: string }>("Bug", "bug-5");
      expect(got).toEqual({
        entity: { id: "bug-5", status: "open" },
        resourceVersion: put.resourceVersion,
      });
    });

    it("revision tracks the latest put", async () => {
      const r1 = await substrate.put("Bug", { id: "bug-6", v: 1 });
      const r2 = await substrate.put("Bug", { id: "bug-6", v: 2 });
      const got = await substrate.getWithRevision("Bug", "bug-6");
      expect(got!.resourceVersion).toBe(r2.resourceVersion);
      expect(got!.resourceVersion).not.toBe(r1.resourceVersion);
    });
  });

  // ── delete ────────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("removes the entity", async () => {
      await substrate.put("Bug", { id: "bug-7" });
      await substrate.delete("Bug", "bug-7");
      expect(await substrate.get("Bug", "bug-7")).toBeNull();
    });

    it("is idempotent on absent kind+id", async () => {
      await expect(substrate.delete("Bug", "nonexistent")).resolves.toBeUndefined();
    });
  });

  // ── list ──────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("returns empty for empty kind", async () => {
      const r = await substrate.list("Bug");
      expect(r.items).toEqual([]);
      expect(r.snapshotRevision).toMatch(/^\d+$/);
    });

    it("returns all entities of the kind", async () => {
      await substrate.put("Bug", { id: "bug-8", status: "open" });
      await substrate.put("Bug", { id: "bug-9", status: "resolved" });
      await substrate.put("Idea", { id: "idea-2" });
      const r = await substrate.list<{ id: string }>("Bug");
      expect(r.items.map(i => i.id).sort()).toEqual(["bug-8", "bug-9"]);
    });

    it("filter by scalar field equality", async () => {
      // mission-90 W8: envelope-shaped fixtures — matchesFilter translates the bare
      // `status` filter to the status.phase envelope path (envelope-only substrate).
      await substrate.put("Bug", { id: "bug-10", status: { phase: "open" } });
      await substrate.put("Bug", { id: "bug-11", status: { phase: "resolved" } });
      const r = await substrate.list<{ id: string }>("Bug", { filter: { status: "open" } });
      expect(r.items.map(i => i.id)).toEqual(["bug-10"]);
    });

    it("filter $in operator", async () => {
      await substrate.put("Bug", { id: "bug-12", status: { phase: "open" } });
      await substrate.put("Bug", { id: "bug-13", status: { phase: "resolved" } });
      await substrate.put("Bug", { id: "bug-14", status: { phase: "wontfix" } });
      const r = await substrate.list<{ id: string }>("Bug", {
        filter: { status: { $in: ["open", "resolved"] } },
      });
      expect(r.items.map(i => i.id).sort()).toEqual(["bug-12", "bug-13"]);
    });

    it("filter $gt/$lte range — numeric operands compare numerically", async () => {
      for (let i = 1; i <= 5; i++) {
        await substrate.put("Bug", { id: `bug-n${i}`, priority: i });
      }
      const r = await substrate.list<{ id: string }>("Bug", {
        filter: { priority: { $gt: 2, $lte: 4 } },
      });
      expect(r.items.map(i => i.id).sort()).toEqual(["bug-n3", "bug-n4"]);
    });

    it("filter $gt — non-numeric (ULID) operands compare lexically (bug-104)", async () => {
      // bug-104: the `since` ULID-cursor pushes `{id: {$gt: <ulid>}}` into the
      // substrate filter. ULIDs lex-sort = time-sort but are not numeric — the
      // prior numeric-only compare yielded NaN → rejected every row. Range
      // comparison must fall back to lexical string comparison (matching
      // postgres `data->>'field' > $param` text semantics).
      for (const id of ["01AAA", "01BBB", "01CCC", "01DDD"]) {
        await substrate.put("Bug", { id });
      }
      const r = await substrate.list<{ id: string }>("Bug", {
        filter: { id: { $gt: "01BBB" } },
      });
      expect(r.items.map(i => i.id).sort()).toEqual(["01CCC", "01DDD"]);
    });

    it("sort + limit + offset", async () => {
      for (let i = 1; i <= 5; i++) {
        await substrate.put("Bug", { id: `bug-${i}`, priority: i });
      }
      const r = await substrate.list<{ id: string; priority: number }>("Bug", {
        sort: [{ field: "priority", order: "desc" }],
        limit: 2,
        offset: 1,
      });
      expect(r.items.map(i => i.id)).toEqual(["bug-4", "bug-3"]);
    });

    it("snapshotRevision reflects substrate-wide max revision", async () => {
      await substrate.put("Bug", { id: "bug-15" });
      await substrate.put("Idea", { id: "idea-3" });
      const r = await substrate.list("Bug");
      // snapshotRevision is substrate-wide (not just Bug kind)
      expect(Number(r.snapshotRevision)).toBeGreaterThanOrEqual(2);
    });
  });

  // ── createOnly ────────────────────────────────────────────────────────────

  describe("createOnly", () => {
    it("succeeds on first write", async () => {
      const r = await substrate.createOnly("Bug", { id: "bug-16", status: "open" });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.id).toBe("bug-16");
        expect(r.resourceVersion).toMatch(/^\d+$/);
      }
    });

    it("returns {ok: false, conflict: 'existing'} when kind+id exists", async () => {
      await substrate.createOnly("Bug", { id: "bug-17", status: "open" });
      const r2 = await substrate.createOnly("Bug", { id: "bug-17", status: "overwrite" });
      expect(r2.ok).toBe(false);
      if (!r2.ok) expect(r2.conflict).toBe("existing");
      // Original unchanged
      const got = await substrate.get<{ status: string }>("Bug", "bug-17");
      expect(got!.status).toBe("open");
    });

    it("unconditional put can clobber createOnly entity", async () => {
      await substrate.createOnly("Bug", { id: "bug-18", v: 1 });
      await substrate.put("Bug", { id: "bug-18", v: 2 });
      const got = await substrate.get<{ v: number }>("Bug", "bug-18");
      expect(got!.v).toBe(2);
    });
  });

  // ── putIfMatch ────────────────────────────────────────────────────────────

  describe("putIfMatch", () => {
    it("throws on absent entity (matches postgres semantic)", async () => {
      await expect(
        substrate.putIfMatch("Bug", { id: "bug-19" }, "any-rv"),
      ).rejects.toThrow(/putIfMatch on absent entity/);
    });

    it("succeeds when expectedRevision matches; returns new resourceVersion", async () => {
      const r1 = await substrate.put("Bug", { id: "bug-20", v: 1 });
      const r2 = await substrate.putIfMatch("Bug", { id: "bug-20", v: 2 }, r1.resourceVersion);
      expect(r2.ok).toBe(true);
      if (r2.ok) expect(r2.resourceVersion).not.toBe(r1.resourceVersion);
      const got = await substrate.get<{ v: number }>("Bug", "bug-20");
      expect(got!.v).toBe(2);
    });

    it("fails with current resourceVersion when expectedRevision stale", async () => {
      await substrate.put("Bug", { id: "bug-21", v: 1 });
      const r1 = await substrate.getWithRevision("Bug", "bug-21");
      // Concurrent writer
      const r2 = await substrate.put("Bug", { id: "bug-21", v: 2 });
      const result = await substrate.putIfMatch("Bug", { id: "bug-21", v: 3 }, r1!.resourceVersion);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.conflict).toBe("revision-mismatch");
        expect(result.actualRevision).toBe(r2.resourceVersion);
      }
      // Concurrent writer's value unchanged
      const got = await substrate.get<{ v: number }>("Bug", "bug-21");
      expect(got!.v).toBe(2);
    });

    it("successful putIfMatch returns rv usable for chained CAS", async () => {
      await substrate.put("Bug", { id: "bug-22", v: 1 });
      const r1 = await substrate.getWithRevision("Bug", "bug-22");
      const r2 = await substrate.putIfMatch("Bug", { id: "bug-22", v: 2 }, r1!.resourceVersion);
      expect(r2.ok).toBe(true);
      if (r2.ok) {
        const r3 = await substrate.putIfMatch("Bug", { id: "bug-22", v: 3 }, r2.resourceVersion);
        expect(r3.ok).toBe(true);
      }
    });
  });

  // ── watch (basic smoke; full coverage via W1 conformance suite) ───────────

  describe("watch", () => {
    it("fires on put + delete (basic smoke)", async () => {
      const events: ChangeEvent[] = [];
      const ac = new AbortController();

      // Consumer task
      const consumer = (async () => {
        for await (const event of substrate.watch("Bug", { signal: ac.signal })) {
          events.push(event);
          if (events.length >= 2) {
            ac.abort();
            return;
          }
        }
      })();

      // Allow consumer to subscribe before producing
      await new Promise(r => setImmediate(r));
      await substrate.put("Bug", { id: "bug-23", status: "open" });
      await substrate.delete("Bug", "bug-23");
      await consumer;

      expect(events).toHaveLength(2);
      expect(events[0]!.op).toBe("put");
      expect(events[0]!.kind).toBe("Bug");
      expect(events[0]!.id).toBe("bug-23");
      expect(events[0]!.entity).toEqual({ id: "bug-23", status: "open" });
      expect(events[1]!.op).toBe("delete");
      expect(events[1]!.entity).toBeUndefined();
    });

    it("AbortSignal cancels the iterator", async () => {
      const ac = new AbortController();
      const iter = substrate.watch("Bug", { signal: ac.signal });
      ac.abort();
      // First .next() after abort returns done
      const result = await iter[Symbol.asyncIterator]().next();
      expect(result.done).toBe(true);
    });

    it("filter narrows received events (client-side)", async () => {
      const events: ChangeEvent[] = [];
      const ac = new AbortController();
      const consumer = (async () => {
        for await (const event of substrate.watch("Bug", {
          filter: { status: "open" },
          signal: ac.signal,
        })) {
          events.push(event);
          if (events.length >= 1) {
            ac.abort();
            return;
          }
        }
      })();

      await new Promise(r => setImmediate(r));
      await substrate.put("Bug", { id: "bug-24", status: { phase: "resolved" } });
      await substrate.put("Bug", { id: "bug-25", status: { phase: "open" } });
      await consumer;

      expect(events).toHaveLength(1);
      expect(events[0]!.id).toBe("bug-25");
    });

    it("sinceRevision replays current entities with rv > sinceRevision", async () => {
      const r1 = await substrate.put("Bug", { id: "bug-26", v: 1 });
      await substrate.put("Bug", { id: "bug-27", v: 2 });

      const events: ChangeEvent[] = [];
      const ac = new AbortController();
      const consumer = (async () => {
        for await (const event of substrate.watch("Bug", {
          sinceRevision: r1.resourceVersion,
          signal: ac.signal,
        })) {
          events.push(event);
          if (events.length >= 1) {
            ac.abort();
            return;
          }
        }
      })();
      await consumer;

      // Only bug-27 has rv > bug-26's rv
      expect(events).toHaveLength(1);
      expect(events[0]!.id).toBe("bug-27");
    });
  });

  // ── Schema convenience-wrappers (throw per parity with postgres) ──────────

  describe("schema convenience-wrappers (throw per W1 substrate-shell parity)", () => {
    it("applySchema throws", async () => {
      await expect(substrate.applySchema({
        kind: "X", version: 1, fields: [], indexes: [], watchable: true,
      })).rejects.toThrow(/applySchema convenience-wrapper not implemented/);
    });

    it("listSchemas throws", async () => {
      await expect(substrate.listSchemas()).rejects.toThrow(/listSchemas convenience-wrapper not implemented/);
    });

    it("getSchema throws", async () => {
      await expect(substrate.getSchema("X")).rejects.toThrow(/getSchema convenience-wrapper not implemented/);
    });

    it("SchemaDef-kind entities work via put/get/list (reconciler bootstrap path)", async () => {
      await substrate.put("SchemaDef", {
        id: "Bug",
        kind: "Bug", version: 1, fields: [], indexes: [], watchable: true,
      });
      const got = await substrate.get("SchemaDef", "Bug");
      expect(got).toBeDefined();
    });
  });

  // ── snapshot / restore (throw per memory-impl design) ─────────────────────

  describe("snapshot / restore (memory N/A by design)", () => {
    it("snapshot throws", async () => {
      await expect(substrate.snapshot("/tmp/x")).rejects.toThrow(/snapshot N\/A by design/);
    });

    it("restore throws", async () => {
      await expect(substrate.restore({
        path: "/tmp/x", sizeBytes: 0, snapshotAt: "", schemaVersion: 1, entityCount: 0,
      })).rejects.toThrow(/restore N\/A by design/);
    });
  });
});
