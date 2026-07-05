/**
 * mission-102 P3-B6 — arrival-surface tests (memory substrate, REAL repos
 * end to end through the router: Decision + ArrivalSurface).
 *
 * The G2-BINDING contract test this slice owns:
 *   #4 pull-purity (the bug-225 replay) — the render verb's output is a PURE
 *      function of queue state: with EVERY push channel dead (dispatch throws,
 *      emission fails), the arrival surface is still complete. Cold start =
 *      the full routed queue; the cursor chain advances per render.
 * Plus: DELIVERED = PRESENTED (snapshot membership flips nudge receipts),
 * the EMIT-ONLY sweep invariant (aging never transitions — the B1 no-timer
 * law), S3.1 presence (declared away suppresses non-critical EMISSION while
 * receipts still mint; activity flips present instantly), and the D-A1
 * critical path (bounded retry then ONE side-channel escalation).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../router.js";
import { registerArrivalSurfacePolicy, runDecisionAgingSweep, AGING_NORMAL_MS, AGING_CRITICAL_MS } from "../arrival-surface-policy.js";
import { registerDirectorProofPolicy } from "../director-proof-policy.js";
import { DirectorProofRepositorySubstrate } from "../../entities/director-proof-repository-substrate.js";
import { createTestContext, type TestPolicyContext } from "../test-utils.js";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../../entities/substrate-counter.js";
import { DecisionRepositorySubstrate } from "../../entities/decision-repository-substrate.js";
import { ArrivalSurfaceRepositorySubstrate } from "../../entities/arrival-surface-repository-substrate.js";
import { canonicalPromptHash } from "../../entities/director-proof-repository-substrate.js";
import type { DecisionActor, IDecisionProofGate } from "../../entities/decision.js";

const ARCHITECT: DecisionActor = { agentId: "agent-arch", role: "architect", sessionId: "s-a" };

/** A permissive test gate standing in for the B3 evaluator (self-disposal digests). */
const GRANT_GATE: IDecisionProofGate = {
  evaluate: async () => ({ authorityMode: "class-grant", authorityRef: "grant-1@v1" }),
};

function body(r: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(r.content[0].text);
}

/** hours → a future nowISO that makes freshly-routed decisions LOOK aged —
 *  dwell is computed against the sweep's nowISO, so no row backdating. */
function hoursFromNow(h: number): string {
  return new Date(Date.now() + h * 3600_000).toISOString();
}

