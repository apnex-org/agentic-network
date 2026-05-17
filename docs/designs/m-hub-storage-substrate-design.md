# M-Hub-Storage-Substrate — Design v0.1

**Status:** v0.1 architect-draft; awaiting Phase 4 round-1 engineer audit
**Source idea:** idea-294
**Survey envelope:** `docs/surveys/m-hub-storage-substrate-survey.md` (Director-ratified 2026-05-16)
**Phase 4 coord thread:** thread-562 (converged 2026-05-17; 4 fold-ins from engineer pre-audit + AG-1 Director re-confirm)
**Branch:** `agent-lily/m-hub-storage-substrate`
**Mission-class:** substrate-introduction (with structural-inflection + saga-substrate-completion characteristics)
**Sizing:** L-XL (Round-1 max-architectural-scope; Round-2 simplest-mechanism)
**Author:** lily / 2026-05-17

---

## §1 Goal + intent (echo Survey envelope §3)

Establish `HubStorageSubstrate` as the sovereign-composition state-backplane for the Hub. Replace `LocalFsStorageProvider` AND `GcsStorageProvider` siblings (consolidated to one substrate per Survey outcome 1). Eliminate the sweeper-poll anti-pattern at root via native watch primitive (outcome 5). Operationalize CRD-equivalent programmability — declare a new entity-kind via SchemaDef entity, reconciler emits idempotent DDL automatically, no human-authored migration step (outcome 7). All companion features (resourceVersion / audit-history / FK-enforcement) explicitly deferred to follow-on missions (per Q5=d Director re-confirm 2026-05-17).

**The substrate IS the mission; nothing else gets in.**

Primary outcomes (load-bearing for v1 ship):
1. `HubStorageSubstrate` module ships with standard CRUD + list-filter + watch + SchemaDef + reconciler + snapshot interface
2. `LocalFsStorageProvider` + `GcsStorageProvider` retired at mission-end (`packages/storage-provider/` shrunk-not-deleted — `StorageProvider` interface + `MemoryStorageProvider` preserved for `repo-event-bridge`)
3. All sweepers + handlers migrated to substrate-API; bug-93 structurally closed
4. Hard-cut state-migration script tested + executed; existing Hub state preserved in substrate
5. CRD-equivalent programmability operationalized via SchemaDef + reconciler
6. Substrate runs in postgres container locally; cloud-portability verified by interface-shape only

Tele alignment (whole-mission primary): **tele-1 + tele-2 + tele-3 + tele-6 + tele-7** (all-4-load-bearing per Survey Q1=abcd). Secondary: tele-9 (chaos-validated migration), tele-11 (handlers shed deterministic-poll work).

---

## §2 Architecture

### §2.1 HubStorageSubstrate interface surface

The substrate is a discrete module at `hub/src/storage-substrate/` exposing a single interface. Above the boundary, the rest of the Hub (PolicyEngine, handlers, sweepers, tools) is substrate-agnostic — uses typed entities + structured filter API + change-event subscriptions. Below the boundary, all substrate-specific concerns (SQL, JSONB extraction, index management, snapshot tooling) are contained.

```typescript
interface HubStorageSubstrate {
  // — Schema management (CRD-equivalent) —
  applySchema(def: SchemaDef): Promise<void>
  listSchemas(): Promise<SchemaDef[]>
  getSchema(kind: string): Promise<SchemaDef | null>

  // — Entity CRUD (kind-uniform regardless of underlying storage layout) —
  get<T>(kind: string, id: string): Promise<T | null>
  put<T>(kind: string, entity: T): Promise<{ id: string }>
  delete(kind: string, id: string): Promise<void>
  list<T>(kind: string, opts?: ListOptions): Promise<T[]>

  // — Watch / change-notification —
  watch(kind: string, filter?: Filter): AsyncIterable<ChangeEvent<T>>

  // — Data-portability (Survey outcome 3) —
  snapshot(targetPath: string): Promise<SnapshotRef>
  restore(source: SnapshotRef): Promise<void>
}

interface ListOptions {
  filter?: Filter            // Mongo-ish; same shape as today's list_ideas tool filter
  sort?: { field: string; order: 'asc' | 'desc' }[]
  limit?: number             // max 500
  offset?: number
}

type Filter = {              // whitelisted fields per SchemaDef
  [field: string]: string | number | boolean | { $in?: any[]; $gt?: any; $lt?: any; $gte?: any; $lte?: any }
}

type ChangeEvent<T> = {
  op: 'put' | 'delete'
  kind: string
  id: string
  entity?: T                 // present on 'put'; absent on 'delete'
  resourceVersion: string    // monotonic per-row identifier (NOT optimistic-concurrency per AG-1; just opaque ordering token)
}
```

**Design notes:**
- `Filter` shape mirrors today's `list_ideas` MCP tool filter contract (Mongo-ish whitelisted-fields; `$in`/`$gt`/`$lt`/`$gte`/`$lte` operators) — preserves the API consumers already know.
- `resourceVersion` on `ChangeEvent` is an opaque monotonic ordering token (postgres `xmin` or sequence-based) for watch-stream replay-from-position semantics. **NOT to be confused with k8s-style `resourceVersion` for compare-and-swap writes — that is AG-1 (deferred per Q5=d).**
- `watch()` returns an `AsyncIterable` so handlers consume with `for-await-of`; substrate handles connection lifecycle + reconnect + resume-from-revision on transient failures.
- API verb/envelope-design (e.g., MCP tool surface) explicitly out-of-scope per AG-5 (deferred to idea-121 API v2.0).

