---
mission-name: M-<name>
source-idea: idea-<N>
methodology-source: docs/methodology/idea-survey.md v1.0
director-picks:
  round-1:
    Q1: <a|b|c|d>
    Q1-rationale: <optional brief rationale>
    Q2: <a|b|c|d>
    Q2-rationale: <optional>
    Q3: <a|b|c|d>
    Q3-rationale: <optional>
  round-2:
    Q4: <a|b|c|d>
    Q4-rationale: <optional>
    Q5: <a|b|c|d>
    Q5-rationale: <optional>
    Q6: <a|b|c|d>
    Q6-rationale: <optional>
mission-class: <one of: spike | substrate-introduction | pre-substrate-cleanup | structural-inflection | coordination-primitive-shipment | saga-substrate-completion | substrate-cleanup-wave | distribution-packaging>
tele-alignment:
  primary: [tele-N, tele-M]
  secondary: [tele-X, tele-Y]
  round-1:
    primary: [tele-N]
    secondary: [tele-X]
  round-2:
    primary: [tele-N]
    secondary: [tele-X]
anti-goals-count: <N>
architect-flags-count: <N>
skill-meta:
  skill-version: survey-v1.0
  tier-1-status: implemented
  tier-2-status: stubbed
  tier-3-status: stubbed
calibration-data:
  director-time-cost-minutes: <integer>
  comparison-baseline: <ref e.g. mission-XX or "prior-methodology-walkthrough">
  notes: <free text observation; methodology-evolution candidates; novel constraint surfaces>
contradictory-constraints:
  # Optional; required when contradictory multi-pick detected per idea-survey.md §7
  # - round: 1
  #   questions: [Q-2]
  #   picks: [a, c]
  #   constraint-envelope: <description of common-satisfiable constraint Director is signaling>
calibration-cross-refs:
  closures-applied: []
  candidates-surfaced: []
---

# M-<name> — Phase 3 Survey envelope

