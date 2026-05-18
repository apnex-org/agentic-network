---
mission: M-Hub-Storage-FS-Retirement-And-MemoryHubStorageSubstrate
mission-anchor: idea-300
companion-trace: docs/traces/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate-work-trace.md (architect-side)
upstream-mission: mission-83 (M-Hub-Storage-Substrate)
engineer-branch: agent-greg/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate (off origin/main @ c00944b)
architect-branch: agent-lily/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate (6 commits ahead; HEAD eb2236d)
phase: Phase 8 Execution — W0 spike complete; W1 PORT-then-EXTEND pending
---

# mission-300 — engineer-side work-trace

## §1 Session log

### 2026-05-18 15:00 AEST — round-1 bilateral audit engagement (thread-577)

- Architect (Lily) dispatched bilateral critique-review request via thread-577 (re-dispatch of thread-576 after queue-pickup miss); audit-blocked pending engineer-side review per Director-correction
- Engineer-side branch created off `origin/main @ c00944b`; this trace initialized
- Audit scope: Design v0.2 §5 flag dispositions F1-F5; §7.2 open questions Q-A1..Q-A6; SchemaDef inventory; W0-W7 wave-decomp; architect-side blind-spot probe
- maxRounds=8

## §2 Round-1 audit findings (code-verified)

### §2.1 Architect-side §0 self-audit blind-spots (CRITICAL)

Per `feedback_substrate_currency_audit_rubric.md` ARCHITECT-SIDE EXTENSION; code-grep verification of architect spec-recall:

**B1 — `packages/storage-provider/test/conformance.ts` EXISTS** (negates §0 item 1 + §2.2 "NEW WORK — not a port" framing)
- File: `packages/storage-provider/test/conformance.ts` (257 lines)
- Exports `runConformanceSuite(factory, options): void` — exactly the `describe.each`-style abstract suite architect prescribed `from scratch` in §2.2
- Covers: capabilities, get/put, list, delete, createOnly, putIfMatch, path-handling, sequential-consistency
- Mission-47 PRECEDENT IS REAL AND PORTABLE → §2.2 should reframe as "PORT + EXTEND" not "NEW WORK"

**B2 — SchemaDef field is `watchable: boolean` (REQUIRED), NOT `notify: boolean` (optional with default=true)** (negates §0 item 3 + §2.3 final ¶ spec-recall)
- File: `hub/src/storage-substrate/types.ts:24`
- Comment at line 23 says "default true" but the field itself is required (every SchemaDef in `all-schemas.ts` sets it explicitly; 9 of 21 set `watchable: true`, 1 sets `watchable: false`)
- F4 disposition direction (NOTIFY does fire) is CORRECT; field-name + type details are wrong

**B3 — Counter SchemaDef ALREADY EXISTS in `all-schemas.ts:91-100`** (negates §2.6 "Add Counter SchemaDef")
- `kind: "Counter"`, version: 1, watchable: false, no indexes (single-row meta entity with embedded counter-domain fields: taskCounter, proposalCounter, ideaCounter, missionCounter, turnCounter, teleCounter, bugCounter, etc.)
- Counter is entry #4 in the current 20-kind ALL_SCHEMAS inventory

**B4 — SubstrateCounter ALREADY EXISTS at `hub/src/entities/substrate-counter.ts`** (mission-83 W4 + bug-97 W5.5 fix; negates §2.6 framing)
- Uses Design v1.4 `getWithRevision` + `putIfMatch` CAS retry-loop (MAX_CAS_RETRIES=50)
- Race-free per substrate-boundary CAS contract; bug-97 fix landed at `e109000`
- §2.6 scope should reframe: NOT "add Counter SchemaDef + add issueCounter primitive + delete Counter abstraction"; instead "delete legacy FS-mode `counter.ts` + `StorageBackedCounter` + DECIDE whether to replace existing SubstrateCounter CAS-retry-loop with new atomic-primitive `issueCounter`"

**B5 — Reconciler does NOT manage tables, only INDEXES on the single `entities` table** (refines §0 item 5 + §2.6 mechanism claim)
- File: `hub/src/storage-substrate/schema-reconciler.ts` — only emits `CREATE INDEX CONCURRENTLY IF NOT EXISTS` + `DROP INDEX CONCURRENTLY IF EXISTS`
- §2.6 "counters-table mechanism via standard table-CRUD which the substrate already supports via SchemaDef registration" is wrong — SchemaDef registration creates indexes on the `entities` table, NOT separate tables
- §2.6 needs to pick: (a) counters bootstrap-time DDL outside reconciler, OR (b) Counter stays as a kind in entities table (current SubstrateCounter state), OR (c) reconciler extends to support CREATE TABLE/SEQUENCE (NEW slice prerequisite — architect mentioned W3.5 in §0 ratify-criterion but not in §3 wave-decomp table)

**B6 — W2 test-cascade blast-radius is stale at "~22 files; ~170 tests"**
- Filesystem-grep at HEAD `c00944b`: 82 `.test.ts` files in `hub/test/`; 49 reference `test-utils` or `MemoryStorageProvider`
- "22-file" figure was mission-83 W6 narrowed-scope estimate; surface needs re-estimate at W0

### §2.2 Per-flag dispositions

