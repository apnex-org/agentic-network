# Architectural Review — 2026-04 — Retrospective-Lite

**Status:** Methodology-level deltas captured while context is hot. **Precedes** the formal retrospective (which still triggers per methodology on "first ratified mission ships or blocks non-trivially" — currently gated on mission-41..44 release-signal).
**Scope:** methodology-only. Mission-level learnings, execution outcomes, and backlog-reshape observations are out-of-scope — those belong to the formal retrospective once missions ship.
**Purpose:** avoid memory decay on findings that are properly v1.1-material for `docs/methodology/strategic-review.md`, filed while the 2026-04 session is fresh.
**Relationship to formal retrospective:** this document is **input** to the formal retrospective. Formal retrospective may incorporate-or-supersede; the two are not redundant because they cover different timeframes (methodology-while-fresh vs methodology-after-mission-feedback).

---

## Methodology deltas observed in 2026-04 execution

### Delta 1 — 88% architect-engineer convergence is a stable ceiling (three axes)

**Observation:** Independent parallel-pass work by engineer + architect converged at ~88% on three different axes:
- Phase 2: symptom-domain assignment (44/50)
- Phase 3: concept-name intersection (8/10 via sub-concept fold count)
- Phase 4: cost-class match (7/8)

The 12% divergence is *not* noise — it's consistently the surface where architect authority elevates engineer-literal-harvest to concept-level (Phase 3 elevated 3 concepts engineer missed; Phase 4 surfaced Role-Scoping scope-depth engineer had guessed shallow).

**Methodology implication:** convergence ≠ correctness target. The split between 88% independent convergence + 12% architect-authority elevation is the *sustainable* methodology shape, not a failure mode. If convergence rises toward 100%, it likely means architect is suppressing elevation cases; if it falls toward 60%, one side has context the other lacks.

**Proposed v1.1 addition:** §Convergence Bounds — document 80-90% as healthy; below 70% or above 95% warrants cadence review, not agent replacement.

---

### Delta 2 — Bidirectional Domain Analysis is Phase 2's missing sub-step

**Observation:** Phase 2 surfaced the "absorbed-and-obscured" pattern where a bug's filing-point differs from its fault-domain (e.g., bug-15 + sym-B-004 workflow-testing gap originally mis-attributed to cognitive-layer and debugging-loop; correctly reclassified as observability). This was the highest-scored symptom (15/25) and would have been mis-prioritized without the reclassification.

**Methodology implication:** Phase 2's current convergence rule ("every bug maps to a domain") doesn't force the question *"which domain caused this; where does it appear?"* — those are different domains for ~10-15% of symptoms.

**Proposed v1.1 addition:** §Phase 2 sub-step — explicit "Filing-Point ≠ Fault-Domain" reclassification pass after initial domain assignment. Every symptom re-examined for domain-where-observed vs domain-that-caused.

---

### Delta 3 — Amendment-fold vs separate-artifact threshold

**Observation:** Phases 2/3/4 all faced the same decision after reconciliation: fold engineer-verified inputs into the Pass α artifact as §N amendment, OR author a separate unified artifact. Amendment-fold chosen in all three cases. Single ratifiable artifact proved cleaner for Director review.

**Heuristic that emerged:** fold when (a) sub-5% content delta, (b) no new selection decisions, (c) inputs are reconciled/verified rather than debated. Author separately when any condition fails.

**Proposed v1.1 addition:** §Amendment Protocol — codify the three-condition heuristic; default to fold unless any condition fails.

---

### Delta 4 — Phase 4's co-authoring cadence is structurally different from Phases 1-3

**Observation:** Plan §Phase 4 already noted "more collaborative than prior phases." In execution, what emerged was a clear field-ownership split:
- **Engineer owns:** Scope (task-decomposition), Success criteria, Effort class, Dependencies — the "how will we ship this" fields
- **Architect owns:** Name, Tele served, Goal, Concept-grounding, Related Concepts-Defects — the "why are we shipping this" fields
- **Both:** flagged scope-decisions for Director

Draft-and-critique (Phases 1-3 pattern) doesn't fit — both fields should exist on each mission brief from the start, not be added later by critique.

**Proposed v1.1 addition:** §Phase 4 Co-authoring — make the field-ownership split explicit in methodology. Document that Phase 4 is a **composition** pattern, not a draft-and-critique pattern.

---

### Delta 5 — Parallel-pass + reconciliation is the time-saver

**Observation:** Phases 1-2 executed parallel-pass (both agents commit independently to their own branches; reconcile via thread) rather than sequential draft-and-critique. Saved ~30-40% per phase. Lockstep would have doubled Director-wait latency.

**Caveat:** only works when both agents can draft in parallel without blocking on each other's outputs. Phase 3 concept-extraction is the exception — architect naming depends on engineer candidate-harvest; must be sequential.

