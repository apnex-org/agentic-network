/**
 * AuditRepository — repository-level coverage parameterized across
 * StorageProvider variants (Memory + LocalFs).
 *
 * Mission-49 W8 (thread-304 design round). Covers the migration's
 * specific deliverables:
 *   - Counter-based unpadded `audit-${N}` ID format (NOT padded, NOT
 *     timestamp-derived).
 *   - Newest-first ordering on `listEntries` via numeric counter sort
 *     (NOT lex sort — under lex, `audit-10` would precede `audit-2`,
 *     a regression the migration must not introduce).
 *   - Actor filter on `listEntries`.
 *   - Limit param on `listEntries`.
 *   - Collision-free invariant: rapid-fire logEntry calls always yield
 *     distinct IDs. Validates the emergent-correctness fix over the
 *     legacy `GcsAuditStore.logEntry` same-ms collision class.
 *   - `audit/v2/` namespace isolation: writes do not land under the
 *     legacy `audit/` prefix.
 *
 * GCS provider variant is exercised via the @ois/storage-provider
 * conformance suite at the primitive layer (createOnly/list/get
 * semantics that AuditRepository composes over), which is not in scope
 * here — repository-level invariants only.
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

import { AuditRepository } from "../../src/entities/audit-repository.js";
import { StorageBackedCounter } from "../../src/entities/counter.js";

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
      const root = await mkdtemp(join(tmpdir(), "audit-repo-test-"));
      return {
        provider: new LocalFsStorageProvider(root),
        cleanup: async () => { await rm(root, { recursive: true, force: true }); },
      };
    },
  },
];

for (const fixture of fixtures) {
  describe(`AuditRepository — ${fixture.name}`, () => {
    let provider: StorageProvider;
    let cleanup: () => Promise<void>;
    let repo: AuditRepository;

    beforeEach(async () => {
      const handle = await fixture.setup();
      provider = handle.provider;
      cleanup = handle.cleanup;
      repo = new AuditRepository(provider, new StorageBackedCounter(provider));
    });

    afterEach(async () => {
      await cleanup();
    });

    describe("ID format", () => {
      it("issues unpadded `audit-${N}` IDs starting at 1", async () => {
        const a = await repo.logEntry("architect", "test", "first");
        const b = await repo.logEntry("engineer", "test", "second");
        const c = await repo.logEntry("hub", "test", "third");
        expect(a.id).toBe("audit-1");
        expect(b.id).toBe("audit-2");
        expect(c.id).toBe("audit-3");
      });

      it("does not pad the counter (matches Hub entity keyspace)", async () => {
        for (let i = 0; i < 11; i++) {
          await repo.logEntry("hub", "burst", `entry-${i}`);
        }
        const all = await repo.listEntries(20);
        const ids = all.map((e) => e.id).sort();
        // Lex-sort would interleave: audit-1, audit-10, audit-11, audit-2, ...
        // We just assert no leading zeroes in any ID.
        for (const id of ids) {
          expect(id).toMatch(/^audit-[1-9]\d*$/);
        }
      });
    });

    describe("listEntries ordering — newest-first via numeric counter sort", () => {
      it("returns most-recent-first across the lex-vs-numeric boundary", async () => {
        // Cross the boundary where lex sort breaks: audit-9 vs audit-10.
        for (let i = 0; i < 12; i++) {
          await repo.logEntry("hub", "seq", `entry-${i}`);
        }
        const entries = await repo.listEntries(50);
        const ids = entries.map((e) => e.id);
        // Most recent first: audit-12, audit-11, ..., audit-1.
        // Under lex sort this would be audit-9, audit-8, ..., audit-12, ...
        expect(ids[0]).toBe("audit-12");
        expect(ids[1]).toBe("audit-11");
        expect(ids[2]).toBe("audit-10");
        expect(ids[3]).toBe("audit-9");
        expect(ids[ids.length - 1]).toBe("audit-1");
      });
    });

    describe("listEntries filtering and limit", () => {
      it("filters by actor", async () => {
        await repo.logEntry("architect", "a1", "");
        await repo.logEntry("engineer", "e1", "");
        await repo.logEntry("architect", "a2", "");
        await repo.logEntry("hub", "h1", "");
        const arch = await repo.listEntries(50, "architect");
        expect(arch.map((e) => e.action)).toEqual(["a2", "a1"]);
        const eng = await repo.listEntries(50, "engineer");
        expect(eng.map((e) => e.action)).toEqual(["e1"]);
        const hub = await repo.listEntries(50, "hub");
        expect(hub.map((e) => e.action)).toEqual(["h1"]);
      });

      it("respects the limit param (newest N)", async () => {
        for (let i = 0; i < 10; i++) {
          await repo.logEntry("hub", `act-${i}`, "");
        }
        const top3 = await repo.listEntries(3);
        expect(top3.map((e) => e.action)).toEqual(["act-9", "act-8", "act-7"]);
      });

      it("returns empty list on a fresh repository (no entries)", async () => {
        const entries = await repo.listEntries();
        expect(entries).toEqual([]);
      });
    });

    describe("collision-free invariant (mission-49 emergent-correctness)", () => {
      it("yields N unique IDs across N rapid-fire logEntry calls", async () => {
        const N = 100;
        const promises = Array.from({ length: N }, (_, i) =>
          repo.logEntry("hub", "burst", `n=${i}`),
        );
        const entries = await Promise.all(promises);
        const ids = new Set(entries.map((e) => e.id));
        expect(ids.size).toBe(N);
        // IDs are dense in [audit-1, audit-N].
        for (let i = 1; i <= N; i++) {
          expect(ids.has(`audit-${i}`)).toBe(true);
        }
      });
    });

    describe("audit/v2/ namespace isolation", () => {
      it("writes only under audit/v2/ — legacy audit/ prefix untouched", async () => {
        await repo.logEntry("hub", "ns-test", "ensures v2 isolation");
        const v2Keys = await provider.list("audit/v2/");
        const allKeys = await provider.list("audit/");
        // The repository write lands under audit/v2/. The list("audit/")
        // call is a prefix query, so it includes audit/v2/ children too —
        // but no key directly under audit/ that isn't under v2/ should
        // exist. (Counter blob lives under meta/ — not audit/.)
        expect(v2Keys.some((k) => k.startsWith("audit/v2/"))).toBe(true);
        const nonV2 = allKeys.filter((k) => !k.startsWith("audit/v2/"));
        expect(nonV2).toEqual([]);
      });
    });

    describe("relatedEntity handling", () => {
      it("preserves relatedEntity when provided", async () => {
        const entry = await repo.logEntry("hub", "create", "task created", "task-42");
        expect(entry.relatedEntity).toBe("task-42");
      });

      it("normalizes missing relatedEntity to null", async () => {
        const entry = await repo.logEntry("hub", "create", "no link");
        expect(entry.relatedEntity).toBeNull();
      });
    });
  });
}
