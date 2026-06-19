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

---

## W2 — substrate.list translate-point (task-416; branch `agent-greg/m90-w2-substrate-translate`)

### Slice 1 — implement + self-review + PR (2026-06-19)

FSM-bypassed per bug-146 (router stamps caller login); worked from the task-416 directive via thread-dispatch equivalence; developed against main @ 0ba9707. Report folded here (completion-equivalence).

**Shipped (§2.3):**
- `postgres-substrate.ts` — `setFieldTranslator(FieldTranslator)` (late-bound at boot) + `translateKey(kind, bareKey)`; `list()` translates each filter key INLINE per entry + each sort key, then hands the path to the UNCHANGED `translateFilterClause`/`jsonbField`. NO projection (A6). Setter is on a new `PostgresSubstrate` type, NOT on `HubStorageSubstrate` → `memory-substrate.ts` untouched (W4 scope).
- `types.ts` — `FieldTranslator` type. `index.ts` — wire `setFieldTranslator` AFTER `reconciler.start()` (breaks the substrate↔reconciler construction cycle).
- `storage-substrate/index.ts` — export `PostgresSubstrate`.

**Verification:** NET-NEW white-box wire-flow test `substrate-translate-w2.test.ts` (testcontainers; result-set + generated SQL path for Message kind-collision / Idea non-FSM / PendingAction FSM + passthrough no-regression + SORT translation + a bug-138 negative control). Full hub suite **154 files / 1923 passed / 7 skipped / 0 failed**, tsc clean. Inert unless wired (only Hub boot + this test call setFieldTranslator) → no regression to unwired tests.

**Self-review (code-review high, 3 finder angles + verify) — 1 FIX, 3 SURFACED:**
- FIX — filter-key collision: replaced the object-rebuild (`translateFilterKeysToEnvelopePaths` returning a `Filter`) with per-entry inline `translateKey` (symmetric with sort). The object-rebuild could last-write-collapse two entries mapping to the same path; per-entry can't. Also a simplification.
- SURFACE A (DECISION-REQUIRED) — **relocation-coverage gap**: renameMap captures renames, NOT pure relocations. Bug partition relocates `severity`/`class` → `spec.*` but renameMap is only `{status}` → `list_bugs` severity/class filters STILL envelope-blind after W2 (status fixed; list_turns fully fixed). Likely systemic. The directive's "fixes list_bugs" holds only for status. Options: expand renameMap to relocations / read-side partition consult / follow-on. Recommend expand-renameMap; architect's scope call.
- SURFACE B — **dual-shape fallback neutralized**: `listMissions` legacy branch `{status}` (mission-89 defense) gets translated to `status.phase` = identical to the envelope branch → legacy fallback dead. Recommend removing the now-redundant branch; flagged for ruling vs silent neutralization.
- SURFACE C — **no migration-completion guard**: translator wired unconditionally; correctness rests on batched-deploy-after-W6-migration. Recommend confirm-accepted + a precondition comment.

**Refuted during self-review:** no existing test wires the translator (suite stays green); memory-substrate untouched + doesn't need the setter; boot-order has no list() before the setter; cycle genuinely broken.

**Status:** PR-open, awaiting architect same-day review + rulings on A/B/C. (Completion slice + merge SHA to follow at merge.)

### Slice 2 — finding-A resolution: complete relocation inventory + sentinel-probe oracle (2026-06-19)

Architect reviewed #314, ruled: **A HOLD-for-inventory-completion** (renameMap = the COMPLETE read-side bare→envelope movement authority, test-enforced); **B/C accept-with-comment**. Bugs filed: **bug-147** (idempotency, the load-bearing proof), **bug-148** (Notification phantom), **bug-149** (index-parity). Refinement: derive the oracle's expected path from the ACTUAL encoder (not partition re-derivation) → sentinel-probe; bound coverage to call-site-enumerated filterable keys.

**Completeness sweep** (24-agent workflow): enumerated every substrate-side filter/sort key across 60 call-sites in 21 files + structural-transform exclusions + global audit (no missed pairs). Surfaced the live gaps.

