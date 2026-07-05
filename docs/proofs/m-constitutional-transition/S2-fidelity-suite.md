# S2 Constitutional Fidelity Proof — mission-103 P3

**Verdict: PASS — all 15 pairs clean across all 7 dimensions**

- mission-kit axioms frozen at: `a93e71114b7e21e6bf6bac25b227537ca78817b9`
- live tele snapshot captured: `2026-07-05T22:40:00Z` (active set tele-1..tele-15; tele-0 superseded/historical)
- reproduce: `cd hub && npx vitest run src/policy/__tests__/constitution-fidelity.test.ts` (asserts) · `npx tsx scripts/emit-fidelity-proof.ts` (this matrix)

Cardinality: 15 axioms ↔ 15 active teles, bijective over the design §4 map

## Dimensions
D1 cardinality/isomorphism · D2 mandate parity · D3 mechanics parity · D4 fault-boundary (scar) · D5 success-criteria parity · D6 org-detail confinement · D7 provenance echo

## Pass matrix (pair × dimension)

| Pair | Source tele | D1 | D2 | D3 | D4 | D5 | D6 | D7 | Pair |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **A0** (umbrella) | tele-14 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **A1** | tele-1 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **A2** | tele-2 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **A3** | tele-3 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **A4** | tele-4 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **A5** | tele-5 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **A6** | tele-6 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **A7** | tele-7 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **A8** | tele-8 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **A9** | tele-9 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **A10** | tele-10 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **A11** | tele-11 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **A12** | tele-12 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **A13** | tele-13 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **A14** | tele-15 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## Per-pair detail

### A0 ← tele-14 (umbrella) — ✅
- ✅ `D1-cardinality` — source-tele tele-0 ∈ lineage{tele-14,tele-0} (lineage origin; live pair tele-14 supersedes it)
- ✅ `D2-mandate` — 6 mandate concepts present
- ✅ `D3-mechanics` — 5 mechanics present
- ✅ `D4-fault-scar` — all 3 tele faults carried (no scar dropped)
- ✅ `D5-success-criteria` — 3 axiom criteria ≥ 3 tele criteria; concepts present
- ✅ `D6-org-confinement` — no org-operational identifiers in normative body
- ✅ `D7-provenance` — Provenance section cites tele-0

### A1 ← tele-1 — ✅
- ✅ `D1-cardinality` — source-tele tele-1 ∈ lineage{tele-1}
- ✅ `D2-mandate` — 5 mandate concepts present
- ✅ `D3-mechanics` — 5 mechanics present
- ✅ `D4-fault-scar` — all 4 tele faults carried (no scar dropped)
- ✅ `D5-success-criteria` — 3 axiom criteria ≥ 3 tele criteria; concepts present
- ✅ `D6-org-confinement` — no org-operational identifiers in normative body
- ✅ `D7-provenance` — Provenance section cites tele-1

### A2 ← tele-2 — ✅
- ✅ `D1-cardinality` — source-tele tele-2 ∈ lineage{tele-2}
- ✅ `D2-mandate` — 4 mandate concepts present
- ✅ `D3-mechanics` — 4 mechanics present
- ✅ `D4-fault-scar` — all 4 tele faults carried (no scar dropped)
- ✅ `D5-success-criteria` — 4 axiom criteria ≥ 4 tele criteria; concepts present
- ✅ `D6-org-confinement` — no org-operational identifiers in normative body
- ✅ `D7-provenance` — Provenance section cites tele-2

### A3 ← tele-3 — ✅
- ✅ `D1-cardinality` — source-tele tele-3 ∈ lineage{tele-3}
- ✅ `D2-mandate` — 4 mandate concepts present
- ✅ `D3-mechanics` — 6 mechanics present
- ✅ `D4-fault-scar` — all 5 tele faults carried (no scar dropped)
- ✅ `D5-success-criteria` — 6 axiom criteria ≥ 5 tele criteria; concepts present
- ✅ `D6-org-confinement` — no org-operational identifiers in normative body
- ✅ `D7-provenance` — Provenance section cites tele-3

