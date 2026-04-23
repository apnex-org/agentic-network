# Phase 3 Concept + Defect Candidates — Engineer Harvest

**Status:** ENGINEER HARVEST COMPLETE — Pass A (Tele faults) + Pass B (bug classes) + Pass C (idea concepts) + Pass D (cartography concepts). Input artifact for architect's naming + shape-authoring pass per plan §Phase 3.
**Author:** greg (engineer, eng-0d2c690e7dd5), 2026-04-22 AEST.
**Source:** thread-253 (Phase 3 backchannel).
**Cadence position:** Engineer parallel work alongside lily's drafting. Lily authors final concept + defect Document-form artifacts (`documents/concepts/*.md` + `documents/defects/*.md`) + cross-reference matrix. My harvest is INPUT, not the register.

**Companion data:**
- `docs/reviews/2026-04-phase-3-data/tele-faults.tsv` — 58 named defect classes from 13 teles (Pass A)
- `docs/reviews/2026-04-phase-3-data/idea-concepts.tsv` — 74 concept-name candidates from strategic ideas (Pass C)

---

## Pass A — Tele Faults (58 candidate defect classes from 13 teles)

Every tele's spec includes a `**Faults.**` section per Tele #4 Zero-Loss Knowledge's mechanics-rationale-consequence pattern. These are **already-named** defect classes per the constitutional layer; lily's authoring step formalizes them into `documents/defects/*.md`.

**Top defect classes by cross-tele resonance** (inferred from naming overlap + bug-walk evidence):

| Defect class | Source tele(s) | Bug evidence | Notes |
|---|---|---|---|
| Silent Drift | tele-1 | bug-1, bug-7, bug-8, bug-9, bug-27 (5 drift-class bugs) | Most-cited; appears in Phase 2 cluster as cascade-execution/tool-surface |
| Hidden State Problem | tele-1 | bug-3 (Architect Amnesia), bug-15 (instrumentation gap) | Identity + observability cross-cutting |
| Cascade Bomb | tele-7 | bug-7, bug-26 (probe-induced displacement) | One failure crashes orchestrator; partial fix via mission-29 |
| Phantom State | tele-2 | bug-2 (DAG retroactive), bug-28 (DAG dep-eval) | Spec doesn't know about transition |
| Doc-Code Drift | tele-2 | bug-21 (chunk UTF-16 drift), bug-27 (cascade payload drop) | Documentation older than reality |
| Cognitive Friction | tele-5 | bug-3 (Director-as-eyes), thread-251 nudge cycle | Director forced to compensate |
| Cascade Amnesia | tele-6 | bug-20 (workflow advancement), sym-C-001 (nudge cycle) | Approval doesn't propagate |
| Silent Collapse | tele-7 | bug-22 (continuation sweep retry) | Error isolated; system continues broken |
| Architect Amnesia | tele-5 | bug-3 + sym-B-008 task duplication crisis | Hallucinate state instead of perceive |
| Foundation-of-Sand | tele-8 | (no direct bug evidence — tele-8 reverse-gap pre-Pass-1.1) | High abstractions on unverified substrate |
| Filing-Point ≠ Fault-Domain | (Phase 2 §5; not yet a tele fault) | sym-A-015 (cognitive-layer-filed observability), sym-B-004 (debugging-loop-filed observability) | **NEW emergent class — Phase 2 ratified** |

**Cross-tele resonance observations:**
- **Silent ___ family** (Silent Drift / Silent Collapse / Silent Failure / Silent Merging) appears 4× across teles. Suggests a **meta-defect cluster: "Silent Failure"** that Concepts like "Loud Rejection" + "Audit-First Operations" resolve.
- **Amnesia family** (Hidden State, Cascade, Architect, Corporate, Umbrella, Onboarding Decay) appears 6× across teles. Suggests a meta-defect: **"Memory Loss" cluster.**
- **Drift family** (Silent Drift, Doc-Code Drift, Snowflake Entropy, Phantom State, schema-drift) appears 5×. Meta-defect: **"State Divergence" cluster.**

---

## Pass B — Bug-class additions (defect-name candidates not in Tele faults)

