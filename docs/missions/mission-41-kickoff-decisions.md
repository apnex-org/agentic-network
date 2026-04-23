# Mission-41 Kickoff Decisions

**Mission:** M-Workflow-Test-Harness (mission-41)
**Brief:** `docs/reviews/2026-04-phase-4-briefs/m-workflow-test-harness.md`
**Preflight:** `docs/missions/mission-41-preflight.md`
**Ratified:** 2026-04-23 by Director
**Path:** preflight YELLOW → ratify decisions → preflight GREEN → `update_mission(status="active")`

---

## Purpose

Capture the 3 engineer-flagged scope decisions that Mission-41's brief deferred to Director + architect ratification at kickoff. This artifact is the authoritative record of the resolution — referenced if mid-mission questions arise about scope choices.

---

## Decision 1 — Wave 2 invariant subset (substantive)

**Decision:** Wave 2 covers the following 10 invariants (Option C hybrid per preflight recommendation):

| # | Invariant | Category | Current spec state |
|---|---|---|---|
| 1 | **INV-TH18** | Workflow | `TBD — M-Phase2-Impl` (true NONE; no existing coverage) |
| 2 | **INV-TH19** | Workflow | `TBD — M-Phase2-Impl` (true NONE; validate-then-execute cascade atomicity) |
| 3 | **INV-T4** | Entity (Task) | `NONE` — terminal states (completed/failed/escalated/cancelled) |
| 4 | **INV-P1** | Entity (Proposal) | `NONE` — architect-only review |
| 5 | **INV-P2** | Entity (Proposal) | `NONE` — only submitted proposals reviewable (no status guard today) |
| 6 | **INV-P4** | Entity (Proposal) | `NONE` — `implemented` is terminal |
| 7 | **INV-TH6** | Entity (Thread) | `NONE` — non-active thread replies rejected |
| 8 | **INV-TH7** | Entity (Thread) | `NONE` — architect-only `close_thread` stewardship |
| 9 | **INV-I2** | Entity (Idea) | `NONE` — idea invariant |
| 10 | **INV-M4** | Entity (Mission) | `NONE` — mission invariant |

**Rationale:**
- INV-TH18/19 close the **multi-actor workflow gaps** that no test exercises today — highest-leverage coverage for the mock-harness itself. Ratified in thread-125 as P2 spec; shipping but untested.
- 8 entity-invariant NONEs align with `workflow-registry.md` §7.3 recommendation: *"Immediate: write E2E tests for all entity invariant gaps — pure policy tests, no LLM or transport needed"*. Lowest friction per test; can proceed in parallel with Wave 1 infrastructure completion.
- Existing positive-path tests for INV-TH16/17 left alone; negative-rejection + edge-case extensions on those are deferred as a post-mission follow-up idea.

**Tradeoff accepted:** This subset touches both policy-level (entity invariants) and workflow-level (TH18/19) surfaces, requiring both the Hub testbed and the mock-harness to be functional. The 8 entity tests are pure policy and can start without Wave 1 completion; the 2 workflow tests need mock-harness operational (Wave 1 deliverable). Natural staging.

**Coverage math:** 10/28 = 36% of the spec's `NONE` gap closed in Mission-41 v1. Remaining 18 invariants filed as follow-up ideas per brief Wave 3 scope.

---

## Decision 2 — Wave 1 adapter coverage scope

**Decision:** Wave 1 **includes shim-side coverage** — `MockClaudeClient` + `MockOpenCodeClient` drive the real `adapters/claude-plugin/src/proxy.ts` and `adapters/opencode-plugin/hub-notifications.ts` code over loopback transport.

**Rationale:**
- Matches brief's original scope (engineer-recommended)
- Preserves idea-104 partial-absorb claim — if shim-side excluded, the adapter gap persists and idea-104 stays fully open
- Enables the cross-shim parity tests cited in success criterion #3 (at least 2 of 4 Mission-42 bug-fixes use #1 Wave 1 infrastructure)
- Allows bug-12 (PolicyLoopbackHub drift) to co-land in Wave 1 cleanly

**Tradeoff accepted:** Wave 1 ~1 week engineer-S (as briefed) rather than ~3-4 days Hub-only. The extra time buys cross-cutting leverage for downstream missions.

---

## Decision 3 — vertex-cloudrun architect coverage

**Decision:** **OUT of scope** for Mission-41 (confirms brief §Out of scope position).

**Rationale:**
- vertex-cloudrun uses a real Gemini LLM — non-deterministic outputs incompatible with mock-harness determinism assumption
- LLM-response mocking would be a large separate scope (idea-75's `smoke-prod` preset territory, or idea-42's live-environment agents)
- Including it would bloat Mission-41 from L to XL and dilute the invariant-coverage focus

**Follow-up:** vertex-cloudrun test coverage remains an open gap. Candidate for future mission under idea-75 `smoke-prod` preset or idea-42 chaos/load scenarios.

---

## Downstream effects on brief interpretation

- **Success criterion #1 (≥10 of 28 invariants):** ratified subset above (10 exactly)
- **Success criterion #3 (CI gate):** unchanged
- **Success criterion #5 (`workflow-registry.md §7 Tested By column`):** 10 rows updated at Wave 3
- **Wave 1 scope:** includes shim-side (decision 2)
- **Wave 2 start-eligibility:** 8 entity tests can start as soon as Hub testbed extended (mid-Wave 1); 2 workflow tests (TH18/19) start post-Wave-1

## Filing metadata

- **Authority:** Director ratification via chat signal, 2026-04-23
- **Preflight updated:** `docs/missions/mission-41-preflight.md` verdict YELLOW → GREEN
- **Next step:** architect issues `update_mission(missionId="mission-41", status="active")` per §10.6 release-gate protocol
- **Archive:** this document is immutable post-ratification; any subsequent scope changes require new mission-scoped decision document

---

*Kickoff decisions ratified and filed. Mission-41 is operationally released.*
