# Hub Substrate — psql Forensic Cookbook

**Mission:** mission-83 W7 deliverable
**Audience:** operator / architect doing forensic + diagnostic queries against the Hub substrate (postgres-backed)
**Source:** Design v1.4 §2.6 Surface 2 (escape-hatch positioning vs `get-entities.sh` daily-driver CLI)
**Substrate version:** v1.x (postgres 15+ with single `entities` table per Flavor A architecture)

---

## When to use psql vs `get-entities.sh`

| Use psql | Use get-entities.sh |
|---|---|
| Cross-kind joins | Single-kind reads |
| Aggregation (COUNT/GROUP BY) | Get-by-id |
| TOAST / vacuum / EXPLAIN-ANALYZE | Standard filter queries |
| Index-existence / index-usage diagnostics | Daily operator workflows |
| Substrate-internal forensics (resource_version / created_at / updated_at columns) | High-level entity content |

`get-entities.sh` is the daily-driver; psql is the escape-hatch for cases where the CLI's shape doesn't fit.

---

## Connecting

```bash
# Default local-dev
psql postgres://hub:hub@localhost:5432/hub

# Via docker exec (when postgres is in container)
docker exec -it hub-substrate-postgres psql -U hub -d hub

# With env var
export HUB_PG_CONNECTION_STRING=postgres://hub:hub@localhost:5432/hub
psql "$HUB_PG_CONNECTION_STRING"
```

---

## Schema cheatsheet

```sql
\d entities
-- columns: kind, id, data (JSONB), created_at, updated_at, resource_version
-- PRIMARY KEY (kind, id)
-- entities_rv_idx (resource_version)
-- entities_updated_at_idx (updated_at)
-- per-kind expression indexes per SchemaDef (e.g., bug_status_idx, message_thread_idx)

\d entities_rv_seq
-- sequence for resource_version (monotonic; substrate-internal CAS token)

-- List all per-kind indexes
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'entities' ORDER BY indexname;
```

---

## Common forensic queries

### Active threads (currentTurn=engineer; awaiting reply)

```sql
SELECT id, data->>'title' AS title, data->>'currentTurn' AS turn, data->>'roundCount' AS rounds
FROM entities
WHERE kind = 'Thread'
  AND data->>'status' = 'active'
  AND data->>'currentTurn' = 'engineer'
ORDER BY updated_at DESC
LIMIT 20;
```

### Pending actions by engineer

```sql
SELECT id, data->>'state' AS state, data->>'dispatchType' AS dispatch, data->>'entityRef' AS entity
FROM entities
WHERE kind = 'PendingAction'
  AND data->>'targetAgentId' = '<agent-id>'
  AND data->>'state' IN ('enqueued', 'receipt_acked')
ORDER BY data->>'enqueuedAt' DESC;
```

### Recent activity across all kinds

```sql
SELECT kind, id, updated_at
FROM entities
WHERE updated_at > NOW() - INTERVAL '5 minutes'
ORDER BY updated_at DESC
LIMIT 50;
```

### Messages on a specific thread (ordered by sequenceInThread)

```sql
SELECT id, data->>'authorRole' AS role, data->>'authorAgentId' AS agent,
       (data->>'sequenceInThread')::int AS seq, data->'payload'->>'body' AS body
FROM entities
WHERE kind = 'Message'
  AND data->>'threadId' = '<thread-id>'
ORDER BY (data->>'sequenceInThread')::int ASC;
```

### Missions by status

```sql
SELECT id, data->>'title' AS title, data->>'status' AS status, data->>'missionClass' AS class
FROM entities
WHERE kind = 'Mission'
  AND data->>'status' = 'active'
ORDER BY id DESC;
```

### Per-mission task progress (plannedTasks slot status)

```sql
SELECT m.id AS mission, p->>'sequence' AS seq, p->>'title' AS task, p->>'status' AS status
FROM entities m,
     jsonb_array_elements(m.data->'plannedTasks') p
WHERE m.kind = 'Mission'
  AND m.id = '<mission-id>'
ORDER BY (p->>'sequence')::int;
```

### Tasks blocked on a specific upstream task

