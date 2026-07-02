/**
 * list-filters-contains.test.ts — C1-R2 sub-PR-1, the policy-layer (zod) filter
 * validation surface for the `$contains` array-membership operator on an "array"
 * QueryableFieldType. (The substrate SQL/watch surfaces are covered in
 * storage-substrate/__tests__/contains-operator.test.ts.)
 */
import { describe, it, expect } from "vitest";
import { buildQueryFilterSchema, applyQueryFilter } from "../list-filters.js";

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

describe("list-filters — applyQueryFilter runtime $contains (audit-4054 #2: matcher + fail-loud)", () => {
  type Row = { id: string; roles: string[] };
  const rows: Row[] = [
    { id: "match", roles: ["engineer", "verifier"] },
    { id: "decoy", roles: ["architect"] },
    { id: "empty", roles: [] },
    { id: "absent", roles: undefined as unknown as string[] },
  ];
  const accessors = { roles: (r: Row) => r.roles };

  function run(filter: Record<string, unknown>): Set<string> {
    return new Set(applyQueryFilter(rows, filter, accessors).map((r) => r.id));
  }

  it("matches only items whose array CONTAINS the scalar (not silent-true on every item)", () => {
    const ids = run({ roles: { $contains: "engineer" } });
    expect(ids.has("match")).toBe(true);
    expect(ids.has("decoy")).toBe(false);
    expect(ids.has("empty")).toBe(false);
    expect(ids.has("absent")).toBe(false);
  });

  it("is TYPED — [3] matches 3 not \"3\"", () => {
    const typedRows = [{ id: "n", roles: [3] as unknown as string[] }];
    expect(applyQueryFilter(typedRows, { roles: { $contains: 3 } }, accessors).length).toBe(1);
    expect(applyQueryFilter(typedRows, { roles: { $contains: "3" } }, accessors).length).toBe(0);
  });

  it("FAIL-LOUD: a genuinely-UNKNOWN operator (typo) reaching the matcher THROWS (no silent-true)", () => {
    expect(() => run({ roles: { $bogus: "x" } })).toThrow(/unknown operator/i);
  });

  it("FAIL-CLOSED on a FORBIDDEN-only op ($regex/$where): no throw, and matches NOTHING (audit-4070)", () => {
    // 3-class taxonomy: FORBIDDEN ($regex/$where/$expr/$or/$and/$not) is rejected at
    // the Zod/MCP boundary WITH a hint; the runtime fail-loud guard must NOT conflate
    // it with UNKNOWN — so the guard does NOT throw (test/policy-router.test.ts
    // contract). But audit-4070: the matcher must then fail-CLOSED — a forbidden-only
    // predicate that bypassed Zod is UNEVALUABLE and matches NOTHING, NEVER
    // match-everything (the prior fall-through `return true` was a fail-OPEN row-leak).
    expect(() => run({ roles: { $regex: "^x" } })).not.toThrow();
    expect(() => run({ roles: { $where: "x" } })).not.toThrow();
    expect(run({ roles: { $regex: "^x" } }).size).toBe(0); // match-NOTHING, not all 4 rows
    expect(run({ roles: { $where: "x" } }).size).toBe(0);
  });

  it("FAIL-CLOSED on an empty operator object {}: matches NOTHING (no-implemented-op, audit-4070)", () => {
    // An empty per-field predicate carries no implemented operator → unevaluable →
    // match-nothing. (A truly absent constraint is expressed by omitting the field,
    // handled by applyQueryFilter's `fields.length === 0` short-circuit.)
    expect(run({ roles: {} }).size).toBe(0);
  });
});