### A4 ← tele-4 — ✅
- ✅ `D1-cardinality` — source-tele tele-4 ∈ lineage{tele-4}
- ✅ `D2-mandate` — 4 mandate concepts present
- ✅ `D3-mechanics` — 4 mechanics present
- ✅ `D4-fault-scar` — all 4 tele faults carried (no scar dropped)
- ✅ `D5-success-criteria` — 4 axiom criteria ≥ 4 tele criteria; concepts present
- ✅ `D6-org-confinement` — no org-operational identifiers in normative body
- ✅ `D7-provenance` — Provenance section cites tele-4

### A5 ← tele-5 — ✅
- ✅ `D1-cardinality` — source-tele tele-5 ∈ lineage{tele-5}
- ✅ `D2-mandate` — 3 mandate concepts present
- ✅ `D3-mechanics` — 4 mechanics present
- ✅ `D4-fault-scar` — all 4 tele faults carried (no scar dropped)
- ✅ `D5-success-criteria` — 4 axiom criteria ≥ 4 tele criteria; concepts present
- ✅ `D6-org-confinement` — no org-operational identifiers in normative body
- ✅ `D7-provenance` — Provenance section cites tele-5

### A6 ← tele-6 — ✅
- ✅ `D1-cardinality` — source-tele tele-6 ∈ lineage{tele-6}
- ✅ `D2-mandate` — 4 mandate concepts present
- ✅ `D3-mechanics` — 4 mechanics present
- ✅ `D4-fault-scar` — all 4 tele faults carried (no scar dropped)
- ✅ `D5-success-criteria` — 4 axiom criteria ≥ 4 tele criteria; concepts present
- ✅ `D6-org-confinement` — no org-operational identifiers in normative body
- ✅ `D7-provenance` — Provenance section cites tele-6

### A7 ← tele-7 — ✅
- ✅ `D1-cardinality` — source-tele tele-7 ∈ lineage{tele-7}
- ✅ `D2-mandate` — 4 mandate concepts present
- ✅ `D3-mechanics` — 5 mechanics present
- ✅ `D4-fault-scar` — all 4 tele faults carried (no scar dropped)
- ✅ `D5-success-criteria` — 4 axiom criteria ≥ 4 tele criteria; concepts present
- ✅ `D6-org-confinement` — no org-operational identifiers in normative body
- ✅ `D7-provenance` — Provenance section cites tele-7

### A8 ← tele-8 — ✅
- ✅ `D1-cardinality` — source-tele tele-8 ∈ lineage{tele-8}
- ✅ `D2-mandate` — 5 mandate concepts present
- ✅ `D3-mechanics` — 4 mechanics present
- ✅ `D4-fault-scar` — all 4 tele faults carried (no scar dropped)
- ✅ `D5-success-criteria` — 4 axiom criteria ≥ 4 tele criteria; concepts present
- ✅ `D6-org-confinement` — no org-operational identifiers in normative body
- ✅ `D7-provenance` — Provenance section cites tele-8

### A9 ← tele-9 — ✅
- ✅ `D1-cardinality` — source-tele tele-9 ∈ lineage{tele-9}
- ✅ `D2-mandate` — 5 mandate concepts present
- ✅ `D3-mechanics` — 5 mechanics present
- ✅ `D4-fault-scar` — all 4 tele faults carried (no scar dropped)
- ✅ `D5-success-criteria` — 5 axiom criteria ≥ 4 tele criteria; concepts present
- ✅ `D6-org-confinement` — no org-operational identifiers in normative body
- ✅ `D7-provenance` — Provenance section cites tele-9

### A10 ← tele-10 — ✅
- ✅ `D1-cardinality` — source-tele tele-10 ∈ lineage{tele-10}
- ✅ `D2-mandate` — 3 mandate concepts present
- ✅ `D3-mechanics` — 4 mechanics present
- ✅ `D4-fault-scar` — all 4 tele faults carried (no scar dropped)
- ✅ `D5-success-criteria` — 4 axiom criteria ≥ 4 tele criteria; concepts present
- ✅ `D6-org-confinement` — no org-operational identifiers in normative body
- ✅ `D7-provenance` — Provenance section cites tele-10

