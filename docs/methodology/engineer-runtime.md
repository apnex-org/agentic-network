# Engineer Runtime — INDEX-overlay

**Status:** v1.0 (mission-67 close 2026-04-30; first hardened version per Design v1.3 §4.2)
**Tier:** 1 (per `mission-lifecycle.md` v1.2 + Design v1.3 §1.2 tier-by-location rule)
**Scope:** curated table-of-contents of engineer-specific runtime concerns — rules engineers MUST know at runtime to avoid silent breaks or coordination friction.
**Bound at runtime via:** `CLAUDE.md` §4 Cold-pickup primary surfaces + §5 Companion policies (single-mention-per-side bidirectional invariant per Design v1.3 §3.1)

---

## Purpose

Engineer-role cold-pickup navigation surface. Each row is an entry-vector to a canonical source via deep-link; **overlay carries NO normative content** (per `Design v1.3 §4.4` INDEX-only invariant + AG-7 anti-content-fork). Three-hops-max guarantee: `CLAUDE.md` → `engineer-runtime.md` → canonical source = max 3 hops to any engineer-runtime rule.

## Engineer-runtime concerns (INDEX)

| Concern | Why it matters at runtime | Canonical source | Heading anchor |
|---|---|---|---|
| Pass 10 rebuild after `hub/src` PRs | Hub container rebuild + restart REQUIRED for hub/src PRs; silent break otherwise (running container holds stale code; tests/dogfood pass against pre-PR Hub state); calibration #17 origin | `multi-agent-pr-workflow.md` | [§A Hub container rebuild](multi-agent-pr-workflow.md#a--hub-container-rebuild-calibration-17) (within `#adapter-restart-rebuild-protocol-pass-10`) |
| Schema-rename PRs require state-migration | Code-only renames break silently when persisted state has old field name; recovery requires state-migration script in same PR or pre-deploy gate; calibration #19 origin | `multi-agent-pr-workflow.md` | [§C State-migration script run](multi-agent-pr-workflow.md#c--state-migration-script-run-calibration-19) (within `#adapter-restart-rebuild-protocol-pass-10`) |
| Thread-side approval ≠ GitHub-side | Branch protection blocks merge without `gh pr review --approve`; thread `close_no_action` alone insufficient (last-pusher rule invalidates older approvals) | `multi-agent-pr-workflow.md` | [#cross-approval-pattern](multi-agent-pr-workflow.md#cross-approval-pattern) |
| Commit-push thread-heartbeat (engineer-side discipline) | Per-commit thread ping for architect visibility (calibrations #54/#55); silent between-commit pauses are anti-pattern | `mission-lifecycle.md` | [§1.5.1 Engineer-runtime decision-moment routing](mission-lifecycle.md#15-1-engineer-runtime-decision-moment-routing-calibration-57-codification) |
| Commit-push thread-heartbeat mechanization (mission-68 closure of #55) — **20min engineer / 40min architect escalation horizon** post-mission-68 (10/20 cadence × missedThreshold=2; 2.25× faster than v1.2 baseline; budget for ~30min deep-thought-phases on substrate-introduction work) | 3-layer Q4d stack: (a) methodology-doc fold here + (b) adapter-side commit-push hook (Bash-tool-result post-process) + (c) Hub-side commit-pushed handler (`repo-event-handlers.ts` registry; consumes mission-52 RepoEventBridge `commit-pushed` events) | `mission-lifecycle.md` | [§1.5.1.1 Commit-push thread-heartbeat mechanization](mission-lifecycle.md#1-5-1-1-commit-push-thread-heartbeat-mechanization-mission-68-w1-closure-of-55) |
| Work-trace discipline | `docs/traces/<task-or-mission>-work-trace.md` per task; engineer-owned; architect reads for context but does NOT patch; trace shape engineer-flexible | `mission-lifecycle.md` | [§7.2 Trace discipline (engineer-owned)](mission-lifecycle.md#72-trace-discipline-engineer-owned) |
| Cross-package vitest baseline (admin-merge convention) | Engineer must recognize when cross-package test failures warrant admin-merge per established 35-PR-consecutive lineage (bug-32) vs when test-fix is required; canonical decision criteria + lineage context lives in canonical source | `mission-lifecycle.md` | [§7.4 Cross-approval pattern](mission-lifecycle.md#74-cross-approval-pattern-mission-execution-discipline) |
| Commit message format | No `Co-Authored-By:` trailer in any form (Claude Opus / Sonnet / etc.); applies every commit every branch every session | `CLAUDE.md` (Tier 0; canonical source IS Tier 0 per Design v1.3 §3.1.4 self-reference clause) | [§Commit message policy](../../CLAUDE.md#commit-message-policy) |
| Hub thread protocol | `drain_pending_actions` on session-start; thread `maxRounds` discipline (default 10; per-PR-coord 20; design-phase scaling); bilateral seal via `close_no_action` + non-empty summary; round-limit auto-escalation handling | `mission-lifecycle.md` | [§7.5 Per-wave bilateral seal discipline](mission-lifecycle.md#75-per-wave-bilateral-seal-discipline) |

## Cross-references

- **Tier 0:** `CLAUDE.md` §4 Cold-pickup primary surfaces (cross-link in to this overlay) + §5 Companion policies index
- **Tier 1 sister:** `architect-runtime.md` (parallel-structure for architect-runtime concerns)
- **Companion docs (Tier 1):** `mission-lifecycle.md` v1.2 + `multi-agent-pr-workflow.md` v1.0 + `mission-preflight.md` + `idea-survey.md` v1.0 + `strategic-review.md` + `entity-mechanics.md`
- **Design source:** `docs/designs/m-claude-md-hardening-design.md` v1.3 §4.2 (this overlay's row enumeration + §4.4 INDEX-only invariant + §4.1 D4 4-column row template + §3.1 single-mention-per-side cross-link discipline)

## Maintenance discipline (per Design v1.3 §4.4 + AG-7)

**INDEX-only invariant:** rule body lives in canonical source; this overlay carries entry-vector + 1-line "why this matters" + heading-anchor only. Future-PR introducing normative content (rule statement, threshold, condition, exception clause) in this overlay's body that exceeds the 4-column INDEX row template OR diverges in normative content from the canonical-source heading body → flag content-fork violation per Design v1.3 §7.1 AG-7.

**Heading-anchor maintenance protection:** broken heading-anchor = visible failure at canonical-doc-edit-time (PR review catches anchor-rename without overlay-update). Future mechanization candidate: doc-graph linting per idea-227 hook scope.
