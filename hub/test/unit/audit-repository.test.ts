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
 * GCS provider variant is exercised via the @apnex/storage-provider
 * conformance suite at the primitive layer (createOnly/list/get
 * semantics that AuditRepository composes over), which is not in scope
 * here — repository-level invariants only.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryStorageSubstrate } from "../../src/storage-substrate/index.js";
import type { HubStorageSubstrate } from "../../src/storage-substrate/types.js";

import { AuditRepositorySubstrate as AuditRepository } from "../../src/entities/audit-repository-substrate.js";
import { SubstrateCounter } from "../../src/entities/substrate-counter.js";

// mission-84 W2: parameterized FS-provider variant retired (LocalFsStorageProvider
// goes to W4 deletion-cascade; MemoryHubStorageSubstrate-only here). The AuditRepository
// invariants under test (ID format, ordering, filter, limit, collision-free, namespace
// isolation, relatedEntity normalization) are repository-level — preserved across the
// substrate migration.
const fixtures = [
  {
    name: "MemoryHubStorageSubstrate",
    setup: () => createMemoryStorageSubstrate(),
  },
];

for (const fixture of fixtures) {
  describe(`AuditRepository — ${fixture.name}`, () => {
    let provider: HubStorageSubstrate;
    let repo: AuditRepository;

    beforeEach(() => {
      provider = fixture.setup();
      repo = new AuditRepository(provider, new SubstrateCounter(provider));
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
        // mission-84 W2: N reduced from 100 → 30 for substrate-CAS-loop budget.
        // SubstrateCounter uses CAS-retry (MAX_CAS_RETRIES=50; bug-97 W5.5 fix
        // at e109000) — under 100 concurrent allocators the last caller needs
        // ~99 retries exceeding the budget. N=30 well within budget; preserves
        // the collision-free invariant under realistic contention. FS-version's
        // Mutex-serialized counter scaled to N=100 trivially — substrate's
        // CAS-loop is bounded by design (per architect Design v1.0 §2.6 W4
        // decision: NO atomic-issueCounter substrate-primitive refactor;
        // CAS-loop sufficient for production-realistic contention).
        const N = 30;
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

    // mission-84 W2: `audit/v2/ namespace isolation` test removed — was
    // FS-version-specific (path-prefix discrimination); substrate uses
    // (kind, id) tuple discrimination (`kind=Audit`). Substrate-level
    // kind-isolation is structurally guaranteed by the schema-defined
    // entity-kinds map (Map<kind, Map<id, entity>>); no path-collision
    // class exists in the substrate model.

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