```sql
SELECT id, data->>'title' AS title, data->>'directive' AS directive
FROM entities
WHERE kind = 'Task'
  AND data->>'status' = 'blocked'
  AND data->'dependsOn' ? '<upstream-task-id>';
```

### Counter inspection

```sql
-- Counter is single-row meta entity
SELECT data FROM entities WHERE kind = 'Counter' AND id = 'counter';
```

### Agent registry (active)

```sql
SELECT id, data->>'name' AS name, data->>'role' AS role,
       data->>'status' AS status, data->>'livenessState' AS liveness,
       data->>'cognitiveState' AS cognitive, data->>'transportState' AS transport
FROM entities
WHERE kind = 'Agent'
  AND data->>'status' = 'online'
ORDER BY data->>'lastSeenAt' DESC;
```

### Audit trail (recent)

```sql
SELECT id, data->>'timestamp' AS ts, data->>'actor' AS actor,
       data->>'action' AS action, data->>'details' AS details,
       data->>'relatedEntity' AS related
FROM entities
WHERE kind = 'Audit'
ORDER BY id DESC
LIMIT 100;
```

### Recent bugs by severity

```sql
SELECT id, data->>'title' AS title, data->>'severity' AS severity, data->>'status' AS status
FROM entities
WHERE kind = 'Bug'
  AND data->>'status' = 'open'
ORDER BY id DESC;
```

---

## Cross-kind queries

### Mission with its tasks + ideas (virtual-view rebuild)

```sql
-- Per Design §3.4: mission.tasks + mission.ideas are virtual-view (not stored
-- on mission entity; rebuilt from cross-kind queries).
SELECT m.data->>'title' AS mission_title,
       array_agg(DISTINCT t.id) FILTER (WHERE t.id IS NOT NULL) AS task_ids,
       array_agg(DISTINCT i.id) FILTER (WHERE i.id IS NOT NULL) AS idea_ids
FROM entities m
LEFT JOIN entities t ON t.kind = 'Task' AND t.data->>'correlationId' = m.id
LEFT JOIN entities i ON i.kind = 'Idea' AND i.data->>'missionId' = m.id
WHERE m.kind = 'Mission' AND m.id = '<mission-id>'
GROUP BY m.id, m.data;
```

### Thread + its messages (assembled inline since W4.x.10)

```sql
-- Post-W4.x.10: messages[] embedded inline on Thread entity
SELECT id, data->>'title' AS title, jsonb_array_length(data->'messages') AS message_count
FROM entities
WHERE kind = 'Thread' AND data->>'status' = 'active'
ORDER BY (jsonb_array_length(data->'messages')) DESC
LIMIT 10;
```

### Cross-mission bug-link tracking

```sql
SELECT b.id AS bug, b.data->>'title' AS bug_title, b.data->>'severity' AS severity,
       (b.data->'linkedTaskIds') AS linked_tasks, b.data->>'linkedMissionId' AS linked_mission
FROM entities b
WHERE b.kind = 'Bug'
  AND b.data->>'status' = 'open'
  AND jsonb_array_length(b.data->'linkedTaskIds') > 0;
```

---

## TOAST inspection

Substrate uses postgres TOAST for JSONB > ~2KB. Most Hub entities are TOAST-compressed transparently.

```sql
-- Show TOAST table size per kind
SELECT kind, pg_size_pretty(SUM(pg_column_size(data))) AS data_size, COUNT(*) AS row_count
FROM entities
GROUP BY kind
ORDER BY SUM(pg_column_size(data)) DESC;

-- Per-row size distribution for a kind (identify outliers)
SELECT id, pg_column_size(data) AS bytes
FROM entities
WHERE kind = 'Thread'
ORDER BY bytes DESC
LIMIT 10;

-- Force TOAST inspection (rarely needed; substrate handles compression transparently)
SELECT chunk_id, chunk_seq, octet_length(chunk_data) FROM pg_toast.pg_toast_<entities_oid>;
```

---

## Vacuum + index maintenance

