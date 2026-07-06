# Strategic Review — Methodology

**Status:** v2.0 (2026-05-23). Full rewrite — supersedes v1.0 (2026-04-21). Treat as engineered component — version, critique, evolve.
**Scope:** routine prioritisation-pass methodology designed to operate at any cadence (ad-hoc to scheduled-daily); skill-mechanisable; designed at autonomy-target with manual fallback for the pre-substrate present.
**Companions:**
- `docs/methodology/ledger-reconciliation.md` — peer; reconcile the ledger before running a Strategic Review (a review over a rotted backlog evaluates noise).
- `docs/methodology/mission-lifecycle.md` — downstream; consumes ratified Initiatives via the Survey → Design pipeline.
- `docs/methodology/idea-survey.md` — downstream Phase 3 mechanism; the Survey skill operates on ratified Ideas the SR's triage routes to it.

---

## v1.0 → v2.0 reframe (what changed)

v1.0 framed SR as a **heavy planning event** producing mission briefs. v2.0 reframes it as a **routine prioritisation-pass** producing Initiatives that route into the existing pipeline. The output unit shifts; the cadence flexes; the architect-autonomy intent becomes explicit. Full derivation in §Provenance.

| | v1.0 | v2.0 |
|---|---|---|
| Trigger | "backlog has outpaced prioritisation" — episodic | scheduled / on-demand at any cadence |
| Unit of analysis | full system | scope-parameterised subset |
| Output | 3–5 ratified mission briefs | ratified Initiatives (route to Idea→Triage→Survey→Design→Mission pipeline) |
| Director engagement | per-phase (6-step × 4 phases ≈ 24 touchpoints) | per-run (1 ratification — Standard/Quick); per-phase only in Deep mode |
| Time cost | multi-session | single-session per run (Standard); rare multi-session (Deep) |
| Phase decomposition | 4 fixed phases × 1 artifact each | mode-based (Quick / Standard / Deep) |
| Methodology layer | mission production | initiative routing |
| Autonomy target | implicit | explicit — workflow specifies substrate queries with manual fallback today |

v1.0's 4-phase structure is preserved as **Deep mode only** (rare major re-orientations); Standard mode collapses to single-pass.

---

## Purpose

A Strategic Review is a **routine prioritisation-pass over (some or all of) the backlog that produces ratified Initiatives**. It does prioritisation + routing; it does *not* do mission production (Survey + Design + Mission lifecycle own that downstream).

The methodology operates at the **orientation layer** (Tier 1; see §Entity Model): given the current Tele set and Initiative set, given the in-scope subset of Tier-3 instances, produce the next ratified set of Initiatives + triage decisions + reverse-gap observations + anti-goals.

The methodology is **designed at the autonomy target** — the workflow specifies substrate queries the architect would issue if the relationship graph existed today. Manual fallbacks are documented per sub-step. As the substrate fills in (idea-151 graph relationships; idea-121 verb-tool consolidation; lineage-capture work), the SR progressively autonomises.

---

## Entity model — three tiers

The SR methodology operates against a three-tier entity model.

### Tier 1 — Orientation

`Tele` and `Initiative` are **peers**. Both required to plan.

| | Tele | Initiative |
|---|---|---|
| Question | "where should we be heading?" | "what are we going to do to head there?" |
| Concept | outcome axis | deliberate project effort |
| Completion semantics | no — Teles don't ship | yes — Initiatives ship/abandon |
| Cadence | stable (10–20 ever; refinement common, addition rare) | active (declared per SR run; ships/abandons frequently) |
| Mutation primitive | constitutional refinement via the mission-kit pen (axiom PRs; the tele mutation verbs are retired) | `create_initiative` / `update_initiative` (per SR run) |

**Relationship:** Initiative declares Tele alignment (M-N). An Initiative without Tele alignment is suspect; either find one or propose a new Tele via the Tele audit primitive.

**Reverse-gap signal:** Teles with no Initiatives → the system has an outcome axis no project is serving. Trigger for either a new Initiative proposal or (rare) re-examination of whether the Tele is still load-bearing.

### Tier 2 — Class

`Concept` and `Defect` are **peers**. Both emerge from instances; not declared in advance.

| | Concept | Defect |
|---|---|---|
| Concept | architectural pattern | failure-mode pattern |
| Example | "Sovereign Composition substrate-class promotion" | "DSV-class methodology-bypass" |
| Relationship to Teles | Concepts exercise Teles (advance them when applied) | Defects violate Teles (regress them when present) |
| Emergence | crystallises across multiple Ideas | crystallises across multiple Bugs |
| Extraction cadence | rare; triggered by accumulated-instance threshold | rare; triggered by accumulated-instance threshold |

