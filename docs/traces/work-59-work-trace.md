# work-59 — idea-363 funnel-triage + backlog-health (Bank-the-Base R5)

**Engineer:** greg · **Rung:** idea-363 (M-Idea-Funnel-Triage-Cadence) · **Stint:** stint-4 Bank-the-Base (selection substrate)

## Scope-first (design reviewed + approved by lily before build)

cal #88 path-enum surfaced: (1) no entity-aggregate metric exists — `get_metrics` is ephemeral process counters, not a persisted aggregate → NEW verb; (2) `list_ideas` client-side counting hits the 500 list-cap (the R2 lesson, steve's 100-cap) → server-side compute; (3) `update_idea` clobbers tags (line 210) → additive mode needed.

lily-approved shape (the MIX, one cohesive PR): `get_backlog_health` verb + `update_idea addTags` general additive mode + triage-vocab doc. IDEAS-ONLY (Bugs = reconcile.py's domain; Missions = future). stuck-in-triage 3wk param. Carve-outs (architect/Director-altitude, not built): triage cadence, first-cohort disposition, park-with-trigger active-resurface.

## Built

- `hub/src/policy/list-filters.ts` — `mergeTags(existing, addTags)` general additive-tag primitive (union, dedupe, drop-empties; reusable for the update_bug sibling).
- `hub/src/policy/idea-policy.ts`:
  - `update_idea addTags` — read-merge-write additive mode (no clobber; `tags` replaces, `addTags` unions).
  - `computeBacklogHealth(buckets, {asOfMs, staleWeeks, truncatedStatuses})` — exported pure fn: funnel counts, open age-histogram (lt1w/1to4w/1to3mo/gt3mo) + oldestOpenAgeDays, stuckInTriage (triaged + no-mission + age>staleWeeks), incorporation ratio (inFlight:incorporated), truncation-honest.
  - `get_backlog_health` handler — per-status `listIdeas` (each ≤500, accurate per bucket; truncation-flagged) + `asOf`/`staleWeeks` params.
- `docs/methodology/idea-triage-vocab.md` — audit:* tag vocab + 5 disposition buckets + how the cadence reads the funnel.
- Tests (`hub/test/wave2-policies.test.ts`): addTags (6, incl. no-clobber anti-regression) + get_backlog_health integration (3) + computeBacklogHealth pure (6). `e2e-foundation.test.ts` golden tool-list updated.

## Verification

- Full hub suite green (2155 passed / 0 failed).
- Mutation-proven non-vacuous: (1) clobber addTags → 3 no-clobber tests red; (2) drop the age>staleMs guard → 3 stuck tests red. Both reverted.

## State

PR: agent-greg/work-59-backlog-health → steve verifier-gate → lily merges → deploys via the hardened spine. R5 = last observability/selection rung before idea-369 (stint-report).
