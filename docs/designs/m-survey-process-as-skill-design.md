# M-Survey-Process-as-Skill — Design v0.2

**Status:** v0.2 (architect-revised 2026-05-02; engineer round-1 audit 15 findings folded; pending engineer round-2 verify → v1.0)
**Methodology:** Phase 4 Design per `mission-lifecycle.md` v1.2 §1 (RACI: C=Director / R=Architect+Engineer)
**Survey envelope:** `docs/surveys/m-survey-process-as-skill-survey.md` (Director-ratified 6 picks; commit `ce5b6c1`)
**Source idea:** idea-228 M-Survey-Process-as-Skill (status `triaged` via route-(a) skip-direct)
**Companion umbrella:** idea-229 (Sovereign-Skill Pattern + Mission-Lifecycle-as-Skills Vision)
**Companion downstream:** idea-230 (claude-plugin install bootstrap; pending mission)
**Pre-mission Hub-side dependency:** bug-45 (Hub MCP tool surface lacks `get_idea`; in-flight cleanup absorption per mission-68 bug-43 precedent)
**Branch:** `agent-lily/idea-228` (Survey + Design v0.1 + this v0.2 cumulative; mission-68 M6 fold pattern)

---

## §0 Document orientation

Design v0.2 folds engineer round-1 audit findings (3 CRITICAL + 7 MEDIUM + 3 MINOR + 2 PROBE; thread-455 round 2). Reading order:
- §1 Mission scope summary (Survey envelope reference)
- §2 Skill body anatomy — `/skills/survey/` directory layout (revised per M6)
- §3 SKILL.md structure (frontmatter + invocation + status matrix + walk-through)
- §4 Helper script signatures + invocation pattern (Q4=d batched gates)
- §5 Tier-status matrix shape (Q5=c declarative)
- §6 Survey envelope artifact format (Q6=d YAML frontmatter; revised per M1+M2+M3+M4)
- §7 Tier-2/3 stub interface convention (parameterized; per M6)
- §8 Hub integration + error handling (retry-once-fall-through)
- §9 Mission-class default heuristic (enum enumerated per m2)
- §10 Test / verification strategy (grep-only per C3)
- §11 PR sequencing + content map (revised per M6 + M7; bug-45 dependency added)
- §12 Anti-goals + Phase-N revisit-axes (AG-7 cleanup + AG-9 carve-out)
- §13 Round-1 audit fold-summary
- §14 `idea-survey.md` §15 Artifact schema enrichment (NEW; per C2)
- §15 Compressed-lifecycle risk-flag (NEW; per m3)
- §16 Cross-references

---

## §1 Mission scope summary

Per Survey envelope §3 composite intent envelope (unchanged from v0.1):

| Axis | Bound |
|---|---|
| Mission scope | Sovereign Survey Skill at `/skills/survey/`; Q1=d full / Q2=d Tier 1 + stubs / Q3=a implicit / Q4=d batched / Q5=c declarative / Q6=d frontmatter |
| Mission class | substrate-introduction (third-canonical; first-canonical sovereign-Skill instance) |
| Tele alignment (primary) | tele-3 + tele-2 + tele-11 + tele-12 |

---

## §2 Skill body anatomy — `/skills/survey/` (revised per M6)

```
/skills/survey/                          # sovereign + git-tracked first-class repo entity
├── SKILL.md                             # frontmatter + invocation + status matrix + walk-through
├── round-1-template.md                  # round-1 question framing template (sketch in §3.5)
├── round-2-template.md                  # round-2 question framing template (sketch in §3.5)
├── envelope-template.md                 # Survey envelope template (frontmatter + prose; per §6)
└── scripts/
    ├── survey-init.sh                   # init gate: scaffold envelope at canonical location
    ├── validate-envelope.sh             # finalize gate: shape-check vs §14 schema
    ├── check-skip-criteria.sh           # check route-(a)/(b)/(c) per §M5 codification
    ├── format-pick-presentation.sh      # render Round-N questions in standard markdown shape
    ├── tier-stub.sh                     # parameterized Tier-2/3 stub (per M6 collapse)
    └── *.test.sh                        # bash test cases per script
```

**Per M6 collapse:** previously envisioned 10 separate stub scripts (5 dimensions × 2 tiers each) collapsed to single parameterized `tier-stub.sh --tier=<2|3> --dimension=<name>`. Reduces ~10 files → 1; preserves declarative posture per Q5=c.

Total file count: 5 main scripts + 4 templates/SKILL.md + 5 `.test.sh` files = ~14 files.

**Per AG-7 (no non-bash deps):** scripts are pure bash + standard POSIX utilities (sed, awk, grep). No python, no npm packages, no yq.

---

## §3 SKILL.md structure

### §3.1 Frontmatter (YAML; per F1 + P1 verified canonical Claude Code field)

