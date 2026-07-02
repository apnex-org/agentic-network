/**
 * work-94 (cold-start spine, sub-slice 2 nit): value-pin the non-dark `no_claimable_ready`
 * reason on an empty post-WIP-cap ready scan. The integration path can't deterministically
 * produce an empty scan in the shared testcontainer (sibling any-role ready items leak in),
 * so the STRING CONSTANT is pinned here as a pure unit — a mutation of the literal or the
 * empty-predicate reds this test.
 */
import { describe, it, expect } from "vitest";
import { readyScanEmptyReason } from "../work-item-repository-substrate.js";

describe("readyScanEmptyReason (non-dark empty-scan reason)", () => {
  it("an empty scan (0 claimable) → 'no_claimable_ready'", () => {
    expect(readyScanEmptyReason(0)).toBe("no_claimable_ready");
  });

  it("a non-empty scan → undefined (no reason; the digest is not annotated when it has items)", () => {
    expect(readyScanEmptyReason(1)).toBeUndefined();
    expect(readyScanEmptyReason(5)).toBeUndefined();
  });
});