### §2.2 Storage layout — single entities table + JSONB + per-kind expression indexes (Flavor A)

Per Survey outcome 9 (Director-confirmed: A only, B opt-in explicitly deferred):

```sql
CREATE TABLE entities (
  kind             TEXT NOT NULL,
  id               TEXT NOT NULL,
  data             JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resource_version BIGINT NOT NULL DEFAULT nextval('entities_rv_seq'),
  PRIMARY KEY (kind, id)
);

CREATE SEQUENCE entities_rv_seq;
CREATE INDEX entities_rv_idx ON entities (resource_version);  -- watch-stream replay
CREATE INDEX entities_updated_at_idx ON entities (updated_at);
-- Per-kind expression indexes emitted by reconciler from SchemaDef (see §2.3)
```

**Properties:**
- One table, ever. Adding a new kind = pure data write (no DDL). True CRD-feel.
- `resource_version` is a sequence-backed monotonic ordering token — NOT user-facing optimistic-concurrency (AG-1). Used by substrate-internal watch-stream replay-from-position semantics.
- `data` JSONB body holds everything per outcome 4's 1.5MB cap (enforced at substrate write-boundary via `pg_column_size(data) < 1572864` CHECK constraint).
- Per-kind hot-path indexes are emitted by the SchemaDef reconciler (§2.3) — postgres expression indexes on `((data->>'field')) WHERE kind = 'X'`. `CONCURRENTLY` for online creation; never locks the shared table.

### §2.3 SchemaDef + reconciler (CRD-equivalent programmability)

