/**
 * mission-103 P3-S2 — THE CONSTITUTIONAL FIDELITY SUITE (engine).
 *
 * The design §4 mechanical fidelity suite over every tele→axiom pair, and the
 * design §6 "fidelity ×7" binding contract-test floor. This module is the pure,
 * deterministic engine; `constitution-fidelity.test.ts` asserts every dimension
 * green (the permanent floor), and `scripts/emit-fidelity-proof.ts` renders the
 * proof matrix the S2 batch decision cites as its `proofRef`.
 *
 * WHAT IT PROVES: the 15 mission-kit axioms (A0..A14, frozen at mission-kit
 * HEAD a93e711) faithfully carry the 15 live teles (tele-1..tele-15, snapshot
 * captured at migration time) — no mandate weakened, no mechanic dropped, and
 * critically NO FAULT SILENTLY DROPPED (the anti-laundering scar check). Both
 * corpora are vendored fixtures so the suite survives the S4b tele tombstone.
 *
 * THE MAPPING (design §4): tele-1..tele-13 → A1..A13 (1:1); tele-14 → A0 (the
 * refreshed umbrella that supersedes the original tele-0; A0's frontmatter
 * records the lineage origin as source-tele: tele-0); tele-15 → A14. The active
 * tele set is exactly tele-1..tele-15 (tele-0 is superseded, historical).
 *
 * THE 7 DIMENSIONS (each pair × each dimension is BINARY per the architect's
 * batch-wording alignment — all-pass ⇒ one batch decision; any fail ⇒ that pair
 * splits to a contested Director single, never laundered into the batch):
 *   D1 cardinality/isomorphism  — the map is a bijection; frontmatter source-tele
 *                                 resolves into the paired tele's lineage.
 *   D2 mandate parity           — every load-bearing mandate concept is present.
 *   D3 mechanics parity         — every named mechanic is present.
 *   D4 fault-boundary parity    — THE SCAR CHECK: every tele fault has a covering
 *                                 axiom fault (rename-aware); none dropped.
 *   D5 success-criteria parity  — every success concept present; axiom criteria
 *                                 count ≥ tele count (no criterion dropped).
 *   D6 org-detail confinement   — the normative body carries zero org-operational
 *                                 identifiers (entity ids, tool names, internal
 *                                 proper nouns); org lineage lives only in
 *                                 frontmatter + Provenance. Generalized role
 *                                 vocabulary (Director/Architect/Engineer) and the
 *                                 bare principle-term "tele" are NOT operational
 *                                 identifiers and are reported as non-gating
 *                                 informational residue, not failed.
 *   D7 provenance echo          — a Provenance section exists and cites the
 *                                 source-tele lineage.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PAIRS, FAULT_RENAMES, type PairSpec } from "./constitution-fidelity-pairs.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures", "constitution-migration");
const AXIOM_DIR = join(FIX, "axioms-a93e711");

export const DIMENSIONS = [
  "D1-cardinality",
  "D2-mandate",
  "D3-mechanics",
  "D4-fault-scar",
  "D5-success-criteria",
  "D6-org-confinement",
  "D7-provenance",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/** Operational identifiers that must never appear in a normative axiom body —
 *  the portability-breaking class. Numbered entity ids, tool-name patterns,
 *  agent-id patterns, and this-org-internal proper nouns. Deliberately EXCLUDES
 *  generalized role nouns and the bare word "tele" (tracked separately, D6 note). */
const ORG_OPERATIONAL = [
  /\b(?:mission|tele|idea|bug|work|decision|audit|dconf|prop|task|turn|thread|pr)-\d+/i,
  /\bAX-\d+\b/,
  /\bKMS-META\S*/i,
  /\b(?:Hub|OIS|PolicyRouter|TestOrchestrator|CDACC)\b/,
  /\bPolicy Router\b/,
  /\bworkflow-registry\b/,
  /\bapnex\b/i,
  /\b(?:get|create|list|update|resolve|claim|bind|amend)_[a-z_]+\b/,
  /\b(?:agent|eng|seed)-[0-9a-f]{4,}/i,
];

/** Non-gating informational residue: generalized role nouns + the org's bare
 *  principle-term. Reported so the verifier sees exactly where they occur. */
const RESIDUE_TERMS = /\b(?:inter-tele|teles|tele|Hub|Director|Architect|Engineer)\b/g;

export interface AxiomDoc {
  id: string;
  path: string;
  frontmatter: Record<string, string>;
  sourceTele: string;
  title: string;
  sections: Record<string, string>; // heading(lower) -> body text
  bodyNormative: string; // Mandate..last section before Provenance
  provenance: string;
}

export interface TeleSnapshot {
  id: string;
  name: string;
  status: string;
  faults: string[];
  mandate: string;
  successCriteriaCount: number;
  supersedes?: string;
}

export function loadTeles(): TeleSnapshot[] {
  const raw = JSON.parse(readFileSync(join(FIX, "teles-migration-snapshot.json"), "utf8"));
  return raw.teles as TeleSnapshot[];
}

