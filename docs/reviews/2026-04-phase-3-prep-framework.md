# Phase 3 Prep Framework — Concept + Defect Register Skeleton

**Status:** PREP SCRATCH — Director-approved prep ahead of Phase 3 formal opening (gated on Director Phase 2 ratification). This doc is NOT the Phase 3 deliverable; it is architect-side pre-structure that will be promoted/folded into `docs/reviews/2026-04-phase-3-concepts-and-defects.md` when Phase 3 opens.
**Author:** lily (architect, eng-40903c59d19f), 2026-04-22 AEST
**Plan reference:** `docs/reviews/2026-04-architectural-review.md` §Phase 3
**Gates:** awaits (a) Director ratification of Phase 2, (b) engineer candidate harvest per plan §Phase 3 Work

---

## 0. Phase 3 scope + cadence (plan reference)

**Goal (plan §Phase 3):** Extract named Concepts + named Defect classes from Phases 1+2. Cross-reference which concepts resolve which defects.

**Work split (plan §Phase 3 Work):**
- **greg:** candidate harvest — scan ratified architectural ideas for concept names; scan Tele faults + bug descriptions for defect class candidates
- **lily (me):** naming + shape authoring — write each concept + defect as Document-form artifact; build cross-reference matrix

**Critique cadence (plan §Phase 3):** lily drafts registers → director reviews → lily revises → greg critiques naming + cross-references → director ratifies.

**Output artifact (plan §Phase 3):** `documents/reviews/2026-04-phase-3-concepts-and-defects.md` (index) + *(optionally)* individual files under `documents/concepts/` + `documents/defects/`.

**Convergence criterion (plan §Phase 3):** every Tele fault maps to at least one defect class; every velocity-multiplier idea maps to at least one concept; orphans are either named as new concepts/defects or explicitly deferred.

**Anti-pattern guard (plan §anti-patterns):** "Concept proliferation — naming every bug cluster as a 'concept' dilutes the vocabulary; Concepts are structural, not symptomatic (symptoms are Defects)." Target ~10 concepts (structural patterns spanning multiple ideas/missions), not 50 (idea-per-concept).

---

## 1. Shape templates

### 1.1 Concept shape (per plan §Phase 3)

```markdown
# Concept: <Name>

**Mandate.** One-line imperative — what the concept declares.
**Mechanics.** How the concept realizes in the system.
**Rationale.** Why it matters.
**Resolves-Defects.** List of Defect class names this concept resolves.
**Instances-in-backlog.** Idea/Bug/Mission IDs where this concept appears.
**Tele alignment.** Which Teles this concept advances.
```

### 1.2 Defect shape (per plan §Phase 3)

```markdown
# Defect: <Name>

**Symptom.** Observable failure.
**Mechanics.** How it arises.
**Example-instances.** Bug/thread/symptom IDs where observed.
**Resolved-by-Concepts.** List of Concept names.
**Tele violation.** Which Teles this defect violates.
```

### 1.3 Naming discipline

- **Concept names** are structural + noun-phrase (e.g., "Uniform Adapter Contract", "Substrate-First Logic")
- **Defect names** are observable + noun-phrase (e.g., "Logic Leakage", "Context Bloat")
- **Avoid verbs** in names (prefer "Silent Drift" over "State Drifts Silently")
- **Consolidation rule**: if two Tele Faults describe the same mechanism with different wording, use one Defect name + cross-reference multiple Teles

---

## 2. Pre-harvested Concept candidates (architect-side)

*Prep candidates I can author without waiting for greg's harvest. Greg's harvest may add, refine, or rename.*

### 2.1 Core concepts (10)

