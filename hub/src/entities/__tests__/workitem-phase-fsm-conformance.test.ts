import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WORK_ITEM_PHASES, TERMINAL_WORK_PHASES } from "../work-item.js";
import { classifyGateChild } from "../work-item-repository-substrate.js";
import { generateDerivableTable, BEGIN_MARKER, END_MARKER } from "../fsm-table-generator.js";

/**
 * fsmtable0 — `docs/architecture/workitem-phase-fsm.md` CANNOT LIE, BECAUSE ITS DERIVABLE HALF IS
 * NOT A DESCRIPTION. IT IS AN OUTPUT.
 *
 * 🔴 THE FIRST VERSION OF THIS FILE PARSED THE MARKDOWN WITH REGEXES, AND greg PREDICTED THE
 * FAILURE MODE FROM THE DESIGN ALONE: a guard coupled to a doc's FORMATTING goes red for a
 * reordered column (not a lie), or SILENTLY STOPS MATCHING AND GOES VACUOUSLY GREEN — bug-464's
 * shape inside the instrument built to prevent drift.
 *
 * ⭐ IT WAS NOT THEORETICAL. IT HAD ALREADY FIRED: the mutation cell that DELETED a phase row
 * passed, because the regex found the phase name in surrounding prose. HIS PREDICTED HAZARD AND MY
 * MEASURED HOLE WERE THE SAME DEFECT, DERIVED INDEPENDENTLY FROM OPPOSITE DIRECTIONS.
 *
 * ⇒ SO THE DERIVABLE COLUMNS ARE GENERATED FROM THE CODE AND THE DOC MUST CONTAIN THE RESULT
 *   BYTE-FOR-BYTE. There is no pattern to go stale: a diff is a diff. This is to a document what
 *   #748's D6 fix was to the storage enum — DERIVE, don't keep two artifacts in step.
 *
 * ⚠️ SCOPE: only the machine-derivable columns are generated. Intended meaning, provenance and the
 * `suspended` interaction are PROSE, live outside the generated block, and are labelled unverified
 * in the document. A table whose checked and unchecked halves look identical is worse than one
 * that admits the split.
 */

const BEGIN = BEGIN_MARKER;
const END = END_MARKER;

describe("fsmtable0 — the phase-FSM doc's derivable half is GENERATED, not described", () => {
  const DOC = join(dirname(fileURLToPath(import.meta.url)), "../../../../docs/architecture/workitem-phase-fsm.md");
  const doc = readFileSync(DOC, "utf8");

  // CONTROLS FIRST. Without these a moved doc or vanished markers make every assertion below pass
  // against nothing — the vacuous-green this file exists to eliminate.
  it("CONTROL: the document exists, is the right document, and carries both markers", () => {
    expect(doc.length, "empty doc — a wrong path reads as a passing test").toBeGreaterThan(2000);
    expect(doc).toContain("The WorkItem phase FSM");
    expect(doc, "BEGIN marker missing — the generated block cannot be located").toContain(BEGIN);
    expect(doc, "END marker missing").toContain(END);
  });

  it("CONTROL: the generator emits one row per phase and is not empty", () => {
    const g = generateDerivableTable();
    expect(g.split("\n").length).toBe(WORK_ITEM_PHASES.length + 6);
    for (const p of WORK_ITEM_PHASES) expect(g).toContain(`\`${p}\``);
  });

  it("🔴 the doc's generated block matches the code BYTE-FOR-BYTE", () => {
    const start = doc.indexOf(BEGIN);
    const end = doc.indexOf(END);
    const inDoc = doc.slice(start, end + END.length);
    expect(
      inDoc,
      "THE TABLE AND THE CODE DISAGREE. Regenerate the block; do not hand-edit it.",
    ).toBe(generateDerivableTable());
  });

  // Per-arm assertions on the RULINGS, kept because a byte-diff tells you THAT the table moved,
  // never WHICH ruling inverted — and these three arms encode Director rulings.
  it("done is the ONLY phase that satisfies a dependency edge", () => {
    expect(WORK_ITEM_PHASES.filter((p) => classifyGateChild({ status: p }) === "satisfied")).toEqual(["done"]);
  });

  it("abandoned is the ONLY phase that drops out of a gate", () => {
    expect(WORK_ITEM_PHASES.filter((p) => classifyGateChild({ status: p }) === "dropped_abandoned")).toEqual(["abandoned"]);
  });

  it("🔴 failed_sealed BLOCKS — a gate that drops its own failures is not a gate", () => {
    expect(classifyGateChild({ status: "failed_sealed" })).toBe("pending");
  });

  it("🔴 the doc's `paused`-is-vestigial claim is still true across hub/src", () => {
    // A SWEEP SCOPED TO ONE FILE CANNOT ASSERT A PROPERTY OF THE CODEBASE — the first version
    // scanned one file and passed under a mutant that added a live writer to another.
    const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const f = join(d, e.name);
        if (e.isDirectory()) return e.name === "__tests__" ? [] : walk(f);
        return e.name.endsWith(".ts") ? [f] : [];
      });
    const files = walk(root);
    expect(files.some((f) => f.endsWith("work-item-repository-substrate.ts")), "walk must reach the substrate").toBe(true);
    const liveWrites = files.flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .filter((l) => /(status|nextPhase|phase)\s*[:=][^=]*"paused"/.test(l))
        .map((l) => `${f}: ${l.trim()}`),
    );
    expect(liveWrites, "paused gained a live writer — the doc's §3 is now WRONG").toEqual([]);
  });
});
