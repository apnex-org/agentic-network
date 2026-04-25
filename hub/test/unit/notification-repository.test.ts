/**
 * NotificationRepository — repository-level coverage parameterized
 * across StorageProvider variants (Memory + LocalFs).
 *
 * Mission-49 W9 (sibling of W8 audit-repository.test.ts). Covers:
 *   - ULID monotonicity + lex-sortability (matches both Memory and Gcs
 *     legacy implementations' ulidx/monotonicFactory contract).
 *   - listSince ordering: lex-ascending (chronological for ULIDs);
 *     `afterId=""` returns all; `afterId=ULID` strictly-greater filter.
 *   - Role filter on listSince.
 *   - TTL boundary on cleanup: `< cutoff` deletes, `>= cutoff` keeps
 *     (off-by-one parity with legacy semantic).
 *   - persist/listSince round-trip + namespace isolation
 *     (`notifications/v2/` only).
 *
 * GCS provider variant is exercised at the primitive layer by the
 * @ois/storage-provider conformance suite — not duplicated here.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LocalFsStorageProvider,
  MemoryStorageProvider,
  type StorageProvider,
} from "@ois/storage-provider";

import { NotificationRepository } from "../../src/entities/notification-repository.js";

interface ProviderFixture {
  name: string;
  setup: () => Promise<{ provider: StorageProvider; cleanup: () => Promise<void> }>;
}

const fixtures: ProviderFixture[] = [
  {
    name: "MemoryStorageProvider",
    setup: async () => ({
      provider: new MemoryStorageProvider(),
      cleanup: async () => { /* noop */ },
    }),
  },
  {
    name: "LocalFsStorageProvider",
    setup: async () => {
      const root = await mkdtemp(join(tmpdir(), "notif-repo-test-"));
      return {
        provider: new LocalFsStorageProvider(root),
        cleanup: async () => { await rm(root, { recursive: true, force: true }); },
      };
    },
  },
];

