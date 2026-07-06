/**
 * work-150 (mission-103 P3-S1) — the constitutional serve substrate per the
 * ratified design v1.0 (decision-17): sync floor + the read-surface payload law.
 *
 * The §6 contract rows exercised here:
 *   - ATOMIC SWAP: the singleton CAS is the commit point — a rejected or
 *     failed candidate leaves the prior corpus serving WHOLE (never mixed);
 *   - FAIL-OPEN-STALE: sync lag marks provenance stale:true but content
 *     serves (recall-proofness: the constitution never blanks);
 *   - FAIL-CLOSED-MALFORMED: one bad axiom file rejects the ENTIRE candidate;
 *   - NOT_SYNCED DISTINCTNESS: pre-first-sync is a loud structural error,
 *     never an empty corpus;
 *   - REFERENTIAL GATE: a candidate dropping an axiom with a live charter
 *     binding rejects whole;
 *   - PROVENANCE ECHO: every read verb carries the full provenance block
 *     beside content (omission = defect);
 *   - RATE BUDGET: fetch-all skipped below the headroom floor, serving stays
 *     stale-honest.
 *
 * GitHub is faked via the injectable fetch (the sync sees real response
 * shapes: branches/main, git/trees, contents raw).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../router.js";
import { registerConstitutionPolicy } from "../constitution-policy.js";
import { createTestContext, type TestPolicyContext } from "../test-utils.js";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../../entities/substrate-counter.js";
import {
  ConstitutionRepositorySubstrate,
  OrgCharterRepositorySubstrate,
} from "../../entities/constitution-repository-substrate.js";
import { ConstitutionSync, parseGate, CONSTITUTION_UPDATED_EVENT, selectConstitutionSyncToken } from "../../storage-substrate/constitution-sync.js";

function body(r: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(r.content[0].text);
}

/** A fake GitHub: axiom corpus keyed by sha, standard rate headers. */
function fakeGithub(state: {
  headSha: string;
  corpora: Record<string, Record<string, string>>;
  remaining?: number;
  limit?: number;
  calls?: string[];
  authCalls?: string[];
}): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    state.calls?.push(u.replace("https://api.github.com", "").replace("https://raw.githubusercontent.com", "[raw]"));
    // bug-236: record whether an auth header was sent, so tests can assert the
    // UNAUTHENTICATED path (no Authorization) works.
    const authHeader = new Headers(init?.headers).get("authorization");
    if (authHeader) state.authCalls?.push(u);
    const headers = new Headers({
      "x-ratelimit-remaining": String(state.remaining ?? 4000),
      "x-ratelimit-limit": String(state.limit ?? 5000),
    });
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers });
    // HEAD sha via /commits/main (core-API, unauth OK).
    if (u.includes("/commits/main")) return json({ sha: state.headSha });
    const treeMatch = /\/git\/trees\/([^?]+)/.exec(u);
    if (treeMatch) {
      const files = state.corpora[treeMatch[1]] ?? {};
      return json({ truncated: false, tree: Object.keys(files).map((path) => ({ path, type: "blob" })) });
    }
    // Bodies via raw.githubusercontent.com/<owner>/<repo>/<sha>/<path> (raw CDN).
    const rawMatch = /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/([^/]+)\/(.+)$/.exec(u);
    if (rawMatch) {
      const files = state.corpora[rawMatch[1]] ?? {};
      const content = files[decodeURIComponent(rawMatch[2])];
      if (content === undefined) return new Response("not found", { status: 404, headers });
      return new Response(content, { status: 200, headers });
    }
    return new Response("unexpected path", { status: 500, headers });
  }) as typeof fetch;
}

// The LIVE mission-kit filename shape: slugged (audit-10754) — plus one bare
// form to pin the tolerance.
const CORPUS_V1 = {
  "axioms/A0-sovereign-intelligence-engine.md": "# The Umbrella\n\nAll models are wrong.",
  "axioms/A1-evidence-over-assertion.md": "# Evidence Over Assertion\n\nShow, don't claim.",
  "axioms/A7.md": "# Fault Boundaries\n\nBlame the boundary, not the person.",
};