The CRD analog (per Survey outcome 7). SchemaDef is itself a SchemaDef-defined kind (bootstrap-self-referential — reconciler creates the SchemaDef-kind's own indexes from its own SchemaDef on first boot).

**SchemaDef shape:**
```typescript
interface SchemaDef {
  kind: string                          // entity kind this defines (e.g., "Message")
  version: number                       // bump on shape change; reconciler reads latest
  fields: FieldDef[]                    // declared field schema (validation-only, not column-promote since A-only)
  indexes: IndexDef[]                   // hot fields that get per-kind expression indexes
  watchable: boolean                    // whether to wire a NOTIFY trigger for this kind
}

interface FieldDef {
  name: string                          // dotted path into the entity (e.g., "status", "metadata.labels.env")
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  required: boolean
  enum?: string[]                       // optional enum constraint (validated at put())
}

interface IndexDef {
  name: string                          // human-readable index name (substrate-prefixed at DDL emission)
  fields: string[]                      // dotted-path fields participating in index
  where?: string                        // optional partial-index predicate (substrate-translated to JSONB syntax)
}
```

**Reconciler responsibilities:**
- Boot-time: read all SchemaDef entities; emit any missing/updated indexes via `CREATE INDEX CONCURRENTLY IF NOT EXISTS`
- Runtime: subscribe to `watch('SchemaDef')` via substrate's own watch primitive (eat-our-own-dogfood); on `put`, re-reconcile that kind's indexes
- Idempotent: re-running emits no-op DDL when current state already matches declared state
- Failure-isolated: index emission failure for one kind doesn't block others
- Index-only scope: reconciler NEVER emits DDL for tables/columns (Flavor A: single entities table; never altered after bootstrap)

**Bootstrap order on first Hub boot against fresh substrate:**
1. `CREATE TABLE entities` + sequence (substrate-init migration; one-shot per substrate)
2. Insert SchemaDef-for-SchemaDef entity (self-bootstrap)
3. Reconciler reads SchemaDef-for-SchemaDef + emits its indexes
4. Insert all other SchemaDef entities (one per Hub kind)
5. Reconciler reads + emits per-kind indexes
6. Hub becomes ready-for-writes

### §2.4 Watch primitive — postgres LISTEN/NOTIFY (architect-decision)

Two candidates were on the table at Survey-time; this Design picks **LISTEN/NOTIFY** for v1.

**Decision: LISTEN/NOTIFY + per-row trigger.**

```sql
CREATE FUNCTION entities_notify() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('entities_change', json_build_object(
    'op',   CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'put' END,
    'kind', COALESCE(NEW.kind, OLD.kind),
    'id',   COALESCE(NEW.id, OLD.id),
    'resource_version', COALESCE(NEW.resource_version, OLD.resource_version)
  )::text);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER entities_notify_trg
  AFTER INSERT OR UPDATE OR DELETE ON entities
  FOR EACH ROW EXECUTE FUNCTION entities_notify();
```

**Why LISTEN/NOTIFY over logical replication:**
- Simpler — built-in, no replication-slot management, no `pg_recvlogical` consumer
- Sufficient — Hub is a single writer-process; we don't need multi-consumer fan-out at substrate-protocol level
- NOTIFY payload limited to ~8KB; payload carries only `{op, kind, id, resource_version}` — handler does a `get()` to fetch the entity if needed (avoids the payload-size limit + lets stale-cache-aware handlers skip the fetch)
- Lower operational burden — no replication-lag monitoring, no slot-cleanup-on-consumer-crash

**Trade-off accepted:** LISTEN/NOTIFY drops messages if no consumer is connected at the moment of NOTIFY. Mitigation: handlers on reconnect query `WHERE resource_version > $last_seen` to catch up (the `resource_version` sequence makes this trivial). This is the standard substrate-watch pattern at our scale.

**Defer to follow-on if v1 surfaces these:**
- Multi-Hub-process write topology (would need logical replication for multi-writer coordination)
- Cross-network watch consumers (logical replication's WAL-shipping fits better)
- Audit-stream consumers needing every change ever (M-Hub-Storage-Audit-History territory; AG-2)

### §2.5 Snapshot + restore (data-portability per outcome 3)

`pg_dump` is the snapshot mechanism; output is a single binary `.dump` file at the configured target path.

```typescript
async snapshot(targetPath: string): Promise<SnapshotRef> {
  // Substrate wraps pg_dump -Fc (custom binary format; supports parallel restore + selective restore)
  // Target: --table=entities --table=entities_rv_seq (excludes substrate-internal trigger/function defs which are migration-managed)
  // Returns: { path, sizeBytes, snapshotAt, schemaVersion, entityCount }
}

async restore(source: SnapshotRef): Promise<void> {
  // pg_restore -d <db> source.path; substrate validates schemaVersion compat before restore
  // Re-emits triggers + functions if missing (substrate-init migration is idempotent)
}
```

**Notes:**
- Single binary file artifact (matches outcome 3 expectation — backup/transfer/manage-as-artifact)
- Operator-facing: `scripts/local/hub-snapshot.sh` wrapper (per §2.6) provides CLI surface
- Snapshot cadence + retention: out-of-scope (operator-policy concern; surfaced in Survey §calibration but not v1-mission scope)
- Cross-postgres-version compatibility: `pg_dump`/`pg_restore` handle minor-version upgrade; major-version upgrade requires `--no-owner --no-privileges` flags (documented in operator-DX cookbook §2.6)

### §2.6 Operator-DX (per engineer §E fold-in)

The current FS-substrate's `ls .ois/state/ + cat *.json + jq` workflow is the diagnostic dispositive across FSM states (per `reference_pending_action_queue_disk_inspection.md`). Moving to postgres without an explicit replacement is a hidden tele-1 regression at the operator surface. Design v0.1 includes BOTH option (c) per engineer §E:

**Surface 1 — Wrapper CLI (daily-driver):**

`scripts/local/get-entities.sh` (parallel to `scripts/local/get-agents.sh` per `reference_get_agents_canonical_diagnostic.md`):

```bash
get-entities.sh <kind> [--id=<id>] [--filter='key=value,key2=value2'] [--limit=N] [--format=table|json]
```

Examples:
```bash
get-entities.sh Message --filter='threadId=thread-562'                  # all messages on thread-562
get-entities.sh Thread --filter='status=active' --limit=20              # active threads
get-entities.sh PendingAction --filter='engineerId=agent-0d2c690e'      # pending actions for greg
get-entities.sh ScheduledMessage --filter='deliverAt<2026-05-17T12:00Z' # due-soon messages
```

CLI auth via `~/.config/apnex-agents/<role>.env` `HUB_TOKEN` + `HUB_URL` (matches existing pattern). Renders postgres `SELECT` against substrate API surface (NOT direct SQL — uses the substrate's standard `list()` to maintain encapsulation).

Companion script `scripts/local/hub-snapshot.sh` wraps `substrate.snapshot()` for operator-facing snapshot/restore.

**Surface 2 — psql cookbook (escape-hatch for power-users / forensic / ad-hoc):**

`docs/operator/psql-cookbook.md` (new doc; W6 ship-criteria):

```sql
-- All active threads
SELECT id, data->>'title' AS title FROM entities WHERE kind = 'Thread' AND data->>'status' = 'active';

-- Pending actions by engineer
SELECT id, data->>'op' AS op, data->>'engineerId' AS engineer
FROM entities WHERE kind = 'PendingAction' AND data->>'engineerId' = 'agent-0d2c690e';

-- Recent activity (across all kinds)
SELECT kind, id, updated_at FROM entities ORDER BY updated_at DESC LIMIT 100;
```

CLI is the daily-driver; psql is for incidents + investigations the CLI doesn't anticipate.

---

## §3 Migration plan — hard-cut state-migration script (per Q4=a)

### §3.1 State-migration script architecture

Single binary script (`hub/scripts/migrate-fs-to-substrate.ts`) executed via `npm run migrate-fs-to-substrate` from Hub working directory. Invocation:

```bash
npm run migrate-fs-to-substrate -- \
  --source=<path-to-.ois/state/> \
  --target=<postgres-connection-string> \
  --backup=<path-to-pre-cutover-snapshot.tar.gz> \
  [--dry-run] \
  [--resume-from=<entity-kind>]
```

**Phases (sequential):**
1. **Pre-cutover snapshot** — `tar -czf $backup $source` to a backup path; verify writeable + sufficient disk
2. **Source scan** — walk `<source>` directory tree; build full entity inventory by kind (per §3.4 coverage matrix)
3. **Schema bootstrap** — connect to substrate; run `CREATE TABLE entities` migration if not exists; apply SchemaDef-for-SchemaDef + per-kind SchemaDefs
4. **Reconciler primer** — wait for reconciler to settle (all per-kind expression indexes exist) before bulk-insert
5. **Bulk insert** — per-kind COPY-based load (postgres `COPY entities FROM STDIN`) for throughput; entity-id is the natural primary key (no auto-id gen)
6. **Verification** — per-kind count parity check (source count == target count); spot-check sample entities by content-hash; emit verification report
7. **Cut signal** — emit completion-marker file at `<source>/.MIGRATION_COMPLETE` so Hub bootstrap can refuse to start against FS post-cutover (forces operator to use substrate)

**Idempotency** (per §3.3): entity-id is the natural primary key; re-running with `--resume-from=<kind>` skips already-loaded kinds. Mid-kind interruption is safe — `INSERT ... ON CONFLICT (kind, id) DO UPDATE` semantics (last-write-wins).

**Failure handling:**
- Schema bootstrap fails → script exits; no data touched; substrate stays empty
- Bulk insert fails mid-kind → script exits; `--resume-from=<kind>` continues from interrupted kind (per-kind atomic)
- Verification fails → script exits with non-zero; operator decision tree per §3.2 runbook

### §3.2 Reverse-path runbook (per engineer §A.1)

**Disposition:** pre-cutover FS snapshot is the safety net for **during-cutover-abort ONLY**. Post-cutover-success is **fix-forward**.

Rationale: rolling back to FS substrate after the Hub has been running on postgres for any non-trivial period would itself be a substrate-rewrite (postgres-to-FS migration script — which we don't have). Mission-class substrate-introduction accepts this: the cutover moment is the burn-bridge; pre-cutover snapshot insurance is for that moment only.

**Runbook — during-cutover abort:**
```bash
# Symptom: state-migration script fails verification OR detects unrecoverable error
# 1. Stop the migration script (CTRL-C or wait for self-exit)
# 2. Drop the partial substrate state (CAUTION — destructive):
psql -d hub -c "TRUNCATE entities, entities_rv_seq;"
# 3. Restore from pre-cutover snapshot:
rm -rf <source>  # remove any partial migration markers
tar -xzf <backup> -C <source-parent>
# 4. Verify FS state intact:
ls -la <source>/messages/ <source>/threads/ <source>/missions/  # spot-check
# 5. Restart Hub on FS substrate:
HUB_STORAGE=fs npm start
# 6. File a bug for the migration-script-failure cause
```

**Runbook — post-cutover-success bug surfaces:**
```
DISPOSITION: fix-forward via M-Hub-Storage-* follow-on (post-cutover rollback to FS is NOT supported).
1. File a bug with full context (failure mode, repro, blast-radius)
2. Triage severity:
   - CRITICAL (data-corruption / Hub-down): hotfix on substrate; ship in follow-on
   - MAJOR (degraded functionality): same as critical with less urgency
   - MINOR (cosmetic / non-blocking): defer to next cleanup wave
3. Hard-cut decisions are accepted by mission-class substrate-introduction; rollback budget = zero
```

### §3.3 Idempotency-key strategy (per engineer §A.2)

**Disposition:** entity-id last-write-wins.

`INSERT INTO entities (kind, id, data, created_at, updated_at) VALUES (...) ON CONFLICT (kind, id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`

Justification (per engineer's lean): cutover happens with Hub stopped (no concurrent writers); migration script re-run scenarios are operator-initiated retries, not race-conditions. Mid-flight FS mutation is not a concern. Content-hash idempotency-key would add complexity without addressing a real race surface in v1.

**Validation:** verification phase (§3.1 step 6) spot-checks N random entities post-load by re-reading the source FS file + comparing content; mismatch indicates a deserialization bug, not an idempotency-key gap.

### §3.4 Entity-coverage matrix via filesystem-grep (per engineer §A.3)

**Inventory verified at Design v0.1 time** (2026-05-17; via `ls local-state/` + `grep -rln` against `hub/src/entities/`; spec-level memory-recall demoted to filesystem-verified). W0 spike re-verifies + may surface additional auxiliary stores the architect grep missed.

#### §3.4.1 Primary entities (migrate as rows in `entities` table)

Each currently persisted as `local-state/<dir>/<id>.json`; ID is the natural primary key. 18 kinds total:

| Kind | local-state dir | ID-shape | Notes |
|---|---|---|---|
| Agent | `agents/` | agent-XXXXXXXX | |
| Audit | `audit/` | audit-NNN | |
| Bug | `bugs/` | bug-NN | |
| Counter | `meta/counter.json` | (single-row) | One file per counter-domain; migrate as one row per counter |
| DirectorNotification | `director-notifications/` | dn-YYYY-MM-DD-NNN | |
| Document | `documents/<category>/<name>.md` | derived | **Markdown body content** in `data.content`; metadata in `data.category` etc.; well within 1.5MB cap |
| Idea | `ideas/` | idea-NNN | |
| Message | `messages/` | ULID | |
| Mission | `missions/` | mission-NN | |
| Notification | `notifications/` | notif-NNNNNNNN | |
| PendingAction | `pending-actions/` | (handler-assigned) | |
| Proposal | `proposals/` | proposal-NNN | |
| Report | `reports/` | report-NNN | |
| Review | `reviews/` | review-NNN | |
| Task | `tasks/` | task-NNN | Clarification IS NOT a separate kind — verified inline field on Task per `hub/src/entities/task-repository.ts` grep |
| Tele | `tele/` | tele-NN | |
| Thread | `threads/` | thread-NNN | |
| Turn | `turns/` | turn-NNN | |
| **SchemaDef** (NEW) | n/a (substrate-native) | kind name | Introduced by this mission; bootstrap-self-referential per §2.3 |

**Kinds explicitly removed from prior provisional inventory** (Design v0.1 first-draft had these; verified to NOT be separate kinds at filesystem-grep time):
- `Clarification` — only mentioned in `task-repository.ts`; inline field on Task entity, not separate kind
- `ThreadMessage` — verified single `Message` kind exists; no separate ThreadMessage entity

#### §3.4.2 Substrate-internal indexes (NOT migrated as entities; replaced by per-kind expression indexes per §2.2)

| Index location | Replacement |
|---|---|
| `local-state/messages-thread-index/thread-NNN/` | postgres expression index `ON entities ((data->>'threadId')) WHERE kind = 'Message'` (per §2.3 SchemaDef-emitted) |

This is the DIY-secondary-index that bug-93 surfaced — it goes away structurally with substrate (the index is replaced by a postgres-native equivalent the query planner uses automatically).

#### §3.4.3 Architect-context (OQ-NEW for round-1 audit)

`local-state/architect-context/` holds 3 append-only structured-log files:
- `decisions.json`
- `director-history.json`
- `review-history.json`

**Disposition (architect-current-pick; surface as OQ7 for engineer round-1 audit):** migrate as 3 entity-kinds (`ArchitectDecision`, `DirectorHistoryEntry`, `ReviewHistoryEntry`) — each log-entry becomes one entity-row. Aligns with Survey outcome 1 (one substrate, no out-of-substrate state). Append-only semantics preserved by handler-side discipline (no entity-mutation, only entity-add).

Alternative: keep file-based out-of-substrate. Trade-off — simpler migration (less to convert) but violates outcome 1.

#### §3.4.4 Out-of-substrate (preserved as-is; NOT migrated)

These remain file-system-backed; substrate doesn't touch them:

| Location | Why out-of-substrate |
|---|---|
| `local-state/repo-event-bridge/cursor/ + dedupe/` | `repo-event-bridge` package state; uses `MemoryStorageProvider` per §5.2 keep-list |
| `local-state/repo-event-bridge-workflow-runs/cursor/ + dedupe/` | Same |
| `local-state/docs/` | Static markdown assets (NOT Hub-runtime-state; documentation files; git-tracked elsewhere) |

#### §3.4.5 Migration script ENUM source-of-truth

`hub/scripts/entity-kinds.json` (generated at W0 by filesystem-grep; checked into repo; used by migration script + Hub bootstrap reconciler-primer). Source-of-truth lineage:
- Architect Design v0.1 declares the 18-kind inventory + 3-disposition-pending architect-context
- W0 spike's filesystem-grep regenerates entity-kinds.json from current code; any architect-blind kind triggers Design v0.2 revision
- Migration script reads entity-kinds.json at runtime; refuses to start if any kind in local-state has no entry (defends against silent-skip migration bug)

### §3.5 Downtime budget + cutover orchestration (per engineer §A.4)

**Target: <60 seconds cutover** at current scale (~10k entities × ~1-10ms postgres COPY-based insert throughput per entity = ~10-100 seconds for raw insert; +verification +index-population +bootstrap-validation = bounded by ~60s for current scale).

**Phase 6 preflight verification metric:** measured cutover-script wall-clock time on a representative Hub state dump; preflight fails if measured cutover > 60s OR fails verification.

**Cutover orchestration sequence:**
```
T+00:00  Hub stopped (operator: `systemctl stop hub` or equivalent)
T+00:05  Pre-cutover snapshot tar -czf $backup (background; verify return code)
T+00:15  Start migration script with verified backup path
T+00:55  Migration script verification PASS; .MIGRATION_COMPLETE marker emitted
T+01:00  Operator switches Hub config to substrate-mode (`HUB_STORAGE=substrate`)
T+01:05  Hub started; substrate-mode bootstrap runs (validates SchemaDef + reconciler-settle)
T+01:15  Hub ready; first request accepted on substrate
```

Total observed downtime ≈ 60-75 seconds for current scale. Phase 6 preflight measures + reports.

**Operator runbook lives at:** `docs/operator/hub-storage-cutover-runbook.md` (W6 ship-criteria).

---

## §4 Wave decomposition (W0-W7; per F2 + engineer §B (α) reading)

**Critical principle (per engineer §B):** wave-completion ≠ data-cutover. Waves W1-W4 build substrate code + integration paths against pre-cutover empty substrate (verified via integration tests). Full data appears at W5 cutover. Waves W6-W7 finalize cleanup + ship.

| Wave | Scope | Acceptance criteria | Substrate state during |
|---|---|---|---|
| **W0** | Spike — postgres-container local-dev compose-up; entity-kinds enumeration via filesystem-grep; SchemaDef-for-SchemaDef bootstrap; downtime-budget measurement against synthetic state | Spike report + entity-kinds.json + downtime-budget measurement; engineer counterpart branch created | Empty (spike-only) |
| **W1** | Substrate shell — `hub/src/storage-substrate/` module skeleton; `entities` table + sequence + base indexes; CRUD operations (get/put/delete/list) without watch; unit tests against a test-postgres container | All CRUD ops covered by unit tests; substrate boots cleanly; passes typecheck + lint | Empty |
| **W2** | Reconciler + SchemaDef — `SchemaDef` kind registered; reconciler observes SchemaDef puts via NOTIFY trigger; idempotent `CREATE INDEX CONCURRENTLY` emission; SchemaDef-for-all-Hub-kinds checked in | All Hub kinds have SchemaDef; reconciler-test confirms idempotent re-run; per-kind indexes exist | SchemaDefs populated; entities still empty |
| **W3** | Sweepers wired to substrate API — ScheduledMessageSweeper + MessageProjectionSweeper + others read from substrate via `list()` + `watch()`; integration tests verify sweepers function against synthetic substrate entities | Sweepers pass integration tests; production wire-up still routes via FS substrate (substrate is dark) | Empty (handlers still write to FS) |
| **W4** | Handlers wired to substrate API — message-handler / thread-handler / mission-handler / etc. write entities via substrate `put()`; reads via `get()` + `list()` | All handlers pass integration tests against substrate; production still routes FS (substrate dark) | Empty |
| **W5** | **State-migration cutover** — Hub stopped; pre-cutover snapshot; `npm run migrate-fs-to-substrate`; verification PASS; Hub restart with `HUB_STORAGE=substrate` flag; first request on substrate | <60s measured downtime; verification PASS; Hub healthy on substrate; bug-93 sweeper-poll-pressure observed-eliminated via watch-driven model | **Full data; LIVE** |
| **W6** | `LocalFsStorageProvider` + `GcsStorageProvider` deletion — remove from `packages/storage-provider/` (keep interface + MemoryStorageProvider for repo-event-bridge); update CODEOWNERS; remove FS-related env vars; `repo-event-bridge` tests still pass | `packages/storage-provider/` shrunk per §5; no broken consumers; tests + CI green | LIVE |
| **W7** | Ship — operator runbook + psql cookbook + get-entities.sh + hub-snapshot.sh; update CLAUDE.md substrate notes; mission Phase 7 release-gate; file follow-on ideas (M-Hub-Storage-ResourceVersion + Audit-History + FK-Enforcement + Cloud-Deploy per F4) | All v1 acceptance gates pass; release-gate Director-approved; follow-on ideas filed | LIVE |

**Wave commit cadence:** wave-per-PR cumulative-fold per mission-68 M6 pattern (W1 PR cumulatively folds W0; W2 PR cumulatively folds W0+W1; etc.). Final ship PR (W7) includes all 8 waves.

**Branch architecture:**
- Architect: `agent-lily/m-hub-storage-substrate` (Design + Survey + cross-mission coordination)
- Engineer: `agent-greg/m-hub-storage-substrate` (W0 spike + all implementation waves; created at W0 spike commit-time)
- PR target: `main` after engineer-branch ↔ architect-branch cross-approval per `multi-agent-pr-workflow.md`

---

## §5 Substrate location + package shape (per engineer §C fold-in)

### §5.1 `hub/src/storage-substrate/` — new module

Substrate-internal module. Hub-specific (no cross-package consumer). Exposes only the `HubStorageSubstrate` interface (§2.1). Not extending the legacy `StorageProvider` interface — the surface is genuinely new (CRUD + list-filter + watch + schema vs raw get/put/list).

```
hub/src/storage-substrate/
├── index.ts                  // exports HubStorageSubstrate interface + concrete factory
├── postgres-substrate.ts     // PostgresStorageSubstrate implementation
├── schema-reconciler.ts      // reconciler that observes SchemaDef + emits DDL
├── watch-dispatcher.ts       // LISTEN/NOTIFY consumer; dispatches ChangeEvent to subscribers
├── migrations/               // substrate-init SQL (table, sequence, trigger, function); idempotent
│   ├── 001-entities-table.sql
│   ├── 002-resource-version-sequence.sql
│   └── 003-notify-trigger.sql
├── types.ts                  // SchemaDef, FieldDef, IndexDef, Filter, ChangeEvent, ListOptions
└── __tests__/                // unit + integration tests against test-postgres-container
```

### §5.2 `packages/storage-provider/` — SHRINK, not delete

Per engineer §C catch: `packages/repo-event-bridge/` depends on `@apnex/storage-provider` for `MemoryStorageProvider`. The package SHRINKS at W6 — NOT deletes.

**v1 ship state for `packages/storage-provider/`:**
- **Keep:** `StorageProvider` interface (used by `MemoryStorageProvider`'s type contract)
- **Keep:** `MemoryStorageProvider` (still consumed by `repo-event-bridge` tests + runtime)
- **Delete:** `LocalFsStorageProvider` + its tests
- **Delete:** `GcsStorageProvider` + its tests
- **Delete:** any other `Local*` / `Gcs*` provider variants

**W6 acceptance gate:** `cd packages/repo-event-bridge && npm test` passes. Regression-net guarding against accidental `rm -rf packages/storage-provider/`.

### §5.3 CODEOWNERS update

`hub/src/storage-substrate/` ownership: substrate-architect (new entry).
`packages/storage-provider/` ownership: unchanged (existing entry; just slimmer scope).

---

## §6 Anti-goals (locked from Survey §5)

Explicitly out-of-scope for this mission. Director re-confirmed Q5=d 2026-05-17 (including AG-1 re-confirm post engineer push-back).

| AG | Description | Composes-with target |
|---|---|---|
| AG-1 | Optimistic concurrency / `resourceVersion` / compare-and-swap writes | M-Hub-Storage-ResourceVersion (follow-on; file at mission-close) |
| AG-2 | Audit / history-table — per-entity history populated by trigger | M-Hub-Storage-Audit-History (follow-on; file at mission-close) |
| AG-3 | Foreign-key enforcement — postgres FKs across entity references | M-Hub-Storage-FK-Enforcement (follow-on; file at mission-close) |
| AG-4 | Cloud-deployment — CloudSQL/AlloyDB provisioning + IAM + VPC + cutover | M-Hub-Storage-Cloud-Deploy (follow-on; file at mission-close) |
| AG-5 | API verb / envelope redesign (MCP tool surface for new substrate operations) | deferred to idea-121 API v2.0 |
| AG-6 | Per-kind dedicated tables (Flavor B); per-kind storage-layout opt-in | not engineering for hypothetical; follow-on idea if specific kind demands it |
| AG-7 | Methodology document changes (mission-lifecycle.md, etc.) | substrate-only mission |

**Phase 6 preflight responsibility:** audit for AG-1..AG-4 scope creep. If any companion-feature has crept into the v1 implementation, surface to Director before release-gate.

**Phase 10 retrospective responsibility (architect TODO):** file all 4 follow-on ideas (M-Hub-Storage-ResourceVersion + Audit-History + FK-Enforcement + Cloud-Deploy) per F4 PROBE before mission-close.

---

## §7 Risks + open questions

### §7.1 Risks

| ID | Risk | Mitigation |
|---|---|---|
| R1 | State-migration script bug → corrupted/lost data at cutover (F1 CRITICAL) | Pre-cutover FS snapshot insurance; verification phase (§3.1.6); operator-runbook for during-cutover abort (§3.2); spike validates against synthetic state at W0 |
| R2 | XL sizing → scope creep within single bundled mission (F2 MEDIUM) | Explicit W0-W7 decomposition (§4); Phase 6 preflight AG-1..AG-4 scope-creep audit; mission-class substrate-introduction discipline |
| R3 | Substrate-API expressiveness gap → handler can't express needed query (e.g., JOIN, aggregation) | Filter surface intentionally bounded (filter+sort+limit; Mongo-ish whitelisted fields per `list_ideas` precedent); escape-hatch via direct-postgres for tooling/admin only; handler refactor if substrate-API genuinely insufficient |
| R4 | LISTEN/NOTIFY message-drop on consumer disconnect → handler misses change | Standard pattern: handlers replay from `resource_version > $last_seen` on reconnect; `resource_version` sequence makes this O(1) lookup |
| R5 | Reconciler bug → wrong indexes / missing indexes / DDL drift | Idempotent re-run on every boot; integration tests verify reconciler against synthetic SchemaDef changes; per-kind index emission is failure-isolated (one kind's bug doesn't break others) |
| R6 | postgres-container resource exhaustion on local-dev (long-running session; many test-runs) | Local-dev compose-file specifies memory + connection limits; documented in operator-DX cookbook |
| R7 | Migration downtime > 60s target → Phase 6 preflight fails | Bulk insert via `COPY` (postgres-native; 10-100× faster than parallel INSERTs); per-kind atomic load enables `--resume-from=<kind>` recovery; if scale outgrows <60s budget, follow-on optimization (parallel per-kind COPY) |
| R8 | repo-event-bridge MemoryStorageProvider divergence after W6 shrink | W6 acceptance gate runs `repo-event-bridge` tests; CI workflow includes cross-package test orchestration |

### §7.2 Open questions for engineer round-1 audit

These come back as Q-N audit items in the round-1 audit thread (separate thread, opened post-Design-v0.1 commit):

- **OQ1** — Reconciler observation mechanism: should reconciler use the SAME watch primitive (NOTIFY-via-substrate, eat-our-own-dogfood) OR a separate bootstrapping mechanism (poll SchemaDef table on a timer)? Current Design picks watch-via-substrate; needs engineer perspective on bootstrap-ordering complexity (reconciler depends on watch which depends on trigger which is created by substrate-init migration which runs before reconciler).
- **OQ2** — Migration script invocation surface: `npm run migrate-fs-to-substrate` (architect-current-pick) OR a standalone binary `hub-migrate` OR a `hub-cli migrate` subcommand? Current is `npm run` for consistency with other Hub admin tasks; engineer judgment on operator-DX.
- **OQ3** — Entity-kinds source-of-truth (§3.4): generated `entity-kinds.json` (architect-current-pick) OR runtime-derived via `Object.keys(substrate.schemas)` at migration script invocation? Current is checked-in JSON for deterministic build; engineer judgment.
- **OQ4** — Substrate-init migrations runner: bespoke (Hub-side migration-runner reads `migrations/*.sql`) OR off-the-shelf (`node-pg-migrate`, `flyway-style`)? Current Design implies bespoke (simpler; 3 migrations); engineer judgment on whether off-the-shelf saves more than it costs.
- **OQ5** — Watch-stream backfill semantics: when handler subscribes mid-Hub-runtime, should substrate replay all events from epoch OR only-new? Current Design's NOTIFY-based watch is only-new; handlers needing backfill use `list()` + then `watch()` (standard "list-watch" pattern from k8s informer). Engineer judgment on whether this composes cleanly with sweeper restart-without-state-loss.
- **OQ6** — Postgres flavor pick (vanilla / AlloyDB / Cockroach / Yugabyte): Design currently assumes vanilla postgres. Q6=a defers cloud-deployment so this is mostly a follow-on concern. Should W0 spike validate against more than one flavor to de-risk the eventual cloud-deploy follow-on?
- **OQ7** — Architect-context disposition (`local-state/architect-context/` per §3.4.3): migrate as 3 entity-kinds (`ArchitectDecision`, `DirectorHistoryEntry`, `ReviewHistoryEntry` — architect-current-pick) OR keep file-based out-of-substrate (simpler migration; violates Survey outcome 1)? Inventory-verification side-effect of demoting §3.4 from provisional to verified at Design v0.1 time.

---

## §8 Mission-class declaration + ADR

**Mission-class:** substrate-introduction (per Survey §4)
**Class-secondary characteristics:** structural-inflection (multi-substrate-seam shift: storage-substrate + watch-substrate + schema-substrate all introduced together); saga-substrate-completion (consolidates two legacy providers into one substrate)

**ADR-TBD-storage-substrate** (to be authored at W1 substrate-shell ship): captures the choice of postgres + JSONB Flavor A + LISTEN/NOTIFY + SchemaDef-reconciler-CRD-pattern as the substrate-introduction architecture; rationale per Survey §3 composite intent envelope; lifetime expected: substrate generation lifetime (years).

---

## §9 Engineer audit ask (round-1 questions for separate audit thread)

When this Design v0.1 is committed + pushed (commit-target: `agent-lily/m-hub-storage-substrate`), architect opens a NEW thread for the round-1 audit (separate from thread-562 coord, per `multi-agent-pr-workflow.md` convention).

The round-1 audit thread carries:
- This Design v0.1 path reference
- OQ1-OQ6 as explicit audit questions
- Architect-flags F1-F4 carried forward as audit-rubric items
- Engineer round-1 audit-rubric classifications expected: CRITICAL / MEDIUM / MINOR / PROBE per mission-67 + mission-68 precedent

**Audit ask shape (for new thread):**

> Phase 4 round-1 audit on Design v0.1 of M-Hub-Storage-Substrate. Design at `docs/designs/m-hub-storage-substrate-design.md`. Survey envelope context preserved at `docs/surveys/m-hub-storage-substrate-survey.md`; Phase 4 coord thread-562 converged.
>
> Round-1 audit asks: classify each of {OQ1-OQ6} as CRITICAL/MEDIUM/MINOR/PROBE + recommend disposition. Flag any architect-blind spots in §2-§5. Flag any wave-decomposition coherence issues in §4 not addressed by (α) reading.

---

## §10 Cross-references

- **Survey envelope:** `docs/surveys/m-hub-storage-substrate-survey.md`
- **Source idea:** idea-294 (Hub state-persistence / database modernization)
- **Phase 4 coord thread:** thread-562 (converged 2026-05-17)
- **Sibling problem:** bug-93 (sweeper poll-throttle band-aid; PR #203; structurally closed by W5 cutover)
- **Out-of-scope sibling:** idea-121 API v2.0 (AG-5 deferral target)
- **Methodology:** `docs/methodology/mission-lifecycle.md`; `docs/methodology/multi-agent-pr-workflow.md`; `docs/methodology/entity-mechanics.md`
- **CODEOWNERS:** `.github/CODEOWNERS` (W1 update for `hub/src/storage-substrate/`)
- **Operator docs (W6+W7):** `docs/operator/psql-cookbook.md` (NEW); `docs/operator/hub-storage-cutover-runbook.md` (NEW)
- **Existing operator-DX precedent:** `scripts/local/get-agents.sh` (parallel pattern for `get-entities.sh`)
- **Tele references:** `docs/methodology/tele-glossary.md` (tele-1, tele-2, tele-3, tele-6, tele-7 primary; tele-9, tele-11 secondary)
- **Calibrations:** `docs/calibrations.yaml` (#59 closure mechanism (a) applied at Survey envelope branch-push)

---

## §11 Status

- **v0.1 architect-draft** — 2026-05-17; awaiting Phase 4 round-1 engineer audit
- **Branch:** `agent-lily/m-hub-storage-substrate`
- **Commits:**
  - 8eed879 — Survey envelope (Phase 3)
  - d9fadf3 — Design v0.1 initial draft
  - (pending) — §3.4 inventory-verification + OQ7 addition (post-filesystem-grep architect-side verification; demotes §3.4 from "provisional" to "filesystem-verified at Design v0.1 time")
- **Round-1 audit thread:** thread-563 (opened 2026-05-17; greg's turn)
- **Follow-on ideas filed** (per F4 PROBE; de-risks mission-close-forget): idea-295 M-Hub-Storage-ResourceVersion, idea-296 M-Hub-Storage-Audit-History, idea-297 M-Hub-Storage-FK-Enforcement, idea-298 M-Hub-Storage-Cloud-Deploy
- **Expected progression:** v0.1 → engineer round-1 audit (CRITICAL/MEDIUM/MINOR/PROBE classifications + OQ1-OQ7 dispositions) → v0.2 architect-revision incorporating audit dispositions → bilateral cycle to v1.0 ratified → Phase 5 mission entity creation → Phase 6 preflight → Phase 7 release-gate

— Architect: lily / 2026-05-17
