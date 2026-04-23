# Mission: M-Invariant-Coverage-v3 *(draft)*

**Status:** Draft — not yet ratified. Filed 2026-04-23 per Director direction post-mission-41 closure. Awaits formal review or explicit activation signal before Hub filing as `proposed`.
**Type:** Mission brief draft.
**Mission class:** follow-up to mission-41; absorbs 7 of the 24 mission-41 Wave-3 follow-up ideas (workflow + cross-domain + 1 system invariant).

---

## Name

**M-Invariant-Coverage-v3** (workflow invariants + cross-domain + single system invariant)

---

## Tele served

| Tele | Role | Why |
|---|---|---|
| tele-2 Isomorphic Specification | primary | Workflow-level spec↔runtime bridge; cross-domain spec↔runtime parity |
| tele-9 Chaos-Validated Deployment | primary | Workflow tests with chaos paths complement mission-41 WF-001/005 coverage |
| tele-8 Gated Recursive Integrity | secondary | Cross-domain gate surface extends mechanically |
| tele-6 Frictionless Agentic Collaboration | secondary | Workflow invariants pin multi-agent collaboration patterns |

**Tele-leverage score: 4.**

---

## Concept-grounding (Phase 3 register)

- **Manifest-as-Master (§2.4)** — primary (continues mission-41's spec-runtime work)
- **Layered Certification (§2.7)** — primary (cross-domain gate extends certification across entity boundaries)
- **Hub-as-Conductor (§2.3)** — partial (workflow invariants exercise Hub orchestration contracts)

---

## Goal

Close the workflow + cross-domain portions of the `workflow-registry.md §7.2 NONE` surface remaining after mission-41 + Mission-A. 7 invariants covered: 1 system + 4 workflows + 2 cross-domain. Each has a distinct test-surface requirement (unlike Mission-A's uniform-shape entity tests) — higher spec-read overhead per invariant.

**Handoff rationale:** Mission-A closes the entity-layer surface cleanly; Mission-B picks up the more heterogeneous workflow + cross-domain surface. Some invariants require LLM integration (WF-005a) — engineer judgment at implementation-time whether to consume Mock*Client per mission-41's T2 discipline.

---

## Scope

Mission ships in **3 batches** (different shape than Mission-A due to heterogeneous invariant types):

### Batch 1 — Single system invariant + pre-reeval (~1-2 days)

2 tasks: one new test, one reeval.

| Task | INV | Absorbs idea | Notable |
|---|---|---|---|
| T1 | INV-SYS-003 | idea-167 | System invariant; test-shape TBD at implementation (likely TestOrchestrator-level with multi-entity setup) |
| T2 | WF-005b reeval | idea-170 | ⚠️ **Partial coverage already in `e2e-convergence-spawn.test.ts`** — engineer reviews; if covered, marks via spec-fold; if not covered, authors dedicated test. Save-work candidate. |

### Batch 2 — Workflow invariants (~3-4 days)

4 tasks; distinct from mission-41's WF-001/005 coverage (those were chaos paths; these are happy-path + deterministic coverage).

| Task | INV | Absorbs idea | Notable |
|---|---|---|---|
| T3 | WF-005a | idea-169 | **LLM integration test surface candidate** — architect auto-directive via convergence without pre-declared action. Engineer judgment: vertex-cloudrun fixture or scripted architect via Mock*Client. |
| T4 | WF-006 | idea-171 | Workflow shape requires spec-read before test-authoring; scope-decision deliverable at task start |
| T5 | WF-008 | idea-172 | Same class as WF-006; scope-decision at start |
| T6 | WF-005a ADR (optional) | — | If LLM integration test surface proves non-trivial at T3, open ADR for the pattern (similar to mission-42 Task 4's bug-23 ADR-first protocol). Defer actual test until ADR ratified. |

**Note:** T6 is conditional — only if T3 surfaces test-infrastructure decision larger than the test itself. Engineer flags at T3 start.

### Batch 3 — Cross-domain invariants (~1-2 days)

2 tasks; likely shared setup (pair per engineer note in idea-174).

| Task | INV | Absorbs idea | Notable |
|---|---|---|---|
| T7 | XD-006a | idea-173 | Cross-domain test; test-shape decision at start (policy-router vs orchestrator vs Mock*Client for multi-agent) |
| T8 | XD-006b | idea-174 | Pair with T7; shared setup, distinct assertions |

### Out of scope

- Entity invariants (TH8/TN1/TE1/TE2/A1/A2/D1/D2) — Mission-A
- System invariants INV-SYS-010..017 (LLM integration cluster) — Mission-C
- Task-FSM invariants T9/T10/T11/T12 — Mission-A Batch 3
- Workflow chaos-path coverage for WF-001/005 — already shipped in mission-41 Wave 3 T2
- New test-infrastructure — consumes mission-41 harness as-is

---

## Success criteria

1. **7 invariants covered:** 1 system + 4 workflow + 2 cross-domain (1 may be spec-fold if WF-005b reeval finds existing coverage sufficient)
2. **Scanner output:** 7 new `Tested` rows (or 6 tests + 1 spec-fold mark for WF-005b)
3. **Hub suite regression-clean**
4. **ADR filed if T6 triggers:** LLM-integration-test pattern formalized (mission-42 ADR-022 precedent)
5. **Mock*Client consumption documented:** per-test decision (WF-005a likely yes; others per engineer judgment)
6. **Idea resolutions:** 7 absorbed ideas (167, 169-174) marked `incorporated`

---

## Dependencies

| Prerequisite | Relationship | Notes |
|---|---|---|
| mission-41 completion | hard prereq (done) | Harness + helper + scanner + CI infrastructure live |
| Mission-A | soft precedence | Mission-A's entity-tests extend the helper surface; Mission-B can reference; no hard block |
| mission-42 bug-28 fix | soft precedence | DAG primitive becomes usable; if shipped, cross-domain XD-006a/006b can use `dependsOn` pairing; otherwise flat DAG |

### Enables (downstream)

| Post-mission work | How |
|---|---|
| Mission-C preparation | WF-005a LLM integration work may surface test-infrastructure patterns useful for agent-behavior-invariants mission |
| Workflow-scope completeness | workflow-registry.md §7.2 NONE surface shrinks to the final SYS-010..017 cluster |

---

## Engineer-flagged scope decisions (for Director)

1. **WF-005b reeval vs new test** (T2) — if `e2e-convergence-spawn.test.ts` coverage is sufficient, spec-fold-only (saves ~0.5 day). Engineer judgment at implementation time.

2. **LLM integration test infrastructure for WF-005a** (T3) — TestOrchestrator with scripted architect OR Mock*Client with scripted LLM responses OR vertex-cloudrun fixture? Engineer recommends staged: start with TestOrchestrator + scripted architect (cheapest); escalate to ADR if insufficient. Related to Mission-C's LLM-integration infrastructure decision.

3. **Cross-domain test surface** (T7/T8) — policy-router vs orchestrator vs Mock*Client? Engineer judgment; document in task report.

4. **T6 ADR conditional** — formalize pattern mid-mission OR defer to post-mission retrospective? Engineer recommends formalize mid-mission if T3 shows non-trivial infrastructure needs (matches mission-42 Task-4 ADR-first discipline).

---

## Effort class

**M-L** (~1.5 engineer-weeks).

Rationale: Spec-read overhead per invariant is higher than Mission-A's uniform-shape tests. Plus WF-005a likely triggers test-infrastructure decision requiring ADR time. Plus ~1-2 days for conditional ADR authoring. Total ~6-8 engineer-days.

Could shrink to M (~1 week) if WF-005b reeval saves work + WF-005a LLM integration decision is straightforward.

---

## Related Concepts / Defects

### Concepts advanced

- §2.4 Manifest-as-Master (continues)
- §2.7 Layered Certification (cross-domain extends)
- §2.3 Hub-as-Conductor (workflow invariants pin orchestration contracts)

### Defects resolved

- §7.2 NONE surface reduction (7 of remaining 11 after Mission-A)
- Workflow-level spec-runtime drift (5 workflow invariants under coverage)
- Cross-domain gate opacity

### Ideas absorbed

idea-167, 169, 170, 171, 172, 173, 174 (7 ideas)

---

## Filing metadata

- **Status at draft:** not filed to Hub
- **Graduation trigger:** Director release-gate signal OR formal retrospective incorporation
- **Brief location:** `docs/planning/m-invariant-coverage-v3-brief-draft.md`
- **Prerequisite completion:** mission-41 closed; Mission-A completion soft-preferred

---

*Draft brief v0.1 authored 2026-04-23 per Director direction. Heterogeneous-shape mission (unlike Mission-A's uniform entity-test pattern); engineer-judgment-density higher per task.*
