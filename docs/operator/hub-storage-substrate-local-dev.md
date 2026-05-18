# Hub-Storage-Substrate — Local-Dev Operator Cookbook

**Audience:** developers running the Hub-storage-substrate locally for dev/test
**Source:** Design v1.4 §2.4 (LISTEN/NOTIFY) + §2.5 (snapshot/restore) + §2.6 (operator-DX) + §3.5 (cutover) + §7.1 R6 + R10 (resource + state-loss dispositions)
**Compose:** `hub/spike/W0/docker-compose.yml` (substrate-side dev environment)
**Status:** v1.0 SHIP-QUALITY (mission-83 W7 deliverable)
**Companion docs:**
- `docs/operator/hub-storage-cutover-runbook.md` — production cutover orchestration
- `docs/operator/psql-cookbook.md` — forensic + diagnostic queries
- `scripts/local/get-entities.sh` — daily-driver CLI (direct-psql per Design §2.6 Surface 1)
- `scripts/local/hub-snapshot.sh` — backup/restore wrapper (pg_dump -Fc)

---

## Quick start — postgres-substrate compose-up

```bash
# Start substrate (postgres-15-alpine with named volume + R6 resource bounds)
docker compose -f hub/spike/W0/docker-compose.yml up -d

# Verify postgres is ready (health-check polls pg_isready)
docker compose -f hub/spike/W0/docker-compose.yml ps

# Tail logs
docker compose -f hub/spike/W0/docker-compose.yml logs -f postgres

# Connect via psql (forensic / cookbook queries — see "psql forensic queries" below)
docker exec -it hub-substrate-postgres psql -U hub -d hub

# OR from host (postgres-client installed):
psql postgres://hub:hub@localhost:5432/hub

# Stop substrate (DATA PRESERVED across restart within session)
docker compose -f hub/spike/W0/docker-compose.yml down

# Stop substrate + DELETE VOLUME (per R10 ephemeral-by-design disposition)
docker compose -f hub/spike/W0/docker-compose.yml down -v
```

## Environment variable convention

```bash
# Default for local-dev:
export HUB_PG_CONNECTION_STRING=postgres://hub:hub@localhost:5432/hub

# Used by:
# - Hub bootstrap (W1+): connects substrate at startup
# - scripts/local/get-entities.sh (W7): forensic CLI per Design v1.1 §2.6 direct-psql
# - hub/scripts/migrate-fs-to-substrate.ts (W5): state-migration script invocation
```

---

## R10 state-loss disposition (CRITICAL FOR LOCAL DEV)

Per Design v1.1 §7.1 R10 **EXPLICIT PICK**:

> Local-dev state is ephemeral by design. Snapshot-restore (per §2.5 + `hub-snapshot.sh`) is the persistence story.

**What this means in practice:**

- `docker compose down` (without `-v`) preserves the named volume `hub-substrate-data`; data survives restart within a session
- `docker compose down -v` DELETES the named volume; data is gone (CAUTION)
- Snapshot-restore is the BACKUP mechanism — not the volume itself
- For cross-session persistence: `scripts/local/hub-snapshot.sh save <path>` BEFORE `down -v`, then `hub-snapshot.sh restore <path>` after `up`
- Do NOT treat the named volume as long-term persistence; postgres-version-upgrades + volume-driver-changes can break it without warning

This is the **substrate-introduction mission-class disposition**: snapshot-restore is the canonical persistence boundary. Local-dev workflow must align.

---

## R6 resource exhaustion mitigation (local-dev compose-yml tuning)

Per Design v1.1 §7.1 R6 — postgres-container resource bounds prevent long-running-session exhaustion:

| Setting | Value | Why |
|---|---|---|
| `memory: 1G` | Docker compose `deploy.resources.limits.memory` | Bounded for laptop/devbox; production sizing is cloud-deploy concern (idea-298) |
| `cpus: '1.0'` | Docker compose `deploy.resources.limits.cpus` | Same |
| `max_connections=50` | postgres `-c` flag | Bounded for dev workload; production is cloud-deploy concern |
| `shared_buffers=256MB` | postgres `-c` flag | 25% of memory cap per postgres convention |
| `work_mem=16MB` | postgres `-c` flag | Conservative per-operation memory |

**If you hit resource limits** (postgres OOM, slow queries, connection-exhaustion in dev):
1. Check `docker compose logs postgres` for error messages
2. Increase `memory` in compose-yml (devbox-dependent)
3. Increase `max_connections` if connection-exhaustion-specific
4. NOT-A-FIX: removing the limits entirely; production-shape needs bounded resource profile

---

## psql forensic queries (per Design v1.1 §2.6 cookbook)

For incidents + investigations the `get-entities.sh` CLI doesn't anticipate. Connect via:

```bash
docker exec -it hub-substrate-postgres psql -U hub -d hub
# OR
psql $HUB_PG_CONNECTION_STRING
```

### All active threads (parallel to today's `find local-state/threads/ -name 'thread-*.json' | xargs jq '.status'`)

```sql
SELECT id, data->>'title' AS title, data->>'status' AS status
FROM entities
WHERE kind = 'Thread' AND data->>'status' = 'active'
ORDER BY updated_at DESC;
```

### Pending actions by engineer

```sql
SELECT id, data->>'op' AS op, data->>'engineerId' AS engineer, data->>'state' AS state, enqueuedAt
FROM entities
WHERE kind = 'PendingAction' AND data->>'engineerId' = 'agent-0d2c690e'
ORDER BY data->>'enqueuedAt' DESC;
```

### Recent activity across all kinds (parallel to today's `ls -lt local-state/`)

```sql
SELECT kind, id, updated_at
FROM entities
ORDER BY updated_at DESC
LIMIT 100;
```