| # | Concept name | Aggregates (ideas/missions) | Tele alignment | Notes |
|---|---|---|---|---|
| 1 | **Uniform Adapter Contract** | idea-102 Universal Port, idea-104 Mock Harness, idea-152 Smart NIC, idea-153 adapter-core | tele-2, tele-3, tele-5 | Every node attaches via single declared port contract; bit-perfect boundaries |
| 2 | **Substrate-First Logic** | tele-11 (Cognitive Minimalism is the formal expression); idea-107 Cognitive Hypervisor, idea-115 dynamic-tool-scope, idea-110 invariant-enforcement, idea-108 Hub-as-Conductor, idea-138 cost-aware tier routing | tele-11, tele-6, tele-3 | Deterministic work → substrate; LLM only for cognition |
| 3 | **Manifest-is-Master** | tele-2 (Isomorphic Specification is the asymptote); idea-130 Manifest, idea-139 Goal, ideas 129-143 vocabulary-chain family | tele-2, tele-4, tele-6 | Specification IS the system; declared intent auto-reconciles |
| 4 | **Precision Context Engineering** | tele-12 (the formal expression); idea-116 (ancestor), idea-119 query-shape, idea-72 on-demand-retrieval, idea-145 chunked-reply, idea-146 continuation | tele-12 | Every LLM invocation's context precision-engineered per token |
| 5 | **Vocabulary Chain** | ideas 129-143, 154-155 (the concept-chain ratified 2026-04-21); idea-133 Concept, idea-134 Trace+Report, idea-136 Routine, idea-139 Goal | tele-2, tele-4, tele-10 | Concept → Idea → Design → Manifest → Mission → Trace → Report |
| 6 | **Hub-as-Conductor** | idea-108; extends tele-6 mandate into mission-level dispatch | tele-6, tele-2 | Hub actively drives mission work; no idle gaps between convergence and next directive |
| 7 | **Direct-Write Backstop** | scripts/reset-teles.ts pattern; applied when ratified primitives lack implementation | tele-7, tele-1 | Operational fallback when tool-surface blocks ratified direction; audit-trail preserves provenance |
| 8 | **Role Purity** | architect-engineer-collaboration.md §2 (Architect governs, Engineer executes); applied across role-scoping symptoms | tele-6, tele-3 | Each role has sovereign scope; neither blocks on the other's administrative limitations |
| 9 | **Shipped-but-Leaks** *(with sub-types Scope-Conflation, Back-Compat Runway)* | Phase 2 finding; bug-10 → bug-11 canonical scope-conflation; mission-40 auto-claim hooks canonical back-compat runway | tele-7, tele-1 | Declared-resolved problems re-surface via untracked aspects; sub-types distinguish unplanned vs planned leak |
| 10 | **Filing-Point ≠ Fault-Domain** | Phase 2 finding (§5 of classification); observability-absorbed pattern | tele-1, tele-4 | Classification requires bidirectional analysis: point-of-observation AND domain-of-defect |

### 2.2 Sub-concepts / mechanisms (possible standalone or absorbed into parent concepts)

| # | Sub-concept | Parent | Defers-to-Phase-3-decision |
|---|---|---|---|
| 11 | Cognitive-Boundary Discipline | Substrate-First Logic | Phase 3 may fold into #2 |
| 12 | Hydration-as-Offload | Precision Context Engineering | Phase 3 may fold into #4 |
| 13 | Bounded Accumulation | Precision Context Engineering | Phase 3 may fold into #4 |
| 14 | Cross-Source Acceptance Test | Filing-Point ≠ Fault-Domain | Phase 3 may fold into #10 |
| 15 | Layered Certification | (tele-8 direct) | Phase 3 may keep as tele-8 mechanism, not separate concept |
| 16 | Cognitive Implant Layer | Uniform Adapter Contract (idea-152 subscope) | Phase 3 may fold into #1 |

**Target post-greg-harvest:** 8-12 final concepts. Fold sub-concepts into parents where the parent concept's Mechanics already covers them.

---

## 3. Pre-harvested Defect candidates (from Tele Faults sections)

*All Faults enumerated verbatim from `docs/specs/teles.md`. Consolidation pass flags which ones should merge into a single Defect class in the Phase 3 register.*

### 3.1 tele-0 Sovereign Intelligence Engine (umbrella)

| Fault | Defect class (pre-harvest) | Consolidation note |
|---|---|---|
| Fragmented Asymptote | **Fragmented Asymptote** | Keep as meta-defect (applies to vision-coherence) |
| Umbrella Amnesia | **Umbrella Amnesia** | Keep |
| Director Fatigue | **Director Fatigue** | Keep |

### 3.2 tele-1 Sovereign State Transparency

| Fault | Defect class (pre-harvest) | Consolidation note |
|---|---|---|
| Hidden State Problem | **Hidden State** | Keep; cross-references tele-5 Architect Amnesia (distinct mechanism: LLM-side hallucination) |
| Silent Drift | **Silent Drift** | Keep |
| Ephemeral Truth Loss | **Ephemeral Truth Loss** | Keep |
| Logic Poisoning | **Logic Poisoning** | Keep |

### 3.3 tele-2 Isomorphic Specification

| Fault | Defect class (pre-harvest) | Consolidation note |
|---|---|---|
| Doc-Code Drift | **Doc-Code Drift** | Keep |
| Snowflake Entropy | **Snowflake Entropy** | Keep |
| Instructional Bloat | **Instructional Bloat** | Keep |
| Phantom State | **Phantom State** | Keep; distinct from tele-1 Ephemeral Truth Loss (phantom = spec-side; ephemeral = runtime-side) |

### 3.4 tele-3 Sovereign Composition

| Fault | Defect class (pre-harvest) | Consolidation note |
|---|---|---|
| Logic Leakage | **Logic Leakage** | Keep |
| Architectural Paralysis | **Architectural Paralysis** | Keep |
| God-Object Accretion | **God-Object Accretion** | Keep |
| Ceremony Bloat | **Ceremony Bloat** | Keep |
| Veto Paralysis | **Veto Paralysis** | Keep |

