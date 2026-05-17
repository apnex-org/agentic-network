# M-Hub-Storage-Substrate — Design v1.1 (inventory-currency cleanup post W0.2 spike findings)

**Status:** v1.1 architect-direct cleanup 2026-05-17 (v1.0 RATIFIED per thread-563; v1.1 incorporates W0.2 substantive findings — 5 architect-blind-kind-corrections + 4 architect-validates + 1 NEW finding ThreadHistoryEntry + wisdom/ disposition; engineer-lean disposition (a) fold-as-v1.1-cleanup accepted; v1.0 ratify-criterion still met — inventory-corrections are MINOR architect-judgment, not CRITICAL changes requiring re-audit)
**Source idea:** idea-294
**Survey envelope:** `docs/surveys/m-hub-storage-substrate-survey.md` (Director-ratified 2026-05-16)
**Phase 4 coord thread:** thread-562 (converged 2026-05-17; 4 fold-ins from engineer pre-audit + AG-1 Director re-confirm)
**Phase 4 round-1 audit thread:** thread-563 (12 findings: 3 CRITICAL / 4 MEDIUM / 3 MINOR / OQ + 4 blind-spot; all dispositions in v0.2)
**Branch:** `agent-lily/m-hub-storage-substrate`
**Mission-class:** substrate-introduction (with structural-inflection + saga-substrate-completion characteristics)
**Sizing:** L (revised down from L-XL post Option-Y substrate-replaces-StorageProvider-only scope; repositories preserved per round-1 audit C2)
**Author:** lily / 2026-05-17

---

## §1 Goal + intent (echo Survey envelope §3)

Establish `HubStorageSubstrate` as the sovereign-composition state-backplane for the Hub. Replace `LocalFsStorageProvider` AND `GcsStorageProvider` siblings (consolidated to one substrate per Survey outcome 1). Eliminate the sweeper-poll anti-pattern at root via native watch primitive (outcome 5). Operationalize CRD-equivalent programmability — declare a new entity-kind via SchemaDef entity, reconciler emits idempotent DDL automatically, no human-authored migration step (outcome 7). Preserve v0 race-protection semantics via CAS primitives (`createOnly` + `putIfMatch`) at substrate-interface level (per round-1 audit C1 Director re-disposition 2026-05-17). Other companion features (k8s-style resourceVersion / audit-history / FK-enforcement) explicitly deferred to follow-on missions (per Q5=d).

**The substrate IS the mission; nothing else gets in** (with CAS-primitive carve-in to preserve v0 race-protection at cutover, per C1 corrected-premise re-disposition).

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
  put<T>(kind: string, entity: T): Promise<{ id: string; resourceVersion: string }>
  delete(kind: string, id: string): Promise<void>
  list<T>(kind: string, opts?: ListOptions): Promise<{ items: T[]; snapshotRevision: string }>

  // — CAS primitives (preserve v0 race-protection; round-1 audit C1) —
  createOnly<T>(kind: string, entity: T): Promise<
    | { ok: true;  id: string; resourceVersion: string }
    | { ok: false; conflict: 'existing' }
  >
  putIfMatch<T>(kind: string, entity: T, expectedRevision: string): Promise<
    | { ok: true;  resourceVersion: string }
    | { ok: false; conflict: 'revision-mismatch'; actualRevision: string }
  >

  // — Watch / change-notification —
  watch<T>(kind: string, opts?: WatchOptions): AsyncIterable<ChangeEvent<T>>

  // — Data-portability (Survey outcome 3) —
  snapshot(targetPath: string): Promise<SnapshotRef>
  restore(source: SnapshotRef): Promise<void>
}

interface ListOptions {
  filter?: Filter            // Mongo-ish; whitelisted-fields per SchemaDef
  sort?: { field: string; order: 'asc' | 'desc' }[]
  limit?: number             // max 500
  offset?: number
}

interface WatchOptions {
  filter?: Filter
  // OQ5 disposition: list-then-watch backfill is the standard pattern (k8s informer).
  // Caller does substrate.list() → captures snapshotRevision → substrate.watch({ sinceRevision }).
  // sinceRevision is the snapshotRevision from a prior list() result. Substrate replays
  // change-events strictly newer than that revision; no missed-events window.
  sinceRevision?: string
}

// Per SchemaDef.FieldDef.type, Filter is narrowed at validation time. Round-1 audit N1:
// Filter operator-values match QueryableFieldType discipline from M-QueryShape Phase 1
// (idea-119 / task-302; hub/src/policy/list-filters.ts):
//   - $gt/$lt/$gte/$lte permitted only on numeric + date fields
//   - $in permitted on all scalar types
//   - $regex/$where/$expr/$or/$and/$not forbidden (substrate enforces, errors on use)
type FilterValue =
  | string | number | boolean
  | { $in: (string | number | boolean)[] }
  | { $gt?: number | string; $lt?: number | string; $gte?: number | string; $lte?: number | string }
type Filter = Record<string, FilterValue>   // field-name → FilterValue (SchemaDef-validated)

