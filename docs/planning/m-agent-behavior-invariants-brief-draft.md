# Mission: M-Agent-Behavior-Invariants *(draft)*

**Status:** Draft — not yet ratified. Filed 2026-04-23 per Director direction post-mission-41 closure. Awaits formal review + **ADR-first protocol ratification** before Hub filing as `proposed`.
**Type:** Mission brief draft.
**Mission class:** distinct-shape follow-up to mission-41; absorbs idea-168 (the INV-SYS-010..017 cluster — 8 invariants requiring LLM integration testing per spec §6.3 recommendation).
**ADR requirement:** this mission's scope includes a **prerequisite ADR** on the LLM-integration test-infrastructure pattern — distinct from mission-41's policy-layer test surface. Mission execution gated on ADR ratification per mission-42 ADR-022 precedent.

---

## Name

**M-Agent-Behavior-Invariants** (LLM integration coverage for the SYS-010..017 cluster)

---

## Tele served

| Tele | Role | Why |
|---|---|---|
| tele-11 Cognitive Minimalism | primary | Agent-behavior invariants encode the substrate-first boundary — tests verify LLM stays in its cognitive lane |
| tele-12 Precision Context Engineering | primary | Per-invocation context-shape invariants need LLM-integration test surface to verify |
| tele-2 Isomorphic Specification | primary | §6.2 8 system invariants currently NONE — spec↔runtime gap is 100% for this cluster |
| tele-7 Resilient Agentic Operations | secondary | Agent-behavior failure modes get mechanized gates |
| tele-9 Chaos-Validated Deployment | secondary | LLM-integration chaos paths become testable |

**Tele-leverage score: 5.**

---

## Concept-grounding (Phase 3 register)

- **Substrate-First Logic (§2.2)** — primary (agent-behavior invariants ARE the tele-11 operational boundary in testable form)
- **Precision Context Engineering (§2.6)** — primary (per-invocation context-shape invariants)
- **Layered Certification (§2.7)** — partial (new certification layer: agent-behavior invariants are distinct from entity or workflow invariants)
- **LLM-Integration Test Pattern** — new sub-concept introduced by this mission; formalized via prerequisite ADR

---

## Goal

Close the `workflow-registry.md §6.2` 8-invariant system-invariant cluster (INV-SYS-010 through INV-SYS-017) via a distinct-shape test approach: **LLM integration testing**. Per workflow-registry §6.3 explicit recommendation: *"Agent behavior invariants (INV-SYS-011 through INV-SYS-017) require LLM integration testing — scope for a separate mission."*

This mission IS that separate mission. Scope includes: (1) prerequisite ADR on the LLM-integration test-infrastructure pattern; (2) scaffolding the test harness for LLM-deterministic testing; (3) authoring the 8 invariant tests once the pattern is ratified.

**Distinct mission shape rationale:** mission-41 Wave-2 tests used `TestOrchestrator` policy-layer surface; mission-41 T3/T4 built Mock*Client as shim-side infrastructure. Agent-behavior invariants need a third surface — **scripted-LLM-response integration** — which is distinct from both. Needs architectural design before implementation.

---

## Scope

**Two-phase mission:** ADR phase (architect-led, ~2-3 days) → Implementation phase (engineer-led, ~3-4 weeks).

### Phase 0 — Prerequisite ADR (architect-led; blocks Phase 1)

Architect drafts ADR comparing LLM-integration test-infrastructure options. The architect-first ADR pattern matches mission-42 bug-23 ADR-022 precedent.

**ADR decision surface:**

| Option | Shape | Tradeoff |
|---|---|---|
| A | Scripted architect via `Mock*Client` (extends mission-41 T3/T4 harness with LLM-response scripting) | Low infrastructure cost; limited fidelity; tests the harness, not the real LLM |
| B | vertex-cloudrun fixture (real Gemini LLM in deterministic test harness) | High fidelity; non-deterministic; real-token cost per test-run; flaky-risk |
| C | Recording-and-replay fixture (record real LLM responses once; replay deterministically) | Best-of-both; significant infrastructure cost; test-maintenance overhead when LLM behavior drifts |