### 3.5 tele-4 Zero-Loss Knowledge

| Fault | Defect class (pre-harvest) | Consolidation note |
|---|---|---|
| Corporate Amnesia | **Corporate Amnesia** | Keep |
| Narrative Debt | **Narrative Debt** | Keep |
| Onboarding Decay | **Onboarding Decay** | Keep |
| Hallucinated Fill-In | **Hallucinated Fill-In** | Keep; distinct from tele-5 Architect Amnesia (hallucination-at-fill vs hallucination-at-perception) |

### 3.6 tele-5 Perceptual Parity

| Fault | Defect class (pre-harvest) | Consolidation note |
|---|---|---|
| Cognitive Friction | **Cognitive Friction** | Keep |
| Black-Box Failure | **Black-Box Failure** | Keep |
| Architect Amnesia | **Architect Amnesia** | Keep; distinct from tele-1 Hidden State (agent-side hallucination vs system-side hiding) |
| Operational Lag | **Operational Lag** | Keep |

### 3.7 tele-6 Frictionless Agentic Collaboration

| Fault | Defect class (pre-harvest) | Consolidation note |
|---|---|---|
| Transcription Toil | **Transcription Toil** | Keep |
| Boundary Blocking | **Boundary Blocking** | Keep |
| DAG Manual Stitching | **DAG Manual Stitching** | Keep |
| Cascade Amnesia | **Cascade Amnesia** | Keep |

### 3.8 tele-7 Resilient Agentic Operations

| Fault | Defect class (pre-harvest) | Consolidation note |
|---|---|---|
| Silent Collapse | **Silent Collapse** | Keep |
| Cascade Bomb | **Cascade Bomb** | Keep |
| Blocked Actor | **Blocked Actor** | Keep |
| Non-Actionable Failure | **Non-Actionable Failure** | Keep |

### 3.9 tele-8 Gated Recursive Integrity

| Fault | Defect class (pre-harvest) | Consolidation note |
|---|---|---|
| Debugging Quicksand | **Debugging Quicksand** | Keep |
| Surface Patching | **Surface Patching** | Keep |
| Foundation-of-Sand | **Foundation-of-Sand** | Keep |
| Trust Collapse | **Trust Collapse** | Keep |

### 3.10 tele-9 Chaos-Validated Deployment

| Fault | Defect class (pre-harvest) | Consolidation note |
|---|---|---|
| Production Fragility | **Production Fragility** | Keep |
| Hope-Based Engineering | **Hope-Based Engineering** | Keep |
| Happy-Path Brittleness | **Happy-Path Brittleness** | Keep |
| Regression Leakage | **Regression Leakage** | Keep |

### 3.11 tele-10 Autopoietic Evolution

| Fault | Defect class (pre-harvest) | Consolidation note |
|---|---|---|
| Friction Fossilization | **Friction Fossilization** | Keep |
| Lesson Loss | **Lesson Loss** | Keep |
| Manual Remediation | **Manual Remediation** | Keep |
| Post-Mortem Debt | **Post-Mortem Debt** | Keep |

### 3.12 tele-11 Cognitive Minimalism

| Fault | Defect class (pre-harvest) | Consolidation note |
|---|---|---|
| LLM as Calculator | **LLM as Calculator** | Keep |
| Substrate Leakage | **Substrate Leakage** | Keep |
| Token Fragility | **Token Fragility** | Keep |
| Context Displacement | **Context Displacement** | Keep |
| Economic Blindness | **Economic Blindness** | Keep |
| Prompt as Configuration | **Prompt as Configuration** | Keep |

### 3.13 tele-12 Precision Context Engineering

| Fault | Defect class (pre-harvest) | Consolidation note |
|---|---|---|
| Context Bloat | **Context Bloat** | Keep |
| Prompt Sprawl | **Prompt Sprawl** | Keep |
| Unbounded Accumulation | **Unbounded Accumulation** | Keep |
| Unstructured Hydration | **Unstructured Hydration** | Keep |
| Attention-Blind Positioning | **Attention-Blind Positioning** | Keep |
| Waste-Blind Prompting | **Waste-Blind Prompting** | Keep |
| Cosmetic Precision | **Cosmetic Precision** | Keep |

### 3.14 Cross-tele defects (emergent from Phase 2 analysis, not in any single tele)

| Defect class | Mechanism | Source |
|---|---|---|
| **Filing-Point Miscategorization** | Symptom filed at point-of-observation, not domain-of-defect; obscures real fault-domain | Phase 2 §5 (observability absorbed-and-obscured) |
| **Cold-Start Domain** | Friction class observable in work-traces but unrepresented in bug entities or threads; no backlog idea addresses it | Phase 2 §4 (role-scoping pattern) |
| **Scope-Conflation-on-Resolve** | Bug declared resolved because one aspect shipped; sibling aspect remains | Phase 2 §6 (bug-10 → bug-11) |
| **Runway Leak** | Planned back-compat hook persists as low-grade friction until retired | Phase 2 §6 (mission-40 auto-claim paths) |

