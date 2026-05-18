---
mission: M-Hub-Storage-FS-Retirement-And-MemoryHubStorageSubstrate
mission-anchor: idea-300
companion-trace: docs/traces/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate-work-trace.md (architect-side)
upstream-mission: mission-83 (M-Hub-Storage-Substrate)
engineer-branch: agent-greg/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate (off origin/main @ c00944b)
architect-branch: agent-lily/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate (6 commits ahead; HEAD eb2236d)
phase: Phase 4 Design (round-1 bilateral critique-review)
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
