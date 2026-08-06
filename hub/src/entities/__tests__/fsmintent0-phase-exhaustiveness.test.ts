/**
 * fsmintent0 — THE PHASE SET IS EXHAUSTIVE BY CONSTRUCTION, AND THE TWO LISTS CANNOT DRIFT.
 *
 * 🔴 WHAT THIS GUARDS, MEASURED BEFORE THE FIX EXISTED:
 * adding a terminal phase to `WorkItemPhase` left `tsc` GREEN (falsifier CELL 1,
 * docs/planning/fsmintent0-falsifier-run.md, 10:51Z). A new phase compiled, would have deployed,
 * and would have been swallowed by classifyGateChild's catch-all as `pending` — blocking every
 * dependent FOREVER, silently. The falsifier's question was "does adding a phase BREAK anything?"
 * and the answer was NO, which is the worse answer.
 *
 * ⚠️ THE COMPILE-TIME HALF IS NOT TESTABLE FROM HERE. `Record<WorkItemPhase, …>` is enforced by
 * tsc, not by vitest — a runtime test CANNOT observe a missing key that fails to compile. The
 * pre-registered falsifier is the instrument for that half and it is re-run at delivery, not here.
 * These cells guard the RUNTIME half: that the table's VALUES are right and that the storage enum
 * has not drifted from the type.
 */
import { describe, it, expect } from "vitest";
import { WORK_ITEM_PHASES, TERMINAL_WORK_PHASES } from "../work-item.js";
import { classifyGateChild } from "../work-item-repository-substrate.js";
import { ALL_SCHEMAS } from "../../storage-substrate/schemas/all-schemas.js";

describe("fsmintent0 — phase-set exhaustiveness", () => {
  // ── D6: the two hand-maintained lists, tied together ─────────────────────
  it("🔴 the STORAGE enum and the TS phase list are the same set (D6)", () => {
    const workItemSchema = ALL_SCHEMAS.find((s) => s.kind === "WorkItem");
    // POSITIVE CONTROL FIRST — without it a renamed kind or field makes every assertion
    // below pass vacuously against `undefined`, which is bug-464's shape.
    expect(workItemSchema, "WorkItem schema must exist").toBeDefined();
    const statusField = workItemSchema!.fields.find((f) => f.name === "status");
    expect(statusField, "WorkItem.status field must exist").toBeDefined();
    expect(statusField!.enum, "WorkItem.status must declare an enum").toBeDefined();

    expect([...statusField!.enum!].sort()).toEqual([...WORK_ITEM_PHASES].sort());
  });

  it("the terminal set is a SUBSET of the phase list (no phantom terminal)", () => {
    for (const phase of TERMINAL_WORK_PHASES) {
      expect(WORK_ITEM_PHASES).toContain(phase);
    }
  });

  // ── the gate-resolution table's VALUES, per phase ─────────────────────────
  // Asserted individually rather than as a blob: a table-shaped assertion passes when two
  // arms are swapped, and swapping `done` with `failed_sealed` is exactly the ruling-inverting
  // change the source comments forbid.
  it("🔴 done is the ONLY phase that satisfies a dependency edge", () => {
    const satisfying = WORK_ITEM_PHASES.filter(
      (p) => classifyGateChild({ status: p }) === "satisfied",
    );
    expect(satisfying).toEqual(["done"]);
  });

  it("🔴 abandoned is the ONLY phase that is DROPPED (Director ruling 2026-07-29)", () => {
    const dropped = WORK_ITEM_PHASES.filter(
      (p) => classifyGateChild({ status: p }) === "dropped_abandoned",
    );
    expect(dropped).toEqual(["abandoned"]);
  });

  it("🔴 failed_sealed BLOCKS — a gate that drops its own failures is not a gate", () => {
    expect(classifyGateChild({ status: "failed_sealed" })).toBe("pending");
  });

  it("every remaining phase is pending, and none is unclassified", () => {
    for (const phase of WORK_ITEM_PHASES) {
      const resolution = classifyGateChild({ status: phase });
      // `undefined` is what a missing Record key would yield at runtime if the compile-time
      // guard were ever weakened to an index signature. Assert it never happens.
      expect(resolution, `phase ${phase} must classify`).toBeDefined();
      expect(["satisfied", "dropped_abandoned", "pending"]).toContain(resolution);
    }
  });

  // ── absence is kept distinct from decision ────────────────────────────────
  it("both representations of ABSENCE classify as missing, and missing !== dropped", () => {
    expect(classifyGateChild(null)).toBe("missing");
    expect(classifyGateChild(undefined)).toBe("missing");
    expect(classifyGateChild({ status: "missing" })).toBe("missing");
    expect(classifyGateChild({ status: "missing" })).not.toBe("dropped_abandoned");
  });
});
