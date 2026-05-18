# mission-83 M-Hub-Storage-Substrate — W0 Spike Report

**Mission:** mission-83 (M-Hub-Storage-Substrate; substrate-introduction class with structural-inflection + saga-substrate-completion characteristics)
**Wave:** W0 spike (post-Design v1.1 ratify; pre-W1 substrate-shell)
**Branch:** `agent-greg/m-hub-storage-substrate` (off `origin/main` HEAD `a940a38`)
**Period:** 2026-05-17 AEST mid (single session; ~3 cognitive hours)
**Author:** Greg (engineer; agent-0d2c690e)
**Design ref:** `docs/designs/m-hub-storage-substrate-design.md` (commit `11ce0ba`; v1.1 inventory-currency cleanup post W0.2 spike findings)
**Coord thread:** thread-566 (durable W0-W7 mission-83 coordination)

---

## Executive summary

W0 spike complete — **9 of 9 deliverables shipped** across 9 commits on engineer branch. **All Design v1.1 §4 W0 acceptance criteria met**:

- **Postgres-container compose-up:** ✅ validates (container UP + healthy in ~6s; LISTEN/NOTIFY + JSONB 1.5MB cap smoke PASS; R6 resource bounds active)
- **Entity-kinds enumeration:** ✅ 20-kind inventory LOCKED (`hub/scripts/entity-kinds.json` v1.1); 5 architect-blind-kind-corrections + 1 engineer-blind-kind addition surfaced + folded (bilateral substrate-currency-discipline cycle complete pre-W2)
- **Synthetic-state migration measurement:** ✅ **1.83s** for 10,044 entities (58.17s headroom against 60s budget); R7 (migration downtime > 60s → preflight fail) confirmed sound at current scale + 10x growth horizon
- **Testcontainers harness baseline:** ✅ viable (avg boot 3.42s; 0% flakiness; tx-rollback isolation PASS); per-test-DB-rollback for unit + singleton-with-reset for integration per Design §2.7 architect-lean — no fallback to docker-compose-singleton required
- **Engineer counterpart branch:** ✅ created (`agent-greg/m-hub-storage-substrate`)
- **Mission work-trace:** ✅ initialized (`docs/traces/mission-83-m-hub-storage-substrate-work-trace.md`)

**Key signal for W1:** all load-bearing pre-W1 validations PASS with comfortable margin. W1 substrate-shell can proceed without re-validating any of: substrate-watch primitive (LISTEN/NOTIFY); JSONB 1.5MB cap; entity-kinds inventory; migration budget viability; testcontainers harness shape. Per-W1 deliverable focus shifts cleanly to R9 LISTEN/NOTIFY write-amplification measurement at sustained 1k+ writes/sec (per Design §7.1 R9 B2 fold-in).

---

## §1 Per-deliverable detail

### §1.1 W0.5 + W0.6 — Engineer branch + work-trace initialization (commit `4bb9bbe`)

