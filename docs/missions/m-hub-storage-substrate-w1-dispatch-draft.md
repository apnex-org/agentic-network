# mission-83 W1 dispatch — Substrate shell + CAS + watch + R9 measurement

**Status:** architect-pre-staged dispatch content (ready-fire on W0 completion)
**Dispatch target:** thread-566 (ongoing mission-83 coordination)
**Dispatch shape:** thread-content directive per bug-94 workaround pattern (task-entity-issuance secondary)
**Authored:** 2026-05-17 / lily (architect)
**Trigger:** W0.7 spike-report consolidation commit surfaces on thread-566

---

## Dispatch content (paste into thread-566 reply at W0 completion)

W0 ratified ✓ — proceeding to W1 substrate shell. Per per-wave handshake + bug-94 workaround pattern, dispatching W1 via thread-content directive.

### W1 — Substrate shell + CAS primitives + watch + R9 write-amplification measurement

**Mission:** mission-83 (M-Hub-Storage-Substrate) — Wave W1
**Design ref:** Design v1.1 commit `11ce0ba` §2.1 (interface) + §2.2 (storage layout) + §2.4 (LISTEN/NOTIFY watch) + §2.7 (testcontainers harness)
**Branch:** continue on `agent-greg/m-hub-storage-substrate` (cumulative-fold per mission-68 M6 pattern)
**Pre-W1 verify:** W0.7 spike report committed; entity-kinds.json schema 1.1 at HEAD; testcontainers harness baseline ratified; postgres-container compose validated

### W1 deliverables (5 substantive + 1 verification)

**1. `hub/src/storage-substrate/` module skeleton**

Directory structure per Design v1.1 §5.1:
```
hub/src/storage-substrate/
├── index.ts                      // exports HubStorageSubstrate interface + concrete factory
├── postgres-substrate.ts         // PostgresStorageSubstrate implementation
├── types.ts                      // SchemaDef + FieldDef + IndexDef + Filter + FilterValue + ChangeEvent + ListOptions + WatchOptions
├── migrations/                   // substrate-init SQL (idempotent)
│   ├── 001-entities-table.sql        // entities table + entities_rv_seq + base indexes per §2.2
│   ├── 002-notify-trigger.sql        // entities_notify() function + entities_notify_trg per §2.4
│   └── 003-jsonb-size-check.sql      // 1.5MB CHECK constraint per outcome 4
└── __tests__/                    // unit tests against testcontainers postgres
```

Module-level export: `createPostgresStorageSubstrate(connectionString): HubStorageSubstrate`.

**2. `entities` table + sequence + base indexes**

Apply Design v1.1 §2.2 schema verbatim:
- `entities` table: `(kind, id, data JSONB, created_at, updated_at, resource_version BIGINT)`
- `entities_rv_seq` sequence + `nextval()` default
- Base indexes: `entities_rv_idx` (resource_version) + `entities_updated_at_idx` (updated_at)
- `pg_column_size(data) < 1572864` CHECK constraint (1.5MB cap per Survey outcome 4)
- NOTIFY trigger `entities_notify_trg` + `entities_notify()` function per §2.4 (payload: `{op, kind, id, resource_version}`)

**3. CRUD + CAS + watch operations per Design v1.1 §2.1 interface**

Implement `HubStorageSubstrate` interface:
- `get<T>(kind, id) → Promise<T | null>` — single-row SELECT
- `put<T>(kind, entity) → { id, resourceVersion }` — INSERT/UPDATE with ON CONFLICT
- `delete(kind, id) → Promise<void>`
- `list<T>(kind, opts?) → { items, snapshotRevision }` — postgres SELECT with filter translation (`data->>'k' = 'v'`) + sort + limit/offset + returns max(resource_version) as snapshotRevision
- `createOnly<T>(kind, entity)` — INSERT with ON CONFLICT DO NOTHING; returns `{ok:true, id, resourceVersion} | {ok:false, conflict:'existing'}`
- `putIfMatch<T>(kind, entity, expectedRevision)` — UPDATE WHERE resource_version = $expectedRevision; returns `{ok:true, resourceVersion} | {ok:false, conflict:'revision-mismatch', actualRevision}`
- `watch<T>(kind, opts?) → AsyncIterable<ChangeEvent>` — LISTEN on entities_change channel; filter client-side by `kind`; `sinceRevision` replay-from-position via initial SELECT WHERE resource_version > $sinceRevision

Filter translation per §2.1 FilterValue discriminated union:
- Scalar values → `data->>'field' = $value`
- `$in` → `data->>'field' = ANY($values)`
- `$gt/$lt/$gte/$lte` → range operators (numeric + date only; reject otherwise)

**4. Unit tests against testcontainers postgres (per §2.7 harness)**

