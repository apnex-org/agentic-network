# 2026-04 Architectural Review — Formal Retrospective

**Date:** 2026-04-23
**Trigger:** First ratified mission output ships (mission-41 merged to origin/main at `443fb30`) per `docs/methodology/strategic-review.md` §Formal-retrospective trigger rule
**Scope:** retrospective over the full 2026-04 review cycle — Phase 1-4 ratification + Phase 4 mission execution (mission-41 shipped; mission-42/43/44 pre-ratified but unshipped) + multi-branch-merge first worked example
**Inputs:**
- `docs/reviews/2026-04-retrospective-lite.md` (8 methodology deltas captured pre-ship 2026-04-22)
- `docs/missions/mission-41-merge.md` §Retrospective-lite observations (9 multi-branch-merge deltas captured 2026-04-23 during first worked example)
- `docs/audits/m-workflow-test-harness-closing-report.md` (mission-41 closing audit, 800 lines)
- Mission-41 execution threads (thread-255 through thread-271)

---

## Scope + relationship to prior retrospective artifacts

This formal retrospective **incorporates** the retrospective-lite (2026-04-22) and the mission-41 merge-artifact deltas (2026-04-23) as inputs; it does not replace them. Retrospective-lite was captured while session context was fresh pre-ship; merge-artifact deltas were captured during first-worked-example execution. This document synthesizes both plus ships actionable v1.1 edit queues per methodology pillar.

**Three methodology pillars covered:**
1. `docs/methodology/strategic-review.md` (v1.0 → v1.1 fold pending)
2. `docs/methodology/mission-preflight.md` (v1.0 → v1.1 fold pending)
3. `docs/methodology/multi-branch-merge.md` (v1.0 → v1.1 fold pending)

Each pillar gets its own §Edit queue section below.

---

## 1. Did the prioritization hold up once we started executing?

**Yes, with nuance.** The 2026-04 review ratified 4 Phase 4 winners: mission-41 / 42 / 43 / 44, ranked by composite score (Tele leverage × unblocking power × cost efficiency).

**Mission-41 (pool root, composite 8/8)** — prioritized first; shipped first. Ranking held up perfectly:
- Foundational test infrastructure + CI gate unlocks downstream missions 42 (cascade correctness) + 43 (tele retirement) + 44 (cognitive silence) per the review's unblocking-power analysis
- tele-leverage 5/5 prediction materialized: tele-2 (isomorphic spec) advanced via spec-column fold; tele-8 (mechanized gate) reverse-gap closed via CI workflow; tele-9 (chaos validation) covered via WF-001/WF-005
- Delivered ~30× ahead of brief estimate (~3 engineer-hours vs ~1 engineer-week)

**Missions 42/43/44** — all pre-ratified; not yet activated. Prioritization validity TBD pending ship. Notes:
- **Mission-42** gained empirical priority signal during mission-41 execution (bug-28 DAG-cascade defeat collided 4× with routine mission-sequencing patterns; mission-42 Task 2 fixes bug-28). Not predicted in review; surfaced post-review.
- **Mission-44 preflight** YELLOW on Decision 3 (telemetry threshold); substantive ratification deferred. Preflight caught pre-activation; prioritization logic unaffected.
- **Mission-43** S-class / zero-dep / pre-ratified; ready to activate whenever engineer-bandwidth permits. No priority erosion.

**Anti-goals held.** Review's 17 anti-goals (8 strategic pre-staged + 9 execution-surfaced in Phase 4) were respected throughout mission-41 execution: no Smart NIC Adapter work (anti-goal §1), no governance rework, no vertex-cloudrun architect behavior changes, no architect-filing outside the 4-winner set, no cross-mission coupling, no Phase 1-3 re-litigation.

**Verdict:** Prioritization held up. The 8/8 composite-score winner shipped first; anti-goals contained scope; downstream mission benefits materialize as predicted (mission-42 uses harness for bug-22/28 regression coverage; mission-44 would use it for mitigation verification).