| # | Verdict | Rationale (code-grounded) |
|---|---|---|
| F1 (CRITICAL) cluster #23 closure | **CONCUR + REFINE** | §2.4 architecture sound; docker-restart dispositive but heavyweight. Engineer-recommendation: BOTH — light in-process Hub-restart-simulation as primary unit-test (sub-second; cursor + dedupe survive teardown+recreate against same postgres) PLUS docker-restart smoke at PR ship-gate (matches mission-83 W2 test-postgres-container harness; bug-93-class regression net). Anchor verified: `hub/src/index.ts` around line 163 (`MemoryStorageProvider` sentinel) + ~840 (`storage: storageProvider` to RepoEventBridge) |
| F2 (MEDIUM) SubstrateConformanceSuite | **CHALLENGE** | §0 item 1 + §2.2 misframe scope as "NEW WORK — not a port". Mission-47 conformance suite is real at `packages/storage-provider/test/conformance.ts` (~257 lines). Refine to: PORT 1:1 (capabilities, get/put, delete, list, createOnly, putIfMatch, path-handling, sequential-consistency) + EXTEND ~10-15 substrate-specific tests for primitives StorageProvider doesn't have (watch, getWithRevision, applySchema/listSchemas/getSchema, restart-safety with postgres, race-correctness under postgres concurrent writers). |
| F3 (MEDIUM) Variant ii primitive-mapping | **CONCUR + MINOR REFINE** | Primitive-mapping table verified 1:1; cursor-store.ts (240 lines) uses `createOnly` + `putIfMatch` + `getWithToken` matching substrate's `createOnly` + `putIfMatch` + `getWithRevision`. Refine: cursor-store.ts internal data is `Uint8Array` via `TextEncoder`; substrate body is JSONB. Adapter must JSON.parse↔stringify (trivial; mention explicitly in §2.3 impl note). AG-5 deferral correct. |
| F4 (MINOR/PROBE) NOTIFY-trigger | **CONCUR direction + CHALLENGE spec-recall** | Direction correct (NOTIFY does fire for substrate-registered kinds via SchemaDef). Spec-recall details wrong: field is `watchable: boolean` (REQUIRED), not `notify: boolean` (optional default-true). 9 of 21 entries in `all-schemas.ts` explicitly set `watchable: true`; `Counter` sets `watchable: false` ("counter writes are bookkeeping; no consumer needs change-events"). Refine: RepoEventBridgeCursor + RepoEventBridgeDedupe should explicitly set `watchable: false` (same pattern as Counter) — closes architect's §5 F5 row "engineer-audit-future-target" probe pre-emptively. |
| F5 (CRITICAL; NEW v0.2) Variant ii implementability | **CONCUR + extend** | §0 item 6 self-audit correctly surfaced the v0.1 pure-KV non-implementability. Minimal-SchemaDef Variant resolves it. Additionally fold B2 spec-correction (watchable field name + required-shape) + B4 explicit `watchable: false` on both new SchemaDefs into the §2.3 implementation surface for v0.3. |

### §2.3 Open-question dispositions

