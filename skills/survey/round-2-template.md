# Round 2 — Question framing template

**Methodology source:** `docs/methodology/idea-survey.md` v1.0 §4
**Goal:** maximize degrees of freedom informing Design phase. Round 2 is **architect's choice on question type** — refine deeper / clarify ambiguity / anchor new dimension / mix.

---

## Architect prompt

Per `idea-survey.md` v1.0 §4 Step 1: design 3 Round-2 questions informed by Round-1 picks + interpretations. Apply the same orthogonality + pick-list discipline as Round 1 (per `round-1-template.md`).

## Round-2 strategy (per `idea-survey.md` §4 table)

| Round-1 outcome | Round-2 strategy |
|---|---|
| Cleanly confirmed all 3 dimensions | Refine deeper (drill into HOW); OR explore new dimension if one emerged |
| Left ambiguity on some dimensions | Clarify ambiguous picks (resolve before Design) |
| Cleanly confirmed some + ambiguity others | Mix: refine confirmed + clarify ambiguous |
| Surfaced contradictory multi-pick | Round 2 is clarification candidate (per §7 carry-forward discipline) |

Pick the strategy fitting Round-1 outcome before designing the questions.

## Round-1 context to load

When designing Round-2 questions, carry forward (per `idea-survey.md` §4 Step 4 multi-dim context table):

- **Original Idea description** (carry forward; same anchor as Round 1)
- **Round-1 responses + interpretations** (Round-2 builds on Round-1; the per-question Q1/Q2/Q3 interpretations narrow the intent space Round-2 questions probe)
- **This round's tele mapping** (Round-2 may surface different tele weight than Round-1; refresh per round; anti-tele-drift discipline per §9 step 6)
- **Aggregate Round-1 surface** (other Round-2 picks contextualize this question — Sudoku-style propagation)

## Refinement heuristics

- **Refinement-orthogonality** — Round-2 questions should probe NEW intent surfaces (concretizing implications of Round-1 picks), not re-probe Round-1 dimensions.
- **Concretization preference** — if Round-1 anchored WHY/WHO/HOW-cadence, Round-2 typically concretizes WHAT/WHERE/WHEN-mechanism.
- **Clarification framing** — when probing an ambiguous Round-1 pick, structure the Round-2 question to disambiguate the constraint set rather than re-asking the original question.
- **Constraint-envelope framing** — if Round-1 surfaced contradictory multi-pick, Round-2 question can either (a) directly probe disambiguation OR (b) carry the constraint envelope as a Design-phase anchor (per `idea-survey.md` §7).

## Standard question shape

Same as Round-1 (per `round-1-template.md` § Standard question shape).

## Tele-alignment refresh

Per-round mapping is required by `idea-survey.md` §9 step 5 + §15 schema. Refresh based on Round-1 outcome:

| Q | Round-2 primary tele anchor | Round-2 secondary tele anchor | Delta vs Round-1 |
|---|---|---|---|
| Q4 | tele-? | tele-? | <new / shifted / stable> |
| Q5 | tele-? | tele-? | <new / shifted / stable> |
| Q6 | tele-? | tele-? | <new / shifted / stable> |

---

## Output destination

Architect synthesizes Round-2 questions for Director chat, captures picks back into the in-flight envelope artifact at `docs/surveys/<mission>-survey.md` §2 Round 2 picks. Per-question 1-2 paragraph interpretations land as required sub-sections per `idea-survey.md` §15 Artifact schema. After Round-2 capture, prompt architect for the calibration data point (per `idea-survey.md` §5 + §15 schema; required envelope element).