---

## 2. What did we miss in friction cartography?

**Phase 2 friction scoring was mostly accurate with one significant miss:**

### Captured accurately (Phase 2 predictions held)

- **sym-B-004** (workflow testing gap; top score 15/25) → mission-41 resolved. Accurate.
- **sym-A-011** (bug-11 cognitive silence; 12/25) → mission-44 scoped to close. Accurate.
- **sym-A-022/23/27/28** (cascade cluster; recurring friction) → mission-42 scoped. Accurate.
- **sym-A-024** (tele retirement gap) → mission-43 scoped. Accurate.

### Under-weighted miss: bug-28 DAG-cascade-defeat

Bug-28 appeared in Phase 2 as part of the cascade cluster (`sym-A-028: DAG dep-eval against completed-task → blocked`). It was scored as "reliability-concern, med-priority" — clustered with bug-22/23/27 as "cascade correctness hardening" for mission-42.

**Reality surfaced during mission-41 execution:** bug-28 isn't merely "a cascade reliability concern" — it's an **active obstruction to ordinary mission-sequencing patterns**:
- Mission-41 Wave-2 Batch-2 attempted DAG-primitive demonstration **3 times**; all 3 collided with bug-28 (stale-completed-dep race)
- Mission-41 Wave-2 Batch-2 TH19 filing deferred DAG wiring to avoid bug-28; never demonstrated the primitive
- Mission-41 Wave-3 continued dodging bug-28 via `dependsOn: []` flat-DAG pattern

**Net:** bug-28 defeated the DAG-primitive exercise **4 times** across mission-41. This is empirical evidence that bug-28 is not cluster-cascade-correctness; it's **workflow-primitive-blocker**. Should have been scored as its own high-priority symptom, possibly elevated to Phase 4 standalone-mission consideration rather than clustered with bug-22/23/27.

**Methodology implication:** Phase 2 scoring rubric should weight "frequency of cross-mission obstruction" as a separate dimension from "reliability concern." Bug-28's recurring-during-ordinary-mission-sequencing pattern was the real severity, not its narrow DAG-dep-eval defect description.

**v1.1 delta:** Phase 2 scoring rubric should gain a **"mission-sequencing obstruction" weight** distinct from the existing reliability / severity / frequency axes. Captures the "routine work hits this bug every time" pattern. Worth formalizing.

### Other gaps (less severe)

- **Workflow-gap (engineer-session-not-auto-draining)** — not scored in Phase 2 at all. Surfaced mid-mission-41 when architect discovered "drain queue" autonomy theory was wrong. Already documented as idea-108 (Hub-as-Conductor); but the Phase 2 friction surface didn't capture it. Worth noting that **Phase 2's scope was bug+thread-summary-observations**; idea-108-style "missing Hub primitive" friction may need a separate capture surface.
- **Pre-merge state drift** — not anticipated by any methodology; surfaced mid-multi-branch-merge execution. Surfaced as v1.1 deltas for multi-branch-merge; no Phase 2 equivalent would have captured this.

---

## 3. What was easier than predicted? What was harder?

### Easier

1. **Mission-41 shipped ~30× faster than estimated.** Brief estimated ~1 engineer-week (L-class). Actual: ~3 engineer-hours of claimable engineer time across 18 tasks + architect reviews. Two factors:
   - LLM-paced engineer completing L-class work in hours not days (per mission-41 closing audit §19)
   - Pattern-reuse compounding: once Wave 1 infrastructure landed, Wave 2 tests were ~10-20 minutes each following established pattern