```yaml
---
name: survey
version: v1.0
methodology-source: docs/methodology/idea-survey.md v1.0
description: Mechanizes Phase 3 Survey methodology (3+3 Director-intent pick-list + envelope assembly) per idea-survey.md v1.0
sovereign-skill-instance: first-canonical (idea-229 umbrella)
disable-model-invocation: true   # canonical Claude Code Skill field per https://code.claude.com/docs/en/skills.md#frontmatter-reference
---
```

**P1 resolution:** `disable-model-invocation: true` confirmed canonical Claude Code Skill frontmatter field via official docs reference. Field stays.

### §3.2 Invocation (NEW; per P2)

Architect invokes the Skill via:
- **`/survey <mission-name> <idea-id>`** — Claude Code slash-command invocation (canonical for user-triggered skills with `disable-model-invocation: true`)
- OR via `Skill` tool with `name: survey` (programmatic equivalent)

Skill is NOT auto-invoked; architect explicitly triggers at Phase 3 entry per `mission-lifecycle.md` §1 RACI (Phase 3: R=architect).

### §3.3 Top section — tier-status matrix (Q5=c declarative)

```markdown
## Sovereignty status

| Input dimension | Tier 1 (default; OIS network) | Tier 2 (override) | Tier 3 (manual fallback) |
|---|---|---|---|
| Tele framework | ✅ Hub `list_tele` query | ⏸ stub (exit-42 via tier-stub.sh) | ⏸ stub |
| Source idea | ✅ Hub `get_idea` (post bug-45 fix) | ⏸ stub | ⏸ stub |
| Output location | ✅ `docs/surveys/<mission>-survey.md` | ⏸ stub | ⏸ stub |
| Mission-class taxonomy | ✅ canonical enum (per §9) + heuristic | ⏸ stub | ⏸ stub |
| Methodology spec | ✅ ref `docs/methodology/idea-survey.md` v1.0 (incl. §15 schema per C2 fold) | ⏸ stub | ⏸ stub |
| Director-pick capture | ✅ Conversation (universal) | — | — |

**Sovereignty posture:** Tier-1 implemented + tested. Tier-2 + Tier-3 stubbed via parameterized `tier-stub.sh` (exit code 42 sentinel). External-network adoption asks trigger Tier-2/3 implementation work (idea-229 umbrella).
```

### §3.4 Walk-through sections (sequential prose)

5 phases per Q4=d batched-gate pattern (unchanged structure from v0.1; sub-step interpretation made explicit per M1):

1. **Init gate** — Skill calls `survey-init.sh --mission-name=<name> --idea-id=<id>`. Script: pulls idea via Hub `get_idea` (Tier 1; blocked until bug-45 lands); scaffolds envelope with frontmatter skeleton; reports scaffold path.

2. **Round-1 question design + dispatch** — Skill loads `round-1-template.md`; prompts architect to design 3 orthogonal questions; architect synthesizes for Director chat.

3. **Round-1 pick capture + per-question interpretation** (M1 fold) — architect reports Director picks back; **Skill prompts architect for 1-2 paragraph per-question interpretation** (Q1, Q2, Q3 each); interpretations land as required envelope sub-section per §6 (NOT compressed into one-line frontmatter rationales). Skill also prompts for round-1 tele-mapping (M4 fold; primary + secondary teles per round) + contradictory-multi-pick observation (M3 fold; if detected, capture as constraint envelope).

4. **Round-2 question design + dispatch** — Skill loads `round-2-template.md`; uses Round-1 picks + interpretations as context for refining Round-2 questions; same dispatch + capture rhythm.

5. **Round-2 pick capture + per-question interpretation** — same M1/M3/M4 pattern. Then prompts architect for **calibration data point** (M2 fold; Director time-cost minutes + comparison-baseline + notes).

6. **Finalize gate** — Skill calls `format-pick-presentation.sh && validate-envelope.sh`. Combined gate: format finalizes prose; validate checks against §14 Artifact schema. Architect reviews combined output; FAIL → re-run after fix.

### §3.5 Template content sketches (NEW; per m1 fold)