**Implemented (companion commit on #314):**
- **all-schemas.ts renameMap expanded** to the complete filterable-relocation authority (read-side only; modules untouched — encoder places relocations via partition, validated by the probe): Agent fingerprint; Audit actor; Bug severity/class; Message threadId/migrationSourceId/authorAgentId/delivery/scheduledState + nested target.role/target.agentId; PendingAction naturalKey/targetAgentId/dispatchType/entityRef; Task **idempotencyKey (bug-147)**; Thread cascadePending/currentTurnAgentId; Document category (+ leaves rename-free set); ReviewHistoryEntry taskId; ThreadHistoryEntry threadId. 49 entries / 21 kinds.
- **3 hot-path indexes folded in (bug-149 W6-deploy-gate):** Message spec.delivery + status.scheduledState (scheduled-sweeper), Thread status.cascadePending (Hub-startup) — else bug-93 sweeper-poll-pressure recurs as JSONB full-scans. Non-hot index-parity → bug-149 follow-on.
- **Oracle rewritten** (renamemap-contract-w1.test.ts): old `all-schemas===module.renameMap` parity REPLACED by (W1.1b) **sentinel-probe faithfulness** — feed a sentinel through each module's real `migrateOne` and assert every renameMap entry lands where the encoder ACTUALLY places it (caught a pre-existing unfaithful entry surfacing: Notification.event needed an enum-valid probe value); (W1.1c) **classification completeness** — every substrate-FILTERABLE key (curated from sweep) is renameMap-covered OR documented-excluded OR unmoved (self-policing @ W3+); (W1.1d) **cascade-key contract** — deliberately-untranslated cascade-keys assert NOT-in-renameMap + genuinely-move (W1 null-pin preserved). W1.4 extended to assert the 3 net-new indexes create-once + oid-stable.
- **B comment** on listMissions legacy branch (neutralized; delete-at-W8). **C precondition comment** at the translate-point (envelope-rows assumed; batched-with-W6 is the guard).
- **W2.6 wire-flow** proves a RELOCATED key (Bug severity → spec.severity) now translates + negative control.

**Deliberate exclusions (documented in oracle):** cascade-keys sourceThreadId/sourceActionId/sourceIdeaId on Bug/Idea/Mission/Proposal/Task (repo dual-path + W1 null-pin; W4 reconciles); Notification.recipientAgentId (phantom, bug-148); tags (client-side array-contains). 

**Verification:** W1 11/11 + W2 6/6 green; tsc clean; full suite green.

### ✅ W2 COMPLETION (2026-06-19) — MERGED @ `483cbf4` (#314)

Architect reviewed + merged W2 (mechanism + complete relocation inventory + sentinel-probe/classification oracle + 3 W6-gate indexes + B/C comments). **bug-147 RESOLVED** (fixCommit 483cbf4; deploys at the W6 batch). bug-148 (Notification phantom) + bug-149 (non-hot index-parity) tracked as follow-ons; cascade-key dual-path reconciliation carried to W4. Design §2.1/§2.6 amended: renameMap = complete field-movement authority (49/21, renames + relocations). W2 = DONE. Next: W3 (task-417, Layer-B FieldAccessor sweep).

---

## W3 — Layer-B policy FieldAccessor envelope sweep (task-417; branch `agent-greg/m90-w3-layerb-accessor-sweep`)

### Slice 1 — implement (2026-06-19)

FSM-bypassed (bug-146); thread-dispatch from the task-417 directive; develop against main @ 483cbf4. Closes the Layer-B half of bug-138: load-all-then-filter tools (`list-filters.ts` applyQueryFilter/matchField + per-policy FieldAccessors) never hit the W2 substrate translate-point, so a `status:'open'` filter vs an envelope accessor returning `{phase:'open'}` silently misses. Fix-shape (§2.5): the ACCESSOR BODY reads envelope-aware (`phaseFromEntity`), NOT key-translation — matchField's bare-key lookup stays unchanged; do NOT consume getFieldTranslation at Layer-B (A6).

**Shipped:**
- `shape-helpers.ts` — NEW `fieldFromEntity(entity, field)` envelope-tolerant scalar/object reader (sibling of `arrayFieldFromEntity`/`phaseFromEntity`): non-null top-level wins (legacy), else probes metadata→spec→status. **Null-shadow tolerance:** a null/undefined top-level is treated as "look deeper" — repo normalizers (thread-repo's `normalizeThreadShape`) lift relocated fields to top-level `null`, which would otherwise shadow the section value.
- `idea-policy.ts` / `task-policy.ts` / `thread-policy.ts` — FieldAccessor BODIES envelope-aware: `status`→`phaseFromEntity`; every other moved field→`fieldFromEntity` (Idea `missionId`→status.missionId non-FSM; Task `assignedAgentId`→spec; Thread `currentTurnAgentId`→status, recovered via null-skip); `createdBy.*` via `fieldFromEntity(createdBy)`. Task = the 9th broken tool.
- `proposal-policy.ts` — `listProposals` PUSH-DOWN: `getProposals(status)` (repo substrate.list → W2 translate-point) replaces in-process `p.status===status`; `_ois_query_unmatched` preserved (full-count fetch only when filtered-empty).
- `tele-policy.ts` — superseded/retired AUDIT-view boolean guard reads `phaseFromEntity` (was `t.status===…` envelope-blind).
- get_pending_actions: confirmed alignment — its list path is a repo push-down (`listForAgent({state})` → W2 translates state→status.phase); no change.

**Verification:** NEW `layerb-accessor-sweep-w3.test.ts` (testcontainers, REAL policy path via PolicyRouter.handle) — list_ideas (status + missionId + sourceThreadId + combined), list_tasks (status + assignedAgentId), list_threads (status + currentTurnAgentId), list_proposals (push-down + _ois_query_unmatched), list_tele (audit-views), get_pending_actions (repo push-down). + `shape-helpers.test.ts` fieldFromEntity unit cases (legacy / each section / null-shadow / precedence / absent). Full hub suite **155 files / 1940 passed / 7 skipped / 0 failed**, tsc clean.

**Self-review (code-review, 2 finder angles) — 1 DECISION-REQUIRED surfaced (W3/W4 boundary):**
- **Thread `routingMode` is NOT Layer-B-recoverable** — `normalizeThreadShape` force-defaults a NON-NULL top-level `routingMode` via `normalizeRoutingMode(raw.routingMode)`, and `raw.routingMode` is undefined on envelope rows (value at `spec.routingMode`) → yields "unicast" for every envelope thread. fieldFromEntity's non-null-top-level rule returns that default (same as pre-W3 `t.routingMode` — **NO regression**), and a Layer-B accessor can't recover it without duplicating the repo's `normalizeRoutingMode` + spec read. **Clean fix = `normalizeThreadShape` reads `spec.routingMode` (repo = W4).** Surfaced to architect as a W4-carry (the null-lifted fields currentTurnAgentId/recipientAgentId ARE recovered via fieldFromEntity null-skip; routingMode's force-default is the wrong-source repo bug).
- Minor (not blocking): the `createdBy` accessor triplet repeats across 3 policies (pre-existing; candidate shared helper); test seeds envelope-only (legacy-flat branch unit-tested, not wire-tested); get_pending_actions wire-flow confirms the repo push-down (handler lives in system-policy, not registered in the test rig).

**Status:** PR-open, awaiting architect review. routingMode finding flagged DECISION-REQUIRED.

### ✅ W3 COMPLETION (2026-06-19) — MERGED @ `b63a1d6` (#316)

Architect approved + merged. **All 9 list tools now envelope-correct** (W2 Layer-A + W3 Layer-B); bug-138 structurally closed network-wide pending the W6 prod deploy. **routingMode ruling: ACCEPT pre-existing-broken + W4-carry** (no W3 band-aid — it's a repo-normalization bug, not a policy-accessor gap; a Layer-B reach into spec would duplicate repo logic wrong-layer per §2.5/tele-3). **bug-150 filed** (normalizeThreadShape reads spec.routingMode → folded into W4). createdBy-triplet shared-helper → W4 cleanup candidate. Also peer-approved PR #315 (Design v1.3 doc — renameMap = complete field-movement authority, finding-A folded). W3 = DONE.

---

## W4 — repo/sweeper/watch envelope-native + close ALL bare-shape writers (task-418; branch `agent-greg/m90-w4-repo-sweeper-watch-writers`)

### Slice 1 — implement (2026-06-19)

FSM-bypassed (bug-146); thread-dispatch from task-418; develop against main @ b63a1d6. **The LAST read+write wave before the W6 data-touch cutover** + the largest. Three sub-areas: (1) watch-path `matchesFilter` envelope-aware in BOTH substrates (N1); (2) repo internal reads envelope-native + carries (bug-150 routingMode, cascade-key dual-path reconciliation, createdBy helper); (3) **CLOSE ALL LIVE BARE-SHAPE WRITERS** (idea-324 / preflight c1 — ~8 kinds: Message/Audit/Bug/PendingAction/Thread/Idea/Mission/Task) → route every write through the envelope encoder. Gate: watch e2e both substrates + no-new-bare CANARY (write every tool path → assert envelope lands per-kind) + W1–W4-without-W4 revertibility.

**Shipped:**
- **matchesFilter (both substrates):** translate filter key via renameMap authority then traverse, DUAL-SHAPE tolerant (envelope path → bare fallback) for the mixed-row straddle. postgres = injected W2 translator; memory = static ALL_SCHEMAS translator (reconciler-less). Closes N1 (sweeper watch filters) + N2 (memory false-green). bug-151 (architect-filed major): the scheduled-message-sweeper's Message {delivery,scheduledState} filter silently never fired envelope scheduled Messages since 2026-05-25 — fixed here (W6-prep: eyeball stuck-unfired backlog at the prod snapshot).
- **Write-encoder seam (close-all-bare-writers):** new `write-encoder.ts` `buildEnvelopeWriteEncoder()` (per-kind migrateOne registry; idempotent passthrough; no-module → passthrough) + `substrate.setWriteEncoder` routed through put/createOnly/putIfMatch, wired at boot BEFORE any write. Complete-by-construction; symmetric to the W2 read translator (ADR at ship).
- **bug-150 + broader normalizeThreadShape fix:** reads EVERY relocated Thread field envelope-native (routingMode→spec; summary/convergenceActions/participants/messages/currentTurnAgentId→status). Pre-fix force-defaulted them → W4's writer-closure would have shipped empty messages/participants for new threads.
- **cascade-keys:** KEEP repo dual-path + delete-at-W8 comment across idea/bug(×2)/mission/task/proposal (architect-ruled — sole straddle mechanism, NOT chokepoint-redundant; W1 null-pin preserved). createdBy helper deferred → W8.

**Self-review (code-review, 1 finder angle) — 2 CRITICAL catches FIXED** (encoder inert-in-tests → invisible to the suite):
1. Turn was imported but MISSING from the write-encoder MODULE_FACTORIES → Turn writes stayed bare. Fixed + added to the canary.
2. normalizeThreadShape force-defaulted relocated fields (beyond the flagged routingMode) → W4 writer-closure would break get_thread/reply-routing/convergence for new envelope threads. Fixed envelope-native + a thread-read regression test.
- (low, documented) matchesFilter bare-fallback degenerate-matches the literal {kind:"Message"} (reserved-key collision); the bare fallback is needed for real bare-row kind filtering → accept + comment.

**Verification:** `write-encoder-and-watch-w4.test.ts` (testcontainers, 7 tests): passthrough pins (byte-identical / put-then-put stable / status-survives / no-module); no-new-bare canary (all kinds incl. Turn + createOnly); watch matchesFilter both substrates; thread-read regression. Full hub suite GREEN (modulo the known advisory-lock flake); tsc clean. Revertibility: W4 hooks inert-unless-wired + matchesFilter back-compat → W1–W3 pass without W4.

**Status:** PR-open, awaiting architect review (Slice 1) → see Slice 2 for the pre-merge completeness fix.

### Slice 2 — two pre-merge completeness confirmations → bug-152 fix (2026-06-19)

Architect asked for TWO confirmations before merge: (1) is the write-encoder registry DERIVED/structurally-complete (not hand-enrolled — Turn was missed); (2) was the normalizer fix SYSTEMATIC (sweep ALL custom normalize*/hydrate readers).

**(1) Registry-completeness backstop — DONE (green).** Added `writeEncoderRegisteredKinds()` export + a BIDIRECTIONAL test: fs-enumerate `kinds/*.ts` module files vs the `MODULE_FACTORIES` registry — every module must be registered (the Turn-class omission now fails structurally) AND no stale registry entry. Converts "complete by construction" → test-enforced.

**(2) Systematic normalizer sweep — found the gap is BROADER than the 2 caught (idea-320 class).** Enumerated EVERY read-normalizer with an END-TO-END verdict (does repo→handler→consumer actually break on envelope, accounting for W2/W3/bug-137 read-site tolerance):
- **GENUINELY BROKEN (W4 writer-closure makes universal):** **Thread FSM** — my Slice-1 `normalizeThreadShape` fix was INCOMPLETE (surfaced arrays but left status/currentTurn/roundCount/maxRounds as passthrough → `current.status` was the envelope OBJECT → `replyToThread`'s `status !== "active"` always threw → returned null → reply/convergence broken universally; + `cloneThread` labels wiped, `truncateClosedThreadMessages` never fired). **Tele FSM** — `normalizeTele` (`if(raw.status) return raw`) returned the envelope unchanged → supersede/retire gates never fired + get_tele/list_tele returned raw envelope.
- **CONFIRMED ENVELOPE-NATIVE (verified, no change):** Idea/Bug/Mission/Turn (passthrough clones → tolerant consumers: lists via W2/W3 accessors, mutations via bug-137 `phaseFromEntity` ×14); Agent (decoded-first via `envelopeToAgent`); Counter (native).

Architect CONFIRMED re-triage (fix Thread+Tele only; the 4 tolerant kinds left as-is — converting them would be a broad rewrite of WORKING code + consumer-tolerance is the designed-until-W8 mechanism). **bug-152 filed (major)** — the read-normalizer FSM-gate class; resolves on #317 merge.

**Fix (altitude: decode ONCE at the normalizer, don't rewrite each gate):**
- `normalizeThreadShape` → FULL envelope→legacy-flat decoder: flatten metadata/spec/status to top-level (every relocated field keeps its leaf name; only status→phase is a leaf-rename per Thread renameMap), derive status via `phaseFromEntity`, and STRIP envelope artifacts (metadata/spec/status objects + phase/apiVersion/kind) so the CAS put-back re-encodes a CLEAN legacy-flat row (leftover bucket objects would re-partition into `spec.metadata` garbage). Fixes the FSM gates + `cloneThread` (labels now surface) + `truncate` (operate on the decoded thread).
- `normalizeTele` → same full-decode pattern; gates read `current` which casUpdate normalizes BEFORE the transform, so the decode is sufficient (no per-gate `phaseFromEntity` scatter). Legacy default `status: "active"` preserved via `phaseFromEntity(raw) ?? "active"`.

**Verification:** 2 NEW dispositive FSM regression tests in `write-encoder-and-watch-w4.test.ts` (now 10 tests, all green) — both run END-TO-END on ENVELOPE-backed storage (encoder wired → openThread/defineTele store envelope): (a) thread reply + 2-round convergence FSM (pre-fix `replyToThread` returns null → fails; asserts round-trip to clean envelope + no `spec.metadata` garbage); (b) tele retire + supersede-gate (pre-fix the gate never fires → `rejects.toThrow(/retired/)` fails). **Full hub suite GREEN (1950 passed | 7 pre-existing skips); tsc clean.** Branch ff-merged to include Design v1.3 (#315).

**W6-prep liveness flag (NOT W4-blocking):** the 2026-05-25 migration already enveloped existing threads/teles → migrated rows MAY already break these gates in prod TODAY (envelope-thread reply → throw; envelope-tele retire silent). At the prod snapshot, eyeball whether prod envelope-thread reply / envelope-tele retire are currently broken (pairs with the bug-151 scheduled-Message backlog check).

**W8 note (for that directive):** read-shape strategy is now MIXED — Thread/Tele/Agent/Counter decode-first; Idea/Bug/Mission/Turn consumer-tolerant. When dual-shape tolerance retires at W8, decide whether to unify (all decode-first).

### Slice 3 — bug-153 advisory-lock test-stability fix (W4-CI-unblock, 2026-06-19)

W4's new write-encoder-and-watch-w4 testcontainer tests added parallel-pg load that surfaced a PRE-EXISTING race in `advisory-lock.test.ts` (the real-pg contention test) — RELIABLY failing in CI on the W4 branch (2 consecutive, same signature: `advisory-lock.test.ts:402` 'B-should-not-run' + pool-after-end at `withAdvisoryLock`), though it passed locally. W3 CI was green → W4 is the load-trigger. Architect re-scoped bug-153 from a follow-on to **W4-merge-blocking** + recommended an in-branch companion fix (fastest unblock; the failure is genuinely W4-load-triggered).

**Root race (one cause, both symptoms):** the contention test fired `callA` (holds the lock 300ms) UNAWAITED, then immediately contended with B (50ms timeout). Nothing guaranteed A acquired first — under load B could WIN the acquire race, run "B-should-not-run", resolve with NO timeout → the `.rejects.toBeInstanceOf(LockAcquisitionTimeoutError)` assertion fails → `await callA` is never reached → callA keeps polling into afterAll's `pool.end()` → "pool after end".

**Fix (architect (a)+(b); NOT a skip/quarantine — the lock mechanism is load-bearing):** (a) deterministic acquisition ORDERING — A's fn body signals once it runs (which only happens AFTER the lock is held), and B attempts only after that signal → B reliably contends behind A + times out; (b) `await callA` in a `finally` → A always settles before teardown, never leaks a polling op into `pool.end()`. Real-contention semantics preserved (B genuinely contends on A's held lock).

**Verification:** advisory-lock.test.ts green 3× isolated (20 tests); full hub suite green (1950 passed | 7 skips) under the parallel-load condition that triggers the CI failure; tsc clean. **bug-153 separately tracked** — this is the W4-unblock; any further advisory-lock-test-stability hardening (e.g. the timing-tolerant parallelize assertion) belongs in a CI-hygiene follow-on, not mission-90.

---

## W5 — reconciler status-write loop (task-419; branch `agent-greg/m90-w5-reconciler-status-write`; PR #318)

### Slice 1 — implement + self-review + PR (2026-06-19)

idea-318 §2.8 (Director scope-in). NET-NEW: the SchemaDef reconciler now writes the REAL reconcile outcome (`status.phase`/`appliedVersion`/`reconcileError`) back onto each SchemaDef row. FSM-bypassed (bug-146); thread-dispatch from task-419; off main @ aa06501. The LAST fully-autonomous wave (W6 = re-migration/strict-flip/first-prod-deploy = Phase 7 Release gate; Director re-engages).

**Self-trigger constraint (load-bearing):** the status-write put fires the reconciler's OWN watch-loop (NOTIFY has no OLD-vs-NEW guard; `substrate.put` bumps resource_version unconditionally) → a literal per-cycle write infinite-loops. Ships BOTH guards:
- **(i) converge-then-stop** — `reconcileStatusWrite()` puts ONLY on a MATERIAL status change (phase/appliedVersion/reconcileError differ). `lastReconciledAt` is DELIBERATELY EXCLUDED from the material comparison — a per-cycle timestamp refresh would self-trigger forever even with a data-changed guard (flagged deviation from idea-318's literal per-cycle-timestamp). Keyed on the REAL outcome, MERGED into the existing envelope row.
- **(ii) spec-equality guard** — `specSignature()` canonicalises spec-relevant fields (kind/version/fields/indexes/indexOwnershipPattern/renameMap; status EXCLUDED; keys recursively sorted for JSONB-roundtrip invariance); runtimeLoop skips re-reconcile when unchanged → the status-write echo (status differs, spec doesn't) is skipped. Also kills today's wasteful no-op re-reconciles.

**SEAM verified:** status-write lands AFTER `applySchemaIndexes`; the merged put is an already-envelope row → the W4 write-encoder passes it through byte-identical → the status SURVIVES the encoder (W4 passthrough pin + W5 restart-survival). Boot: the provisional `'applied'` stamp (toEnvelopeRow → SchemaDef preTransform) already matches the real success outcome → the material-guard makes the boot status-write a no-op (and LISTEN starts only after the boot loop → boot doubly safe). Boot-failure posture WARN (Director-dispositioned): a status-write failure never fails Hub start or kills the loop.

**Verification:** `reconciler-status-write-w5.test.ts` (testcontainers, 4): BOUNDED-STORM (material write → exactly 1 reconcile + 1 status-write + a guard-skipped echo, NOT unbounded); spec-equality guard (status-only re-put skipped); status-write on FAILURE (reconcileError surfaced, appliedVersion unchanged, loop survives); restart-survival ×3. Zero index-DDL churn WITH the write active is covered by the existing W1.4 3×-restart test now running against this reconciler. Full hub suite GREEN (1954 passed | 7 skips); tsc clean.

**Self-review (code-review, 10 finder angles):**
- FIXED (clearly-mine): empty-error fallback (`|| String(err)` so a blank Error message still surfaces); test-timing hardened to poll-until-condition (avoids a bug-153-class fixed-sleep under-wait).
- **F1 FIXED in #318 (architect-required, 2026-06-19):** `applySchemaIndexes` was SWALLOWING CREATE/DROP INDEX failures (bug-123-era per-index isolation, warn+continue) and only THROWING on malformed renameMap → the status `'failed'`/`reconcileError` path fired ONLY for renameMap errors; a real index-DDL failure (the reconciler's PRIMARY runtime failure mode: lock-timeout/bad-expr/disk) reported `'applied'` — itself a SILENT FAILURE (tele-7) in the wave whose purpose is surfacing reconcile failures. Architect: required, not optional. Fix: `applySchemaIndexes` now RETURNS collected index-failures (KEEPS the bug-123 isolation — warn + continue, never throws, never fails boot); the caller writes `phase='failed'`+reconcileError when any index failed. Paired with **specCache set-on-success-only** (cache a kind's signature only after a fully-successful reconcile → the guard skips only when the LAST reconcile SUCCEEDED → a previously-FAILED spec retries). Bounded: PERSISTENT index failure → 'failed' write → echo re-reconciles → same error → material-guard no-change → no put → STOPS (≤1 echo); TRANSIENT → retry succeeds → 'applied' → cached → converges. +1 test (bad index name → CREATE fails → `phase='failed'`+reconcileError, Hub still boots) + a bounded-convergence assertion on the runtime-failure path (≤2 reconciles, exactly 1 write).
- NOTED (limitations, not fixed): status-write is non-CAS get→merge→put (concurrent spec-change clobber; unreachable in single-Hub prod + design specified MERGE-not-replace); on a BOOT apply-failure the provisional stamp leaves a contradictory appliedVersion (forensic-only; Hub fails-to-start anyway).

**Status:** PR-open (#318), awaiting architect review + the F1 disposition. W6 carries logged: bug-151 (scheduled-Message backlog) + bug-152 (envelope-thread-reply / envelope-tele-retire) prod-snapshot liveness checks land in W6-prep; W8 mixed-read-shape unification.