2. **Mock*Client harness never actually consumed.** Built in Wave 1 T3/T4 for idea-104 absorption; designed as shim-side infrastructure for transport-layer testing. Wave 2 + Wave 3 tests all stayed at TestOrchestrator policy-layer level — the harness wasn't load-bearing for any ratified invariant. Not a failure; the infrastructure is correct-future-investment, not wasted-present-investment. But simpler-than-expected realization that policy-layer is sufficient for most invariant classes.
3. **Stub-then-graduate pattern** — scanner STUBBED set mechanic worked end-to-end first try. TH18/TH19 graduations flipped `Stub → Tested` cleanly; no pattern errors.
4. **Boundary-pin test pattern** — emerged organically across 10+ Wave-2 tests without explicit methodology instruction. Tests pinning where invariants' edges sit (rather than just positive/negative) became an engineering-discipline norm.

### Harder

1. **Bug-28 DAG-defeat (discussed above).** 4 collisions; DAG primitive never demonstrated within mission-41. Architect's "compression math" in thread-261 (5× nudge-reduction via DAG) was architecturally invalid.
2. **Workflow-gap (engineer-session autonomy assumption).** Architect's theoretical "drain queue" model — engineer auto-picks-up-next-task — was wrong. Engineer sessions need explicit thread-nudge per task cycle. 4 mid-mission nudge-thread re-openings as a result. Real-world primitive required (idea-108 Hub-as-Conductor).
3. **Multi-branch-merge first worked example.** Methodology v1.0 assumed pristine main + minor drift. Reality: 15+ unpushed commits on local main + extensive intentional working-tree drift (deploy restructure, scripts, tests) + security near-miss on subdirectory-gitignore-bypass. Four v1.1-structural deltas (Cat B3 gitignore audit / Cat B5 main-sync-state / Cat B3 drift classification / Cat B4 tag timing) all surfaced during execution, not preflight. Methodology's assumption-of-predictability was weaker than warranted.
4. **Reviewed task-by-task-nudge cadence.** Wave 1 T1→T2→T3→T4→T5 sequential = 4 architect nudge threads. Mission-41 used ~15 coordination threads total. Per-task-nudge overhead is significant at mission-close scale; reinforces idea-108 priority signal.

---

## 4. Did Concept + Defect proxies earn their keep?

**Yes, demonstrably.** The Phase 3 Concept + Defect register (`docs/reviews/2026-04-phase-3-concepts-and-defects.md`) served as the common language for mission briefs and test-authoring throughout mission-41 execution.

### Concept register value

- **Manifest-as-Master (§2.4)** cited in every mission-41 brief concept-grounding; directly invoked as the organizing principle for workflow-registry §7 spec-column fold (Wave-3 T1) and for INV-P2's "test-encodes-spec-intent + runtime-fix-makes-spec-honored" bundled commit (Wave-2). The concept was operational, not decorative.
- **Layered Certification (§2.7)** — invoked in mission-41 Waves 1-3 as the pattern for mechanized gate adoption. CI workflow debut is the concrete expression.
- **Substrate-First Logic (§2.2)** + **Precision Context Engineering (§2.6)** — these were Phase 3 register entries that informed mission-44's dual-primary-concept grounding. Promoted to ratified teles (tele-11 + tele-12) during Phase 1 per Director direction; register entries worked as incubators.
- **Hub-as-Conductor (§2.3)** — concept that surfaced during M-Ideas-Audit retrospective; framed idea-108 explicitly. Register entry provided the concept-name that survived into mission-41 execution observations.

### Defect register value

- **Cognitive Economy cluster (§3.11)** cited as the target for mission-44 (all 6 sub-defects addressed via Phase E pre-hydration + state reconciliation).
- **Foundation-of-Sand (§3.8)** + **Debugging Quicksand (§3.8)** cited as what mission-41 resolves at the engineering-substrate level.

### Emergent concept during execution

**Absence-of-API enforcement** emerged during mission-41 Wave-2 as a distinct test-authoring pattern (INV-TE1/TE2/A1 invariants defended by mutation-endpoint absence). Not in Phase 3 register; surfaced in the mission-41 closing audit as a candidate new concept. This is exactly the retrospective-lite "emergent concept" pattern — concepts accrete through execution, not just review-time ratification.

