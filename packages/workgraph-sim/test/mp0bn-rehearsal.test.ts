/**
 * mp0bn-rehearsal.test.ts — the idea-449 Phase B / B3 mp0bn dress-rehearsal. Reconstructs the
 * mp0bn arc from the blueprint fixture (30 nodes) and rehearses it through the whole-arc sim,
 * making BOTH verifier-gate paths explicit (the 449_B_gate acceptance forbids a rehearsal that
 * plays to done by silently skipping the gate-close constraint):
 *   - RESHAPE (architect-driven -vg + distinct verifier attest) → whole arc reaches all-done;
 *   - SINGLE-VERIFIER (faithful single-verifier -vg, executor==attester) → post-#616 (bug-249 /
 *     idea-528) the target-work-scoped self-attest fence permits it (the verifier did not author the
 *     gated work), so the gates close and the arc reaches all-done. (Pre-#616 this deadlocked.)
 */
import { describe, it, expect } from "vitest";
import { runDressRehearsal } from "../src/mp0bn-rehearsal.js";

describe("449_B B3 — mp0bn dress-rehearsal (both paths, no silent gate-skip)", () => {
  it("the reshape path and the single-verifier path both drive the mp0bn arc to all-done (bug-249 fixed)", async () => {
    const results = await runDressRehearsal();
    const failures = results.filter((r) => !r.pass);
    expect(results.length).toBe(2);
    expect(failures.map((f) => `${f.name}: ${f.detail}`)).toEqual([]);
  }, 30_000);
});