```sql
-- Per-table vacuum stats
SELECT relname, n_live_tup, n_dead_tup, n_mod_since_analyze, last_vacuum, last_autovacuum
FROM pg_stat_user_tables WHERE relname = 'entities';

-- Force vacuum (rare; substrate writes are append-mostly so autovacuum suffices)
VACUUM (ANALYZE, VERBOSE) entities;

-- Index bloat check (per-index size)
SELECT indexname, pg_size_pretty(pg_relation_size(indexname::regclass)) AS size
FROM pg_indexes
WHERE tablename = 'entities'
ORDER BY pg_relation_size(indexname::regclass) DESC;

-- Reindex (if bloat surfaces; mission-83-scale should not need this routinely)
REINDEX TABLE CONCURRENTLY entities;
```

---

## EXPLAIN-ANALYZE hints

```sql
-- Check that per-kind expression indexes are being used
EXPLAIN ANALYZE
SELECT * FROM entities
WHERE kind = 'Message' AND data->>'threadId' = 'thread-500'
ORDER BY (data->>'sequenceInThread')::int;

-- Expected: index scan on message_thread_idx; NOT seq-scan on entities

-- Force seq-scan to compare (debugging only)
SET enable_indexscan = OFF;
SELECT ...
SET enable_indexscan = ON;
```

---

## resource_version forensics

```sql
-- Find most-recently-mutated entities (substrate-CAS visibility)
SELECT kind, id, resource_version, updated_at
FROM entities
ORDER BY resource_version DESC
LIMIT 20;

-- Find entities mutated within a rv-window (replay debugging)
SELECT kind, id, resource_version, updated_at
FROM entities
WHERE resource_version > <since-rv>
ORDER BY resource_version ASC;

-- LISTEN/NOTIFY trigger inspection (substrate-watch primitive verification)
SELECT trigger_name, event_manipulation, action_statement
FROM information_schema.triggers
WHERE event_object_table = 'entities';

-- Manual NOTIFY emit (smoke test the LISTEN channel)
NOTIFY entities_change, '{"op":"put","kind":"Test","id":"smoke-1","resource_version":"99999"}';
```

---

## Backup + restore (escape-hatch — prefer `hub-snapshot.sh`)

```bash
# Full backup (architect-style snapshot; use hub-snapshot.sh for routine ops)
pg_dump -Fc -h localhost -U hub -d hub > hub-substrate-$(date +%Y%m%d-%H%M%S).dump

# Restore (operator-side; verify schemaVersion before restore)
pg_restore -h localhost -U hub -d hub --clean --if-exists hub-substrate-<TIMESTAMP>.dump
```

For routine operations: use `scripts/local/hub-snapshot.sh save <path>` / `scripts/local/hub-snapshot.sh restore <path>` (wrapper adds schemaVersion validation).

---

## Hub-restart triggers + reconciler-settle verification

```sql
-- After Hub restart, verify SchemaDef table is populated + reconciler has run
SELECT COUNT(*) FROM entities WHERE kind = 'SchemaDef';
-- Expected: 20 (per entity-kinds.json v1.1)

-- Verify per-kind expression indexes are in place
SELECT indexname FROM pg_indexes WHERE tablename = 'entities' AND indexname LIKE '%_idx';
-- Expected (subset): agent_role_idx + agent_fingerprint_idx + audit_actor_idx +
-- bug_status_idx + bug_class_idx + idea_status_idx + idea_cascade_idx +
-- message_thread_idx + message_author_idx + mission_status_idx + mission_cascade_idx +
-- pa_target_idx + pa_state_idx + pa_natural_key_idx + proposal_status_idx +
-- proposal_cascade_idx + tele_status_idx + tele_supersededby_idx + thread_status_idx +
-- thread_turn_agent_idx + turn_status_idx
```

---

## References

- Daily-driver CLI: `scripts/local/get-entities.sh` (W7)
- Snapshot tool: `scripts/local/hub-snapshot.sh` (W7)
- Cutover runbook: `docs/operator/hub-storage-cutover-runbook.md` (W7)
- Local-dev cookbook: `docs/operator/hub-storage-substrate-local-dev.md` (W7)
- Substrate Design: `docs/designs/m-hub-storage-substrate-design.md` (architect-side; v1.4 RATIFIED)
- Migration script: `hub/scripts/migrate-fs-to-substrate.ts` (W5)
- SchemaDef inventory: `hub/scripts/entity-kinds.json` (v1.1; 20 kinds LOCKED)
