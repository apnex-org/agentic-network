/**
 * mission-102 design §6 — CONTRACT TEST 6 (G2-BINDING): SC3-gaming flagged.
 * (B8-R2 / work-129, from steve's audit-10226: no implementation existed.)
 *
 * The anti-pattern: time-per-Director-decision IMPROVING while self-disposal
 * ratio / stale count / reversal count RISES — the metric optimized by
 * diverting or dropping attention rather than earning efficiency. The funnel
 * render must FLAG it and never report the interval as unqualified success.
 *
 * Decision rows are fabricated flat (the write encoder envelopes them) with
 * exact createdAt/resolvedAt stamps, so ages and halves are deterministic.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../router.js";
import { registerSc3FunnelPolicy } from "../sc3-funnel-policy.js";
import { createTestContext, type TestPolicyContext } from "../test-utils.js";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../../entities/substrate-counter.js";
import { DecisionRepositorySubstrate } from "../../entities/decision-repository-substrate.js";

const T0 = Date.parse("2026-07-01T00:00:00.000Z");
const HOUR = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();

// The window: 2026-07-01 00:00 → 2026-07-03 00:00, split at 2026-07-02 00:00.
const FROM = iso(T0), TO = iso(T0 + 48 * HOUR), SPLIT = iso(T0 + 24 * HOUR), NOW = iso(T0 + 49 * HOUR);

describe("CONTRACT TEST 6 (G2-BINDING): SC3-gaming flagged — design §6, B8-R2", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;
  let substrate: ReturnType<typeof createMemoryStorageSubstrate>;
  let seq = 0;

  beforeEach(() => {
    substrate = createMemoryStorageSubstrate();
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    router = new PolicyRouter();
    registerSc3FunnelPolicy(router);
    ctx = createTestContext({ role: "verifier" }); // [Any] — the verifier's own seat
    ctx.stores.decision = new DecisionRepositorySubstrate(substrate, new SubstrateCounter(substrate));
    seq = 0;
  });

  /** Fabricate a flat Decision row with exact stamps (encoder envelopes it). */
  async function seed(over: Record<string, unknown>): Promise<string> {
    const id = `decision-${++seq}`;
    await substrate.createOnly("Decision", {
      id, schemaVersion: 1, parentRef: null, class: "x", title: id, context: "c",
      contextRefs: [], options: [], freeAnswerPolicy: "always",
      raisedBy: { agentId: "a", role: "architect" }, curatedBy: { agentId: "a", role: "architect" },
      curationRecordRef: null, routedTo: { target: "director" }, routedBy: null,
      resolution: null, executionPlan: [], mergedInto: null, disposedReason: null,
      executorBinding: null, status: "resolved",
      enteredCurrentStateAt: over.createdAt ?? iso(T0), stateDurations: { raised: 0, curated: 0, routed: 0, resolved: 0 },
      createdAt: iso(T0), updatedAt: iso(T0),
      ...over,
    });
    return id;
  }

  /** A director-resolved decision created at `atMs` taking `ageMs` to resolve. */
  const directorDecision = (atMs: number, ageMs: number) => seed({
    createdAt: iso(atMs),
    resolution: { authorityMode: "director-direct", executor: { agentId: "d", role: "director" }, answer: { chosenOptionId: "y" }, resolvedAt: iso(atMs + ageMs) },
  });
  /** A grant self-disposal created at `atMs`. */
  const selfDisposal = (atMs: number) => seed({
    createdAt: iso(atMs),
    resolution: { authorityMode: "class-grant", authorityRef: "grant-1@v1", executor: { agentId: "a", role: "architect" }, answer: { chosenOptionId: "y" }, resolvedAt: iso(atMs + HOUR) },
  });

  async function funnel(extra: Record<string, unknown> = {}) {
    const r = await router.handle("query_sc3_funnel", { from: FROM, to: TO, splitAt: SPLIT, nowISO: NOW, ...extra }, ctx);
    expect(r.isError).toBeFalsy();
    return JSON.parse(r.content[0].text) as Record<string, unknown>;
  }

  it("#6: speed improving WHILE self-disposal ratio rises → FLAGGED with a mandatory qualification (never unqualified success)", async () => {
    // First half: 4 director decisions, slow (10h), no self-disposals.
    for (let i = 0; i < 4; i++) await directorDecision(T0 + i * HOUR, 10 * HOUR);
    // Second half: 2 FAST director decisions (1h)... and 4 quiet self-disposals.
    for (let i = 0; i < 2; i++) await directorDecision(T0 + 25 * HOUR + i * HOUR, 1 * HOUR);
    for (let i = 0; i < 4; i++) await selfDisposal(T0 + 30 * HOUR + i * HOUR);

    const out = await funnel();
    expect(out.gamingFlagged).toBe(true);
    expect(out.assessment).toBe("flagged");
    expect(String(out.qualification)).toMatch(/MUST NOT be reported as unqualified success/);
    expect((out.gamingFactors as string[]).join(" ")).toMatch(/self-disposal ratio rose/);
    // The full-funnel denominators are all present (SC3: never a cherry-picked stage).
    const f = out.funnel as Record<string, unknown>;
    for (const k of ["raised", "curated", "routed", "selfDisposed", "directorResolved", "merged", "disposed", "stale", "reversed", "directorP50AgeMs", "directorP95AgeMs"]) {
      expect(f).toHaveProperty(k);
    }
  });

  it("#6 negative (a): speed improving with self-disposal ratio STEADY → clean (efficiency alone is not gaming)", async () => {
    for (let i = 0; i < 3; i++) await directorDecision(T0 + i * HOUR, 10 * HOUR);
    await selfDisposal(T0 + 3 * HOUR);
    for (let i = 0; i < 3; i++) await directorDecision(T0 + 25 * HOUR + i * HOUR, 1 * HOUR);
    await selfDisposal(T0 + 29 * HOUR); // ratio 1/4 both halves
    const out = await funnel();
    expect(out.gamingFlagged).toBe(false);
    expect(out.assessment).toBe("clean");
  });

  it("#6 negative (b): self-disposal rising while speed WORSENS → not the gaming pattern (no false flag)", async () => {
    for (let i = 0; i < 3; i++) await directorDecision(T0 + i * HOUR, 1 * HOUR); // fast first
    for (let i = 0; i < 3; i++) await directorDecision(T0 + 25 * HOUR + i * HOUR, 10 * HOUR); // slow second
    for (let i = 0; i < 3; i++) await selfDisposal(T0 + 30 * HOUR + i * HOUR);
    const out = await funnel();
    expect(out.gamingFlagged).toBe(false);
  });

  it("#6: a REVERSAL rise (raises disputing settled decisions) also trips the flag", async () => {
    const settled = await directorDecision(T0 + 1 * HOUR, 10 * HOUR);
    for (let i = 0; i < 2; i++) await directorDecision(T0 + 2 * HOUR + i * HOUR, 10 * HOUR);
    // Second half: fast decisions + two raises whose parentRef disputes the settled one.
    for (let i = 0; i < 2; i++) await directorDecision(T0 + 25 * HOUR + i * HOUR, 1 * HOUR);
    for (let i = 0; i < 2; i++) {
      await seed({ createdAt: iso(T0 + 30 * HOUR + i * HOUR), status: "raised", curatedBy: null, routedTo: null, parentRef: { kind: "Decision", id: settled } });
    }
    const out = await funnel();
    expect(out.gamingFlagged).toBe(true);
    expect((out.gamingFactors as string[]).join(" ")).toMatch(/reversal count rose/);
  });

  it("#6: one-sided director volume → insufficient-data, NEVER 'clean' by default", async () => {
    for (let i = 0; i < 3; i++) await directorDecision(T0 + i * HOUR, 5 * HOUR); // first half only
    for (let i = 0; i < 3; i++) await selfDisposal(T0 + 30 * HOUR + i * HOUR);   // second half: no director rows
    const out = await funnel();
    expect(out.assessment).toBe("insufficient-data");
    expect(out.gamingFlagged).toBe(false);
  });
});
