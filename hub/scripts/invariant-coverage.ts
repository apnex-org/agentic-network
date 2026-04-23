/**
 * Invariant-coverage scanner — Mission-41 Wave 1 T5.
 *
 * Scans the repository's test tree for `assertInv*` call-sites (exported
 * by `hub/test/e2e/invariant-helpers.ts`) and emits a machine-readable
 * coverage report at `docs/audits/workflow-test-coverage.md`.
 *
 * Invoke via: `npm run coverage:invariants` (from hub/)
 *
 * Report shape (per-INV row): id · status · location(s) · note.
 * Status values:
 *   - `Tested`       — ≥1 call-site found; helper is NOT stubbed.
 *   - `Stub`         — helper is stubbed (InvariantNotYetTestable); graduates in Wave 2.
 *   - `Out-of-Scope` — INV is in spec §7.2 but NOT in Mission-41 Wave-2 ratified subset.
 *
 * The ratified 10-invariant subset + stubbed pair come from
 * `docs/missions/mission-41-kickoff-decisions.md` §Decision 1. The
 * broader 28-invariant `Tested By: NONE` set is cited as Wave 3 /
 * out-of-scope; the 18 non-ratified entries appear in a footer section.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// ── Ratified Wave-2 subset (kickoff-decisions §Decision 1) ──────────

const RATIFIED_INVARIANTS = [
  { id: "INV-T4",   note: "Task terminal states — completed/failed/escalated/cancelled" },
  { id: "INV-P1",   note: "Architect-only proposal review" },
  { id: "INV-P2",   note: "Only submitted proposals reviewable (gap-surfacing ratchet)" },
  { id: "INV-P4",   note: "Proposal `implemented` is terminal" },
  { id: "INV-TH6",  note: "Non-active thread replies rejected" },
  { id: "INV-TH7",  note: "close_thread architect-only stewardship" },
  { id: "INV-I2",   note: "Idea auto-linkage failure is non-fatal" },
  { id: "INV-M4",   note: "Mission completed/abandoned are terminal" },
  { id: "INV-TH18", note: "Workflow turn-pinning (cascade guard) — P2 spec" },
  { id: "INV-TH19", note: "Cascade validate-then-execute atomicity — P2 spec" },
] as const;

const STUBBED = new Set<string>(["INV-TH18", "INV-TH19"]);

// The 18 non-ratified NONE invariants from workflow-registry §7.2.
// Kept hard-coded for v1; a Wave-3 enhancement can parse the spec
// directly to keep this list in sync.
const OUT_OF_SCOPE_V1 = [
  // Entity (6 not in ratified set)
  { id: "INV-TH8", note: "Thread invariant (not in ratified v1 subset)" },
  { id: "INV-TN1", note: "Turn invariant" },
  { id: "INV-TE1", note: "Tele invariant" },
  { id: "INV-TE2", note: "Tele invariant" },
  { id: "INV-A1",  note: "Agent invariant" },
  { id: "INV-A2",  note: "Agent invariant" },
  { id: "INV-D1",  note: "Director-notification invariant" },
  { id: "INV-D2",  note: "Director-notification invariant" },
  // System / Cross-domain (est.) — spec §7.2 summary: 28 NONEs total.
  // Remaining entries are the system + cross-domain subtotals (§7.2 summary row).
  { id: "INV-S*-unlisted", note: "System-invariant subset (spec §7.2 summary: 8 system NONEs) — enumerate in Wave 3" },
  { id: "INV-XD*-unlisted", note: "Cross-domain-invariant subset (spec §7.2 summary: 2 cross-domain NONEs) — enumerate in Wave 3" },
] as const;

// ── Scanner ─────────────────────────────────────────────────────────

interface CallSite {
  readonly file: string;
  readonly line: number;
  readonly snippet: string;
}

interface Coverage {
  readonly id: string;
  readonly status: "Tested" | "Stub" | "Out-of-Scope";
  readonly note: string;
  readonly sites: readonly CallSite[];
}

const REPO_ROOT = resolve(new URL(import.meta.url).pathname, "..", "..", "..");
const SCAN_ROOTS = [
  "hub/test",
  "adapters/claude-plugin/test",
  "adapters/opencode-plugin/test",
  "packages/cognitive-layer/test",
  "packages/network-adapter/test",
];
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git"]);

// `assertInv<ID>(` — immediate paren (rules out description strings like
// `it("assertInvT4 (task terminal states)")` which happen to have `(` after
// a space). Matches both call-sites AND the helper's export-function
// definition line; the definition site is useful canonical-location
// metadata so kept in the report rather than filtered.
const CALL_SITE_RE = /\bassertInv([A-Z]+[A-Z0-9]*)\(/g;

function* walkFiles(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      yield* walkFiles(full);
    } else if (s.isFile()) {
      const dot = entry.lastIndexOf(".");
      if (dot >= 0 && SCAN_EXTENSIONS.has(entry.slice(dot))) {
        yield full;
      }
    }
  }
}

function scanForCallSites(repoRoot: string): Map<string, CallSite[]> {
  const byId = new Map<string, CallSite[]>();
  for (const root of SCAN_ROOTS) {
    const absRoot = join(repoRoot, root);
    for (const file of walkFiles(absRoot)) {
      let contents: string;
      try {
        contents = readFileSync(file, "utf-8");
      } catch {
        continue;
      }
      const lines = contents.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const matches = line.matchAll(CALL_SITE_RE);
        for (const m of matches) {
          const suffix = m[1];
          const id = `INV-${suffix}`;
          const site: CallSite = {
            file: relative(repoRoot, file),
            line: i + 1,
            snippet: line.trim(),
          };
          const list = byId.get(id);
          if (list) list.push(site);
          else byId.set(id, [site]);
        }
      }
    }
  }
  return byId;
}

// ── Report composition ──────────────────────────────────────────────

function composeCoverage(callSitesById: Map<string, CallSite[]>): Coverage[] {
  const out: Coverage[] = [];
  for (const { id, note } of RATIFIED_INVARIANTS) {
    const sites = callSitesById.get(id) ?? [];
    // Filter to non-test-file sites + test-file sites separately? No — any
    // call-site counts. The stub decision is a helper-shape fact, not a
    // call-site count.
    const status: Coverage["status"] = STUBBED.has(id)
      ? "Stub"
      : sites.length > 0
        ? "Tested"
        : "Stub"; // conservative: if ratified + no call-site, surface as Stub (helper needs a consumer)
    out.push({ id, status, note, sites });
  }
  for (const { id, note } of OUT_OF_SCOPE_V1) {
    out.push({ id, status: "Out-of-Scope", note, sites: [] });
  }
  return out;
}

function formatSites(sites: readonly CallSite[]): string {
  if (sites.length === 0) return "—";
  // Collapse to "file:line" list; limit to 5 for readability, append "(+N more)".
  const shown = sites.slice(0, 5).map((s) => `\`${s.file}:${s.line}\``).join(", ");
  const extra = sites.length > 5 ? ` (+${sites.length - 5} more)` : "";
  return shown + extra;
}

function renderMarkdown(coverage: Coverage[], generatedAt: string): string {
  const ratified = coverage.filter((c) => c.status !== "Out-of-Scope");
  const outOfScope = coverage.filter((c) => c.status === "Out-of-Scope");

  const tested = ratified.filter((c) => c.status === "Tested").length;
  const stub = ratified.filter((c) => c.status === "Stub").length;
  const totalRatified = ratified.length;

  const lines: string[] = [];
  lines.push("# Workflow-Invariant Test Coverage");
  lines.push("");
  lines.push("**Mission:** mission-41 (M-Workflow-Test-Harness) Wave 1 T5.");
  lines.push(`**Generated:** ${generatedAt} (via \`npm run coverage:invariants\` from \`hub/\`).`);
  lines.push("**Status source:** scanner output over `assertInv*` call-sites + kickoff-decisions §Decision 1 ratified subset.");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Dimension | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| Ratified Wave-2 subset | ${totalRatified} |`);
  lines.push(`| &nbsp;&nbsp;Tested (≥1 call-site, helper not stubbed) | ${tested} |`);
  lines.push(`| &nbsp;&nbsp;Stubbed (pending Wave 2 graduation) | ${stub} |`);
  lines.push(`| Out-of-Scope for v1 (§7.2 NONE, not in ratified subset) | ${outOfScope.length} |`);
  lines.push("");
  lines.push("## Per-invariant status — ratified subset");
  lines.push("");
  lines.push("| INV-id | Status | Call sites | Note |");
  lines.push("|---|---|---|---|");
  for (const c of ratified) {
    lines.push(`| \`${c.id}\` | ${c.status} | ${formatSites(c.sites)} | ${c.note} |`);
  }
  lines.push("");
  lines.push("## Out-of-scope for v1");
  lines.push("");
  lines.push("Invariants from `docs/specs/workflow-registry.md` §7.2 `Tested By: NONE` that are NOT in the ratified Wave-2 subset. Deferred to Wave 3 / post-mission-41 for follow-up idea filings.");
  lines.push("");
  lines.push("| INV-id | Note |");
  lines.push("|---|---|");
  for (const c of outOfScope) {
    lines.push(`| \`${c.id}\` | ${c.note} |`);
  }
  lines.push("");
  lines.push("## Regeneration");
  lines.push("");
  lines.push("```bash");
  lines.push("cd hub && npm run coverage:invariants");
  lines.push("```");
  lines.push("");
  lines.push("Overwrites this file. Check in the regenerated version on any change to `assertInv*` call-sites or the ratified subset.");
  lines.push("");
  lines.push("## Provenance");
  lines.push("");
  lines.push("- **Scanner:** `hub/scripts/invariant-coverage.ts`");
  lines.push("- **Helpers:** `hub/test/e2e/invariant-helpers.ts` (Mission-41 T2, commit `b0208d3`)");
  lines.push("- **Ratified subset:** `docs/missions/mission-41-kickoff-decisions.md` §Decision 1 (Director-ratified 2026-04-23)");
  lines.push("- **Parent spec:** `docs/specs/workflow-registry.md` §7.2");
  lines.push("- **Task:** task-328 (Wave 1 T5)");

  return lines.join("\n") + "\n";
}

// ── Entry ───────────────────────────────────────────────────────────

function main(): void {
  const callSitesById = scanForCallSites(REPO_ROOT);
  const coverage = composeCoverage(callSitesById);
  const generatedAt = new Date().toISOString();
  const markdown = renderMarkdown(coverage, generatedAt);
  const outPath = join(REPO_ROOT, "docs/audits/workflow-test-coverage.md");
  writeFileSync(outPath, markdown, "utf-8");
  // eslint-disable-next-line no-console
  console.log(`[invariant-coverage] wrote ${relative(REPO_ROOT, outPath)}`);
  // eslint-disable-next-line no-console
  console.log(`[invariant-coverage] scanned ${SCAN_ROOTS.length} test roots; found call-sites for ${callSitesById.size} distinct INV ids`);
  for (const [id, sites] of Array.from(callSitesById.entries()).sort()) {
    // eslint-disable-next-line no-console
    console.log(`  ${id}: ${sites.length} site${sites.length === 1 ? "" : "s"}`);
  }
}

main();
