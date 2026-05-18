---
mission: M-Hub-Storage-FS-Retirement-And-MemoryHubStorageSubstrate
mission-class: pre-substrate-cleanup
source-idea: idea-300
survey-envelope: docs/surveys/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate-survey.md
prior-mission-anchor: mission-83 (M-Hub-Storage-Substrate)
sequencing-downstream: idea-298 (M-Hub-Storage-Cloud-Deploy; strict prerequisite locked via Q3a)
design-version: v0.1
design-status: DRAFT — pre-bilateral round-1 audit
ratify-criterion: bilateral audit converged (architect-flag F1-F4 dispositions ratified by engineer; wave-decomposition W0-W7 scope-checked; cluster #23 closure architecture confirmed) → v1.0 RATIFIED
---

# M-Hub-Storage-FS-Retirement-And-MemoryHubStorageSubstrate — Design v0.1

**Draft 2026-05-18 architect-side; pre-bilateral round-1 audit.** Composes Survey envelope §1-7 ratified intent + 5-pillar composite into engineer-actionable architecture + wave-spec.

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

**Scope:** Standard per Survey Q5b — race + CAS + watch-event + restart-safety. Mirrors mission-47 StorageProvider conformance suite scope precedent (~25-30 tests).

**Test categories:**
1. **Race-correctness** (~8 tests) — concurrent put under contention; per-kind isolation; cross-kind isolation; watch-during-put atomicity; CAS-loop convergence under N writers; bug-97 counter-collision regression net (per `feedback_counter_collision_substrate_defect_pattern.md`)
2. **CAS-semantic** (~6 tests) — first-write-wins-without-ifRevision; ifRevision=N matches → put succeeds; ifRevision=N mismatch → CASConflictError; getWithRevision round-trip; revision monotonicity per id; revision isolation across ids in same kind
3. **Watch-event** (~6 tests) — watch fires on put; watch fires on delete; multiple subscribers receive each event; unsubscribe stops event delivery; watch payload shape matches `{kind, id, body, revision}`; watch ordering matches put ordering per id
4. **Restart-safety** (~5 tests; postgres only; memory marked `skip`) — write + restart + read returns the same body; revision counter survives restart; watch-subscribers receive backlog OR get notified to re-sync (architect-flag F4-adjacent — decision documented in §5); CAS-ifRevision against pre-restart revision still works post-restart; concurrent-write-during-restart edge-case

**Test infrastructure:** abstract `describe.each` over `[memoryFactory, postgresFactory]`; each factory yields a fresh substrate instance; postgres factory uses the `hub/test/postgres-container.ts` test-postgres-container harness from mission-83 W2 (per Design v1.4 §2.7).

**Location:** `hub/src/storage-substrate/__tests__/conformance/` (canonical location; sibling to substrate impl files).

### §2.3 Repo-event-bridge migration — Variant (ii) substrate-as-KV-backend (per F3 disposition)

**Decision:** Variant (ii) — substrate-as-KV-backend; preserves cursor-store.ts's existing key-namespaced data-shape (`repo-event-bridge/cursor/<owner>/<repo>` + `repo-event-bridge/dedupe/<owner>/<repo>`). NO new entity kinds.

**Rationale:**
- Minimal migration surface (cursor-store.ts swaps StorageProvider for HubStorageSubstrate; data-shape preserved)
- No SchemaDef proliferation (substrate's 20 entity kinds remain canonical; repo-event-bridge is not first-class entity-kind producer)
- Closes cluster #23 (per Survey §2.Q4) with smallest blast-radius
- Variant (i) fully-entity-integrated deferred to AG-5 (operational-need surface as separate follow-on)

**Implementation:**
- Add `RepoEventBridgeKvStore` adapter at `packages/repo-event-bridge/src/substrate-kv-store.ts` — wraps HubStorageSubstrate's `get`/`put`/`delete` primitives keyed on `repo-event-bridge/<namespace>/<owner>/<repo>` shape
- cursor-store.ts swaps `StorageProvider` constructor-arg for `HubStorageSubstrate` (interface-narrowed via the adapter)
- Cursor + dedupe JSONB blobs stored under existing key shapes; substrate sees them as opaque body content (no per-kind index needed; not entity-discriminated)

**SchemaDef impact:** zero new SchemaDefs. Substrate's existing schema reconciler is unchanged.

**F4 PROBE outcome (resolved at architect-side; engineer-audit-round-1 challenge target):** NOTIFY-trigger for non-entity writes — postgres's LISTEN/NOTIFY trigger is currently per-entity-kind (per Design v1.4 §2.4); non-entity writes via repo-event-bridge KV adapter DO NOT trigger NOTIFY. Repo-event-bridge does not need watch primitive at this layer (polling-cycle architecture is preserved); cluster #23 closure does not depend on watch. Document as known-limit in §5.

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

**Per `feedback_counter_collision_substrate_defect_pattern.md`:** Counter's issue-then-createOnly pattern isn't atomic across concurrent callers; 11-kind defect surface. Mission-83 bug-97 fixed via per-repo retry-loop. W4 unification opportunity: extract to Counter helper with built-in retry-loop OR advisory-lock OR postgres-sequence-per-kind.

**Decision (architect-recommendation; engineer-audit challenge target):** **postgres-sequence-per-kind** for production-prod path; in-memory Counter for MemoryHubStorageSubstrate. Sequence-per-kind is the substrate-native primitive that atomically eliminates the race; per-repo retry-loop becomes obsolete; advisory-lock not needed.

**Implementation surface (W4):**
- Add `counter_<kind>` postgres sequences via SchemaDef reconciler (additive; 11 sequences for 11 affected kinds; idempotent reconciler-create)
- HubStorageSubstrate `issueCounter(kind): Promise<number>` primitive — calls `SELECT nextval('counter_<kind>')` for postgres; uses `Map<kind, number>` for memory impl
- Per-repo `issueCounter` callers (BugRepository / IdeaRepository / etc.) swap from Counter abstraction to substrate primitive; Counter abstraction module deletes

**Conformance suite addition:** §2.2 race-correctness category includes counter-collision regression net (bug-97 reproducer).

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
| F4 (MINOR/PROBE) | NOTIFY-trigger semantic for non-entity writes | **Architect-disposition:** §2.3 final paragraph — NOTIFY does NOT fire for non-entity (Variant ii) writes; repo-event-bridge polling-cycle architecture preserved; documented as known-limit; out-of-scope for v1; revisit if AG-5 Variant (i) is later picked up. Engineer-challenge: empirically verify NOTIFY-trigger fires/skips as expected via spike-test before W3 ship |

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

**v0.1 — DRAFT pre-bilateral round-1 audit.** Architect-side draft from Survey envelope (Director-ratified picks across 2 rounds + 5-pillar composite intent + W0-W7 wave-plan).

**v1.0 ratify-criterion** (per `mission-lifecycle.md` Phase 4 ratify):
- Bilateral audit converged (engineer-side round-1 audit complete; architect-flag F1-F4 dispositions ratified OR refined+ratified)
- Q-A1 through Q-A6 (§7.2) engineer-disposition responses captured + folded into Design
- Any engineer-surfaced architectural blocker resolved
- Cluster #23 closure architecture confirmed (W3 spec dispositive-evidence-test shape ratified)
- Counter unification mechanism ratified (§2.6 — postgres-sequence-per-kind concur OR architect-refined per engineer challenge)
- Wave-decomposition W0-W7 ratified (scope-boundaries + ordering + PR-cadence)

**Expected progression:**
- v0.1 → v0.2 (post round-1 audit; architect-flag F1-F4 challenge-responses folded)
- v0.2 → v0.3 (post round-2 audit if needed; bilateral architect+engineer iteration)
- v0.3 → v1.0 RATIFIED (architect declares Design ready for Phase 5 Manifest)
- v1.0 → v1.1+ (live design evolution during mission execution; per mission-83 v1.0 → v1.4 precedent)

---

— Architect: lily / 2026-05-18 12:18 AEST (Phase 4 entered Director-direct 2026-05-18; Design v0.1 DRAFT; bilateral round-1 audit thread to greg next)