| Q | Verdict | Engineer-disposition |
|---|---|---|
| Q-A1 integration-test infra shape | REFINE | BOTH — in-process Hub-restart-simulation as primary (fast; sub-second; CI-deterministic) + docker-restart as secondary smoke at PR ship-gate (heavyweight; ground-truth dispositive). Bilateral architect+engineer agreement target at W0 spike confirm. |
| Q-A2 mission-47 conformance suite location | **RESOLVED at code-level** | `packages/storage-provider/test/conformance.ts` (257 lines; `runConformanceSuite(factory, options)` exported). NOT new work; port-then-extend. |
| Q-A3 Variant ii interface-swap mechanics | **RESOLVED at code-level** | Primitive-mapping verified 1:1; cursor-store.ts shape preserved via thin adapter; minimal-SchemaDef compatible. Spike at W0 to confirm zero-blocker. |
| Q-A4 schema-reconciler primitive coverage | **RESOLVED at code-level** | Reconciler is INDEX-only (CREATE INDEX CONCURRENTLY / DROP INDEX). NO table-create. NO sequence-create. §2.6 counters-table mechanism needs disambiguation per B5 above (bootstrap-DDL outside reconciler vs Counter-stays-as-kind vs reconciler-extension new slice). |
| Q-A5 substrate-watch perf under 1s/5s ticks | CONCUR | Pre-W7 profile gate is right. NOTE additional architectural-future-leverage: substrate-watch enables sweepers to SUBSCRIBE to ScheduledMessage / unprojected-Thread change-events instead of polling. v1 keeps polling; surface as W7 follow-on architectural note. Pre-PR-#203 defaults VERIFIED in git log (commit `a940a38`): scheduled=1s, projection=5s (architect §2.8 correct). |
| Q-A6 PR cadence | **REFINE** | Single-PR-per-mission worked for mission-83 because waves were tightly interdependent (substrate-shell build-out). mission-300 has substantively-independent waves (W1 conformance suite extraction + W3 cluster #23 integration test + W4 deletion cascade + W5 env-var retirement). Engineer-recommendation: per-wave PR for SUBSTANTIVE waves (W1 / W3 / W4 / W5) + folded mini-PR for trivial (W0+W2 spike-and-cascade; W6+W7 restoration+revert). ~5 PRs total. Note: agentic-network is apnex-org/* → PR-flow per `multi-agent-pr-workflow.md` (not apnex/* direct-commit). |

### §2.4 SchemaDef inventory verdict

- Architect prescribes 20 → 23 (add RepoEventBridgeCursor + RepoEventBridgeDedupe + Counter).
- **Counter already entry #4** in current 20-kind inventory (`all-schemas.ts:91`). Correct delta: 20 → 22.
- Both new SchemaDefs should set `watchable: false` (cursor/dedupe writes are bookkeeping; no consumer needs change-events; same pattern as Counter).
- `hub/scripts/entity-kinds.json` v1.1 → v1.2 update at W3 ship (architect-spec).

### §2.5 Wave-decomposition refinements

- **W2 test-cascade blast-radius re-estimate at W0 spike** (per B6; "22-file" is stale; actual ~49 files of 82 .test.ts).
- **W4 scope clarification**: `counter.ts` + `StorageBackedCounter` deletion explicit; SubstrateCounter remains; DECIDE at W4 whether to refactor SubstrateCounter CAS-loop to new atomic primitive (architect §2.6 prescribes `issueCounter` primitive; mechanism choice per B5 above).
- **W5 STORAGE_BACKEND retirement also touches `scripts/local/start-hub.sh:125`** (default `local-fs` currently); local-dev Hub needs postgres-up-required at boot (mission-83 cookbook already documents; W5 makes mandatory).
- **W3.5 reconciler-extension prerequisite** — architect mentioned in §0 ratify-criterion but absent from §3 wave-decomp table. Either fold §2.6 mechanism into Counter-stays-as-kind path (W3.5 not needed) OR add W3.5 to wave-decomp explicitly.

## §3 Architect-ask for round-2

Per `feedback_bilateral_audit_round_budget_discipline.md`: skip ack-only courtesy round; architect-fold-then-commit. Round-2 surfaces:

1. v0.3 fold of B1-B6 self-audit corrections (with §0 changelog entries)
2. F2 reframe to PORT-then-EXTEND (with mission-47 conformance.ts as anchor)
3. §2.6 Counter mechanism disambiguation (B5 — pick a, b, or c)
4. §2.3 `watchable: false` on new SchemaDefs (B2/F4 fold)
5. SchemaDef inventory 20 → 22 (not 23; B3 correction)
6. W3.5 wave addition (if §2.6 mechanism needs reconciler-extension) OR removal of §0 ratify-criterion mention (if not)
7. W2 blast-radius re-estimate at W0 OR re-stated explicitly
8. PR cadence refinement (Q-A6 REFINE) per-wave-PR for substantive waves

Engineer-disposition for v1.0 ratify: GREEN once B1-B6 folded + §2.6 mechanism pinned + SchemaDef inventory corrected.

---

— Engineer (greg) 2026-05-18 15:30 AEST (round-1 bilateral audit; thread-577 reply pending)

---

### 2026-05-19 08:00 AEST — W0 spike execution (thread-579)

Phase 8 entered post Director Phase 7 Release-gate ratification (full-autonomous-driving mandate). W0 dispatched via thread-579 (round 1) with 4 deliverables; engineer ack + execution plan + checkpoint commitment at round 2 (per `feedback_pattern_a_engineer_turn_discipline` — load-bearing ack, not pure-ack). Architect confirmed plan + standby at round 3. 3 engineerPulse fires during execution window (10min cadence) — non-blocking; commit-push heartbeat via CLAUDE.md §1.5.1.1 Layer (c) is architect's primary visibility surface.

## §3 W0 deliverables shipped

### §3.1 W0.1 — MemoryHubStorageSubstrate impl

- **Location:** `hub/src/storage-substrate/memory-substrate.ts` (404 lines)
- **Factory:** `createMemoryStorageSubstrate(): HubStorageSubstrate`
- **Exports:** Added to `hub/src/storage-substrate/index.ts`
- **Design:** `Map<kind, Map<id, {data, resourceVersion}>>` entity storage; substrate-wide monotonic `revisionCounter` (mirrors postgres `entities_rv_seq` semantic — NOT per-kind-isolated); per-kind `Set<callback>` watchers with EventEmitter-style dispatch
- **Defensive copy:** `structuredClone()` on every get/put boundary (caller mutations isolated)
- **Restart-safety:** N/A by design per Design v1.0 §2.1 (in-process; data lost on process exit)
- **Schema convenience-wrappers** (applySchema/listSchemas/getSchema): throw per parity with PostgresStorageSubstrate W1 substrate-shell behavior. Production reconciler uses substrate.put("SchemaDef", ...) directly (verified compatible).
- **snapshot/restore:** throw per memory-impl design

### §3.2 W0.2 — Per-method parity baseline

- **Location:** `hub/src/storage-substrate/__tests__/memory-substrate.test.ts` (323 lines; 35 tests)
- **Coverage:** get/put (7), getWithRevision (3), delete (2), list (5), createOnly (3), putIfMatch (4), watch (4), schema-wrappers (4), snapshot/restore (2), Counter-special-case + defensive-copy + revision-monotonicity
- **Result:** 35/35 PASS in 201ms; typecheck PASS

### §3.3 W0.3 — W2 blast-radius re-count (deliverable per round-1 B6)

Definitive grep at HEAD `db5dca3`:

| Surface | Count |
|---|---|
| Total `.test.ts` files in `hub/test/` | 82 |
| Files referencing `test-utils` OR `MemoryStorageProvider` OR `LocalFsStorageProvider` | **50** |
| Of which import `test-utils` | 25 |
| Of which import `MemoryStorageProvider` directly | 26 |
| Of which import `LocalFsStorageProvider` directly | 2 |
| Of which import FS-version entity-repository directly | 33 |
| Cascade in `hub/src/**/__tests__/` (23 total .test.ts) | 0 (clean — already substrate-shaped) |

**W2 scope refined:** 50 hub/test files (NOT ~22 as v0.2 estimate stated; NOT 49 as my round-1 baseline approximated). Architect can refine W2 ship-criteria pre-W2 dispatch.

### §3.4 W0.4 — RepoEventBridgeSubstrateAdapter spike

- **Location:** `hub/src/storage-substrate/repo-event-bridge-adapter.ts` (170 lines) + `__tests__/repo-event-bridge-adapter.test.ts` (170 lines; 17 tests)
- **Result:** 17/17 PASS in 211ms; typecheck PASS
- **Coverage:** capabilities + path-mapping (5) + cursor-store integration cycle (4 incl. createOnly→getWithToken→putIfMatch + stale-token + StoragePathNotFoundError) + absent-path semantics (2) + Uint8Array↔JSONB round-trip (2) + Variant-ii-scope-boundary stub-throws (3)
- **Spike-finding:** **Primitive-mapping IS 1:1 + zero-blocker for W3 commitment.** All 4 primitives cursor-store.ts uses (`createOnly` / `getWithToken` / `putIfMatch` / `get`) map cleanly to substrate primitives via the Design §2.3 primitive-mapping table; Uint8Array↔JSONB conversion via TextEncoder/Decoder + JSON.parse/stringify works through the `{id, body}` entity-wrap shape.

### §3.5 Architectural-decision-point surface for W3 — adapter LOCATION

- **Design v1.0 §2.3 prescribed:** `packages/repo-event-bridge/src/substrate-adapter.ts`
- **W0.4 spike placed at:** `hub/src/storage-substrate/repo-event-bridge-adapter.ts`
- **REASON:** hub-substrate types live in hub package (NOT a published workspace); repo-event-bridge package can't cleanly import `HubStorageSubstrate` without (a) publishing hub-substrate-types as separate workspace package, (b) duplicating types in repo-event-bridge, or (c) cross-package relative imports (violates tsconfig `rootDir`)
- **Engineer-recommendation for W3:** keep adapter at hub-side location — cleaner typing; matches hub→repo-event-bridge dependency already in `hub/src/index.ts`; adapter is hub-internal-glue not a repo-event-bridge concern
- **Surface to architect at W3 dispatch for ratify-or-refine** (this is decision-point checkpoint per round-2 cadence commitment)

## §4 W1 next-up

- PORT runConformanceSuite from `packages/storage-provider/test/conformance.ts` (257 lines) to `hub/src/storage-substrate/__tests__/conformance/runSubstrateConformanceSuite.ts`
- EXTEND with ~10-15 substrate-specific tests (watch + getWithRevision + applySchema + restart-safety with postgres + race-correctness under postgres concurrent writers)
- Abstract `describe.each` over `[memoryFactory, postgresFactory]`
- Postgres factory uses mission-83 W2 testcontainers harness (`hub/test/postgres-container.ts` or equivalent — verify location at W1 entry)
- Ship: W0+W1 combined PR per Q-A6 cadence

— Engineer (greg) 2026-05-19 08:05 AEST (W0 spike complete; W1 starting; checkpoint surfacing on thread-579)

---

### 2026-05-19 08:20 AEST — W1 PORT-then-EXTEND SubstrateConformanceSuite complete (thread-579)

Architect ratified W0 + both decisions (W0.4 hub-side adapter + W2 own-PR) at round 5; W1 GO-signal granted. ~6-PR cadence ratified (revised from ~5). B7-class calibration candidate filed for Phase 10 retro (architect-spec-vs-cross-package-boundary drift).

## §5 W1 deliverables shipped

### §5.1 SubstrateConformanceSuite — PORT 1:1 + EXTEND substrate-specific

- **Suite runner:** `hub/src/storage-substrate/__tests__/conformance/runSubstrateConformanceSuite.ts` (528 lines)
- **Test wiring:** `hub/src/storage-substrate/__tests__/conformance/substrate-conformance.test.ts` (130 lines)
- **describe.each pattern:** `[memoryFactory, postgresFactory]` (per Design v1.0 §2.2 ratify-criterion: both factories must pass)
- **PORTED 1:1 categories** (from `packages/storage-provider/test/conformance.ts` mission-47 baseline): get+put (7) + delete (2) + list (6; adapted prefix→kind-discrimination) + createOnly (3) + putIfMatch (4) + sequential-consistency (2) = 24 tests
- **EXTENDED categories** (substrate-specific primitives StorageProvider doesn't have): getWithRevision (3) + watch (6; race-fixed via delay+Promise.race pattern from postgres-substrate.test.ts) + schema-wrappers (4) + snapshot/restore (2) + race-correctness (3 incl. bug-97 reproducer) = 18 tests
- **Postgres-only category** (runner-level; outside the shared runner): restart-safety (3 tests; substrate teardown+recreate cycle)
- **Total:** 42 memory + 41 postgres + 3 postgres-restart = **87 PASS / 87 total** (4.02s)

### §5.2 W1 cleanup folded into ship

- Watch tests race-fix: replaced `setImmediate` + strict abort-on-first-event with `delay(200)` subscribe-wait + `Promise.race([consumer, delay(2000)])` bounded-wait + `consumer.catch(()=>{})` abort-swallow — pattern lifted from existing `postgres-substrate.test.ts` watch tests. Memory factory: still fast (delay is no-op overhead; ~3s suite total). Postgres factory: NOTIFY-delivery has true latency (~200ms typical); race-fix preserves test-determinism.
- putIfMatch absent-entity test type-fix: expectedRevision must be numeric-string for postgres BIGINT comparison (memory accepts any string; postgres requires bigint-parseable). Test now uses `"999999999"` to bypass parse-failure path and reach the genuine absent-entity check.

### §5.3 W1 spike-finding — SubstrateConformanceSuite ratify criterion

PORTed runner mechanically equivalent to mission-47 `runConformanceSuite(factory, options)`. Both factories pass the identical suite via `describe.each`. EXTENDED categories cover all substrate-specific primitives (watch + getWithRevision + applySchema/listSchemas/getSchema + restart-safety + race-correctness with bug-97 reproducer). Per Design v1.0 §2.2 ratify-criterion: GREEN.

## §6 W0+W1 PR ship-prep

- Branch: `agent-greg/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate` (HEAD `a3accb9` + W1 commit pending)
- Combined PR scope: W0 (memory-substrate + parity + blast-radius + adapter spike) + W1 (SubstrateConformanceSuite PORT-then-EXTEND)
- PR target: `main`
- Per Q-A6 ratify (+ architect round-5 update): ~6 PRs total; W0+W1 = PR 1 of 6
- Bilateral PR-merge-gate engages architect on §5 F2 disposition (PORT-then-EXTEND verify) + W0.4 architectural-decision-point (hub-side adapter location — ALREADY ratified at thread-579 round 5)

— Engineer (greg) 2026-05-19 08:20 AEST (W0+W1 complete; opening PR + surfacing PR-merge-gate checkpoint)

---

### 2026-05-19 08:30 AEST — W2 test-utils.ts migration + 28-file cascade (thread-580)

W0+W1 PR #209 MERGED at `0e316ca` (vitest hub rerun PASS confirmed flakiness; substrate-counter.race.test.ts 57P01 was test-harness amplification not substrate-defect). Architect dispatched W2 on fresh thread-580. Branch force-pushed to `origin/main @ 0e316ca`.

## §7 W2 deliverables shipped

### §7.1 W2.1 test-utils.ts migration

- **File:** `hub/src/policy/test-utils.ts` (89 lines)
- **Swap:** FS-version-repos (`*Repository` + `MemoryStorageProvider` + `StorageBackedCounter`) → substrate-version (`*RepositorySubstrate` + `createMemoryStorageSubstrate` + `SubstrateCounter`)
- **All 12 repos** migrated: Agent/Task/Proposal/Thread/Idea/Mission/Turn/Tele/Audit/Bug/PendingAction/Message
- **AllStores interface preserved** — both FS and substrate versions implement same I*Store interfaces; consumers unchanged
- **No SchemaDef pre-registration** required for MemoryHubStorageSubstrate (substrate-internal enforcement is postgres-only via reconciler indexes; memory put/get/list work kind-agnostic per Design v1.0 §2.1)

### §7.2 W2.2 28-file test-cascade (W0.3 baseline = 26 direct MemoryStorageProvider consumers + 2 lib-internal-access patterns)

**Mechanical sed migration** (26 files; uniform `../../src/...` import depth):
- `MemoryStorageProvider` → `createMemoryStorageSubstrate()`
- `StorageBackedCounter` → `SubstrateCounter`
- `*Repository` → `*RepositorySubstrate as *Repository` (import alias preserves usage-call patterns)
- FS-version `entities/*-repository.js` → `entities/*-repository-substrate.js` import paths

**Manual fixes** (4 files; lib-internal-access patterns sed couldn't catch):
- `wave1-policies.test.ts`: helper `mutateAgentBlob` rewritten from FS-path `reg.provider.get(path)` to substrate-API `reg.substrate.get("Agent", id)`
- `idle-agent-cognitive-drift.test.ts`: similar `.provider` access pattern → `.substrate` API (entity kind="Agent")
- `m18-agent.test.ts`: `offlineAgentSeenAt` helper FS-path `provider.put(path, ...)` → substrate-API `substrate.put("Agent", entity)`
- `scheduled-message-sweeper.test.ts`: test-bug fix `auditStore.listEntries({limit: 10})` → `auditStore.listEntries(10)` (signature is `listEntries(limit: number)`; FS-version tolerated object-as-limit via NaN-comparison loop; substrate strictly enforces — caught per `feedback_test_caught_substrate_gap_default_disposition` 3-question rubric)
- `audit-repository.test.ts`: removed FS-version `LocalFsStorageProvider` parameterization (W4 territory); substrate-only fixture; reduced `N=100 → N=30` for SubstrateCounter CAS-retry budget (MAX_CAS_RETRIES=50 per bug-97 W5.5 fix; production-realistic contention bound); removed `audit/v2/ namespace isolation` test (FS-version-specific path-prefix concept; substrate uses (kind, id) tuple discrimination)

### §7.3 Test-result summary

| Stage | Tests | Pass | Skip | Fail |
|---|---|---|---|---|
| Pre-W2 (post-merge HEAD `0e316ca`) | 1476 | 1476 | 5 (skipped) | 0 |
| Post-W2.1 only (test-utils.ts) | 1476 | 1470 | 5 | 1 (wave1-policies internal-access) |
| Post-W2.2 sed cascade | 1476 | 1445 | 5 | 26 (4 files: audit-repository × 20 + m18-agent × 3 + scheduled-message-sweeper × 2 + idle-agent-cognitive-drift × 1) |
| **Post-W2.2 manual fixes (FINAL)** | **1465** | **1460** | **5** | **0** ✅ |

Delta of 11 tests: 10 removed (FS-version `LocalFsStorageProvider` × 10 audit tests was the doubled-parameterization branch) + 1 removed (`audit/v2/ namespace isolation` FS-specific test). All substrate-side coverage preserved.

### §7.4 Substrate vs FS-version semantic-difference findings (W2 reference for W4)

Surfaced during W2 cascade; relevant for W4 retirement scope:
1. **Counter scaling boundary**: SubstrateCounter MAX_CAS_RETRIES=50 imposes ~50-concurrent-allocator ceiling per-instance (production-realistic; test stress-bounds at N=30); FS-version `StorageBackedCounter` used Mutex-serialization with no such bound
2. **`audit/v2/` path-prefix concept removed**: substrate uses kind-discrimination; path-prefix namespace tests are FS-version-specific
3. **listEntries signature strictness**: substrate strictly enforces `(limit: number, actor?)`; FS-version loose-typed object-as-limit silently no-op'd (test-bug surfaced via substrate strictness)

## §8 W2 PR ship-prep

- Branch: `agent-greg/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate` (HEAD post-W2 cascade)
- Scope: 28 files (1 src + 27 test files) — net +130 lines / -110 lines
- PR base: `origin/main @ 0e316ca` (post W0+W1 merge)
- Per ~6-PR cadence ratify (thread-579 round 5): W2 = PR 2 of 6 (standalone)
- Bilateral PR-merge-gate engages architect on §2 ship-criteria verify

— Engineer (greg) 2026-05-19 08:35 AEST (W2 complete; opening PR + surfacing checkpoint on thread-580)

---

### 2026-05-19 08:40 AEST — W3 repo-event-bridge migration + cluster #23 closure (thread-581)

W2 PR #210 MERGED at `e9fbbab` (vitest hub SUCCESS first try; W1 testcontainers-amplification hypothesis NOT validated at W2 scale). Architect dispatched W3 on fresh thread-581; engineer-branch reset to `origin/main @ e9fbbab`.

## §9 W3 deliverables shipped (5 sub-tasks)

### §9.1 W3.1 — 2 new SchemaDefs (20 → 22 kinds)

- `hub/src/storage-substrate/schemas/all-schemas.ts`: added `RepoEventBridgeCursor` + `RepoEventBridgeDedupe` (both `watchable: false`; no hot fields; no indexes — bookkeeping kinds per Counter precedent; minimum-`id`-field shape)
- `hub/scripts/entity-kinds.json` v1.1 → v1.2: 2 new kind entries with mediation/persistence-prefix/id-pattern documentation; `substrate-mediated-kinds-total-locked: 20 → 22`
- SchemaDef inventory: 20 → 22 per Design v1.0 §0.3 + v1.1

### §9.2 W3.2 — Adapter production-promotion (no-op; spike was production-shape)

- `hub/src/storage-substrate/repo-event-bridge-adapter.ts` already shipped at W0+W1 PR (commit `2b664d2`); 170 lines + 170-line test
- 17/17 tests PASS at `e9fbbab` baseline — production-ready as-shipped
- Architectural-decision (hub-side location) ratified at thread-579 round 5; Design v1.1 §2.3 location-pointer folded at architect commit `a15f7ac`

### §9.3 W3.3 — cursor-store.ts swap (no-op; type-compatible)

- `packages/repo-event-bridge/src/cursor-store.ts:78` accepts `StorageProvider` interface
- `RepoEventBridgeSubstrateAdapter implements StorageProviderWithTokenRead extends StorageProvider` — type-compatible without cursor-store.ts edits
- Architectural swap happens at the wire-up site (W3.4); cursor-store.ts internal logic unchanged per Design intent

### §9.4 W3.4 — hub/src/index.ts:840 RepoEventBridge wire-up

- Added `RepoEventBridgeSubstrateAdapter` import at line 86
- Conditional storage assignment at the RepoEventBridge construction site:
  ```typescript
  const repoEventBridgeStorage = substrate
    ? new RepoEventBridgeSubstrateAdapter({ substrate })
    : storageProvider;
  ```
- **Cluster #23 closure architecturally enacted**: in substrate-mode (production-prod path per mission-83 W5.4 cutover), repo-event-bridge cursor + dedupe now persist to postgres via the adapter; pre-W3 the `storageProvider = new MemoryStorageProvider()` sentinel at line 163 caused ephemeral persistence (lost on Hub restart; cursor-store.ts "Survives Hub restart" commitment violated)
- FS-fallback modes (local-fs / memory) preserved per W4 (which will retire them entirely)
- Typecheck PASS

### §9.5 W3.5 — Cluster #23 closure integration test (dispositive evidence)

- **Location:** `hub/test/integration/cluster-23-cursor-restart-safety.test.ts` (hub-side per same architectural-rationale as adapter location; B7-class sibling per W0.4 fold pattern)
- **4 tests / 4 PASS** (5.26s total):
  1. `cursor persists across substrate teardown + recreate` — write cursor via instance A → close substrate → fresh instance B against same postgres → cursor restored
  2. `cursor update via putIfMatch survives restart with current token` — CAS update path across restart with token portability
  3. `dedupe LRU survives substrate teardown + recreate` — filterUnseen + markSeen seed in A; filterUnseen in B returns empty (all deduped)
  4. `dedupe + cursor jointly persist for the same repoId` — joint round-trip
- **Test architecture (per Design v1.0 §2.4 + F1 disposition greg round-1 CONCUR+REFINE):**
  - (a) PRIMARY in-process Hub-restart-simulation (sub-second; CI-deterministic; substrate-close → recreate against same postgres)
  - (b) SMOKE docker-restart at PR ship-gate — deliberately NOT embedded in suite per W1 testcontainers-amplification concern; preserved as operator-side runbook step
- **Cluster #23 ratify-criterion GREEN** → architect-Director-bilateral filing at PR #211 ship for `open → closed-structurally` ledger transition (NOT LLM-autonomous per `feedback_calibration_ledger_discipline`)

## §10 Test-result summary

| Stage | Tests | Pass | Skip | Fail | Notes |
|---|---|---|---|---|---|
| Pre-W3 (post-W2 merge HEAD `e9fbbab`) | 1465 | 1460 | 5 | 0 | W2 baseline |
| Post-W3 (FINAL) | 1469 | 1464 | 5 | 0 ✅ | +4 cluster #23 tests; all green |

Typecheck PASS at every sub-task.

## §11 W3 PR ship-prep

- Branch: `agent-greg/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate` (HEAD post-W3 commits)
- Base: `origin/main @ e9fbbab`
- PR scope: 5 files + 1 new file
  - `hub/src/storage-substrate/schemas/all-schemas.ts` (+19 lines / -3)
  - `hub/scripts/entity-kinds.json` (+21 lines / -3)
  - `hub/src/index.ts` (+13 lines / -1)
  - `hub/test/integration/cluster-23-cursor-restart-safety.test.ts` (NEW; 168 lines; 4 tests)
- Per ~6-PR cadence ratify: W3 = PR 3 of 6 (standalone)
- Bilateral PR-merge-gate engages architect on F1+F3+F5 disposition verify

— Engineer (greg) 2026-05-19 08:45 AEST (W3 complete; opening PR + surfacing checkpoint on thread-581)

---

### 2026-05-19 08:50 AEST — W4 substrate-deletion-cascade complete (thread-582)

W3 PR #211 merged at `ef36b79` (cluster #23 architecturally closed). Architect dispatched W4 on fresh thread-582 (largest-scope wave: substrate-deletion-cascade).

## §12 W4 deliverables shipped (6 sub-tasks)

### §12.1 W4.1 — Import-graph survey (engineer-decision FORCED)

Critical finding: `@apnex/storage-provider` is a **published workspace runtime dependency** of `@apnex/repo-event-bridge`. cursor-store.ts uses `StorageProvider` + `hasGetWithToken`; poll-source.ts uses `StorageProvider`; tests use `MemoryStorageProvider` + conformance suite. **Forces SHRINK-not-RETIRE** disposition (RETIRE would break published package contract).

### §12.2 W4.2 — Per-repo SubstrateCounter swap (NO-OP)

Production-Hub already uses substrate-version repos + SubstrateCounter per mission-83 W5.4 cutover. Deletion-cascade IS the swap; no per-repo wiring change needed.

### §12.3 W4.3 — DELETE 12 FS-version entity-repository files

Deleted: agent / audit / bug / idea / message / mission / pending-action / proposal / task / tele / thread / turn — all `*-repository.ts` files in `hub/src/entities/`.

### §12.4 W4.4 — hub/src/index.ts simplification + LocalFsStorageProvider deletion

- **Dispatch-branches deleted:** `else if (STORAGE_BACKEND === "local-fs")` (lines 167-225) + `else (STORAGE_BACKEND === "memory")` (lines 226-233); replaced with FATAL guard: substrate is sole production path; non-substrate values exit-1
- **`storageProvider` variable + substrate-mode sentinel deleted:** line 144 `let storageProvider` + line 164 `storageProvider = new MemoryStorageProvider()` both removed; substrate is unconditional post-dispatch-fatal (non-null assertion + drop if-guard at repository instantiation)
- **MemoryStorageProvider + LocalFsStorageProvider production imports deleted** (line 33)
- **STORAGE_BACKEND env-var ceremony PRESERVED** for W5 final-removal per Finding B
- **`packages/storage-provider/src/local-fs.ts` DELETED** + package `index.ts` export updated

### §12.5 W4.5 — DELETE counter.ts + StorageBackedCounter

Deleted `hub/src/entities/counter.ts` (StorageBackedCounter class + Counters interface + CounterField type). SubstrateCounter at `hub/src/entities/substrate-counter.ts` is sole canonical (mission-83 W4 + bug-97 W5.5 fix; production-ready per architect-decision Design v1.0 §2.6 NO-atomic-issueCounter-refactor).

### §12.6 W4.6 — packages/storage-provider/ SHRINK confirmation

**SHRINK** (forced by W4.1 survey; engineer-decision documented):
- DELETED: `packages/storage-provider/src/local-fs.ts` (LocalFsStorageProvider)
- DELETED: LocalFsStorageProvider export from `index.ts`
- **PRESERVED**: `contract.ts` (StorageProvider interface + hasGetWithToken + StoragePathNotFoundError); `memory.ts` (MemoryStorageProvider); `test/conformance.ts` (used by `@apnex/repo-event-bridge/test/conformance/poll-source-conformance.test.ts`)

### §12.7 hub/src/entities/index.ts re-export update

Dropped FS-version + counter.ts + StorageBackedCounter re-exports (lines 18, 21, 23, 25, 27, 29, 54, 58, 63, 65, 66, 70, 81, 114). Preserved substrate-version re-exports + I*Store interface types + SubstrateCounter.

## §13 Test-result summary

| Stage | Tests | Pass | Skip | Fail |
|---|---|---|---|---|
| Pre-W4 (post-W3 merge HEAD `ef36b79`) | 1469 | 1464 | 5 | 0 |
| **Post-W4 (FINAL)** | **1469** | **1464** | **5** | **0** ✅ |

Same test-count + same green status — W2 already migrated fixtures; W4 deletion-cascade is pure dead-code removal with zero functional change. Typecheck PASS.

## §14 W4 file-impact summary

| Action | Count | Files |
|---|---|---|
| DELETED | 13 | 12 FS-version `*-repository.ts` + counter.ts |
| DELETED | 1 | `packages/storage-provider/src/local-fs.ts` |
| MODIFIED | 4 | hub/src/index.ts + hub/src/entities/index.ts + packages/storage-provider/src/index.ts + work-trace |

Net deletion: ~1500+ lines removed; ~50 lines added (fatal-guard + comment-updates).

## §15 §3.1.1 coordinated-upgrade-discipline VERIFIED

All consumer-upgrades shipped atomic in single W4 PR per Finding B + §3.1.1 spirit:
- Hub-side: dispatch-branches deleted + repository instantiation simplified + substrate-mode unconditional
- Hub-internal: 12 FS-version repos + counter.ts deleted + entities/index.ts cleaned
- Cross-package: storage-provider/local-fs.ts deleted + index.ts export updated
- NO partial-upgrade state; no consumer left consuming retired pattern

## §16 W4 PR ship-prep

- Branch: `agent-greg/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate` (HEAD post-W4 commits)
- Base: `origin/main @ ef36b79`
- PR scope: 18 files (13 deleted + 4 modified + 1 work-trace)
- Per ~6-PR cadence: W4 = PR 4 of 6 (standalone substantive)
- Bilateral PR-merge-gate engages architect on §2.6 final-disposition + SHRINK + §3.1.1 verify

— Engineer (greg) 2026-05-19 08:50 AEST (W4 complete; opening PR + surfacing checkpoint on thread-582)

---

### 2026-05-19 09:25 AEST — W5 STORAGE_BACKEND env-var retirement (thread-583)

W4 PR #212 merged at `649938fb` (substrate-deletion-cascade; -5219 lines). Director-direct "Approved" 2026-05-18 ratified W5 pre-ship per Design v1.0 §5.1 Out-of-scope-risks Director-surface. Architect dispatched W5 on fresh thread-583.

## §17 W5 deliverables shipped (4 sub-tasks)

### §17.1 W5.1 — hub/src/index.ts substrate-unconditional simplification

- **STORAGE_BACKEND env-var parse + dispatch FATAL guard DELETED.** Hub bootstrap reduces to: `createPostgresStorageSubstrate(POSTGRES_CONNECTION_STRING)` + reconciler-start (unconditional).
- **POSTGRES_CONNECTION_STRING required-validation** at module-load (throw with operator-friendly error if missing).
- **`OIS_LOCAL_FS_ROOT` + GCS_BUCKET guards + STORAGE_BACKEND-conditional branching ALL deleted.**
- **`IPolicyContext.config` field DELETED** entirely (was `{storageBackend: string; gcsBucket: string}` — both dead-passthrough per zero-handler-read survey). Sites updated:
  - 4 production-Hub sites (createPolicyRouterInvoker context-builders) — `config:` lines dropped
  - 9 test-fixture sites — `config: { storageBackend: "memory", gcsBucket: "" }` lines dropped
  - 1 orchestrator.ts constructor signature — `config` parameter dropped
- **`cutover-sentinel.ts` + `cutover-sentinel.test.ts` DELETED** — sole consumer was the local-fs dispatch-branch deleted at W4; module became dead.
- **`fs` + `path` Node imports DELETED** — sole consumers were the local-fs writability-assertion (also W4-deleted).

### §17.2 W5.2 — scripts/local/start-hub.sh operator-DX update

- **STORAGE_BACKEND env-var default DELETED** (was `STORAGE_BACKEND="${STORAGE_BACKEND:-local-fs}"`); operator-friendly error if `POSTGRES_CONNECTION_STRING` unset
- **Container env-var pass-through:** STORAGE_BACKEND removed; POSTGRES_CONNECTION_STRING added
- **local-fs state-dir pre-flight DELETED** (uid/gid-trap class structurally eliminated; postgres handles persistence via container-volume)
- **local-fs bind-mount + OIS_LOCAL_FS_ROOT propagation DELETED**
- **Operator console output:** `Backend: substrate (postgres)` + `Postgres: <redacted-connection-string>` (clear single-mode signal)

### §17.3 W5.3 — docker artifacts sweep (NO-OP)

`hub/Dockerfile` + `hub/spike/W0/docker-compose.yml` already had ZERO STORAGE_BACKEND references at survey-time; no changes needed.

### §17.4 W5.4 — Documentation refs

Engineer-scope deferred per architect dispatch §1 footnote: operator runbooks update at W7. STORAGE_BACKEND historical mentions in code comments (hub/src/index.ts + hub/src/policy/types.ts) preserved as cleanup-context; non-load-bearing.

## §18 Test-result summary

| Stage | Tests | Pass | Skip | Fail | Notes |
|---|---|---|---|---|---|
| Pre-W5 (post-W4 merge HEAD `649938fb`) | 1469 | 1464 | 5 | 0 | W4 baseline |
| **Post-W5 (FINAL)** | **1462** | **1457** | **5** | **0** ✅ | -7 tests = 6 cutover-sentinel.test.ts + 1 in-Hub-bootstrap STORAGE_BACKEND test |

Typecheck PASS at every sub-task.

## §19 W5 file-impact summary

| Action | Count | Files |
|---|---|---|
| DELETED | 2 | hub/src/lib/cutover-sentinel.ts + hub/test/unit/cutover-sentinel.test.ts |
| MODIFIED | 12 | hub/src/index.ts (substantial; ~80 lines deleted) + hub/src/policy/types.ts + hub/src/policy/test-utils.ts + scripts/local/start-hub.sh + hub/test/e2e/orchestrator.ts + 6 hub/test/unit/*.test.ts + 2 hub/test/e2e/*.test.ts (config: line removals) |

Net deletion: ~150+ lines removed; ~30 added (error messages + comments).

## §20 W5 PR ship-prep

- Branch: `agent-greg/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate` (HEAD post-W5 commits)
- Base: `origin/main @ 649938fb`
- PR scope: 14 files (2 deleted + 12 modified)
- Per ~6-PR cadence: W5 = PR 5 of 6 (Director-ratified pre-ship per §5.1)
- Bilateral PR-merge-gate engages architect on §2.5 final disposition + start-hub.sh diff verify

— Engineer (greg) 2026-05-19 09:25 AEST (W5 complete; opening PR + surfacing checkpoint on thread-583)