Test scope:
- CRUD round-trip per kind (insert, get, list, delete)
- CAS semantics: `createOnly` conflict-on-existing + `putIfMatch` conflict-on-revision-mismatch
- Watch primitive: emit change-event on put/delete; replay-from-position on sinceRevision
- Filter shape: scalar match + `$in` + `$gt/$lt` on numeric + range-reject on string
- JSONB size CHECK: oversized payload rejected at write boundary
- Transaction rollback isolation: per-test-DB-rollback works (no leaked state between tests)

Coverage target: ~80%+ for substrate module per testcontainers harness.

**5. R9 risk measurement (LISTEN/NOTIFY write-amplification)**

Per Design v1.1 §7.1 R9 + W1 acceptance criteria:
- Synthetic load: 1k entity-writes/sec sustained for 60s
- Measure: postgres CPU + Hub-side NOTIFY-handler latency + dropped-event rate
- Report: writes/sec sustained without degradation + degradation threshold observed
- **Mitigation trigger:** if degradation observed at ≥10k writes/sec, surface to architect for logical-replication switch consideration (Design v1.1 §7.1 R9 mitigation path)
- **Below-10k-degradation:** R9 risk closed for current Hub-scale; LISTEN/NOTIFY confirmed adequate

**6. Restart-safety verification (per Design v1.1 §2.3 M4 fold-in carry-forward to W1 substrate-init)**

Kill-9 the substrate-init migration mid-step; restart Hub; verify substrate-init completes successfully (idempotent migrations). 3 migrations all use IF NOT EXISTS / ON CONFLICT DO NOTHING semantics per §2.3.

### Acceptance criteria

- [ ] All CRUD + CAS + watch ops covered by unit tests (~80% coverage)
- [ ] Substrate boots cleanly against fresh postgres + against pre-migrated postgres (idempotency)
- [ ] R9 measurement report committed: 1k writes/sec baseline + degradation-threshold observation
- [ ] Restart-safety verified via kill-9-mid-migration + restart-completes test
- [ ] Passes typecheck + lint
- [ ] CI green at HEAD
- [ ] Bilateral surface report on thread-566 with: commit refs + R9 measurement + any architect-blind interface-detail or schema gaps surfaced (triggers Design v1.2 inventory-currency if so)

### Substrate state during W1

Empty (per α reading: wave-completion ≠ data-cutover). Sweepers + handlers still route via FS substrate. Substrate is DARK until W5 cutover. W1 substrate-API ratification happens against test-fixture data only.

### W1 architect-blind-risk audit (architect-side pre-stage; pre-emptive verification)

Per the W0.2 architect-blind-kind-correction pattern (DirectorNotification, etc.), architect-side pre-audits Design v1.1 §2.4 NOTIFY trigger SQL + §3.1 migration-script architecture for verification gaps. Surface any pre-W1 gaps so engineer's W1 implementation proceeds against verified-not-architect-memory spec.

(This block is the architect's pre-W1 self-audit commitment; replace with actual audit findings when this dispatch fires.)

### Hand-off

Engineer-side W1 substantive work begins; surface W1 commits on thread-566 per per-wave handshake. W2 dispatch (reconciler + SchemaDef + new I*Store interfaces) will follow same shape at W1-ratify time.

— Lily (architect; agent-40903c59)

---

## Pre-dispatch checklist (architect-side, pre-fire)

- [ ] W0.7 spike report committed + on thread-566
- [ ] R9 measurement baseline confirmed feasible (testcontainers + synthetic load harness from W0.4 ratified)
- [ ] postgres-container compose-up validated (W0.1 ratified)
- [ ] entity-kinds.json schema 1.1 at HEAD (already done — 2102bf2)
- [ ] Pre-W1 architect-blind-risk audit on Design v1.1 §2.4 + §3.1 complete (architect-side; substitute findings into the W1 dispatch block)
- [ ] Verify W0 closed cleanly (no architect-blind kinds surfaced beyond Section A + B; ThreadHistoryEntry already folded)

## Companion follow-ups (architect-side, post-W0-ship)

- W2 dispatch draft (after W1-ratify): reconciler + 20 SchemaDef entries + 6 new repository stubs
- W3 dispatch draft: sweepers wired to substrate API
- W4 dispatch draft: repository internal-composition refactor (Option Y) — 12 existing + 6 new
- W5 dispatch draft: state-migration cutover + post-cutover smoke matrix
- W6 dispatch draft: FS+GCS retirement + hub/src/gcs-*.ts deletion
- W7 dispatch draft: ship + operator runbook + bug-93 closure
- Phase 10 retrospective draft: 2 architect-side calibration candidates (substrate-currency-verification-failure + bilateral-blind-premise-error pattern)
