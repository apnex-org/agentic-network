# ADR 032 — K8s Envelope Cutover (STUB)

**Status:** STUB — architect-author post-cutover-execution per thread-648 R2 disposition Q6
**Decision-record-of-permanence:** mission-88 production cutover from legacy-flat substrate shape to K8s envelope shape
**Date:** TBD (architect fills post-cutover)

---

## Context

mission-88 (M-K8s-Envelope; idea-126 anchor) shipped 6 production PRs (W0 substrate-prep + W1-W5 cluster waves + W6 cutover-script) realizing idea-126 Phase 4 Design across all 21 substrate-mediated entity kinds:

- W0: substrate-prep primitives (envelope library + MigrationCursor + runner)
- W1: cluster-1 substantive-content (Idea/Bug/Thread/Mission/Proposal)
- W2: cluster-2 queue/FSM-active (Task/PendingAction/Turn)
- W3: cluster-3 metadata/config/projection (Agent/Tele/SchemaDef/Counter) + atomic SubstrateCounter rewrite
- W4: cluster-4 system-emit/bookkeeping (Message/Audit/RepoEventBridge*) + atomic RepoEventBridge adapter rewrite + Message.kind CANONICAL field-name-collision rename
- W5: cluster-5 content-archive (Document/ArchitectDecision/3 HistoryEntry) — FINAL cluster
- W6: production cutover-script + entity-kinds.json v1.3 → v2.0 bump + closing artifacts

## Decision

Cutover executed at TBD (architect-fills ISO timestamp post-cutover-execution):
- Hub container image: TBD (architect-fills image hash)
- MigrationRunner across 21 kinds: TBD entities migrated in TBD seconds
- SchemaDef strict-mode flip: SUBSTRATE_ENVELOPE_TOLERANT env-var unset (W0 primitive design-driver flip-point)
- Per-kind shape probe: TBD/TBD kinds passed envelope-shape assertion
- bug-118 closure verification: TBD with_provenance across 8 cascade-spawn-shaped kinds
- Per-cluster write smoke: TBD/5 cluster-classes passed
- Outcome: TBD (SUCCESS / FORWARD-FIX / ROLLBACK)

## Consequences

**Positive:**
- All 21 substrate-mediated entity kinds carry K8s envelope shape uniformly post-cutover
- bug-118 envelope-level provenance surface available across 8 cascade-spawn-shaped kinds
- 7 cumulative envelope-methodology patterns articulated as cross-cluster reusable patterns
- idea-121 `get_resource_shape` substrate-foundation ready
- idea-200 M-Thread-Substrate-Carve-Out + idea-151 M-Graph-Relationships compose on top
- Substrate-currency-discipline matured across 5 clusters (engineer-proactive verify-before-bake LOAD-BEARING)

**Mitigated:**
- bug-118 (substrate-wide bug-lineage gap; forward-only per anti-goal 11)
- Substrate-shape inconsistency (legacy-flat across 21 kinds; uniform K8s envelope post-cutover)

**Deferred:**
- M-SchemaDef-Reconciler-Status-Write-Patch (cluster-3 A2 OQ10 deferred reconciler-side WRITES)
- idea-200 W2 Thread.status.messages carve-out (composition with cluster-1 §3.3)
- idea-151 Relationship-kind extraction (FK pointer edge-extraction across multiple clusters)

## References

- **Mission:** mission-88
- **Survey:** `docs/reviews/2026-05-23-survey-idea-126.md` (Director-ratified R1 A/A/A + R2 A/A/A)
- **5 cluster Designs:** `docs/designs/m-k8s-envelope-cluster-{1,2,3,4,5}-*.md` (all v0.3 substrate-truth-ratified)
- **Closing audit:** `docs/audits/m-k8s-envelope-closing-audit.md`
- **Cutover script:** `scripts/operator/m-k8s-envelope-cutover.sh`
- **psql-cookbook:** `docs/operator/psql-cookbook.md` §"Envelope-shape queries" (bug-118 closure query)
- **Work-trace:** `docs/traces/m-k8s-envelope-work-trace.md` (per-wave-shipped state + calibration cluster maturity record)

---

**Architect to fill post-cutover-execution.** Final ADR text + cutover-timestamp + image hash + outcome.