Most bug `class` fields map to Tele faults (above). Distinct classes not directly named in Tele faults:

| Bug class (engineer-extracted) | Source bugs | Suggested defect-name | Notes |
|---|---|---|---|
| race | bug-2, bug-23 | "Race Condition" / "Convergence Race" | Specific to bilateral-seal + DAG cascade. Architect call: distinct from Cascade Bomb? |
| delivery-truncation | bug-25 | "Truncation" / "Payload Capacity Leak" | Plan §Phase 3 lists "Truncation" as defect seed. Confirmed in our backlog. |
| api-ergonomics | bug-19 | "Boilerplate Burden" / "Manual Plumbing" | Engineer-side; relates to tele-6 Transcription Toil |
| dag-scheduling | bug-28 | "Schedule Drift" / "Dep-Eval Lag" | Specific to DAG dep-resolution timing |
| dedup | bug-7 | "Duplication Drift" | Two paths emit same outcome; resolved via cascade-perfection |
| schema-validation-gap | bug-21 | "Validation-Gap" | Engineer-shipped without schema-completeness check |

**Architect call for these:** decide whether each is a distinct defect or a sub-class of an existing Tele fault.

---

## Pass C — Architectural-idea concept candidates (74 strategic ideas)

Plan §Phase 3 names seed concepts; my independent harvest covers all of them + finds additional candidates. **Independent convergence on plan seeds:**

| Plan seed | Engineer-found in idea | Status |
|---|---|---|
| **Smart NIC** | idea-152 (open) | ✓ Exact match |
| **vocabulary chain** | ideas 129/130/131/133/134/139/140-143 (cluster) | ✓ Exact match (named cluster) |
| **Universal Port** | idea-102 (open) | ✓ Exact match (deprecates idea-17) |
| **role purity** | implicit in tele-6 mandate + sym-C-006/C-009/C-010 friction; no single idea names it | ⚠ Concept-level, not idea-level |
| **Cognitive Implant Layer** | idea-152 body (sub-component of Smart NIC architecture) | ✓ Embedded in idea-152 |
| **resource-addressing** | idea-152 body ("MCP as Last-Mile Presentation; resource-addressing") | ✓ Embedded in idea-152 |
| **direct-write backstop** | (no direct match in current ideas) | ⚠ Plan-named but no current idea evidence — may be retrospective concept from prior session |

**Newly-emergent concept candidates not in plan §Phase 3 seed list:**

| Candidate concept | Source ideas / Phase | Evidence |
|---|---|---|
| **Sovereign State Backplane** | idea-39 (Read-After-Write), tele-1 mandate | Aligns with tele-1 success criteria |
| **Hub-as-Conductor** | idea-108 (Hub-driven mission-work dispatching) | Tele-6 frictionless |
| **Cognitive Hypervisor** | idea-107 (umbrella mission), shipped via mission-31-34/38 | Already partially built; ratified concept |
| **Precision Context Engineering** | idea-119, idea-116, **tele-12 itself** | Now a Tele as well as concept (ratified Phase 1) |
| **Cognitive Minimalism** | tele-11 itself + idea-138 cost-aware tier | Now a Tele (ratified Phase 1) |
| **Filing-Point ≠ Fault-Domain** | Phase 2 §5 ratified | **Already Director-ratified meta-pattern** |
| **Manifest as Master** | idea-130 + tele-2 success criteria | Spec-as-runtime |
| **Concept→Idea→Design→Manifest→Mission vocabulary chain** | ideas 129–143 cluster, ratified 2026-04-21 | Multi-idea cluster as one named concept |
| **Goal-as-Bridge (Tele↔Mission)** | idea-139 bi-triangle framing | Project-level outcome |
| **Layer-Certification Registry** | idea-156 (filed Pass 1.1 for tele-8 reverse-gap) | New concept, no prior register |
| **Director-Exception Protocol** | Phase 1 §A3 (tele-11 + tele-12 same-day filings) | Methodology-retrospective |
| **Bidirectional Domain Analysis** | Phase 2 §5 (engineer's filing-point + architect's fault-domain) | Methodology-retrospective |
| **Independent Convergence as Calibration** | Phase 1 emergent-domain (cognitive/identity/cascade) + Phase 2 11-domain set both surfaced via independent prep paths | Methodology-retrospective |
| **Pass-Numbering Convention** | Pass 1.1, 1.2, 1.3, 1.3.1 across review | Process pattern; less concept-worthy IMO |
| **Operational-Friction Filing Class** | Phase 2 §11 #3 (architect retrospective) | Bug-filing discipline drives domain visibility |
| **Cross-Source Distribution as Acceptance Test** | Phase 2 §4 finding | Methodology-retrospective |
| **Universal Adapter / Universal Port** | idea-102 + idea-152 + idea-153 (adapter-core) cluster | Already ratified direction |
| **Smart NIC + Cognitive Implant Layer** | idea-152 explicit naming | Target-state architecture |
| **Rule Entity** | idea-147 | Project policy/convention layer |
| **Registry Entity** | idea-131 | First-class catalog primitive |

