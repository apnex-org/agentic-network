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
1. ~~`start-hub.sh` against the W1 image + boot-validate~~ **— SUPERSEDED 2026-06-19 (Director directive: "our hub is in Cloud Run, not local — remove any local hub image and re-orient").** Production Hub is a cloud-deployed artifact (hub-vm GCE docker-compose behind a Cloud Run nginx proxy, mission-86); a locally-built `ois-hub:local` boot proves nothing about prod and the local hub images have been removed. **Re-oriented boot-validation = the testcontainers integration suite** (real ephemeral postgres, real `SchemaReconciler.start()`): W1.4 asserts 3× restart-cycle index-oid stability (zero DDL churn) + SchemaDef rows envelope-correct each boot (`data ? 'metadata'`); W1.5 asserts watch-path decode. This is the dispositive in-repo boot-proof; the production boot is the deploy gate (post-merge / W7), not a pre-PR engineer step. Re-run the storage-substrate suite and capture the W1.4/W1.5 output as the verification artifact.
2. Self-review pass on the diff (code-review, high effort).
3. Open the W1 PR. **PR-body must flag two intentional out-of-stated-scope items for explicit reviewer eyes:** (a) the 3 assertion-shape changes in `reconciler-and-repositories.test.ts` (architect-dispositioned 2026-06-10: in-scope + correct, but changed assertions per refactor-introduces-regression discipline); (b) the **W1.5 LISTEN-establishment-race fix** (re-put-until-caught test harness) — an extra slice beyond task-415's stated scope, called out by architect 2026-06-10 (Msg 01KVEB3NWMG2BR88SH9G3TNVK0) so the review knows to look. Also note: STRICT for malformed-renameMap is ratified (W1 contract failure ⇒ Hub-start fail; WARN is W5's status-write posture — different surface).
4. Report on task-415 (in_review) with verification output; architect reviews same-day per their note.

**Context refs for cold-pickup:** thread-657 (round-1 audit), thread-658 (preflight + c1/c2), task-415 directive (full W1 spec + gate), Design v1.2 §4 W1 row @ main, `/tmp/m90-preflight.dump` (+ hub-vm:/tmp copy) for the W2/W6 harness corpus.

---

### Slice 2 — resume + re-orientation + self-review (2026-06-19)

**Mission RESUMED** (Director directive 2026-06-19); pulses re-armed + acked each tick.

**Topology re-orientation (Director-direct correction):** "our hub is in Cloud Run, not local — remove any local hub image and re-orient." Ground-truthed `deploy/README.md`: prod Hub = `hub-vm` GCE docker-compose (Hub+Postgres+Watchtower) **fronted by a Cloud Run nginx proxy** (mission-86). Removed ALL local hub images (684.9MB reclaimed) + the crash-looping `ois-hub-local-local` container. Corrected the prod-topology memory (the "Cloud Run retired" + "watchtower auto-deploy ~5min" claims were stale — deploy is manual per cloud-deploy-rollback-runbook.md). Director confirmed the testcontainers integration suite as the dispositive W1 boot-proof.

**Boot-validation (re-oriented):** storage-substrate suite GREEN — W1.4 3× restart-cycle oid-stability + SchemaDef rows envelope-correct each boot; W1.5 watch-path decode; W1.3 STRICT malformed-renameMap → start() fails. Full hub suite regression: **153 files / 1917 passed / 7 skipped, exit 0** (matches park baseline).

**Self-review (code-review high, 8 finder angles + verify):** two CONFIRMED → FIXED this slice; two design-seams → SURFACED to architect (not LLM-autonomous):
- FIX 1 — `buildFieldTranslationMap` renameMap target regex was `^(metadata|spec|status)\.[A-Za-z0-9_.]+$`; the `.` inside the char class admitted empty segments (`status..phase`, `metadata.createdAt.`) that pass STRICT boot but split into empty JSONB path components at the W2 consumer. Tightened to `^(metadata|spec|status)(\.[A-Za-z0-9_]+)+$` + added gate test **W1.3b** (3 bad targets → start() fails). All 23 real SchemaDefs still apply.
- FIX 2 — comment accuracy: cache was doc'd "reverse-translation" but maps bare→envelope FORWARD (= renameMap re-indexed; code already names it `fieldTranslationMap`/`getFieldTranslation`). Reworded.
- SURFACE A — boot-put stamps `status.phase="applied"` (via the SchemaDef migration module's `preTransform`) BEFORE `applySchemaIndexes`, and substrate.put is a full-row REPLACE → re-stamps "applied" every restart. Latent in W1 (no status reader until W5), but the W1↔W5 status-merge seam needs the architect's eye in W5 design (the line-142 comment asserts "W5 MERGES into this row").
- SURFACE B — altitude: reconciler self-encoding the boot-put sits against envelope.ts's "reconciler manages indexes only" boundary; `schemaDefFromRow` bare-passthrough has no retirement gate. Both are W4/W6 generalization seams (does the writer-cutover subsume the reconciler's self-encode?).