**v1.1 delta candidate (strategic-review.md §Phase 3):** Phase 3 concept register should have an explicit **"execution-surfaced amendments"** section that captures concepts emerging during mission execution (not only during review). The register grows; the methodology should acknowledge the growth-surface.

### Proxy-shape assessment

Phase 3 used lightweight Document-form proxies (not first-class Hub entities). This held up cleanly — the proxies are readable, cross-referenceable, searchable. No pressure emerged to promote to first-class Hub Concept/Defect entities. Proxy-form was right-sized for 2026-04 scope.

---

## 5. What should change in the methodology for next time?

Three methodology docs; each gets its own explicit v1.1 edit queue below.

---

## Edit queue — `strategic-review.md` v1.1

Absorbs retrospective-lite deltas (already captured) + this retrospective's additional findings.

### From retrospective-lite (2026-04-22; 8 deltas)

| # | Section | Edit |
|---|---|---|
| 1 | §Convergence Bounds | Document 80-90% architect-engineer convergence as healthy ceiling; below 70% or above 95% warrants cadence review |
| 2 | §Phase 2 Filing-Point ≠ Fault-Domain sub-step | Add explicit reclassification pass after initial domain assignment |
| 3 | §Amendment Protocol | Codify 3-condition fold heuristic; default to fold unless any condition fails |
| 4 | §Phase 4 Co-authoring composition pattern | Make field-ownership split explicit (engineer owns Scope/Sequencing/Effort; architect owns Name/Tele/Concept-grounding) |
| 5 | §Parallel-Pass vs Sequential | Document phase-capability matrix (Phases 1,2,4 parallel; Phase 3 sequential by nature) |
| 6 | §Mission Filing Protocol | Proposed-default release-gate protocol (§10.6 from 2026-04 review) |
| 7 | §Review-Thread Cadence | Recommend maxRounds:20 for review-scope threads; stage convergence at round ≤8 |
| 8 | §Anti-Goal Growth | Document ~2× growth pattern through execution; pre-stage ~50% of final count |

### From this retrospective (additional deltas)

| # | Section | Edit |
|---|---|---|
| 9 | §Phase 2 scoring rubric | Add **"mission-sequencing obstruction" weight** as distinct dimension from reliability/severity/frequency. Captures recurring-during-ordinary-work symptoms like bug-28 |
| 10 | §Phase 3 register maintenance | Add **"execution-surfaced amendments"** section documenting concepts that emerge during mission execution (e.g., "Absence-of-API enforcement" from mission-41 Wave-2) |
| 11 | §Review friction-capture surface | Acknowledge that **"missing Hub primitive" friction** (e.g., idea-108-style) may not surface via bug-or-thread-observation Phase-2-input; needs separate capture path or explicit Phase 1 prompt |

**Priority fold order:** items 1-8 (retrospective-lite, fully specified) first; items 9-11 (emergent from mission-41 execution) second.

---

## Edit queue — `mission-preflight.md` v1.1

### From this retrospective

| # | Section | Edit | Source |
|---|---|---|---|
| 1 | §Category C (referenced-artifact currency) | Document that **numeric claims in briefs may require active Hub verification** (e.g., bug status, idea counts) rather than trusting brief-time snapshot. Mission-43 preflight surfaced this when idea-state had evolved since brief. | Mission-43 preflight (zombie-cleanup scope obsolescence) |
| 2 | §Category D decision surface | Add pattern: **"Engineer-flagged decisions that require architect-led ADR protocol"** — preflight should catch when a decision surface is architect-decision-class (not engineer-ratifiable). Mission-42 preflight surfaced this on bug-23 H1 verification → Task 4 re-scope. | Mission-42 preflight + ADR-022 precedent |
| 3 | §Freshness window | Existing 30-day window worked. No change. | — |
| 4 | §Success criteria | Existing worked. No change. | — |