Director ratifies the option; Phase 1 implementation proceeds.

### Phase 1 — 8 invariant tests (engineer-led, ~3-4 weeks)

Per SYS-010..017 — agent-behavior invariants. Specific tests depend on ADR outcome; high-level shape:

| INV | Nature | Expected test shape (provisional) |
|---|---|---|
| INV-SYS-010 | Agent behavior start-condition | LLM-integration test; verifies pre-condition before cognitive invocation |
| INV-SYS-011..015 | Agent behavior mid-execution invariants (5 invariants) | Tests per INV; verify LLM stays in cognitive lane, doesn't breach substrate boundary |
| INV-SYS-016..017 | Agent behavior completion invariants (2 invariants) | Tests per INV; verify post-execution contract holds |

Batch shape TBD after ADR — may be 1 batch of 8 tests, or 3 batches by invariant-phase (start/mid/complete).

### Coverage report + CI gate extension

- Scanner extended to index SYS-* invariants alongside INV-* entity + workflow invariants (defers idea from mission-41 Wave-3 T2 scanner-extension item)
- CI gate includes SYS-* invariant test runs as part of the merge-block surface

### Out of scope

- INV-SYS-003 — covered by Mission-B (not an agent-behavior invariant)
- Other test-infrastructure changes (Mock*Client restructure, TestOrchestrator refactor, etc.) — bundled ONLY if ADR ratifies an option that requires them
- Test-harness for future agent-behavior invariants beyond SYS-010..017 — this mission ships the 8; future coverage work is a separate mission
- vertex-cloudrun deploy changes — unless ADR ratifies Option B and a deployment surface update is required

---

## Success criteria

1. **ADR filed + ratified:** LLM-integration test-infrastructure pattern ratified by Director; ADR document committed under `docs/decisions/`
2. **Test-infrastructure scaffolded:** per ratified ADR shape; ready to author invariant tests
3. **8 invariant tests shipped:** SYS-010 through SYS-017 covered; all pass
4. **Scanner extended:** indexes SYS-* invariants; coverage report includes agent-behavior surface
5. **CI gate extended:** SYS-* invariant test runs part of merge-block
6. **Hub suite regression-clean**
7. **Idea resolution:** idea-168 marked `incorporated` (covers 8 invariants in 1 idea entry)
8. **Test-pattern documented:** closing audit captures the LLM-integration test pattern as a reference for future agent-behavior coverage work

---

## Dependencies

| Prerequisite | Relationship | Notes |
|---|---|---|
| mission-41 completion | hard prereq (done) | Baseline harness + scanner infrastructure |
| mission-44 completion | **soft prereq** (on-hold) | idea-107 M-Cognitive-Hypervisor scope; mission-44 lands Phase E pre-hydration + state reconciliation; this mission's agent-behavior invariants may verify mitigation effectiveness |
| Mission-A completion | not blocking | Independent test-class (entity vs agent-behavior) |
| Mission-B completion | not blocking | Independent test-class (workflow vs agent-behavior) |

### Enables (downstream)

| Post-mission work | How |
|---|---|
| Tele-11 Cognitive Minimalism empirical validation | Agent-behavior invariant tests are the constitutional-layer verification |
| Tele-12 Precision Context Engineering empirical validation | Context-shape invariants get mechanical gates |
| Future agent-behavior invariants | LLM-integration test pattern established; future coverage work extends |
| idea-168 resolution | 8-invariant cluster closed |
| idea-107 M-Cognitive-Hypervisor broader phases | Agent-behavior invariant surface supports future cognitive-layer work |

---

## Engineer-flagged scope decisions (for Director)

*(Most substantive decisions are architect-led at ADR phase; listed here for completeness.)*

1. **ADR option ratification** (Phase 0) — architect-drafted ADR presents Options A/B/C; Director ratifies. Architect recommendation will depend on vertex-cloudrun stability + token-cost signals available at ADR-drafting time.

