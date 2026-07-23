import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConstitutionRepositorySubstrate, OrgCharterRepositorySubstrate } from "../../entities/constitution-repository-substrate.js";
import type { ConstitutionSnapshot } from "../../entities/constitution.js";
import { SubstrateCounter } from "../../entities/substrate-counter.js";
import { createMemoryStorageSubstrate, type MemorySubstrate } from "../../storage-substrate/memory-substrate.js";
import { ConstitutionSync, parseGate } from "../../storage-substrate/constitution-sync.js";

const CORPUS = {
  "axioms/A1-evidence-over-assertion.md": "# Evidence Over Assertion\n\nShow, don't claim.",
  "axioms/A7-fault-boundaries.md": "# Fault Boundaries\n\nKeep the last good state.",
};

interface GhState {
  headSha: string;
  corpora: Record<string, Record<string, string>>;
  remaining?: number;
  limit?: number;
  headStatus?: number;
  treeStatus?: number;
  rawStatus?: number;
}

function fakeGithub(state: GhState): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    const headers = new Headers({
      "x-ratelimit-remaining": String(state.remaining ?? 4000),
      "x-ratelimit-limit": String(state.limit ?? 5000),
    });
    if (u.includes("/commits/main")) {
      const status = state.headStatus ?? 200;
      return new Response(status === 200 ? JSON.stringify({ sha: state.headSha }) : "head failed", { status, headers });
    }
    const tree = /\/git\/trees\/([^?]+)/.exec(u);
    if (tree) {
      const status = state.treeStatus ?? 200;
      const files = state.corpora[tree[1]] ?? {};
      return new Response(status === 200 ? JSON.stringify({ truncated: false, tree: Object.keys(files).map((path) => ({ path, type: "blob" })) }) : "tree failed", { status, headers });
    }
    const raw = /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/([^/]+)\/(.+)$/.exec(u);
    if (raw) {
      const status = state.rawStatus ?? 200;
      const content = state.corpora[raw[1]]?.[decodeURIComponent(raw[2])];
      return new Response(status === 200 && content !== undefined ? content : "raw failed", { status: content === undefined ? 404 : status, headers });
    }
    return new Response("unexpected", { status: 500, headers });
  }) as typeof fetch;
}