type ChangeEvent<T> = {
  op: 'put' | 'delete'
  kind: string
  id: string
  entity?: T                  // present on 'put'; absent on 'delete'
  resourceVersion: string     // monotonic per-row identifier — opaque ordering token + CAS token for putIfMatch
}
```

**Design notes:**
- `Filter` shape mirrors today's `list_ideas` MCP tool filter contract — and adheres to the **M-QueryShape Phase 1 QueryableFieldType discipline** per round-1 audit N1 fold-in. Range operators (`$gt`/`$lt`/`$gte`/`$lte`) permitted only on numeric + date fields; substrate rejects with a typed error otherwise.
- `resourceVersion` is dual-purpose: (1) opaque monotonic ordering token for watch-stream replay-from-position; (2) **CAS token for `putIfMatch`** (per C1 fold-in). It is NOT k8s-style entity-versioning-as-API-field (that remains AG-1 / M-Hub-Storage-ResourceVersion idea-295 territory) — the CAS use here is the substrate-level race-protection equivalent to mission-47 `StorageProvider` v1.0 contract (`createOnly` + `putIfMatch`).
- `list()` returns `{ items, snapshotRevision }` — the snapshotRevision is the consistent point-in-time the list-result represents; subsequent `watch({ sinceRevision: snapshotRevision })` is gap-free (no missed events during the list-call window). This is the **list-then-watch primitive** that k8s informers depend on (round-1 audit OQ5 caveat addressed).
- `watch()` returns `AsyncIterable` so handlers consume with `for-await-of`; substrate handles connection lifecycle + reconnect + resume-from-revision on transient failures.
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

**Restart-safety (round-1 audit M4 fold-in):** the reconciler boot path is restart-safe at any step. Crash between steps 2 and 3: on restart, reconciler re-reads SchemaDef-for-SchemaDef (already inserted by INSERT-ON-CONFLICT-DO-NOTHING — idempotent) and re-emits its indexes (CREATE INDEX CONCURRENTLY IF NOT EXISTS — idempotent). Same for steps 4-5: each SchemaDef insert is ON-CONFLICT-DO-NOTHING; each index-emission is CONCURRENTLY-IF-NOT-EXISTS. There is no partial state that breaks reconciler-restart. Tested at W2 wave acceptance via deliberate kill-9 between bootstrap steps + restart-verifies-completes.

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

`scripts/local/get-entities.sh` (parallel to `scripts/local/get-agents.sh` per `reference_get_agents_canonical_diagnostic.md`). **Direct-psql** per round-1 audit N2 fold-in (engineer-lean accepted) — CLI talks postgres directly via local connection string from env; no HUB_TOKEN / HUB_URL involvement. This matches today's `ls .ois/state/ + cat + jq` shape: forensic operator surface that bypasses Hub HTTP-layer for direct inspection.

```bash
get-entities.sh <kind> [--id=<id>] [--filter='key=value,key2=value2'] [--limit=N] [--format=table|json]
```

Examples:
```bash
get-entities.sh Message --filter='threadId=thread-562'                  # all messages on thread-562
get-entities.sh Thread --filter='status=active' --limit=20              # active threads
get-entities.sh PendingAction --filter='engineerId=agent-0d2c690e'      # pending actions for greg
```

CLI reads `HUB_PG_CONNECTION_STRING` (or default `postgres://hub:hub@localhost:5432/hub` for local-dev). Renders postgres `SELECT` directly against `entities` table; translates `--filter='k=v'` to `data->>'k' = 'v'` clauses. NOT a wrapper around Hub HTTP/MCP API — those surfaces (`list_*` MCP tools) already cover HTTP-layer queries via standard adapter per existing pattern.

**Rationale (round-1 audit N2):** the existing `get-agents.sh` pattern is HTTP-based because agents are session-state querying live Hub. Entity-state inspection during forensic / debugging / outage is fundamentally substrate-level concern — bypassing HTTP keeps the diagnostic dispositive even when Hub is degraded.

Companion script `scripts/local/hub-snapshot.sh` wraps `pg_dump` directly (same direct-psql posture); not Hub-HTTP-mediated.

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

### §2.7 Test-postgres-container harness (round-1 audit M3 fold-in)

Test discipline for substrate code requires postgres available in CI + local-dev. Architect-lean (v0.2; W0 spike validates):

- **Unit tests** — `testcontainers` (npm `testcontainers` package) with **per-test-DB-rollback semantics**. Each test runs in a transaction; ROLLBACK on test-end. Fast (~milliseconds per test). Used for substrate-internal unit-tests (CRUD ops, filter translation, etc.)
- **Integration tests** — `testcontainers` with **singleton postgres + per-test-suite reset** (TRUNCATE + reset sequences). Slower (~seconds per suite) but allows multi-connection scenarios (watch primitive, reconciler-cycle tests). Used for cross-component integration tests
- **CI** — same testcontainers harness; CI runner needs Docker; postgres-15-alpine image (matches local-dev compose-file version pin)

**Out-of-scope of v1:** distributed test harness; multi-postgres-version matrix testing (deferred to M-Hub-Storage-Cloud-Deploy follow-on per AG-4).

W0 spike validates: testcontainers boot time on CI runner; transaction-rollback isolation correctness; flakiness baseline. If unacceptable on either dimension, fallback to docker-compose-based singleton with per-test-suite reset (sacrificing isolation for predictability).

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

### §3.4 Entity-coverage matrix — I*Store-anchored authoritative inventory (round-1 audit C3 fold-in)

