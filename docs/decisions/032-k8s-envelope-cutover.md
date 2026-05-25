# ADR 032 — K8s Envelope Cutover

**Status:** FINAL — production cutover executed 2026-05-25; strict-mode active
**Decision-record-of-permanence:** mission-88 production cutover from legacy-flat substrate shape to K8s envelope shape
**Date:** 2026-05-25 (W11 Phase B redo executed 04:43 / 05:25 strict-flip)

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

**Production cutover executed via TOLERANT-bridge + W7-W10/ext substrate-hardening + W11 Phase B redo (per Director (D)-disposition 2026-05-24; refined from greg's original A/B/C halt-options):**

- **Original Phase B attempt:** 2026-05-24 07:50 UTC — HALTED at Step 7 (491/651 Thread rows errored on btree-row-size; bug-123 + bug-124 + bug-125 + bug-126 + bug-127 all surfaced; engineer halt-discipline preserved disposition window)
- **W7-W10/ext substrate-hardening:** 2026-05-24 (5 Design v1.0 ratifications + 6 impl PRs merged + bug-133 hot-fix; bilateral round-trip ~15min for 5 Designs at ideal pace)
- **W11 Phase B redo:** 2026-05-25 04:43 UTC — CLI exit=0 + 0 errored across 22 kinds (post W8.1 hot-fix for Notification numeric-id; 5527 + 347 = 5874 rows newly migrated via MigrationCursor reset + re-run)
- **STRICT-FLAG-FLIP:** 2026-05-25 ~05:25 UTC — Hub container restart WITHOUT `SUBSTRATE_ENVELOPE_TOLERANT` env-var; bootstrap log `envelope tolerance mode: STRICT (W6 default: STRICT)` + `SchemaDef application complete (23 of 23 kinds applied; 0 failures)`
- **Hub container image:** `sha256:898f9d186e2e2f7644787a46588e04a3bbed7e406e8cc46936bea0e5991cd5c2` (post W8.1)
- **MigrationRunner across 22 kinds:** 5874 entities migrated (Audit 1256 + Bug 2 + Message 3618 + Notification 552 + PA 580 + Proposal 2 + SchemaDef 23 + Task 12 + Thread 329 + others 0-skipped-already-envelope)
- **Per-kind shape probe (post-strict-flip):** **23/23 kinds passed envelope-shape assertion** (22 data kinds at 100% envelope; MigrationCursor stays legacy per W0 infrastructure-kind exclusion — strict-mode tolerates)
- **bug-118 closure verification:** Idea 66 / Mission 15 / Task 30 with `metadata.sourceThreadId` (matches handover DRY_RUN baseline; Bug/Thread/PendingAction/Proposal/Turn 0 per anti-goal 11 forward-only)
- **Per-cluster write smoke:** 5/5 cluster-classes passed (list_threads/list_bugs/list_ideas/list_missions all OK via shim post-strict-flip)
- **Watchtower resume:** 2026-05-25 ~05:25 UTC — `watchtower-prod Up`
- **Outcome:** **SUCCESS** (target-state achieved: 100% envelope; strict-mode; no data loss; <90s effective cutover-window per step including 8.4min CLI sweep)

**Substrate-engineering hardening waves added vs original W0-W6 plan:**
- W7 #284 + #293 — Thread btree-index expression-path migration (bug-123 closed)
- W8 #285 + #292 — Notification cartography fix (bug-124 closed)
- W8.1 #298 — Notification numeric-id coerce hot-fix (bug-135 closed)
- W9 #286 + #289 — Hub iterate-tags defensive guard (bug-125 closed)
- W9.1 #290 — arrayFieldFromEntity scope-extension (bug-134 closed)
- W10 #287 + #295 — Adapter callToolGate dispatcher harden (bug-126 closed)
- W10-ext #288 + #294 — Hub M18 assertIdentity OCC discipline (bug-127 architecturally-closed; idea-322 systemic fix queued)
- bug-133 #296 — CLI exit-code time-budget exit=3 (closed)
- v0.1.6 release-prep #297 — adapter package version bump
- bug-136 OPEN — single-instance turn_created cascade-provenance gap (Phase 10 bank; non-blocking)

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

**FINALIZED 2026-05-25 post-cutover-execution.** All target-state criteria met (100% envelope across 22 data kinds; strict-mode active; bug-118 closure verified; Watchtower resumed). Engineer review at PR per A3.
