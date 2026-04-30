# CLAUDE.md — agentic-network repo guidance

**Version:** v1.1

Project-level context binding all Claude Code instances on this repository.

## Commit message policy

**Do not add `Co-Authored-By: Claude ...` trailers to commit messages on this repo.** No `Co-Authored-By: Claude Opus`, `Co-Authored-By: Claude Sonnet`, or any `Co-Authored-By: Claude ...` form. Write plain commit messages.

**Why:** the trailer surfaces on GitHub's Contributors view as a co-author; want a clean contributor graph without AI attribution.

**How to apply:** every commit on every branch, every Claude Code session. Applies to direct `git commit` and any tool-mediated commit path.

## Calibration ledger discipline

**Query the calibration ledger via the calibration Skill rather than recalling from narrative-doc memory.** Calibration metadata + named architectural-pathology patterns live at `docs/calibrations.yaml`.

**Why:** defeats LLM-state-fidelity drift — narrative-doc recall produces hallucinated cross-references; ledger queries return ground truth.

**How to apply:** `python3 scripts/calibrations/calibrations.py {list,show,status}`. Read-only surface; ledger entries are architect-authored — calibration filings + ID assignments are Director-direct or architect-Director-bilateral, never LLM-autonomous.

## Mission RACI

**Architect drives mission; engineer surfaces ambiguity through architect (NOT Director-direct); Director engages at gate-points only** — Phase 3 Survey, Phase 7 Release-gate, Phase 10 Retrospective.

**Why:** prevents engineer-routing-to-Director-direct anti-pattern (silent between-commit pauses; Director-relay confusion).

**How to apply:** engineer-side autonomous-stop is anti-pattern UNLESS thread-engaged with architect on a surfaced action. Full RACI matrix + decision-routing rules at `docs/methodology/mission-lifecycle.md` §1.5 + §1.5.1.

## Cold-pickup primary surfaces

**Cold-session pickup loads work-trace + companion-policies index + role-runtime overlay before mission-engagement.** Closes the engineer-runtime-rules-invisible class.

**How to apply** (cold-pickup load-order):
- Work-trace location: `docs/traces/trace-management.md` — canonical how-to; engineer-owned `docs/traces/<task-or-mission>-work-trace.md` per task
- Engineer-runtime overlay: `docs/methodology/engineer-runtime.md` — INDEX of engineer-runtime concerns (Pass 10 rebuild, schema-rename migration, thread-vs-GitHub approval, commit-push heartbeat, work-trace discipline, etc.)
- Architect-runtime overlay: `docs/methodology/architect-runtime.md` — INDEX of architect-runtime concerns (mission-driving authority, categorised-concerns surface, Idea Triage Protocol, pulse coordination, substrate-self-dogfood, etc.)
- Tele glossary: `docs/methodology/tele-glossary.md` — tele-N → short-name → mandate lookup (load-bearing decoder for inline tele references)

## Companion policies

Methodology + role-runtime + glossary docs (load when phase-engaged or role-engaged):

- `docs/methodology/mission-lifecycle.md` — formal lifecycle phases (Concept → Retrospective) + RACI matrix + decision-routing rules
- `docs/methodology/idea-survey.md` — Director-intent Survey methodology (3+3 pick-list); canonical for Idea→Design transition
- `docs/methodology/strategic-review.md` — backlog triage + mission prioritization; Idea Triage Protocol (per-idea routing)
- `docs/methodology/multi-agent-pr-workflow.md` — per-PR integration gate; cross-approval pattern; Pass 10 rebuild + schema-rename state-migration disciplines
- `docs/methodology/mission-preflight.md` — activation gate (proposed → active); 6-category audit + verdict
- `docs/methodology/entity-mechanics.md` — per-entity FSM + status transitions + cascade behaviors
- `docs/methodology/engineer-runtime.md` — engineer-runtime concerns INDEX
- `docs/methodology/architect-runtime.md` — architect-runtime concerns INDEX
- `docs/methodology/tele-glossary.md` — tele-N lookup
- `.github/CODEOWNERS` — directory-ownership map; mechanized review routing
