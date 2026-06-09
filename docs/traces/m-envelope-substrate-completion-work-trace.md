# M-Envelope-Substrate-Completion (mission-90) — engineer work-trace

**Engineer:** greg · **Mission:** mission-90 (saga-substrate-completion; 8-wave spine)
**Design:** `docs/designs/m-envelope-substrate-completion-design.md` (v1.1 ratified @ main; v1.2 amendment PR #312)
**Trace discipline:** per `docs/traces/trace-management.md`; one entry per work-session slice, newest last.

---

## Pre-mission engagement (context for cold pickup)

- **Phase 4 round-1 audit** (thread-657, converged 2026-06-10): code-verified all 8 audit-asks; CRITICALs — projection-doesn't-exist (A6), no-legacy-filter-branch / W7-retarget to `SUBSTRATE_ENVELOPE_TOLERANT` (A4), list_tasks 9th broken tool (A1), idea-318 write-side mischaracterization (A8). New flags: watch-stream + memory `matchesFilter` envelope-blind (N1/N2); list_tele broken-now (N3); reference-drift batch (N4: RenameMap type @ `_contract.ts:29` / field @ `:39`; registry at `schemas/all-schemas.ts`; 23 runtime consts / 28 entries / 20 kinds).
- **W5 focused re-audit** (post v1.0): the idea-318 status-write SELF-TRIGGERS the reconciler watch-loop (runtimeLoop re-reconciles on every SchemaDef put; NOTIFY has no changed-data guard; put bumps resource_version unconditionally) → W5 ships converge-then-stop write semantics + runtimeLoop spec-equality guard; boot-failure WARN.
- **Phase 6 preflight** (thread-658, converged): measured on prod-snapshot clone — pg_dump 20.8s (24,397 entities/12MB), restore 2.0s, envelope-migrate 12.9s/686 rows, composite 47-57s < 60s budget. **c1:** prod has LIVE bare-shape writers (~790 bare rows; Message 504/Audit 214/...; 50+ written same-day) → W4 gate must close writers + no-new-bare canary. **c2:** dirty-cursor trap — lexical checkpoint-skip proven (`cursor-Bug` @ `bug-99` blinds `bug-137+`); W6 must resetCheckpoint-all + loop-until-0 + exemptions (MigrationCursor by design; SchemaDef boot-put → fixed at W1) + root-cause stuck Message-40.
- Dump artifact for harness corpus: `/tmp/m90-preflight.dump` (local + hub-vm:/tmp).

---

## W1 — renameMap runtime contract (task-415; branch `agent-greg/m90-w1-renamemap-contract`)

### Slice 1 — contract + reconciler + population + boot-put fix (2026-06-10)

**Scope shipped:**
1. `storage-substrate/types.ts` — `RenameMap` type promoted to runtime (single declaration) + `SchemaDef.renameMap?` field (Design §2.1).
2. `migrations/v2-envelope/kinds/_contract.ts` — re-exports `RenameMap` from types (import+re-export so `MigrationSchemaRef` keeps its local binding; existing migration-layer importers compile unchanged).
3. `schema-reconciler.ts`:
   - `fieldTranslationMap` per-kind cache + `buildFieldTranslationMap(def)` invoked at the TOP of `applySchemaIndexes`, OUTSIDE the per-index try/catches → malformed-renameMap throw propagates to `start()`'s STRICT failure collector (the §2.2 failure-coupling gate item). Validation: keys non-empty; targets must match `^(metadata|spec|status)\.[A-Za-z0-9_.]+$`.
   - `getFieldTranslation(kind, bareKey): string | null` public accessor (W2+ consumer surface).
   - **Boot-put envelope-correctness** (preflight c1/c2 fold): boot put now writes envelope rows via `createSchemaDefMigrationModule(...).migrateOne({id, ...def})` — the migration module is the single shape-authority (boot rows byte-shape-identical to migrated rows; module reads only `schema.kind` at encode, so the minimal self-describing constructor arg is deliberate). Kills the every-restart re-bare of all 23 SchemaDef rows at the source.
   - **Watch decode** `schemaDefFromRow(row)`: envelope rows decode back to runtime SchemaDef (described kind from `metadata.name`, config from `spec`); bare rows pass through (first-post-deploy-boot tolerance). Without this, `applySchemaIndexes(envelope)` would reconcile kind="SchemaDef" instead of the described kind.
4. `schemas/all-schemas.ts` — 28 renameMap entries across 20 consts (verbatim from migration modules; `SchemaDefMeta` carries `kind→metadata.name`; Counter/Document/MigrationCursor none).

**Gate tests authored** (`__tests__/renamemap-contract-w1.test.ts`): per-kind-EXACT inventory (entry-by-entry, never count-based) + closed-inventory (20-of-23) + migration-module parity oracle; getFieldTranslation 6 cases (FSM/collision/opaque/non-FSM-link/non-renamed→null/unknown-kind→null); malformed-renameMap → `start()` rejects; 3× restart-cycle (index **oid-stability** = zero DDL churn + SchemaDef rows envelope-correct each boot + cache live); watch-path decode (envelope-shaped runtime put reconciles the DESCRIBED kind + populates its cache).

**Findings during slice:**
- Pre-existing `reconciler-and-repositories.test.ts` asserted the retired bare row shape at 3 sites (`items.map(i => i.kind)`, `schemaDefMeta.fields`) — updated envelope-aware via `describedKind()` helper (described kind at `metadata.name`; `fields` under `spec`). No production reader of the bare shape exists (verified: `listSchemas`/`getSchema` throw "not implemented"; only the reconciler itself consumes the rows).
- Test isolation: the boot loop puts the row BEFORE `applySchemaIndexes` throws, so the malformed-kind test leaves a row — cleanup added; restart-cycle row-check scoped to ALL_SCHEMAS ids.
- Observed in-file LISTEN bleed across reconciler instances in tests (cycle N's loop drains puts from cycle N+1's boot) — idempotent no-op DDL, no churn; W1.5 deadline set generous. NOTE for W5: this confirms cross-instance NOTIFY delivery is real; production runs ONE reconciler, but the W5 storm-math should assume any concurrently-listening instance sees all puts.

**tsc:** clean. **Suite:** storage-substrate re-run in flight at slice close.

### ⏸ PARK-NOTE — mission-90 PAUSED (Director directive, 2026-06-10)

**Parked at:** `agent-greg/m90-w1-renamemap-contract` @ `421491a` (pushed). **task-415 stays open/working** (pause is coordination-level, no FSM change). Pulses stripped architect-side; re-armed at resume.

**Exact state (better than the pause-time architect snapshot — everything landed):**
- Implementation COMMITTED: types.ts + _contract.ts + schema-reconciler.ts (cache/accessor/boot-put/watch-decode) + all-schemas.ts (28/20) — all in `421491a`.
- ALL test fixes COMMITTED (not "in flight"): the 3 legacy-shape assertion updates in `reconciler-and-repositories.test.ts` (envelope-aware via `describedKind()` helper) + W1.3 malformed-row cleanup + W1.4 ALL_SCHEMAS-id scoping + W1.5 re-put loop (LISTEN-establishment race: a put fired before the runtime loop's LISTEN is active is lost — no replay without sinceRevision; test re-puts every 2s until caught).
- **Full hub suite GREEN: 1917 passed / 0 failed / 7 skipped (153 files).** One earlier flake (testcontainers contention under parallel docker load) did not reproduce.
- Local stack revived (postgres `ois-postgres-local-local` restarted; old hub container healed); W1 image BUILT via build-hub.sh (exit 0) but NOT yet started/validated.
- Design v1.2 merged to main (`3e82284`, PR #312) — fully truthful doc for resume.

**Remaining when resumed (in order):**
1. `start-hub.sh` against the W1 image + boot-validate: log shows 23/23 SchemaDefs applied; local DB SchemaDef rows envelope-correct (`SELECT data ? 'metadata'`); restart twice for the oid-stability spot-check on a live boot.
2. Self-review pass on the diff (code-review, high effort).
3. Open the W1 PR. **PR-body must flag the 3 intentional assertion-shape changes in `reconciler-and-repositories.test.ts`** (architect-dispositioned 2026-06-10: in-scope + correct, but changed assertions get explicit reviewer eyes per refactor-introduces-regression discipline). Also note: STRICT for malformed-renameMap is ratified (W1 contract failure ⇒ Hub-start fail; WARN is W5's status-write posture — different surface).
4. Report on task-415 (in_review) with verification output; architect reviews same-day per their note.

**Context refs for cold-pickup:** thread-657 (round-1 audit), thread-658 (preflight + c1/c2), task-415 directive (full W1 spec + gate), Design v1.2 §4 W1 row @ main, `/tmp/m90-preflight.dump` (+ hub-vm:/tmp copy) for the W2/W6 harness corpus.