**Verified-and-refuted during self-review** (so they don't resurface): renameMap/indexOwnershipPattern DO survive the boot-put round-trip (encodeEnvelope default-bucket → spec; W1.4 already asserts `spec.renameMap`), so no self-NOTIFY cache-wipe; dual-source drift IS guarded by the W1.1 parity test.

**Resume tail from here:** open W1 PR (flags: 3 reconciler-test assertion-shape changes + W1.5 LISTEN-race harness + the 2 self-review fixes + the 2 surfaced seams) → report task-415 in_review → architect same-day review.

---

### ✅ W1 COMPLETION SLICE (2026-06-19) — completion-equivalence record

task-415's formal report path was FSM-blocked (the task is `pending`/unassigned, labeled `apnex-lily`; engineer `get_task` can't claim it; `create_report` rejects "must be working"). Root cause = **bug-146 (major, architect-filed): the task-router stamps the CALLER's login, not the executor's.** Architect ruling (Msg 01KVEGYCQ286QB3BA6QZEZT6BY): don't fight the FSM — **PR review+merge IS the W1 completion record** (entity-mechanics §3.4 / mission-56-57 thread-dispatch completion-equivalence). The formal task FSM stays bypassed for this mission until bug-146 is fixed; each wave's completion lives here in the work-trace. This slice is the folded W1 report.

**Disposition:** PR **#313** REVIEWED + APPROVED + **MERGED (squash) @ `0ba9707` on main**. Gate met: per-kind-EXACT cache, STRICT malformed→fail, 3× restart oid-stability, independently revertible.

**Verification (boot-proof = testcontainers integration suite; production boot is the W7/deploy gate):**
- `renamemap-contract-w1.test.ts` — 9 passed: W1.1 inventory per-kind-EXACT (28/20) + closed-inventory + migration-module parity oracle; W1.2 `getFieldTranslation` (FSM/collision/opaque/non-renamed→null/unknown-kind→null); W1.3 malformed→`start()` FAILS (STRICT); W1.3b empty-segment/trailing-dot targets→FAIL; W1.4 3× restart-cycle zero index-DDL churn (oid-stable) + SchemaDef rows envelope-correct each boot (incl. `spec.renameMap` round-trip); W1.5 watch-path decode reconciles the described kind.
- Boot log: `boot — initial SchemaDef application complete (23 of 23 kinds applied; 0 failures)`.
- Full hub suite: **1918 passed / 7 skipped / 0 failed** (153 files), tsc clean.

**Architect rulings on the 2 surfaced seams (carried forward as hard constraints):**
- SURFACE A (status-stamp) — ACCEPTED-for-W1; carried to the **W5 directive as a hard constraint**: W5's status-write must land AFTER `applySchemaIndexes`, MERGE-not-replace, and its converge-guard must key on the real reconcile outcome, NOT the boot-put's provisional `status.phase=applied` stamp.
- SURFACE B (altitude) — ACCEPTED; carried to **W4** (writer-inventory) + **W6** (`schemaDefFromRow` bare-passthrough retirement gate after the strict-flip).

**Deploy reality (corrected + confirmed architect-direct, runbook B.3):** watchtower auto-update is NON-functional; prod deploy is **MANUAL IAP-SSH, BATCHED to the W6/W7 cutover window** (image-pre-pull + planned downtime). W1–W5 accumulate on `main`; no per-wave prod deploy, no Hub blip. Develop subsequent waves against `main`.

**W1 = DONE.** Next: W2 (task-416, substrate translate-point §2.3).