**Relatively light edit queue** — 4 preflights across mission-41/42/43/44 all caught substantive decisions; methodology v1.0 held up well. Items 1 + 2 are structural refinements, not critical gaps.

---

## Edit queue — `multi-branch-merge.md` v1.1

### 9 deltas from merge artifact (`docs/missions/mission-41-merge.md` §Retrospective-lite observations)

| # | Section | Edit | Shape |
|---|---|---|---|
| 1 | §Roles + directory ownership | Add: **"Additive co-authorship on shared-surface"** rule — when one party's commit is pure content-superset of other's, take-the-superset is mechanical resolution; no veto invocation | Held-as-designed; formalize |
| 2 | §CI-gate debut protocol | Already covered in v1.0; held. No change. | No change |
| 3 | §Session-local untracked | Already covered. No change. | No change |
| 4 | **§Category B3 gitignore-audit step** | Add: run `git ls-files --others --ignored --exclude-standard` after staging to catch directory-adds that bypass subdirectory gitignores | **Structural — high priority** |
| 5 | **§Category B5 main-sync-state check** | Expand to include: (B5.1) `git diff --stat main origin/main` (surface divergence), (B5.2) `git status --short` on main worktree (surface uncommitted drift), (B5.3) escalate to Director if either non-empty | **Structural — high priority** |
| 6 | **§Category B3 drift classification** | Distinguish (a) session-local / (b) session-drift / (c) in-progress intentional work. Director escalation required for case (c) | **Structural — medium priority** |
| 7 | §Option A merge-order heuristic | Worked as designed. No change. | No change |
| 8 | §Bug-28 interaction | Bug-28 is DAG-cascade-specific, not merge-specific. No interaction observed. Note in v1.1 for future-reader confidence. | Clarification |
| 9 | §Director ratification timing | Document that Director-signals welcome at any phase (pre-merge / mid-merge / post-merge). Artifact template's "post-merge" placement is default, not exclusive. | **Structural — medium priority** |

### Additional delta from post-merge observation

| # | Section | Edit | Shape |
|---|---|---|---|
| 10 | §Category B4 tag timing | Pre-merge tag should be created **at final pre-merge-prep commit** (not early in prep phase). Tagging before merge-artifact commit captured pre-artifact state rather than pre-merge state | Minor correction |

**Priority fold order:** items 4, 5 (high — caught real issues during first worked example); items 6, 9 (medium — improve operational discipline); items 1, 10 (clarifications); items 2, 3, 7, 8 (confirmations, no edits needed).

---

## Execution observations beyond methodology

Observations that inform future mission execution but don't drive methodology edits directly:

### Workflow-gap (idea-108) empirical priority elevation

Mission-41 execution produced **concrete empirical evidence** for idea-108 (Hub-as-Conductor) priority:
- 15 coordination threads used during mission-41 execution; ~13 of them existed because engineer-session lacks auto-drain primitive
- Each task-approval required explicit architect nudge thread (Wave 1 + Wave 3 cadence)
- Batch-continue-thread pattern (Wave 2) partially compressed this; still required 2+ threads per batch
- Architect's compression math (thread-261) was invalid; real compression only via the primitive idea-108 delivers

**Mission-42 release-gate consideration:** bug-28 fix (mission-42 Task 2) is strongly prioritized for elevation based on 4 DAG-primitive defeats during mission-41. Should factor into Director's mission-42 activation timing.

### Mission-41 effort prediction (L vs 3-hours-delivered)

Engineer LLM velocity at pattern-reuse scale is ~10-20× faster than human-paced. Future mission effort estimates should:
- Retain brief-time estimate (budget-conservative)
- Note actual engineer-hours via closing-audit
- Track ratio over time; formal retrospective should aggregate
- Worth noting as a factor in prioritization — L-class missions may ship in hours if well-scoped and pattern-reusable

### First CI workflow ship (tele-8 reverse-gap closure)