**Total candidate concepts:** ~20 emergent + 7 plan seeds = **~27 distinct concept candidates** (some overlap; lily consolidates).

**Scope-reservation observations:**
- **idea-152 Smart NIC** carries 3 sub-concepts (Cognitive Implant Layer, MCP-as-Last-Mile-Presentation, Resource-Addressing). Lily's call: 1 concept document with sub-sections OR 3 separate concept docs?
- **Vocabulary chain (ideas 129-143)** is a *cluster of ratified ideas* but not yet a single named concept in any Hub entity. Lily's call: name as one concept ("Vocabulary Chain") or 11 individual concepts (Concept, Idea, Design, Manifest, Mission, Trace, Report, Survey, Routine, Goal, Evaluation)?

---

## Pass D — Phase 1+2 cartography-surfaced concepts (5 named patterns)

Beyond Tele faults + bug classes + architectural ideas, the cartography work itself surfaced 5 named patterns worth concept-level treatment:

1. **Filing-Point ≠ Fault-Domain** — already ratified (Phase 2 §5). Operators file at point-of-observation, not domain-of-defect. Resolved by *Bidirectional Domain Analysis* (Pass C above).
2. **Cross-Source Distribution as Acceptance Test** — Phase 2 §4. A domain appearing in only one evidence source is suspect; ≥2 sources, structural. Phase 3 candidate per architect §11.
3. **Director-Exception Protocol for Tele-Set Modification** — Phase 1 §A3 (tele-11 + tele-12 same-day filings). Methodology-retrospective; question is whether to formalize the protocol or keep ad-hoc.
4. **Independent Convergence as Calibration Signal** — observed twice in this review (Phase 1 emergent-domain agreement; Phase 2 11-domain set). Methodology principle: when two independent passes converge, that's strong calibration; when they diverge, the divergence is the signal.
5. **Pass-Numbering Convention** — process pattern (Pass 1.1, 1.2, 1.3, 1.3.1, 2.A, 2.B, 2.C, 2.α, 2.β). Useful operationally but probably below the bar for first-class concept.

---

## Initial cross-reference suggestions (input to lily's matrix)

Suggested concept↔defect resolutions (you author the canonical matrix):