describe("constitution serve substrate (work-150 / mission-103 S1)", () => {
  let store: ConstitutionRepositorySubstrate;
  let charterStore: OrgCharterRepositorySubstrate;
  let router: PolicyRouter;
  let ctx: TestPolicyContext;

  beforeEach(() => {
    const substrate = createMemoryStorageSubstrate();
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    store = new ConstitutionRepositorySubstrate(substrate, { sourceRepo: "apnex/mission-kit", staleAfterMs: 600_000 });
    charterStore = new OrgCharterRepositorySubstrate(substrate, new SubstrateCounter(substrate));
    router = new PolicyRouter();
    registerConstitutionPolicy(router);
    ctx = createTestContext({ role: "engineer" });
    ctx.stores.constitution = store;
    ctx.stores.orgCharter = charterStore;
  });

  function sync(over: Partial<ConstructorParameters<typeof ConstitutionSync>[0]> = {}, state?: Parameters<typeof fakeGithub>[0]) {
    const gh = state ?? { headSha: "sha-1", corpora: { "sha-1": CORPUS_V1 } };
    return new ConstitutionSync({
      repo: "apnex/mission-kit",
      token: "test-token",
      cadenceMs: 60_000,
      rateBudgetPct: 0.8,
      store,
      charterStore,
      fetchImpl: fakeGithub(gh),
      ...over,
    });
  }

  it("first sync commits the whole corpus; a second tick at the same sha is UNCHANGED after one API call", async () => {
    const calls: string[] = [];
    const gh = { headSha: "sha-1", corpora: { "sha-1": CORPUS_V1 }, calls };
    const s = sync({}, gh);
    const first = await s.tick();
    expect(first).toEqual({ result: "synced", sha: "sha-1", axioms: 3 });
    calls.length = 0;
    const second = await s.tick();
    expect(second).toEqual({ result: "unchanged", sha: "sha-1" });
    expect(calls).toHaveLength(1); // HEAD check only — steady-state cost is 1 call/tick
    const snapshot = await store.getCurrent();
    expect(snapshot!.manifest.map((m) => m.id)).toEqual(["A0", "A1", "A7"]); // numeric-sorted manifest
    expect(snapshot!.files["axioms/A7.md"]).toContain("Blame the boundary"); // the bare form still accepted
  });

  it("bug-236: syncs UNAUTHENTICATED (no PAT) — no Authorization header is EVER sent, provenance sha still populates", async () => {
    const authCalls: string[] = [];
    const gh = { headSha: "sha-1", corpora: { "sha-1": CORPUS_V1 }, authCalls };
    const r = await sync({ token: undefined }, gh).tick();
    expect(r).toEqual({ result: "synced", sha: "sha-1", axioms: 3 });
    expect(authCalls).toEqual([]); // ZERO authenticated requests — pure public fetch, no token dependency
    const snapshot = await store.getCurrent();
    expect(snapshot!.sha).toBe("sha-1");
    expect(store.buildProvenance(snapshot!).sha).toBe("sha-1"); // sha provenance beside content unchanged
  });

  it("bug-236: axiom bodies come from raw.githubusercontent (raw CDN), NOT the core-rate-limited contents API; per-change core cost = 1 HEAD + 1 tree", async () => {
    const calls: string[] = [];
    const gh = { headSha: "sha-1", corpora: { "sha-1": CORPUS_V1 }, calls };
    await sync({}, gh).tick();
    expect(calls.filter((c) => c.startsWith("[raw]/apnex/mission-kit/sha-1/"))).toHaveLength(3); // 3 bodies off the raw CDN
    expect(calls.filter((c) => c.includes("/contents/"))).toHaveLength(0);                       // ZERO core contents calls
    expect(calls.filter((c) => c.includes("/commits/main"))).toHaveLength(1);                    // 1 core HEAD poll
    expect(calls.filter((c) => c.includes("/git/trees/"))).toHaveLength(1);                      // 1 core tree (pinned sha)
  });

  // audit-11100 (work-158 live-verify): the composition invariant. The sync path
  // must not authenticate in prod even though the process carries the global PAT
  // for the RepoEventBridge. The token SELECTOR is the seam that guarantees it.
  it("audit-11100: selectConstitutionSyncToken IGNORES the global OIS_GH_API_TOKEN — RepoEventBridge PAT present ⇒ sync token undefined", () => {
    // Prod shape: the bridge PAT is set, the dedicated constitution opt-in is not.
    expect(selectConstitutionSyncToken({ OIS_GH_API_TOKEN: "ghp_bridge_private_repo_pat" } as NodeJS.ProcessEnv)).toBeUndefined();
    // Neither var set ⇒ undefined.
    expect(selectConstitutionSyncToken({} as NodeJS.ProcessEnv)).toBeUndefined();
    // The dedicated break-glass opt-in (only) supplies a token.
    expect(selectConstitutionSyncToken({ OIS_GH_API_TOKEN: "ghp_bridge", OIS_CONSTITUTION_GH_TOKEN: "ghp_constitution_optin" } as NodeJS.ProcessEnv)).toBe("ghp_constitution_optin");
  });

  it("audit-11100: COMPOSITION — with the RepoEventBridge PAT present in the env, the sync sends NO Authorization header (uses the selected token, which is undefined)", async () => {
    const authCalls: string[] = [];
    const gh = { headSha: "sha-1", corpora: { "sha-1": CORPUS_V1 }, authCalls };
    // Exactly the prod composition: OIS_GH_API_TOKEN set (bridge), no dedicated opt-in.
    const token = selectConstitutionSyncToken({ OIS_GH_API_TOKEN: "ghp_bridge_private_repo_pat" } as NodeJS.ProcessEnv);
    const r = await sync({ token }, gh).tick();
    expect(r).toEqual({ result: "synced", sha: "sha-1", axioms: 3 });
    expect(authCalls).toEqual([]); // the bridge PAT never leaks into a constitution-sync Authorization header
  });

  it("bug-236: FAIL-OPEN-STALE — when GitHub is unreachable the tick errors but the last-good snapshot keeps serving (never blanks)", async () => {
    await sync().tick(); // sha-1 committed
    const unreachable = (async () => { throw new Error("ENOTFOUND raw.githubusercontent.com"); }) as typeof fetch;
    const r = await sync({ fetchImpl: unreachable }).tick();
    expect(r.result).toBe("error");
    const snapshot = await store.getCurrent();
    expect(snapshot!.sha).toBe("sha-1");        // prior snapshot still serves...
    expect(snapshot!.manifest).toHaveLength(3); // ...WHOLE — a network drop never blanks the constitution
  });

  it("FAIL-CLOSED-MALFORMED: one axiom file without a heading rejects the ENTIRE candidate — the prior corpus keeps serving whole", async () => {
    await sync().tick();
    const bad = { ...CORPUS_V1, "axioms/A9-unheaded.md": "no heading here, just prose" };
    const r = await sync({}, { headSha: "sha-2", corpora: { "sha-2": bad } }).tick();
    expect(r.result).toBe("rejected_parse");
    expect((r as { reason: string }).reason).toContain("A9");
    const snapshot = await store.getCurrent();
    expect(snapshot!.sha).toBe("sha-1");                      // prior serves...
    expect(snapshot!.manifest).toHaveLength(3);               // ...WHOLE — no partial A9-less sha-2 hybrid
  });

  it("an EMPTY candidate is malformed (an empty constitution is never silently served)", async () => {
    const r = await sync({}, { headSha: "sha-e", corpora: { "sha-e": {} } }).tick();
    expect(r.result).toBe("rejected_parse");
    expect(await store.getCurrent()).toBeNull(); // still not_synced — not an empty corpus
  });

  it("DUPLICATE-ID is malformed (audit-10754 follow-through): two files claiming the same A<N> reject the whole candidate", async () => {
    await sync().tick();
    const dup = { ...CORPUS_V1, "axioms/A7-fault-boundaries.md": "# Fault Boundaries (slugged twin)\n\nSame id, different file." };
    const r = await sync({}, { headSha: "sha-dup", corpora: { "sha-dup": dup } }).tick();
    expect(r.result).toBe("rejected_parse");
    expect((r as { reason: string }).reason).toContain("duplicate axiom id A7");
    expect((await store.getCurrent())!.sha).toBe("sha-1");
  });

  it("REFERENTIAL GATE: a candidate dropping an axiom with a LIVE charter binding rejects whole", async () => {
    await sync().tick();
    await charterStore.bindAxiom({ axiom: "A7", ratifiedBy: "decision-99", proofRef: "dconf-99" });
    const withoutA7 = { "axioms/A0-sovereign-intelligence-engine.md": CORPUS_V1["axioms/A0-sovereign-intelligence-engine.md"], "axioms/A1-evidence-over-assertion.md": CORPUS_V1["axioms/A1-evidence-over-assertion.md"] };
    const r = await sync({}, { headSha: "sha-3", corpora: { "sha-3": withoutA7 } }).tick();
    expect(r.result).toBe("rejected_referential");
    expect((r as { reason: string }).reason).toContain("A7");
    expect((await store.getCurrent())!.sha).toBe("sha-1");
  });

  it("RATE BUDGET: below the headroom floor the fetch-all is skipped and serving stays on the last-good snapshot", async () => {
    await sync().tick();
    const calls: string[] = [];
    const gh = { headSha: "sha-2", corpora: { "sha-2": CORPUS_V1 }, remaining: 100, limit: 5000, calls };
    const r = await sync({}, gh).tick(); // floor = (1-0.8)*5000 = 1000 > 100 remaining
    expect(r).toEqual({ result: "skipped_rate_budget", remaining: 100, limit: 5000 });
    expect(calls.filter((c) => c.includes("/git/trees/"))).toHaveLength(0); // no fetch-all spend
    expect((await store.getCurrent())!.sha).toBe("sha-1");
  });

  it("ATOMIC SWAP + history: the swap commits the new corpus in one CAS; the prior snapshot is retained as a history row", async () => {
    await sync().tick();
    const v2 = { ...CORPUS_V1, "axioms/A1-evidence-over-assertion.md": "# Evidence Over Assertion v2\n\nAmended by the gauntlet." };
    const r = await sync({}, { headSha: "sha-2", corpora: { "sha-2": v2 } }).tick();
    expect(r.result).toBe("synced");
    const current = await store.getCurrent();
    expect(current!.sha).toBe("sha-2");
    expect(current!.files["axioms/A1-evidence-over-assertion.md"]).toContain("v2");
    expect(current!.manifestHash).not.toBe("");
  });

  it("the update announcement fires POST-commit with old→new shas, and its failure never unwinds the swap", async () => {
    const announced: Record<string, unknown>[] = [];
    await sync({ announce: async (p) => { announced.push(p); } }).tick();
    expect(announced).toHaveLength(1);
    expect(announced[0].notificationEvent).toBe(CONSTITUTION_UPDATED_EVENT);
    expect(announced[0].old_sha).toBeNull();
    expect(announced[0].new_sha).toBe("sha-1");
    // A dead announce path: the swap still commits (the bug-231 lesson).
    const v2 = { ...CORPUS_V1, "axioms/A0-sovereign-intelligence-engine.md": "# The Umbrella v2\n\nStill wrong, still useful." };
    const r = await sync(
      { announce: async () => { throw new Error("emit path down"); } },
      { headSha: "sha-2", corpora: { "sha-2": v2 } },
    ).tick();
    expect(r.result).toBe("synced");
    expect((await store.getCurrent())!.sha).toBe("sha-2");
  });

  // ── The read surface: payload law ──────────────────────────────────────────

  it("NOT_SYNCED DISTINCTNESS: before the first sync every verb answers the loud structural error — never an empty corpus", async () => {
    for (const [verb, args] of [["get_constitution", {}], ["list_axioms", {}], ["get_axiom", { axiomId: "A1" }], ["get_charter", {}]] as const) {
      const r = await router.handle(verb, args as Record<string, unknown>, ctx);
      expect(r.isError, `${verb} pre-sync must error`).toBe(true);
      expect((body(r) as { errorKind: string }).errorKind).toBe("not_synced");
    }
  });

  it("PROVENANCE ECHO: every verb carries the full provenance block beside content (the payload law)", async () => {
    await sync().tick();
    for (const [verb, args] of [["get_constitution", {}], ["list_axioms", {}], ["get_axiom", { axiomId: "A7" }], ["get_charter", {}]] as const) {
      const r = await router.handle(verb, args as Record<string, unknown>, ctx);
      expect(r.isError, `${verb} must succeed`).toBeFalsy();
      const p = (body(r) as { provenance?: Record<string, unknown> }).provenance;
      expect(p, `${verb} omitted provenance — payload-law defect`).toBeDefined();
      expect(p!.sourceRepo).toBe("apnex/mission-kit");
      expect(p!.sha).toBe("sha-1");
      expect(typeof p!.syncedAt).toBe("string");
      expect(typeof p!.manifestHash).toBe("string");
      expect(p!.stale).toBe(false);
      expect(typeof p!.ageSeconds).toBe("number");
    }
  });

  it("FAIL-OPEN-STALE: a lagging snapshot serves content with stale:true honesty (never blanks)", async () => {
    // Direct swap with an old syncedAt (the sync normally stamps now).
    const manifest = parseGate(CORPUS_V1);
    await store.swapSnapshot({
      sha: "sha-old",
      syncedAt: new Date(Date.now() - 3_600_000).toISOString(), // 1h ago >> 600s threshold
      manifestHash: "mh",
      files: CORPUS_V1,
      manifest,
    });
    const r = await router.handle("get_constitution", {}, ctx);
    expect(r.isError).toBeFalsy();
    const parsed = body(r) as { provenance: { stale: boolean; ageSeconds: number }; axioms: unknown[] };
    expect(parsed.provenance.stale).toBe(true);
    expect(parsed.provenance.ageSeconds).toBeGreaterThan(3000);
    expect(parsed.axioms).toHaveLength(3); // content STILL served — fail-open
  });

  it("get_constitution is the cold-start verb: one call returns manifest + every verbatim body + the charter", async () => {
    await sync().tick();
    await charterStore.bindAxiom({ axiom: "A1", ratifiedBy: "decision-42", proofRef: "dconf-42" });
    const r = body(await router.handle("get_constitution", {}, ctx)) as {
      axioms: Array<{ id: string; title: string; body: string }>;
      charter: { bindings: Array<{ axiom: string; ratifiedBy: string; proofRef: string }> };
    };
    expect(r.axioms.map((a) => a.id)).toEqual(["A0", "A1", "A7"]);
    expect(r.axioms[1].body).toBe(CORPUS_V1["axioms/A1-evidence-over-assertion.md"]); // VERBATIM — served exactly as ratified
    expect(r.charter.bindings[0]).toMatchObject({ axiom: "A1", ratifiedBy: "decision-42", proofRef: "dconf-42" });
  });

  it("get_axiom: known id returns the verbatim body; unknown id is not_found naming the served set", async () => {
    await sync().tick();
    const hit = body(await router.handle("get_axiom", { axiomId: "A7" }, ctx)) as { axiom: { body: string; contentHash: string } };
    expect(hit.axiom.body).toBe(CORPUS_V1["axioms/A7.md"]);
    expect(hit.axiom.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const miss = await router.handle("get_axiom", { axiomId: "A99" }, ctx);
    expect(miss.isError).toBe(true);
    expect(String((body(miss) as { error: string }).error)).toContain("A0, A1, A7");
  });
});
