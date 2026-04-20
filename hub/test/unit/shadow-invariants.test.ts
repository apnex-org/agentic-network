import { describe, it, expect } from "vitest";
import {
  logShadowInvariantBreach,
  normalizeInvId,
} from "../../src/observability/shadow-invariants.js";
import { createMetricsCounter } from "../../src/observability/metrics.js";
import { createTestContext } from "../../src/policy/test-utils.js";

describe("normalizeInvId", () => {
  it("accepts canonical INV-TH<N> form", () => {
    expect(normalizeInvId("INV-TH19")).toBe("inv_th19");
  });
  it("accepts lowercase hyphenated form", () => {
    expect(normalizeInvId("inv-th19")).toBe("inv_th19");
  });
  it("accepts TH<N> shorthand", () => {
    expect(normalizeInvId("TH19")).toBe("inv_th19");
    expect(normalizeInvId("th19")).toBe("inv_th19");
  });
  it("accepts bare number", () => {
    expect(normalizeInvId("19")).toBe("inv_th19");
  });
  it("strips punctuation + underscores", () => {
    expect(normalizeInvId("INV_TH_19")).toBe("inv_th19");
    expect(normalizeInvId("INV-TH 19")).toBe("inv_th19");
  });
});

describe("logShadowInvariantBreach", () => {
  function buildCtx() {
    const ctx = createTestContext();
    // Overwrite metrics with a fresh one so assertions are self-contained.
    ctx.metrics = createMetricsCounter();
    return ctx;
  }

  it("increments shadow_breach bucket by default", () => {
    const ctx = buildCtx();
    logShadowInvariantBreach("INV-TH19", "test breach", ctx);
    expect(ctx.metrics.snapshot()).toEqual({ "inv_th19.shadow_breach": 1 });
  });

  it("increments near_miss bucket when kind=near_miss", () => {
    const ctx = buildCtx();
    logShadowInvariantBreach("INV-TH25", "approaching max depth", ctx, { kind: "near_miss" });
    expect(ctx.metrics.snapshot()).toEqual({ "inv_th25.near_miss": 1 });
  });

  it("records summary + role in recentDetails", () => {
    const ctx = buildCtx();
    ctx.role = "engineer";
    logShadowInvariantBreach("INV-TH19", "test breach", ctx, { relatedEntity: "thread-1" });
    const recent = ctx.metrics.recentDetails("inv_th19.shadow_breach");
    expect(recent).toHaveLength(1);
    expect(recent[0].details).toMatchObject({
      inv: "INV-TH19",
      kind: "breach",
      summary: "test breach",
      role: "engineer",
    });
  });

  it("merges extra payload into details", () => {
    const ctx = buildCtx();
    logShadowInvariantBreach("INV-TH25", "depth 3 of 3", ctx, { extra: { depth: 3, max: 3 } });
    const recent = ctx.metrics.recentDetails("inv_th25.shadow_breach");
    expect(recent[0].details).toMatchObject({ depth: 3, max: 3 });
  });

  it("emits audit log entry with 'hub' actor", async () => {
    const ctx = buildCtx();
    logShadowInvariantBreach("INV-TH19", "test breach", ctx, { relatedEntity: "thread-42" });
    // Audit is fire-and-forget; wait a microtask to let the Promise settle.
    await new Promise((r) => setTimeout(r, 0));
    const entries = await ctx.stores.audit.listEntries();
    const shadow = entries.find((e) => e.action === "inv_th19_shadow_breach");
    expect(shadow).toBeDefined();
    expect(shadow!.actor).toBe("hub");
    expect(shadow!.details).toBe("test breach");
    expect(shadow!.relatedEntity).toBe("thread-42");
  });

  it("uses near_miss audit action when kind=near_miss", async () => {
    const ctx = buildCtx();
    logShadowInvariantBreach("INV-TH25", "depth 2 of 3", ctx, { kind: "near_miss" });
    await new Promise((r) => setTimeout(r, 0));
    const entries = await ctx.stores.audit.listEntries();
    const nearMiss = entries.find((e) => e.action === "inv_th25_near_miss");
    expect(nearMiss).toBeDefined();
  });

  it("does not throw when called repeatedly", () => {
    const ctx = buildCtx();
    for (let i = 0; i < 10; i++) {
      logShadowInvariantBreach("INV-TH19", `breach ${i}`, ctx);
    }
    expect(ctx.metrics.snapshot()["inv_th19.shadow_breach"]).toBe(10);
  });

  it("different invariants accumulate on distinct buckets", () => {
    const ctx = buildCtx();
    logShadowInvariantBreach("INV-TH18", "a", ctx);
    logShadowInvariantBreach("INV-TH19", "b", ctx);
    logShadowInvariantBreach("INV-TH19", "c", ctx);
    logShadowInvariantBreach("INV-TH25", "d", ctx, { kind: "near_miss" });
    expect(ctx.metrics.snapshot()).toEqual({
      "inv_th18.shadow_breach": 1,
      "inv_th19.shadow_breach": 2,
      "inv_th25.near_miss": 1,
    });
  });
});
