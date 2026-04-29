# CLAUDE.md — agentic-network repo guidance

Project-level guidance binding all Claude Code instances working on this repository.

## Commit message policy

**Do not add `Co-Authored-By: Claude ...` trailers to commit messages on this repo.**

- No `Co-Authored-By: Claude Opus <noreply@anthropic.com>` line
- No `Co-Authored-By: Claude Sonnet ...`
- No `Co-Authored-By: Claude ...` in any form

Reason: Director's preference (ratified 2026-04-23). The `Co-Authored-By:` trailer surfaces on GitHub's repo Contributors view as a co-author; Director wants a clean contributor graph without AI attribution. Write plain commit messages.

This applies to every commit on every branch (main, `agent-{lily,greg}/*` per-PR branches, etc.) and to every Claude Code session.

## Calibration ledger discipline

Calibration metadata (id + status + closure-PR + cross-refs) + named architectural-pathology patterns live at `docs/calibrations.yaml` (canonical schema-versioned source-of-truth; ADR-030).

When authoring audits / retrospectives / methodology references that cite calibrations: **query the ledger via the calibration Skill rather than recalling from narrative-doc memory** (Phase 1 surface: `python3 scripts/calibrations/calibrations.py {list,show,status}`; final `/calibration-*` verb names pending idea-121 ratification). Defeats the LLM-state-fidelity drift class (calibration #42 origin; idea-223 mechanization). Read-only at Phase 1; ledger entries are architect-authored (not LLM-autonomous).

## Companion policies

Other repo-specific conventions live in the methodology docs:

- `docs/methodology/multi-agent-pr-workflow.md` — per-PR integration gate (v1.0 DRAFT; supersedes sovereign-branch model)
- `docs/methodology/mission-preflight.md` — activation gate (proposed → active)
- `docs/methodology/strategic-review.md` — backlog triage + mission prioritization
- `.github/CODEOWNERS` — directory-ownership map; mechanized review routing via `@apnex-org/architect` + `@apnex-org/engineer`
