/**
 * oracles.test.ts — the A8 evidence (idea-449 Phase A): the whole adversarial oracle
 * catalog runs against the REAL WorkGraph engine. Legal moves are accepted and land the
 * spec-table's expected phase; illegal moves, wrong/absent/stolen leases, terminal pokes,
 * and cross-role calls are all rejected. Non-vacuous (>20 distinct properties) + green.
 */
import { describe, it, expect } from "vitest";
import { runOracleCatalog } from "../src/oracles.js";

describe("WorkGraph FSM — adversarial oracle catalog (idea-449 A8)", () => {
  it("every oracle passes against the REAL substrate-backed engine", async () => {
    const results = await runOracleCatalog();
    const failures = results.filter((r) => !r.pass);
    // Non-vacuity: the catalog must actually exercise a broad property set.
    expect(results.length).toBeGreaterThan(20);
    expect(
      failures,
      `\n${failures.map((f) => `  ✗ ${f.name}: ${f.detail}`).join("\n")}\n`,
    ).toEqual([]);
  }, 30_000);
});