for (const fixture of fixtures) {
  describe(`NotificationRepository — ${fixture.name}`, () => {
    let provider: StorageProvider;
    let cleanup: () => Promise<void>;
    let repo: NotificationRepository;

    beforeEach(async () => {
      const handle = await fixture.setup();
      provider = handle.provider;
      cleanup = handle.cleanup;
      repo = new NotificationRepository(provider);
    });

    afterEach(async () => {
      await cleanup();
    });

    describe("ULID monotonicity + lex-sortability", () => {
      it("issues monotonically-increasing ULID IDs", async () => {
        const ids: string[] = [];
        for (let i = 0; i < 10; i++) {
          const n = await repo.persist("test", { i }, ["engineer"]);
          ids.push(n.id as string);
        }
        // ULID IDs are 26-char strings; monotonicFactory guarantees
        // strictly increasing.
        for (const id of ids) {
          expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
        }
        const sortedAsc = [...ids].sort();
        expect(sortedAsc).toEqual(ids);
      });

      it("yields N unique IDs across N rapid-fire persist calls", async () => {
        const N = 50;
        const promises = Array.from({ length: N }, (_, i) =>
          repo.persist("burst", { i }, ["hub"]),
        );
        const out = await Promise.all(promises);
        const ids = new Set(out.map((n) => n.id));
        expect(ids.size).toBe(N);
      });
    });

    describe("listSince ordering + cursor semantics", () => {
      it("returns all notifications when afterId is empty string", async () => {
        await repo.persist("e1", {}, ["engineer"]);
        await repo.persist("e2", {}, ["engineer"]);
        await repo.persist("e3", {}, ["engineer"]);
        const all = await repo.listSince("");
        expect(all.map((n) => n.event)).toEqual(["e1", "e2", "e3"]);
      });

      it("returns lex-ascending (chronological for ULIDs)", async () => {
        for (let i = 0; i < 5; i++) {
          await repo.persist(`e${i}`, {}, ["engineer"]);
        }
        const out = await repo.listSince("");
        const ids = out.map((n) => n.id as string);
        const sortedAsc = [...ids].sort();
        expect(ids).toEqual(sortedAsc);
      });

      it("filters strictly-greater than afterId cursor", async () => {
        const a = await repo.persist("a", {}, ["engineer"]);
        const b = await repo.persist("b", {}, ["engineer"]);
        const c = await repo.persist("c", {}, ["engineer"]);
        const sinceA = await repo.listSince(a.id);
        expect(sinceA.map((n) => n.event)).toEqual(["b", "c"]);
        const sinceB = await repo.listSince(b.id);
        expect(sinceB.map((n) => n.event)).toEqual(["c"]);
        const sinceC = await repo.listSince(c.id);
        expect(sinceC).toEqual([]);
      });

      it("returns empty list on a fresh repository", async () => {
        const out = await repo.listSince("");
        expect(out).toEqual([]);
      });
    });

    describe("role filter on listSince", () => {
      it("returns only notifications targeting the requested role", async () => {
        await repo.persist("e-only", {}, ["engineer"]);
        await repo.persist("a-only", {}, ["architect"]);
        await repo.persist("both", {}, ["engineer", "architect"]);
        await repo.persist("hub-only", {}, ["hub"]);
        const eng = await repo.listSince("", "engineer");
        expect(eng.map((n) => n.event).sort()).toEqual(["both", "e-only"]);
        const arch = await repo.listSince("", "architect");
        expect(arch.map((n) => n.event).sort()).toEqual(["a-only", "both"]);
        const hub = await repo.listSince("", "hub");
        expect(hub.map((n) => n.event)).toEqual(["hub-only"]);
      });
    });

    describe("cleanup TTL boundary", () => {
      it("deletes strictly-older-than cutoff; keeps everything else", async () => {
        // Persist 3 entries with controlled timestamps. Use direct
        // provider writes so we can backdate without faking the clock.
        const now = Date.now();
        const oldUlid = "01H0000000000000000000000A"; // lex-stable old
        const midUlid = "01H0000000000000000000000B";
        const newUlid = "01H0000000000000000000000C";
        const write = async (id: string, ts: number) => {
          const n = {
            id,
            event: `at-${ts}`,
            targetRoles: ["hub"],
            data: {},
            timestamp: new Date(ts).toISOString(),
          };
          await provider.put(`notifications/v2/${id}.json`,
            new TextEncoder().encode(JSON.stringify(n, null, 2)));
        };
        await write(oldUlid, now - 60_000);  // 60s old
        await write(midUlid, now - 5_000);   // 5s old
        await write(newUlid, now);           // current

        // Cleanup with maxAge=10s → cutoff is `now - 10_000`.
        // oldUlid (now - 60_000) < cutoff → DELETE
        // midUlid (now - 5_000)  >= cutoff → KEEP
        // newUlid (now)          >= cutoff → KEEP
        const deleted = await repo.cleanup(10_000);
        expect(deleted).toBe(1);

        const remaining = await repo.listSince("");
        const remainingIds = remaining.map((n) => n.id);
        expect(remainingIds).toContain(midUlid);
        expect(remainingIds).toContain(newUlid);
        expect(remainingIds).not.toContain(oldUlid);
      });

      it("returns 0 on a fresh repository (nothing to clean)", async () => {
        const deleted = await repo.cleanup(60_000);
        expect(deleted).toBe(0);
      });
    });

    describe("notifications/v2/ namespace isolation", () => {
      it("writes only under notifications/v2/ — legacy notifications/ untouched", async () => {
        await repo.persist("ns-test", {}, ["hub"]);
        const v2Keys = await provider.list("notifications/v2/");
        const allKeys = await provider.list("notifications/");
        expect(v2Keys.some((k) => k.startsWith("notifications/v2/"))).toBe(true);
        const nonV2 = allKeys.filter((k) => !k.startsWith("notifications/v2/"));
        expect(nonV2).toEqual([]);
      });
    });

    describe("persist/listSince round-trip body fidelity", () => {
      it("preserves event + data + targetRoles + timestamp through persistence", async () => {
        const before = Date.now();
        const n = await repo.persist("custom", { foo: "bar", n: 7 }, ["architect", "engineer"]);
        const after = Date.now();
        const out = await repo.listSince("");
        expect(out).toHaveLength(1);
        const round = out[0];
        expect(round.id).toBe(n.id);
        expect(round.event).toBe("custom");
        expect(round.data).toEqual({ foo: "bar", n: 7 });
        expect(round.targetRoles).toEqual(["architect", "engineer"]);
        const tsMs = new Date(round.timestamp).getTime();
        expect(tsMs).toBeGreaterThanOrEqual(before);
        expect(tsMs).toBeLessThanOrEqual(after);
      });
    });
  });
}