**Methodology:** `docs/methodology/idea-survey.md` v1.0 (3+3 Director-intent pick-list)
**Source idea:** idea-<N>
**Mission-class candidate:** <substrate-introduction | spike | etc.>
**Branch:** `agent-<role>/<idea-or-mission-handle>` (push pre-bilateral round-1 audit per calibration #59 closure mechanism (a))

---

## §0 Context

<1-2 paragraphs: idea provenance + cross-mission context + methodology-anchor reference. Cite source idea + any composable umbrella ideas.>

---

## §1 Round 1 picks

| Q | Pick | Director-intent reading (1-line summary) |
|---|---|---|
| Q1 — <axis title> | **<letter>** <option label> | <brief reading> |
| Q2 — <axis title> | **<letter>** <option label> | <brief reading> |
| Q3 — <axis title> | **<letter>** <option label> | <brief reading> |

### §1.Q1 — Per-question interpretation

<1-2 paragraphs per `idea-survey.md` §3 Step 4: cite Original-Idea + Tele-mapping (round-1 mapping from frontmatter) + Aggregate-Surface as context dimensions. State the matrix-solve hypothesis: *"given the aggregate picks + original Idea + tele framework, here's what Q1 most likely means."*>

### §1.Q2 — Per-question interpretation

<1-2 paragraphs same shape as §1.Q1.>

### §1.Q3 — Per-question interpretation

<1-2 paragraphs same shape as §1.Q1.>

**Round-1 composite read** (1-2 sentences; per `idea-survey.md` §3 Step 3): <aggregate read of all 3 picks; cross-question coherence check per §3 Step 4 closing; if any tension surfaces, flag as Round-2 clarification candidate.>

---

## §2 Round 2 picks

| Q | Pick | Director-intent reading (1-line summary) |
|---|---|---|
| Q4 — <axis title> | **<letter>** <option label> | <brief reading> |
| Q5 — <axis title> | **<letter>** <option label> | <brief reading> |
| Q6 — <axis title> | **<letter>** <option label> | <brief reading> |

### §2.Q4 — Per-question interpretation

<1-2 paragraphs per `idea-survey.md` §4 Step 4 multi-dim context: Original Idea + Round-1 responses + interpretations + Round-2 tele mapping + aggregate Round-2 surface.>

### §2.Q5 — Per-question interpretation

<1-2 paragraphs same shape as §2.Q4.>

### §2.Q6 — Per-question interpretation

<1-2 paragraphs same shape as §2.Q4.>

**Round-2 composite read** (1-2 sentences): <same shape as Round-1 composite.>

---

## §3 Composite intent envelope

<1-3 paragraphs: the "solved matrix" — aggregate read across both rounds. State the mission's primary outcome + secondary outcomes + key design constraints surfaced. This is the load-bearing envelope Phase 4 Design v0.1 concretizes.>

---

## §4 Mission scope summary

| Axis | Bound |
|---|---|
| Mission name | M-<name> |
| Mission class | <one of 8 per `mission-lifecycle.md` §3 Mission-class taxonomy> |
| Substrate location | <path or scope reference> |
| Primary outcome | <1-line summary> |
| Secondary outcomes | <1-line summary> |
| Tele alignment (primary, whole-mission) | <tele-N, tele-M, ...> |
| Tele alignment (secondary, whole-mission) | <tele-X, tele-Y, ...> |
| Tele alignment (Round-1) | primary: <tele-N>; secondary: <tele-X> |
| Tele alignment (Round-2) | primary: <tele-N>; secondary: <tele-X> |

---

## §5 Anti-goals (out-of-scope; deferred)

| AG | Description | Composes-with target |
|---|---|---|
| AG-1 | <description> | <future idea / mission / N-th canonical precedent> |
| AG-2 | <description> | <target> |

---

## §6 Architect-flags / open questions for Phase 4 Design round-1 audit

Architect-flags batched for engineer's round-1 content-level audit (per mission-67 + mission-68 audit-rubric precedent: CRITICAL / MEDIUM / MINOR / PROBE classifications). Each flag carries an architect-recommendation to challenge.

| # | Flag | Architect-recommendation |
|---|---|---|
| F1 | <flag description> | <recommendation> |
| F2 | <flag description> | <recommendation> |

---

## §7 Sequencing / cross-mission considerations

### §7.1 Branch + PR strategy

<branch handle + PR cadence; cumulative-fold pattern per mission-68 M6 if applicable>

### §7.2 Composability with concurrent / pending work

<list of related ideas / missions / methodology docs and how they compose with this mission>

### §7.3 Same-day compressed-lifecycle candidate?

<compressed-lifecycle assessment per mission-67 + mission-68 precedent; risk-flag if scope-vs-precedent expansion warrants Director awareness at Phase 7>

---

## §calibration — Calibration data point

Per `idea-survey.md` §5 (Survey output element) + §15 schema. Captures empirical baseline for methodology-evolution loop per §13 Forward Implications.

- **Director time-cost (minutes):** <integer> (across both Survey rounds)
- **Comparison baseline:** <prior methodology reference OR prior Survey reference>
- **Notes:** <free text — methodology-evolution candidates; novel constraint surfaces; multi-pick observations>

---

## §contradictory — Contradictory multi-pick carry-forward

(Required per `idea-survey.md` §7 + §15 schema **only when contradictory multi-pick detected during architect interpretation**. Otherwise omit this section entirely.)

| Round | Question(s) | Picks | Constraint envelope description |
|---|---|---|---|
| <1\|2> | <Q-N, Q-M> | <letter, letter> | <description of common-satisfiable constraint Director is signaling per §7> |

---

## §8 Cross-references

- **`docs/methodology/idea-survey.md`** v1.0 — canonical Survey methodology (NOT modified by this mission per AG-9 IF applicable; spec-enrichment additions IS in-scope per AG-9 carve-out from mission-69)
- **`docs/methodology/strategic-review.md`** — Idea Triage Protocol (route-(a) skip-direct rationale if applicable)
- **`docs/calibrations.yaml`** — calibration ledger cross-refs (closures-applied + candidates-surfaced)
- **idea-<N>** — source idea
- **<related ideas / missions>**

---

— Architect: <name> / <YYYY-MM-DD> (Phase 3 Survey envelope; Director-ratified <N> picks across 2 rounds; <branch-pushed pre-bilateral round-1 audit per calibration #59 closure mechanism (a) — <N>th-canonical>)
