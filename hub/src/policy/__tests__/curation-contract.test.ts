/**
 * mission-102 P3-B2 — curation-model tests (memory substrate, REAL repos:
 * Decision wired WITH the curation trail, through the router).
 *
 * The two G2-BINDING contract tests this slice owns:
 *   #2 laundering visible — every curation act (class change, merge, grant-
 *      cited self-disposal route) leaves an append-only record, and the §2
 *      queries expose it: raw_vs_presented diff, class_changed, per_grant,
 *      merge_lineage (minority claims reachable through their own raw rows);
 *   #8 raw-feed interval completeness — the raw feed over an interval returns
 *      EVERY raise, including decisions since disposed or merged. Nothing
 *      ever vanishes.
 * Plus: RawDecisionRaised immutability (the capture survives curation
 * byte-identical), repo-layer trail (records exist without any policy-layer
 * cooperation), exact pagination past the 500-row page (the audit-10127
 * lesson, applied at birth), and the 24h curation-SLO sweep (emit-only,
 * once per decision, never presence-suppressed).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../router.js";
import { registerDecisionPolicy } from "../decision-policy.js";
import { registerCurationPolicy, runCurationSloSweep, CURATION_SLO_MS } from "../curation-policy.js";
import { registerArrivalSurfacePolicy } from "../arrival-surface-policy.js";
import { createTestContext, type TestPolicyContext } from "../test-utils.js";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../../entities/substrate-counter.js";
import { DecisionRepositorySubstrate } from "../../entities/decision-repository-substrate.js";
import { CurationRepositorySubstrate } from "../../entities/curation-repository-substrate.js";
import { ArrivalSurfaceRepositorySubstrate } from "../../entities/arrival-surface-repository-substrate.js";
import type { DecisionActor } from "../../entities/decision.js";

const ARCHITECT: DecisionActor = { agentId: "agent-arch", role: "architect", sessionId: "s-a" };

function body(r: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(r.content[0].text);
}

function hoursFromNow(h: number): string {
  return new Date(Date.now() + h * 3600_000).toISOString();
}

describe("curation model (P3-B2: append-only trail + anti-laundering queries + SLO)", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;
  let decisions: DecisionRepositorySubstrate;
  let curation: CurationRepositorySubstrate;
  let arrival: ArrivalSurfaceRepositorySubstrate;

  beforeEach(async () => {
    const substrate = createMemoryStorageSubstrate();
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    const counter = new SubstrateCounter(substrate);
    curation = new CurationRepositorySubstrate(substrate, counter);
    decisions = new DecisionRepositorySubstrate(substrate, counter, curation); // trail WIRED
    arrival = new ArrivalSurfaceRepositorySubstrate(substrate, counter);
    router = new PolicyRouter();
    registerDecisionPolicy(router);
    registerCurationPolicy(router);
    registerArrivalSurfacePolicy(router);
    ctx = createTestContext({ role: "architect" });
    ctx.stores.decision = decisions;
    ctx.stores.curation = curation;
    ctx.stores.arrivalSurface = arrival;
  });

  async function raise(title: string, cls: string | null = "triage"): Promise<string> {
    const d = await decisions.raiseDecision({
      title, context: `ctx: ${title}`, class: cls,
      options: [{ id: "yes", label: "Yes", description: "do it" }],
      raisedBy: ARCHITECT,
    });
    return d.id;
  }

  // ── CONTRACT TEST 2 (G2-BINDING): laundering visible ────────────────────────
  it("contract #2a: a class change during curation is visible via class_changed AND raw_vs_presented, with the record trail", async () => {
    const id = await raise("reclassified", "escalation");
    await decisions.curateDecision(id, ARCHITECT, { class: "routine", basis: "downgraded after triage" });

    const changed = body(await router.handle("query_curation", { query: "class_changed" }, ctx)) as { items: Array<{ decisionId: string; rawClass: string; presentedClass: string }> };
    expect(changed.items.map((i) => i.decisionId)).toEqual([id]);
    expect(changed.items[0]).toMatchObject({ rawClass: "escalation", presentedClass: "routine" });

    const diff = body(await router.handle("query_curation", { query: "raw_vs_presented", decisionId: id }, ctx)) as {
      diff: Record<string, { raw: unknown; presented: unknown }>;
      records: Array<{ act: string; basis: string; changes: Record<string, unknown> }>;
    };
    expect(diff.diff.class).toEqual({ raw: "escalation", presented: "routine" });
    expect(diff.records.map((r) => r.act)).toEqual(["curate"]);
    expect(diff.records[0].basis).toBe("downgraded after triage");
  });

  it("contract #2b: merge preserves the FULL lineage — the minority claim stays reachable through its own raw row", async () => {
    const survivor = await raise("the surviving framing");
    const minority = await raise("the minority claim");
    await decisions.mergeDecision(minority, ARCHITECT, survivor, "same underlying question; minority framing preserved (B9)");

    const lineage = body(await router.handle("query_curation", { query: "merge_lineage", decisionId: survivor }, ctx)) as {
      own: { decisionId: string };
      mergedIn: Array<{ decisionId: string; raw: { title: string } | null; records: Array<{ act: string; sourceRawIds: string[]; basis: string }> }>;
    };
    expect(lineage.own.decisionId).toBe(survivor);
    expect(lineage.mergedIn.map((m) => m.decisionId)).toEqual([minority]);
    expect(lineage.mergedIn[0].raw!.title).toBe("the minority claim"); // verbatim, immutable
    const rec = lineage.mergedIn[0].records.find((r) => r.act === "merge")!;
    expect(rec.sourceRawIds).toHaveLength(2); // BOTH constituents' raw ids
    expect(rec.basis).toMatch(/minority framing preserved/);
  });

  it("contract #2c: a grant-cited self-disposal route leaves its classification packet — per_grant finds it", async () => {
    const id = await raise("auto-approvable", "approval-unblock");
    await decisions.curateDecision(id, ARCHITECT, {});
    await decisions.routeDecision(id, ARCHITECT, {
      target: "self-disposal",
      selfDisposal: { classGrantRef: "grant-1@v1" },
    });

    const packets = body(await router.handle("query_curation", { query: "per_grant", grantRef: "grant-1@v1" }, ctx)) as { items: Array<{ decisionId: string; act: string; grantCitation: string }> };
    expect(packets.items).toHaveLength(1);
    expect(packets.items[0]).toMatchObject({ decisionId: id, act: "route-self-disposal", grantCitation: "grant-1@v1" });
  });

  // ── CONTRACT TEST 8 (G2-BINDING): raw-feed interval completeness ────────────
  it("contract #8: the raw feed over an interval is COMPLETE — disposed and merged raises are all present with their current state", async () => {
    const from = new Date(Date.now() - 60_000).toISOString();
    const kept = await raise("kept");
    const disposed = await raise("noise");
    const mergedAway = await raise("duplicate");
    await decisions.disposeDecision(disposed, ARCHITECT, "duplicate of kept");
    await decisions.mergeDecision(mergedAway, ARCHITECT, kept);
    const to = new Date(Date.now() + 60_000).toISOString();

    const feed = body(await router.handle("query_curation", { query: "raw_feed", from, to }, ctx)) as {
      count: number;
      items: Array<{ raw: { decisionId: string; title: string }; currentStatus: string }>;
    };
    expect(feed.count).toBe(3);
    const byId = Object.fromEntries(feed.items.map((i) => [i.raw.decisionId, i]));
    expect(byId[kept].currentStatus).toBe("raised");
    expect(byId[disposed].currentStatus).toBe("disposed");
    expect(byId[mergedAway].currentStatus).toBe("merged");
    // The disposed raise's CONTENT is intact — disposal removed nothing.
    expect(byId[disposed].raw.title).toBe("noise");
  });

  // ── Immutability + repo-layer trail ─────────────────────────────────────────
  it("RawDecisionRaised is IMMUTABLE: the capture survives curation byte-identical", async () => {
    const id = await raise("original framing", "escalation");
    const before = (await curation.getRawForDecision(id))!;
    await decisions.curateDecision(id, ARCHITECT, { class: "routine", basis: "reframed" });
    const after = (await curation.getRawForDecision(id))!;
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(after.class).toBe("escalation"); // the raw class, not the curated one
  });

  it("the trail is REPO-LAYER: dispose without any policy involvement still records", async () => {
    const id = await raise("direct repo dispose");
    await decisions.disposeDecision(id, ARCHITECT, "not actionable");
    const records = await curation.listRecordsForDecision(id);
    expect(records.map((r) => r.act)).toEqual(["dispose"]);
    expect(records[0].basis).toBe("not actionable");
    expect(records[0].sourceRawIds).toHaveLength(1);
  });

  it("route-self-disposal records REQUIRE a grant citation — the store throws without one", async () => {
    await expect(curation.record({
      decisionId: "decision-1", act: "route-self-disposal", changes: {},
      curator: ARCHITECT, basis: "b", sourceRawIds: [], grantCitation: null,
    })).rejects.toThrow(/REQUIRE a grantCitation/);
  });

  it("exact pagination: the raw feed is complete past the 500-row page (audit-10127 applied at birth)", async () => {
    const from = new Date(Date.now() - 60_000).toISOString();
    for (let i = 0; i < 503; i++) {
      await curation.mintRaw({
        decisionId: `decision-x${i}`, title: `bulk ${i}`, context: "c", class: null,
        options: [], contextRefs: [], raisedBy: ARCHITECT, raisedAt: new Date().toISOString(),
      });
    }
    const rows = await curation.listRawInterval(from, new Date(Date.now() + 60_000).toISOString());
    expect(rows.length).toBe(503);
  }, 30_000);

  // ── The 24h curation SLO (S3.2) ─────────────────────────────────────────────
  it("SLO sweep: a raise past 24h emits ONCE (emit-only — still raised), under-threshold never, and slo_breaches reports live", async () => {
    const id = await raise("stuck in triage");
    const s1 = await runCurationSloSweep(ctx, hoursFromNow(25));
    expect(s1.emitted).toBe(1);
    expect((await decisions.getDecision(id))!.status).toBe("raised"); // EMIT-ONLY
    const receipts = await arrival.openNudgeReceipts();
    expect(receipts.filter((n) => n.level === "slo")).toHaveLength(1);
    expect(receipts[0].emittedRef).not.toBeNull();
    // Once per decision:
    expect((await runCurationSloSweep(ctx, hoursFromNow(26))).emitted).toBe(0);
    // Fresh raises don't breach:
    await raise("fresh");
    expect((await runCurationSloSweep(ctx, hoursFromNow(1))).emitted).toBe(0);
  });

  it("SLO breaches are EXCEPTIONS: Director away-mode never suppresses them", async () => {
    await raise("breaches during away");
    await arrival.setPresence("away", "declared");
    const s = await runCurationSloSweep(ctx, hoursFromNow(25));
    expect(s.emitted).toBe(1);
    const [receipt] = (await arrival.openNudgeReceipts()).filter((n) => n.level === "slo");
    expect(receipt.emittedRef).not.toBeNull(); // EMITTED, not suppressed
  });

  // ── audit-10199 regressions ────────────────────────────────────────────────
  it("audit-10199(1): class_changed, slo_breaches and the sweep are EXACT past the 500-row decision page", async () => {
    for (let i = 0; i < 502; i++) await raise(`filler ${i}`);
    // The laundered decision is created LAST — beyond the first page.
    const laundered = await raise("laundered late", "escalation");
    await decisions.curateDecision(laundered, ARCHITECT, { class: "routine", basis: "quiet downgrade" });

    const changed = body(await router.handle("query_curation", { query: "class_changed" }, ctx)) as { items: Array<{ decisionId: string }> };
    expect(changed.items.map((i) => i.decisionId)).toContain(laundered);

    const breaches = body(await router.handle("query_curation", { query: "slo_breaches" }, ctx)) as { count: number };
    // slo_breaches computes live at real now (dwell ~0) → 0; the EXACTNESS
    // claim rides the sweep below, which takes a future nowISO.
    expect(breaches.count).toBe(0);
    const s1 = await runCurationSloSweep(ctx, hoursFromNow(25));
    expect(s1.emitted).toBe(502); // every filler, none hidden past the page
    expect((await runCurationSloSweep(ctx, hoursFromNow(26))).emitted).toBe(0);
  }, 60_000);

  it("audit-10199(2): merge lineage is TRANSITIVE — A→B then B→C surfaces BOTH A and B from C, with depths", async () => {
    const a = await raise("A: the original minority claim");
    const b = await raise("B: the intermediate framing");
    const c = await raise("C: the survivor");
    await decisions.mergeDecision(a, ARCHITECT, b, "A folded into B");
    await decisions.mergeDecision(b, ARCHITECT, c, "B folded into C");

    const lineage = body(await router.handle("query_curation", { query: "merge_lineage", decisionId: c }, ctx)) as {
      mergedIn: Array<{ decisionId: string; mergedInto: string; depth: number; raw: { title: string } | null }>;
    };
    const byId = Object.fromEntries(lineage.mergedIn.map((m) => [m.decisionId, m]));
    expect(Object.keys(byId).sort()).toEqual([a, b].sort());
    expect(byId[b]).toMatchObject({ mergedInto: c, depth: 1 });
    expect(byId[a]).toMatchObject({ mergedInto: b, depth: 2 });
    // A's ORIGINAL content is reachable from C — two hops of curation later.
    expect(byId[a].raw!.title).toBe("A: the original minority claim");
  });

  it("sanity: the SLO constant is 24h (S3.2)", () => {
    expect(CURATION_SLO_MS).toBe(24 * 3600_000);
  });
});