Class-layer extraction is **emergent + occasional**. The SR may *surface candidates* for naming (e.g., "this Initiative recurs the substrate-class promotion pattern — Concept candidate"); the extraction-to-formal-doc is a separate (rarer) activity, possibly its own skill.

### Tier 3 — Instance

The execution chain: `Idea / Bug → Design → Mission`.

- `Idea` — proposed unit of work (existing first-class)
- `Bug` — observed defect (existing first-class)
- `Design` — engineered solution (per idea-129 / current `Proposal` entity)
- `Mission` — execution unit (existing first-class)

**Relationships (all M-N unless noted):**

- Ideas/Bugs align with Teles (M-N)
- Ideas/Bugs compose under Initiatives (M-N) — multi-Initiative parentage is the cross-leverage signal
- Ideas generalise into Concepts (M-N)
- Bugs generalise into Defects (M-N)
- Design `1-1` Idea (typically; at any time)
- Mission `1-1` Design (Manifest binds them)

### Properties (not entities)

**Anti-goals** — scope-negation statements. Two forms:
- **Per-Initiative property** — "this Initiative deliberately does NOT do X" (local scope)
- **Per-SR-run accumulated output** — "this run deferred these candidates with rationale" (episodic)

Anti-goals are *not* a Tier-1 entity. They're project-scoped negations, not system-level orientation axes.

### Promotion status (2026-05-23)

| Entity | Status |
|---|---|
| Tele | first-class Hub entity ✓ |
| Idea | first-class Hub entity ✓ |
| Bug | first-class Hub entity ✓ |
| Mission | first-class Hub entity ✓ |
| Design | first-class via current `Proposal` entity; rename per idea-129 |
| **Initiative** | **proposed**; transitional vehicle = Idea with `kind: umbrella` tag |
| **Concept** | **proposed** (idea-133); transitional vehicle = `docs/concepts/*.md` proxies |
| **Defect** | **proposed**; transitional vehicle = `docs/defects/*.md` proxies |

The Class-Tier promotion (Initiative + Concept + Defect ship-together as first-class) is itself an Initiative-shaped substrate-extension blocked-on idea-121 (verb-tool consolidation) + idea-126 (k8s-style envelope). First manual SR runs naturally surface it as a critical-path Initiative.

---

## When to use

- Scheduled routine cadence (daily / weekly / per-mission-close)
- Ad-hoc when a specific scope warrants a focused triage (Quick mode)
- After ledger-reconciliation has run + the live-backlog is trustworthy
- Before committing to a new mission cycle — validate the candidate Initiative still has tele-leverage
- When a substrate-layer change (new Tele, new entity kind) shifts orientation

## When NOT to use

- For tactical per-bug or per-task triage (use entity-specific update flows)
- For single-mission planning (use `mission-lifecycle.md` Phase 3 Survey + Phase 4 Design)
- Over a rotted backlog — reconcile first (`ledger-reconciliation.md`)
- Mid-mission — review between missions, not during

---

## Roles

| Role | Default responsibility |
|---|---|
| **Director** | Ratifies the per-run artifact (Standard/Quick) or per-phase artifact (Deep). Owns strategic judgment. Owns Tele-set evolution (via separate Tele audit primitive). Owns final Initiative prioritisation. |
| **Engineer agent** | Substrate queries (psql / `get-entities.sh`). Live-state verification (per `ledger-reconciliation.md` v1.1 §Roles split). Cost-estimation input. Critique of architect's draft. |
| **Architect agent** | Tele-alignment scoring. Cluster-by-disposition. Initiative naming + composition. Reverse-gap detection. Concept/Defect candidate-surfacing. Drafts the per-run artifact. |

### Cadence per mode

- **Standard / Quick:** architect drafts → engineer critiques → architect integrates → Director ratifies (per-run, not per-sub-step)
- **Deep:** per-phase ratification (4 phase artifacts); approximates v1.0's 6-step protocol; reserved for major re-orientations

---

## The workflow

Single-pass for Standard mode (sub-steps in one artifact). Sub-steps re-expand into the 4-phase Deep-mode artifacts when scope warrants.

