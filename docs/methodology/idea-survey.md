# Idea Survey — first-class Idea→Design triage methodology

**Status:** v1.0 (Director-ratified 2026-04-26 post idea-206 first canonical execution + post-codification refinement)
**Position in lifecycle:** between Idea (status=triaged) and Design (architect+engineer-led)
**Companion docs:** `mission-lifecycle.md` (formal lifecycle; v1.0 co-ships at mission-57 W4 D5); `mission-preflight.md` (downstream phase); `calibration-23-formal-design-phase.md` (extends Survey-then-Design phase per Idea); `multi-agent-pr-workflow.md` (downstream cross-approval pattern)

---

## §1 Foundational mental model: constraint-satisfaction matrix

Survey is a structured intent-capture process treating Director picks as **degrees-of-freedom constraints** in a multi-dimensional intent space. Architect's role is to **solve the matrix** — derive aggregate intent from the constraint set, with the tele framework as a guide.

Sudoku analogy: each Director pick is a filled cell; architect's interpretation step is the propagation step that derives implications from the filled cells + the rules of the game (tele framework + original Idea description). Multi-pick = multiple cells filled simultaneously, providing richer constraint geometry.

The methodology mechanises Director-intent capture without requiring Director to engage in section-by-section Design walkthrough. Director time-cost concentrated at Idea phase (~5 minutes for 6 picks); Design phase becomes architect+engineer scope.

---

## §2 Scope (when Survey applies)

| Case | Survey? | Notes |
|---|---|---|
| **Idea→Design triage** | ✅ Mandatory | Primary use case; first-class binding |
| **Bug→Fix** | ❌ Skip | Bug→Fix flow is direct; no Director-intent ambiguity |
| **Bug-that-surfaces-an-Idea-requiring-Design** | ✅ on the spawned Idea | Bug closes; new Idea filed; Survey applies to that Idea |
| **Small refactor** | Must formalise as Idea OR Bug first | No informal-refactor channel; pick a category, then per above |
| **New Idea/Mission spawned from current Mission** | ⚠️ Architect-judgment bypass | Bypass valid IF Idea is sufficiently scoped to proceed to Design directly. **Linkage MANDATORY for traceability** — see §8 |

---

## §3 Round 1 — Guide intent space (4 architect steps)

### Step 1: Architect proposes 3 questions

- **3 orthogonal questions** that anchor Director's high-level intent (avoid co-correlated axes; each question should partition the space along a different dimension)
- Each question carries **3-4 pre-determined pick-list answers**
- Architect designs answers as **orthogonal** where possible (composable; multi-pick natural) — improves refinement surface (per §6 multi-pick rules)
- Keep questions SHORT and SIMPLE — not jargon-heavy unless context warrants
- Round 1 typically anchors **WHY/WHO/HOW-cadence** dimensions (highest-level intent)

### Step 2: Director picks

- **Multi-pick always supported** — Director may pick A+C if both genuinely apply (per §6)
- **Contradictory multi-pick on mutually-exclusive questions IS A SIGNAL** of intent constraint (per §7) — NOT an error
- Optional: brief rationale or "other: X" override (rare; should signal pick-list incomplete)

### Step 3: Architect captures aggregate response surface

Write a 1-2 sentence composite read of all 3 picks — this is the Round 1 response matrix.

### Step 4: Architect loops back through each question one-by-one

For each of Q1, Q2, Q3 individually, architect reasons an interpretation per question, anchored in **multi-dimensional context**:

| Context dimension | What it provides |
|---|---|
| **Original short Idea description** | The seed concept; grounds interpretation in original intent |
| **Tele mapping (this round)** | Architect produces an aggregate tele-mapping for the round (which tele are most-relevant given Director's picks); used to inform/support interpretation; **anti-tele drift check** — does the interpretation align with relevant primary/secondary/tertiary tele? |
| **Aggregate Director response surface this round** | Other 2 picks contextualize this question's interpretation (Sudoku-style propagation: filled cell A constrains interpretation of filled cell B) |

This is the "solve the row of the matrix" step. Each interpretation is a 1-2 paragraph hypothesis: *"given the aggregate picks + original Idea + tele framework, here's what Q-N most likely means."*

**Cross-question coherence check:** do the 3 interpretations align internally? If not, flag tension as Round 2 clarification candidate.

---

## §4 Round 2 — Architect's choice (refine / clarify / new dimension / mix)

Round 2 is **architect's choice on question type** — refine deeper, clarify ambiguity, anchor new dimension, or mix. **Goal: maximum degrees of freedom informing Design phase.**

| Round 1 outcome | Round 2 strategy |
|---|---|
| Cleanly confirmed all 3 dimensions | Refine deeper (drill into HOW); OR explore new dimension if one emerged |
| Left ambiguity on some dimensions | Clarify ambiguous picks (resolve before Design) |
| Cleanly confirmed some + ambiguity others | Mix: refine confirmed + clarify ambiguous |
| Surfaced contradictory multi-pick | Round 2 is clarification candidate (per §7) |

### Steps (same structure as Round 1)

1. **Architect proposes** 3 questions (same orthogonality + pick-list discipline as Round 1)
2. **Director picks** (multi-pick rules same as Round 1)
3. **Architect captures** Round 2 aggregate response surface
4. **Architect loops back** through each Round 2 question (Q4, Q5, Q6) one-by-one with multi-dim context:

| Context dimension | What it provides |
|---|---|
| **Original Idea description** | Carry forward |
| **Round 1 responses + interpretations** | Carry forward; Round 2 builds on Round 1 |
| **This round's Tele mapping** | Round 2 may surface different tele weight than Round 1; refresh the mapping per round |
| **Aggregate Director response surface Round 2** | Other Round 2 picks contextualize this question |

---

## §5 Output: pre-Design input artifact

Persist as `docs/surveys/<mission>-survey.md` (architect-authored; ships bundled with Design v1.0 PR):

- All 6 Director picks (Round 1 + Round 2)
- All 6 architect interpretations (per-question; with tele-mapping + aggregate-context citations)
- Composite intent envelope (the "solved matrix"; aggregate read for Design phase)
- Any contradictory-multi-pick constraints carried forward as Design-brainstorm anchors (per §7)
- Calibration data point (Director time-cost; comparison vs prior-methodology Director engagement)

Design phase opens architect+engineer-led against this anchor. Director re-engages at preflight + release-gate + retrospective per autonomous-arc-driving pattern.

---

## §6 Multi-pick semantics

**Multi-pick is always supported** at Director's discretion. Architect's question-design discipline shapes how multi-pick behaves:

| Architect designed answers as... | Director multi-pick behavior |
|---|---|
| **Orthogonal / composable** (e.g., "A: latency reduction; B: observability; C: stuck-prevention; D: comprehensive") | Multi-pick natural; each pick adds a constraint; architect interprets union of constraints |
| **Mutually exclusive** (e.g., "A: per-role static defaults; B: per-mission-class adaptive; C: per-mission declared; D: Hub-derived adaptive") | Multi-pick contradictory; per §7 — NOT an error; intent signal |

**Architect-design heuristic:** prefer orthogonal answers where possible to maximize refinement surface. Mutually-exclusive answers reserved for cases where the dimension is genuinely binary/categorical.

---

## §7 Contradictory multi-pick handling (Director-codified)

If Director picks contradictory options on a mutually-exclusive question, the picks ARE NOT an error — Director is communicating *"there's some common satisfiable constraint I'm going for."*

### Handling protocol

1. **Round 2:** architect surfaces the contradiction as Round 2 clarification candidate; designs Round 2 question to disambiguate OR satisfy the constraint envelope
2. **Round 2 still contradictory:** architect carries the contradictory-pick set forward to Design phase as a **constraint to satisfy via brainstorm**
3. **Design phase:** engineer + architect explore solutions that fit the constraint envelope (e.g., a cadence model that simultaneously satisfies "per-role static" + "per-mission declared" might emerge as "per-role static defaults overridable per-mission")

This treats contradictory-multi-pick as a **methodology feature**, not a failure mode. Director's intent signal often points at constraint-satisfaction outcomes architect/engineer hadn't considered.

---

## §8 Bypass discipline (spawned Ideas; Director-codified)

New Ideas/Missions that spawn from currently-active Missions can **bypass Survey** if the Idea is sufficiently scoped to proceed to Design directly.

### Bypass criteria (architect-judgment)

- Idea has clear, complete scope at filing time (not exploratory)
- Director-intent already anchored (e.g., Director-proposed during current mission with pick-list-equivalent crispness)
- No major intent ambiguity that Survey would resolve

### Linkage MANDATORY (traceability)

When bypassing, architect MUST link the new Idea to source Mission for traceability:

- `sourceThreadId` — thread-within-source-mission where the Idea originated
- `tags` — include `["spawned-from-mission-N"]`
- Future Idea schema field `sourceMissionId: string` (when added) — direct linkage

Survey skipped; Design phase opens directly with architect-authored Design v0.1 + engineer round-1 audit.

### When NOT to bypass

If the Idea's scope is exploratory or Director-intent ambiguous, Survey applies even for spawned Ideas. Better to Survey-then-Design than Design-without-anchor.

---

## §9 Architect-side execution discipline (the "solve the matrix" step)

For each round, architect's discipline is:

1. **Pre-anchor:** review original Idea description + relevant tele inventory; identify likely tele-weight before architect proposes questions
2. **Question design:** 3 orthogonal questions with orthogonal pre-determined answers; write architect-self-justification per question (*"this question discriminates the intent space along axis X by partitioning into options A/B/C/D"*)
3. **Director pick capture:** record verbatim picks + any rationale text Director provides
4. **Aggregate surface capture:** write composite read of all 3 picks (1-2 sentences per round)
5. **Per-question interpretation loop:** for each Q individually, write a 1-2 paragraph interpretation citing Original-Idea + Tele-mapping + Aggregate-Surface as context dimensions
6. **Anti-tele drift check:** does this interpretation align with relevant primary/secondary/tertiary tele? If not, flag as architect-misinterpretation candidate
7. **Cross-question coherence check:** do the 3 interpretations align internally? If not, flag tension as Round 2 clarification candidate
8. **Round 2 question design:** based on Round 1 interpretations, choose refine/clarify/new-dimension per architect-judgment for max-degrees-of-freedom outcome

The per-question interpretation loop is what differentiates Survey from "pick-list aggregate read" — it's the matrix-solve step that produces robust pre-Design input.

---

## §10 Composition with existing patterns

| Pattern | Composition |
|---|---|
| **Calibration #23** (`calibration-23-formal-design-phase.md`) | Formal Design phase per Idea now becomes formal **Survey-then-Design phase per Idea**; tele-pre-check happens DURING Survey architect-interpretation loop (per-round) |
| **Autonomous-arc-driving pattern** (mission-56 retrospective §1.1; pre-mission-arc retrospective §1.1) | Extends back into Design phase (architect+engineer scope); Director surfaces only on architectural seeds, not Design mechanics |
| **Mediation invariant** (mission-56 retrospective §5.1.2) | Survey IS the structured-mediation channel; Director↔Engineer-via-Architect preserved; Director never section-by-section walks Design with engineer |
| **Mechanise+declare doctrine** (`feedback_mechanise_declare_all_coordination.md`) | Survey is doctrine in operational form (declarative pick-list intent capture + structured architect-interpretation step) |
| **Mission-class taxonomy** (mission-56 retrospective §5.4.1) | Survey output may inform missionClass declaration (e.g., outcome priority + cadence anchors map to coordination-primitive-shipment vs structural-inflection) |
| **Substrate-self-dogfood discipline** (`feedback_substrate_self_dogfood_discipline.md`) | Orthogonal; Survey applies at Idea phase; substrate-self-dogfood applies at mission execution phase |

---

## §11 Anti-patterns retired

- **Director-led Design walkthrough section-by-section** — replaced by Survey-then-Design (was the mode used during mission-56 Design v1.x phase + mission-56 retrospective; high Director-time-cost; doesn't scale)
- **Architect free-form Director-intent-extraction dialogue** — replaced by structured pick-list
- **Design v0.1 authored without Director-intent anchor** — replaced by Survey-anchored Design
- **Director-as-Design-collaborator mode** — Director's role shifts to intent-anchoring (Idea phase via Survey) + ratification gates (Manifest + release-gate + retrospective)
- **Architect aggregate-only interpretation** (jumping straight to composite read without per-question loop) — replaced by per-question interpretation step with tele-mapped multi-dim context
- **Informal small refactors without Idea/Bug filing** — must formalise as Idea OR Bug first (per §2 scope)

---

## §12 First canonical execution + calibration data

**idea-206 M-Mission-Pulse-Primitive** — first canonical Survey execution (2026-04-26 post mission-56 close).

| Metric | idea-206 | Comparison |
|---|---|---|
| Director time-cost | ~5 minutes (6 picks across 2 rounds) | vs ~3 hours mission-56 Design walkthrough = **~36× compression** |
| Multi-pick observed | Q1: A+C; Q2: B+D | Validated multi-pick as supported + sharpening |
| Contradictory multi-pick | None | Methodology accommodates per §7; no test-case yet |
| Bypass invoked | No (idea-206 was Director-anchored Tier 2 follow-on; chose Survey-anyway as first canonical execution) | Bypass available per §8 for future spawned Ideas |
| Architect-interpretation discipline | Initially aggregate-only; codification refinement added per-question loop | v1.0 of methodology incorporates per-question loop |

**Future canonical executions** will append calibration data to this doc (or to `feedback_director_intent_survey_process.md` memory).

---

## §13 Forward implications + integrations

- **mission-lifecycle.md v1.0** must codify Survey as a formal Idea→Design transition phase (co-ships at mission-57 W4 D5)
- **Idea entity schema** may need optional fields:
  - `surveyResponses: Record<string, string>` for Director picks
  - `architectInterpretations: Record<string, string>` for per-question interpretations
  - `sourceMissionId: string` for spawned-Idea traceability (per §8)
- **Calibration #23** extends with Survey-as-prerequisite framing: tele-pre-check happens DURING Survey per-round interpretation loop
- **Strategic-review** (`strategic-review.md`) may use Survey calibration data (Director time-cost, intent-clarity score) as Idea triage signal
- **Future Idea-survey methodology refinements** fold back into this doc + memory; iterative-refinement intent ratified by Director

---

## §14 Cross-references

- **`feedback_director_intent_survey_process.md`** (architect memory; doctrine version of this doc; carries codification provenance)
- **mission-56 retrospective §4.1.1** (mechanise+declare doctrine; Survey realizes it for intent capture)
- **mission-56 retrospective §4.1.3** (`feedback_complete_mission_scope_methodically.md`; Survey makes scope crisp at Idea phase)
- **mission-56 retrospective §5.1.2** (mediation invariant; Survey is structured-mediation channel)
- **mission-56 retrospective §7.4** (doctrine layer between tele and design; Survey is doctrine)
- **`feedback_director_engagement_modes.md`** (active-collaborator vs watchdog distinction; Survey concentrates Director engagement at Idea phase)
- **`feedback_mechanise_declare_all_coordination.md`** (binding tele principle Survey realizes for intent capture)
- **`reference_idea_to_mission_workflow.md`** (workflow chain extends with Survey step; Concept→Idea→Survey→Design→Manifest→Mission)
- **idea-206 M-Mission-Pulse-Primitive** — first canonical execution; mission-57 (in flight)
- **`docs/surveys/m-mission-pulse-primitive-survey.md`** — first-canonical-execution Survey artifact (commit `a8e9aca`)

---

## §15 Artifact schema (codified `validate-envelope.sh` enforcement contract)

**Provenance:** added 2026-05-02 by mission-69 (M-Survey-Process-as-Skill) per AG-9 carve-out ratified bilaterally via thread-455. Spec-enrichment IS in-scope (codifies the enforcement contract `validate-envelope.sh` implements at `/skills/survey/scripts/`); methodology-semantic-evolution IS NOT in-scope (the §1-§14 methodology is unchanged). Future spec-enrichment changes follow the same carve-out pattern.

Survey envelope artifacts written to `docs/surveys/<mission>-survey.md` SHALL conform to the following schema. The `validate-envelope.sh` Skill helper enforces this schema as the finalize-gate check; exit 0 = valid; exit 1 = schema violation (with diagnostic naming first failure).

### Frontmatter (YAML; required keys)

- `mission-name: M-<name>`
- `source-idea: idea-<N>`
- `methodology-source: docs/methodology/idea-survey.md v<X.Y>`
- `director-picks:`
  - `round-1: { Q1, Q1-rationale?, Q2, Q2-rationale?, Q3, Q3-rationale? }`
  - `round-2: { Q4, Q4-rationale?, Q5, Q5-rationale?, Q6, Q6-rationale? }`
  - All 6 picks required (each value ∈ {a, b, c, d}); rationale optional.
- `mission-class: <one of the canonical 8 values per docs/methodology/mission-lifecycle.md §3 Mission-class taxonomy>` — `spike` | `substrate-introduction` | `pre-substrate-cleanup` | `structural-inflection` | `coordination-primitive-shipment` | `saga-substrate-completion` | `substrate-cleanup-wave` | `distribution-packaging`
- `tele-alignment:`
  - `primary: [tele-N, ...]` (whole-mission rollup; required)
  - `secondary: [tele-X, ...]` (whole-mission rollup; required)
  - `round-1: { primary, secondary }` (per-round mapping; required per §3 Step 4 + §9 step 5/6 anti-tele-drift discipline)
  - `round-2: { primary, secondary }` (per-round mapping; required)
- `calibration-data:` (required per §5 Survey output element + §13 methodology-evolution loop)
  - `director-time-cost-minutes: <integer>` (required)
  - `comparison-baseline: <ref e.g. mission-XX or "prior-methodology-walkthrough">` (required)
  - `notes: <free text observation>` (required; may be brief)
- `contradictory-constraints: [...]` (optional at frontmatter level; required when contradictory multi-pick detected per §7 — each entry: `{ round, questions, picks, constraint-envelope }`)
- `skill-meta: { skill-version, tier-1-status, tier-2-status, tier-3-status }` (required when Skill-mediated)
- `calibration-cross-refs: { closures-applied: [...], candidates-surfaced: [...] }` (required; arrays may be empty)

### Prose body (required sections)

- `## §0 Context`
- `## §1 Round 1 picks` — followed by per-question interpretation sub-sections `### §1.Q1 — Per-question interpretation` / `### §1.Q2 — ...` / `### §1.Q3 — ...` (each 1-2 paragraph minimum per §3 Step 4 matrix-solve discipline)
- `## §2 Round 2 picks` — followed by `### §2.Q4 — Per-question interpretation` / `### §2.Q5 — ...` / `### §2.Q6 — ...` (each 1-2 paragraph minimum per §4 Step 4)
- `## §3 Composite intent envelope`
- `## §4 Mission scope summary` (with per-round tele-mapping rows)
- `## §5 Anti-goals`
- `## §6 Architect-flags / open questions for Phase 4 audit`
- `## §7 Sequencing / cross-mission considerations`
- `## §calibration` — Calibration data point (Director time-cost + comparison-baseline + notes)
- `## §contradictory` — Contradictory multi-pick carry-forward (REQUIRED when frontmatter declares any contradictory-constraints entries; OMIT entirely otherwise)
- `## §8 Cross-references`

### Validator enforcement

`validate-envelope.sh` (at `/skills/survey/scripts/validate-envelope.sh`; ships with the Survey Skill at mission-69) enforces this schema:
- Exit 0 = valid (envelope ratifiable; Phase 4 Design bilateral round-1 audit may open)
- Exit 1 = schema violation (with diagnostic naming first failure; architect fixes + re-runs the finalize gate)
- Exit 42 = stub (Tier-2/3 dispatch path; not normally fired by the validator itself)

### Schema version evolution

Schema changes follow the mission-lifecycle pattern: bump methodology version (`idea-survey.md` vX.Y → vX.Z); update §15 schema text; update Skill `methodology-source` frontmatter pin; backward-compat decision per change. Per the AG-9 carve-out provenance: spec-enrichment additions are routine; methodology-semantic-evolution is rare + ratified separately.

---

*Methodology v1.0; ratified 2026-04-26 by Director post idea-206 first canonical execution + post-codification refinement. §15 schema enrichment added 2026-05-02 by mission-69 per AG-9 carve-out (semantic methodology unchanged). Architect: lily.*