**`round-1-template.md`** (skeleton structure):
- Opening prompt ("Architect: design 3 orthogonal questions per `idea-survey.md` v1.0 §3 methodology")
- Question-design heuristics (orthogonality reminder; multi-pick semantic hint per `idea-survey.md` §6)
- Standard question shape: `Q-N — <axis title>: <brief context>; (a) <option> (b) <option> (c) <option> (d) <option>`
- Tele-alignment hint (which teles each question's axis tends to load)
- Example shape from mission-67 + mission-68 + this mission's Surveys

**`round-2-template.md`** (skeleton structure):
- Same as round-1 template + additional context-loading from Round-1 picks
- Refinement heuristics (orthogonal to Round-1; concretizes implications)

**`envelope-template.md`** (full structure):
- Frontmatter block (per §6.1; all fields with placeholders)
- Required prose sections per §6.2 (with placeholder text)

### §3.6 Closing section — pattern-establishment-via-implicit (Q3=a)

Brief cross-reference list (idea-228 + idea-229 + idea-230 + `docs/methodology/idea-survey.md`). No explicit "this is the canonical sovereign-Skill template" anchor block.

---

## §4 Helper script signatures + invocation pattern

### §4.1 Convention

Every helper script:
- Bash 4+ shebang (`#!/usr/bin/env bash`)
- `set -euo pipefail`
- Args parsed via `--key=value` form (consistent across scripts)
- stdout for human-readable progress; stderr for errors
- Exit codes: `0` success / `42` stub-not-implemented (Tier-2/3 sentinel) / `1` schema/auth failure / `2` route-(c) (per M5 fold for check-skip-criteria.sh) / non-zero other for failures

### §4.2 Script signatures (revised per C2 + M5 + M6)

```bash
# scripts/survey-init.sh — init gate
#   Usage: survey-init.sh --mission-name=M-<name> --idea-id=idea-<N>
#   Effects: Hub get_idea (Tier 1; blocked until bug-45 lands) → scaffold
#            docs/surveys/<mission>-survey.md with frontmatter skeleton + idea-context section
#   Exit: 0 success / 1 idea not found / 42 fall-through to tier-stub

# scripts/validate-envelope.sh — finalize gate
#   Usage: validate-envelope.sh --envelope-path=docs/surveys/<mission>-survey.md
#   Effects: parses frontmatter + prose; checks against §14 Artifact schema (the codified spec
#            being added to idea-survey.md as §15 per C2 AG-9 carve-out). Validates: required
#            frontmatter keys (per §6.1), required prose sections (per §6.2), pick-completeness
#            (all 6 letters present), per-question interpretations (per M1; non-empty), per-round
#            tele-mapping (per M4; primary + secondary), calibration data point (per M2; numeric
#            director-time-cost present), mission-class enum match (per §9), contradictory-
#            multi-pick capture (per M3; required when constraint detected during interpretation)
#   Exit: 0 valid / 1 schema violation (with diagnostic naming first failure) / 42 stub

# scripts/check-skip-criteria.sh — pre-Survey route-(a)/(b)/(c) check (M5 fold)
#   Usage: check-skip-criteria.sh --idea-id=idea-<N>
#   Effects: pulls idea via Hub get_idea (Tier 1; bug-45-blocked); walks 5 skip-criteria from
#            strategic-review.md §Idea Triage Protocol; reports per-criterion result + suggested route
#   Exit:
#     0 = (a) skip-direct (all 5 criteria met)
#     1 = (b) triage-thread (criterion-1 contest detected; bilateral negotiation needed)
#     2 = (c) Strategic Review queue (criterion-5 dependency-readiness or scope-flex needed)
#     42 = stub (Tier-2/3 dispatch path)

# scripts/format-pick-presentation.sh — render Round-N questions
#   Usage: format-pick-presentation.sh --round=1|2 --questions-file=<path>
#   Effects: reads question definitions; renders standard markdown shape
#            (Q-N title + brief context + 3-4 picks labeled (a)/(b)/(c)/(d))
#   Exit: 0 success / 1 malformed input / 42 stub

# scripts/tier-stub.sh — parameterized Tier-2/3 stub (M6 collapse)
#   Usage: tier-stub.sh --tier=<2|3> --dimension=<tele|idea|output|mission-class|methodology>
#   Effects: emits stub message to stderr identifying tier + dimension + linking to idea-228
#   Exit: 42 (always; sentinel for "stub not implemented")
```

### §4.3 Invocation pattern (Q4=d batched gates; unchanged from v0.1)

Two structured gates: **init** (one Bash call) + **finalize** (one combined Bash call). Question-design + pick-capture + interpretation phases between gates are conversational.

### §4.4 Bash tool permission allowlist (M7 fold)

Per M7 audit fold, ship a small SKILL.md "## Install" section (not a separate file; just prose) that pastes the install snippet:

```markdown
## Install (interim; pre-idea-230 automation)

After symlinking `.claude/skills/survey -> /skills/survey`, add to `.claude/settings.local.json`:

\`\`\`json
{
  "permissions": {
    "allow": [
      "Bash(skills/survey/scripts/survey-init.sh:*)",
      "Bash(skills/survey/scripts/validate-envelope.sh:*)",
      "Bash(skills/survey/scripts/check-skip-criteria.sh:*)",
      "Bash(skills/survey/scripts/format-pick-presentation.sh:*)",
      "Bash(skills/survey/scripts/tier-stub.sh:*)"
    ]
  }
}
\`\`\`

This eliminates the per-script permission prompts at gate invocations. idea-230 (claude-plugin install bootstrap) automates this future-mission.
```

---

## §5 Tier-status matrix shape (Q5=c declarative; codified in §3.3)

Markdown table per F4 architect-flag recommendation. Status icons: ✅ (implemented) / ⏸ (stub) / — (N/A). Posture-paragraph below table summarizes sovereignty stance.

---

## §6 Survey envelope artifact format (Q6=d YAML frontmatter; revised per M1+M2+M3+M4)

### §6.1 Frontmatter shape (extended per all 4 MEDIUM folds)

```yaml
---
mission-name: M-<name>
source-idea: idea-<N>
methodology-source: docs/methodology/idea-survey.md v1.0
director-picks:
  round-1:
    Q1: <letter>
    Q1-rationale: <optional brief>
    Q2: <letter>
    Q2-rationale: <optional>
    Q3: <letter>
    Q3-rationale: <optional>
  round-2:
    Q4: <letter>
    Q4-rationale: <optional>
    Q5: <letter>
    Q5-rationale: <optional>
    Q6: <letter>
    Q6-rationale: <optional>
mission-class: substrate-introduction | spike | structural-inflection | distribution-packaging | coordination-primitive-shipment | pre-substrate-cleanup | substrate-cleanup-wave | saga-substrate-completion
tele-alignment:
  # M4 fold: per-round mapping required (anti-tele-drift discipline per idea-survey.md §3 step 4 + §4 step 4 + §9 step 6)
  primary: [tele-N, tele-M, ...]    # whole-mission rollup
  secondary: [tele-X, tele-Y, ...]  # whole-mission rollup
  round-1:
    primary: [tele-N, ...]
    secondary: [tele-X, ...]
  round-2:
    primary: [tele-N, ...]
    secondary: [tele-X, ...]
anti-goals-count: <N>
architect-flags-count: <N>
skill-meta:
  skill-version: survey-v1.0
  tier-1-status: implemented
  tier-2-status: stubbed
  tier-3-status: stubbed
calibration-data:                    # M2 fold: required per idea-survey.md §5
  director-time-cost-minutes: <n>
  comparison-baseline: <prior-methodology-or-mission-name>
  notes: <free text>
contradictory-constraints:           # M3 fold: optional; required when detected
  - round: 1|2
    questions: [Q-N, Q-M]
    picks: [<letter>, <letter>]
    constraint-envelope: <description>
calibration-cross-refs:
  closures-applied: [#59-3rd-canonical, ...]
  candidates-surfaced: []
---

# M-<name> — Phase 3 Survey envelope

(prose body follows; canonical shape preserved from mission-67 + mission-68 envelopes; required sections per §6.2)
```

### §6.2 Validation rules (encoded in `validate-envelope.sh`; per §14 schema)

**Frontmatter required keys** (per `idea-survey.md` §15 enrichment per C2):
- `mission-name`, `source-idea`, `methodology-source`, `director-picks` (with all 6 picks present), `mission-class` (enum match), `tele-alignment` (with per-round + whole-mission), `skill-meta`, `calibration-data` (M2 required)
- Optional: `contradictory-constraints` (M3 — required when detected during architect-interpretation)

**Prose required sections** (per `idea-survey.md` §15 enrichment per C2; matches mission-67 + mission-68 + this mission's envelope shape; M1 fold adds per-question interpretation sub-sections):
- §0 Context
- §1 Round 1 picks + **per-question interpretations** (M1 — Q1/Q2/Q3 each with 1-2 paragraph interpretation)
- §2 Round 2 picks + **per-question interpretations** (M1 — Q4/Q5/Q6 each with 1-2 paragraph interpretation)
- §3 Composite intent envelope
- §4 Mission scope summary (with per-round tele-mapping per M4)
- §5 Anti-goals
- §6 Architect-flags / open questions for Phase 4 audit
- §7 Sequencing / cross-mission considerations
- §calibration Calibration data point (M2 — Director time-cost + comparison-baseline + notes)
- §contradictory (M3 — only when constraint detected; otherwise omit)
- §8 Cross-references

---

## §7 Tier-2/3 stub interface convention (parameterized; per M6)

Single `scripts/tier-stub.sh --tier=<2|3> --dimension=<name>` script returns exit 42 with stderr message:

```bash
#!/usr/bin/env bash
# scripts/tier-stub.sh — parameterized Tier-2/3 stub (M6 fold)
# Tier-2 + Tier-3 paths for all 5 input dimensions are stubbed via this single script.
# Status declared in SKILL.md tier-status matrix (per Q5=c declarative discipline).
# Tracking: idea-228 (this mission), idea-229 (umbrella), idea-230 (consumer-install).

set -euo pipefail
TIER=
DIMENSION=
for arg in "$@"; do
  case "$arg" in
    --tier=*) TIER="${arg#*=}" ;;
    --dimension=*) DIMENSION="${arg#*=}" ;;
  esac
done

echo "[tier-stub] STUB: Tier-${TIER} path for dimension=${DIMENSION} not implemented" >&2
echo "[tier-stub] Falling through to next tier (caller should retry or fall to Tier-3)" >&2
exit 42
```

Skill prose at gate boundaries: detect exit 42 → fall through to next tier OR final fallback (manual prompt). M5 fold's exit codes for `check-skip-criteria.sh` distinguish 0/1/2/42 routes.

---

## §8 Hub integration + error handling (F5)

### §8.1 Hub MCP tool calls

Skill instructs Claude to invoke MCP tools directly (Skill prose says "use the `list_tele` tool to fetch the current tele framework"). Claude executes the call; results return to Skill flow.

Mapped Hub tools:
- `list_tele` — Tier-1 source for tele framework
- `get_idea` — Tier-1 source for source-idea text + tags + cross-refs (**post bug-45 fix; blocks until that lands**)
- `list_missions` (filter status=proposed) — for mission-class default heuristic context (§9)
- `update_idea` — for status flips (mission-69 architect-side; outside Skill scope but cited)

### §8.2 Error handling pattern (retry-once-fall-through; F5)

```
attempt: Tier-1 (Hub MCP tool call)
   ├── success → continue with retrieved data
   ├── transient error (network blip, 5xx) → retry once
   │      ├── retry succeeds → continue
   │      └── retry fails → call tier-stub.sh --tier=2 → exit 42 → call tier-stub.sh --tier=3 → exit 42
   │                          → final fallback: prompt architect for input manually in chat
   └── hard error (auth, not-found) → fall through to Tier-2 → ... → Tier-3 → manual prompt
```

Defensive default; degrades gracefully; avoids hard-failure on Hub blips.

---

## §9 Mission-class default heuristic (F6; enum enumerated per m2)

### §9.1 Canonical enum (per m2 fold)

8 values per `create_mission` Hub schema (verified):
- `spike`
- `substrate-introduction`
- `pre-substrate-cleanup`
- `structural-inflection`
- `coordination-primitive-shipment`
- `saga-substrate-completion`
- `substrate-cleanup-wave`
- `distribution-packaging`

### §9.2 Heuristic

Skill suggests a mission-class for the new mission entity creation phase. Heuristic:

1. Scan source-idea text + tags for sovereign-Skill keywords (`/skills/`, `sovereign`, `substrate`, `tier-N`, `SKILL.md`) → suggest **substrate-introduction**
2. Scan for spike-keywords (`spike`, `prototype`, `proof-of-concept`, `time-bounded`) → suggest **spike**
3. Scan for cleanup-keywords (`cleanup`, `consolidation`, `migrate`, `deprecate`) → suggest **substrate-cleanup-wave** OR **pre-substrate-cleanup**
4. Scan for primitive-keywords (`primitive`, `coordination`, `pulse`, `event`, `routing`) → suggest **coordination-primitive-shipment**
5. Default fallback → prompt architect with full canonical enum (per §9.1)

If multiple matches: present matched candidates to architect; architect picks. If no match: prompt architect with full enum.

---

## §10 Test / verification strategy (revised per C3)

### §10.1 Helper script tests

Each `scripts/*.sh` has a sibling `scripts/<name>.test.sh` with bash test cases:
- Happy path (Tier-1 success)
- Tier-1 failure → tier-stub Tier-2 returns 42 → tier-stub Tier-3 returns 42 → expected fallback behavior
- Malformed input → exit 1 with diagnostic
- shellcheck clean

### §10.2 SKILL.md verification (per C3 fold; grep-only; AG-7 clean)

`shellcheck` clean across all `scripts/*.sh`. SKILL.md frontmatter validated via grep-based smoke check (presence of required `name` + `version` + `methodology-source` + `disable-model-invocation` keys). NO yq, NO python — AG-7 clean.

```bash
# scripts/validate-skill-frontmatter.sh (smoke; grep-based per AG-7)
grep -q "^name:" SKILL.md || { echo "missing name"; exit 1; }
grep -q "^version:" SKILL.md || { echo "missing version"; exit 1; }
# ... etc
```

### §10.3 End-to-end smoke (post-merge)

Architect manually invokes the Skill on a synthetic test-idea + verifies envelope artifact produced is well-formed. Full real-mission verification deferred to next mission's actual Phase 3 Survey use (which becomes the canonical first-real-use of the Skill).

### §10.4 No CI test gate added

Helper-script tests + shellcheck run locally + at developer discretion. Not added as required-status-check on the PR (would add CI surface for marginal value at this scope; methodology cost > methodology benefit at first-canonical-instance scope). Future-mission can promote tests to CI if Skill churn justifies.

---

## §11 PR sequencing + content map (revised per M6 + M7 + bug-45 dependency)

### §11.1 Pre-mission Hub-side dependency: bug-45 PR (NEW; per C1 fold)

bug-45 (Hub MCP tool surface lacks `get_idea`) is a substrate gap blocking mission-69 W1's Tier-1 init-gate. Per mission-68 bug-43 precedent (in-flight cleanup absorption during a substrate-introduction mission):

```
PR #TBD-bug-45 — Hub-side substrate fix (~15 lines)
- hub/src/policy/<idea-policy.ts or equivalent>: add get_idea cascade-handler
- MCP tool registration: get_idea
- hub/test/unit/<test>: add unit test mirroring sister-tool tests (get_bug, get_task, etc.)
- Pass 10 rebuild required (Hub-source change)
- Single-PR; ~15 lines; bilateral cross-approval
- Lands BEFORE mission-69 W1 PR (which depends on get_idea being available)
```

### §11.2 Mission-69 W1 — single PR (per F7 + revised file-count per M6)

```
PR #TBD-mission-69-W1 — single ship (post bug-45 + Pass 10 rebuild)
- /skills/survey/SKILL.md
- /skills/survey/round-1-template.md
- /skills/survey/round-2-template.md
- /skills/survey/envelope-template.md
- /skills/survey/scripts/survey-init.sh
- /skills/survey/scripts/validate-envelope.sh
- /skills/survey/scripts/check-skip-criteria.sh
- /skills/survey/scripts/format-pick-presentation.sh
- /skills/survey/scripts/tier-stub.sh                  # parameterized per M6
- /skills/survey/scripts/validate-skill-frontmatter.sh # per C3 grep-only
- /skills/survey/scripts/*.test.sh files (~5 bash test cases)
- docs/methodology/idea-survey.md §15 Artifact schema (NEW; per C2 AG-9 carve-out)
- docs/surveys/m-survey-process-as-skill-survey.md (already pushed; carries forward)
- docs/designs/m-survey-process-as-skill-design.md v1.x (post-bilateral; this Design lands)

Total estimated file count: ~14-18 files (revised from v0.1 ~15-20; M6 collapse offsets some additions)
Branch: agent-lily/idea-228 (cumulative; mission-68 M6 fold pattern)
Cross-approval: bilateral architect-engineer per multi-agent-pr-workflow.md v1.0
NO Pass 10 rebuild required (Skill is /skills/ content + bash; not Hub-source)
```

### §11.3 Approval gate

Per memory `feedback_thread_vs_github_approval_decoupled.md`: thread-side approval ≠ GitHub-side approval. Both required.

### §11.4 No Pass 10 rebuild required for mission-69 W1

Skill body is `/skills/` content + bash scripts. NOT Hub-source code. **Hub container does not need rebuild for mission-69 W1.** PR landing means main has the new files; architect's session can immediately use the Skill (after manual symlink interim).

bug-45 PR DOES require Pass 10 rebuild (Hub-source change). Sequence: bug-45 PR merge → Pass 10 rebuild + Hub restart → mission-69 W1 PR merge.

---

## §12 Anti-goals + Phase-N revisit-axes (revised per C2 + C3)

### §12.1 Anti-goals (carried forward from Survey envelope §5; revised AG-7 + AG-9)

| AG | Reviewer test | Composes-with target |
|---|---|---|
| AG-1 | No `.claude/skills/survey/` dir or symlink in repo | idea-230 |
| AG-2 | No `docs/methodology/sovereign-skills.md` codification | 2nd-canonical-instance precedent |
| AG-3 | Tier-2/3 functions are stubs only (parameterized tier-stub.sh; exit 42); not implemented | On-demand future work |
| AG-4 | Skill never writes to `docs/calibrations.yaml` (read-only cross-ref only) | Calibration discipline |
| AG-5 | No mechanization of other phases | Separate sovereign-Skill missions |
| AG-6 | No per-RACI Skill loading enforcement | idea-229 + idea-230 |
| **AG-7** (revised C3) | **Zero non-bash deps in Skill runtime AND verification** (no python, no yq, no npm; grep-only fallback for SKILL.md validation per §10.2) | Bash-only ratification |
| AG-8 | No bridge/webhook/polling-substrate changes | Orthogonal scope |
| **AG-9** (revised C2) | `docs/methodology/idea-survey.md` semantic methodology unchanged. **Carve-out:** spec-enrichment additions (NEW §15 Artifact schema codifying the validate-envelope.sh enforcement contract) ARE in-scope; methodology-semantic-evolution is NOT. | Spec-enrichment ≠ methodology-semantic-evolution; mirror of mission-67 + mission-68 in-flight methodology updates pattern |

### §12.2 Phase-N revisit-axes

| Axis | Trigger to revisit |
|---|---|
| Tier-2/3 implementation | First external-network adoption ask OR internal need (test env, mock Hub) |
| Methodology codification (`sovereign-skills.md`) | After 2nd-canonical sovereign-Skill instance ships |
| Per-RACI Skill loading enforcement | When idea-230 ships AND multiple Skills exist |
| Survey methodology version pinning | When `idea-survey.md` v1.x bumps; Skill `methodology-source` frontmatter mismatch warning |
| Frontmatter parsing tooling | If/when downstream tools need to consume Survey artifact metadata |
| CI test gate promotion | If Skill churn justifies (e.g., 3+ change PRs surface CI value) |
| §15 Artifact schema spec evolution | When envelope shape evolves (e.g., 4th-round Surveys, role-extended picks); AG-9 carve-out preserves methodology-doc-as-source-of-truth |

---

## §13 Round-1 audit fold-summary (NEW; engineer round-1 → v0.2 trace)

15 audit findings folded; engineer recommendations adopted with one negotiated tradeoff (M7 ships SKILL.md install snippet as recommended).

| # | Finding | Severity | Architect fold |
|---|---|---|---|
| C1 | `get_idea` Hub tool gap | CRITICAL | Filed bug-45 (~15-line Hub fix); mission-69 W1 depends on bug-45 PR landing first; Pass 10 rebuild between bug-45 + mission-69 W1 |
| C2 | `validate-envelope.sh` schema citation honesty | CRITICAL | AG-9 carve-out: NEW `idea-survey.md` §15 Artifact schema enrichment IS in-scope; methodology-semantic-evolution OUT of scope; codified in Design §14 |
| C3 | AG-7 vs §10.2 contradiction | CRITICAL | AG-7 strengthened: zero non-bash deps in runtime AND verification; §10.2 grep-only path; yq/python paths dropped |
| M1 | Per-question architect interpretations missing | MEDIUM | Required §6.2 prose sub-sections (§1.Q1 / §1.Q2 / §1.Q3 / §2.Q4 / §2.Q5 / §2.Q6) with 1-2 paragraph each; validator enforces non-empty |
| M2 | Calibration data point not captured | MEDIUM | NEW frontmatter field `calibration-data` + required §calibration prose section; validator enforces |
| M3 | Contradictory-multi-pick constraints carry-forward | MEDIUM | Optional frontmatter `contradictory-constraints` array + §contradictory prose section (required when detected) |
| M4 | Per-round tele-mapping not captured | MEDIUM | Extended frontmatter `tele-alignment.round-1` + `.round-2` + whole-mission rollup; validator enforces all three |
| M5 | check-skip-criteria.sh exit codes lump (b)+(c) | MEDIUM | Exit codes 0/1/2/42 distinguish (a)/(b)/(c)/stub routes per Idea Triage Protocol |
| M6 | Stub-script proliferation | MEDIUM | Collapsed 10 stubs → single parameterized `tier-stub.sh`; preserves declarative posture per Q5=c |
| M7 | F2 Bash-tool permission friction unmitigated | MEDIUM | Ship SKILL.md "## Install" section with `.claude/settings.local.json` snippet (architect-side prose; user pastes into their settings) |
| m1 | Templates content under-specified | MINOR | NEW §3.5 sketches each template's structure |
| m2 | Mission-class enum hand-wavy | MINOR | NEW §9.1 enumerates full canonical 8-value enum per Hub `create_mission` schema |
| m3 | Compressed-lifecycle scope-vs-precedent risk-flag missing | MINOR | NEW §15 risk-flag for Director awareness at Phase 7 |
| P1 | `disable-model-invocation: true` field verification | PROBE | VERIFIED canonical via official docs (https://code.claude.com/docs/en/skills.md#frontmatter-reference); cite added at §3.1 |
| P2 | Skill auto-loading discipline / invocation timing | PROBE | NEW §3.2 Invocation subsection; documents `/survey <args>` slash-command + Skill-tool-call equivalents |

---

## §14 `idea-survey.md` §15 Artifact schema enrichment (NEW; per C2 fold)

**Scope:** add §15 "Artifact schema" to `docs/methodology/idea-survey.md` codifying what `validate-envelope.sh` enforces. Per AG-9 revised carve-out: spec-enrichment (NEW §15 schema) IS in-scope; methodology-semantic-evolution OUT of scope.

**Content of §15:**

```markdown
## §15 Artifact schema (codified validate-envelope.sh enforcement contract)

Survey envelope artifacts written to `docs/surveys/<mission>-survey.md` SHALL conform to the following schema (codified version of the spec-emergent shape from mission-67 + mission-68 + onward; first-canonical mechanization via mission-69 Survey Skill `validate-envelope.sh`):

### Frontmatter (YAML; required keys)

- `mission-name: M-<name>`
- `source-idea: idea-<N>`
- `methodology-source: docs/methodology/idea-survey.md v<X.Y>`
- `director-picks: { round-1: { Q1, Q1-rationale?, Q2, Q2-rationale?, Q3, Q3-rationale? }, round-2: { Q4, Q4-rationale?, Q5, Q5-rationale?, Q6, Q6-rationale? } }` (all 6 picks required; rationale optional)
- `mission-class: <one of: spike | substrate-introduction | pre-substrate-cleanup | structural-inflection | coordination-primitive-shipment | saga-substrate-completion | substrate-cleanup-wave | distribution-packaging>`
- `tele-alignment: { primary: [tele-N, ...], secondary: [tele-X, ...], round-1: { primary, secondary }, round-2: { primary, secondary } }` (whole-mission + per-round both required)
- `calibration-data: { director-time-cost-minutes: <n>, comparison-baseline: <ref>, notes: <free text> }` (required)
- `contradictory-constraints: [...]` (optional; required when constraint detected)
- `skill-meta: { skill-version: <ref>, tier-1-status, tier-2-status, tier-3-status }` (required when Skill-mediated)
- `calibration-cross-refs: { closures-applied: [...], candidates-surfaced: [...] }` (required; arrays may be empty)

### Prose body (required sections)

- §0 Context
- §1 Round 1 picks + per-question interpretations (Q1/Q2/Q3 each with 1-2 paragraph)
- §2 Round 2 picks + per-question interpretations (Q4/Q5/Q6 each with 1-2 paragraph)
- §3 Composite intent envelope
- §4 Mission scope summary (with per-round tele-mapping)
- §5 Anti-goals
- §6 Architect-flags / open questions for Phase 4 audit
- §7 Sequencing / cross-mission considerations
- §calibration Calibration data point
- §contradictory (only when constraint detected; otherwise omit)
- §8 Cross-references

### Validator enforcement

`validate-envelope.sh` (per mission-69 Survey Skill at `/skills/survey/scripts/`) enforces this schema. Exit 0 = valid; exit 1 = schema violation (with diagnostic naming first failure).

### Schema version evolution

Schema changes follow the mission-lifecycle pattern: bump methodology version (`idea-survey.md` vX.Y → vX.Z); update §15 schema; update Skill `methodology-source` frontmatter pin; backward-compat decision per change.
```

**This addition lands as part of mission-69 W1 PR** (one of the ~14-18 files); Skill consumes the schema definition.

---

## §15 Compressed-lifecycle risk-flag (NEW; per m3 fold; for Director awareness at Phase 7)

Survey envelope §7.3 + Design context project compressed-lifecycle feasibility based on mission-67 + mission-68 precedent. Mission-67 was single-file doc-substrate (~70 LoC final). Mission-68 was ~10 files code-substrate (~1500 LoC final; with bug-43 chain expansion).

**Mission-69 actual file-count (post-M6 + bug-45):** ~14-18 files spanning bash-script-development + Hub-MCP-integration + shellcheck across all scripts + helper test cases + bug-45 ~15-line Hub-fix + idea-survey.md §15 schema enrichment.

**Risk assessment:** compressed-lifecycle (Phase 1 → Phase 9 same-day) **feasible but tight**. Phase 8 may slip beyond same-day if any of these surprises surface:
- bug-45 implementation surprise (Hub schema location ambiguity, test-pattern variance)
- shellcheck cleanup storm (bash scripts have nuanced quoting + arg-parsing pitfalls)
- Hub-tool-gap secondary surface (e.g., schema validation issue with `get_idea` payload shape)
- Bilateral round count >4 (Round-1 finding count was substantive at 15; v0.2 fold may surface follow-on findings at round 2+)

**Director awareness at Phase 7 Release-gate:** if Director ratifies "Mission go", expect ~85min-3hr Architect-side execution time + ~30-45min Director-side time (Phase 7 only; per "hold for director review after design is complete" directive 2026-05-01). Compressed-lifecycle achievable but explicit risk-flag warranted.

**Calibration candidate:** if compressed-lifecycle DOES slip beyond same-day for mission-69, file calibration `compressed-lifecycle-feasibility-vs-substrate-file-count` for future scope-projection refinement. Mission-67 + mission-68 + mission-69 form a 3-data-point empirical baseline for compressed-lifecycle feasibility curves.

---

## §16 Cross-references

- **`docs/surveys/m-survey-process-as-skill-survey.md`** — Survey envelope (composite intent envelope this Design concretizes; commit `ce5b6c1`)
- **`docs/methodology/idea-survey.md`** v1.0 — Survey methodology spec the Skill mechanizes; **MISSION-69 ENRICHES with NEW §15 Artifact schema per AG-9 carve-out per C2 fold** (semantic methodology unchanged)
- **`docs/methodology/strategic-review.md`** §Idea Triage Protocol — route-(a)/(b)/(c) logic mechanized by `check-skip-criteria.sh` per M5 codification
- **`docs/methodology/mission-lifecycle.md`** v1.2 — Phase 4 Design RACI; companion-doc this mission references but does NOT modify
- **idea-228** — source idea (status `triaged`; this mission instantiates)
- **idea-229** — umbrella architectural anchor (Sovereign-Skill Pattern + Mission-Lifecycle-as-Skills Vision); first-canonical instance
- **idea-230** — claude-plugin install bootstrap (consumer-install automation; pending mission depending on this mission shipping)
- **bug-45** — Hub MCP tool surface lacks `get_idea` (in-flight substrate-fix per mission-68 bug-43 precedent)
- **mission-67** — first-canonical doc-substrate substrate-introduction (precedent for compressed-lifecycle + tier-hierarchy methodology + frontmatter discipline)
- **mission-68** — second-canonical code-substrate substrate-introduction (precedent for in-flight bug-43 chain absorption + calibration #59 mechanism applied 2nd-canonically)
- **`/packages/storage-provider/` + `/packages/repo-event-bridge/`** — sovereign-package precedent at code layer; `/skills/` mirrors at mechanism layer

---

— Architect: lily / 2026-05-02 (Design v0.2; engineer round-1 audit 15 findings folded; standing for round-2 verify → v1.0)