| # | Sub-step | Substrate query (autonomy-target) | Manual fallback (today) |
|---|---|---|---|
| 1 | **Scope resolve** | `query(kind, status, theme, since, tele)` | filter via `list_*` + ledger grep |
| 2 | **Inventory** | per-entity bundle with metadata | cartography-doc style; psql cross-ref where available |
| 3 | **Lineage walk** | `lineage(entity) → ancestors + descendants + cross-refs` | hand-walk IDs in entity bodies; tag-prefix analysis |
| 4 | **Cluster** | M-N parentage detection + semantic similarity | apply FOLD/COMPOSES/DEFER/EXCLUDE vocabulary; manual cluster-naming |
| 5 | **Friction surface** | bug-density, thread-roundCount-near-limit, recurring failures, DSV-instances | engineer enrichment-companion shape (friction inventory + DSV patterns) |
| 6 | **Initiative analysis** | per-current-Initiative: advancing? blocking? orphan Ideas? | review each open Initiative + its child Idea/Bug set |
| 7 | **Reverse-gap check** | `reverse-gap(tele) → [Initiative]`; orphan-Idea detection | manual cross-ref against current Tele set |
| 8 | **Class-layer surface** | accumulated-instance triggers for Concept/Defect emergence | observation only (defer formal extraction unless threshold clear) |
| 9 | **Critical-path mapping** | blocking-graph; upstream/downstream dependency walk | manual dependency reasoning; cite Initiative-to-Initiative blocks |
| 10 | **Initiative output** | `create_initiative` / `update_initiative` via verb-tool with `kind: Initiative` | file as `Idea` with `kind: umbrella` tag (transitional) |
| 11 | **Triage routing** | per-Idea/Bug → skip-Survey / triage-thread / queue / dismiss | apply Idea Triage Protocol (§Triage Routing below) |
| 12 | **Anti-goals capture** | per-Initiative property + per-run accumulated output | inline in artifact §Anti-goals |
| 13 | **Director ratify** | single ratification on per-run artifact (Standard/Quick); per-phase (Deep) | thread or direct |

**Convergence (Standard / Quick):** ratified artifact exists; every in-scope Idea/Bug has a triage disposition; every new/updated Initiative declares Tele alignment + scope + anti-goals.

**Convergence (Deep):** all 4 phase artifacts ratified per v1.0 phase-convergence criteria; cross-linked.

---

## Modes

| Mode | Trigger | Sub-steps | Artifact(s) | Director engagement |
|---|---|---|---|---|
| **Quick** | ad-hoc; specific question or focused triage | 1, 2, 6, 11 (focused subset) | 1 artifact | 1 ratification |
| **Standard** | scheduled routine cadence (daily / weekly / per-mission-close) | all 13 | 1 artifact | 1 ratification |
| **Deep** | major re-orientation (Tele set shift; multi-friction-cluster acute; cross-program reframe) | sub-steps re-expand into 4 phase artifacts (cartography / friction / class-extract / prioritisation) | 4 artifacts | per-phase ratification |

Default mode for scheduled cadence = **Standard**.

---

## Scope filtering

Multi-dimensional, composable. Standard-mode default scope (when scheduled without parameter):

> *Everything filed/changed since last SR run + all open Initiatives + all reverse-gap Teles*

Filter primitives:

| Dimension | Examples |
|---|---|
| **Entity kind** | `Idea` / `Bug` / `Mission` / `Thread` / `Initiative` / `Concept` / `Defect` / `any` |
| **Status** | `open` / `triaged` / `dismissed` / `incorporated` / per-kind status enum / `any` |
| **Theme** (anchor) | rooted at an Initiative or Concept; walks the lineage graph from the anchor |
| **Time** | since last SR run / since date / within window |
| **Tele** | rooted at a Tele (all entities advancing tele-N) |
| **Tag cluster** | rooted at a tag prefix (e.g., `mission-41-wave-3`) |

Composition example:
- Quick triage of a single program: `{ theme: initiative-X, kind: [Idea, Bug], status: open }`
- Daily standard review: `{ since: last_sr_run, status: [open, investigating] }` + open Initiatives + reverse-gap Teles
- Deep re-orientation: `{}` (no filter — all open entities of all kinds)

---

## Substrate dependencies (autonomy target)

The workflow's autonomy column assumes these substrate primitives. Each is itself an Initiative-shaped piece of substrate work; the first SR runs naturally surface them on the critical path.

| Dependency | What it enables | Initiative / Idea reference |
|---|---|---|
| **First-class graph relationships** | sub-steps 3 (lineage walk), 4 (cluster), 7 (reverse-gap), 9 (critical-path) | idea-151 |
| **Verb-tool consolidation** | sub-step 10 (Initiative output) without per-kind tool proliferation | idea-121 |
| **k8s-style entity envelope** | verb-uniformity precondition | idea-126 |
| **Lineage-capture (bug-118 reverse)** | sub-step 3 substrate-walkability for bugs (currently 0/118 have `sourceThreadId`) | bug-118 + related substrate work |
| **Class-Tier promotion** | sub-step 10 native form (`Initiative` / `Concept` / `Defect` entities) | (proposed; blocked-on idea-121 + idea-126) |
| **Scheduled SR runner** | sub-step 1 scope-default trigger | (out of scope of methodology; future skill-runner) |