**Authoritative count (v1.1 — W0.2-spike-VERIFIED):** **20 substrate-mediated kinds**. Composition:
- **13 existing substrate-mediated** (W0.2 commit `7d2f34f` verified): 11 I*Store (Audit / Bug / Idea / Message / Mission / PendingAction / Proposal / Task / Tele / Thread / Turn) + 1 IEngineerRegistry (Agent) + 1 Counter (single-row `meta/counter.json`)
- **2 NEW kinds this mission**: SchemaDef (substrate-native bootstrap-self-referential per §2.3) + Notification (re-introduction per OQ8; closes mission-56 partial-completion)
- **5 W0-architect-VERIFIED kinds**: Document (`documents/<category>/*.md` — verified entity-semantic content) + 4 OQ7-decomposition kinds: ArchitectDecision (`architect-context/decisions.json`) + DirectorHistoryEntry (`architect-context/director-history.json`) + ReviewHistoryEntry (`architect-context/review-history.json`) + **ThreadHistoryEntry** (`architect-context/thread-history.json` — NEW FINDING surfaced at W1.1 architect-side verification; not in v1.0 inventory)

**Source-of-truth (W0.2 commit `7d2f34f` regenerated `hub/scripts/entity-kinds.json`):** the **13 existing substrate-mediated kinds** across `hub/src/entities/*.ts` + `hub/src/state.ts` + `hub/src/entities/counter.ts` are the authoritative existing-kind enumeration. **Phantom entries from prior versions (DirectorNotification per mission-56 W5 cut-over; Report; Review; ThreadMessage; Clarification; ScheduledMessage; MessageProjection; AgentSession; Continuation) REMOVED** — these are: (a) migrated to other kinds (DirectorNotification → Message kind=note via `hub/src/policy/director-notification-helpers.ts`); (b) inline fields on existing entities (Report / Review / Clarification / ThreadMessage); (c) sweeper-internal types with NO separate persisted store (ScheduledMessage / MessageProjection); (d) fabricated (AgentSession / Continuation).

#### §3.4.1 Primary entities (migrate as rows in `entities` table)

**Anchor:** the 11 I*Store interfaces in `hub/src/entities/*.ts` + `hub/src/state.ts` are the authoritative kind enumeration source (per round-1 audit C3): `IAgentStore`, `IAuditStore`, `IBugStore`, `IIdeaStore`, `IMessageStore`, `IMissionStore`, `IPendingActionStore`, `IProposalStore`, `ITaskStore`, `ITeleStore`, `IThreadStore`, `ITurnStore` (the live-mediation surface).

**Add for this mission:** `ISchemaDefStore` (NEW) + `IDocumentStore` (NEW; W0-spike-validates if `local-state/documents/*.md` is entity-semantic-state vs static-asset; if entity, gets new I*Store).

**Notification nuance (per round-1 round-2 engineer audit):** the historical `INotificationStore` was REMOVED at mission-56 W5; current `notifications/notif-*.json` persistence happens via direct file-writes from `hub/src/hub-networking.ts` (lines 431, 465, 504, 735) WITHOUT I*Store mediation — verified by greg against `hub/src/state.ts:1015-1018 + 1579-1583` change history. Option Y (substrate replaces StorageProvider only; repositories preserved) doesn't fit Notification cleanly: there's no I*Store to compose. **Disposition (engineer-lean accepted):** re-introduce `INotificationStore` + `NotificationRepository` in THIS mission as part of W2/W4. Saga-substrate-completion characteristic strengthened (closes mission-56 partial-completion as collateral). Surfaces as OQ8 for round-2 audit awareness; not a Director re-disposition required (mechanism-choice per `feedback_architect_call_not_director_decision.md`).