describe("bug-335 constitution verification freshness", () => {
  let substrate: MemorySubstrate;
  let store: ConstitutionRepositorySubstrate;
  let charter: OrgCharterRepositorySubstrate;

  beforeEach(() => {
    substrate = createMemoryStorageSubstrate();
    store = new ConstitutionRepositorySubstrate(substrate, { sourceRepo: "apnex/mission-kit", staleAfterMs: 60_000 });
    charter = new OrgCharterRepositorySubstrate(substrate, new SubstrateCounter(substrate));
  });

  function sync(state: GhState, override: Partial<ConstructorParameters<typeof ConstitutionSync>[0]> = {}): ConstitutionSync {
    return new ConstitutionSync({
      repo: "apnex/mission-kit",
      cadenceMs: 60_000,
      rateBudgetPct: 0.8,
      store,
      charterStore: charter,
      fetchImpl: fakeGithub(state),
      ...override,
    });
  }

  async function seedOld(sha = "sha-1"): Promise<ConstitutionSnapshot> {
    const old = new Date(Date.now() - 3_600_000).toISOString();
    return store.swapSnapshot({
      sha,
      syncedAt: old,
      lastVerifiedAt: old,
      manifestHash: "manifest-old",
      files: CORPUS,
      manifest: parseGate(CORPUS),
    });
  }

  it("production envelope encoder/decoder preserves active status when markVerified upgrades a legacy row", async () => {
    const syncedAt = new Date(Date.now() - 3_600_000).toISOString();
    await substrate.createOnly("ConstitutionSnapshot", {
      id: "current",
      sha: "sha-legacy",
      syncedAt,
      manifestHash: "manifest-legacy",
      files: CORPUS,
      manifest: parseGate(CORPUS),
      status: "active",
      createdAt: syncedAt,
      updatedAt: syncedAt,
    });

    const rawBefore = await substrate.get<Record<string, unknown>>("ConstitutionSnapshot", "current");
    expect(rawBefore?.status).toEqual({ status: "active" });
    const decodedBefore = await store.getCurrent();
    expect(decodedBefore?.status).toBe("active");
    expect(decodedBefore?.lastVerifiedAt).toBeUndefined();

    const verifiedAt = new Date().toISOString();
    expect(await store.markVerified("sha-legacy", verifiedAt)).toBe("verified");

    const rawAfter = await substrate.get<Record<string, unknown>>("ConstitutionSnapshot", "current");
    expect(rawAfter?.status).toEqual({ status: "active", lastVerifiedAt: verifiedAt });
    const decodedAfter = await store.getCurrent();
    expect(decodedAfter?.status).toBe("active");
    expect(decodedAfter?.lastVerifiedAt).toBe(verifiedAt);
    expect(decodedAfter?.syncedAt).toBe(syncedAt);
  });

  it("unchanged healthy polling advances verification health without changing content identity or history", async () => {
    const before = await seedOld();
    const historyBefore = await substrate.get<unknown>("ConstitutionSnapshot", "snap-sha-1");
    expect(store.buildProvenance(before).stale).toBe(true);

    const result = await sync({ headSha: "sha-1", corpora: { "sha-1": CORPUS } }).tick();
    expect(result).toEqual({ result: "unchanged", sha: "sha-1" });
    const after = (await store.getCurrent())!;
    expect(after.syncedAt).toBe(before.syncedAt);
    expect(after.sha).toBe(before.sha);
    expect(after.manifestHash).toBe(before.manifestHash);
    expect(after.files).toEqual(before.files);
    expect(after.status).toBe("active");
    expect(after.lastVerifiedAt).not.toBe(before.lastVerifiedAt);
    const rawAfter = await substrate.get<Record<string, unknown>>("ConstitutionSnapshot", "current");
    expect(rawAfter?.status).toEqual({ status: "active", lastVerifiedAt: after.lastVerifiedAt });
    expect(store.buildProvenance(after).stale).toBe(false);
    expect(await substrate.get<unknown>("ConstitutionSnapshot", "snap-sha-1")).toEqual(historyBefore);
  });

  it("HEAD/API unreachable does not refresh verification health", async () => {
    const before = await seedOld();
    const result = await sync({ headSha: "sha-1", corpora: {}, headStatus: 503 }).tick();
    expect(result.result).toBe("error");
    expect((await store.getCurrent())!.lastVerifiedAt).toBe(before.lastVerifiedAt);
    expect(store.buildProvenance((await store.getCurrent())!).stale).toBe(true);
  });

  it("rate-budget skip on a changed HEAD does not refresh old-snapshot health", async () => {
    const before = await seedOld();
    const result = await sync({ headSha: "sha-2", corpora: { "sha-2": CORPUS }, remaining: 5, limit: 5000 }).tick();
    expect(result.result).toBe("skipped_rate_budget");
    expect((await store.getCurrent())!.lastVerifiedAt).toBe(before.lastVerifiedAt);
  });

  it("fetch-all failure does not refresh verification health", async () => {
    const before = await seedOld();
    const result = await sync({ headSha: "sha-2", corpora: {}, treeStatus: 503 }).tick();
    expect(result.result).toBe("error");
    expect((await store.getCurrent())!.lastVerifiedAt).toBe(before.lastVerifiedAt);
  });

  it("malformed changed candidate rejection does not refresh verification health", async () => {
    const before = await seedOld();
    const malformed = { ...CORPUS, "axioms/A9-malformed.md": "no heading" };
    const result = await sync({ headSha: "sha-2", corpora: { "sha-2": malformed } }).tick();
    expect(result.result).toBe("rejected_parse");
    expect((await store.getCurrent())!.lastVerifiedAt).toBe(before.lastVerifiedAt);
  });

  it("live-charter referential rejection does not refresh verification health", async () => {
    const before = await seedOld();
    await charter.bindAxiom({ axiom: "A7", ratifiedBy: "decision-1", proofRef: "dconf-1" });
    const withoutA7 = { "axioms/A1-evidence-over-assertion.md": CORPUS["axioms/A1-evidence-over-assertion.md"] };
    const result = await sync({ headSha: "sha-2", corpora: { "sha-2": withoutA7 } }).tick();
    expect(result.result).toBe("rejected_referential");
    expect((await store.getCurrent())!.lastVerifiedAt).toBe(before.lastVerifiedAt);
  });

  it("startup/restart instance recovers freshness on unchanged HEAD", async () => {
    const before = await seedOld();
    const restartedStore = new ConstitutionRepositorySubstrate(substrate, { sourceRepo: "apnex/mission-kit", staleAfterMs: 60_000 });
    const restarted = new ConstitutionSync({
      repo: "apnex/mission-kit", cadenceMs: 60_000, rateBudgetPct: 0.8,
      store: restartedStore, charterStore: charter,
      fetchImpl: fakeGithub({ headSha: "sha-1", corpora: { "sha-1": CORPUS } }),
    });
    expect((await restarted.tick()).result).toBe("unchanged");
    const after = (await restartedStore.getCurrent())!;
    expect(after.syncedAt).toBe(before.syncedAt);
    expect(restartedStore.buildProvenance(after).stale).toBe(false);
  });

  it("concurrent-instance health CAS conflict/retry converges monotonically", async () => {
    await seedOld();
    const store2 = new ConstitutionRepositorySubstrate(substrate, { sourceRepo: "apnex/mission-kit", staleAfterMs: 60_000 });
    const a = sync({ headSha: "sha-1", corpora: { "sha-1": CORPUS } });
    const b = new ConstitutionSync({
      repo: "apnex/mission-kit", cadenceMs: 60_000, rateBudgetPct: 0.8,
      store: store2, charterStore: charter,
      fetchImpl: fakeGithub({ headSha: "sha-1", corpora: { "sha-1": CORPUS } }),
    });
    const results = await Promise.all([a.tick(), b.tick()]);
    expect(results.every((r) => r.result === "unchanged")).toBe(true);
    expect(store.buildProvenance((await store.getCurrent())!).stale).toBe(false);
  });

  it("snapshot SHA change during a health update returns mismatch and cannot refresh the winner", async () => {
    await seedOld();
    const now = new Date().toISOString();
    await store.swapSnapshot({
      sha: "sha-2", syncedAt: now, lastVerifiedAt: now, manifestHash: "manifest-2",
      files: CORPUS, manifest: parseGate(CORPUS),
    }, "sha-1");
    const before = (await store.getCurrent())!;
    expect(await store.markVerified("sha-1", new Date(Date.now() + 1_000).toISOString())).toBe("sha_mismatch");
    expect(await store.getCurrent()).toEqual(before);
  });

  it("failed health persistence returns an error and remains stale-honest", async () => {
    const before = await seedOld();
    const original = substrate.putIfMatch.bind(substrate);
    const spy = vi.spyOn(substrate, "putIfMatch").mockImplementation(async (kind, entity, expected) => {
      if (kind === "ConstitutionSnapshot") return { ok: false, conflict: "revision-mismatch", actualRevision: expected };
      return original(kind, entity, expected);
    });
    const result = await sync({ headSha: "sha-1", corpora: { "sha-1": CORPUS } }).tick();
    expect(result.result).toBe("error");
    spy.mockRestore();
    const after = (await store.getCurrent())!;
    expect(after.lastVerifiedAt).toBe(before.lastVerifiedAt);
    expect(store.buildProvenance(after).stale).toBe(true);
  });

  it("changed valid snapshot swap stamps both times and preserves superseded content history", async () => {
    const before = await seedOld();
    const corpus2 = { ...CORPUS, "axioms/A1-evidence-over-assertion.md": "# Evidence v2\n\nChanged." };
    const result = await sync({ headSha: "sha-2", corpora: { "sha-2": corpus2 } }).tick();
    expect(result.result).toBe("synced");
    const after = (await store.getCurrent())!;
    expect(after.sha).toBe("sha-2");
    expect(after.lastVerifiedAt).toBe(after.syncedAt);
    const history = await substrate.get<Record<string, unknown>>("ConstitutionSnapshot", "snap-sha-1");
    expect(history).not.toBeNull();
    expect(JSON.stringify(history)).toContain(before.syncedAt);
  });

  it("concurrent identical changed candidates commit once without content-history churn", async () => {
    await seedOld();
    const corpus2 = { ...CORPUS, "axioms/A1-evidence-over-assertion.md": "# Evidence v2\n\nChanged." };
    const state = { headSha: "sha-2", corpora: { "sha-2": corpus2 } };
    const store2 = new ConstitutionRepositorySubstrate(substrate, { sourceRepo: "apnex/mission-kit", staleAfterMs: 60_000 });
    const sync2 = new ConstitutionSync({ repo: "apnex/mission-kit", cadenceMs: 60_000, rateBudgetPct: 0.8, store: store2, charterStore: charter, fetchImpl: fakeGithub(state) });
    const [a, b] = await Promise.all([sync(state).tick(), sync2.tick()]);
    expect([a.result, b.result].every((r) => r === "synced")).toBe(true);
    expect((await store.getCurrent())!.sha).toBe("sha-2");
    const rows = await substrate.list<unknown>("ConstitutionSnapshot", { limit: 100 });
    expect(rows.items).toHaveLength(2); // current + the single snap-sha-1 history id (createOnly dedup)
  });
});
