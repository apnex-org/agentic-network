# Mission: M-Cascade-Correctness-Hardening

**Status:** Pass 4 FINAL — architect-engineer sealed per plan §Phase 4 co-authoring cadence. Architect fields (Name / Tele / Concept-grounding / Goal / Dependencies / Related Concepts-Defects) at `agent/lily:6625c24`; engineer fields (Scope 4-task decomposition with sequencing / Success criteria refinement / Engineer-flagged scope decisions) folded from `agent/greg:4ff0f6b`. Files as `proposed` on Director final ratification per Phase 4 §10.6.
**Phase 4 pick:** #2 of 4 (M-class; reliability blocker — best composite × cost ratio in pool).

---

## Name

**M-Cascade-Correctness-Hardening**

---

## Tele served

| Tele | Role | Why |
|---|---|---|
| tele-7 Resilient Agentic Operations | primary | Cascade correctness IS resilience at the orchestration layer |
| tele-2 Isomorphic Specification | secondary | Cascade behavior matches spec (bug-27 documentRef drop is spec-reality divergence) |
| tele-6 Frictionless Agentic Collaboration | secondary | Cascade failures disrupt flow between agents |

**Tele-leverage score: 3.**

---

## Concept-grounding (Phase 3 register)

- **Hub-as-Conductor (§2.3)** — primary (cascade IS the Hub substrate that drives work between actors)
- **Uniform Adapter Contract (§2.1)** — partial (cascade handlers cross adapter boundary)

---

## Goal

Resolve the four cascade-execution drift bugs clustered in Phase 2 as recurring reliability-friction in the Hub cascade layer. Each bug is bounded; the class is concentrated; resolving all four closes a reliability-gate for multi-task mission execution and enables downstream idea-144 Path A workflow-advancement.

**Best composite × cost ratio in Phase 4 pool (5/8 composite at M effort).** Blocker group because the four underlying drift bugs are production-observable today and compound with other missions' reliability concerns.

---

## Scope

Mission ships in **4 bounded bug-fix tasks** (engineer-authored decomposition + sequencing):

### Task 1 — bug-27 `propose_mission` cascade drops `documentRef` (engineer-S, ~2 days)

- Cascade-handler payload-passthrough fix: propagate `payload.documentRef` in cascade-handler entity-creation path
- Contract test: all gate-accepted payload fields must propagate to created entity (matrix across all 8 cascade-action types — artifact for closing audit)
- **Why first:** single-function drift, smallest scope; validates the pattern before applying to other drift

### Task 2 — bug-28 DAG dep-eval against completed-task → blocked (engineer-S, ~2 days)

- Initial-status computation reads dep-current-state instead of assuming not-yet-completed
- Existing test suite extended with completed-dep test case
- **Why second:** another single-function drift; composes cleanly after bug-27 pattern-validation

### Task 3 — bug-22 continuation-sweep retry-count + terminal escalation (engineer-M, ~1 week)

- Extend PendingActionItem with `attemptCount` field (additive schema change)
- FSM: `pending → errored` or `pending → escalated` transition after N attempts (env-configurable, default 5)
- Audit emission for terminal escalation
- **Why third:** FSM extension = larger scope than bug-27/28

### Task 4 — bug-23 thread bilateral-seal race (engineer-M, ~1 week + H1 verification)

- Investigate H1 (cascade-completes-before-engineer-seal) per bug-23 §Verification attempt
- Either: explicit `awaiting_bilateral_seal` FSM state, OR engineer-seal made idempotent post-cascade-close
- **Why last:** may surface architectural decisions (see engineer-flagged scope); highest investigation risk

### Out of scope

