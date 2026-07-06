/**
 * work-164 (idea-395) — node-type-aware lease window (leaseTtlMsFor).
 *
 * The claim/renew lease grant uses an item's author-set leaseWindowMs when present
 * (a positive finite number), else the flat 15-min default. This pins that decision
 * so a known long-hold / design-first node gets its extended window and a nonsense
 * value falls back safely.
 */
import { describe, it, expect } from "vitest";
import { leaseTtlMsFor } from "../../src/entities/work-item-repository-substrate.js";

const DEFAULT_MS = 15 * 60 * 1000; // the flat LEASE_TTL_MS default

describe("leaseTtlMsFor — node-type-aware lease window", () => {
  it("returns the author-set leaseWindowMs when it is a positive finite number", () => {
    expect(leaseTtlMsFor({ leaseWindowMs: 45 * 60_000 })).toBe(45 * 60_000);
    expect(leaseTtlMsFor({ leaseWindowMs: 1 })).toBe(1);
  });

  it("falls back to the flat default when absent", () => {
    expect(leaseTtlMsFor({})).toBe(DEFAULT_MS);
    expect(leaseTtlMsFor({ leaseWindowMs: undefined })).toBe(DEFAULT_MS);
  });

  it("falls back to the default on a nonsense value (never grants a zero/negative/NaN window)", () => {
    expect(leaseTtlMsFor({ leaseWindowMs: 0 })).toBe(DEFAULT_MS);
    expect(leaseTtlMsFor({ leaseWindowMs: -5 })).toBe(DEFAULT_MS);
    expect(leaseTtlMsFor({ leaseWindowMs: Number.NaN })).toBe(DEFAULT_MS);
    expect(leaseTtlMsFor({ leaseWindowMs: Number.POSITIVE_INFINITY })).toBe(DEFAULT_MS);
  });
});
