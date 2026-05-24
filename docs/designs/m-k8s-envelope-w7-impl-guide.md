# m-k8s-envelope-w7-impl-guide — architect-pre-auth for engineer-greg

**Sibling to:** Design v1.0 at `docs/designs/m-k8s-envelope-w7-thread-status-index.md`
**Purpose:** architect-pre-authored implementation guide for W7 (per Director "over-coord until all fixes land" directive 2026-05-24)
**Status:** WORKING — architect-side scaffold; engineer-side fill-in at impl PR
**Anchor:** bug-123 (Thread btree-index inflation; critical)

---

## Implementation phases (suggested order)

### Phase 0 — SchemaDef-reconciler extension scaffold (foundation)

Extend `SchemaDef` type to declare `indexes: IndexSpec[]`:

```typescript
// hub/src/storage-substrate/types.ts (or wherever SchemaDef lives)
export interface IndexSpec {
  name: string;              // e.g., "thread_status_phase_idx"
  expression: string;        // e.g., "(data->'status'->>'phase')"
  where?: string;            // e.g., "kind = 'Thread'"
  // Optional column-list for composite indexes
  expressions?: string[];    // e.g., ["(data->'metadata'->>'sourceThreadId')", "(data->'metadata'->>'sourceActionId')"]
}

export interface SchemaDef {
  // ... existing fields ...
  indexes?: IndexSpec[];
  indexOwnershipPattern?: RegExp;  // per W7 Q3 refinement (e.g., /^thread_/ for Thread-owned indexes)
}
```

Extend reconciler at `hub/src/storage-substrate/schema-reconciler.ts` (or equivalent):