Methodology is correct *now* with manual fallbacks; correctness *improves* as each substrate dependency lands.

---

## Per-run artifact

Each run produces one durable document at `docs/reviews/<YYYY-MM-DD>-sr-<scope>.md` (Standard/Quick) or 4 phase docs (Deep).

### Standard / Quick artifact shape

```markdown
# Strategic Review — <YYYY-MM-DD> — <scope-tag>

**Mode:** Standard / Quick
**Scope:** { kind, status, theme, since, tele } — explicit declaration
**Inputs:** Tele set vN; Initiative set @ N entities open; in-scope subset ([counts])
**Prior SR run:** <link>

## §1 Inventory + Lineage
## §2 Cluster + cross-leverage (M-N parentage signals)
## §3 Friction surface
## §4 Per-Initiative analysis (status, advancing, blockers)
## §5 Reverse-gaps (Teles without Initiatives; orphan Ideas)
## §6 Class-layer surfacings (Concept / Defect candidates deferred to extraction)
## §7 Critical-path observations (Initiative-to-Initiative dependencies)
## §8 Initiative output (new + updated; per-Initiative: name, scope, Teles, anti-goals, downstream Ideas)
## §9 Triage routing (per Idea/Bug: skip-Survey / triage-thread / queue / dismiss)
## §10 Anti-goals (per-run accumulated)
## §11 Director ratification log
```

### Deep artifact shape

Four artifacts per v1.0 4-phase structure, cross-linked: cartography → friction → concepts+defects → prioritisation. Used rarely; precedent: 2026-04 full review; 2026-05-23 Threads v3 cartography ran approximating this informally.

---

## Triage routing

The SR's sub-step 11 routes each in-scope Idea/Bug to one of four dispositions:

| Route | When | Mechanism |
|---|---|---|
| **(a) Skip-direct-to-Survey** | All 5 skip-criteria met (see below); ready for Phase 3 Survey now | `update_idea(status="triaged")`; downstream to `mission-lifecycle.md` Phase 3 |
| **(b) Triage thread** | Bilateral negotiation needed; under-specified; engineer pushback | open thread; bilateral converge; status-flip via cascade or post-seal `update_idea` |
| **(c) Queue for next SR** | Collection-reasoning warranted; idea-cluster; cross-mission scope-flex | status remains `open`; surfaces in next SR Phase 1 |
| **(d) Dismiss** | Stale; superseded; cross-project; obsolete-substrate | `update_idea(status="dismissed")` per `ledger-reconciliation.md` discipline |

### Skip-criteria (all 5 must hold for (a)):

1. **Source ratification** — Director-originated OR Director-ratified-to-proceed
2. **Scope concrete** — idea text declares in-scope, out-of-scope, anti-goals
3. **No contest** — no engineer/peer pushback
4. **Tele-aligned** — Tele alignment self-evident OR explicitly stated
5. **Single-mission-shape** — not part of an idea-cluster requiring consolidation

When any criterion fails, route to (b), (c), or (d) per anti-pattern guidance.

### Anti-patterns

- **Architect-unilateral skip on engineer-surfaced Idea** — defaults to (b) triage thread
- **Triage thread on Director-ratified well-scoped Idea** — adds overhead with zero value; route via (a)
- **Indefinite queue-for-next-SR** — Ideas queued >90 days without surfacing in actual SR event accumulate as rot; trigger SR when (c)-queue exceeds N=10 OR oldest queued idea exceeds 90 days

The Idea Triage Protocol may be promoted to its own `docs/methodology/idea-triage.md` peer document in a future cycle; v2.0 includes it inline for self-containment.

---

## Convergence criteria

A Strategic Review run is complete when:

1. Every in-scope entity has a disposition (cluster + triage route)
2. Every new/updated Initiative declares Tele alignment + scope + anti-goals
3. Reverse-gaps named (Teles without Initiatives; orphan Ideas surfaced)
4. Per-run anti-goals captured with rationale
5. Director-ratified

Deep mode adds: all 4 phase artifacts ratified per v1.0 phase convergence; cross-linked.

---

## Skill packaging (future)

This methodology is designed to mechanise into a `/strategic-review` skill (modelled on the Survey skill per `idea-survey.md`). Skill responsibilities:

- Accept `scope` parameter (multi-filter)
- Accept `mode` parameter (`quick` / `standard` / `deep`)
- Execute the workflow sub-steps with manual fallbacks where substrate gaps remain
- Produce the per-run artifact in `docs/reviews/` per the shape above
- Surface Director ratification touchpoint(s)

Skill landing is gated on this methodology being stable + the substrate dependencies progressing enough for the autonomy-target queries to start replacing manual fallbacks. v2.0 of the methodology is the spec; the skill is its mechanisation.

---

## Anti-patterns

- **Review as backlog dump** — listing entities with no clustering or ranking
- **Review as design session** — drafting implementations mid-review rather than naming Initiatives
- **Skipping friction-surface** — jumping from inventory to prioritisation loses the reality-check step
- **Unbounded sub-steps** — no convergence criteria means runs never close
- **Concept proliferation** — naming every bug-cluster a "Concept" dilutes vocabulary; Concepts are *structural*, Defects are *symptomatic*
- **Missing anti-goals** — without explicit deferrals, the run's consensus gets re-litigated next time
- **Mission production inside SR** — Designs + Mission briefs are downstream (Survey + Design phases); SR produces Initiatives, not Designs
- **Per-entity tool-surface in Initiative output** — defer per `feedback_defer_tool_surface_to_idea_121`; use verb-tool with `kind: Initiative` (or umbrella-Idea proxy today)
- **Architect-autonomy claim without graph substrate** — until idea-151 + lineage-capture land, autonomy is aspirational; the methodology spec is correct but execution remains co-driven

---

## Provenance

- **v1.0** authored 2026-04-21 by architect; mission-30 (M-Ideas-Audit) was its first execution. Filed as heavy planning event.
- **v1.0 → v2.0 reframe** discussed 2026-05-23 between Director + architect (lily). Triggering insight: the Threads v3 cartography arc (PRs #256-#260) ran v1.0 as Deep-mode informally and surfaced multiple structural gaps:
  - Phase 1 "facts only" framing is aspirational; clustering IS interpretation
  - Phase 4 was composition, not draft-and-critique (2026-04 retrospective-lite Delta 4)
  - Daily-runnable cadence was structurally impossible under v1.0's 6-step × 4-phase protocol
  - Output type was misnamed: "mission briefs" are Designs (downstream); SR's true output is the *Initiative* tier
  - Architect-autonomy intent was implicit; methodology should be designed at the autonomy target
- **Entity-model derivation** (Director-led, architect-validated 2026-05-23):
  - Initiative as first-class Tier-1 entity, peer of Tele (axis-vs-vector)
  - Concept + Defect as Tier-2 class-layer peers (orthogonal to instance chain)
  - M-N cardinality across cross-tier relations (cross-leverage as prioritisation signal)
  - Initiative + Concept + Defect promote ship-all-together (substrate-extension)
- **Autonomy intent** (Director-articulated 2026-05-23): with robust entity relationships + formalised SR process + Class-Tier entities, the architect can autonomously learn, triage, and propose Initiatives + critical-path items.
- **2026-04 retrospective-lite deltas** (`docs/reviews/2026-04-retrospective-lite.md`) — most absorbed structurally by the v2.0 reframe; non-overlapping items (convergence bounds, amendment protocol) carried forward into the workflow shape.

### Carried forward from v1.0

- Tele-leverage scoring (now formalised as per-Initiative declared field)
- Reverse-gap concept (now structural in §Tier 1 + §sub-step 7)
- Partial-scope guardrails (now generalised as multi-dimensional scope filtering)
- Cold-start handover pattern (preserved; skill packaging will mechanise the checklist)
- Idea Triage Protocol (preserved inline; candidate for promotion to peer doc)
- Anti-patterns (selected; updated to v2.0 framing)

### Superseded from v1.0

- 4-phase mandatory decomposition (now Deep-mode only)
- 6-step Director-first critique protocol per phase (now per-run for Standard/Quick)
- "Output = 3-5 ratified mission briefs" (now Initiatives, not briefs)
- "Phase 1 facts only" framing (clustering IS interpretation; Phase 1 produces an interpreted cartography)
- Phase 3 "concepts/defects as document-form proxies" framing (now class-layer extraction is emergent + occasional; doc-proxies remain transitional)

### Next

- The first Standard-mode SR run of this v2.0 will be the Threads v3 cartography's downstream prioritisation pass (using the existing cartography v1.1 + companion v1.1 as Phase-1-equivalent inputs).
- The first SR runs surface the substrate-extension Initiatives (idea-121 + idea-126 + idea-151 + Class-Tier promotion) on the critical path; autonomy progressively activates as each lands.
- A formal retrospective fires after the first Standard-mode SR ships its first downstream mission.