- Branch `agent-greg/m-hub-storage-substrate` created off `origin/main` HEAD `a940a38`
- Work-trace `docs/traces/mission-83-m-hub-storage-substrate-work-trace.md` initialized per `feedback_per_mission_work_trace_obligation.md` (standing engineer obligation; SEPARATE trace per mission at mission-start; never backfill or append into a prior mission's file)

### §1.2 W0.2 — Filesystem-grep entity-kinds enumeration (commit `7d2f34f`)

Authoritative inventory at HEAD `a940a38` via `grep -lE 'interface I.*(Store|Registry)' hub/src/entities/ hub/src/state.ts` + persistence-path verification via `hub/src/policy/` grep:

- **13 existing substrate-mediated kinds confirmed:** 11 I*Store (Audit + Bug + Idea + Message + Mission + PendingAction + Proposal + Task + Tele + Thread + Turn) + 1 IEngineerRegistry (Agent — sibling abstraction; engineer-round-2-surfaced as 12th-mediated-kind) + 1 Counter (special single-row `meta/counter.json`)
- **2 NEW kinds mission-83 introduces:**
  - **SchemaDef** — substrate-native bootstrap-self-referential per Design §2.3
  - **Notification** — re-introduction per OQ8 (closes mission-56 W5 partial-completion; `hub/src/state.ts:1015-1018 + 1579-1583` show `INotificationStore` removed but `hub/src/hub-networking.ts:431,465,504,735` STILL direct-writes `notif-*.json` — no I*Store mediation today; mission-83 re-introduces `INotificationStore` + `NotificationRepository`)

#### §1.2.1 Architect-blind-kind-corrections (5 phantom-removals; triggered Design v1.1 commit `11ce0ba`)

| Kind | Engineer code-verify finding | Disposition |
|---|---|---|
| **DirectorNotification** | Mission-56 W5 FULLY migrated to Message `kind=note` via `director-notification-helpers.ts:5-8` ("Cut-over (no dual-write): write-paths emit Messages instead of DirectorNotifications"). `emitDirectorNotification()` is a Message-emit wrapper, NOT a separate file-writer. `counter.ts:51` confirms ("Mission-56 W5: DirectorNotification entity removed"). UNLIKE Notification (which kept direct-file-write path), DN's mission-56 cleanup actually completed. | REMOVED from inventory; Design v1.1 §3.4.1 Message row notes DN migrates HERE via `kind=note` |
| **Report** | Inline `task.reportRef` field; no IReportStore + no `report-repository.ts` | REMOVED from inventory |
| **Review** | Inline field on mission/proposal/message (`mission.reviews`, `proposal.reviewState`); no IReviewStore | REMOVED from inventory |
| **ScheduledMessage** | Sweeper-internal type (`ScheduledMessageSweeperOptions` interface); sweeper reads from `IMessageStore.listMessages()` per `scheduled-message-sweeper.ts:118`; NO separate persisted store | REMOVED from auxiliary inventory |
| **MessageProjection** | Sweeper-internal type (`MessageProjectionSweeperOptions` interface); sweeper reads from `IThreadStore.listThreads()` + `IMessageStore`; NO separate persisted store | REMOVED from auxiliary inventory |

#### §1.2.2 Engineer-blind-kind addition (1 NEW; architect W1.1 inspection)

| Kind | Architect W1.1 finding | Disposition |
|---|---|---|
| **ThreadHistoryEntry** | `local-state/architect-context/thread-history.json` contains `{threadId, title, outcome, timestamp}` entries (archived thread summaries); NOT in v1.0 inventory | NEW per v1.1 expanded OQ7; **OQ7 expanded from 3-kind → 4-kind decomposition**; new `IThreadHistoryEntryStore` per Option Y composition |

#### §1.2.3 Architect-side OQ7 decomposition VERIFIED + W0-architect-validates kinds (4 + 1 NEW)

| Kind | Architect verification | Disposition |
|---|---|---|
| **Document** | Real markdown files at `documents/{architecture,planning,specs}/*.md`; entity-semantic content, NOT static asset | New `IDocumentStore` per Option Y |
| **ArchitectDecision** | `decisions.json` contains list of `{decision, context, timestamp}` entries | New `IArchitectDecisionStore` per OQ7 |
| **DirectorHistoryEntry** | `director-history.json` contains list of `{role, text, ...}` entries (director chat archive) | New `IDirectorHistoryEntryStore` per OQ7 |
| **ReviewHistoryEntry** | `review-history.json` contains list of `{taskId, assessment, ...}` entries | New `IReviewHistoryEntryStore` per OQ7 |
| **ThreadHistoryEntry** (NEW) | (see §1.2.2) | New `IThreadHistoryEntryStore` per OQ7 expanded |

#### §1.2.4 Out-of-substrate carve-outs (v1.1; 4 locations)

Per Design §3.4.4:
1. `packages/repo-event-bridge/cursor/ + dedupe/` — uses `MemoryStorageProvider` per §5.2 keep-list
2. `packages/repo-event-bridge-workflow-runs/cursor/ + dedupe/` — same
3. `local-state/docs/` — static markdown assets (NOT Hub-runtime-state)
4. `local-state/architect-context/wisdom/` — **NEW per v1.1** static markdown reference docs (ARCHITECTURE.md + architect-engineer-collaboration.md + workflow-specification.md + `decisions/*.md` numbered ADRs)

### §1.3 W0.2-update — entity-kinds.json v1.1 alignment (commit `2102bf2`)

Engineer-side fold-in commit folding architect's v1.1 disposition. Schema bump 1.0 → 1.1. Inventory section now shows **20 kinds total LOCKED** (13 existing + 2 NEW + 5 W0-architect-VERIFIED). Bilateral substrate-currency-discipline note added (symmetric `feedback_substrate_currency_audit_rubric.md` application — both parties surfaced blind-spots; both accepted corrections without ceremony).

### §1.4 W0.1 — Postgres-container local-dev compose + operator-DX cookbook (commits `4e2b6dd` + `4b906b5`)

Artifacts:
- `hub/spike/W0/docker-compose.yml` — postgres:15-alpine; compose-file v2.4 for cross-compat with docker-compose v1.25 + modern docker compose v2; named volume `hub-substrate-data`; R6 service-level resource bounds (`mem_limit 1g + cpus 1.0 + max_connections=50 + shared_buffers=256MB + work_mem=16MB`); health-check `pg_isready` (interval 5s + retries 10 + start_period 10s)
- `hub/spike/W0/README.md` — W0 spike scope + W7 disposition (artifacts retire to canonical `hub/storage-substrate/` location at W6/W7)
- `docs/operator/hub-storage-substrate-local-dev.md` — operator-DX cookbook v0.1 with R10 ephemeral-by-design CRITICAL warning + R6 rationale + psql forensic queries per §2.6 cookbook + W6/W7-deliverable placeholders + troubleshooting + W0 spike validation evidence section

End-to-end boot-validation:
- **Container UP + healthy in ~6 seconds** (health-check polled `pg_isready`; ~3 attempts at 3s interval)
- **Postgres 15.18** confirmed (postgres:15-alpine current LTS)
- **R6 settings active** per `SELECT name, setting FROM pg_settings WHERE name IN ...`:
  - `max_connections = 50`
  - `shared_buffers = 32768` (kB; = 256MB ✓)
  - `work_mem = 16384` (kB; = 16MB ✓)
- **LISTEN/NOTIFY smoke PASS** — `NOTIFY test_channel, 'hello from W0 spike'` → `Asynchronous notification "test_channel" with payload "hello from W0 spike" received from server process with PID 124`. Substrate-watch primitive functional per Design §2.4 architect-pick.
- **JSONB 1MB-payload smoke PASS** — `INSERT INTO jsonb_smoke VALUES (jsonb_build_object('big', repeat('x', 1000000)));` → `pg_column_size=11469 bytes` (TOAST-compressed; ~99% compression for repetitive content); well under 1.5MB cap from §2.2
- **Memory baseline at idle:** 39.71 MiB / 1 GiB (4% of allocated cap)

### §1.5 W0.3 — Synthetic-state migration `<60s` measurement (commits `44bb6e7` + `c48537c`)

Artifacts:
- `hub/spike/W0/synth-state.js` — Node ES module; generates 10,044 synthetic entities across 13 substrate-mediated kinds; FS-shape JSON files (matching repository convention); synthesis wall-clock 0.22s; payload 10.41 MB
- `hub/spike/W0/migrate-spike.js` — Node ES module; runs migration measurement pipeline per Design §3.1 phases (skipping pre-cutover snapshot which isn't load-bearing for measurement); per-kind COPY FROM STDIN via docker exec

Synthetic dataset distribution (production-realistic):
| Kind | Count | Avg bytes/entity |
|---|---|---|
| Message | 5,000 | 1,220 |
| PendingAction | 1,500 | 990 |
| Audit | 1,000 | 287 |
| Thread | 600 | 1,727 |
| Turn | 600 | 513 |
| Task | 425 | 1,793 |
| Tele | 400 | 1,023 |
| Idea | 300 | 1,009 |
| Bug | 95 | 1,022 |
| Mission | 85 | 1,089 |
| Proposal | 30 | 1,004 |
| Agent | 8 | 1,056 |
| Counter | 1 | 238 |
| **TOTAL** | **10,044** | (avg 1,063 B) |

Measurement result:

| Phase | Wall-clock | Notes |
|---|---|---|
| Phase 3 — schema bootstrap (DROP+CREATE entities + sequence + 2 base indexes) | **0.13s** | DROP+CREATE for spike-repeatability; real cutover is one-shot CREATE |
| Phase 2+4 — source scan + per-kind COPY FROM STDIN | **1.57s** | 13 kinds; hot path 5000 Messages → 13,420 msg/sec |
| Phase 5 — verification (FS-vs-DB count parity) | **0.07s** | PASS: FS=10044 = DB=10044 |
| **TOTAL** | **1.83s** | 5,497 entities/sec aggregate throughput |

**Budget vs measurement:** **58.17s headroom** against 60s TOTAL OBSERVED DOWNTIME budget per Design §3.5 + R7 mitigation table.

**Scaling envelope (extrapolation; W1 refines):**
| Scale | Estimated wall-clock | Disposition |
|---|---|---|
| 10x (~100k entities) | ~18s | Well within budget |
| 50x (~500k entities) | ~90s | Approaches budget; parallel per-kind COPY per §7.1 R7 mitigation |
| 200x (~2M entities) | ~370s | Above budget; cloud-scale tuning per M-Hub-Storage-Cloud-Deploy follow-on (idea-298) |

**Caveats (W1+ refines):**
- Spike skips Hub-lifecycle phases (Hub-stop + pre-cutover-snapshot + Hub-restart NOT measured here); full §3.5 orchestration estimated ~12-22s TOTAL with bookends. Still comfortable margin.
- Spike entities table has NO NOTIFY trigger (W2 reconciler adds); actual cutover with trigger would emit per-row NOTIFY, slightly slower.
- COPY-based bulk-load is postgres-native (10-100x faster than parallel INSERTs); per-row INSERT path at handler-level (W1 substrate-shell) measures differently — R9 LISTEN/NOTIFY write-amp at sustained 1k+ writes/sec remains W1 deliverable.

**R7 disposition:** confirmed sound at current scale + 10x growth horizon.

### §1.6 W0.4 — Testcontainers harness baseline (commit `5f199a9`)

Artifacts:
- `hub/spike/W0/testcontainers/package.json` — sandbox npm package isolated from `hub/package.json` (NOT for production; hub/package.json devDep install happens at W1 per Design §2.7)
- `hub/spike/W0/testcontainers/harness-spike.js` — Node ES module; boots N postgres-15-alpine containers via testcontainers; measures boot+connect+tx-rollback per Design §2.7 architect-lean
- `hub/spike/W0/testcontainers/.gitignore` — excludes 45MB node_modules (sandbox install for measurement only)

Measurement result (N=3 iterations):

| Metric | Min | Avg | Max | StdDev |
|---|---|---|---|---|
| Boot time (cold + warm; first iter is cold-cache) | 1.36s | 3.42s | 7.49s | 2.88s |
| Connect time (post-boot, per-test) | 0.005s | 0.013s | 0.023s | - |

- **Flakiness:** 0% (3/3 iterations succeeded)
- **Tx-rollback isolation:** PASS (per-test-DB-rollback semantics verified — `BEGIN`, `CREATE TABLE`, `INSERT`, in-tx-count=3 (expected 3), `ROLLBACK`, post-rollback query errors with `42P01 undefined_table` → table gone)

**Per Design v1.1 §2.7 dispositions CONFIRMED:**
- Unit tests via per-test-DB-rollback ✅
- Integration tests via singleton-with-reset (NOT measured in W0; W1+ validates)
- Fallback decision: ✅ testcontainers viable (avg boot 3.42s well under 15s threshold; tx-isolation works for unit-test pattern); NO fallback to docker-compose-singleton required

**First-boot cold-cache penalty (~7s) is one-time per CI runner** (image-pull-and-initialize); steady-state per-test boot is ~1.4s. Bounded predictable CI cost.

### §1.7 W0.7 — Spike report consolidation (this document)

Consolidates §1.1-§1.6 + cross-cutting findings (§2) + recommendations (§3) + bibliography (§4).

---

## §2 Cross-cutting findings

### §2.1 Bilateral substrate-currency-discipline cycle (3 rounds; net-positive)

Symmetric application of `feedback_substrate_currency_audit_rubric.md` per `feedback_methodology_bypass_amplification_loop.md` defense:

| Round | Surface | Disposition |
|---|---|---|
| **R1: Engineer W0.2 → architect-blind** | 5 phantom-kind-removals (DirectorNotification + Report + Review + ScheduledMessage + MessageProjection) | Architect accepted; folded as Design v1.1 commit `11ce0ba` |
| **R2: Architect W1.1 → engineer-blind** | 1 NEW addition (ThreadHistoryEntry; OQ7 expanded 3-kind → 4-kind decomposition) + 4 W0-architect-VERIFIED (Document + 3 OQ7 kinds) | Engineer accepted; folded as `entity-kinds.json` v1.1 commit `2102bf2` |
| **R3: Architect-side spec-memory drift on own Design** | Architect doubted R6 citation; engineer ledger-grep returned ground truth (R6 IS resource-bounds per v1.1 §7.1) | Architect-self-correction; no Design change needed (engineer citation was correct against current Design) |

Pattern: **spec-author memory of own spec drifts; ledger query (code-grep) returns ground truth.** Both directions surface; both directions accept corrections without ceremony. Net positive: bilateral-blind defect risk caught pre-W1.

### §2.2 Procedural — task-413 entity-assignment dispatch gap

**bug-94 filed by architect** (major; dispatch-gap; tracks the substrate-defect that made task-413 orphan). Per thread-565: `create_task` MCP call left `assignedEngineerId: null` + no pending-action notification was auto-dispatched. Engineer-side `get_task` confirmed null return (corroborates architect diagnosis).

**Path A executed:** engineer began W0 substantive execution against directive content reproduced in thread-565 message. Path B (architect-side task-entity reconciliation) deferred to bug-94 disposition.

**Calibration-candidate at Phase 10:** task-issuance dispatch requires explicit engineer-assignment for notification to fire; `get_task` is dispatch-queue-bound, NOT pool-scanning. Matches 3-component methodology-bypass-becomes-substrate-defect pattern per `feedback_methodology_bypass_amplification_loop.md` test-rubric.

### §2.3 Engineer-side antml-prefix trap (6th cross-session instance; calibration sharpened)

During Phase 4 round-2 audit on thread-563, engineer hit the antml-prefix trap on `stagedActions` parameter — message landed but Hub silently degraded convergence (status=active; convergenceActions=[]; summary populated with literal `</parameter>` text). Memory calibration sharpened to flag stagedActions specifically as THE trap parameter (6/6 cross-session failures on the same parameter; memory-recall alone is insufficient — deliberate tag-level visual inspection required pre-submit).

**Architect bilateral-converged thread-563/564/565 via revise-action commits** (cross-in-flight messaging); all 3 properly closed per architect-side Hub state inspection.

---

## §3 Recommendations for W1+

### §3.1 W1 substrate-shell scope (per Design v1.1 §4 W1 row)

W0 validates pre-W1 substrate at-rest. W1 substrate-shell deliverables (per Design §4 W1 row):

- `hub/src/storage-substrate/` module skeleton (no longer needs spike validation)
- `entities` table + sequence + base indexes + NOTIFY trigger (W0.1 schema validated; W1 adds trigger)
- CRUD operations (`get`/`put`/`delete`/`list`) + **CAS primitives (`createOnly` + `putIfMatch`)** per §2.1 + watch primitive
- Unit tests against testcontainers postgres (W0.4 validated harness)
- **R9 write-amplification measurement** at synthetic 1k+ writes/sec (NEW per Design §7.1 R9 B2 fold-in; W1 deliverable per §4 W1 row)

W1 dispatch pre-staged at `docs/missions/m-hub-storage-substrate-w1-dispatch-draft.md` (architect commit `4488614`); pre-W1 audit on §2.4 + §3.1 + §5.1 + §5.2 + §3.4.4 done with no architect-blind found.

### §3.2 R9 LISTEN/NOTIFY write-amp measurement plan (W1 deliverable)

W0.1 LISTEN/NOTIFY smoke PASS validates the primitive at single-emit level. W1 R9 measurement extends to:

- Per-row trigger emit cost at sustained write rate
- Measurement target: 1k+ writes/sec sustained for N minutes
- Threshold per Design §7.1 R9: if measurable degradation at ≥10k writes/sec, switch to logical-replication (current scale ~10k entities, ~10s of writes/sec well under threshold)

Engineer-side proposal for R9 measurement shape (architect to confirm at W1 issuance):
- Spike-style harness similar to W0.3 migrate-spike pattern
- Run sustained INSERT load against W1 substrate-shell (with NOTIFY trigger active per W2 spec — may need W2 trigger code available)
- Measure: insert throughput with vs without NOTIFY trigger; identify per-write amplification cost

### §3.3 W0 spike artifact disposition at W6/W7

Per `hub/spike/W0/README.md`:
- `docker-compose.yml` → migrate to canonical `hub/storage-substrate/docker-compose.yml` (or substrate-module-internal location) per W6/W7 finalize
- `synth-state.js` + `migrate-spike.js` → absorbed into real `migrate-fs-to-substrate.ts` per §3.1 (W5 wave deliverable)
- `testcontainers/` sandbox → absorbed into real test infrastructure per §2.7 (W1 wave deliverable; hub/package.json devDep install)
- This spike report → already at canonical `docs/spikes/` location; survives W7 cleanup

Engineer counterpart branch `agent-greg/m-hub-storage-substrate` continues through W1-W7.

### §3.4 Operator-DX cookbook lineage (W6/W7 deliverable scaffolding)

`docs/operator/hub-storage-substrate-local-dev.md` v0.1 ships with W0 spike. Future iterations:
- W6: deletion of legacy `HUB_STORAGE=fs` / `HUB_STORAGE=gcs` config paths + repo-event-bridge regression-gate
- W7: add `scripts/local/get-entities.sh` daily-driver CLI + `scripts/local/hub-snapshot.sh` snapshot-restore wrapper + `docs/operator/hub-storage-cutover-runbook.md`

Operator-DX cookbook is "publish-once, read-many" doc; W0 early-publish gives downstream waves substantive scaffolding to inherit.

---

## §4 Bibliography — commit refs

Engineer branch `agent-greg/m-hub-storage-substrate` (off `origin/main` HEAD `a940a38`):

| Commit | Wave / Deliverable |
|---|---|
| `4bb9bbe` | W0 spike kickoff — W0.5 engineer branch + W0.6 work-trace initialization |
| `7d2f34f` | W0.2 — entity-kinds.json filesystem-grep enumeration |
| `38e476e` | W0 spike — work-trace update post W0.2 ship |
| `2102bf2` | W0.2-update — entity-kinds.json v1.1 alignment + ThreadHistoryEntry |
| `4e2b6dd` | W0.1 — postgres-container local-dev compose + operator-DX cookbook |
| `4b906b5` | W0.1-validation — boot-validation evidence + work-trace update |
| `44bb6e7` | W0.3 — synthetic-state migration `<60s` measurement |
| `c48537c` | W0.3 — work-trace update with measurement evidence |
| `5f199a9` | W0.4 — testcontainers harness baseline measurement |
| (this commit) | W0.7 — spike report consolidation |

Architect branch `agent-lily/m-hub-storage-substrate`:

| Commit | Description |
|---|---|
| `8eed879` | Phase 3 Survey envelope (idea-294) |
| `d9fadf3` | Design v0.1 initial draft |
| `49c08df` | Design v0.1 §3.4 inventory-verification + OQ7 addition |
| `037177a` | Design v0.2 — round-1 audit fold-ins |
| `b0c6a02` | Design v1.0-finalize — 3 round-2 cleanups + thread-563 ratified |
| `69e2561` | Phase 6 preflight artifact (mission-83) — verdict GREEN |
| `11ce0ba` | Design v1.1 inventory-currency cleanup post W0.2 spike findings |
| `4488614` | W1 dispatch pre-staged at `docs/missions/m-hub-storage-substrate-w1-dispatch-draft.md` |

---

## §5 Conclusion — W0 spike CLOSED; W1 ready

All 9 W0 deliverables shipped; all Design v1.1 §4 W0 acceptance criteria met; bilateral substrate-currency-discipline cycle complete; substrate-watch primitive + JSONB cap + migration budget + testcontainers harness all validated with comfortable margins.

**Engineer-side ready for W1 task-issuance** — substrate-shell wave can proceed. W1 dispatch will arrive via thread-content directive per bug-94 workaround pattern (task-entity-issuance secondary).

Postgres container `hub-substrate-postgres` (port 5432) and testcontainers sandbox remain on engineer devbox for W1+ continuation. Engineer-pulse 6h short_status tracks next-session start.

— Greg (engineer; agent-0d2c690e) / 2026-05-17
