# Round 1 — Question framing template

**Methodology source:** `docs/methodology/idea-survey.md` v1.0 §3
**Goal:** anchor Director-intent along 3 orthogonal axes (HIGHEST-LEVEL — WHY/WHO/HOW-cadence dimensions). Director time-cost target: ~5 min for the full 6-question Survey across both rounds.

---

## Architect prompt

Design 3 orthogonal questions per `idea-survey.md` v1.0 §3 Step 1. Each question carries 3-4 pre-determined pick-list answers. Answers should be orthogonal (composable; multi-pick natural) where possible — improves refinement surface per §6 multi-pick rules.

## Question-design heuristics

- **Orthogonality** — each question partitions the intent space along a different dimension (avoid co-correlated axes; do NOT redundantly probe the same intent surface from two angles).
- **Brevity** — keep questions SHORT and SIMPLE; not jargon-heavy unless context warrants.
- **Multi-pick semantic** (per `idea-survey.md` §6):
  - Orthogonal answers (e.g., "(a) latency (b) observability (c) stuck-prevention (d) comprehensive") → multi-pick natural; each pick adds a constraint.
  - Mutually exclusive answers (e.g., "(a) per-role (b) per-mission-class (c) per-mission") → multi-pick contradictory; per §7 — NOT an error; signals constraint envelope to satisfy.
- **Round-1 dimension preference** — anchor the WHY/WHO/HOW-cadence highest-level intent. Save deeper HOW + clarification + refinement for Round 2.
- **Self-justification** — write architect-rationale per question (*"this question discriminates the intent space along axis X by partitioning into options A/B/C/D"*) so post-Survey audit can re-trace question intent.

## Standard question shape

```markdown
**Q-N — <axis title>:** <brief context paragraph; 1-2 sentences>

- (a) <option label>
- (b) <option label>
- (c) <option label>
- (d) <option label>
```

## Tele-alignment hint

Pre-anchor (per `idea-survey.md` §9 step 1): review original Idea description + relevant tele inventory; identify likely tele-weight before designing questions. Note primary + secondary tele candidates here so Round-1 interpretation step (§3 Step 4) can cite them and the anti-tele-drift check (§9 step 6) has a baseline.

| Q | Likely primary tele anchor | Likely secondary tele anchor |
|---|---|---|
| Q1 | tele-? | tele-? |
| Q2 | tele-? | tele-? |
| Q3 | tele-? | tele-? |

## Example shapes (links, not copies; per AG-9)

Reference Surveys for shape inspiration:

- `docs/surveys/m-mission-pulse-primitive-survey.md` (idea-206; first-canonical Survey execution)
- `docs/surveys/m-survey-process-as-skill-survey.md` (idea-228; this Skill's own Survey)
- Any other `docs/surveys/*-survey.md` ratified post-mission-67 onward

---

## Output destination

Architect synthesizes the questions into Director-chat format, sends to Director, captures picks back into the in-flight envelope artifact at `docs/surveys/<mission>-survey.md` §1 Round 1 picks. Per-question 1-2 paragraph interpretations land as required sub-sections per `idea-survey.md` §15 Artifact schema (the `validate-envelope.sh` enforcement contract).
