---
mission: M-Hub-Storage-FS-Retirement-And-MemoryHubStorageSubstrate
mission-class: pre-substrate-cleanup
source-idea: idea-300
survey-envelope: docs/surveys/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate-survey.md
prior-mission-anchor: mission-83 (M-Hub-Storage-Substrate)
sequencing-downstream: idea-298 (M-Hub-Storage-Cloud-Deploy; strict prerequisite locked via Q3a)
design-version: v0.2
design-status: DRAFT — architect-side self-audit refined v0.1; engineer-audit-deferred-to-PR-merge-gate per Director-direct 2026-05-18 (greg idle; cognitive_ttl=0; thread-576 active but unengaged)
ratify-criterion: architect-side self-audit converged (Q-A2 + Q-A4 + F3 + F4 architect-resolved via code-read; cluster #23 closure architecture confirmed; F5 NEW surfaced + disposed; reconciler-extension prerequisite W3.5 added) → v1.0 RATIFIED (engineer-audit shifts to W0 PR-merge-gate per Director-direct)
---

# M-Hub-Storage-FS-Retirement-And-MemoryHubStorageSubstrate — Design v0.2

**Draft 2026-05-18 architect-side; v0.2 architect-side self-audit refinement of v0.1.** Composes Survey envelope §1-7 ratified intent + 5-pillar composite into engineer-actionable architecture + wave-spec.

## §0 v0.1 → v0.2 changelog (architect-side self-audit)

Director-direct 2026-05-18 "resume design" with engineer idle (cognitive_ttl=0; thread-576 unengaged). Architect-side self-audit resolved Q-A2 + Q-A4 + F3 + F4 via code-read; surfaced architectural-defects in v0.1 + folded fixes:

1. **§2.2 SubstrateConformanceSuite — NEW WORK, not port from mission-47** — v0.1 claimed "mirrors mission-47 StorageProvider conformance suite scope precedent (~25-30 tests)"; verified there is NO formal abstract conformance suite at `packages/storage-provider/test/` (just per-impl `memory.test.ts` + `local-fs.test.ts`). Refined: design abstract suite from scratch; Survey's "Standard scope" intent still applies (race + CAS + watch-event + restart-safety; ~25-30 tests).
2. **§2.3 Variant (ii) — minimal-SchemaDef REQUIRED; not pure-KV as v0.1 described** — substrate's `put(kind, entity)` requires kind; kind requires SchemaDef registration via reconciler. Refined Variant (ii) name to "minimal-SchemaDef Variant"; register `RepoEventBridgeCursor` + `RepoEventBridgeDedupe` SchemaDefs with NO hot fields (no per-kind expression indexes); body is opaque blob; reconciler treats them as kind-registered but index-free. SchemaDef inventory: 20 → 22 kinds.
3. **§2.3 final ¶ F4 disposition — REVERSED** — v0.1 said "NOTIFY does NOT fire for non-entity writes"; verified per substrate types.ts SchemaDef.notify default=true + per-kind NOTIFY semantic. NOTIFY DOES fire for RepoEventBridgeCursor + RepoEventBridgeDedupe kinds (default behavior). Repo-event-bridge could OPT to consume its own kind's watch primitive (future architectural-leverage; not v1 deliverable).
4. **§2.3 NEW — primitive-mapping table** — substrate primitives (`createOnly` + `putIfMatch` + `getWithRevision`) map 1:1 to StorageProvider primitives (`createOnly` + `putIfMatch` + `getWithToken`). cursor-store.ts interface-swap is nearly 1:1 modulo `(path)` → `(kind, id)` shape transformation.
5. **§2.6 Counter mechanism — schema-reconciler does NOT support CREATE SEQUENCE** — verified reconciler primitive surface is `CREATE INDEX CONCURRENTLY` only. Postgres-sequence-per-kind needs reconciler extension (NEW slice W3.5 prerequisite to W4) OR alternative: dedicated `counters` table with per-kind row + atomic `UPDATE ... RETURNING value+1` (table-CRUD; reconciler-compatible). Refined: pick **alternative — counters-table mechanism** (no reconciler extension; clean within existing primitive surface).
6. **NEW F5 (CRITICAL)** — Variant (ii) implementability defect (v0.1 architect-side error); resolved via minimal-SchemaDef Variant per (2); engineer-audit-future-target.

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

**NEW WORK — not a port** (v0.2 correction; per §0 changelog item 1). `packages/storage-provider/test/` has per-impl test files (`memory.test.ts` + `local-fs.test.ts`) but NO formal abstract conformance suite to port from. SubstrateConformanceSuite is designed from scratch; Survey's "Standard scope" intent applies via test-category coverage targets below.

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
- Add `RepoEventBridgeCursor` + `RepoEventBridgeDedupe` minimal-SchemaDefs to `hub/src/storage-substrate/schemas/all-schemas.ts` (SchemaDef inventory: 20 → 22 kinds)
- Add `RepoEventBridgeSubstrateAdapter` at `packages/repo-event-bridge/src/substrate-adapter.ts` — wraps HubStorageSubstrate's CAS primitives + maps path-shape to (kind, id) shape; presents StorageProviderWithTokenRead-compatible interface for cursor-store.ts narrow-typed consumption
- cursor-store.ts swaps constructor-arg type `StorageProvider` for the adapter (interface-narrowed via the adapter; cursor-store.ts internal logic unchanged)

**SchemaDef inventory update** (v0.2): 20 → 22 kinds. Update `hub/scripts/entity-kinds.json` v1.1 → v1.2 at W3 ship.

**F4 PROBE outcome — REVERSED from v0.1** (per §0 changelog item 3): NOTIFY DOES fire for RepoEventBridgeCursor + RepoEventBridgeDedupe kinds. Per `hub/src/storage-substrate/types.ts` SchemaDef.notify field comment: "Whether to wire a NOTIFY trigger for this kind (default true; substrate-internal-events excluded)." Default behavior = NOTIFY fires per-kind. Repo-event-bridge could OPT to subscribe to its own kind for watch-driven cursor advance (architectural future-leverage; not v1 deliverable; polling-cycle preserved for v1 simplicity).

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

**Decision (v0.2 architect-side refined per §0 changelog item 5):** **counters-table mechanism** — dedicated `counters` table with per-kind row; atomic `UPDATE counters SET value = value + 1 WHERE kind = '<K>' RETURNING value` for issuance. Postgres-sequence-per-kind was the v0.1 architect-recommendation but requires reconciler extension (verified: `hub/src/storage-substrate/schema-reconciler.ts` does `CREATE INDEX CONCURRENTLY` only; no `CREATE SEQUENCE` primitive). Counters-table mechanism uses standard table-CRUD which the substrate already supports via SchemaDef registration.

**Rationale for counters-table over postgres-sequence:**
- No reconciler extension needed (cleaner within existing primitive surface)
- Counter state is queryable + auditable via standard substrate `get` primitive (operator-DX win)
- Atomic via `UPDATE ... RETURNING` (postgres-native row-locking)
- Single `Counter` kind SchemaDef + per-kind row (vs 11 sequences)
- MemoryHubStorageSubstrate impl: `Map<kind, number>` with monotonic-increment + synchronous return (matches postgres semantic)

**Implementation surface (W4):**
- Add `Counter` SchemaDef to `hub/src/storage-substrate/schemas/all-schemas.ts` (SchemaDef inventory becomes 20 → 23 kinds when combined with §2.3 RepoEventBridgeCursor + RepoEventBridgeDedupe)
- HubStorageSubstrate `issueCounter(kind: string): Promise<number>` primitive — postgres impl: atomic `UPDATE counters SET value = value + 1 WHERE kind = $1 RETURNING value` (with initial-row-insert on first call); memory impl: `Map<kind, number>` with `++`
- Per-repo `issueCounter` callers (BugRepository / IdeaRepository / etc. — 11 affected kinds per bug-97) swap from Counter abstraction module to substrate primitive
- Counter abstraction module (`hub/src/lib/counter.ts` or wherever it lives — engineer locates at W4) deletes; per-repo retry-loop pattern removed
- bug-97 closure structural at W4 ship; flips status `open → closed-structurally` in calibration ledger

**Conformance suite addition:** §2.2 race-correctness category includes counter-collision regression net (bug-97 reproducer; concurrent `issueCounter` calls under contention).

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

| Wave | Scope | Architect-flag tie-in |
|---|---|---|
| **W0** | MemoryHubStorageSubstrate spike + per-method parity test baseline | §2.1 |
| **W1** | SubstrateConformanceSuite extraction + Standard scope (race + CAS + watch-event + restart-safety) | §2.2 + F2 |
| **W2** | test-utils.ts migration + 22 test-file cascade (substrate-version-repo + MemoryHubStorageSubstrate pattern) | §2.1 + §2.2 |
| **W3** | repo-event-bridge migration (Variant ii substrate-as-KV-backend; closes cluster #23) | §2.3 + §2.4 + F1 |
| **W4** | FS-version repo deletion (12 entity-repository.ts files) + counter.ts unification + LocalFsStorageProvider + packages/storage-provider/ retirement | §2.6 |
| **W5** | STORAGE_BACKEND env var removal + Hub bootstrap simplification | §2.5 |
| **W6** | Document MCP tool restoration (substrate-backed DocumentRepository; PolicyRouter tool count 68 → 71) | §2.7 |
| **W7** | PR #203 revert (drop sweeper-interval env vars; restore 1s/5s tick defaults) + ship-criteria operator runbook update + Phase 7 release-gate | §2.8 |

**Wave-sequencing rationale:** W0+W1 build the substrate-conformance-foundation; W2 migrates tests onto the new foundation; W3 closes cluster #23 dispositively before the deletion-cascade; W4 deletes the FS-version-repo pattern + StorageProvider package; W5+W7 collapse env-var ceremony; W6 restores deferred tool surface. Each wave is independently shippable + test-green.

**Cumulative-fold PR cadence per wave** (per `feedback_per_mission_work_trace_obligation.md` precedent + Survey §7.1).

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
| F1 (CRITICAL) | Cluster #23 closure integration-test gate | **Architect-disposition:** §2.4 spec; W3 integration test `packages/repo-event-bridge/__tests__/cluster-23-cursor-restart-safety.test.ts`; docker-restart pattern; verifies cursor + dedupe restored from PostgresHubStorageSubstrate; binary-certified W3 ratify-criterion. Engineer-challenge: test-infrastructure tradeoffs (real-docker vs lighter wrapper?) |
| F2 (MEDIUM) | SubstrateConformanceSuite scope mirrors mission-47 precedent | **Architect-disposition:** §2.2 spec; race + CAS + watch-event + restart-safety; ~25-30 tests; abstract `describe.each` over `[memoryFactory, postgresFactory]`; restart-safety category marked `skip` for memory impl. Engineer-challenge: exact mission-47 test-count + which tests port 1:1 vs adapt for HubStorageSubstrate-extra primitives (watch + getWithRevision didn't exist in StorageProvider) |
| F3 (MEDIUM) | Repo-event-bridge variant (i) vs (ii) decision + rationale | **Architect-disposition:** §2.3 spec; **Variant (ii) substrate-as-KV-backend**; minimal migration surface; preserves cursor-store.ts key-namespaced shape; AG-5 defers Variant (i). Engineer-challenge: any blocker discovered when actually swapping interface in cursor-store.ts? CAS semantic mismatch? |
| F4 (MINOR/PROBE) | NOTIFY-trigger semantic for non-entity writes | **Architect-disposition v0.2 (REVERSED from v0.1):** §2.3 final ¶ — NOTIFY DOES fire (per-kind-discriminated; SchemaDef.notify default=true verified). Repo-event-bridge polling-cycle preserved for v1 simplicity; opt-in watch-subscription is architectural future-leverage. Engineer-validation deferred to W3 PR-merge-gate code-review |
| F5 (CRITICAL; NEW v0.2) | Variant (ii) implementability defect (v0.1 architect-side error) | **Architect-resolution:** v0.1 described "pure-KV; no SchemaDef" Variant (ii); verified substrate's `put(kind, entity)` requires kind which requires SchemaDef. Refined to "minimal-SchemaDef Variant" per §2.3 + §0 changelog item 2; register `RepoEventBridgeCursor` + `RepoEventBridgeDedupe` SchemaDefs with no hot fields. Engineer-audit-future-target: confirm minimal-SchemaDef registration doesn't accidentally trigger schema-reconciler behaviors we didn't intend (e.g., NOTIFY-trigger inadvertent fan-out; expression-index inadvertent build) |

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

**v0.2 — DRAFT architect-side self-audit refined v0.1.** Director-direct 2026-05-18 "resume design" with engineer idle (cognitive_ttl=0; thread-576 active but unengaged). Architect-side resolution of Q-A2 + Q-A4 + F3 + F4 via code-read; surfaced F5 (CRITICAL Variant-ii implementability defect) + disposed; §0 changelog captures the 6 v0.1 → v0.2 refinements.

**v1.0 ratify-criterion (architect-side; deferred-bilateral-engineer-audit-to-PR-merge-gate per Director-direct):**
- ✅ Q-A2 (mission-47 conformance suite location) — resolved: NEW WORK, not port (§2.2 + §0.1)
- ✅ Q-A4 (schema-reconciler primitive coverage) — resolved: index-only; sequence-create requires extension; counters-table mechanism chosen (§2.6 + §0.5)
- ✅ Q-A3 (Variant ii interface-swap mechanics) — resolved: primitive-mapping is 1:1; minimal-SchemaDef Variant (§2.3 primitive-mapping table + §0.2)
- ✅ F4 (NOTIFY trigger semantic) — resolved: fires per-kind; default=true (§2.3 final ¶ + §0.3)
- ✅ F5 (Variant ii implementability) — resolved: minimal-SchemaDef Variant (§2.3 + §5 F5 row + §0.6)
- ⏳ Q-A1 (integration-test infrastructure shape) — architect-recommendation = real docker-restart for dispositive evidence; engineer-validation at W3 PR-merge-gate
- ⏳ Q-A5 (substrate-watch performance baseline under restored 1s/5s ticks) — pre-W7 profile gate; engineer-validation at W7 ship
- ⏳ Q-A6 (PR cadence — single-PR-per-mission vs 8-PR-per-wave) — architect-recommendation = single-PR-per-mission with wave-commit-archaeology per mission-83 precedent; engineer-challenge at W0 PR-open-time

**Engineer-audit shifts to PR-merge-gate** (per Director-direct deferral 2026-05-18; engineer cognitive_ttl=0 + thread-576 unengaged). At each wave PR (W0, W1, ..., W7), greg engages on code-bound delta vs Design v0.2 §X.Y; surface architect-flag-status (CONCUR / REFINE / CHALLENGE) at code-review-time instead of pre-Design-ratify.

**Architect-side ratify declaration:** Design v0.2 → v1.0 RATIFIED at next commit (architect-side self-confidence pre-Phase-5-Manifest entry) IF Director engages "ratify v1.0" disposition OR equivalent. Phase 4 → Phase 5 Manifest authoring triggered at v1.0 ratify.

**Expected progression:**
- v0.2 → v1.0 RATIFIED (Director-direct disposition; architect-side commits ratify-marker)
- v1.0 → v1.1+ (live design evolution during mission execution; per mission-83 v1.0 → v1.4 precedent; engineer-side PR-merge-gate refinements fold here)

---

— Architect: lily / 2026-05-18 12:40 AEST (Phase 4 entered Director-direct 2026-05-18; Phase 4 hold-then-resume same day; v0.1 DRAFT → v0.2 architect-side self-audit refined; engineer-audit deferred to W0+ PR-merge-gate per Director-direct + engineer-idle-state)
