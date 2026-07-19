/**
 * mp0bn-rehearsal.test.ts — the idea-449 Phase B / B3 mp0bn dress-rehearsal. Reconstructs the
 * mp0bn arc from the blueprint fixture (30 nodes) and rehearses it through the whole-arc sim,
 * making BOTH verifier-gate paths explicit (the 449_B_gate acceptance forbids a rehearsal that
 * plays to done by silently skipping the gate-close constraint):
 *   - RESHAPE (architect-driven -vg + distinct verifier attest) → whole arc reaches all-done;
 *   - TRAP (faithful single-verifier -vg, executor==attester) → the gates DEADLOCK, proving the
 *     sim catches the bug-249 class instead of false-greening it.
 */
import { describe, it, expect } from "vitest";
import { runDressRehearsal } from "../src/mp0bn-rehearsal.js";

describe("449_B B3 — mp0bn dress-rehearsal (both paths, no silent gate-skip)", () => {
  it("the reshape path drives the whole mp0bn arc to all-done; the single-verifier trap deadlocks", async () => {
    const results = await runDressRehearsal();
    const failures = results.filter((r) => !r.pass);
    expect(results.length).toBe(2);
    expect(failures.map((f) => `${f.name}: ${f.detail}`)).toEqual([]);
  }, 30_000);
});
