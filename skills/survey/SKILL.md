---
name: survey
version: v1.0
methodology-source: docs/methodology/idea-survey.md v1.0
description: Mechanizes Phase 3 Survey methodology (3+3 Director-intent pick-list + envelope assembly + per-question architect interpretations + per-round tele-mapping + calibration data point capture) per idea-survey.md v1.0
sovereign-skill-instance: first-canonical (idea-229 umbrella)
disable-model-invocation: true
---

# Survey Skill — Phase 3 Idea→Design transition

This Skill mechanizes the Survey methodology codified at `docs/methodology/idea-survey.md` v1.0 (Director-ratified 2026-04-26 post idea-206 first canonical execution + post-codification refinement). Use it when an Idea moves from `triaged` to Design and Director-intent capture is needed.

---

## Sovereignty status

| Input dimension | Tier 1 (default; OIS network) | Tier 2 (override) | Tier 3 (manual fallback) |
|---|---|---|---|
| Tele framework | ✅ Hub `list_tele` query | ⏸ stub (exit-42 via `tier-stub.sh`) | ⏸ stub (exit-42 via `tier-stub.sh`) |
| Source idea | ✅ Hub `get_idea` (post bug-45 fix; merged 2026-05-02) | ⏸ stub | ⏸ stub |
| Output location | ✅ `docs/surveys/<mission>-survey.md` | ⏸ stub | ⏸ stub |
| Mission-class taxonomy | ✅ canonical 8-value enum per `docs/methodology/mission-lifecycle.md` §3 + heuristic per `scripts/format-pick-presentation.sh` flow | ⏸ stub | ⏸ stub |
| Methodology spec | ✅ ref `docs/methodology/idea-survey.md` v1.0 (incl. §15 Artifact schema enrichment per AG-9 carve-out) | ⏸ stub | ⏸ stub |
| Director-pick capture | ✅ Conversation (universal) | — | — |

**Sovereignty posture:** Tier-1 implemented + tested. Tier-2 + Tier-3 paths are interface-stubbed via parameterized `scripts/tier-stub.sh --tier=<2|3> --dimension=<name>` (exit code 42 sentinel). External-network adoption asks trigger Tier-2/3 implementation work (idea-229 umbrella).

---

## Invocation

Architect invokes this Skill at Phase 3 entry (when an Idea moves from `triaged` to Design + Director-intent capture is needed) via either:

- **Slash-command** (canonical for `disable-model-invocation: true` Skills): `/survey <mission-name> <idea-id>`
- **Skill tool**: `Skill(skill: "survey", args: "<mission-name> <idea-id>")`

This Skill is NOT auto-invoked by Claude. It is user-triggered (architect explicitly engages at Phase 3 entry per `mission-lifecycle.md` §1 RACI: Phase 3 R=architect).

---

## Walk-through

The Survey runs as 5 phases (Init + 4 conversational rounds + Finalize), structured as 6 numbered steps below. Two structured Bash gates (Init + Finalize); the 4 middle conversational rounds happen in chat between architect and Claude.

### Step 1 — Init gate (Bash)

Claude calls:

```bash
bash skills/survey/scripts/survey-init.sh --mission-name=M-<name> --idea-id=idea-<N>
```

`survey-init.sh` pulls the idea text via Hub `get_idea` (Tier 1) and scaffolds an envelope at `docs/surveys/<mission>-survey.md` with frontmatter skeleton + idea-context section seeded. Architect reviews the scaffold path printed on stdout.

If `get_idea` is unavailable (Hub blip; auth error; idea not found): the script falls through to `tier-stub.sh --tier=2 --dimension=idea` (exit 42) → `tier-stub.sh --tier=3 --dimension=idea` (exit 42) → final fallback prompts architect to provide idea text manually in chat.

### Step 2 — Round-1 question design + dispatch (conversational)

Claude loads `skills/survey/round-1-template.md` and prompts architect to design 3 orthogonal questions (per `idea-survey.md` §3 Step 1 + §6 multi-pick discipline). Architect synthesizes the questions for Director chat and reports Director picks back when received.

### Step 3 — Round-1 pick capture + per-question interpretation (conversational)

Claude prompts architect for each captured pick:
- Per-question 1-2 paragraph interpretation per `idea-survey.md` §3 Step 4 (the matrix-solve step; cite Original-Idea + Tele-mapping + Aggregate-Surface)
- Round-1 tele-mapping (primary + secondary; per `idea-survey.md` §3 Step 4 + §9 Step 5; anti-tele-drift discipline)
- Contradictory-multi-pick observation (per `idea-survey.md` §7; if detected, capture as constraint envelope for Design-phase brainstorm)