**Proposed v1.1 addition:** §Parallel-Pass vs Sequential — document which phases support parallel execution. Phases 1, 2, 4 parallel-capable; Phase 3 sequential by nature.

---

### Delta 6 — File-as-proposed release-gate is a governance primitive worth promoting

**Observation:** Director's direction "Any missions authored I want blocked until we are ready to release" surfaced a gap — `create_mission` defaults to `proposed`, but no convention existed for "when does architect flip to active?" Codified in this review as §10.6 release-gate protocol: architect does NOT auto-flip; Director issues per-mission `update_mission(status="active")` on operational readiness.

**Methodology implication:** this is not 2026-04-specific. Any review that files missions should default to the release-gate pattern — missions can be ratified but not operationally released. The separation lets review close cleanly without committing engineer-time.

**Proposed v1.1 addition:** §Mission Filing Protocol — default `create_mission(status="proposed")`; Director explicit per-mission release signal required for `active`; anti-goals stay in force while `proposed`.

---

### Delta 7 — Thread round-budget management for review-class threads

**Observation:** Hit round_limit risk at round 10 on thread-254 (also observed prior on thread-251). Current 10-round default was designed for tactical decisions; review-class threads coordinate multi-phase work with higher round-count pressure.

**Pattern that worked:** stage `close_no_action` at round 8-9 with explicit convergence-ready signaling rather than waiting for round 10. Thread-254 converged at round 10 bilaterally this way.

**Methodology implication:** review-class threads should either (a) use higher `maxRounds` at creation, or (b) follow the stage-convergence-early pattern.

**Proposed v1.1 addition:** §Review-Thread Cadence — recommend `maxRounds: 20` for review-scope threads; if using default 10, stage convergence at round ≤8.

---

### Delta 8 — Anti-goals list grew from 8 pre-staged to 17 final

**Observation:** Review plan pre-staged 8 anti-goals (§1-§8). Phase 4 added §10-§13 (non-winner mission deferrals). Engineer added §14-§17 (mission scope creep / cross-mission coupling / no Phase 1-3 re-litigation / no architect-filing outside set).

**Pattern:** anti-goals grow ~2× through execution. The pre-staged list anchors strategic deferrals; execution reveals tactical deferrals.

**Methodology implication:** plan-time anti-goals should target ~50% of final count. If pre-staging all anti-goals at plan-time, likely missing the tactical ones that emerge through execution.

**Proposed v1.1 addition:** §Anti-Goal Growth — document the ~2× growth pattern; recommend pre-staging strategic anti-goals only; reserve numbering slots for execution-surfaced additions.

---

## Non-findings (observed-but-methodology-unchanged)

Deliberate null results — things that worked exactly as methodology predicted, documented here to prevent premature optimization in v1.1:

1. **Cold-start handover** worked as designed; HANDOVER-greg.md + HANDOVER-lily.md files proved useful; no change needed
2. **4-phase sequential structure** held under compression; no phase-merge or phase-split warranted
3. **Retrospective trigger** on "first mission ships" is correct — this document is methodology-learnings-only, not retrospective-replacement
4. **Director-first critique protocol** held; no cadence inversion needed

---

## Proposed v1.1 summary

Additions to `docs/methodology/strategic-review.md` when formal retrospective fires:

| # | Section addition | Delta source |
|---|---|---|
| §Convergence Bounds | 80-90% as healthy ceiling | Delta 1 |
| §Phase 2 Filing-Point ≠ Fault-Domain sub-step | explicit reclassification pass | Delta 2 |
| §Amendment Protocol | 3-condition fold heuristic | Delta 3 |
| §Phase 4 Co-authoring composition pattern | field-ownership split | Delta 4 |
| §Parallel-Pass vs Sequential | phase-capability matrix | Delta 5 |
| §Mission Filing Protocol | proposed-default release-gate | Delta 6 |
| §Review-Thread Cadence | maxRounds: 20 + stage-early | Delta 7 |
| §Anti-Goal Growth | 2× execution growth pattern | Delta 8 |

Plus the §Partial-Scope Review addition authored alongside this document (`docs/methodology/strategic-review.md` edit at same commit).

---

## Filing metadata

- **Trigger:** Director-directed early capture (2026-04-22) before formal retrospective (gated on mission ship)
- **Relationship to formal retrospective:** input artifact; formal retrospective may incorporate-or-supersede
- **Authority:** architect-authored methodology observation; Director-ratifiable independently of mission shipment
- **Precedent:** first use of retrospective-lite pattern; worth evaluating as methodology primitive itself

---

*End of 2026-04 retrospective-lite. Methodology deltas captured; formal retrospective triggers on first mission ship.*
