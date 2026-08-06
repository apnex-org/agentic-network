import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WORK_ITEM_PHASES, TERMINAL_WORK_PHASES } from "../work-item.js";
import { classifyGateChild } from "../work-item-repository-substrate.js";

/**
 * fsmtable0 — THE DOC FAILS THE BUILD WHEN IT LIES.
 *
 * `docs/architecture/workitem-phase-fsm.md` describes the phase FSM. A document describing code
 * goes stale silently — three instances measured in one day (a comment describing pre-bug-433
 * behaviour, a truncation note outliving its remedy, a survey asserting a gap its author had
 * closed). THE FIX IS NOT DILIGENCE: it is that the ✅ columns are ASSERTED HERE, so the table and
 * the code cannot disagree without a red build.
 *
 * ⚠️ SCOPE, STATED SO IT IS NOT OVERREAD: this asserts the MACHINE-CHECKABLE columns only. The
 * table's 📝 columns (intended meaning, suspended-reachability, provenance) are prose and are
 * NOT covered. The doc labels them; this file does not check them.
 */
describe("fsmtable0 — docs/architecture/workitem-phase-fsm.md conformance", () => {
  const DOC = join(dirname(fileURLToPath(import.meta.url)), "../../../../docs/architecture/workitem-phase-fsm.md");
  const doc = readFileSync(DOC, "utf8");

  // POSITIVE CONTROL FIRST. Without it a moved/renamed doc yields an empty string and EVERY
  // assertion below passes vacuously against nothing — bug-464's shape, in the guard.
  it("CONTROL: the document exists and is the right document", () => {
    expect(doc.length, "doc must be non-empty — a wrong path reads as a passing test").toBeGreaterThan(2000);
    expect(doc).toContain("The WorkItem phase FSM");
  });

  it("every phase in the code has a ROW in the table", () => {
    // 🔴 THE FIRST VERSION ASSERTED `doc.toContain("`phase`")` AND WENT GREEN UNDER A MUTANT THAT
    // DELETED A ROW — because the phase name still appeared in the surrounding prose. A CHECK
    // SATISFIED BY THE RIGHT VALUE IN THE WRONG PLACE. Key on the row marker, not the token.
    const rows = new Set([...doc.matchAll(/^\| PHASE:\*{0,2}`([a-z_]+)`/gm)].map((m) => m[1]));
    for (const phase of WORK_ITEM_PHASES) {
      expect([...rows], `phase '${phase}' is in the code and has no ROW in the table`).toContain(phase);
    }
  });

  it("the table names no phase the code does not have", () => {
    // Keyed on an explicit PHASE: marker rather than on 'a row starting with a backtick'.
    // 🔴 THE FIRST VERSION MATCHED THE §1 AXIS TABLE TOO (`status`, `suspended`, …) AND WENT RED.
    // The tempting fix was to loosen the regex until it passed — REWRITING THE CONTRACT TO FIT THE
    // ARTIFACT. The ambiguity was REAL (a reader cannot tell the two tables apart either), so the
    // DOCUMENT was made unambiguous instead. Assert the converse direction so a REMOVED phase
    // cannot linger in the doc while the code moves on.
    for (const m of doc.matchAll(/^\| PHASE:\*{0,2}`([a-z_]+)`\*{0,2} \|/gm)) {
      expect(WORK_ITEM_PHASES as readonly string[], `table row '${m[1]}' is not a real phase`).toContain(m[1]);
    }
  });

  // PER-ARM, NEVER AS A BLOB: a table-shaped assertion passes when two arms are SWAPPED, and
  // swapping done<->failed_sealed is exactly the ruling-inverting change the source forbids.
  it("done is the ONLY phase that satisfies a dependency edge", () => {
    const satisfying = WORK_ITEM_PHASES.filter((p) => classifyGateChild({ status: p }) === "satisfied");
    expect(satisfying).toEqual(["done"]);
  });

  it("abandoned is the ONLY phase that drops out of a gate", () => {
    const dropped = WORK_ITEM_PHASES.filter((p) => classifyGateChild({ status: p }) === "dropped_abandoned");
    expect(dropped).toEqual(["abandoned"]);
  });

  it("🔴 failed_sealed BLOCKS — a gate that drops its own failures is not a gate", () => {
    expect(classifyGateChild({ status: "failed_sealed" })).toBe("pending");
  });

  it("the terminal set is exactly what the table marks terminal", () => {
    expect([...TERMINAL_WORK_PHASES].sort()).toEqual(["abandoned", "done", "failed_sealed"]);
  });

  it("🔴 the table's `paused`-is-vestigial claim is still true in the source", () => {
    // 🔴 THE FIRST VERSION SCANNED ONE FILE AND WENT GREEN UNDER A MUTANT THAT ADDED A LIVE
    // WRITER TO A DIFFERENT ONE. A SWEEP SCOPED TO ONE FILE CANNOT ASSERT A PROPERTY OF THE
    // CODEBASE. Walk hub/src.
    const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const f = join(d, e.name);
        if (e.isDirectory()) return e.name === "__tests__" ? [] : walk(f);
        return e.name.endsWith(".ts") ? [f] : [];
      });
    const files = walk(root);
    // POSITIVE CONTROL: the walk must reach a file we KNOW holds phase literals, else an empty
    // file list makes this pass vacuously — the same shape as the doc-path control above.
    expect(files.some((f) => f.endsWith("work-item-repository-substrate.ts")), "walk must reach the substrate").toBe(true);
    const liveWrites = files.flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .filter((l) => /(status|nextPhase|phase)\s*[:=][^=]*"paused"/.test(l))
        .map((l) => `${f}: ${l.trim()}`),
    );
    expect(liveWrites, `paused gained a live writer — the table's §3 is now WRONG`).toEqual([]);
  });
});
