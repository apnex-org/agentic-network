/**
 * skills-set-diff-gate.test.ts — the coexist acceptance gate as a pure function
 * (hcapskills0 build_claude; invariant 3b). The bin calls this SAME helper as a live
 * fail-closed seed-time check; here it's the fast CI signal, both pass + fail.
 */
import { describe, it, expect } from "vitest";
import { missingFromRoleMap } from "../src/skills/index.js";

describe("missingFromRoleMap — role_map ⊇ mks-delivered", () => {
  it("passes (empty) when role_map is a strict superset", () => {
    expect(missingFromRoleMap(["a", "b", "c"], ["a", "b"])).toEqual([]);
  });

  it("passes (empty) when equal, order-independent", () => {
    expect(missingFromRoleMap(["b", "a"], ["a", "b"])).toEqual([]);
  });

  it("FAILS with the missing mks skills when role_map drops one", () => {
    expect(missingFromRoleMap(["a"], ["a", "b", "c"])).toEqual(["b", "c"]);
  });

  it("dedups mks-delivered before diffing", () => {
    expect(missingFromRoleMap(["a"], ["b", "b", "a"])).toEqual(["b"]);
  });
});
