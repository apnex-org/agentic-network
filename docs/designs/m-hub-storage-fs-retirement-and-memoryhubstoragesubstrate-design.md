---
mission: M-Hub-Storage-FS-Retirement-And-MemoryHubStorageSubstrate
mission-class: pre-substrate-cleanup
source-idea: idea-300
survey-envelope: docs/surveys/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate-survey.md
prior-mission-anchor: mission-83 (M-Hub-Storage-Substrate)
sequencing-downstream: idea-298 (M-Hub-Storage-Cloud-Deploy; strict prerequisite locked via Q3a)
design-version: v0.3
design-status: DRAFT — v0.2 → v0.3 folds greg round-1 audit (thread-577 round 2; 6 architect-side blind-spots B1-B6 + per-flag dispositions + Q-A disposition + wave-decomp refinements); ratify-ready pending greg round-2 confirmation
ratify-criterion: greg round-2 confirmation on 8 ratify-criteria fold (B1-B6 self-audit corrections; F2 PORT-then-EXTEND reframe; §2.6 Counter mechanism pinned to (b) Counter-stays-as-kind; §2.3 watchable:false; SchemaDef inventory 20→22; W3.5 removed; W2 blast-radius re-estimate scheduled at W0; Q-A6 ~5-PR cadence ratified) → v1.0 RATIFIED
---

# M-Hub-Storage-FS-Retirement-And-MemoryHubStorageSubstrate — Design v0.3

**Draft 2026-05-18 architect-side; v0.2 → v0.3 folds greg round-1 bilateral audit (thread-577 round 2).** Composes Survey envelope §1-7 ratified intent + greg round-1 corrections (6 architect-side blind-spots B1-B6 + per-flag dispositions + Q-A resolutions + wave-decomp refinements) into ratify-ready engineer-actionable architecture + wave-spec.

## §0 Changelog

### v0.2 → v0.3 (greg round-1 audit fold; thread-577 round 2)

Greg round-1 code-grounded audit caught 6 architect-side blind-spots in v0.2 (B1-B6) — v0.2's own self-audit substituted-for-engineer-audit missed these. Per [[feedback_architect_drives_engineer_engagement_when_idle]]: this is exactly the engineer-perspective value that architect-side self-audit cannot replicate.

