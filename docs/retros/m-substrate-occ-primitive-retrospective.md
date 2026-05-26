# M-Substrate-OCC-Primitive — Phase 10 Retrospective (Walkthrough)

**Mission:** mission-89 (M-Substrate-OCC-Primitive; idea-322 anchor)
**Mode:** Architect-lean Walkthrough (per mission-88 substrate-introduction-class precedent)
**Date:** 2026-05-26
**Author:** lily (architect); Director ratifies.
**Closing audit cross-reference:** `docs/audits/m-substrate-occ-primitive-closing-audit.md`

---

## Mission in one sentence

Extract OCC-class concurrency control (assertIdentity + Counter) from per-call retry-loops into a substrate-layer `withAdvisoryLock` primitive, then propagate envelope-aware consumer-code-audit across Hub-policy to close the dormant downstream defects (bug-127 + bug-137 + bug-138 Agent slice).

## Outcome

- 4 PRs (#300/#301/#302/#303) merged + retirement PR (#304); ~6hr Design-dispatch-to-close
- bug-127 PRODUCTION-VERIFIED-CLOSED via bypass-tool register_role on pre-existing envelope-shape Agent row
- bug-137 PRODUCTION-VERIFIED-CLOSED via the closure call itself (update_bug succeeded via MCP without psql workaround = dispositive)
- bug-138 Agent slice + 5 entity-repo cascade-key class CLOSED; systemic remainder filed as idea-323
- bug-97 architectural-improvement (Counter primitive-serialized; mission-83 W5.5 fix retained as cross-domain handler)
- 49 new tests; full hub suite 1909/1909 passing

## Load-bearing methodology #25 (capstone)

**Substrate-primitive-extraction is necessary-but-not-sufficient — per-callsite envelope-aware-audit must companion-ship.**

The arc:
1. mission-83 W5.5 closed bug-97 via per-call CAS retry-loop — symptom resolved, architectural-pattern un-rationalised
2. mission-89 Phase 1+2 extracted the serialization concern into substrate-layer `withAdvisoryLock` primitive (testcontainer-verified; passes all primitive unit + integration tests)
3. Deployment dispositive verify (`register_role` against envelope-shape Agent) **FAILED** — surfaced bug-138 (substrate.list filter envelope-blind class)
4. Phase 2-extension (PR #301) added envelope-aware Agent read+write → bug-127 PRODUCTION-VERIFIED-CLOSED
5. Phase 4 (PR #303) propagated envelope-aware audit across 22 status-comparison sites in Hub-policy → bug-137 PRODUCTION-VERIFIED-CLOSED

The lesson: a substrate-layer primitive shipped clean is dormant if downstream consumer code can't read the substrate's data shape. Primitive-extraction must companion-ship with per-callsite envelope-aware-audit (or whatever shape-correctness audit the new primitive's data envelope requires). Without this, the primitive ships passing tests but failing production at the consumer call-sites.

## Sub-disciplines surfaced

### Sub-discipline #1 — Concurrency-test invariant discipline

Advisory-lock concurrency tests must pin to INVARIANTS (set-membership / monotonicity / no-interleaving / timeout-fired) NOT exact-timing or exact-ordering. Two CI flakes this mission confirmed: PR #301 serialization-order strictness (asserted exact A-first; reality races); PR #303 timing-floor strictness (asserted timeout >= 30ms; setTimeout jitter produced 29ms). Both fix-ups asserted invariant correctness without over-specifying timing or which-goes-first.

### Sub-discipline #2 — Dual-lookup pattern at filter-layer

Companion to mission-88 W9 Q4 keep-legacy-branch refinement (READ-side defensive coerce). Substrate-aware repository methods should ALSO do dual-shape filter lookups (envelope-first + legacy-fallback), not just dual-shape READS. Defense-in-depth for the dual-shape data window during gradual migration.

### Sub-discipline #3 — Engineer-side mid-impl scope-cut as load-bearing authority

PR #303 expanded mid-impl to 22 status-compare sites + 5 entity-repo cascade-key dual-lookups, but engineer cut at deferring per-entity envelope-aware wrappers, task-repo internal reads, sweepers, and PendingAction/Message/Thread filters. Surfaced explicitly in PR description + dedicated comment for architect ratify. **Engineer-side scope-cut decisions are load-bearing** when the load-bearing test target (bug-137 closure) is achieved AND the remaining scope is non-blocking AND surfaced explicitly for architect ratify.

This is the mirror of the architect-side mid-cycle scope-expansion pattern (calibration sibling-of #15). Together they form the explicit-scope-negotiation methodology: both sides have authority to expand or contract scope mid-cycle, provided the change is surfaced to the other party for ratification.

### Sub-discipline #4 — Test-fixture pre-cutover landmines

PR #301 surfaced `mutateAgentBlob` + `offlineAgentSeenAt` fixtures producing mixed-shape data via `{...envelope, ...legacy-flat-patch}` spread. PR #303 surfaced cascade-idempotency + pulse-sweeper tests seeding legacy-shape rows. **Methodology candidate (defer to next architect-Director-bilateral):** prescribe an envelope-aware test-fixture helper pattern OR force fixtures through the migration pipeline (creates SchemaDef-reconciler path for the kind, then writes via repo APIs) — tests that bypass the migration pipeline are perpetually drift-prone post-cutover.

## Lifecycle observations

- **Survey skipped per Director route-a** ("essentially to address a bug and a defect"). Validates the route-a skip-criteria — when scope is bug+defect-shaped + lean-defaults clearly apply, Survey overhead is unnecessary.
- **Dual-channel coordination held throughout** — PR-comment + Hub-note redundancy. Critical when shim-comms intermittent (callToolGate wedge during initial PR #300 dispositive); held discipline even after shim recovered.
- **Architect-engineer coordination cadence** — milestone surfaces (PR-opened / CI-status / halt-cross-pings) worked cleanly. Mid-impl surface on PR #303 was the engineer-initiated escalation that produced sub-discipline #3.
- **Director engagement** — Phase 3 Survey (route-a skip) + Phase 4 Design ratify + Phase 10 Retrospective (this doc). No Director-engagement during execution — fully bilateral architect-engineer per RACI.

## Calibration filings (candidate; defer to architect-Director-bilateral per ledger discipline)

- Methodology #25 capstone (substrate-primitive-extraction necessary-but-not-sufficient)
- Sub-discipline #1 (concurrency-test invariant discipline; companion to existing test-assertion calibrations)
- Sub-discipline #3 (engineer-side mid-impl scope-cut as load-bearing authority; sibling of architect-side #15)
- Sub-discipline #4 (test-fixture pre-cutover landmines; methodology candidate)

## Follow-on missions filed

- **idea-323** M-Substrate-List-Filter-Envelope-Translation — substrate.list query-builder reads SchemaDef renameMap + translates filter keys for envelope-shape rows; closes bug-138 systemically across all 21 kinds
- **idea-324** M-Repository-Envelope-Native — per-kind envelope-aware repository wrappers (~12 kinds); removes the dual-lookup pattern in favor of cleaner encapsulation; composes with idea-323

Together these close the envelope-shape consumer-code class structurally; deferred from mission-89 per architect-engineer agreement at Design v1.0 Phase 4 cut-line.

## Director ratify

Awaiting Director ratify on:
1. Walkthrough content (this doc)
2. Methodology #25 + sub-disciplines for calibration ledger filing
3. Sub-discipline #4 as formal methodology candidate (test-fixture envelope-aware helper pattern)
4. idea-323 + idea-324 Survey-disposition (queued for next Strategic Review)