export function loadAxioms(): AxiomDoc[] {
  const files = readdirSync(AXIOM_DIR).filter((f) => /^A\d+-.*\.md$/.test(f));
  return files.map((f) => parseAxiom(join(AXIOM_DIR, f))).sort((a, b) => axNum(a.id) - axNum(b.id));
}

function axNum(id: string): number {
  return Number(id.replace(/^A/, ""));
}

export function parseAxiom(path: string): AxiomDoc {
  const text = readFileSync(path, "utf8");
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) throw new Error(`${path}: no frontmatter`);
  const frontmatter: Record<string, string> = {};
  for (const line of fmMatch[1].split("\n")) {
    const m = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (m) frontmatter[m[1]] = m[2].trim();
  }
  const bodyText = fmMatch[2];
  // Split into ## sections.
  const sections: Record<string, string> = {};
  const parts = bodyText.split(/^##\s+/m);
  let title = "";
  const h1 = bodyText.match(/^#\s+(.*)$/m);
  if (h1) title = h1[1].trim();
  for (const part of parts) {
    const nl = part.indexOf("\n");
    if (nl < 0) continue;
    const heading = part.slice(0, nl).trim().toLowerCase();
    if (!heading || heading.startsWith("#")) continue;
    sections[heading] = part.slice(nl + 1).trim();
  }
  const provenance = sections["provenance"] ?? "";
  // Normative body = every section except provenance (and the H1 title line).
  const bodyNormative = Object.entries(sections)
    .filter(([h]) => h !== "provenance")
    .map(([, v]) => v)
    .join("\n\n");
  return {
    id: frontmatter.id ?? title.split(/\s|—/)[0],
    path,
    frontmatter,
    sourceTele: frontmatter["source-tele"] ?? "",
    title,
    sections,
    bodyNormative,
    provenance,
  };
}

export interface DimResult {
  dimension: Dimension;
  pass: boolean;
  detail: string;
  missing?: string[];
}
export interface PairResult {
  axiom: string;
  tele: string;
  umbrella: boolean;
  dims: Record<Dimension, DimResult>;
  pass: boolean;
  notes: string[];
}
export interface SuiteResult {
  pass: boolean;
  pairs: PairResult[];
  cardinality: { axioms: number; activeTeles: number; pairs: number; bijection: boolean; detail: string };
  residueNotes: string[];
  missionKitSha: string;
  teleSnapshotCapturedAt: string;
}

function allPresent(haystack: string, needles: string[]): { ok: boolean; missing: string[] } {
  const hay = haystack.toLowerCase();
  const missing: string[] = [];
  for (const n of needles) {
    const re = new RegExp(n, "i");
    if (!re.test(hay)) missing.push(n);
  }
  return { ok: missing.length === 0, missing };
}

function section(ax: AxiomDoc, ...names: string[]): string {
  for (const n of names) {
    if (ax.sections[n]) return ax.sections[n];
  }
  return "";
}

export function runSuite(): SuiteResult {
  const axioms = loadAxioms();
  const teles = loadTeles();
  const axById = new Map(axioms.map((a) => [a.id, a]));
  const telById = new Map(teles.map((t) => [t.id, t]));

  // ---- D1 suite-level cardinality / bijection ----
  const mappedAxioms = new Set(PAIRS.map((p) => p.axiom));
  const mappedTeles = new Set(PAIRS.map((p) => p.tele));
  const bijection =
    PAIRS.length === 15 &&
    mappedAxioms.size === 15 &&
    mappedTeles.size === 15 &&
    axioms.length === 15 &&
    teles.length === 15 &&
    axioms.every((a) => mappedAxioms.has(a.id)) &&
    teles.every((t) => mappedTeles.has(t.id));
  const cardinality = {
    axioms: axioms.length,
    activeTeles: teles.length,
    pairs: PAIRS.length,
    bijection,
    detail: bijection
      ? "15 axioms ↔ 15 active teles, bijective over the design §4 map"
      : `NOT bijective: axioms=${axioms.length} teles=${teles.length} pairs=${PAIRS.length} mappedAx=${mappedAxioms.size} mappedTele=${mappedTeles.size}`,
  };

  const residueNotes: string[] = [];
  const pairResults: PairResult[] = [];

  for (const spec of PAIRS) {
    const ax = axById.get(spec.axiom);
    const tele = telById.get(spec.tele);
    const notes: string[] = [];
    const dims = {} as Record<Dimension, DimResult>;

    if (!ax || !tele) {
      for (const d of DIMENSIONS) dims[d] = { dimension: d, pass: false, detail: `missing ${!ax ? spec.axiom : spec.tele}` };
      pairResults.push({ axiom: spec.axiom, tele: spec.tele, umbrella: !!spec.umbrella, dims, pass: false, notes });
      continue;
    }

    // D1 per-pair: frontmatter source-tele resolves to the paired tele's lineage.
    const acceptedSources = new Set<string>([spec.tele]);
    if (tele.supersedes) acceptedSources.add(tele.supersedes);
    const d1ok = acceptedSources.has(ax.sourceTele) && bijection;
    dims["D1-cardinality"] = {
      dimension: "D1-cardinality",
      pass: d1ok,
      detail: d1ok
        ? `source-tele ${ax.sourceTele} ∈ lineage{${[...acceptedSources].join(",")}}${ax.sourceTele !== spec.tele ? " (lineage origin; live pair " + spec.tele + " supersedes it)" : ""}`
        : `source-tele ${ax.sourceTele} not in lineage{${[...acceptedSources].join(",")}} or non-bijective`,
    };

    // D2 mandate parity
    const mandate = section(ax, "mandate");
    const d2 = allPresent(mandate, spec.mandateConcepts);
    dims["D2-mandate"] = { dimension: "D2-mandate", pass: d2.ok, detail: d2.ok ? `${spec.mandateConcepts.length} mandate concepts present` : `missing mandate concepts`, missing: d2.missing };

    // D3 mechanics parity
    const mechanics = section(ax, "mechanics");
    const d3 = allPresent(mechanics, spec.mechanicsConcepts);
    dims["D3-mechanics"] = { dimension: "D3-mechanics", pass: d3.ok, detail: d3.ok ? `${spec.mechanicsConcepts.length} mechanics present` : `missing mechanics`, missing: d3.missing };

    // D4 fault-boundary scar check — every tele fault covered by an axiom fault.
    const faultsText = section(ax, "faults");
    const droppedScars: string[] = [];
    for (const tf of tele.faults) {
      const axiomFault = FAULT_RENAMES[spec.axiom]?.[tf] ?? tf;
      const re = new RegExp(axiomFault.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      if (!re.test(faultsText)) droppedScars.push(`${tf}${axiomFault !== tf ? " → " + axiomFault : ""}`);
    }
    const d4ok = droppedScars.length === 0;
    dims["D4-fault-scar"] = {
      dimension: "D4-fault-scar",
      pass: d4ok,
      detail: d4ok ? `all ${tele.faults.length} tele faults carried (no scar dropped)` : `SCAR DROPPED`,
      missing: droppedScars,
    };

    // D5 success-criteria parity
    const scText = section(ax, "success signals", "success criteria", "success signal");
    const scCount = (scText.match(/^\s*\d+\.\s+/gm) ?? []).length;
    const d5concepts = allPresent(scText, spec.scConcepts);
    const d5count = scCount >= tele.successCriteriaCount;
    const d5ok = d5concepts.ok && d5count;
    dims["D5-success-criteria"] = {
      dimension: "D5-success-criteria",
      pass: d5ok,
      detail: d5ok
        ? `${scCount} axiom criteria ≥ ${tele.successCriteriaCount} tele criteria; concepts present`
        : `count ${scCount} vs ${tele.successCriteriaCount}${d5concepts.ok ? "" : " / concepts missing"}`,
      missing: d5concepts.missing,
    };

    // D6 org-detail confinement (operational identifiers in normative body).
    const leaks: string[] = [];
    for (const re of ORG_OPERATIONAL) {
      const m = ax.bodyNormative.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"));
      if (m) leaks.push(...m);
    }
    const d6ok = leaks.length === 0;
    dims["D6-org-confinement"] = {
      dimension: "D6-org-confinement",
      pass: d6ok,
      detail: d6ok ? "no org-operational identifiers in normative body" : `operational leak: ${leaks.join(", ")}`,
      missing: leaks,
    };
    // Non-gating residue report.
    const residues = ax.bodyNormative.match(RESIDUE_TERMS) ?? [];
    const teleResidue = residues.filter((r) => /tele/i.test(r));
    if (teleResidue.length > 0) {
      const noteText = `${spec.axiom}: ${teleResidue.length}× principle-term residue in body (${[...new Set(teleResidue)].join(", ")}) — generalization nit ("inter-tele"→"inter-axiom"), not an operational leak; non-gating.`;
      notes.push(noteText);
      residueNotes.push(noteText);
    }

    // D7 provenance echo.
    const hasProv = ax.provenance.length > 0;
    const citesLineage = new RegExp(`${ax.sourceTele}|${spec.tele}`, "i").test(ax.provenance) || /source-tele/i.test(ax.provenance);
    const d7ok = hasProv && citesLineage && ax.sourceTele.length > 0;
    dims["D7-provenance"] = {
      dimension: "D7-provenance",
      pass: d7ok,
      detail: d7ok ? `Provenance section cites ${ax.sourceTele}` : `provenance missing or lineage not cited`,
    };

    const pass = DIMENSIONS.every((d) => dims[d].pass);
    pairResults.push({ axiom: spec.axiom, tele: spec.tele, umbrella: !!spec.umbrella, dims, pass, notes });
  }

  const suitePass = bijection && pairResults.every((p) => p.pass);
  const missionKitSha = readFileSync(join(AXIOM_DIR, ".mission-kit-sha"), "utf8").trim();
  const snap = JSON.parse(readFileSync(join(FIX, "teles-migration-snapshot.json"), "utf8"));

  return {
    pass: suitePass,
    pairs: pairResults,
    cardinality,
    residueNotes,
    missionKitSha,
    teleSnapshotCapturedAt: snap._meta?.capturedAt ?? "unknown",
  };
}
