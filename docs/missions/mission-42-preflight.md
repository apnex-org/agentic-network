# Mission-42 Preflight Check

**Mission:** M-Cascade-Correctness-Hardening (mission-42)
**Brief:** `docs/reviews/2026-04-phase-4-briefs/m-cascade-correctness-hardening.md`
**Preflight author:** architect (lily)
**Date:** 2026-04-23
**Verdict:** **GREEN** (all categories pass; Director ratified Category D decisions 2026-04-23 with substantive Task 4 re-scope)
**Freshness:** current until 2026-05-23
**Kickoff decisions:** `docs/missions/mission-42-kickoff-decisions.md` (ratified 2026-04-23)
**ADR-022:** `docs/decisions/022-threads-2-bilateral-seal-race.md` (Accepted 2026-04-23 — Option A + 60s window + bundled error-discrimination + INV-TH24)
**Activation:** mission stays `proposed` — Director explicitly holding release-gate 2026-04-23; pre-activation artifacts now complete (preflight GREEN + kickoff decisions + ADR Accepted)

---

## Category A — Documentation integrity

- **A1.** Brief committed at correct path: **PASS** — `docs/reviews/2026-04-phase-4-briefs/m-cascade-correctness-hardening.md` committed in `6625c24` + folded in `732b6b5`
- **A2.** Branch in sync with `origin`: **PASS** — `agent/lily` current
- **A3.** Cross-referenced artifacts present: **PASS** — sibling briefs + `_cross-mission-observations.md` all present

## Category B — Hub filing integrity

- **B1.** Mission entity correct: **PASS** — `id=mission-42`, `status=proposed`, `documentRef` populated
- **B2.** Title + description faithful: **PASS** — description summarizes 4-task decomposition with engineer sequencing, M-class effort, 5/8 composite score
- **B3.** `tasks[]` + `ideas[]` empty: **PASS**

## Category C — Referenced-artifact currency

- **C1.** File paths cited exist: **PASS** — brief references Hub cascade handlers (no new paths invented)
- **C2.** Numeric claims verified: **PASS** — composite score 5/8, M effort (~2 weeks), engineer sequencing intact
- **C3.** Bugs / ideas / tasks cited still in assumed state:
  - **bug-22** (continuation-sweep retry-count): **PASS** — `status=open`, `severity=minor`, `class=missing-feature`. Brief's Task 3 scope (attemptCount FSM extension) matches bug record.
  - **bug-23** (thread bilateral-seal race): ⚠️ **FLAG — bug status is `investigating` (not `open`); H1 race-hypothesis STRONGLY SUPPORTED per bug-23 §Verification attempt (thread-242 controlled comparison)**. The brief's Task 4 framing ("Investigate H1 per bug-23 §Verification attempt") is out-of-date — H1 is already verified. Task 4 should pivot from *investigate* to *fix*. See Category D #2 below.
  - **bug-27** (propose_mission documentRef drop): **PASS** — `status=open`, `class=drift`. Brief's Task 1 scope matches.
  - **bug-28** (DAG dep-eval against completed-task): **PASS** — `status=open`, `class=dag-scheduling`. Brief's Task 2 scope matches exactly (pseudocode in bug description matches brief approach).
  - **task-310** (mission-38 CP2 C2 ThreadConvergenceGateError): **PASS** — shipped within mission-38 (mission-38 still `active` but task-310 in `tasks[]` array). Structured-error format referenced for bug-23 investigation tractability.
  - **mission-38** dependency: ⚠️ **FLAG (informational)** — mission-38 itself is still `status=active` (not completed) despite brief calling it "builds on / shipped". The relevant *task* (task-310) shipped and that's what the brief leans on; mission-38's completion is not a dependency for mission-42.
- **C4.** Dependency prerequisites in stated state:
  - **#1 M-Workflow-Test-Harness** (benefits-from): **PASS with timing flag** — mission-41 now `active` as of 2026-04-23T01:31:53Z (just flipped). Wave 1 is ~1 week. See Category E below for cross-test-integration timing concern.

## Category D — Scope-decision gating

- **D1.** Engineer-flagged scope decisions resolved: **PASS** — all 3 items ratified by Director 2026-04-23; captured in `docs/missions/mission-42-kickoff-decisions.md`
  1. **Intra-mission sequencing** — ratified: engineer-proposed serial bug-27 → bug-28 → bug-22 → bug-23; no intra-mission parallelization
  2. **bug-23 Task 4 re-scope** — ratified (substantive): pivot from *investigate* → *fix*; ADR-first protocol (architect drafts fix-shape comparison in parallel with bug-27/28; Director ratifies ADR; engineer implements ratified shape); Task 4 effort ~1.5-2 weeks
  3. **Cross-test integration** — ratified: harness for bug-22 + bug-28; mission-internal for bug-23 + bug-27; architect refinement — bug-23 discretionary-upgrade to harness if available at Task 4 time
- **D2.** Director + architect alignment: **PASS** — Director ratified via chat signal 2026-04-23
- **D3.** Out-of-scope boundaries confirmed: **PASS** — brief §Out of scope lists 4 explicit exclusions; kickoff decisions preserve boundary discipline

## Category E — Execution readiness