Each currently persisted as `local-state/<dir>/<id>.json`; ID is the natural primary key. **Authoritative count (v0.2):** 11 I*Store-mediated + 1 NEW substrate-mediated (SchemaDef) + 1 W0-spike-validates (Document) + 1 re-introduced-by-this-mission (Notification) = **14 kinds (modulo W0 spike's auxiliary discovery)**. Inventory table below is the source-of-truth cross-check; W0 spike re-greps to confirm:

| Kind | local-state dir | ID-shape | Notes |
|---|---|---|---|
| Agent | `agents/` | agent-XXXXXXXX | Mediated by IEngineerRegistry (not I*Store; sibling abstraction) |
| Audit | `audit/` | audit-NNN | |
| Bug | `bugs/` | bug-NN | |
| Counter | `meta/counter.json` | (single-row) | Special: 1 file w/ multiple counter-domain keys; migrate as one row per counter-domain key |
| Document | `documents/<category>/<name>.md` | derived | **Markdown body content** in `data.content`; metadata in `data.category` etc.; well within 1.5MB cap. W0-VERIFIED: real markdown files (teles.md / policy-network-v1.md / etc.) — entity-semantic state, NOT static asset |
| Idea | `ideas/` | idea-NNN | |
| Message | `messages/` | ULID | DirectorNotification migrates HERE via `kind=note` per mission-56 W5 cut-over (NOT separate kind; verified `hub/src/policy/director-notification-helpers.ts:5-8`) |
| Mission | `missions/` | mission-NN | |
| Notification | `notifications/` | notif-NNNNNNNN | Re-introduction per OQ8; closes mission-56 W5 partial-completion (where `INotificationStore` was removed but `hub-networking.ts:431,465,504,735` still direct-writes `notif-*.json`) |
| PendingAction | `pending-actions/` | (handler-assigned) | |
| Proposal | `proposals/` | proposal-NNN | |
| Task | `tasks/` | task-NNN | Clarification IS NOT a separate kind — inline `task.clarificationQuestion` field |
| Tele | `tele/` | tele-NN | |
| Thread | `threads/` | thread-NNN | |
| Turn | `turns/` | turn-NNN | |
| **SchemaDef** (NEW) | n/a (substrate-native) | kind name | Introduced by this mission; bootstrap-self-referential per §2.3 |

**Kinds explicitly removed from prior versions** (verified at W0.2 commit `7d2f34f` filesystem-grep + architect-side verification):
- `Clarification` — inline `task.clarificationQuestion` field; no entity file (v0.2 catch)
- `ThreadMessage` — single `Message` kind exists; no separate entity (v0.2 catch)
- `DirectorNotification` (W0.2 catch) — fully migrated to Message `kind=note` via `hub/src/policy/director-notification-helpers.ts` per mission-56 W5; verified `hub/src/entities/counter.ts:51` ("Mission-56 W5: DirectorNotification entity removed"). UNLIKE Notification, mission-56 cleanup was actually complete. Architect's 49c08df §3.4 addition was WRONG.
- `Report` (W0.2 catch) — inline field on task/bug (`task.reportRef` + bug fields); no IReportStore + no `report-repository.ts`
- `Review` (W0.2 catch) — inline field on mission/proposal/message; no IReviewStore + no `review-repository.ts`
- `ScheduledMessage` (W0.2 catch) — sweeper-internal type (`ScheduledMessageSweeperOptions` interface); sweeper reads from `IMessageStore.listMessages()` per `scheduled-message-sweeper.ts:118`; NO separate persisted store
- `MessageProjection` (W0.2 catch) — sweeper-internal type (`MessageProjectionSweeperOptions` interface); sweeper reads from `IThreadStore.listThreads()` + `IMessageStore`; NO separate persisted store
- `AgentSession` — architect spec-level invention; zero references in codebase
- `Continuation` — state of pending-action queue-item (`continuation_required` status), not separate store

#### §3.4.2 Substrate-internal indexes (NOT migrated as entities; replaced by per-kind expression indexes per §2.2)

| Index location | Replacement |
|---|---|
| `local-state/messages-thread-index/thread-NNN/` | postgres expression index `ON entities ((data->>'threadId')) WHERE kind = 'Message'` (per §2.3 SchemaDef-emitted) |

This is the DIY-secondary-index that bug-93 surfaced — it goes away structurally with substrate (the index is replaced by a postgres-native equivalent the query planner uses automatically).

#### §3.4.3 Architect-context — OQ7 disposition LOCKED (4-kind decomposition; v1.1 update)

`local-state/architect-context/` holds **4 append-only structured-log files** (v1.0 inventory had 3; W1.1 architect-side verification surfaced ThreadHistoryEntry as 4th):
- `decisions.json` — architect decisions log
- `director-history.json` — director chat history
- `review-history.json` — review assessments
- **`thread-history.json`** (NEW FINDING per architect-side W1.1 verification) — archived thread summaries

Plus `wisdom/` subdirectory of static-asset markdown reference docs (ARCHITECTURE.md / architect-engineer-collaboration.md / workflow-specification.md / decisions/*.md) — see §3.4.4 out-of-substrate carve-out.

**OQ7 disposition (engineer-lean accepted; v1.1 LOCK updated to 4-kind):** decompose into 4 entity-kinds with new I*Stores added by this mission:
- `IArchitectDecisionStore` — `ArchitectDecision` entity per row
- `IDirectorHistoryEntryStore` — `DirectorHistoryEntry` entity per row
- `IReviewHistoryEntryStore` — `ReviewHistoryEntry` entity per row
- **`IThreadHistoryEntryStore`** — `ThreadHistoryEntry` entity per row (NEW per v1.1)

Each log-entry in the .json files becomes one entity-row. Append-only semantics preserved by handler-side discipline (no entity-mutation, only entity-add); reconciler-emitted index on `(kind, created_at)` for chronological ordering; `(kind, threadId)` secondary index for ThreadHistoryEntry to support thread-keyed queries.

**Rationale (per round-1 round-2 engineer-lean):**
- On-brand with Survey outcome 1 (substrate-consolidation; "substrate IS the mission, nothing else"); file-based escape-hatch violates the discipline
- Composes naturally with M-Hub-Storage-Audit-History follow-on (idea-296) — if architect-context is substrate-entities, history-queries become trivial postgres queries; if file-based, they need separate file-grep machinery indefinitely
- Decomposition cost is bounded at design-time (4 new I*Store interfaces + reconciler emits indexes); implementation cost rolls into W2 SchemaDef + W4 repository-composition waves
- Sub-tele-1 (state-transparency) at architect surface — `get-entities.sh ArchitectDecision --filter='mission=M-Hub-Storage-Substrate'` becomes queryable; today's `find docs/architect-context/ -path '*M-Hub-Storage*'` is fragile

#### §3.4.4 Out-of-substrate (preserved as-is; NOT migrated)

These remain file-system-backed; substrate doesn't touch them:

| Location | Why out-of-substrate |
|---|---|
| `local-state/repo-event-bridge/cursor/ + dedupe/` | `repo-event-bridge` package state; uses `MemoryStorageProvider` per §5.2 keep-list |
| `local-state/repo-event-bridge-workflow-runs/cursor/ + dedupe/` | Same |
| `local-state/docs/` | Static markdown assets (NOT Hub-runtime-state; documentation files; git-tracked elsewhere) |
| `local-state/architect-context/wisdom/` (NEW per v1.1) | Static-asset architect reference docs (ARCHITECTURE.md / architect-engineer-collaboration.md / workflow-specification.md / decisions/*.md). NOT entity-semantic state; pure markdown reference content. Architect-curated; consumed as docs, not as queryable entity-state. Stays file-based |

#### §3.4.5 Migration script ENUM source-of-truth

`hub/scripts/entity-kinds.json` (W0.2 commit `7d2f34f` regenerated by filesystem-grep; checked into repo; used by migration script + Hub bootstrap reconciler-primer).

**Source-of-truth lineage:**
- Design v0.1 declared a 17-kind provisional inventory (architect spec-level memory; multiple phantoms)
- v0.2 corrected to 14-kind I*Store-anchored authoritative inventory (post round-1 audit C3)
- v1.0 final-finalize adjusted to 12 substrate-mediated-today + 4-5 NEW (post round-2 cleanups)
- **v1.1 W0.2 spike commit `7d2f34f` regenerated entity-kinds.json + surfaced 5 architect-blind-kind-corrections + 4 architect-validated kinds + 1 NEW finding (ThreadHistoryEntry); now LOCKED at 20 kinds**
- Migration script reads entity-kinds.json at runtime; refuses to start if any kind in local-state has no entry (defends against silent-skip migration bug)
- Future architect-blind kinds (if any surface at W4 repository refactor or W5 cutover) trigger Design v1.2 inventory-currency commit

### §3.5 Downtime budget + cutover orchestration (per engineer §A.4 + round-1 audit N3 reframe)

**Target: <60 seconds TOTAL OBSERVED DOWNTIME** (per round-1 audit N3 fold-in) — measured Hub-stop to Hub-ready-for-first-request, INCLUDING pre-cutover snapshot + migration script + verification + Hub restart + bootstrap-validation. NOT just migration-script duration.

**Phase 6 preflight verification metric:** measured TOTAL OBSERVED DOWNTIME wall-clock time on a representative Hub state dump; preflight fails if measured downtime > 60s OR fails verification.

**Cutover orchestration sequence** (architect-illustrative; W0 spike measures + Phase 6 preflight ratifies):
```
T+00:00  Hub stopped (operator: `systemctl stop hub` or equivalent)
T+00:05  Pre-cutover snapshot tar -czf $backup (background; verify return code)
T+00:15  Start migration script
T+00:??  Migration script per-kind COPY-based load (variable; bulk-insert dominant cost)
T+00:??  Verification phase: count parity + sample content-hash check
T+00:??  .MIGRATION_COMPLETE marker emitted
T+00:??  Operator switches Hub config to substrate-mode (HUB_STORAGE=substrate)
T+00:??  Hub started; substrate-mode bootstrap (SchemaDef + reconciler-settle)
T+00:??  Hub ready; first request accepted on substrate
T+<60s   TOTAL OBSERVED DOWNTIME budget hit
```

W0 spike measures actual timings against synthetic state; Design v0.2 timing is INTENTIONALLY unspecified (estimates are unreliable until measured; spike validates). If W0 spike reveals timings exceeding budget at current scale, mitigation: parallel per-kind COPY (postgres-native; 3-5× speedup); if STILL exceeding, surface to Director for budget revision or scope reduction.

**Operator runbook lives at:** `docs/operator/hub-storage-cutover-runbook.md` (W7 ship-criteria).

---

## §4 Wave decomposition (W0-W7; per F2 + engineer §B (α) reading + round-1 audit C2 Option-Y rewrite + M1/M2/B1 fold-ins)

**Critical principle (per engineer §B):** wave-completion ≠ data-cutover. Waves W1-W4 build substrate code + integration paths against pre-cutover empty substrate (verified via integration tests). Full data appears at W5 cutover. Waves W6-W7 finalize cleanup + ship.

**Architectural shift in v0.2 (per round-1 audit C2 Option Y):** W4 is **repository internal-composition refactor**, NOT "handlers wired to substrate API." Handler surface stays unchanged; repositories internally compose substrate instead of StorageProvider. Materially smaller mission scope (substrate-class change, not substrate + handler-layer change). 4 new I*Stores added in this mission per §3.4 (SchemaDef, Document if W0-validated, Notification re-introduction, OQ7 3-kind decomposition).

| Wave | Scope | Acceptance criteria | Substrate state during |
|---|---|---|---|
| **W0** | Spike — postgres-container local-dev compose-up; entity-kinds enumeration via filesystem-grep (validates §3.4 inventory + Document disposition + auxiliary stores); SchemaDef-for-SchemaDef bootstrap; **measured total observed downtime budget** against synthetic state (per §3.5); testcontainers harness validation (per §2.7) | Spike report + entity-kinds.json + downtime-budget measurement + testcontainers boot-time + flakiness baseline; engineer counterpart branch created at W0 commit-time | Empty (spike-only) |
| **W1** | Substrate shell — `hub/src/storage-substrate/` module skeleton; `entities` table + sequence + base indexes + NOTIFY trigger; CRUD operations (get/put/delete/list) + **CAS primitives (createOnly + putIfMatch)** per §2.1 + watch primitive; unit tests against testcontainers postgres; **R9 write-amplification measurement** at synthetic 1k+ writes/sec | All CRUD + CAS + watch ops covered by unit tests; substrate boots cleanly; passes typecheck + lint; R9 measurement reported (mitigation triggered if degradation at scale) | Empty |
| **W2** | Reconciler + SchemaDef + NEW I*Store interfaces — `SchemaDef` kind registered (self-bootstrap); reconciler observes SchemaDef puts via NOTIFY; idempotent CREATE INDEX CONCURRENTLY IF NOT EXISTS emission; **restart-safety verified** via kill-9-between-bootstrap-steps + restart-completes test (per §2.3); SchemaDef entries authored for 11 existing kinds + SchemaDef + Document (if W0-validates) + Notification + 3 architect-context decomposition kinds | All kinds have SchemaDef; reconciler-test confirms idempotent re-run + crash-restart safety; per-kind indexes exist | SchemaDefs populated; entities still empty |
| **W3** | Sweepers wired to substrate API — ScheduledMessageSweeper + MessageProjectionSweeper + others read via substrate `list()` + `watch()` directly (sweepers ARE NOT behind a repository facade); integration tests verify sweepers function against synthetic substrate entities | Sweepers pass integration tests; production wire-up still routes via FS (substrate is dark per α reading) | Empty (handlers still write to FS) |
| **W4** | **Repository internal-composition refactor (Option Y)** — `MessageRepository` / `ThreadRepository` / etc. compose `HubStorageSubstrate` instead of `StorageProvider`; existing I*Store interfaces UNCHANGED at boundary; per-entity logic (locks, sequence allocation, CAS retry loops) stays in repositories; CAS retry loops now use substrate `putIfMatch` (semantics-equivalent at substrate boundary); 4 NEW repositories implemented for new kinds (Document if validated, Notification re-introduction, 3 OQ7 decomposition kinds); handler surface UNCHANGED | All repository internal-composition refactors pass; existing I*Store integration tests green; new I*Stores covered by unit tests | Empty (still dark) |
| **W5** | **State-migration cutover + post-cutover smoke matrix** (per round-1 audit M2 fold-in) — W5-prep gate verified (B1: W0 spike replays in <60s; W1-W4 integration green at HEAD; reconciler cold-boot complete; snapshot mechanism tested); Hub stopped; pre-cutover tar snapshot; `npm run migrate-fs-to-substrate`; verification PASS; Hub restart with `HUB_STORAGE=substrate`; **post-cutover smoke test matrix** runs against migrated state (NOT synthetic): sweeper end-to-end + handler end-to-end + full-API-surface (get/put/delete/list/watch/CAS) for each kind | <60s TOTAL OBSERVED DOWNTIME; verification PASS; smoke matrix PASS for all kinds; bug-93 sweeper-poll-pressure observed-eliminated via watch-driven model | **Full data; LIVE** |
| **W6** | `LocalFsStorageProvider` + `GcsStorageProvider` retirement — **+ hub/src/gcs-state.ts (535 LoC) + hub/src/gcs-document.ts (102 LoC) deletion** (per round-1 audit M1 fold-in); remove from `packages/storage-provider/` (keep interface + MemoryStorageProvider for repo-event-bridge); update CODEOWNERS; remove FS+GCS-related env vars + `HUB_STORAGE` config branches; **repo-event-bridge regression gate** — `cd packages/repo-event-bridge && npm test` passes | `packages/storage-provider/` shrunk per §5.2; hub/src/gcs-*.ts deleted; no broken consumers; tests + CI green; repo-event-bridge gate passes | LIVE |
| **W7** | Ship — operator runbook + psql cookbook + get-entities.sh + hub-snapshot.sh; update CLAUDE.md substrate notes; bug-93 closed with reference to cutover commit; mission Phase 7 release-gate; verify follow-on ideas filed at v0.1 (idea-295/296/297/298 per F4 PROBE) | All v1 acceptance gates pass; release-gate Director-approved; all 4 follow-on ideas present in backlog | LIVE |

**W5-prep gate explicit (per round-1 audit B1 fold-in):** before Hub-stop at W5, verify ALL of:
- W0 spike's measured synthetic-state migration completes in <60s (downtime-budget headroom)
- W1-W4 substrate-API integration tests all green at HEAD
- Reconciler emits all required indexes on cold-boot against fresh postgres (no missing indexes after bootstrap)
- Pre-cutover snapshot mechanism tested + verified (operator can restore snapshot to recover FS state if needed)
- Operator runbook drafted (W7 finalizes; W5 needs working draft)

**Wave commit cadence:** wave-per-PR cumulative-fold per mission-68 M6 pattern (W1 PR cumulatively folds W0; W2 PR cumulatively folds W0+W1; etc.). Final ship PR (W7) includes all 8 waves.

**Branch architecture:**
- Architect: `agent-lily/m-hub-storage-substrate` (Design + Survey + cross-mission coordination)
- Engineer: `agent-greg/m-hub-storage-substrate` (W0 spike + all implementation waves; created at W0 spike commit-time)
- PR target: `main` after engineer-branch ↔ architect-branch cross-approval per `multi-agent-pr-workflow.md`

---

## §5 Substrate location + package shape (per engineer §C fold-in + round-1 audit C2 Option Y)

### §5.1 `hub/src/storage-substrate/` — new module (composes-into-repositories per Option Y)

Substrate-internal module. Hub-specific (no cross-package consumer). Exposes the `HubStorageSubstrate` interface (§2.1) — genuinely new shape (CRUD + list-filter + watch + schema + CAS primitives) that surface-equivalent to mission-47 `StorageProvider` v1.0 contract (preserving CAS family per C1) but ALSO adds higher-level capabilities (filter + watch + schema).

**Option Y composition shape (per round-1 audit C2 — engineer-lean accepted):** existing repositories preserve their I*Store boundaries; internally compose `HubStorageSubstrate` instead of `StorageProvider`. Handler call-sites (`ctx.stores.message.createMessage(...)`) UNCHANGED. Repositories shed FS-substrate-specific code paths:

| What repositories shed (FS-substrate-specific) | What replaces it (substrate-native) |
|---|---|
| Manual list+filter loops in `list*()` methods | `substrate.list(kind, { filter })` — postgres-indexed |
| Per-thread `Mutex` locks for sequence-allocation | `substrate.createOnly()` + retry-on-conflict |
| On-disk DIY secondary indexes (e.g., `messages-thread-index/`) | substrate per-kind expression-index via SchemaDef |
| `putIfMatch` CAS retry loops calling `StorageProvider` | `substrate.putIfMatch(kind, entity, expectedRevision)` — semantics-equivalent |
| Manual poll-based change-detection (sweepers) | `substrate.watch(kind, { filter, sinceRevision })` |

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

### §5.2 `packages/storage-provider/` — SHRINK, not delete (+ hub/src/gcs-*.ts deletion per round-1 audit M1)

Per engineer §C catch + round-1 audit M1: cleanup is multi-location.

**`packages/storage-provider/` v1 ship state:**
- **Keep:** `StorageProvider` interface (used by `MemoryStorageProvider`'s type contract)
- **Keep:** `MemoryStorageProvider` (still consumed by `repo-event-bridge` tests + runtime)
- **Delete:** `LocalFsStorageProvider` + its tests
- **Delete:** `GcsStorageProvider` + its tests
- **Delete:** any other `Local*` / `Gcs*` provider variants

**`hub/src/` cleanup (round-1 audit M1 — separate from packages/storage-provider/):**
- **Delete:** `hub/src/gcs-state.ts` (535 LoC) — GCS-specific Hub state-loading code path
- **Delete:** `hub/src/gcs-document.ts` (102 LoC) — GCS-specific Hub document code path
- **Delete:** `HUB_STORAGE=fs` and `HUB_STORAGE=gcs` config branches in Hub bootstrap; substrate-mode becomes the only mode

**W6 acceptance gates:**
- `cd packages/repo-event-bridge && npm test` passes (regression-net against accidental `rm -rf packages/storage-provider/`)
- `grep -rn "gcs-state\|gcs-document\|HUB_STORAGE" hub/src/` returns empty (or only test-fixture references)
- CI green at HEAD; no broken imports

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
| R9 (NEW per round-1 audit B2) | LISTEN/NOTIFY per-write tax at scale (write-amplification on every entity-write) | W1 substrate-shell load-test measures write-amplification at 1k+ writes/sec; if measurable degradation at ≥10k writes/sec, switch to logical-replication; current scale (~10k entities, ~10s of writes/sec) is well under threshold |
| R10 (NEW per round-1 audit B3) | Local-dev state-loss on `docker compose down` (data volume lost without `--volumes` flag context) | EXPLICIT-PICK: local-dev state is ephemeral by design; snapshot-restore (per §2.5 + `hub-snapshot.sh`) is the persistence story for dev. Operator-DX doc warns: "treat local-dev postgres-container as ephemeral; use `hub-snapshot.sh` if you need persistence across container teardown" |

### §7.2 Open questions for engineer round-1 audit

These come back as Q-N audit items in the round-1 audit thread (separate thread, opened post-Design-v0.1 commit):

- **OQ1** — Reconciler observation mechanism: should reconciler use the SAME watch primitive (NOTIFY-via-substrate, eat-our-own-dogfood) OR a separate bootstrapping mechanism (poll SchemaDef table on a timer)? Current Design picks watch-via-substrate; needs engineer perspective on bootstrap-ordering complexity (reconciler depends on watch which depends on trigger which is created by substrate-init migration which runs before reconciler).
- **OQ2** — Migration script invocation surface: `npm run migrate-fs-to-substrate` (architect-current-pick) OR a standalone binary `hub-migrate` OR a `hub-cli migrate` subcommand? Current is `npm run` for consistency with other Hub admin tasks; engineer judgment on operator-DX.
- **OQ3** — Entity-kinds source-of-truth (§3.4): generated `entity-kinds.json` (architect-current-pick) OR runtime-derived via `Object.keys(substrate.schemas)` at migration script invocation? Current is checked-in JSON for deterministic build; engineer judgment.
- **OQ4** — Substrate-init migrations runner: bespoke (Hub-side migration-runner reads `migrations/*.sql`) OR off-the-shelf (`node-pg-migrate`, `flyway-style`)? Current Design implies bespoke (simpler; 3 migrations); engineer judgment on whether off-the-shelf saves more than it costs.
- **OQ5** — Watch-stream backfill semantics: when handler subscribes mid-Hub-runtime, should substrate replay all events from epoch OR only-new? Current Design's NOTIFY-based watch is only-new; handlers needing backfill use `list()` + then `watch()` (standard "list-watch" pattern from k8s informer). Engineer judgment on whether this composes cleanly with sweeper restart-without-state-loss.
- **OQ6** — Postgres flavor pick (vanilla / AlloyDB / Cockroach / Yugabyte): Design currently assumes vanilla postgres. Q6=a defers cloud-deployment so this is mostly a follow-on concern. Should W0 spike validate against more than one flavor to de-risk the eventual cloud-deploy follow-on?
- **OQ7** — Architect-context disposition (`local-state/architect-context/` per §3.4.3): **DISPOSED at v0.2** — 3-kind decomposition (`ArchitectDecision`, `DirectorHistoryEntry`, `ReviewHistoryEntry`) with new I*Stores added by this mission (engineer-lean accepted; see §3.4.3 for rationale). NO further audit needed unless v0.2 disposition is challenged.
- **OQ8 (NEW per round-1 round-2)** — Notification entity scope: re-introduce `INotificationStore` + `NotificationRepository` as part of THIS mission (engineer-lean; architect-current-pick per §3.4.1 fold-in) — closes mission-56 partial-completion (W5 removed I*Store abstraction but `hub-networking.ts` still direct-writes `notif-*.json`). Saga-substrate-completion characteristic strengthened; mechanism-choice per `feedback_architect_call_not_director_decision.md` (NOT Director-disposition required); engineer round-2 audit confirms or surfaces alternative.

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

- **v1.1 architect-direct cleanup** — 2026-05-17 (this commit); v1.0 RATIFIED on thread-563; v1.1 folds W0.2 substantive findings (5 architect-blind-kind-corrections + 4 W0-architect-validates + 1 NEW ThreadHistoryEntry + wisdom/ disposition)
- **Branch:** `agent-lily/m-hub-storage-substrate`
- **Commits:**
  - 8eed879 — Survey envelope (Phase 3)
  - d9fadf3 — Design v0.1 initial draft
  - 49c08df — §3.4 inventory-verification + OQ7 addition (architect-side filesystem-grep)
  - 037177a — Design v0.2 (round-1 audit fold-ins: C1 CAS + C2 Option Y + C3 I*Store anchor + M1-M4 + N1-N3 + B1-B4 + OQ8)
  - b0c6a02 — Design v1.0-finalize (3 round-2 cleanups: inventory-count + work-trace + IEngineerRegistry)
  - 69e2561 — Phase 6 preflight artifact (GREEN verdict)
  - (pending this commit) — Design v1.1 inventory-currency (W0.2 spike substantive findings: 20-kind LOCKED inventory; DirectorNotification/Report/Review/ScheduledMessage/MessageProjection removed; OQ7 expanded to 4-kind; wisdom/ added to §3.4.4)
- **Threads:** thread-562 (coord; converged) / thread-563 (Phase 4 audit; converged); thread-564 (Phase 5 notification; converged); thread-565 (task-413 notification; converged); thread-566 (ongoing W0-W7 coordination; active)
- **Mission entity:** mission-83 (active; Phase 6 preflight GREEN; W0 in progress)
- **Hub-defect bug:** bug-94 (major; dispatch-gap class; tracks the create_task assignedEngineerId-null orphan defect)
- **Follow-on ideas filed** (per F4 PROBE; de-risks mission-close-forget): idea-295 M-Hub-Storage-ResourceVersion, idea-296 M-Hub-Storage-Audit-History, idea-297 M-Hub-Storage-FK-Enforcement, idea-298 M-Hub-Storage-Cloud-Deploy

### §11.1 v1.0 ratify-criterion (per round-1 audit B4 fold-in)

Per `docs/methodology/mission-lifecycle.md` Phase 4 convergence-criterion: **Design v1.0 ratifies when all CRITICAL + MEDIUM audit-findings disposed** (accepted-and-folded OR explicitly-deferred-with-Director-acknowledgment). MINOR findings may defer at architect-judgment with documented rationale. Bilateral agreement on the convergence-criterion is itself a thread-563 close-action (architect proposes; engineer confirms or disputes).

### §11.2 Expected progression

- v0.2 → engineer round-2 audit (CONVERGED 2026-05-17 thread-563; all 16 dispositions verified; 3 cleanups folded as v1.0-finalize) → **v1.0 RATIFIED**
- v1.0 → Phase 5 mission-entity creation (architect-RACI; separate Hub-API dispatch per `feedback_architect_drives_mission_not_director.md`) → Phase 6 preflight (audits AG-1..AG-4 scope-creep + R1-R10 risk-status + downtime-budget measurement) → Phase 7 release-gate (Director-approval)
- W0 spike begins post-Phase-5 mission-ID assignment:
  - Engineer counterpart branch `agent-greg/m-hub-storage-substrate` created off `origin/main` at W0 spike commit-time
  - Engineer mission work-trace created at `docs/traces/mission-<NN>-m-hub-storage-substrate-work-trace.md` at W0 spike commit-time per `feedback_per_mission_work_trace_obligation.md` (standing engineer obligation; per-mission separate trace; no backfill into prior mission's file)

— Architect: lily / 2026-05-17
