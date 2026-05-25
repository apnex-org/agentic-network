# m-k8s-envelope-w7-thread-status-index-design

**Mission:** mission-88 M-K8s-Envelope Wave W7 — substrate-hardening pre-W11-re-cutover
**Status:** v0.1 WORKING DRAFT
**Anchors:** bug-123 (Thread btree inflation; critical), and broader scope: bug-124/125/126/127 are sibling W8-W10ext anchors but W7 is the most architecturally-loaded
**Author:** architect (lily) driving via curl-bypass during mission-88 W6 Phase B halt (greg's halt-discipline preserved disposition window)
**Director-ratification:** (D) TOLERANT-bridge + W7-W10 + W11 clean re-cutover (ratified 2026-05-24)

---

## 1. Problem (greg's surface + lily verification)

During mission-88 W6 cutover Phase B Step 7, the MigrationRunner CLI exited 0 but **491 of 651 Thread rows (75%) remained legacy-flat** due to postgres btree-index size errors:

```
[envelope-migrate] kind=Thread id=thread-547 msg=index row requires 34560 bytes, maximum size is 8191
[envelope-migrate] kind=Thread id=thread-540 msg=index row size 5160 exceeds btree version 4 maximum 2704 for index "thread_status_idx"
```

**Engineer-side framing (thread-653):** envelope-shape inflation hit postgres 8191-byte btree-row limit.

**Architect-side verification (psql audit, 2026-05-24):** the inflation is in the **indexed expression value**, not the row itself.

| kind | max `length(data->>'status')` | indexed shape | 8191-limit status |
|---|---:|---|---|
| **Thread** | **5827** | envelope status object stringified | Hits limit on large Threads (95th-pct rows >8KB stringified status) |
| Task | 5117 | envelope status object stringified | Approaching limit |
| Proposal | 3822 | envelope status object stringified | Approaching limit |
| Agent | 1576 | envelope status object stringified | Safe today |
| Mission | 1145 | envelope status object stringified | Safe today |
| Bug | 368 | envelope status object stringified | Safe today |
| PendingAction | 238 | envelope status object stringified | Safe today |
| Idea | 52 | envelope status object (small) | Safe |
| Turn | 21 | envelope status object (small) | Safe |
| Document | 19 | envelope status object (small) | Safe |
| Tele | 2 | envelope status object (small) | Safe |

**Plus stealth-broken indexes** — expression returns NULL on envelope rows because the field moved:

| index | expression | envelope path post-migration | symptom |
|---|---|---|---|
| `agent_role_idx` | `data->>'role'` | `data.spec.role` | NULL on envelope rows |
| `idea_cascade_idx` | `data->>'sourceThreadId'` | `data.metadata.sourceThreadId` | NULL on envelope rows |
| `mission_cascade_idx` | same | same | NULL on envelope rows |
| `proposal_cascade_idx` | same | same | NULL on envelope rows |
| `bug_class_idx` | `data->>'class'` | `data.spec.class` (TBD) | NULL on envelope rows |
| `document_category_idx` | `data->>'category'` | `data.metadata.labels.category` | NULL on envelope rows |
| `agent_fingerprint_idx` | `data->>'fingerprint'` | `data.metadata.fingerprint` (TBD) | NULL on envelope rows |
| `audit_actor_idx` | `data->>'actor'` | `data.spec.actor` (TBD) | NULL on envelope rows |

Stealth-broken indexes don't crash — they silently degrade query plans to seq-scan on envelope rows. List operations may return inconsistent results (legacy rows hit index; envelope rows fall back).

## 2. Root cause

**The MigrationRunner migrates data shape but does not migrate index expressions.**

W0 substrate-prep authored migration modules per kind (cluster-1 through cluster-5 in mission-88 W1-W5). Each module rewrites `data` from legacy-flat to envelope-shape. None of the modules touched the postgres expression-indexes defined in the substrate schema reconciler.

Post-migration, the expression-indexes evaluate against the new envelope-shape `data` column:
- For fields that moved to nested paths: index returns NULL (stealth-broken)
- For fields that became objects (e.g., `status`): index returns JSON-string of the whole object (size inflated)

This is symmetric with — but missed by — the W2-W5 cluster Design-passes. The Design-passes audited data-shape but did not audit **storage-substrate index expressions** as dependent code.

**Methodology fold-in (Phase 10 calibration candidate):** envelope-shape migration is not "data-only" — it's data + every consumer of that data, including storage-substrate index expressions. Add to the W0 substrate-prep checklist for future substrate-introduction-class missions.

## 3. Architectural decision (open for Design-pass round)

Two candidate fixes:

### (α) Per-kind expression-index path migration (preferred)

Update each affected index to target the envelope-shape path:

| index | from | to |
|---|---|---|
| `thread_status_idx` | `data->>'status'` | `data->'status'->>'phase'` |
| `task_status_idx` | `data->>'status'` | `data->'status'->>'phase'` |
| `proposal_status_idx` | `data->>'status'` | `data->'status'->>'phase'` |
| `mission_status_idx` | `data->>'status'` | `data->'status'->>'phase'` |
| `bug_status_idx` | `data->>'status'` | `data->'status'->>'phase'` |
| `idea_status_idx` | `data->>'status'` | `data->'status'->>'phase'` |
| `tele_status_idx` | `data->>'status'` | `data->'status'->>'phase'` |
| `turn_status_idx` | `data->>'status'` | `data->'status'->>'phase'` |
| `pa_state_idx` | `data->>'state'` | `data->'status'->>'state'` |
| `agent_role_idx` | `data->>'role'` | `data->'spec'->>'role'` |
| `agent_fingerprint_idx` | `data->>'fingerprint'` | `data->'metadata'->>'fingerprint'` |
| `idea_cascade_idx` | `(data->>'sourceThreadId', data->>'sourceActionId')` | `(data->'metadata'->>'sourceThreadId', data->'metadata'->>'sourceActionId')` |
| `mission_cascade_idx` | same | same |
| `proposal_cascade_idx` | same | same |
| `bug_class_idx` | `data->>'class'` | `data->'spec'->>'class'` (TBD per W2 cluster-1 audit) |
| `document_category_idx` | `data->>'category'` | `data->'metadata'->'labels'->>'category'` (per W5 design) |
| `audit_actor_idx` | `data->>'actor'` | `data->'spec'->>'actor'` (TBD per W4 cluster-4 audit) |
| `task_agent_idx` | `data->>'assignedAgentId'` | `data->'spec'->>'assignedAgentId'` (TBD) |
| `task_assigned_agent_idx` | same | same |
| `task_engineer_idx` | `data->>'assignedEngineerId'` | `data->'spec'->>'assignedEngineerId'` (TBD; idea-311 territory) |
| `task_status_idx` | (covered above) | |
| `message_author_idx` | `data->>'authorAgentId'` | `data->'spec'->>'authorAgentId'` (TBD) |
| `message_thread_idx` | `data->>'threadId'` | `data->'spec'->>'threadId'` (TBD) |
| `notification_recipient_idx` | `data->>'recipientAgentId'` | `data->'spec'->>'recipientAgentId'` (TBD — also W8 territory) |
| `pa_natural_key_idx` | `data->>'naturalKey'` | `data->'spec'->>'naturalKey'` (TBD) |
| `pa_target_idx` | `data->>'targetAgentId'` | `data->'spec'->>'targetAgentId'` (TBD) |
| `review_task_idx` | `data->>'taskId'` | `data->'metadata'->>'taskId'` (per W5) |
| `tele_supersededby_idx` | `data->>'supersededBy'` | `data->'status'->>'supersededBy'` (TBD) |
| `thread_turn_agent_idx` | `data->>'currentTurnAgentId'` | `data->'status'->>'currentTurnAgentId'` (TBD) |
| `threadhist_thread_idx` | `data->>'threadId'` | `data->'metadata'->>'threadId'` (per W5) |

**Pros:** keeps the cluster-1/2/3/4/5 envelope-shape decisions intact (status-as-object; FSM-mutated fields under `status`; routing-intent under `spec`; provenance under `metadata`). Index alignment is purely a substrate-storage concern.

**Cons:** ~25 index migrations; each is a `CREATE INDEX CONCURRENTLY IF NOT EXISTS new_name + DROP INDEX IF EXISTS old_name` pair. Needs to land in SchemaDef-reconciler so future cold-boots create the new expressions.

### (β) Move large mutable content out of `status` (broader redesign)

Re-examine the cluster-1 v0.2 / cluster-2 "default-to-status for FSM-mutated fields" pattern. Specifically: Thread's `status.messages` and `status.summary` are the bloat-drivers. Move them out of `status` into `data.archive` (new) or into a separate blob-body substrate (composes with idea-299 M-Hub-Storage-BlobBody-Substrate).

**Pros:** keeps `status` semantically pure (FSM-bits only); enables future content-lazy-loading via blob refs; storage-efficient.

**Cons:** breaks the cluster-1 design pattern that just shipped 7 days ago; requires re-running cluster-1 Design-pass; depends on idea-299 maturity (currently `open`).

### Recommendation: (α)

(α) is symmetric with the rest of the envelope migration and doesn't disturb the cluster-1/2 design. (β) is the right answer **for a future mission** (post-idea-299) but adds scope-creep + cluster-1 redesign churn that doesn't earn its keep in the W7 timebox.

(β) remains valid as a follow-on Idea filing (post-mission-88 M-Thread-Content-Storage-Reshape or composed into idea-299 scope).

## 4. Migration strategy

### 4.1 SchemaDef-reconciler extension

The substrate's SchemaDef-reconciler (mission-83 W2.x) is the authoritative source for kind-shape + indexes. W7 extends it to:

1. Take per-kind `indexes: { name, expression, where }[]` from the SchemaDef
2. On cold-boot reconcile: `CREATE INDEX CONCURRENTLY IF NOT EXISTS new_name ON entities ((expression)) WHERE kind = 'X'`
3. On cold-boot reconcile: drop indexes not in the SchemaDef-declared set (gentle pattern: warn-then-drop; or strict-drop per Design-decision)

This makes index management symmetric with kind/schema management — the SchemaDef is the single source of truth.

### 4.2 W7-time index swap

For each affected kind:
1. `CREATE INDEX CONCURRENTLY IF NOT EXISTS thread_status_phase_idx ON entities ((data->'status'->>'phase')) WHERE kind = 'Thread'` — non-blocking
2. Verify new index is queryable (sample-test plan-explain showing index hit)
3. `DROP INDEX IF EXISTS thread_status_idx` — fast (metadata-only DDL)

For Thread specifically: per the cutover-script, this should happen **before** the migration sweep retry (else the migration will re-attempt the same btree index and fail again).

Sequence:
- W7 PR merges → Hub container rebuild
- W7 PR includes a new migration step: "index swap" runs BEFORE per-kind data migrate
- On TOLERANT-mode start, SchemaDef-reconciler creates new indexes + drops old indexes
- Then MigrationRunner per-kind sweeps continue (now without btree errors because new index expressions target small values)

### 4.3 Rollback path

If new indexes cause query regressions:
- Drop new indexes
- Re-create old indexes (CREATE INDEX CONCURRENTLY)
- Affects only envelope rows (legacy rows already worked under old indexes)

## 5. Per-cluster collaboration audit

W7 implementation **MUST** coordinate with cluster Design-pass folks (effectively retro-audit cluster-1 through cluster-5):

- **cluster-1 (Idea/Bug/Thread/Mission/Proposal)** — status-as-object decision is W7-affecting; need to confirm `status.phase` exists for each (verify-before-bake)
- **cluster-2 (Task/PendingAction/Turn)** — same; PendingAction uses `state` not `status` per current index name; align with envelope-shape decision
- **cluster-3 (Agent/Tele/SchemaDef/Counter)** — Agent has `role` + `fingerprint` at top-level pre-envelope; post-envelope they're under `spec`/`metadata`; verify
- **cluster-4 (Message/Audit/RepoEventBridge*)** — `Message.threadId`, `Message.authorAgentId`, `Audit.actor` paths needed
- **cluster-5 (Document/ArchitectDecision/HistoryEntry-3)** — `Document.metadata.labels.category` per W5 design; `*HistoryEntry.metadata.threadId/taskId` per W5

Engineer-side verify-before-bake per cluster-currency-Q2 discipline (5-clusters-in-a-row self-prompting pattern).

## 6. Test strategy

### 6.1 Unit tests (per kind)

For each kind with a migrated index:
- Insert a sample envelope-shape row
- `EXPLAIN ANALYZE SELECT FROM entities WHERE kind = 'X' AND data->'status'->>'phase' = 'open'` → must show Index Scan on new index
- Insert a sample legacy-shape row (TOLERANT mode)
- Same query must miss new index (fall back to seq-scan or other indexes) — confirms shape-specific routing

### 6.2 Migration runner integration test

End-to-end: seeded mixed-shape DB → run index-swap reconcile → run per-kind data migration → all rows reach envelope-shape, no btree errors logged.

Use the 491-legacy-Thread state from current production as the realistic-fixture (anonymized clone via pg_dump → restore to test-postgres).

### 6.3 Stealth-broken-index regression guard

For each historically-stealth-broken index (per §1 table):
- Insert envelope-shape row with the field in question
- Query via the index-friendly path
- Assert: row is returned (not silently missed)

This locks the regression: a future SchemaDef change that drops the field would surface as test-fail, not silent-missing-rows-in-prod.

## 7. Architect-asks (for Design-pass round)

1. **Index naming convention** — keep old names (`thread_status_idx`) and just change expression, or rename (`thread_status_phase_idx`)? Latter is more honest about what's indexed; former minimizes call-site code-changes. Lean: rename for clarity; call-sites that reference index names by-string can be grep-and-fixed.

2. **(β)-alternative deferral** — agree to defer Thread `status.messages`/`summary` extraction to a post-mission-88 idea? Or fold here for scope-completeness? Lean: defer; (α) closes the W11 cutover-blocker without churning cluster-1/2 designs.

3. **SchemaDef-reconciler index-drop semantics** — when SchemaDef declares the new set, should reconciler hard-drop indexes not in the set, or warn-and-leave? Lean: hard-drop (strict per W6 envelope-cutover discipline; operator-DX is `DROP INDEX IF EXISTS` if you need to add an ad-hoc index).

4. **Cluster-Q2 retro-audit timing** — engineer authors W7 PR with full per-kind index audit (covers items deferred-to-TBD in §3 table), OR architect spawns 5 parallel cluster-Q2 mini-threads to confirm envelope paths per cluster? Lean: engineer-authors via single PR — auditing is straightforward grep-and-compare (cluster Designs are committed in repo).

## 8. Out of scope (deferred to post-mission-88)

- (β) Thread content-storage redesign (moves `status.messages`/`summary` out) — file as idea post-W11 cutover
- Index strategy changes beyond expression-path (hash indexes, GIN, partial indexes for hot-path queries) — compose with idea-151 M-Graph-Relationships
- Index-row-size budgeting tooling for future SchemaDef authoring — compose with W7 SchemaDef-reconciler extension as a follow-on Idea
- Multi-column functional indexes for cascade-provenance — keep current 2-column expression-index shape

## 9. Acceptance criteria

- All ~25 expression-indexes migrated to envelope-shape paths
- SchemaDef-reconciler extended to author indexes from SchemaDef declarations
- Migration runner sequence: index-swap → per-kind data-migrate (so subsequent data migrations don't re-trip btree errors)
- Integration test: replay current-production mixed-shape state through full migration → 100% envelope-shape across all 21 (+ Notification post-W8 = 22) kinds, zero btree errors
- All historically-stealth-broken indexes have regression-guard tests
- Per-kind Cluster-Q2 paths verified (or surfaced as TBD-bugs for follow-on)

## 10. Link to anchor

- **bug-123** (critical; cutover-blocker; mission-88 W7 anchor)
- **mission-88** (active; M-K8s-Envelope)
- Sibling waves: W8 (bug-124 Notification cartography), W9 (bug-125 Hub iterate-tags), W10 (bug-126 callToolGate), W10-ext (bug-127 M18 OCC)
- Phase 4 Design pattern: thread-coord canonical; deviated to PR-direct this round due to thread-reply blocker (bug-126 + bug-127 compose). Will resume thread-coord post-W10/W10-ext if/when comms fully restore.