- **E1.** First task clear, day-1 scaffoldable: **PASS** — Task 1 (bug-27 documentRef fix, engineer-S ~2 days) is a single-function cascade-handler change; engineer can scaffold immediately on activation
- **E2.** Deploy-gate dependencies explicit: **PASS** — Hub redeploy required for production-traffic verification per success criterion #6 (verified via full `hub/test/e2e/` suite); architect Cloud Run redeploy not required
- **E3.** Success-criteria metrics measurable: **PASS with timing flag** — 7-day observation window measurable via Hub telemetry; bug resolution flips measurable via `get_bug`; payload-passthrough audit matrix (8 cascade-action types) is a new artifact to be authored. ⚠️ **Flag:** success criterion #3 ("at least 2 of 4 bug-fixes use #1 Workflow Test Harness infrastructure") requires Mission-41 Wave 1 to land BEFORE mission-42 Task 3 (bug-22 FSM extension) or Task 2 (bug-28 DAG). If mission-42 activates immediately, engineer sequences bug-27 first (~2 days) — Mission-41 Wave 1 ~1 week timeline matches for bug-28 onwards to use harness infrastructure. Timing is coordinable but not automatic.

## Category F — Coherence with current priorities

- **F1.** Anti-goals hold: **PASS** — Phase 4 §6 anti-goals (Smart NIC Adapter out, governance rework out, vertex-cloudrun out) + cross-mission anti-goals (mission scope creep, cross-mission coupling, Phase 1-3 re-litigation, architect-filing outside set) all remain valid
- **F2.** No superseding missions: **PASS** — mission-43/44 are sibling Phase 4 winners with distinct scope; no newer filings
- **F3.** No recent bugs/ideas materially change scope: **PASS** — the 4 target bugs (22/23/27/28) were all created 2026-04-21/22, filed before mission-42 was drafted. bug-23's H1 verification occurred 2026-04-21 09:50Z — the brief was authored 2026-04-22, so the brief SHOULD have reflected the H1-verified state but didn't. This is a brief-freshness issue, not a current-state coherence issue.

---

## Verdict summary

**GREEN** — Mission-42 is activation-ready. All 6 check categories pass; the 3 Category D scope decisions have been ratified by Director 2026-04-23 and captured in `docs/missions/mission-42-kickoff-decisions.md`. Substantive re-scoping on Task 4 (bug-23 fix rather than investigation; ADR-first protocol for fix-shape) is the load-bearing ratification — reflects H1 verification that post-dated brief authoring. Mission remains in `proposed` status pending Director release-gate signal (`update_mission(status="active")`); activation is a separate Director call on operational readiness.

## Ratified kickoff decisions

1. **Intra-mission sequencing:** serial bug-27 → bug-28 → bug-22 → bug-23; no intra-mission parallelization
2. **bug-23 Task 4 scope:** pivot from *investigate* → *fix*; ADR-first protocol (architect drafts fix-shape comparison in parallel with bug-27/28 work; Director ratifies ADR; engineer implements ratified shape as Task 4)
3. **Cross-test integration:** harness for bug-22 + bug-28; mission-internal for bug-23 + bug-27; bug-23 discretionary-upgrade to harness if available at Task 4 time

Full rationale: `docs/missions/mission-42-kickoff-decisions.md`.

## Effort class impact

Original brief: M (~2 weeks). Task 4 re-scope (ADR + implementation) extends to ~1.5-2 weeks from ~1 week investigation-only. Total mission effort now ~2.5-3 weeks. Still M by a hair; borderline L. Informational flag; no re-classification triggered.

---

## Timing + coordination with Mission-41

Mission-41 activated 2026-04-23T01:31:53Z; Wave 1 is ~1 week. Mission-42 bug-27 (Task 1, ~2 days) can run in parallel with Mission-41 Wave 1 — no cross-test dependency on Task 1. Mission-42 bug-28 onwards (Task 2, ~2 days) overlaps Mission-41 Wave 1 mid-point — test-harness infrastructure (from Wave 1) available for bug-28 regression test. Mission-42 bug-22 (Task 3, ~1 week) and bug-23 (Task 4, ~1 week + ADR time) ship after Mission-41 Wave 1 lands. Natural staggering.

**Parallelism feasibility:** If a single engineer runs both, Mission-42 serializes behind Mission-41 attention. If two engineers available (per `_cross-mission-observations.md` two-engineer plan), Engineer B starts Mission-42 bug-27 in parallel with Engineer A's Mission-41 Wave 1. Director to decide on engineer allocation.

---

## Preflight audit trail

- Hub state queried: `get_mission(mission-42)`, `get_mission(mission-38)`, `get_bug` for bugs 22/23/27/28
- Brief read: `docs/reviews/2026-04-phase-4-briefs/m-cascade-correctness-hardening.md` (153 lines)
- Cross-mission observations read: `_cross-mission-observations.md` (sequencing, anti-goals, dependency graph)
- Mission-41 activation state: `active` at 2026-04-23T01:31:53Z (coordinated timing)

---

*Preflight v1.0 per `docs/methodology/mission-preflight.md`. Second worked-example application of the methodology; surfaces a new-information-since-filing pattern (bug-23 H1 verification post-dates brief authoring) not anticipated in the v1.0 procedure.*