Mission-41 shipped the first `.github/workflows/test.yml` in the repo. Per retrospective-lite #2 + multi-branch-merge.md §CI-gate debut protocol, this was a one-time event. Post-mission-41, CI gate is active for all subsequent PRs. **tele-8 (Gated Recursive Integrity) reverse-gap from Phase 1 is mechanically closed.**

### Mock*Client as correct-future-infrastructure

Mock*Client harness never consumed post-graduation (0-of-17 test files use it). Not a failure — infrastructure correctly exists for shim-side/transport-layer testing; just wasn't needed for the 10 ratified invariants. Documented in mission-41 closing audit §15 + multi-branch-merge.md delta. **Future missions that need transport-layer testing (e.g., future idea-75 full harness)** will consume this infrastructure without having to re-scaffold it.

---

## Decisions emerging from retrospective

### Methodology v1.1 fold action items (ordered)

1. **Architect authors v1.1 folds for all three methodology docs** — sequenced:
   - `strategic-review.md` v1.1 first (11 deltas; retrospective-lite + this retrospective)
   - `multi-branch-merge.md` v1.1 second (4 structural + 6 confirmation/clarification deltas)
   - `mission-preflight.md` v1.1 third (lightest queue; 2 structural refinements)
2. **Each v1.1 fold is a standalone commit** on architect branch; merges to main via existing multi-branch-merge methodology (now v1.1)
3. **No formal Hub-filed mission required for v1.1 folds** — methodology-doc edits don't need mission scaffolding per existing precedent

### Director decisions standing (post-retrospective)

| Decision | Context |
|---|---|
| **Mission-42 release-gate** — elevate priority? | Bug-28 empirical signal now documented; 4 DAG-defeats during mission-41 execution. Director's call whether to activate mission-42 ahead of other priorities. |
| **Mission-44 Decision 3** — telemetry threshold ratification | Still YELLOW-pending from preflight 2026-04-23 |
| **Mission-43 release-gate** | Fully pre-ratified; awaiting Director go-signal |
| **v1.1 fold timing** | Architect can author folds now (this session) or later; Director's call on sequencing |

---

## Retrospective-of-retrospective (meta)

### What worked about this retrospective

- **Inputs were well-captured** — retrospective-lite (pre-ship) + merge-artifact deltas (during first worked example) gave substantive material without requiring re-discovery
- **Trigger timing** — firing after mission-41 ship (not waiting for all 4 missions) caught 2026-04-specific learnings while fresh; mission-42/43/44 can generate their own retrospective cycles when they ship
- **Methodology-pillar separation** — edits queued per doc rather than as one monolithic list; each fold can proceed independently

### What to do differently next retrospective

- Start the retrospective-lite capture habit **during** mission execution, not only pre-ship. Merge-artifact deltas (9 of them) accumulated organically during mission-41 execution — the equivalent of a "continuous retrospective-lite" during execution would have captured them as they occurred rather than post-hoc.
- Consider tracking "methodology-stress events" (times a methodology surfaced a gap mid-execution) as an explicit retrospective input category

---

## Filing metadata

- **Artifact location:** `docs/reviews/2026-04-retrospective.md`
- **Methodology reference:** `docs/methodology/strategic-review.md` §Review-of-the-Review §Formal-retrospective
- **Trigger:** First ratified mission shipped (mission-41 merged to origin/main at `443fb30` 2026-04-23)
- **Authority:** architect-authored; Director-ratifiable via commit authorship or explicit signal
- **Incorporates:** `docs/reviews/2026-04-retrospective-lite.md` (2026-04-22) + `docs/missions/mission-41-merge.md` §Retrospective-lite observations (2026-04-23)
- **Produces:** v1.1 edit queues for strategic-review.md + multi-branch-merge.md + mission-preflight.md (captured above; execution pending)

---

*2026-04 architectural review formal retrospective complete. Methodology v1.1 folds pending; Director decisions standing per §Decisions emerging from retrospective.*