### Messages on a thread (parallel to today's `find local-state/messages-thread-index/thread-NNN/ | xargs cat | jq`)

```sql
SELECT id, data->>'authorRole' AS role, data->>'kind' AS kind, data->>'text' AS text, created_at
FROM entities
WHERE kind = 'Message' AND data->>'threadId' = 'thread-566'
ORDER BY created_at ASC;
```

### Count entities by kind (sanity check post-cutover)

```sql
SELECT kind, COUNT(*) AS count
FROM entities
GROUP BY kind
ORDER BY count DESC;
```

### Find SchemaDef for a kind (substrate-introspection)

```sql
SELECT data->>'kind' AS kind, data->>'version' AS schema_version, data->'indexes' AS indexes
FROM entities
WHERE kind = 'SchemaDef' AND data->>'kind' = 'Message';
```

---

## `scripts/local/get-entities.sh` (W7 ship; per Design v1.1 §2.6 direct-psql wrapper)

**Not yet implemented in W0 spike** — placeholder for W7 deliverable. Expected shape per Design v1.1 §2.6:

```bash
# (W7) Daily-driver CLI; reads HUB_PG_CONNECTION_STRING; translates --filter='k=v' to data->>'k'='v' clauses
get-entities.sh Message --filter='threadId=thread-566'           # all messages on thread-566
get-entities.sh Thread --filter='status=active' --limit=20       # active threads
get-entities.sh PendingAction --filter='engineerId=agent-0d2c690e'  # pending actions for greg
```

Direct-psql posture (NOT HTTP/MCP-mediated); matches today's `ls .ois/state/ + cat + jq` workflow. See Design v1.1 §2.6 rationale: "the diagnostic dispositive even when Hub is degraded".

---

## Snapshot + restore (per Design v1.1 §2.5)

**Not yet implemented in W0 spike** — placeholder for W6/W7 deliverable. Expected shape:

```bash
# Save snapshot (pg_dump -Fc custom binary format)
scripts/local/hub-snapshot.sh save /path/to/snapshot.dump

# Restore snapshot
scripts/local/hub-snapshot.sh restore /path/to/snapshot.dump

# List snapshots
ls /path/to/snapshots/
```

Both scripts wrap `pg_dump` / `pg_restore` directly (NOT Hub-HTTP-mediated; same direct-psql posture as `get-entities.sh`).

---

## W0 spike validation evidence (2026-05-17)

Substrate compose-up + smoke tests validated end-to-end on engineer devbox:

- **Container UP + healthy** in ~6 seconds (health-check pg_isready interval 5s + retries 10 + start_period 10s)
- **Postgres version:** `PostgreSQL 15.18 on x86_64-pc-linux-musl` (postgres:15-alpine current LTS)
- **R6 settings active** (verified via `SELECT name, setting FROM pg_settings WHERE name IN ...`):
  - `max_connections = 50`
  - `shared_buffers = 32768` (kB; = 256MB ✓)
  - `work_mem = 16384` (kB; = 16MB ✓)
- **LISTEN/NOTIFY smoke test PASS** — `NOTIFY test_channel, 'hello from W0 spike'` → `Asynchronous notification "test_channel" with payload "hello from W0 spike" received from server process with PID 124`. Substrate-watch primitive functional per Design §2.4 LISTEN/NOTIFY pick.
- **JSONB 1MB-payload smoke PASS** — `INSERT INTO jsonb_smoke VALUES (jsonb_build_object('big', repeat('x', 1000000)));` produced `pg_column_size = 11469 bytes` (TOAST-compressed); `under_cap = true` against 1572864 (1.5MB) cap per §2.2.
- **Memory baseline at idle:** 39.71 MiB / 1 GiB (4% of allocated cap)

These validations satisfy W0.1 Acceptance Criteria per Design §4 W0 row (postgres-container local-dev compose-up validates).

---

## Troubleshooting

### "Cannot connect to postgres"

1. `docker compose ps` — verify container is running + healthy
2. `docker compose logs postgres` — check for startup errors (port-in-use, volume-permission)
3. `nc -zv localhost 5432` — verify port is reachable
4. Connection-string typo: should be `postgres://hub:hub@localhost:5432/hub`

### "Postgres-container memory exhausted (OOMKilled)"

1. Check `docker stats hub-substrate-postgres` — current memory pressure
2. Increase `memory` limit in compose-yml
3. Check connections — `SELECT count(*) FROM pg_stat_activity;` (psql); approach to `max_connections` ceiling indicates leak
4. NOT-A-FIX: removing limits; production profile is bounded

### "Volume permission denied on docker compose up"

1. Likely cause: previous `down -v` left orphaned named volume in inconsistent state
2. `docker volume rm hub-substrate-data` + `docker compose up -d`

### "Hub bootstrap fails: schema validation error"

W2 substrate-init concern; check:
1. Reconciler has run (substrate-init migrations applied)
2. SchemaDef-for-SchemaDef self-bootstrap completed
3. All Hub-kind SchemaDefs present in `entities` table

See Design v1.1 §2.3 bootstrap-order + restart-safety statement.

---

## What's NOT in this cookbook yet (multi-wave deliverables)

- `scripts/local/get-entities.sh` daily-driver CLI (W7)
- `scripts/local/hub-snapshot.sh` snapshot-restore wrapper (W6/W7)
- `migrate-fs-to-substrate.ts` cutover invocation runbook (W5)
- Substrate-init migrations docker-entrypoint-initdb mount (W1+; commented in compose-yml)
- testcontainers harness setup (W0.4 / W1+; see Design v1.1 §2.7)
- Multi-postgres-flavor support (cloud-deploy follow-on per AG-4 / idea-298)

These will land per their respective wave-completion deliverables.
