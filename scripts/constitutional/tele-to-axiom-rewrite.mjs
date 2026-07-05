#!/usr/bin/env node
/**
 * mission-103 P3-S3 — MECHANIZED tele-N → axiom-A-N doc rewrite (transitional).
 *
 * Rewrites the axiom-ref inline citations across the live doc corpus from the
 * legacy tele-N ids to the ratified mission-kit axiom ids (decision-18 batch).
 * Additive-before-destructive: the teles still exist in the Hub until S4, so BOTH
 * surfaces resolve during the transition — this only re-points the CITATIONS.
 *
 * THE MAPPING (decision-18 bijection, the single source of truth reviewers check):
 *   tele-1 .. tele-13  →  A1 .. A13   (1:1)
 *   tele-0             →  A0          (lineage-origin umbrella)
 *   tele-14            →  A0          (refreshed umbrella; collapses to A0 with tele-0)
 *   tele-15            →  A14         (Compounding Learning)
 *
 * SCOPE (per consumer-inventory.md §2 axiom-ref class): inline `tele-<N>` citations
 * only. It does NOT touch: MCP verb-name mentions (get_tele/list_tele/… — S4 scope,
 * tied to the verb deletion), the plural word "teles", "tele-glossary", the
 * `tele_alignment` YAML key (handled separately), or historical-leave surfaces.
 * Charter-ref surfaces (CLAUDE.md, autonomy-charter.md, roadmap.md) are constitutional
 * POINTERS, not citations — repointed by hand, never by this script.
 *
 *   node scripts/constitutional/tele-to-axiom-rewrite.mjs --check   # dry-run, report only
 *   node scripts/constitutional/tele-to-axiom-rewrite.mjs           # apply in place
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECK = process.argv.includes("--check");

/** tele-N → A-N. tele-0 and tele-14 both collapse to the one umbrella axiom A0. */
function mapTele(n) {
  const num = Number(n);
  if (num === 0 || num === 14) return "A0";
  if (num === 15) return "A14";
  if (num >= 1 && num <= 13) return `A${num}`;
  return null; // out-of-range (e.g. tele-16 seed-script note) — leave untouched, report.
}

/** Axiom-ref repo files carrying inline tele-<N> citations (inventory §2).
 *  strategic-review.md is axiom-ref but has ZERO tele-N citations (verb-only) — omitted. */
const PROSE_FILES = [
  "docs/architecture/policy-network-v1.md",
  "docs/designs/c1-r2-workitem-construction-design.md",
  "docs/designs/c1-sovereign-work-control-plane-arc-design.md",
  "docs/designs/c2-agent-lifecycle-substrate-arc-design.md",
  "docs/designs/c3-ship-integrity-spine-arc-design.md",
  "docs/designs/c4-governed-autonomy-arc-design.md",
  "docs/designs/d1-sovereign-rest-control-plane-arc-design.md",
  "docs/designs/m-director-interface/design-inputs.md",
  "docs/designs/m-director-interface/intent-brief.md",
  "docs/designs/sanctioned-role-change-path.md",
  "docs/methodology/autonomous-stint-friction-backlog.md",
  "docs/methodology/autonomous-stint-operating-model.md",
  "docs/methodology/cdacc-dual-altitude-conformance-council.md",
  "docs/methodology/council-agenda.md",
  "docs/methodology/director-profile.md",
  "docs/methodology/idea-triage-vocab.md",
  "docs/methodology/mission-lifecycle.md",
  "docs/methodology/multi-agent-pr-workflow.md",
  "docs/planning/m-agent-behavior-invariants-brief-draft.md",
  "docs/planning/m-invariant-coverage-v2-brief-draft.md",
  "docs/planning/m-invariant-coverage-v3-brief-draft.md",
  "docs/planning/m-trunk-migration-infrastructure-brief-draft.md",
  "docs/specs/cross-lineage-runtime-acceptance-gate.md",
  "docs/specs/ois-api-conventions.md",
  "docs/specs/ois-control-plane-charter.md",
  "docs/specs/verifier-role.md",
];

/** calibrations.yaml — structured YAML: rewrite tele_alignment VALUES only here.
 *  (Field rename tele_alignment→axiom_alignment + calibrations.py is a separate,
 *  architect-gated step so this value-swap is safe under either decision.) */
const YAML_FILE = "docs/calibrations.yaml";

const TELE_RE = /\btele-(\d+)\b/g;

let totalReplaced = 0;
let totalSkipped = 0;
const report = [];

function rewriteText(text) {
  let replaced = 0;
  const skipped = new Set();
  const out = text.replace(TELE_RE, (whole, n) => {
    const mapped = mapTele(n);
    if (mapped === null) {
      skipped.add(whole);
      return whole;
    }
    replaced++;
    return mapped;
  });
  return { out, replaced, skipped: [...skipped] };
}

for (const rel of PROSE_FILES) {
  const abs = join(REPO, rel);
  let text;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    report.push(`  MISSING  ${rel}`);
    continue;
  }
  const { out, replaced, skipped } = rewriteText(text);
  totalReplaced += replaced;
  totalSkipped += skipped.length;
  report.push(`  ${String(replaced).padStart(4)}  ${rel}${skipped.length ? `   [skipped out-of-range: ${skipped.join(", ")}]` : ""}`);
  if (!CHECK && replaced > 0) writeFileSync(abs, out);
}

// calibrations.yaml — only rewrite tele-<N> tokens (the tele_alignment VALUES + the
// header-comment example). The `tele_alignment:` key itself has no digit so TELE_RE
// leaves it intact (the field rename is the separate architect-gated step).
{
  const abs = join(REPO, YAML_FILE);
  const text = readFileSync(abs, "utf8");
  const { out, replaced, skipped } = rewriteText(text);
  totalReplaced += replaced;
  totalSkipped += skipped.length;
  report.push(`  ${String(replaced).padStart(4)}  ${YAML_FILE}   (tele_alignment values)${skipped.length ? `   [skipped: ${skipped.join(", ")}]` : ""}`);
  if (!CHECK && replaced > 0) writeFileSync(abs, out);
}

process.stdout.write(`tele-N → axiom-A-N rewrite ${CHECK ? "(DRY RUN)" : "(APPLIED)"}\n`);
process.stdout.write(`mapping: tele-1..13→A1..13 · tele-0,tele-14→A0 · tele-15→A14\n\n`);
process.stdout.write(report.join("\n") + "\n\n");
process.stdout.write(`TOTAL: ${totalReplaced} citations rewritten across ${PROSE_FILES.length + 1} files` + (totalSkipped ? `, ${totalSkipped} out-of-range skipped` : "") + "\n");