| Defect (from Pass A/B) | Resolved-by Concept (from Pass C/D) |
|---|---|
| Silent Drift, Silent Collapse, Silent Failure | **Loud Rejection** (engineer-named candidate) + **Audit-First Operations** (implicit in mission-40 deprecation runway) |
| Hidden State Problem, Architect Amnesia | **Sovereign State Backplane** (tele-1 success criteria); **Pre-Hydration** (idea-114 candidate) |
| Cascade Bomb, Cascade Amnesia | **Hub-as-Conductor** (idea-108); **Cascade-Action ActionSpec Registry** (mission-29 already shipped) |
| Phantom State, Doc-Code Drift, Snowflake Entropy | **Manifest as Master** (idea-130); **Isomorphic Specification** (tele-2 itself) |
| Cognitive Friction, Architect Amnesia | **Cognitive Hypervisor** (idea-107); **Precision Context Engineering** (tele-12); **Cognitive Minimalism** (tele-11) |
| Truncation, Payload Capacity Leak | **Smart NIC + Cognitive Implant Layer** (idea-152); short-term: **Adapter Size-Guard** (mitigation pending) |
| Foundation-of-Sand, Surface Patching | **Layer-Certification Registry** (idea-156); **Merge-Gate Automation** (idea-158) |
| Friction Fossilization, Lesson Loss | **Trace + Report** (ideas 134, partial); **Autopoietic Evolution** (tele-10 itself) |
| Fragmented Asymptote, Umbrella Amnesia | **Sovereign Intelligence Engine** (tele-0 umbrella); **Goal-as-Bridge** (idea-139) |
| LLM as Calculator, Substrate Leakage, Token Fragility | **Cognitive Minimalism** (tele-11); **Cognitive Hypervisor** (idea-107); **Hub-as-Conductor** |
| Filing-Point ≠ Fault-Domain | **Bidirectional Domain Analysis** (Phase 2 §5 method) |
| Mission Duplication Drift (sym-C-002) | **Cascade-Action ActionSpec Registry** + **Mission-Cascade Drift Audit** (Phase 4 candidate) |
| Operational-Friction Invisibility (sym-C-009 architect-triage SLA absence, etc.) | **Operational-Friction Entity Class** (Phase 2 §11 #3) — needs creation as Hub primitive |

This is a starting set of ~13 concept↔defect pairs covering the major friction classes. Many concepts resolve multiple defects; many defects can be resolved by multiple concepts. Lily's matrix is the canonical authoring step.

---

## Engineer-flagged judgment calls for lily

1. **Concept-vs-Defect ambiguity straddles** — flagged 3 cases where the source language is ambiguous:
   - "Hidden State" is a defect (tele-1 fault) AND "Sovereign State Backplane" is the concept; both terms appear in tele-1 spec. Likely needs both register entries.
   - "Cascade Bomb" is a defect AND "Cascade-Action ActionSpec Registry" is the concept; pair-explicit needed.
   - "Cognitive Friction" is a defect AND "Cognitive Hypervisor" is the concept; pair-explicit.
   - For these, concept docs can name the defect they resolve in the `Resolves-Defects` field (per plan's concept shape), and defect docs name the concept in `Resolved-by-Concepts`.
2. **Sub-concept granularity** — Smart NIC has 3 sub-concepts; Vocabulary Chain has ~11 entity-types. Single concept docs OR per-sub doc?
3. **Tele = Concept overlap** — tele-11 Cognitive Minimalism IS a concept that resolves defects (LLM as Calculator, Substrate Leakage). Same for tele-12 Precision Context Engineering. Should Tele entries be referenced from Concept docs (recommend yes) or duplicated (no)?
4. **Pass-Numbering Convention** — IMO too process-y to be a first-class concept; defer to retrospective. Your call.
5. **Plan's "direct-write backstop" seed** — no current idea names this. Either retrospective from prior session OR Plan-author candidate-naming that didn't materialize. Skipped from my harvest.

---

## Coverage check

- ✓ All 13 teles' Fault sections harvested (Pass A; 58 defect classes total in TSV)
- ✓ All 28 bugs scanned for class overrides not in Tele faults (Pass B; 6 distinct additions identified)
- ✓ Strategic-tagged ideas filtered + concept candidates extracted (Pass C; 74 candidates in TSV; ~27 distinct after consolidation)
- ✓ Phase 1 + 2 cartography artifacts scanned for emergent concepts (Pass D; 5 named patterns)
- ✓ Plan §Phase 3 seed list cross-checked against engineer-found candidates (independent convergence on 6/7 seeds)

---

## Companion data location

- `docs/reviews/2026-04-phase-3-data/tele-faults.tsv` (59 rows = header + 58)
- `docs/reviews/2026-04-phase-3-data/idea-concepts.tsv` (75 rows = header + 74)

---

*End of engineer Phase 3 candidate harvest. Awaits architect naming + shape-authoring pass per plan §Phase 3 cadence. Architect drafts → Director reviews → architect revises → engineer critiques naming + cross-references → Director ratifies.*
