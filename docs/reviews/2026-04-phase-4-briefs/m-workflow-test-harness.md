# Mission: M-Workflow-Test-Harness

**Status:** Pass 4 FINAL — architect-engineer sealed per plan §Phase 4 co-authoring cadence. Architect fields (Name / Tele / Concept-grounding / Goal / Dependencies / Related Concepts-Defects) at `agent/lily:6625c24`; engineer fields (Scope task-decomposition / Success criteria refinement / Engineer-flagged scope decisions) folded from `agent/greg:4ff0f6b`. Files as `proposed` on Director final ratification per Phase 4 §10.6.
**Phase 4 pick:** #1 of 4 (L-class; foundational structural; composite 8/8 — highest in pool). Director-approved 2026-04-22.

---

## Name

**M-Workflow-Test-Harness**

## Tele served

| Tele | Role | Why |
|---|---|---|
| tele-2 Isomorphic Specification | primary | Workflow tests verify spec-to-runtime isomorphism; workflow-registry FSMs become enforceable |
| tele-8 Gated Recursive Integrity | primary | Per-layer pass/fail gate becomes a mechanized gate (closes Phase 1 reverse-gap on tele-8) |
| tele-9 Chaos-Validated Deployment | primary | Chaos paths gain test coverage; merge-gate automation becomes implementable |
| tele-7 Resilient Agentic Operations | secondary | Non-actionable failures become visible via test-output |
| tele-5 Perceptual Parity | secondary | Test outputs = perceivable system state for operator inspection |

**Tele-leverage score: 5/5.**

## Concept-grounding (Phase 3 register)

- **Manifest-as-Master (§2.4)** — workflow-registry is sovereign spec; harness makes divergence detectable
- **Layered Certification (§2.7)** — each workflow-FSM layer gains certification gate

## Goal

Close the workflow-registry §7.2 test-coverage gap — bring 28 documented invariants currently `Tested By: NONE` under automated coverage so spec↔runtime divergence becomes detectable mechanically rather than by manual observation. Pool-foundational mission: downstream Phase 4 winners (#6, #3, #5) use this harness to verify their fixes.

## Scope

Mission ships in **3 task waves** (engineer-authored decomposition):

### Wave 1 — Test infrastructure (engineer-S, ~1 week)

- Mock-harness packages: `MockClaudeClient` + `MockOpenCodeClient` driving real shim code over loopback transport (absorbs idea-104 partial scope)
- Hub-side testbed: extend `hub/test/e2e/orchestrator.ts` with FSM-invariant assertion helpers
- Integration with vitest CI; runs against in-memory Hub + cognitive-layer + adapter-layer
- Coverage report tooling that maps invariant-id → test-pass/fail status

### Wave 2 — High-value invariant subset (engineer-M, ~2 weeks)

- Architect + Director agree on ~10 of 28 INV-* invariants for first coverage pass — recommended priority: **INV-TH16 / TH17 / TH18 / TH19** (turn-pinning + validate-then-execute + cascade-action allowlist; most-cited in bug-23, bug-7, mission-29 scope)
- For each chosen invariant: 2-3 tests (positive + negative-rejection + edge case)
- CI gate: invariant test fail → PR block

### Wave 3 — Coverage report + remaining-gap inventory (engineer-S, ~1 week)

- Machine-readable invariant coverage report at `docs/audits/workflow-test-coverage.md`
- Update `workflow-registry.md` §7 `Tested By` column per invariant brought under coverage
- Follow-up ideas filed for uncovered invariants (handoff to subsequent missions)

### Out of scope

- Full 28-invariant coverage in v1 (XL; v1 targets ≥10 high-value subset per engineer decomposition)
- Adapter-side integration coverage beyond idea-104 partial absorption (separate mission scope)
- Vertex-cloudrun architect LLM behavior (uses real LLM; not mock-harness-targetable per engineer flag)
- Per-entity FSM unit tests beyond what entity-policy test suites already cover
- Production chaos-validation (this is test-harness construction; chaos-prod is separate)

## Success criteria

1. **Coverage: ≥10 of 28 INV-* invariants** have ≥1 automated test in the Hub test suite
2. **Mock-harness packages exist** + drive real shim code; idea-104 partially absorbed
3. **CI gate verified** — merge fails on invariant-test regression (verified via deliberate-fail PR)
4. **Coverage report** at `docs/audits/workflow-test-coverage.md` with per-invariant status (Tested / Not-Tested / Out-of-Scope)
5. **workflow-registry.md §7** updated: `Tested By:` column populated for the 10+ invariants brought under coverage
6. **Chaos paths**: WF-001 + WF-005 chaos-path (entropy injection, delivery loss, stall scenarios) covered with ≥1 test case each
7. **Suite health**: workflow-test-harness runs at ≥90% pass rate on `main` over 7-day observation window

## Dependencies

| Prerequisite | Status | Notes |
|---|---|---|
| none (pool root) | — | Foundational; no upstream Phase 4 dependency; can start immediately on mission ratification |

### Enables (downstream)

- **#6 M-Cascade-Correctness-Hardening** — test harness verifies cascade-bug fixes (bug-22/23/27/28)
- **#5 M-Cognitive-Layer-Silence-Closure** — test harness verifies idea-132 mitigation effectiveness
- **#3 M-Tele-Retirement-Primitive** — test harness verifies retirement-semantics (minor; bug-24 can ship standalone with mission-internal tests)
- **bug-12** (threads-2-smoke loopback helper drift) — resolution co-lands as part of PolicyLoopbackHub parity audit (Wave 1)

## Engineer-flagged scope decisions (for Director)

1. **Invariant subset selection** — architect + Director agree on the ~10 high-value INV-* before mission starts (else scope creeps toward all-28-XL)
2. **Adapter coverage scope** — Wave 1's mock harness covers shim-side invariants (idea-104 territory) OR scopes Hub-only? Engineer recommends shim-side included as Wave 1 secondary scope
3. **Vertex-cloudrun architect coverage** — intentionally OUT (architect uses real LLM; not mock-harness-targetable)

## Effort class

**L** (engineer-authoritative).

Rationale: 3 waves × 1-2 weeks each = ~4 weeks engineer-claimable. Wave 1 + 3 combined are S+S; Wave 2 is M.

## Related Concepts / Defects

### Concepts advanced

- §2.4 Manifest-as-Master
- §2.7 Layered Certification

### Defects resolved

- sym-B-004 (workflow-testing gap; Phase 2 top-score 15/25; observability cluster)
- 28 `Tested By: NONE` invariants from workflow-registry §7.2
- Foundation-of-Sand (§3.8 Integrity cluster)
- Debugging Quicksand (§3.8)
- Happy-Path Brittleness (§3.9 Chaos)
- Regression Leakage (§3.9)
- Hope-Based Engineering (§3.9)
- Doc-Code Drift (§3.3 Drift; partial)
- Phantom State (§3.3; partial)
- Hidden State Problem (§3.2 State/Memory Loss; partial)
- Silent Drift (§3.2; partial)
- Non-Actionable Failure (§3.7 Resilience; partial)

## Filing metadata

- **Status at file:** `proposed` (Mission FSM default; Director release-gate per Phase 4 §10.6)
- **Document ref:** `docs/reviews/2026-04-phase-4-briefs/m-workflow-test-harness.md`
- **Director activation:** requires explicit Director "ready to release" signal per-mission; no architect auto-flip to `active`
- **Correlation:** Phase 4 winner #1

---

*End of M-Workflow-Test-Harness final brief (architect-engineer sealed Pass 4). Awaits Director final ratification → architect files via create_mission.*
