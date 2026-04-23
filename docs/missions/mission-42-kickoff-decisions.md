# Mission-42 Kickoff Decisions

**Mission:** M-Cascade-Correctness-Hardening (mission-42)
**Brief:** `docs/reviews/2026-04-phase-4-briefs/m-cascade-correctness-hardening.md`
**Preflight:** `docs/missions/mission-42-preflight.md`
**Ratified:** 2026-04-23 by Director
**Path:** preflight YELLOW → ratify decisions → preflight GREEN → mission stays `proposed` pending Director release-gate signal

---

## Purpose

Capture the 3 engineer-flagged scope decisions that Mission-42's brief deferred to Director + architect ratification. Decisions are frozen into this artifact so that when Director later issues the release-gate signal, activation is immediate (no kickoff meeting required). Mission remains in `proposed` status until Director explicitly releases.

---

## Decision 1 — Intra-mission sequencing

**Decision:** Engineer-proposed serial sequence ratified: **bug-27 → bug-28 → bug-22 → bug-23**; no intra-mission parallelization.

**Rationale:**
- **bug-27 first** (engineer-S, ~2 days): smallest scope, single-function cascade-handler drift. Validates the payload-passthrough pattern + audit matrix approach before broader work.
- **bug-28 second** (engineer-S, ~2 days): also single-function drift (DAG dep-eval initial-status computation). Composes cleanly after bug-27's pattern validation.
- **bug-22 third** (engineer-M, ~1 week): FSM extension on PendingActionItem (`attemptCount` field + terminal transitions). Larger scope, structural. Needs bug-27/28 pattern-confidence before touching core FSM.
- **bug-23 last** (engineer-M, ~1 week + ADR time): fix-risk highest given Decision 2.

**Why no intra-mission parallelization:** engineer wants investigation-risk isolation. A broken bug-22 FSM extension could cascade into bug-23 fix-shape questions or mask bug-27/28 test infrastructure. Serial = ~2 weeks; parallelization of bug-27/28 might save 1-2 days but increases code-conflict risk in overlapping cascade-handler code neighborhoods.

**Authority:** engineer field-ownership per Phase 4 retrospective §Delta 4 (Scope + Sequencing + Effort are engineer-authoritative). Architect has no substantive reason to override.

---

## Decision 2 — bug-23 Task 4 re-scoping *(substantive)*

### Context — what changed since brief authoring

| Date | Event | State |
|---|---|---|
| 2026-04-21 AM | bug-23 filed with H1 as hypothesis | H1 unverified |
| 2026-04-21 09:50Z | Engineer ran thread-242 controlled comparison | **H1 strongly supported** |
| 2026-04-22 | Mission-42 brief authored — Task 4 framed as *investigate H1* | Brief out-of-date at filing time (H1 already verified the prior day) |
| 2026-04-23 | Preflight surfaces the staleness; Director ratifies re-scope | This decision |

H1 race-hypothesis (from bug-23 body): "task-316 issuance cascade completed BEFORE engineer reply landed; Hub transitioned the thread to `closed` as a side-effect of the cascade, pre-empting engineer's bilateral seal window." Verified via thread-242 controlled comparison: the presence of a cascade-spawning committed action flips the bilateral-seal outcome; architect's `close_no_action`-only reply preserves bilateral seal capability.

### Decision 2a — Task 4 pivot

**Decision:** Task 4 pivots from *investigate H1* to **fix H1-race**. The investigation phase is complete; engineer-time in Task 4 is implementation + test.

### Decision 2b — Fix-shape protocol

**Decision:** **ADR-first protocol** — architect drafts an ADR comparing fix-shapes (Option A vs Option B below) in parallel with engineer's bug-27/28 work; Director ratifies ADR; engineer implements ratified shape as Task 4.

**Fix-shape options to be compared in the ADR:**
- **Option A — New FSM state:** add `awaiting_bilateral_seal` as an intermediate state between cascade-fire and terminal-closure on threads. Clean semantic; larger implementation surface; all thread-state reads + writes must handle the new state; stronger guarantee against regression.
- **Option B — Idempotent engineer-seal post-close:** allow engineer to post-process-seal *after* cascade-close by making the seal operation permissive for a brief window. Smaller implementation surface; looser semantics; may have edge cases around state-observability.

