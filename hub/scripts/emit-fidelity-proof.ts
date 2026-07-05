/**
 * mission-103 P3-S2 — render the constitutional fidelity proof.
 *
 * Runs the fidelity engine and writes the human-readable proof matrix to
 * docs/proofs/m-constitutional-transition/S2-fidelity-suite.md (the proofRef the
 * batch decision cites) plus a machine-readable JSON sidecar. Deterministic: no
 * clock, no network — reproducible from the vendored fixtures alone.
 *
 *   npx tsx scripts/emit-fidelity-proof.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runSuite, DIMENSIONS } from "../src/policy/__tests__/constitution-fidelity-engine.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const OUT_DIR = join(REPO, "docs", "proofs", "m-constitutional-transition");

const r = runSuite();
const shortDims = ["D1", "D2", "D3", "D4", "D5", "D6", "D7"];
const tick = (b: boolean) => (b ? "✅" : "❌");

let md = `# S2 Constitutional Fidelity Proof — mission-103 P3\n\n`;
md += `**Verdict: ${r.pass ? "PASS — all 15 pairs clean across all 7 dimensions" : "FAIL — see red cells"}**\n\n`;
md += `- mission-kit axioms frozen at: \`${r.missionKitSha}\`\n`;
md += `- live tele snapshot captured: \`${r.teleSnapshotCapturedAt}\` (active set tele-1..tele-15; tele-0 superseded/historical)\n`;
md += `- reproduce: \`cd hub && npx vitest run src/policy/__tests__/constitution-fidelity.test.ts\` (asserts) · \`npx tsx scripts/emit-fidelity-proof.ts\` (this matrix)\n\n`;
md += `Cardinality: ${r.cardinality.detail}\n\n`;

md += `## Dimensions\n`;
md += `D1 cardinality/isomorphism · D2 mandate parity · D3 mechanics parity · D4 fault-boundary (scar) · D5 success-criteria parity · D6 org-detail confinement · D7 provenance echo\n\n`;

md += `## Pass matrix (pair × dimension)\n\n`;
md += `| Pair | Source tele | ${shortDims.join(" | ")} | Pair |\n`;
md += `|---|---|${shortDims.map(() => ":-:").join("|")}|:-:|\n`;
for (const p of r.pairs) {
  const cells = DIMENSIONS.map((d) => tick(p.dims[d].pass));
  md += `| **${p.axiom}**${p.umbrella ? " (umbrella)" : ""} | ${p.tele} | ${cells.join(" | ")} | ${tick(p.pass)} |\n`;
}

md += `\n## Per-pair detail\n\n`;
for (const p of r.pairs) {
  md += `### ${p.axiom} ← ${p.tele}${p.umbrella ? " (umbrella)" : ""} — ${tick(p.pass)}\n`;
  for (const d of DIMENSIONS) {
    const cell = p.dims[d];
    md += `- ${tick(cell.pass)} \`${d}\` — ${cell.detail}${cell.missing?.length ? ` (missing: ${cell.missing.join("; ")})` : ""}\n`;
  }
  md += `\n`;
}

if (r.residueNotes.length) {
  md += `## Non-gating informational findings\n\n`;
  md += `These are NOT fidelity failures — no mandate weakened, no mechanic or fault dropped. They are org-hygiene residues surfaced for transparency; each is a mission-kit copy-edit candidate, not a batch blocker.\n\n`;
  for (const n of r.residueNotes) md += `- ${n}\n`;
  md += `\n`;
}

md += `## What each dimension mechanically checks\n\n`;
md += `- **D1** — the tele→axiom map is a bijection over 15 axioms and 15 active teles; each axiom's \`source-tele\` frontmatter resolves into its paired tele's lineage (A0's origin tele-0 is superseded by the live pair tele-14).\n`;
md += `- **D2/D3/D5** — every load-bearing mandate concept, named mechanic, and success concept from the tele is present in the axiom's corresponding section; axiom success-criteria count ≥ tele count (no criterion dropped).\n`;
md += `- **D4 (the scar check)** — every named fault in the tele has a covering fault in the axiom (rename-aware: "Director Fatigue"→"Principal Fatigue" in A0, "DAG Manual Stitching"→"Dependency Manual Stitching" in A6). A dropped fault is the anti-laundering failure this dimension exists to catch.\n`;
md += `- **D6** — the axiom's normative body carries zero org-operational identifiers (numbered entity ids, tool names, internal proper nouns like Hub/OIS/PolicyRouter); org lineage is confined to frontmatter + Provenance.\n`;
md += `- **D7** — a Provenance section exists and cites the source-tele lineage.\n`;

const jsonOut = {
  verdict: r.pass ? "PASS" : "FAIL",
  missionKitSha: r.missionKitSha,
  teleSnapshotCapturedAt: r.teleSnapshotCapturedAt,
  cardinality: r.cardinality,
  matrix: r.pairs.map((p) => ({
    axiom: p.axiom,
    tele: p.tele,
    umbrella: p.umbrella,
    pass: p.pass,
    dims: Object.fromEntries(DIMENSIONS.map((d) => [d, p.dims[d].pass])),
  })),
  residueNotes: r.residueNotes,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "S2-fidelity-suite.md"), md);
writeFileSync(join(OUT_DIR, "S2-fidelity-suite.json"), JSON.stringify(jsonOut, null, 2) + "\n");

// Console summary.
process.stdout.write(md);
process.stdout.write(`\n[emit-fidelity-proof] wrote docs/proofs/m-constitutional-transition/S2-fidelity-suite.{md,json} — verdict ${jsonOut.verdict}\n`);
if (!r.pass) process.exitCode = 1;
