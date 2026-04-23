# Mission: M-Invariant-Coverage-v2 *(draft)*

**Status:** Draft — not yet ratified. Filed 2026-04-23 per Director direction post-mission-41 closure. Awaits formal review or explicit activation signal before Hub filing as `proposed`.
**Type:** Mission brief draft. Graduates to ratified brief on next review cycle or Director release-gate.
**Mission class:** follow-up to mission-41 (workflow-registry invariant coverage); absorbs 12 of the 24 mission-41 Wave-3 follow-up ideas.

---

## Name

**M-Invariant-Coverage-v2** (entity invariants + task-FSM coverage)

---

## Tele served

| Tele | Role | Why |
|---|---|---|
| tele-2 Isomorphic Specification | primary | Continues the spec↔runtime bridge from mission-41; closes remaining entity-invariant NONE surface |
| tele-8 Gated Recursive Integrity | primary | Each INV added to scanner; CI merge-gate coverage surface grows mechanically |
| tele-4 Zero-Loss Knowledge | secondary | 3 implicit-coverage cases get explicit spec-fold citations (INV-T10/T11/T12 — Wave 2 INV-T4.test.ts already exercises these) |

**Tele-leverage score: 3.**

---

## Concept-grounding (Phase 3 register)

- **Manifest-as-Master (§2.4)** — primary (workflow-registry §7.2 NONE surface continues to shrink toward zero)
- **Layered Certification (§2.7)** — primary (per-INV gate extends across entity types)
- **Absence-of-API enforcement** — new sub-pattern from mission-41 closing audit; first mission to formalize the "defended by no mutation endpoint" test class

---

## Goal

Close the entity-invariant + task-FSM portions of the `workflow-registry.md §7.2 NONE` surface remaining after mission-41's ratified-10 subset. 12 invariants covered; 3 of those are spec-fold-only (implicit coverage already exists in mission-41 Wave 2 tests). Plus introduce the **absence-of-API** test pattern as a new invariant-testing shape.

**Pool-continuation rationale:** mission-41 built the infrastructure (helpers, scanner, CI gate, mock harnesses). This mission consumes that infrastructure to ratchet coverage closer to 100%. No infrastructure investment required; pure coverage work.

---

## Scope

Mission ships in **3 batches** (following mission-41 Wave-2 Batch-1 pattern):

### Batch 1 — Entity invariants, direct test pattern (~4 days)

8 new invariant tests following mission-41 Wave 2 test conventions (`hub/test/e2e/invariants/<INV-id>.test.ts`; `assertInv*` helper + test file + scanner update):

| Task | INV | Absorbs idea | Notable |
|---|---|---|---|
| T1 | INV-TH8 | idea-159 | Thread invariant; standalone |
| T2 | INV-TN1 | idea-160 | Turn `completed` is terminal |
| T3 | INV-A2 | idea-164 | ⚠️ Partial coverage already in `e2e-remediation.test.ts` — decision at implementation: extend existing or author new |
| T4 | INV-D1 | idea-165 | Document path prefix validation |
| T5 | INV-D2 | idea-166 | Document requires GCS backend (TestOrchestrator `storageBackend: "memory"` override) |

### Batch 2 — Absence-of-API invariants, new test pattern (~2 days)

3 invariants defended by mutation-endpoint absence. Introduces the **absence-of-API test pattern** — test probes for mutation endpoints + verifies absence; complements the positive/negative/edge shape from mission-41.

| Task | INV | Absorbs idea | Notable |
|---|---|---|---|
| T6 | INV-TE1 | idea-161 | Tele immutability |
| T7 | INV-TE2 | idea-162 | Tele no-delete (pair with TE1; shared setup) |
| T8 | INV-A1 | idea-163 | Audit immutability |

**Pattern candidate for mission closing-audit:** if the absence-of-API tests all share scaffolding, extract a shared helper (e.g., `assertAbsenceOfAPI(toolName)`) into `invariant-helpers.ts`.

### Batch 3 — Task-FSM coverage + spec-fold-pass-2 (~1 day)

1 new invariant test + 3 spec-column marks for already-implicit coverage:

| Task | INV | Absorbs idea | Action |
|---|---|---|---|
| T9 | INV-T9 | idea-175 | New test — DAG cascade on review approval, not report submission |
| T10 | INV-T10 | idea-176 | Spec-fold mark: already covered implicitly in mission-41 Wave 2 `INV-T4.test.ts` (4-cycle revision test exercises revisionCount increment) |
| T11 | INV-T11 | idea-177 | Spec-fold mark: already covered implicitly in mission-41 Wave 2 `INV-T4.test.ts` (escalation on revisionCount≥3) |
| T12 | INV-T12 | idea-178 | Spec-fold mark: FULLY covered implicitly (escalated terminal) |

