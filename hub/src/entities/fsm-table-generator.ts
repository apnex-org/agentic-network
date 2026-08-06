/**
 * fsmtable0 — THE SINGLE SOURCE OF TRUTH FOR THE DERIVABLE HALF OF
 * `docs/architecture/workitem-phase-fsm.md`.
 *
 * 🔴 THE DOC CANNOT LIE ABOUT THESE COLUMNS BECAUSE THEY ARE NOT A DESCRIPTION — THEY ARE AN
 * OUTPUT. The conformance test regenerates this block and requires the checked-in document to
 * match it BYTE-FOR-BYTE, so drift surfaces as a diff in a PR rather than as prose nobody rereads.
 *
 * WHY NOT SIMPLY ASSERT THE DOC'S CLAIMS? Because a guard that PARSES markdown is coupled to the
 * document's FORMATTING: a reordered column goes red without a lie, and — worse — a renamed header
 * makes the pattern silently stop matching and the guard goes VACUOUSLY GREEN. That is bug-464's
 * shape inside the very instrument built to prevent drift, and it is not hypothetical: the first
 * version of this guard passed a mutation that DELETED a phase row, because the phase name still
 * appeared in the surrounding prose.
 *
 * ⭐ THIS IS TO A DOCUMENT WHAT #748's D6 FIX WAS TO THE STORAGE ENUM. That fix did not assert
 * that the enum matched the TS type; it DERIVED one from the other so they cannot disagree.
 * Asserting leaves two artifacts someone must keep in step. Generating leaves one.
 */
import { WORK_ITEM_PHASES, TERMINAL_WORK_PHASES } from "./work-item.js";
import {
  classifyGateChild,
  WIP_PHASES,
  LEASE_HELD_PHASES,
  RELEASABLE_PHASES,
} from "./work-item-repository-substrate.js";

export const BEGIN_MARKER = "<!-- BEGIN GENERATED: derived from code. Do not hand-edit. -->";
export const END_MARKER = "<!-- END GENERATED -->";

export function generateDerivableTable(): string {
  const y = (b: boolean) => (b ? "yes" : "–");
  const rows = WORK_ITEM_PHASES.map(
    (p) =>
      `| \`${p}\` | ${classifyGateChild({ status: p })} | ${y(WIP_PHASES.includes(p))} | ` +
      `${y(LEASE_HELD_PHASES.includes(p))} | ${y(RELEASABLE_PHASES.includes(p))} | ` +
      `${y((TERMINAL_WORK_PHASES as ReadonlySet<string>).has(p))} |`,
  );
  return [
    BEGIN_MARKER,
    "",
    "| phase | dependent effect | counts as WIP | holds a lease | releasable | terminal |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
    END_MARKER,
  ].join("\n");
}
