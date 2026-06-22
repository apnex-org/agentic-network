/**
 * list-filters-contains.test.ts — C1-R2 sub-PR-1, the policy-layer (zod) filter
 * validation surface for the `$contains` array-membership operator on an "array"
 * QueryableFieldType. (The substrate SQL/watch surfaces are covered in
 * storage-substrate/__tests__/contains-operator.test.ts.)
 */
import { describe, it, expect } from "vitest";
import { buildQueryFilterSchema } from "../list-filters.js";

describe("list-filters — $contains on an array field-type (C1-R2)", () => {
  const schema = buildQueryFilterSchema({
    roleEligibility: { type: "array" },
    status: { type: "string" },
  });

  it("accepts {$contains: scalar} on an array field", () => {
    expect(schema.safeParse({ roleEligibility: { $contains: "engineer" } }).success).toBe(true);
    expect(schema.safeParse({ roleEligibility: { $contains: 3 } }).success).toBe(true);
    expect(schema.safeParse({ roleEligibility: { $contains: true } }).success).toBe(true);
  });

  it("rejects a bare scalar on an array field (no implicit-equality)", () => {
    expect(schema.safeParse({ roleEligibility: "engineer" }).success).toBe(false);
  });

  it("rejects $in / range / unknown operators on an array field", () => {
    expect(schema.safeParse({ roleEligibility: { $in: ["engineer"] } }).success).toBe(false);
    expect(schema.safeParse({ roleEligibility: { $gt: "x" } }).success).toBe(false);
    expect(schema.safeParse({ roleEligibility: { $bogus: "x" } }).success).toBe(false);
  });

  it("rejects $contains on a non-array (string) field", () => {
    expect(schema.safeParse({ status: { $contains: "x" } }).success).toBe(false);
  });

  it("rejects an unknown field name (.strict() allowlist)", () => {
    expect(schema.safeParse({ nope: { $contains: "x" } }).success).toBe(false);
  });
});