describe("arrival surface (P3-B6: pull projection + snapshots + aging + presence)", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;
  let decisions: DecisionRepositorySubstrate;
  let arrival: ArrivalSurfaceRepositorySubstrate;

  beforeEach(async () => {
    const substrate = createMemoryStorageSubstrate();
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    const counter = new SubstrateCounter(substrate);
    decisions = new DecisionRepositorySubstrate(substrate, counter);
    arrival = new ArrivalSurfaceRepositorySubstrate(substrate, counter);
    router = new PolicyRouter();
    registerArrivalSurfacePolicy(router);
    registerDirectorProofPolicy(router);
    ctx = createTestContext({ role: "director" });
    ctx.stores.decision = decisions;
    ctx.stores.arrivalSurface = arrival;
    ctx.stores.directorProof = new DirectorProofRepositorySubstrate(substrate, counter);
  });

  /** raise→curate→route a director-target decision; returns its id. */
  async function routedDecision(title: string, cls = "approval"): Promise<string> {
    const d = await decisions.raiseDecision({
      title, context: `ctx for ${title}`, class: cls,
      options: [{ id: "yes", label: "Yes", description: "do it" }],
      raisedBy: ARCHITECT,
    });
    await decisions.curateDecision(d.id, ARCHITECT);
    await decisions.routeDecision(d.id, ARCHITECT, { target: "director" });
    return d.id;
  }

  // ── CONTRACT TEST 4 (G2-BINDING): pull purity — the bug-225 replay ─────────
  it("contract #4: render is a PURE function of queue state — complete with every push channel DEAD", async () => {
    const ids = [await routedDecision("d-one"), await routedDecision("d-two"), await routedDecision("d-three")];
    // Kill ALL pushes: dispatch throws (SSE dead), and run the aging sweep with
    // a dead message store so even nudge EMISSION fails.
    ctx.dispatch = async () => { throw new Error("push channel dead (bug-225 replay)"); };
    const deadEmitCtx = { ...ctx, stores: { ...ctx.stores, message: undefined } } as unknown as TestPolicyContext;
    await runDecisionAgingSweep(deadEmitCtx, hoursFromNow(49)); // best-effort emits all fail
    // The pull is still COMPLETE:
    const r = await router.handle("render_arrival_surface", {}, ctx);
    expect(r.isError).toBeFalsy();
    const out = body(r) as { queue: Array<{ id: string }>; snapshotId: string; sinceSnapshotId: string | null };
    expect(out.queue.map((q) => q.id).sort()).toEqual([...ids].sort());
    expect(out.sinceSnapshotId).toBeNull(); // cold start = everything
    // ...and the snapshot is a SERVER-SIDE receipt pinning WHAT was shown:
    const snap = await arrival.getSnapshot(out.snapshotId);
    expect(snap).not.toBeNull();
    expect(snap!.entries).toHaveLength(3);
    for (const e of snap!.entries) {
      const d = (await decisions.getDecision(e.decisionId))!;
      expect(e.promptHash).toBe(canonicalPromptHash(d));
    }
  });

  it("contract #4b: the cursor chain — second render advances sinceSnapshotId and digests ONLY what changed since", async () => {
    const first = await routedDecision("early");
    const r1 = await router.handle("render_arrival_surface", {}, ctx);
    const snap1 = (body(r1) as { snapshotId: string }).snapshotId;
    // Between renders: a grant self-disposal + a curation-window disposal.
    await decisions.resolveDecision(first, ARCHITECT, { chosenOptionId: "yes" }, GRANT_GATE, { claimedAuthorityRef: "grant-1@v1" });
    const dumped = await decisions.raiseDecision({ title: "noise", context: "c", class: "x", options: [], raisedBy: ARCHITECT });
    await decisions.disposeDecision(dumped.id, ARCHITECT, "duplicate");
    const late = await routedDecision("late");
    // The digest boundary is INCLUSIVE (same-ms events never drop), so give the
    // cursor a strict ms gap to assert the render-3 digest empties.
    await new Promise((res) => setTimeout(res, 5));
    const r2 = await router.handle("render_arrival_surface", {}, ctx);
    const out = body(r2) as {
      sinceSnapshotId: string; queue: Array<{ id: string }>;
      digest: { selfDisposals: Array<{ id: string; authorityRef: string | null }>; disposals: Array<{ id: string }> };
    };
    expect(out.sinceSnapshotId).toBe(snap1);
    expect(out.queue.map((q) => q.id)).toEqual([late]);
    expect(out.digest.selfDisposals.map((d) => d.id)).toEqual([first]);
    expect(out.digest.selfDisposals[0].authorityRef).toBe("grant-1@v1"); // the grant ref surfaces for spot-audit
    expect(out.digest.disposals.map((d) => d.id)).toEqual([dumped.id]);
    // Third render immediately after: digest empties (nothing since snap2).
    const r3 = await router.handle("render_arrival_surface", {}, ctx);
    const out3 = body(r3) as { digest: { selfDisposals: unknown[]; disposals: unknown[] } };
    await new Promise((res) => setTimeout(res, 0)); // (r3 rendered ≥5ms after the mutations)
    expect(out3.digest.selfDisposals).toHaveLength(0);
    expect(out3.digest.disposals).toHaveLength(0);
  });

  // ── The EMIT-ONLY sweep (S2.4 + the B1 no-timer invariant) ─────────────────
  it("aging sweep EMITS (message + receipt) and NEVER transitions; normal decisions nudge exactly once", async () => {
    const id = await routedDecision("aging");
    const before = (await ctx.stores.message.listMessages({})).length;
    const s1 = await runDecisionAgingSweep(ctx, hoursFromNow(49));
    expect(s1.emitted).toBe(1);
    // EMIT-ONLY: still routed, untouched.
    expect((await decisions.getDecision(id))!.status).toBe("routed");
    const msgs = await ctx.stores.message.listMessages({});
    expect(msgs.length).toBe(before + 1);
    const receipts = await arrival.openNudgeReceipts();
    expect(receipts).toHaveLength(1);
    expect(receipts[0].decisionId).toBe(id);
    expect(receipts[0].emittedRef).not.toBeNull();
    // Second sweep: no duplicate nudge (normal = once).
    const s2 = await runDecisionAgingSweep(ctx, hoursFromNow(50));
    expect(s2.emitted).toBe(0);
    expect(await arrival.openNudgeReceipts()).toHaveLength(1);
    // Under-threshold decisions never nudge (sweep at +1h: dwell far below 48h).
    await routedDecision("fresh");
    const s3 = await runDecisionAgingSweep(ctx, hoursFromNow(1));
    expect(s3.emitted).toBe(0);
    expect((await arrival.openNudgeReceipts()).map((n) => n.decisionId)).toEqual([id]);
  });

  it("DELIVERED = PRESENTED: a render flips open nudge receipts to the snapshot that presented them", async () => {
    const id = await routedDecision("nudged-then-seen");
    await runDecisionAgingSweep(ctx, hoursFromNow(49));
    expect(await arrival.openNudgeReceipts()).toHaveLength(1);
    const r = await router.handle("render_arrival_surface", {}, ctx);
    const out = body(r) as { snapshotId: string; nudgesPresented: number };
    expect(out.nudgesPresented).toBe(1);
    expect(await arrival.openNudgeReceipts()).toHaveLength(0);
    // The receipt names the presenting snapshot (delivery = receipt, not emission).
    const all = await arrival.getSnapshot(out.snapshotId);
    expect(all!.entries.map((e) => e.decisionId)).toContain(id);
  });

  // ── Presence (S3.1) ────────────────────────────────────────────────────────
  it("S3.1: declared away suppresses non-critical EMISSION (receipt still mints, emittedRef null); critical still fires; Director activity flips present", async () => {
    await routedDecision("normal-aged");
    const crit = await routedDecision("critical-aged", "exception");
    await router.handle("declare_away_stint", { expectedReturn: "2026-07-10T00:00:00Z" }, ctx);
    expect((await arrival.getPresence()).state).toBe("away");
    const s = await runDecisionAgingSweep(ctx, hoursFromNow(49));
    expect(s.suppressed).toBe(1);
    expect(s.emitted).toBe(1); // the critical one
    const receipts = await arrival.openNudgeReceipts();
    const suppressed = receipts.find((n) => n.emittedRef === null)!;
    const emitted = receipts.find((n) => n.emittedRef !== null)!;
    expect(suppressed.level).toBe("normal");
    expect(emitted.decisionId).toBe(crit);
    expect(emitted.level).toBe("critical");
    // Suppressed-nudge accounting SURVIVES away-mode — the digest carries it.
    const r = await router.handle("render_arrival_surface", {}, ctx);
    const out = body(r) as { digest: { suppressedNudges: Array<{ decisionId: string }> } };
    // The whole point of receipt-minting under suppression: the ARRIVING
    // Director sees what away-mode swallowed.
    expect(out.digest.suppressedNudges.map((n) => n.decisionId)).toHaveLength(1);
    // ...and the Director's own pull flipped presence back (activity = present).
    expect((await arrival.getPresence()).state).toBe("present");
    // This render PRESENTED both decisions → receipts closed; next pull digests none.
    const r2 = await router.handle("render_arrival_surface", {}, ctx);
    const out2 = body(r2) as { digest: { suppressedNudges: unknown[] } };
    expect(out2.digest.suppressedNudges).toHaveLength(0);
  });

  it("S3.1: inferred away never overrides a declared state and never flips present", async () => {
    await router.handle("declare_present", {}, ctx);
    let p = await arrival.setPresence("away", "inferred");
    expect(p.state).toBe("present"); // declared present wins over inferred away
    await router.handle("declare_away_stint", {}, ctx);
    p = await arrival.setPresence("present", "inferred");
    expect(p.state).toBe("away"); // inference can NEVER unsuppress
  });

  // ── D-A1: critical bounded retry + ONE side-channel escalation ─────────────
  it("D-A1: critical nudges retry (bounded 2) then escalate side-channel EXACTLY once", async () => {
    await routedDecision("stuck-critical", "escalation");
    const t = (h: number) => hoursFromNow(25 + h);
    let r = await runDecisionAgingSweep(ctx, t(0));   // initial emit
    expect([r.emitted, r.escalated]).toEqual([1, 0]);
    r = await runDecisionAgingSweep(ctx, t(1));       // retry 1
    expect([r.emitted, r.escalated]).toEqual([1, 0]);
    r = await runDecisionAgingSweep(ctx, t(2));       // retry 2 (the bound)
    expect([r.emitted, r.escalated]).toEqual([1, 0]);
    r = await runDecisionAgingSweep(ctx, t(3));       // side-channel escalation
    expect([r.emitted, r.escalated]).toEqual([0, 1]);
    r = await runDecisionAgingSweep(ctx, t(4));       // silence: escalation is ONCE
    expect([r.emitted, r.escalated]).toEqual([0, 0]);
    const [receipt] = await arrival.openNudgeReceipts();
    expect(receipt.retryCount).toBe(2);
    expect(receipt.escalatedAt).not.toBeNull();
  });

  // ── ack/defer markers ──────────────────────────────────────────────────────
  it("acknowledge_arrival sets ack/defer markers on the snapshot; unknown snapshot rejects loud", async () => {
    const a = await routedDecision("seen");
    const b = await routedDecision("postponed");
    const r = await router.handle("render_arrival_surface", {}, ctx);
    const snapId = (body(r) as { snapshotId: string }).snapshotId;
    const r2 = await router.handle("acknowledge_arrival", { snapshotId: snapId, ack: [a], defer: [b] }, ctx);
    expect(r2.isError).toBeFalsy();
    const snap = await arrival.getSnapshot(snapId);
    expect(snap!.ackDecisionIds).toEqual([a]);
    expect(snap!.deferDecisionIds).toEqual([b]);
    const bad = await router.handle("acknowledge_arrival", { snapshotId: "asnap-999", ack: [a] }, ctx);
    expect(bad.isError).toBe(true);
  });

  // ── digest: failure parks ──────────────────────────────────────────────────
  it("digest surfaces failure-parked decisions (resolved + executorBinding.ok=false) with their per-action results", async () => {
    const id = await routedDecision("parked");
    await decisions.resolveDecision(id, ARCHITECT, { chosenOptionId: "yes" }, GRANT_GATE, { claimedAuthorityRef: "grant-1@v1" });
    await decisions.recordExecutorBinding(id, {
      executor: ARCHITECT, boundAt: new Date().toISOString(), ok: false,
      results: [{ action: "unblock", targetRef: "work-9", ok: false, detail: "target not blocked on this decision" }],
    });
    const r = await router.handle("render_arrival_surface", {}, ctx);
    const out = body(r) as { digest: { failureParks: Array<{ id: string; results: Array<{ detail: string }> }> } };
    expect(out.digest.failureParks.map((f) => f.id)).toEqual([id]);
    expect(out.digest.failureParks[0].results[0].detail).toMatch(/not blocked/);
  });

  it("RBAC: non-Director-surface roles cannot render, ack, or set presence (a stray render would falsely mark nudges PRESENTED)", async () => {
    await routedDecision("guarded");
    await runDecisionAgingSweep(ctx, hoursFromNow(49));
    const engCtx = createTestContext({ role: "engineer" });
    engCtx.stores.decision = decisions;
    engCtx.stores.arrivalSurface = arrival;
    for (const [verb, vargs] of [
      ["render_arrival_surface", {}],
      ["acknowledge_arrival", { snapshotId: "asnap-1", ack: ["decision-1"] }],
      ["declare_away_stint", {}],
      ["declare_present", {}],
    ] as const) {
      const r = await router.handle(verb, vargs as Record<string, unknown>, engCtx);
      expect(r.isError, `${verb} must reject engineer`).toBe(true);
    }
    // The nudge receipt survived every rejected attempt — still open, unpresented.
    expect(await arrival.openNudgeReceipts()).toHaveLength(1);
    expect((await arrival.getPresence()).state).toBe("present");
  });

  // ── audit-10122 regressions ────────────────────────────────────────────────
  it("audit-10122(1): Director PROOF activity while declared away flips present — later normal nudges EMIT, not suppress", async () => {
    await routedDecision("waits-during-away");
    await router.handle("declare_away_stint", {}, ctx);
    expect((await arrival.getPresence()).state).toBe("away");
    // The Director answers a signal through B4 — proven Director activity.
    const r = await router.handle("capture_director_signal", {
      channel: "ois-say", answer: "acknowledged", capturedBySurface: "cli", confidence: "session-bound",
    }, ctx);
    expect(r.isError).toBeFalsy();
    expect((await arrival.getPresence()).state).toBe("present");
    // A sweep after the activity EMITS the normal nudge (no away-suppression left).
    const s = await runDecisionAgingSweep(ctx, hoursFromNow(49));
    expect(s.suppressed).toBe(0);
    expect(s.emitted).toBe(1);
  });

  it("audit-10122(2a): latestSnapshot is EXACT past the 500-row page — the true per-surface cursor is never hidden", async () => {
    const mkSnap = (surface: string) => arrival.recordSnapshot({
      surface, renderedFor: { agentId: "a", role: "director", sessionId: "s" },
      sinceSnapshotId: null, entries: [],
      digest: { routedCount: 0, selfDisposalsSinceCursor: 0, disposalsSinceCursor: 0, suppressedNudges: 0, failureParks: 0 },
    });
    for (let i = 0; i < 503; i++) await mkSnap("busy");
    const last = await mkSnap("busy"); // asnap-504 — beyond the first list page
    const rare = await mkSnap("quiet"); // asnap-505 — a surface whose ONLY row is past the cap
    expect((await arrival.latestSnapshot("busy"))!.id).toBe(last.id);
    expect((await arrival.latestSnapshot("quiet"))!.id).toBe(rare.id);
  }, 30_000);

  it("audit-10122(2b): openNudgeReceipts is EXACT past the 500-row page — hidden receipts can't break once-only or the digest", async () => {
    for (let i = 0; i < 504; i++) {
      await arrival.mintNudgeReceipt({ decisionId: `decision-${i}`, level: "normal", emittedRef: null });
    }
    const open = await arrival.openNudgeReceipts();
    expect(open).toHaveLength(504);
    // ...and presenting a decision whose receipt sits past the page still flips it.
    const victim = open[open.length - 1];
    const flipped = await arrival.markNudgesPresented([victim.decisionId], "asnap-x");
    expect(flipped).toBe(1);
    expect((await arrival.openNudgeReceipts()).map((n) => n.id)).not.toContain(victim.id);
  }, 30_000);

  it("sanity: threshold constants match S2.4 (48h normal / 24h critical)", () => {
    expect(AGING_NORMAL_MS).toBe(48 * 3600_000);
    expect(AGING_CRITICAL_MS).toBe(24 * 3600_000);
  });
});