### A11 ← tele-11 — ✅
- ✅ `D1-cardinality` — source-tele tele-11 ∈ lineage{tele-11}
- ✅ `D2-mandate` — 4 mandate concepts present
- ✅ `D3-mechanics` — 6 mechanics present
- ✅ `D4-fault-scar` — all 6 tele faults carried (no scar dropped)
- ✅ `D5-success-criteria` — 7 axiom criteria ≥ 7 tele criteria; concepts present
- ✅ `D6-org-confinement` — no org-operational identifiers in normative body
- ✅ `D7-provenance` — Provenance section cites tele-11

### A12 ← tele-12 — ✅
- ✅ `D1-cardinality` — source-tele tele-12 ∈ lineage{tele-12}
- ✅ `D2-mandate` — 4 mandate concepts present
- ✅ `D3-mechanics` — 6 mechanics present
- ✅ `D4-fault-scar` — all 7 tele faults carried (no scar dropped)
- ✅ `D5-success-criteria` — 8 axiom criteria ≥ 8 tele criteria; concepts present
- ✅ `D6-org-confinement` — no org-operational identifiers in normative body
- ✅ `D7-provenance` — Provenance section cites tele-12

### A13 ← tele-13 — ✅
- ✅ `D1-cardinality` — source-tele tele-13 ∈ lineage{tele-13}
- ✅ `D2-mandate` — 4 mandate concepts present
- ✅ `D3-mechanics` — 5 mechanics present
- ✅ `D4-fault-scar` — all 5 tele faults carried (no scar dropped)
- ✅ `D5-success-criteria` — 7 axiom criteria ≥ 5 tele criteria; concepts present
- ✅ `D6-org-confinement` — no org-operational identifiers in normative body
- ✅ `D7-provenance` — Provenance section cites tele-13

### A14 ← tele-15 — ✅
- ✅ `D1-cardinality` — source-tele tele-15 ∈ lineage{tele-15}
- ✅ `D2-mandate` — 4 mandate concepts present
- ✅ `D3-mechanics` — 5 mechanics present
- ✅ `D4-fault-scar` — all 5 tele faults carried (no scar dropped)
- ✅ `D5-success-criteria` — 6 axiom criteria ≥ 6 tele criteria; concepts present
- ✅ `D6-org-confinement` — no org-operational identifiers in normative body
- ✅ `D7-provenance` — Provenance section cites tele-15

## Non-gating informational findings

These are NOT fidelity failures — no mandate weakened, no mechanic or fault dropped. They are org-hygiene residues surfaced for transparency; each is a mission-kit copy-edit candidate, not a batch blocker.

- A13: 3× principle-term residue in body (inter-tele, teles) — generalization nit ("inter-tele"→"inter-axiom"), not an operational leak; non-gating.

## What each dimension mechanically checks

- **D1** — the tele→axiom map is a bijection over 15 axioms and 15 active teles; each axiom's `source-tele` frontmatter resolves into its paired tele's lineage (A0's origin tele-0 is superseded by the live pair tele-14).
- **D2/D3/D5** — every load-bearing mandate concept, named mechanic, and success concept from the tele is present in the axiom's corresponding section; axiom success-criteria count ≥ tele count (no criterion dropped).
- **D4 (the scar check)** — every named fault in the tele has a covering fault in the axiom (rename-aware: "Director Fatigue"→"Principal Fatigue" in A0, "DAG Manual Stitching"→"Dependency Manual Stitching" in A6). A dropped fault is the anti-laundering failure this dimension exists to catch.
- **D6** — the axiom's normative body carries zero org-operational identifiers (numbered entity ids, tool names, internal proper nouns like Hub/OIS/PolicyRouter); org lineage is confined to frontmatter + Provenance.
- **D7** — a Provenance section exists and cites the source-tele lineage.