Claude updates the in-flight envelope artifact with §1 (Round 1 picks + per-question interpretations Q1/Q2/Q3).

### Step 4 — Round-2 question design + dispatch (conversational)

Claude loads `skills/survey/round-2-template.md` and prompts architect to design Round-2 questions per architect-judgment (refine / clarify / new dimension / mix per `idea-survey.md` §4). Round-1 picks + interpretations are loaded as context. Architect synthesizes for Director chat and reports Round-2 picks back.

### Step 5 — Round-2 pick capture + per-question interpretation (conversational)

Same M1+M3+M4 fold pattern as Step 3, applied to Q4/Q5/Q6. Then Claude prompts architect for the **calibration data point** (per `idea-survey.md` §5 + §15 schema):
- `director-time-cost-minutes`: Director engagement time across both rounds
- `comparison-baseline`: prior methodology or prior Survey reference
- `notes`: free text observation (e.g., methodology evolution candidate; novel constraint surface)

Claude updates envelope artifact with §2 + §3 composite intent envelope + §calibration + §contradictory (when detected).

### Step 6 — Finalize gate (Bash)

Claude calls (single batched gate):

```bash
bash skills/survey/scripts/format-pick-presentation.sh --round=1 --questions-file=docs/surveys/<mission>-survey.md
bash skills/survey/scripts/format-pick-presentation.sh --round=2 --questions-file=docs/surveys/<mission>-survey.md
bash skills/survey/scripts/validate-envelope.sh --envelope-path=docs/surveys/<mission>-survey.md
```

`validate-envelope.sh` checks against the §15 Artifact schema (codified in `idea-survey.md`): frontmatter required keys + prose required sections + per-question interpretations non-empty + per-round tele-mapping present + calibration-data fields present + contradictory-constraints capture when detected + mission-class enum match per `mission-lifecycle.md` §3.

Exit 0 → envelope ratifiable. Exit 1 → schema violation; diagnostic names first failure; architect fixes + Claude re-runs the finalize batch. Architect publishes the envelope to the agent branch + dispatches Phase 4 Design bilateral round-1 audit per `mission-lifecycle.md` Phase 4 entry.

---

## Install (interim; pre-idea-230 automation)

Per anti-goal AG-1, this mission does NOT ship `.claude/skills/survey/` directly. To use this Skill in your Claude Code session before idea-230 (claude-plugin install bootstrap) automates this, manually symlink:

```bash
ln -s "$PWD/skills/survey" .claude/skills/survey
```

Then add to `.claude/settings.local.json` to eliminate per-script Bash permission prompts at gate invocations:

```json
{
  "permissions": {
    "allow": [
      "Bash(skills/survey/scripts/survey-init.sh:*)",
      "Bash(skills/survey/scripts/validate-envelope.sh:*)",
      "Bash(skills/survey/scripts/check-skip-criteria.sh:*)",
      "Bash(skills/survey/scripts/format-pick-presentation.sh:*)",
      "Bash(skills/survey/scripts/tier-stub.sh:*)",
      "Bash(skills/survey/scripts/validate-skill-frontmatter.sh:*)"
    ]
  }
}
```

If the project-relative glob doesn't match (e.g., Claude Code resolves the symlink and emits `.claude/skills/survey/scripts/...` instead), use the path-agnostic form:

```json
{
  "permissions": {
    "allow": [
      "Bash(*skills/survey/scripts/*:*)"
    ]
  }
}
```

idea-230 (claude-plugin install bootstrap) will automate both the symlink + allowlist additions in a future mission.

---

## Cross-references

- **`docs/methodology/idea-survey.md`** v1.0 — canonical Survey methodology this Skill mechanizes; **§15 Artifact schema enrichment** ratified bilaterally via thread-455 (mission-69) per AG-9 carve-out.
- **`docs/methodology/strategic-review.md`** §Idea Triage Protocol — route-(a)/(b)/(c) skip-criteria mechanized by `scripts/check-skip-criteria.sh`.
- **`docs/methodology/mission-lifecycle.md`** §3 Mission-class taxonomy — canonical 8-value enum source for the mission-class field in envelope frontmatter.
- **idea-228** — source idea for this Skill (mission-69 instance).
- **idea-229** — umbrella architectural anchor (Sovereign-Skill Pattern + Mission-Lifecycle-as-Skills Vision); first-canonical instance.
- **idea-230** — claude-plugin install bootstrap (consumer-install automation; pending mission depending on this mission shipping).