Spec-fold marks are ~0.5 day total. Consolidated into a single commit updating `workflow-registry.md §7` rows for T10/T11/T12 with citations to the mission-41 Wave-2 test.

### Out of scope

- System invariants (INV-SYS-003 + SYS-010..017) — handled by Mission-B + Mission-C respectively
- Workflow invariants (WF-005a/005b/006/008) — Mission-B
- Cross-domain invariants (XD-006a/006b) — Mission-B
- Spec-clarification rewrites (idea-179/180/181) — opportunistic doc patch, not mission scope
- ActorFacade engineerId accessor (idea-182) — opportunistic test-infrastructure patch

---

## Success criteria

1. **9 new invariant tests shipped:** 8 entity + 1 task-FSM; all pass
2. **3 spec-fold marks:** INV-T10/T11/T12 rows in `workflow-registry.md §7` cite the existing `INV-T4.test.ts` coverage
3. **Absence-of-API pattern documented:** either shared helper extracted OR pattern described in closing audit as candidate for future helper extraction
4. **Scanner output:** scanner regenerated; 9 new INV rows flip `NONE`→`Tested`; 3 T10/T11/T12 rows flip via spec-fold
5. **Hub suite regression-clean:** no regression on existing tests
6. **Idea resolutions:** 12 absorbed ideas (159-166, 175-178) marked `incorporated` with `missionId` linkage

---

## Dependencies

| Prerequisite | Relationship | Notes |
|---|---|---|
| mission-41 completion | hard prereq (done 2026-04-23) | All helper/scanner/CI infrastructure live |
| bug-28 status | informational | Tests use `dependsOn: []` regardless per bug-28 workaround continued from mission-41 |

### Enables (downstream)

| Post-mission work | How |
|---|---|
| Absence-of-API helper extraction | If pattern repeats in future missions, helper promotes to shared test utility |
| §7.2 NONE surface reduction | 12 of remaining 18 NONE-surface invariants covered; Mission-B picks up the next 7 |
| Mission-C preparation | Demonstrates the test-pattern surface expansion (positive/negative/edge → plus absence-of-API); Mission-C's LLM integration pattern is the third shape |

---

## Engineer-flagged scope decisions (for Director)

1. **INV-A2 existing coverage decision** (partial coverage in `e2e-remediation.test.ts`) — extend existing test vs author new helper-based test? Engineer judgment at implementation; document choice in task report. Either direction acceptable; prefer dedicated helper for scanner auto-mapping consistency.

2. **Absence-of-API shared helper extraction timing** — extract helper after Batch 2 ships (3 use-cases confirmed) OR wait for future mission (Rule of Three: wait for 3rd consumer). Engineer recommends after Batch 2 — pattern is already 3 use-cases in this mission.

3. **Spec-fold commits granularity** (Batch 3) — single commit for all 3 mark-covered rows OR per-INV commits? Engineer recommends single commit; mark-covered is mechanical.

---

## Effort class

**M** (~1 engineer-week).

Rationale: 8 entity tests (engineer-S each, batch-efficient) + 3 absence-of-API tests (engineer-S with shared scaffolding potential) + 1 DAG-cascade test (engineer-S) + spec-fold pass (engineer-XS). Total ~5-6 engineer-days. Follows mission-41 Wave-2 Batch-1 cadence (~3 hours for 8 tests in mission-41) suggests actual ship will be well under budget; using brief-time estimate for safety.

---

## Related Concepts / Defects

### Concepts advanced

- §2.4 Manifest-as-Master (spec↔runtime isomorphism continues)
- §2.7 Layered Certification (entity-layer gate expands)
- **Absence-of-API enforcement** — new sub-concept for mission-41 retrospective to formalize in Phase 3 register

### Defects resolved

- §7.2 NONE surface reduction (12 of remaining 18)
- Foundation-of-Sand partial continuation from mission-41

### Ideas absorbed (will mark `incorporated` on mission close)

idea-159, 160, 161, 162, 163, 164, 165, 166, 175, 176, 177, 178 (12 ideas)

---

## Filing metadata

- **Status at draft:** not filed to Hub (draft-only)
- **Graduation trigger:** Director release-gate signal OR formal retrospective incorporation into next review's Phase 4 winners
- **Brief location:** `docs/planning/m-invariant-coverage-v2-brief-draft.md`
- **Prerequisite completion:** mission-41 closed 2026-04-23

---

*Draft brief v0.1 authored 2026-04-23 per Director direction to scaffold follow-up missions absorbing mission-41's 24 closing-audit ideas. Graduates to ratified brief on formal review incorporation or Director explicit release-gate signal.*