2. **Test batching** (Phase 1) — 1 batch of 8 tests OR 3 batches by invariant-phase? Engineer judgment post-ADR; depends on test-infrastructure shape from ratified option.

3. **Scanner extension scope** — SYS-* indexing only, OR SYS-* + WF-* + XD-* unified scanner update? Bundled scope decision; engineer recommendation at implementation time. Scanner-v2 idea flagged in mission-41 Wave 3 T2 is candidate bundle.

4. **Success criterion for invariant coverage vs mitigation effectiveness** — should the tests verify mitigation effectiveness (tie back to mission-38 + mission-44 token-budget rate reductions) OR purely encode invariant semantics? Architect recommends: invariant semantics primary; mitigation effectiveness is a separate telemetry concern not in test scope.

---

## Effort class

**L-XL** (~3-4 engineer-weeks + 2-3 architect-days for ADR).

Rationale:
- ADR phase: 1-2 days architect drafting + 1 day Director ratification + 1 day engineer digestion = ~3-4 days
- Phase 1 implementation: 8 invariant tests × ~3 days each = ~3-4 weeks (LLM-integration tests are higher per-test overhead than policy-layer tests)
- Scanner extension + CI gate: ~1 week (new test-class integration)

**If ADR ratifies Option C (recording-and-replay):** effort could extend to XL (add ~1-2 weeks for recording fixture implementation).

**If ADR ratifies Option A (scripted Mock*Client):** effort stays at L (scripting is incremental on existing harness).

---

## Related Concepts / Defects

### Concepts advanced

- §2.2 Substrate-First Logic (primary — agent-behavior invariants test the substrate boundary)
- §2.6 Precision Context Engineering (primary — per-invocation context invariants testable)
- §2.7 Layered Certification (extends to agent-behavior layer)
- **LLM-Integration Test Pattern** — new sub-concept formalized by this mission's prerequisite ADR

### Defects resolved

- §6.2 INV-SYS-010..017 full cluster (8 invariants, currently 100% NONE coverage)
- **Untested agent-behavior class** — the class of bugs where LLM drifts outside its cognitive lane becomes mechanically gated
- Cognitive Economy cluster (§3.11) — partial (tests verify mitigation-class effectiveness)

### Ideas absorbed

idea-168 (1 idea entry covering 8 invariants)

---

## Filing metadata

- **Status at draft:** not filed to Hub
- **Graduation trigger:** Director release-gate signal AFTER ADR phase ratification
- **Brief location:** `docs/planning/m-agent-behavior-invariants-brief-draft.md`
- **Prerequisite completion:** mission-41 closed; mission-44 soft-preferred for context

---

## ADR-first protocol reminder (per mission-42 ADR-022 precedent)

This mission follows the ADR-first protocol established by mission-42 Task 4 (bug-23 ADR-022 for bilateral-seal race). The architectural substance is the test-infrastructure shape, not the invariant tests themselves. Per Phase 4 retrospective co-authoring cadence + field-ownership split:

- **Architect authority:** Test-infrastructure pattern (Options A/B/C); ADR drafting; Concept-grounding (Substrate-First, Precision Context); LLM-integration pattern naming
- **Engineer authority:** Per-invariant test scope + sequencing; test-batching decisions post-ADR; scanner extension implementation; scope-decision escalations
- **Director authority:** ADR option ratification; release-gate signal

Mission execution cannot start until ADR ratified. Per mission-42 Task-4 kickoff-decisions precedent: architect drafts ADR in parallel with any prerequisite engineering work (no prerequisites identified here beyond mission-44 soft-dependency). Director ratifies; engineer implements ratified shape.

---

*Draft brief v0.1 authored 2026-04-23 per Director direction. Distinct-shape mission compared to Mission-A/B; requires prerequisite ADR before engineer execution. Rough-scale the largest of the three follow-up drafts (L-XL vs M and M-L).*