**ADR scope additions (observed empirically during mission-41 activation):**
- We literally hit a mitigated variant of the bug-23 class on thread-255 retry: the undifferentiated `"not found, not active, or not your turn"` error (bug-23 §Inconsistencies #3) surfaced. Architect retry was correctly rejected (thread had properly converged) but the error discrimination issue was visible. The ADR should capture this as reinforcement and address the error-surface granularity alongside the fix-shape choice.

**Timing:**
- ADR draft: ~1-2 days architect time, in parallel with engineer bug-27/28 (no critical-path impact)
- Director ratification: ~1 day
- Engineer implementation per ratified shape: ~1 week
- Total Task 4 effort: ~1.5-2 weeks (was ~1 week for investigation-only)

### Decision 2b — Ratified outcome (2026-04-23)

**ADR authored + ratified same day:** `docs/decisions/022-threads-2-bilateral-seal-race.md` (status: Accepted).

**Ratified outcomes:**
- **Primary:** **Option A (new `awaiting_bilateral_seal` FSM state)** selected over Option B. Rationale per ADR §Recommendation: Threads 2.0 forcing-function discipline + regression resistance + operational observability beat Option B's smaller implementation surface.
- **Bilateral-seal window:** **60 seconds** default (env-configurable via `config.bilateralSealWindowMs`)
- **Error-surface discrimination:** **bundled** with Option A in same Task 4 (not split into a separate follow-up)
- **New invariant INV-TH24:** ratified as worded in ADR §Schema changes

**Spec amendments pending Task 4 implementation** (engineer-owned; happen on mission-42 activation):
- ADR-013 amendment (new state in Threads 2.0 FSM)
- ADR-014 amendment (Phase 2 architecture)
- workflow-registry §Thread FSM table (new state row + INV-TH24)
- Thread schema (new status enum value + optional `bilateralSealDeadline` field)

**Implementation gate:** mission-42 release-gate signal (separate Director call). ADR ratification does not activate mission-42.

**Rationale for ADR-first (not engineer-proposes-fix-shape):**
- FSM surface is architectural real-estate; falls under architect field-ownership per Phase 4 retrospective
- ADR sits in parallel with bug-27/28 work — does not extend critical path
- Reduces mid-mission re-litigation risk (alternative "engineer proposes shape, architect reviews" pattern has higher architect-engineer disagreement surface)
- Creates a reusable precedent for future FSM extensions

**Authority:** architect field-ownership on FSM/ADR scope per Phase 4 retrospective §Delta 4 (Name / Concept-grounding / Related-Concepts-Defects are architect-authoritative).

---

## Decision 3 — Cross-test integration

**Decision:** Engineer-proposed default ratified with one architect refinement:
- **Use Mission-41 harness for:** bug-22 (FSM state testing) + bug-28 (DAG dep-eval testing). These are high-value INV-* coverage targets and naturally exercise the mock-harness.
- **Mission-internal tests for:** bug-23 + bug-27 (localized enough that harness indirection adds no value).
- **Architect refinement — bug-23 discretionary upgrade:** if Mission-41 Wave 1 lands before bug-23 Task 4 implementation (timing-wise this is likely: Task 4 is last in mission-42 sequence, ships weeks 2-3; Mission-41 Wave 1 ships week 1), bug-23 tests may use the harness. Discretion-at-the-moment decision for the engineer.

**Coverage math:** 2-3 of 4 bug-fixes use Mission-41 harness. Success criterion #3 threshold ("at least 2 of 4") comfortably met.

**Why bug-23 is the discretionary case:** H1-race test is actually a prime candidate for the harness — it involves deterministic timing between cascade-execution and thread-seal, which is exactly what mock-harness determinism enables. We have a real-world reproduction (thread-255 retry behavior) as test-vector source. But Task 4 itself is architecturally gated on the ADR; the test-layer choice is downstream of that.

**Authority:** engineer field-ownership on test-selection; architect refinement noted but not overriding.

---

## Downstream effects on brief interpretation

- **Success criterion #1 (four bugs resolved):** unchanged — all 4 still in scope
- **Success criterion #3 (≥2 bug-fixes use #1 harness):** engineer default = 2 (bug-22, bug-28); with discretionary upgrade = up to 3
- **Success criterion #5 (payload-passthrough audit matrix):** unchanged — scoped under bug-27 (Task 1)
- **Mission effort class:** original M (~2 weeks); with Task 4 re-scope (ADR + implementation) = ~2.5-3 weeks. Still M by a hair; borderline L. Flagged as informational; no re-classification triggered.
- **Task 4 shape:** now two-phase — architect ADR sketch (in parallel with engineer bug-27/28) → Director ratifies ADR → engineer implements ratified fix-shape

## Filing metadata

- **Authority:** Director ratification via chat signal, 2026-04-23
- **Preflight updated:** `docs/missions/mission-42-preflight.md` verdict YELLOW → GREEN
- **Mission status:** remains `proposed` pending Director release-gate signal (`update_mission(status="active")`)
- **Activation trigger:** Director decides when engineer bandwidth supports bug-27 kickoff + architect ADR-draft in parallel
- **Archive:** this document is immutable post-ratification; any subsequent scope changes require a new mission-scoped decision document

---

*Kickoff decisions ratified and filed. Mission-42 stays `proposed` — release-gate signal independent; activation is a Director call on operational readiness.*