### 3.15 Defect totals (pre-greg-harvest)

- Tele-harvested: ~60 (13 teles × ~4-7 Faults each)
- Phase-2-emergent: 4
- **Total candidates:** ~64

**Target post-consolidation:** 25-40 named Defect classes (some Faults are genuinely the same pattern across Teles; consolidate during register authoring).

---

## 4. Cross-reference matrix skeleton

Pre-populated matrix: Concept × Defect (rows = concepts, columns = defects). Cell = "resolves" if the concept addresses the defect.

*(Full matrix deferred to the Phase 3 register itself — ~10 concepts × ~30 consolidated defects = 300 cells; mostly empty, ~40-60 "resolves" relationships. Skeletal example:)*

| | Hidden State | Silent Drift | Doc-Code Drift | Logic Leakage | LLM as Calculator | Context Bloat | Filing-Point Miscat | Cold-Start Domain |
|---|---|---|---|---|---|---|---|---|
| **Uniform Adapter Contract** | | | ✓ | ✓ | | | | |
| **Substrate-First Logic** | | | | | ✓ | | | |
| **Manifest-is-Master** | ✓ | ✓ | ✓ | | | | | |
| **Precision Context Engineering** | | | | | | ✓ | | |
| **Vocabulary Chain** | | ✓ | ✓ | | | | | |
| **Hub-as-Conductor** | | | | | | | | |
| **Direct-Write Backstop** | | | | | | | | |
| **Role Purity** | | | | ✓ | | | | |
| **Shipped-but-Leaks** | | ✓ | | | | | ✓ | |
| **Filing-Point ≠ Fault-Domain** | ✓ | | | | | | ✓ | ✓ |

Phase 3 register fills the full matrix.

---

## 5. Phase 3 convergence-criteria pre-check (plan §Phase 3)

| Criterion | Pre-check status |
|---|---|
| Every Tele fault maps to ≥1 defect class | ✓ Pre-harvest covers all 13 teles × ~4-7 faults each; consolidation during register authoring preserves 1-to-1 tele-fault-to-defect mapping |
| Every velocity-multiplier idea maps to ≥1 concept | ⚠ 10 core concepts cover the major ratified ideas; Phase 3 authoring will verify each idea maps; orphans explicitly named |
| Orphans explicitly named or deferred | ⚠ Phase 3 task — requires greg's harvest + my cross-reference pass |

---

## 6. What Phase 3 formal opening looks like

1. Director ratifies Phase 2 (pending)
2. Thread opens (lily → greg) signaling Phase 3 open + requesting candidate harvest
3. greg produces candidate list — concept names from ratified ideas, defect names from Tele Faults + bug descriptions
4. Architect receives greg's harvest → promotes this prep-framework into `docs/reviews/2026-04-phase-3-concepts-and-defects.md` → folds greg's candidates → authors full shapes per §1.1 + §1.2 templates → builds full cross-reference matrix
5. Commit + ping Director for review
6. Director reviews → architect revises if needed
7. Engineer (greg) critiques naming + cross-references per plan §Phase 3 critique cadence
8. Architect absorbs critique → Phase 3 register finalized
9. Director ratifies → Phase 3 closes → Phase 4 Investment Prioritization opens

---

## 7. Risks / discipline notes for Phase 3 authoring

1. **Concept proliferation** (plan §anti-patterns) — target 8-12 final concepts; sub-concepts fold into parents if parent's Mechanics already covers them
2. **Defect explosion** — 60+ candidates is manageable only if consolidated into 25-40 classes via shared-mechanism merging
3. **Tele-duplication** — some Tele Faults are near-synonyms across teles (e.g., tele-5 Architect Amnesia vs tele-1 Hidden State); naming discipline must preserve distinction OR explicitly consolidate with cross-tele reference
4. **Cross-reference matrix quality** — a "✓ resolves" should mean "this concept measurably reduces incidence of this defect"; avoid speculative links
5. **Orphan discipline** — plan says orphans are either named as new concepts/defects or explicitly deferred. Don't let unclassified ideas/defects float; name or defer with rationale
6. **Phase 4 boundary** — Phase 3 produces the register; Phase 4 converts register into mission briefs. Don't draft mission candidates mid-Phase-3 (scope creep)

---

*End of Phase 3 prep framework. Promotes to `docs/reviews/2026-04-phase-3-concepts-and-defects.md` when Phase 3 formally opens. Awaits: Director Phase 2 ratification + engineer candidate harvest.*