```typescript
async function reconcileIndexes(kind: string, schemaDef: SchemaDef): Promise<void> {
  const declared = new Set((schemaDef.indexes ?? []).map(ix => ix.name));
  const ownershipPattern = schemaDef.indexOwnershipPattern;

  // 1. CREATE INDEX CONCURRENTLY IF NOT EXISTS for each declared
  for (const ix of schemaDef.indexes ?? []) {
    const expr = ix.expressions ? `(${ix.expressions.join(", ")})` : ix.expression;
    const whereClause = ix.where ?? `kind = '${kind}'`;
    await pg.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${ix.name} ON entities ${expr} WHERE ${whereClause}`);
  }

  // 2. DROP IF EXISTS for indexes matching ownership-pattern but not in declared
  if (ownershipPattern) {
    const existing = await pg.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='entities'`);
    for (const row of existing.rows) {
      const name = row.indexname;
      if (ownershipPattern.test(name) && !declared.has(name)) {
        await pg.query(`DROP INDEX IF EXISTS ${name}`);
        log.info(`[reconciler] dropped owned-but-undeclared index: ${name}`);
      } else if (!ownershipPattern.test(name)) {
        log.warn(`[reconciler] foreign index (not matching pattern; left alone): ${name}`);
      }
    }
  }
}
```

### Phase 1 — Per-kind SchemaDef.indexes population

For each migrated kind (21 + Notification post-W8 = 22), add `indexes: IndexSpec[]` to its SchemaDef.

**Cluster lookup table (the per-kind path resolution is grep work; cite the cluster Design):**

| Kind | Cluster | Design doc | Indexes to migrate |
|---|---|---|---|
| Idea | 1 | `docs/designs/m-k8s-envelope-cluster-1-substantive-content.md` + `hub/src/storage-substrate/migrations/v2-envelope/kinds/Idea.ts` | `idea_status_idx`, `idea_cascade_idx` |
| Bug | 1 | (same) + `kinds/Bug.ts` | `bug_status_idx`, `bug_class_idx` |
| Thread | 1 | (same) + `kinds/Thread.ts` | `thread_status_idx`, `thread_turn_agent_idx` (THE LOAD-BEARING blocker for cutover) |
| Mission | 1 | (same) + `kinds/Mission.ts` | `mission_status_idx`, `mission_cascade_idx` |
| Proposal | 1 | (same) + `kinds/Proposal.ts` | `proposal_status_idx`, `proposal_cascade_idx` |
| Task | 2 | `docs/designs/m-k8s-envelope-cluster-2-queue-fsm-active.md` + `kinds/Task.ts` | `task_status_idx`, `task_agent_idx`, `task_assigned_agent_idx`, `task_engineer_idx` |
| PendingAction | 2 | (same) + `kinds/PendingAction.ts` | `pa_state_idx`, `pa_natural_key_idx`, `pa_target_idx` |
| Turn | 2 | (same) + `kinds/Turn.ts` | `turn_status_idx` |
| Agent | 3 | `docs/designs/m-k8s-envelope-cluster-3-metadata-config-projection.md` + `kinds/Agent.ts` | `agent_role_idx`, `agent_fingerprint_idx` |
| Tele | 3 | (same) + `kinds/Tele.ts` | `tele_status_idx`, `tele_supersededby_idx` |
| SchemaDef | 3 | (same) + `kinds/SchemaDef.ts` | (no indexed expressions per current entities-table schema) |
| Counter | 3 | (same) + `kinds/Counter.ts` | (no indexed expressions) |
| Message | 4 | `docs/designs/m-k8s-envelope-cluster-4-system-emit-bookkeeping.md` + `kinds/Message.ts` | `message_author_idx`, `message_thread_idx` |
| Audit | 4 | (same) + `kinds/Audit.ts` | `audit_actor_idx` |
| RepoEventBridgeCursor | 4 | (same) | (no indexes per current schema) |
| RepoEventBridgeDedupe | 4 | (same) | (no indexes per current schema) |
| Document | 5 | `docs/designs/m-k8s-envelope-cluster-5-content-archive.md` + `kinds/Document.ts` | `document_category_idx` |
| ArchitectDecision | 5 | (same) | (no indexes per current schema) |
| ReviewHistoryEntry | 5 | (same) | `review_task_idx` |
| ThreadHistoryEntry | 5 | (same) | `threadhist_thread_idx` |
| DirectorHistoryEntry | 5 | (same) | (no indexes per current schema) |
| **Notification** | 4 (post-W8) | W8 PR #285 Design v1.0 | `notification_recipient_idx` (per W8 §8 SchemaDef draft) |

### Phase 2 — Per-kind path resolution (engineer-grep work)

For each `*_status_idx`-style index: path is `(data->'status'->>'phase')` per universal cluster renameMap `status: "status.phase"`.

For per-kind nested fields (e.g., `linkedTaskIds`, `fixCommits`, `sourceThreadId`): cite the kind's `kinds/<Kind>.ts` partition for the envelope section. Pattern:
- If field is in `partition.metadata` → `(data->'metadata'->>'<field>')`
- If field is in `partition.spec` → `(data->'spec'->>'<field>')`
- If field is in `partition.status` → `(data->'status'->>'<field>')`

Engineer-fill table (architect-stub; you grep + fill citing line numbers):

| Index | Cluster-lookup citation | from-expression | to-expression |
|---|---|---|---|
| `thread_status_idx` | cluster-1 Thread.ts §X | `(data->>'status')` | `(data->'status'->>'phase')` |
| `thread_turn_agent_idx` | cluster-1 Thread.ts §X (currentTurnAgentId) | `(data->>'currentTurnAgentId')` | `(data->'status'->>'currentTurnAgentId')` |
| `idea_status_idx` | cluster-1 Idea.ts §X | `(data->>'status')` | `(data->'status'->>'phase')` |
| `idea_cascade_idx` | cluster-1 Idea.ts §X (metadata partition) | `((data->>'sourceThreadId'), (data->>'sourceActionId'))` | `((data->'metadata'->>'sourceThreadId'), (data->'metadata'->>'sourceActionId'))` |
| `bug_status_idx` | cluster-1 Bug.ts | `(data->>'status')` | `(data->'status'->>'phase')` |
| `bug_class_idx` | cluster-1 Bug.ts (spec.class) | `(data->>'class')` | `(data->'spec'->>'class')` |
| `mission_status_idx` | cluster-1 Mission.ts | `(data->>'status')` | `(data->'status'->>'phase')` |
| `mission_cascade_idx` | cluster-1 Mission.ts (metadata) | `((data->>'sourceThreadId'), (data->>'sourceActionId'))` | `((data->'metadata'->>'sourceThreadId'), (data->'metadata'->>'sourceActionId'))` |
| `proposal_status_idx` | cluster-1 Proposal.ts | `(data->>'status')` | `(data->'status'->>'phase')` |
| `proposal_cascade_idx` | cluster-1 Proposal.ts | (same as idea_cascade) | (same as idea_cascade) |
| `task_status_idx` | cluster-2 Task.ts | `(data->>'status')` | `(data->'status'->>'phase')` |
| `task_agent_idx` | cluster-2 Task.ts (spec.assignedAgentId) | `(data->>'assignedAgentId')` | `(data->'spec'->>'assignedAgentId')` |
| `task_assigned_agent_idx` | cluster-2 Task.ts (idea-311 territory) | `(data->>'assignedEngineerId')` | TBD per idea-311 |
| `task_engineer_idx` | cluster-2 Task.ts (idea-311 territory) | `(data->>'assignedEngineerId')` | TBD per idea-311 |
| `pa_state_idx` | cluster-2 PendingAction.ts (renames `state` → `status.state`?) | `(data->>'state')` | `(data->'status'->>'state')` — VERIFY |
| `pa_natural_key_idx` | cluster-2 PendingAction.ts (metadata.naturalKey) | `(data->>'naturalKey')` | `(data->'metadata'->>'naturalKey')` |
| `pa_target_idx` | cluster-2 PendingAction.ts (spec.targetAgentId) | `(data->>'targetAgentId')` | `(data->'spec'->>'targetAgentId')` |
| `turn_status_idx` | cluster-2 Turn.ts | `(data->>'status')` | `(data->'status'->>'phase')` |
| `agent_role_idx` | cluster-3 Agent.ts | `(data->>'role')` | `(data->'spec'->>'role')` — VERIFY (architect spec-recall; engineer cite Agent.ts partition) |
| `agent_fingerprint_idx` | cluster-3 Agent.ts (metadata.fingerprint) | `(data->>'fingerprint')` | `(data->'metadata'->>'fingerprint')` |
| `tele_status_idx` | cluster-3 Tele.ts | `(data->>'status')` | `(data->'status'->>'phase')` |
| `tele_supersededby_idx` | cluster-3 Tele.ts (status.supersededBy) | `(data->>'supersededBy')` | `(data->'status'->>'supersededBy')` |
| `message_author_idx` | cluster-4 Message.ts | `(data->>'authorAgentId')` | TBD per Q9 framing |
| `message_thread_idx` | cluster-4 Message.ts | `(data->>'threadId')` | TBD per Q9 framing |
| `audit_actor_idx` | cluster-4 Audit.ts | `(data->>'actor')` | `(data->'spec'->>'actor')` — VERIFY |
| `document_category_idx` | cluster-5 Document.ts (metadata.labels.category) | `(data->>'category')` | `(data->'metadata'->'labels'->>'category')` |
| `review_task_idx` | cluster-5 ReviewHistoryEntry.ts | `(data->>'taskId')` | `(data->'metadata'->>'taskId')` |
| `threadhist_thread_idx` | cluster-5 ThreadHistoryEntry.ts | `(data->>'threadId')` | `(data->'metadata'->>'threadId')` |
| `notification_recipient_idx` | W8 SchemaDef (post-W8 merge) | `(data->>'recipientAgentId')` | per W8 §8 (`data->'spec'->>'targetRoles'`?) — coord with W8 PR |

**Engineer-fill: replace TBD/VERIFY citations with cluster-N line refs.** For genuine gaps (cluster Design didn't specify): file TBD-bug for follow-on per W7 Design v1.0 §9 acceptance.

### Phase 3 — W11 cutover-script Step 2.5 (per W7 A6)

Update `scripts/operator/m-k8s-envelope-cutover.sh`:

```bash
# Step 2.5 — wait for SchemaDef-reconciler index-swap complete
echo "[cutover] Step 2.5 — waiting for SchemaDef-reconciler index-swap"
EXPECTED_INDEX_COUNT=<calculated; sum of declared indexes across 22 kinds>
ACTUAL=$(psql -c "SELECT COUNT(*) FROM pg_indexes WHERE indexname LIKE '%_idx' AND schemaname='public'")
while [ "$ACTUAL" -lt "$EXPECTED_INDEX_COUNT" ]; do
  sleep 2
  ACTUAL=$(...)
done
echo "[cutover] Step 2.5 complete — indexes ready"
```

### Phase 4 — Tests

- Per Design §6.1 6.2 6.3 acceptance criteria
- Plus stealth-broken-index regression-guards per cluster (envelope-row + legacy-row both work; index hit verified via EXPLAIN)

## Test plan (engineer fills as scoped)

- [ ] SchemaDef extension: type + reconciler unit tests
- [ ] Per-kind SchemaDef.indexes population (22 kinds; ~25-30 indexes)
- [ ] Migration runner sequence test (index-swap → data-migrate)
- [ ] Stealth-broken-index regression tests (per affected kind)
- [ ] W11 cutover-script Step 2.5 polling logic test
- [ ] Production-shape replay integration test (mixed-shape DB → 100% envelope post-W11)

## Open questions (engineer can ask back via note-kind)

1. PendingAction.state semantics — does cluster-2 rename `state` → `status.state` OR `status.phase`? Verify against PendingAction.ts partition.
2. Agent.role envelope path — `spec.role` or `metadata.role`? Verify against cluster-3 Agent.ts.
3. Message.threadId / Message.authorAgentId envelope paths — cluster-4 Q9 framing (architect-spec-recall drift at W4); cite cluster-4 §3.9 for canonical answer.
4. Audit.actor envelope path — spec.actor or metadata.actor? Verify cluster-4 Audit.ts.
5. notification_recipient_idx — Notification.spec.targetRoles is an ARRAY. Indexing on an array sub-path needs different expression syntax (`jsonb_array_elements_text` or GIN). Coord with W8 §8.

## Architect-side support during W7 impl

- I'm available for any spec-level question via note-kind during impl
- For per-kind grep-and-cite work that produces ambiguity → ping me; I'll consult cluster Designs + give answer
- For the 5 open questions above: file as TBD-bugs if you'd rather defer than block

— lily (W7 impl pre-auth; over-coord mode active)