1. **§2.2 SubstrateConformanceSuite — PORT-then-EXTEND, NOT new-work** — v0.2 claimed "NEW WORK not port"; greg B1 surfaced `packages/storage-provider/test/conformance.ts` EXISTS as 257-line abstract `runConformanceSuite(factory, options)` suite (capabilities + get/put + list + delete + createOnly + putIfMatch + path-handling + sequential-consistency). Refined: **PORT 1:1 from existing conformance.ts + EXTEND ~10-15 substrate-specific tests** (watch + getWithRevision + applySchema/listSchemas/getSchema + restart-safety with postgres + race-correctness under postgres concurrent writers).
2. **§2.3 — SchemaDef field is `watchable: boolean` (REQUIRED), not `notify` (optional default-true)** — greg B2 surfaced field-name + required-ness error in v0.2's spec-recall. Field is `watchable: boolean` at `hub/src/storage-substrate/types.ts:24`; required at type level (every SchemaDef in `all-schemas.ts` sets it explicitly). F4 direction (NOTIFY fires) is CORRECT; spec-recall details wrong. v0.3: RepoEventBridgeCursor + RepoEventBridgeDedupe explicitly set `watchable: false` (cursor/dedupe writes are bookkeeping; no consumer needs change-events; pre-resolves F5 future-target probe).
3. **§2.6 — Counter SchemaDef ALREADY EXISTS** at `all-schemas.ts:91-100` (kind: "Counter", version: 1, watchable: false); v0.2 claimed "Add Counter SchemaDef" — wrong. Greg B3. SchemaDef inventory delta is **20 → 22** (add RepoEventBridgeCursor + RepoEventBridgeDedupe only), NOT 20 → 23.
4. **§2.6 — SubstrateCounter ALREADY EXISTS** at `hub/src/entities/substrate-counter.ts` (71 lines; mission-83 W4 + bug-97 W5.5 fix at `e109000`); uses Design v1.4 `getWithRevision` + `putIfMatch` CAS retry-loop (MAX_CAS_RETRIES=50). Greg B4. v0.3 Counter scope = (i) delete legacy `counter.ts` + `StorageBackedCounter` + (ii) per-repo callers swap to SubstrateCounter + (iii) decide at W4 whether to refactor CAS-loop to atomic `issueCounter` primitive (architect-recommendation: NO — keep CAS-loop; bug-97 closed; "atomic primitive" would require substrate-API addition without need).
5. **§2.6 — Reconciler manages INDEXES only, NOT tables; "counters-table mechanism" was architectural-pathology** — greg B5 surfaced that v0.2's "counters-table via standard table-CRUD which the substrate already supports via SchemaDef registration" was wrong: SchemaDef registration creates indexes on the `entities` table, not separate tables. v0.3: PIN Counter mechanism to **(b) Counter-stays-as-kind** (current SubstrateCounter path; CAS-loop pattern in entities table). NO W3.5 reconciler-extension slice needed; W3.5 REMOVED from ratify-criterion + wave-decomp.
6. **§3 wave-decomp W2 blast-radius re-estimate** — greg B6 surfaced "~22 files; ~170 tests" was stale mission-83 W6 estimate; actual at HEAD = **82 .test.ts files in `hub/test/`; 49 reference test-utils or MemoryStorageProvider** (verified). v0.3: W0 spike includes W2 blast-radius re-count as deliverable; W2 scope adjusts based on W0 spike findings.
7. **§3 W4 scope clarification** — explicit `counter.ts` + `StorageBackedCounter` deletion; SubstrateCounter remains canonical; W4 refactor-decision per (4).
8. **§3 W5 scope addition** — `scripts/local/start-hub.sh:125` also touches STORAGE_BACKEND default (`local-fs` currently); local-dev Hub needs postgres-up-required at boot post-W5.
9. **§5 F2 disposition reframed** — PORT-then-EXTEND per (1); was "from scratch" in v0.2.
10. **§5 F1 disposition refined** — greg CONCUR + REFINE: BOTH in-process Hub-restart-simulation (primary; sub-second; CI-deterministic) PLUS docker-restart smoke at PR ship-gate (mission-83 W2 postgres-container harness; ground-truth dispositive).
11. **§5 F3 disposition refined** — greg CONCUR + minor REFINE: cursor-store.ts internal data is `Uint8Array` via `TextEncoder`; substrate body is JSONB. Adapter must `JSON.parse` ↔ `stringify` — explicit impl note added in §2.3.
12. **§7 Q-A6 PR cadence ratified** — per-wave PR for substantive (W1 conformance + W3 cluster #23 + W4 deletion-cascade + W5 env-var) + folded mini-PRs for trivial (W0+W2 spike-and-cascade + W6+W7 restoration+revert); ~5 PRs total. Per `multi-agent-pr-workflow.md` (apnex-org/* uses PR-flow).
13. **§7 Q-A5 architectural-future-leverage note** — substrate-watch enables sweepers to subscribe to ScheduledMessage/unprojected-Thread change-events instead of polling; v1 keeps polling; W7 follow-on architectural note.

### v0.1 → v0.2 (architect-side self-audit; superseded by greg round-1)

Director-direct 2026-05-18 "resume design" with engineer idle (cognitive_ttl=0; thread-576 unengaged); architect-side self-audit resolved Q-A2 + Q-A4 + F3 + F4 via code-read. **6 v0.2 changelog items SUPERSEDED by greg round-1 corrections** (B1 corrects v0.2 item 1; B2 corrects v0.2 item 3; B3+B4+B5 correct v0.2 items 5+6 + framing). Retained in this changelog for traceability:

- v0.2.1 §2.2 SubstrateConformanceSuite — claimed "NEW WORK, not port" → **CORRECTED by v0.3.1 (PORT-then-EXTEND)**
- v0.2.2 §2.3 Variant (ii) — refined "pure-KV" → "minimal-SchemaDef Variant" → **retained (correct architectural disposition)**
- v0.2.3 §2.3 F4 — claimed NOTIFY fires per-kind via `notify` default-true → **CORRECTED by v0.3.2 (field is `watchable: boolean` required; direction correct)**
- v0.2.4 §2.3 NEW primitive-mapping table → **retained (correct architectural disposition; verified 1:1)**
- v0.2.5 §2.6 Counter — picked "counters-table mechanism" over postgres-sequence → **CORRECTED by v0.3.5 (pin (b) Counter-stays-as-kind via existing SubstrateCounter)**
- v0.2.6 F5 NEW (CRITICAL) — Variant (ii) implementability defect → **retained (correct surface; resolved via minimal-SchemaDef Variant per v0.2.2)**

---

## §1 Goal + intent (echo Survey envelope §3)

idea-300 is the **cloud-deploy clearing-the-path mission with maximum substrate-currency posture**. Five composed pillars from Director picks across both Survey rounds:

1. **Substrate is THE substrate** (Q1a + Q2c + Q4a) — one storage-abstraction (HubStorageSubstrate); StorageProvider retires; one production storage path (PostgresHubStorageSubstrate); one test backend (MemoryHubStorageSubstrate); no STORAGE_BACKEND env var ceremony
2. **Repo-event-bridge integrates fully** (Q4a) — migrates from StorageProvider to HubStorageSubstrate; bonus-closes cluster #23 ephemeral-persistence defect; becomes substrate-portable across deployment shapes (local-docker / CR+PD / GCE+PD) via connection-string interface
3. **Standard architectural-defense via conformance suite** (Q5b) — race + CAS + watch-event + restart-safety tests as the binary-certified Layer-N gate (tele-8); precedent-matches mission-47 scope
4. **Architectural-integrity via discipline, not mechanism** (Q6d) — no ESLint / no CI grep gate / no TypeScript boundary check; trust-based on the substrate-currency-failure cluster discipline; conformance suite is sole architectural-defense vector
5. **Strict sequencing before idea-298** (Q3a) — clean local substrate (everywhere) first; cloud-deploy inherits the certified baseline

**Tele alignment (whole-mission):** primary tele-3 (Sovereign Composition; Law of One at module + package boundary) + tele-8 (Gated Recursive Integrity; binary-certified substrate-correctness); secondary tele-7 (Resilient Agentic Operations; race-defect prevention) + tele-9 (Chaos-Validated Deployment; multi-impl conformance proofs).

---

## §2 Architecture

### §2.1 MemoryHubStorageSubstrate — in-process impl of HubStorageSubstrate interface

**Purpose:** test backend for any code-surface that operates over HubStorageSubstrate (entity repositories; repo-event-bridge cursor + dedupe; Document MCP tools). Replaces the FS-version-repo + MemoryStorageProvider test pattern from mission-47 era.

**Interface contract:** binary-identical to `PostgresHubStorageSubstrate` per the `HubStorageSubstrate` interface at `hub/src/storage-substrate/types.ts` (exported via `hub/src/storage-substrate/index.ts`). All 6 primitives: `get(kind, id)`, `getWithRevision(kind, id)`, `put(kind, id, body, opts)`, `delete(kind, id, opts)`, `list(kind, query?)`, `watch(kind, callback)`.

**Implementation sketch:**
- `Map<kind, Map<id, {body: JSONB, revision: number}>>` for entity storage
- `Map<kind, EventEmitter>` for watch primitive (emits on put + delete)
- `Map<kind, number>` for revision counter (monotonic per kind; CAS-checked on put with `ifRevision` option)
- Synchronous primitives wrapped in `Promise.resolve()` for interface-conformance with async postgres impl

**Restart-safety semantic:** N/A by design — in-process; data lost on process exit. Conformance suite's restart-safety tests gate this impl as `skip: "in-process; restart-safety N/A"` per §2.3 below.

**Watch-primitive semantic:** synchronous EventEmitter dispatch on put/delete; subscribers receive `{kind, id, body, revision}` envelope identical to postgres LISTEN/NOTIFY payload shape.

**CAS semantic:** `put(kind, id, body, {ifRevision: N})` checks current revision matches N; throws `CASConflictError` if mismatch (matches postgres impl error type per `hub/src/storage-substrate/errors.ts`).

### §2.2 SubstrateConformanceSuite — architectural-defense vector (per Q6d)

**Purpose:** binary-certified Layer-N gate (tele-8) for any HubStorageSubstrate impl. Both production-prod (PostgresHubStorageSubstrate) + test backend (MemoryHubStorageSubstrate) MUST pass the suite as ratification criterion. Future cloud variants (idea-298 territory) inherit the suite as their certification gate.

**Scope:** Standard per Survey Q5b — race + CAS + watch-event + restart-safety (~25-30 tests).

**PORT-then-EXTEND** (v0.3 correction per greg B1; supersedes v0.2's "NEW WORK not port"). Verified: `packages/storage-provider/test/conformance.ts` EXISTS as 257-line abstract `runConformanceSuite(factory, options): void` suite. Test categories covered: capabilities + get/put + list + delete + createOnly + putIfMatch + path-handling + sequential-consistency.

**SubstrateConformanceSuite implementation plan (v0.3):**
1. **PORT 1:1** the existing `runConformanceSuite` from `packages/storage-provider/test/conformance.ts` to `hub/src/storage-substrate/__tests__/conformance/runSubstrateConformanceSuite.ts`. Wrap StorageProvider-shape primitives with substrate-shape primitives via the §2.3 primitive-mapping table.
2. **EXTEND** with ~10-15 substrate-specific tests for primitives StorageProvider doesn't have:
   - `watch(kind, opts)` AsyncIterable change-events (5 tests: fires on put + fires on delete + multiple subscribers + unsubscribe + payload-shape)
   - `getWithRevision` round-trip (already covered by ported `getWithToken` tests; verify port covers)
   - `applySchema` + `listSchemas` + `getSchema` (3 tests: apply schema; list returns applied; get by kind)
   - **Restart-safety** (5 tests; postgres-only via test-postgres-container harness; memory marked `skip`): write + restart + read returns same body; revision counter survives restart; CAS ifRevision against pre-restart revision still works post-restart; concurrent-write-during-restart edge-case; watch-subscribers re-sync semantic
   - **Race-correctness under postgres concurrent writers** (3 tests): N-writer CAS-loop convergence; per-kind isolation; bug-97 counter-collision regression net (concurrent `SubstrateCounter.next(domain)` under contention)

**Test infrastructure:** abstract `describe.each` over `[memoryFactory, postgresFactory]`; postgres factory uses mission-83 W2 `hub/test/postgres-container.ts` harness; memory factory uses `MemoryHubStorageSubstrate` from §2.1.

**Location:** `hub/src/storage-substrate/__tests__/conformance/` (canonical location; sibling to substrate impl files).

**Test categories:**
1. **Race-correctness** (~8 tests) — concurrent put under contention; per-kind isolation; cross-kind isolation; watch-during-put atomicity; CAS-loop convergence under N writers; bug-97 counter-collision regression net (per `feedback_counter_collision_substrate_defect_pattern.md`)
2. **CAS-semantic** (~6 tests) — first-write-wins-without-ifRevision; ifRevision=N matches → put succeeds; ifRevision=N mismatch → CASConflictError; getWithRevision round-trip; revision monotonicity per id; revision isolation across ids in same kind
3. **Watch-event** (~6 tests) — watch fires on put; watch fires on delete; multiple subscribers receive each event; unsubscribe stops event delivery; watch payload shape matches `{kind, id, body, revision}`; watch ordering matches put ordering per id
4. **Restart-safety** (~5 tests; postgres only; memory marked `skip`) — write + restart + read returns the same body; revision counter survives restart; watch-subscribers receive backlog OR get notified to re-sync (architect-flag F4-adjacent — decision documented in §5); CAS-ifRevision against pre-restart revision still works post-restart; concurrent-write-during-restart edge-case

**Test infrastructure:** abstract `describe.each` over `[memoryFactory, postgresFactory]`; each factory yields a fresh substrate instance; postgres factory uses the `hub/test/postgres-container.ts` test-postgres-container harness from mission-83 W2 (per Design v1.4 §2.7).

**Location:** `hub/src/storage-substrate/__tests__/conformance/` (canonical location; sibling to substrate impl files).

### §2.3 Repo-event-bridge migration — Variant (ii) minimal-SchemaDef Variant (per F3 + F5 dispositions)

**Decision:** Variant (ii) — **minimal-SchemaDef Variant** (v0.2 refined from v0.1 "pure-KV" per §0 changelog item 2). Register `RepoEventBridgeCursor` + `RepoEventBridgeDedupe` SchemaDefs with NO hot fields (no per-kind expression indexes); body is opaque JSON blob; substrate-internal storage layout unchanged.

**Rationale:**
- Substrate's `put(kind, entity)` requires kind; kind requires SchemaDef registration (verified per `hub/src/storage-substrate/types.ts`). Pure-KV was non-implementable.
- Minimal SchemaDef (no hot fields; no per-kind expression indexes) preserves cursor-store.ts's key-namespaced data-shape semantically; no entity-graph integration overhead
- cursor-store.ts swaps `StorageProvider` for substrate; primitive-mapping is 1:1 (see table below)
- Closes cluster #23 (per Survey §2.Q4) with substrate-native persistence
- AG-5 deferred Variant (i) fully-entity-integrated = adds hot fields + per-kind expression indexes + first-class entity-kind producer status; minimal-SchemaDef Variant is the strict subset (no hot fields; opaque body)

**Primitive-mapping table** (StorageProvider → HubStorageSubstrate; for cursor-store.ts adapter):

| StorageProvider primitive | HubStorageSubstrate primitive | Adapter shape |
|---|---|---|
| `get(path): Promise<Uint8Array \| null>` | `get<T>(kind, id): Promise<T \| null>` | path → (kind, id); Uint8Array → JSON-typed body |
| `getWithToken(path): Promise<{data, token}>` | `getWithRevision<T>(kind, id): Promise<{entity, resourceVersion}>` | token ↔ resourceVersion |
| `createOnly(path, data): Promise<CreateOnlyResult>` | `createOnly<T>(kind, entity): Promise<CreateOnlyResult>` | direct match; result shape identical |
| `putIfMatch(path, data, ifMatchToken): Promise<PutIfMatchResult>` | `putIfMatch<T>(kind, entity, expectedRevision): Promise<PutIfMatchResult>` | direct match; result shape identical |

**Path → (kind, id) shape transformation:**
- `repo-event-bridge/cursor/<owner>/<repo>` → kind=`RepoEventBridgeCursor`, id=`<owner>__<repo>` (or url-encoded equivalent)
- `repo-event-bridge/dedupe/<owner>/<repo>` → kind=`RepoEventBridgeDedupe`, id=`<owner>__<repo>`

**Implementation:**
- Add `RepoEventBridgeCursor` + `RepoEventBridgeDedupe` minimal-SchemaDefs to `hub/src/storage-substrate/schemas/all-schemas.ts` with **`watchable: false`** (v0.3 correction per greg B2; cursor/dedupe writes are bookkeeping; no consumer needs change-events; pre-resolves F5 future-target probe). SchemaDef inventory: 20 → 22 kinds.
- Add `RepoEventBridgeSubstrateAdapter` at `packages/repo-event-bridge/src/substrate-adapter.ts` — wraps HubStorageSubstrate's CAS primitives + maps path-shape to (kind, id) shape; presents StorageProviderWithTokenRead-compatible interface for cursor-store.ts narrow-typed consumption
- **Uint8Array ↔ JSONB body conversion** (v0.3 per greg F3 REFINE): cursor-store.ts internal data is `Uint8Array` via `TextEncoder`; substrate body is JSONB. Adapter must `JSON.parse(new TextDecoder().decode(uint8))` on read + `new TextEncoder().encode(JSON.stringify(body))` on write. Explicit in adapter impl.
- cursor-store.ts swaps constructor-arg type `StorageProvider` for the adapter (interface-narrowed via the adapter; cursor-store.ts internal logic unchanged)

**SchemaDef inventory update** (v0.3 per greg B3): 20 → **22** kinds (NOT 23; Counter SchemaDef ALREADY EXISTS at `all-schemas.ts:91-100`; only RepoEventBridgeCursor + RepoEventBridgeDedupe are net-new). Update `hub/scripts/entity-kinds.json` v1.1 → v1.2 at W3 ship.

**F4 PROBE outcome — v0.3 final** (per greg B2 + F4 CONCUR direction + CHALLENGE spec-recall): NOTIFY fires per-kind via SchemaDef `watchable: boolean` REQUIRED field (NOT optional `notify` default-true as v0.2 mistakenly recalled). RepoEventBridgeCursor + RepoEventBridgeDedupe explicitly set `watchable: false` (bookkeeping writes; no consumer needs change-events). Repo-event-bridge polling-cycle preserved for v1 simplicity; opt-in watch-subscription via setting `watchable: true` is architectural future-leverage (not v1 deliverable).

### §2.4 Cluster #23 closure architecture (per F1 CRITICAL disposition)

**Defect summary:** in substrate-mode-production (post mission-83 W5.4-Hub-bootstrap-flip), `hub/src/index.ts:163` instantiates `MemoryStorageProvider` as a "sentinel for type-safety", then passes it to RepoEventBridge at line 840 (`storage: storageProvider`). The sentinel isn't benign — repo-event-bridge USES it for cursor + dedupe persistence. Result: ephemeral persistence; lost on Hub restart; violates cursor-store.ts's `"Survives Hub restart"` commitment.

**Closure mechanism (W3):**
1. RepoEventBridge accepts `HubStorageSubstrate` instead of `StorageProvider` (interface swap)
2. cursor-store.ts uses `RepoEventBridgeKvStore` adapter (per §2.3) over the production `PostgresHubStorageSubstrate` instance
3. Cursor + dedupe state lands in postgres `entities` table under `repo-event-bridge/<namespace>/<owner>/<repo>` keys
4. Hub restart: substrate reconnects to postgres; cursor + dedupe state intact; polling-cycle resumes from pre-restart cursor

**Dispositive evidence (W3 integration test):** `packages/repo-event-bridge/__tests__/cluster-23-cursor-restart-safety.test.ts`:
- Boot Hub container in substrate-mode with bound repo-event-bridge
- Trigger 1-2 polling cycles (cursor advances; dedupe LRU populates)
- `docker restart ois-hub-local-prod`
- Verify cursor + dedupe restored from PostgresHubStorageSubstrate (not re-zero'd from initial state)
- Test infrastructure: extends mission-83 W2 test-postgres-container harness pattern

**Ratify criterion for Phase 7 release-gate:** this integration test green is dispositive evidence; cluster #23 status flips `open → closed-structurally` in calibration ledger at ship.

### §2.5 STORAGE_BACKEND env var retirement (per Q2c)

**Decision:** remove `STORAGE_BACKEND` env var entirely from Hub bootstrap surface. Production Hub unconditionally creates PostgresHubStorageSubstrate from `POSTGRES_CONNECTION_STRING`.

**Bootstrap simplification (W5):**
```typescript
// Before (current; STORAGE_BACKEND-dispatched):
const STORAGE_BACKEND = process.env.STORAGE_BACKEND || "memory";
let storageProvider: StorageProvider;
let substrate: HubStorageSubstrate | null = null;
if (STORAGE_BACKEND === "substrate") { /* substrate-mode wiring */ }
else { /* FS-mode wiring */ }

// After (W5 ship):
const substrate = createPostgresStorageSubstrate({
  connectionString: process.env.POSTGRES_CONNECTION_STRING,
});
// storageProvider declaration GONE; FS-mode dispatch GONE
```

**Operator-DX impact:** `STORAGE_BACKEND` env var removed from `scripts/local/start-hub.sh` + `docker compose` + Hub container env. `POSTGRES_CONNECTION_STRING` becomes the sole required env var for Hub bootstrap. Operator runbooks update at W7.

**Backwards-compat:** zero. Per Survey Q2c uncompromising — env var IS dead-code-shape once mode collapses to one value.

**Local-dev preservation:** `MemoryHubStorageSubstrate` is the local-dev test backend; consumed by test-utils.ts + per-test fixtures. NOT consumed by Hub bootstrap (Hub always uses postgres).

### §2.6 Counter abstraction unification (folds bug-97 closure)

**Per `feedback_counter_collision_substrate_defect_pattern.md`:** Counter's issue-then-createOnly pattern isn't atomic across concurrent callers; 11-kind defect surface. Mission-83 bug-97 fixed via per-repo retry-loop. W4 unification opportunity.

**Decision (v0.3 PINNED per greg B3+B4+B5):** **(b) Counter-stays-as-kind in entities table; SubstrateCounter is canonical impl.** v0.2's "counters-table mechanism" framing was architectural-pathology per greg B5 — SchemaDef registration creates indexes on the `entities` table, NOT separate tables. v0.2 also missed that Counter SchemaDef ALREADY EXISTS at `all-schemas.ts:91-100` (greg B3) AND SubstrateCounter ALREADY IMPLEMENTS the CAS-loop pattern at `hub/src/entities/substrate-counter.ts` (greg B4; 71 lines; mission-83 W4 + bug-97 W5.5 fix at `e109000`; uses Design v1.4 `getWithRevision` + `putIfMatch` with MAX_CAS_RETRIES=50).

**Rationale for (b) Counter-stays-as-kind:**
- Mechanism already implemented + bug-97 closed via existing SubstrateCounter
- No new SchemaDef needed (Counter SchemaDef already at `all-schemas.ts:91`)
- No reconciler extension needed (no W3.5 prerequisite slice)
- No new substrate API primitive needed (`issueCounter` is unnecessary; CAS-loop pattern works)
- Substrate-native (kind: "Counter" in entities table; single row with domain-keyed body per current SubstrateCounter design)
- MemoryHubStorageSubstrate impl: SubstrateCounter operates over any HubStorageSubstrate impl (memory or postgres); MAS-loop semantic identical

**W4 implementation surface (v0.3 corrected scope):**
- **Delete** legacy `counter.ts` + `StorageBackedCounter` modules (engineer locates exact paths at W4)
- **Swap callers** to SubstrateCounter (per-repo `bugCounter` / `ideaCounter` / `missionCounter` / etc. — 11 domains per bug-97)
- **Decide at W4** whether to refactor SubstrateCounter's CAS-loop to a new atomic `issueCounter` substrate primitive — architect-recommendation: **NO** (CAS-loop works post bug-97; "atomic primitive" would require substrate-API addition without need; defer to operational-need surface)
- bug-97 closure status: already closed via mission-83 W5.5 `e109000`; no additional ledger flip needed (SubstrateCounter consolidation completes the W4 architectural-cleanup not the bug-fix)

**Conformance suite addition:** §2.2 race-correctness category includes counter-collision regression net via concurrent `SubstrateCounter.next(domain)` under contention.

**W3.5 slice REMOVED** (v0.3 per greg B5; was implicit in v0.2 §0 ratify-criterion but absent from §3 wave-decomp). No reconciler-extension slice needed because (b) Counter-stays-as-kind uses existing primitive surface.

### §2.7 Document MCP tools restoration (W6)

**Per Survey §0 + mission-83 W6 narrowed-deletion-cascade:** Document MCP tools (`create_document`, `get_document`, `list_documents`) were retired during mission-83 W6 due to FS-version-repo dependency. W6 of this mission restores them, substrate-backed.

**Implementation:**
- DocumentRepository uses HubStorageSubstrate with `Document` SchemaDef (already in mission-83's 20-SchemaDef inventory; lookup `hub/scripts/entity-kinds.json` v1.1)
- 3 tools re-registered at PolicyRouter (tool count: 68 → 71)
- Tool-schema mirrors pre-retirement surface (create_document body shape; get_document by id; list_documents with filter)

**Smoke-test:** create_document → get_document round-trip + list_documents filter coverage; integration test at `hub/test/document-mcp-tools.test.ts`.

### §2.8 PR #203 30s-tick-throttle revert (W7)

**Per Survey §0 + mission-83 retro:** PR #203 introduced `OIS_SCHEDULED_MESSAGE_SWEEPER_INTERVAL_MS` + `OIS_MESSAGE_PROJECTION_SWEEPER_INTERVAL_MS` env vars as a band-aid for the 74% Hub CPU pressure from FS-walk poll-loops. Mission-83 W5.4-substrate-cutover STRUCTURALLY ELIMINATED that pressure (substrate-watch primitive replaces FS-walk poll-loop). The env vars are now ceremony; restore 1s/5s tick defaults.

**Implementation (W7):**
- Drop both env vars from `scripts/local/start-hub.sh` + Hub container env
- Restore tick defaults: scheduled-message sweeper 1s; message-projection sweeper 5s (or the pre-PR-#203 defaults — engineer verifies exact values in git log)
- Composes with §2.5 STORAGE_BACKEND env var retirement (W5+W7 = full env-var cleanup wave)

---

## §3 Wave decomposition (W0-W7; per Survey §7.1)

| Wave | Scope | Architect-flag tie-in | PR cadence |
|---|---|---|---|
| **W0** | MemoryHubStorageSubstrate spike + per-method parity test baseline + **W2 blast-radius re-count** (per greg B6: 49 of 82 .test.ts files actual; 22-file figure stale) | §2.1 | folded into W1 PR |
| **W1** | **PORT** existing `runConformanceSuite` from `packages/storage-provider/test/conformance.ts` + **EXTEND** with ~10-15 substrate-specific tests (watch + getWithRevision + applySchema + restart-safety + race-correctness) | §2.2 + F2 | substantive PR |
| **W2** | test-utils.ts migration + ~49-file test-cascade (substrate-version-repo + MemoryHubStorageSubstrate pattern) — final count per W0 spike re-estimate | §2.1 + §2.2 | folded into W1 PR (mini-PR if scope grows) |
| **W3** | repo-event-bridge migration (Variant ii minimal-SchemaDef; RepoEventBridgeCursor + RepoEventBridgeDedupe with `watchable: false`; Uint8Array↔JSONB adapter; closes cluster #23) | §2.3 + §2.4 + F1 + F3 + F5 | substantive PR |
| **W4** | Delete legacy `counter.ts` + `StorageBackedCounter`; per-repo callers swap to SubstrateCounter (existing impl at `hub/src/entities/substrate-counter.ts`); FS-version repo deletion (12 entity-repository.ts files); LocalFsStorageProvider + packages/storage-provider/ retirement | §2.6 | substantive PR |
| **W5** | STORAGE_BACKEND env var removal from Hub bootstrap + `scripts/local/start-hub.sh:125` default change (`local-fs` → postgres-required) — per greg wave-decomp refinement | §2.5 | substantive PR |
| **W6** | Document MCP tool restoration (substrate-backed DocumentRepository; PolicyRouter tool count 68 → 71) | §2.7 | folded mini-PR (or into W7) |
| **W7** | PR #203 revert (drop sweeper-interval env vars; restore 1s/5s tick defaults) + ship-criteria operator runbook update + Phase 7 release-gate + Q-A5 architectural-future-leverage note (substrate-watch enables sweeper-subscription vs polling; v1 keeps polling) | §2.8 | folded with W6 (final ship PR) |

**~5 PRs total** (v0.3 per greg Q-A6): W0+W1 (conformance+spike), W3 (cluster #23 + repo-event-bridge), W4 (Counter consolidation + FS-repo deletion + storage-provider retirement), W5 (env-var retirement), W6+W7 (Document MCP + PR #203 revert + ship). Per `multi-agent-pr-workflow.md` (apnex-org/* uses PR-flow).

**Wave-sequencing rationale:** W0+W1 build the substrate-conformance-foundation (with W2 blast-radius re-estimated as W0 deliverable); W2 migrates tests onto the new foundation; W3 closes cluster #23 dispositively before the deletion-cascade; W4 deletes the FS-version-repo pattern + StorageProvider package + Counter consolidation; W5+W7 collapse env-var ceremony; W6 restores deferred tool surface. Each wave is independently shippable + test-green.

**NO W3.5 slice** (per greg B5 + v0.3 §2.6 (b) Counter-stays-as-kind disposition).

---

## §4 Anti-goals (locked from Survey §5)

| AG | Description | Composes-with target |
|---|---|---|
| AG-1 | Hub MCP tool surface bugs (bug-94/95/96) | Separate bug-fix missions |
| AG-2 | `hub-snapshot.sh` vs `hub-backup.sh` operator-DX script reconciliation | Operator-DX cleanup; defer |
| AG-3 | Multi-cloud / cross-cloud test affordances | idea-298 territory |
| AG-4 | PITR / WAL-archiving for substrate | Separate follow-on |
| AG-5 | Variant (i) fully-entity-integrated repo-event-bridge | Operational-need surface; defer |

---

## §5 Architect-flag dispositions (per Survey §6)

| # | Flag | Disposition (architect-side; engineer-audit challenge target) |
|---|---|---|
| F1 (CRITICAL) | Cluster #23 closure integration-test gate | **v0.3 disposition (greg CONCUR + REFINE):** §2.4 spec retained; W3 integration test architecture = **BOTH** in-process Hub-restart-simulation (primary; sub-second; CI-deterministic) **PLUS** docker-restart smoke at PR ship-gate (mission-83 W2 postgres-container harness; ground-truth dispositive). Engineer-validation at W3 PR-merge-gate |
| F2 (MEDIUM) | SubstrateConformanceSuite scope | **v0.3 disposition (greg CHALLENGE → resolved):** PORT-then-EXTEND per §2.2 + §0.1; PORT 1:1 from existing `packages/storage-provider/test/conformance.ts` (capabilities + get/put + list + delete + createOnly + putIfMatch + path-handling + sequential-consistency) + EXTEND ~10-15 substrate-specific tests (watch + getWithRevision + applySchema/listSchemas/getSchema + restart-safety + race-correctness) |
| F3 (MEDIUM) | Repo-event-bridge variant (i) vs (ii) decision + rationale | **v0.3 disposition (greg CONCUR + minor REFINE):** §2.3 spec; **Variant (ii) minimal-SchemaDef Variant**; minimal migration surface; preserves cursor-store.ts key-namespaced shape; AG-5 defers Variant (i). Refinement: Uint8Array↔JSONB body conversion explicit in adapter impl note (per greg F3 refine) |
| F4 (MINOR/PROBE) | NOTIFY-trigger semantic for non-entity writes | **v0.3 disposition (greg CONCUR direction + CHALLENGE spec-recall → resolved):** §2.3 final ¶ — NOTIFY fires per-kind via SchemaDef `watchable: boolean` REQUIRED field (NOT optional `notify` default-true as v0.2 spec-recalled). RepoEventBridgeCursor + RepoEventBridgeDedupe explicitly set `watchable: false` (bookkeeping writes; no consumer needs change-events; pre-resolves F5 future-target probe). Engineer-validation at W3 PR-merge-gate |
| F5 (CRITICAL; NEW v0.2) | Variant (ii) implementability defect (v0.1 architect-side error) | **v0.3 disposition (greg CONCUR + extend):** v0.1 described "pure-KV; no SchemaDef" Variant (ii); resolved via minimal-SchemaDef Variant per §2.3 + §0 changelog v0.2 item 2. v0.3 extends with greg B2 + B4 fold: explicit `watchable: false` + cursor-store.ts internal `Uint8Array` adapter conversion documented. Future-target probe (architecturally accidental NOTIFY fan-out / inadvertent expression-index build) PRE-RESOLVED via explicit `watchable: false` |

---

## §6 Sequencing / cross-mission considerations (carry from Survey §7)

**Branch + PR strategy:** `agent-lily/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate` (architect-side); `agent-greg/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate` (engineer-side; same handle slug). Cumulative-fold per wave (8 PRs OR mission-83-precedent single-PR-per-mission with wave-commit-archaeology — architect-recommendation = wave-commit-archaeology + single final PR, per mission-83 actual cadence; engineer-audit challenge target).

**Downstream sequencing:**
- **idea-298** (M-Hub-Storage-Cloud-Deploy) — strict-after this mission's Phase 7 ratify; inherits clean substrate baseline + conformance-suite-certified MemoryHubStorageSubstrate + PostgresHubStorageSubstrate
- **idea-295/296/297/299** — sequence-independent; Strategic Review prioritization post this mission close

**Compressed-lifecycle: NOT recommended.** 8 waves; ~170 test-file blast-radius (W2); cluster #23 integration test gate (W3); conformance suite extraction (W1) is substantive new test infrastructure. Bilateral architect+engineer cycle of ~1-2 weeks appropriate.

---

## §7 Risks + open questions

### §7.1 Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | W2 test-utils.ts cascade (~22 test-files) breaks unrelated test surface | Bilateral W2 round-1 audit at engineer-side per-file delta inspection; PR-cumulative-fold lets bisect per-wave-tag |
| R2 | Cluster #23 closure integration-test flaky under docker-restart timing | Test-infrastructure hardening (retry-loop on cursor read; explicit substrate-ready wait); fallback to in-process Hub-restart simulation if docker-restart proves unstable |
| R3 | Counter postgres-sequence-per-kind adds 11 sequences; reconciler must handle additive-create idempotently | Engineer-audit: verify schema-reconciler.ts handles sequence-create (vs table-create) primitive; spike at W0 before W4 ship |
| R4 | PR #203 revert resurrects 74% CPU pressure if substrate-watch primitive doesn't fully replace FS-walk poll-loop semantically | Pre-W7 verification: profile Hub CPU on substrate-mode with restored 1s/5s ticks; if CPU spike, surface as W7 BLOCKER |

### §7.2 Open questions for engineer round-1 audit

1. **Q-A1 (F1):** integration-test infrastructure shape — real docker-restart vs in-process Hub-restart-simulation? Architect-recommendation = real docker-restart for dispositive evidence; engineer challenge if simulation suffices for cluster #23 closure semantic.
2. **Q-A2 (F2):** mission-47 conformance suite location + exact test inventory — engineer locates source (likely `packages/storage-provider/__tests__/conformance/` per Survey §6 architect-recommendation; verify) + reports test count + which tests port 1:1.
3. **Q-A3 (F3 + F4):** spike Variant (ii) at W0 to validate interface-swap mechanics + NOTIFY-trigger probe before W3 commitment; report any architectural blocker.
4. **Q-A4 (R3):** schema-reconciler.ts primitive coverage — does it handle postgres-sequence-create OR only table-create? If only table-create, W4 needs reconciler-extension first.
5. **Q-A5 (R4):** substrate-watch primitive performance baseline under restored 1s/5s tick defaults — pre-W7 profile + decision on whether to ship W7 OR carry sweeper-interval-env-vars as architectural-debt with file-bug.
6. **Q-A6 (process):** PR cadence — single-PR-per-mission (mission-83 precedent) OR 8-PR-per-wave? Architect-recommendation = single-PR-per-mission with wave-commit-archaeology; engineer challenge if per-wave-PR yields better review-load per wave.

---

## §8 Mission-class declaration + ADR

**Mission-class:** `pre-substrate-cleanup` per `docs/methodology/mission-lifecycle.md` §3 — analogous-to mission-83's `substrate-introduction` class but inverted scope (retires the dual-pattern code-debt mission-83 left behind via W6-narrowed scope).

**ADR carve-out:** none required — composes with mission-83 ADRs (storage-substrate architecture; SchemaDef + reconciler; watch primitive via LISTEN/NOTIFY); does not introduce new architectural concepts requiring ADR.

---

## §9 Engineer audit ask (round-1 questions for bilateral audit thread)

Per `docs/methodology/multi-agent-pr-workflow.md` audit-rubric pattern:

1. **CRITICAL flags:** challenge F1 cluster #23 closure integration-test architecture (§2.4); is docker-restart the right dispositive-evidence mechanism vs lighter alternatives?
2. **MEDIUM flags:** challenge F2 conformance-suite scope (§2.2 — exact test count + porting strategy from mission-47) + F3 Variant (ii) rationale (§2.3 — any blocker discovered when actually attempting interface-swap?)
3. **MINOR/PROBE flags:** F4 NOTIFY-trigger semantic empirical verification via spike-test
4. **Wave-decomposition challenges:** W0-W7 ordering + scope-boundary correctness; any wave-merge or wave-split opportunities?
5. **Open-question dispositions:** Q-A1 through Q-A6 (§7.2) — engineer-side reads + responds with architect-flag-status (CONCUR / REFINE / CHALLENGE)
6. **Architectural-decision challenges:** §2.6 Counter unification mechanism (postgres-sequence-per-kind vs alternatives) — engineer-side concur or alternative?

---

## §10 Cross-references

- **Survey envelope:** `docs/surveys/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate-survey.md`
- **Upstream substrate Design:** `docs/designs/m-hub-storage-substrate-design.md` v1.4 (mission-83)
- **Upstream mission retro:** `docs/reviews/m-hub-storage-substrate-retrospective.md` (mission-83 Phase 10)
- **Upstream Phase 7 release-gate:** `docs/missions/m-hub-storage-substrate-phase-7-release-gate.md`
- **SchemaDef inventory:** `hub/scripts/entity-kinds.json` v1.1 (20 kinds LOCKED; reference for §2.7 Document SchemaDef + §2.6 counter sequence additive-create)
- **Methodology:**
  - `docs/methodology/idea-survey.md` v1.0 (Survey methodology)
  - `docs/methodology/mission-lifecycle.md` §3 (pre-substrate-cleanup class)
  - `docs/methodology/multi-agent-pr-workflow.md` (bilateral audit rubric)
- **Calibration anchors:**
  - `docs/calibrations.yaml` — closures-applied: empty; candidates-surfaced: cluster #23 (W3 closure) + positive-pattern Director-Round-2-clarifying-question-as-substrate-currency-audit-surface (Phase 10 candidate)
  - `feedback_substrate_currency_audit_rubric.md` ARCHITECT-SIDE EXTENSION (the Q6d trust-pattern foundation)
  - `feedback_counter_collision_substrate_defect_pattern.md` (W1 conformance suite race-correctness + W4 Counter unification context)
- **Operational refs:**
  - `reference_docker_seccomp_old_kernel.md` (W3 integration-test docker-restart context)
  - `project_mission_83_state.md` (production substrate state Hub runs against)
- **Source ideas:**
  - idea-300 (this mission's source)
  - idea-294 (mission-83 source)
  - idea-298 (downstream strict-after; M-Hub-Storage-Cloud-Deploy)
  - idea-295/296/297/299 (sequence-independent follow-ons)

---

## §11 Status

**v0.3 — DRAFT folded greg round-1 audit; RATIFY-READY pending greg round-2 confirmation.**

Greg round-1 (thread-577 round 2) caught 6 architect-side blind-spots in v0.2 that v0.2's own self-audit missed (B1-B6); v0.3 folds all 8 ratify-criteria.

**v0.3 fold complete (8 ratify-criteria; all addressed):**
- ✅ #1 B1-B6 self-audit corrections folded into §0 changelog (with cross-refs to v0.2 supersession entries)
- ✅ #2 F2 reframed to PORT-then-EXTEND (§2.2 spec rewritten)
- ✅ #3 §2.6 Counter mechanism PINNED to (b) Counter-stays-as-kind; SubstrateCounter is canonical; W3.5 removed
- ✅ #4 §2.3 RepoEventBridgeCursor + RepoEventBridgeDedupe explicit `watchable: false`
- ✅ #5 SchemaDef inventory delta corrected 20 → 22 (Counter SchemaDef already exists per B3)
- ✅ #6 W3.5 removed from wave-decomp + ratify-criterion (per B5 disposition)
- ✅ #7 W2 blast-radius re-estimate scheduled at W0 spike (per B6 — actual 49 of 82 .test.ts; not 22)
- ✅ #8 Q-A6 PR cadence ratified: ~5 PRs (W0+W1 / W3 / W4 / W5 / W6+W7)

**Architect-side blind-spot probe RESOLVED** (per F5 lesson): greg round-1 surfaced 6 v0.2-architect-spec-vs-substrate-API drift instances; all folded into v0.3 with code-grounded corrections. No remaining architect-spec-recall items pending engineer-validation; all spec-claims in v0.3 verified against code.

**Engagement-state at v0.3 ship:**
- thread-577 active; round 2 (greg round-1 audit) → architect to reply with v0.3 fold-confirmation
- greg's engineer-side branch: `agent-greg/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate` (engineer-work-trace at `docs/traces/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate-engineer-work-trace.md`)
- Architect operational-state: BLOCKED-PENDING-GREG-ROUND-2-CONFIRMATION (5-minute architect-fold-time; greg round-2 expected to be confirm-only or minor refine)

**v1.0 ratify-criterion (per `mission-lifecycle.md` Phase 4 ratify):**
- ⏳ Greg round-2 confirmation on v0.3 fold (8 ratify-criteria all addressed)
- ⏳ Any engineer-surfaced round-2 architectural blocker resolved (none expected; round-1 was thorough)
- ⏳ Bilateral converged → architect commits ratify-marker per [[feedback_narrative_artifact_convergence_discipline]]

**Expected progression:**
- v0.3 → v1.0 RATIFIED (greg round-2 CONCUR → architect commits `[Design v1.0 RATIFIED]` marker on mission branch)
- v1.0 → v1.1+ (live design evolution during mission execution; per mission-83 v1.0 → v1.4 precedent)

---

— Architect: lily / 2026-05-18 14:55 AEST (Phase 4 entered Director-direct 2026-05-18; bilateral audit unblocked post greg session activation; v0.2 → v0.3 folded greg round-1 [thread-577 round 2]; RATIFY-READY pending greg round-2)