- idea-94 cascade audit replay-queue (separate post-review hardening; M-Cascade-Perfection Phase extension)
- CP4 `retry_cascade` (post-architectural-review hardening; gated on deprecation-runway data)
- Mission-cascade drift / mission-numbering deduplication (anti-goal #2 per Phase 4 §6; post-review)
- bug-20 workflow-advancement (superseded by idea-144 Path A; #7 non-winner this phase)

---

## Success criteria

1. **Four bugs resolved:** bug-22, bug-23, bug-27, bug-28 all flipped `open → resolved` with `fixCommits` citing commits + `fixRevision: mission-N`
2. **Per-bug regression tests:** each fix has ≥1 regression test (verified via failing-then-passing test commits)
3. **Cross-test coverage:** at least 2 of 4 bug-fixes use #1 Workflow Test Harness infrastructure (validates cross-mission integration)
4. **Telemetry verification:** post-fix 7-day observation window shows zero re-occurrences of each bug's class (cascade retry loop; bilateral-seal race; documentRef drop; DAG dep-eval lag)
5. **Audit completeness:** payload-passthrough audit (for bug-27 scope) produces a matrix of all 8 cascade-action types × payload-field preservation; matrix committed to `docs/audits/` as closing-audit artifact
6. **Production deploy verified:** Hub redeployed with all 4 fixes; production-traffic confirms no new regressions in full `hub/test/e2e/` suite

---

## Dependencies

| Prerequisite | Relationship | Notes |
|---|---|---|
| #1 M-Workflow-Test-Harness | benefits from | Test harness infrastructure verifies bug-fixes; not hard-block — can ship with mission-internal tests if #1 Wave 1 lags |
| task-310 + mission-38 CP2 C2 (ThreadConvergenceGateError) | benefits from (shipped) | Structured error format makes bug-23 bilateral-seal race investigation tractable |

### Enables (downstream)

| Mission | How |
|---|---|
| #7 idea-144 Path A (non-winner this phase) | Cascade correctness is precondition for workflow-advancement cascade reliability |
| CP4 `retry_cascade` (post-review) | Requires resolved bug-14 (already shipped) + this mission's bug-22 retry-count foundation |

---

## Engineer-flagged scope decisions (for Director)

1. **Intra-mission sequencing** — bug-27/28 first (smallest scope, single-function drift), then bug-22 (FSM extension), then bug-23 (H1 verification may surface architectural decisions); engineer recommends no parallelization within mission for investigation-risk isolation
2. **bug-23 H1 verification scope** — may surface need for separate ADR if Hub FSM extension required; engineer flags upfront so architect can decide mid-mission whether H1-ADR branches off
3. **Cross-test integration** — engineer recommends using #1 Workflow Test Harness for bug-22 and bug-28 specifically (FSM state + DAG dep-eval are high-value invariant coverage targets); bug-23 and bug-27 may use mission-internal tests given investigation scope

---

## Effort class

**M** (engineer-authoritative per Phase 4 §10.1).

Rationale: four bounded bugs — 2×S (bug-27/28) + 2×M (bug-22/23); combined M because of (a) shared cross-cutting audit work (bug-27 passthrough sweep matrix), (b) test-harness integration (depends on #1's shape), (c) 7-day observation verification. Expected ~2 engineer-weeks.

---

## Related Concepts / Defects

### Concepts advanced (Phase 3 register §2)

- §2.3 Hub-as-Conductor (primary — this mission IS Hub-as-Conductor hardening)
- §2.1 Uniform Adapter Contract (partial — cascade handlers cross adapter boundary)

### Defects resolved (Phase 3 register §3)

- sym-A-022 bug-22 (Silent Collapse class; cascade retry lacks terminal escalation)
- sym-A-023 bug-23 (Race Condition; bilateral-seal ordering)
- sym-A-027 bug-27 (Doc-Code Drift; silent payload-field drop in cascade)
- sym-A-028 bug-28 (Schedule Drift; DAG dep-eval reactive-only)
- Cascade Bomb (§3.7 Resilience cluster)
- Silent Collapse (§3.7) — partial (this mission addresses the specific cascade-retry case)
- Race Condition (§3.14 bug-class defect)
- Schedule Drift (§3.14)
- Boundary Blocking (§3.6 Collaboration cluster) — partial

---

## Filing metadata

- **Status at file:** `proposed` (Mission FSM default; Director release-gate per Phase 4 §10.6)
- **Document ref:** `docs/reviews/2026-04-phase-4-briefs/m-cascade-correctness-hardening.md`
- **Director activation:** requires explicit Director "ready to release" signal per-mission; no architect auto-flip to `active`
- **Correlation:** Phase 4 winner #2

---

*End of M-Cascade-Correctness-Hardening final brief (architect-engineer sealed Pass 4). Awaits Director final ratification → architect files via create_mission.*
