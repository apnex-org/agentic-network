# M-Audit-Notification-Repository-Migration — Work Trace (live state)

**Mission scope.** Mission-49 — W8 + W9 continuation of mission-47's entity-store wave pattern. Migrate `AuditStore` + `NotificationStore` from the duplicated `Memory*Store` + `Gcs*Store` pattern to the Repository-over-StorageProvider pattern established in mission-47. Eliminates the local-fs Memory-fallback durability gap that motivated thread-303's Flag #1; unblocks M-Local-FS-Cutover (mission-48) inherited-verification dependency.

**Mission brief:** `get_mission(mission-49)` (Hub entity; cascade-spawned from thread-304 action-1).
**Design round:** thread-304 (architect lily + engineer greg, converged 2026-04-25). Pre-mission audit ratified Points A (unpadded counter ID), B (`audit/v2/` namespace cutover), C (repository-level cross-provider tests).
**Director ratification:** β split sequencing (this mission first, M-Local-FS-Cutover after) confirmed via thread-303 round 5; mission-49 activated 2026-04-25.
**ADR:** none ratified for this mission directly — operates within ADR-024's contract surface. ADR-024 amendment scope (local-fs reclassification + `hub/src/index.ts:106-109` gate relaxation) lives in the dependent mission-48, not here.
**How to read + update this file:** `docs/traces/trace-management.md`.

**Status legend:** ▶ in-flight · ✅ done this session · ○ queued / filed · ⏸ blocked

---

## Resumption pointer (cold-session brief)

If you're picking up cold on mission-49:

1. **Read this file first**, then `docs/audits/m-audit-notification-repository-migration-closing-report.md` for the full closing audit, then thread-304 for design-round context.
2. **DAG:** T1 (W8 Audit) → T2 (W9 Notification) → T3 (closing audit + hygiene). All 3 shipped 2026-04-25 in a single session.
3. **Current state:** **engineer-side scope complete.** All 3 tasks shipped; reports task-350 / task-351 (duplicate) / task-352 / task-353 all `in_review`. Code for W8 + W9 is staged on `agent-greg/mission-47-t4-latency-measurement` working tree (uncommitted); closing report + deploy/README addition also on working tree. Architect-owned remaining: `docs/reviews/mission-49-retrospective.md` retrospective + mission-status flip to `completed` — neither in engineer scope.
4. **Pre-authorized scope discipline:** `@ois/storage-provider` conformance suite UNCHANGED (Point C); legacy `audit/${ts}` GCS namespace freezes — no migration script (anti-goal); `cleanup()` O(N) characteristic preserved (filed as idea-195 follow-up); `notifications/v2/` namespace preserved byte-identically (no second cutover for W9). ADR-024 delta evaluated: no contract change (closing report §6).
5. **Ship-green discipline:** each wave adds repository-level cross-provider tests + removes legacy dual-backend implementations in its own PR. Cumulative diff (W8 + W9): +36/-222 LOC across 7 modified + 4 new files; T3 is docs-only (~250 lines closing report + ~20 lines deploy/README §Hub GCS state layout). Final test suite: 51 files / 748 passed / 5 skipped (delta vs pre-mission-49 baseline 49/706/5: +2 files / +42 tests; zero regressions).
6. **Duplicate task heads-up:** task-351 was an architect-side duplicate of task-350 (same title/scope/correlationId). Filed `create_report(task-351)` as duplicate-detection cross-referencing task-350's shipped artifacts.
7. **Bug-31 amendment heads-up:** task-353 was issued manually (rather than via mission-advancement-cascade) due to MCP timeout on task-352 review. Captured by architect in bug-31 amendment.

---

## In-flight

- (none) — mission-49 engineer-side scope complete. The `agent-greg/mission-47-t4-latency-measurement` branch carries: W8 + W9 staged (uncommitted) at `cc1d252` HEAD; closing-report + deploy/README addition also staged (uncommitted); plus 3 work-trace `[planning]` commits. Architect-owned remaining (retrospective + mission-status flip) is out of engineer scope.

## Queued / filed

- ○ **idea-195 — NotificationRepository.cleanup() O(N) → range-scan optimization.** Filed post-thread-304-seal per architect's ack. Pre-existing characteristic preserved through this mission (anti-goal); follow-up when GCS read-billing or cleanup latency surfaces it.

---

## Done this session

### T3 (Closing audit + engineer-side hygiene) — shipped locally 2026-04-25

- ✅ **`docs/audits/m-audit-notification-repository-migration-closing-report.md` — new file (~250 lines).** Mission-43/46/47-shape, modeled on `m-multi-env-substrate-closing-report.md`. Sections: (1) deliverable scorecard with W8/W9 marked `pending PR open + merge` since code is uncommitted; (2) mission goal + 7 success criteria all MET (one anti-criterion MET); (3) per-task architecture recap; (4) aggregate stats including a per-task estimate-vs-actual table — mission shipped at ~5.5 hours single-session vs ~1–1.25 eng-day estimate; (5) emergent-correctness capture (full narrative of the same-ms collision class fixed structurally by counter+CAS, with the 100-rapid-fire-IDs test cited as empirical floor); (6) ADR-024 delta evaluation — confirmed no contract change, contract validated across 12 entity stores spanning 3 ID schemes (counter / fingerprint / ULID); (7) structural asymmetry note (NotificationStore is NOT in policy AllStores — wire-layer-only injection at hub-networking.ts:101); (8) out-of-scope deliverables; (9) cross-references including downstream blocked-on for mission-48.
- ✅ **`deploy/README.md` — new §Hub GCS state layout section.** Documents pre-vs-post-2026-04-25 audit namespace conventions + pre-vs-post-AMP-cutover notification conventions. Catch-all guidance for blobs outside the documented paths: treat as historical artifacts, not Hub-API-visible. Per task-353 deliverable #4.
- ✅ **`create_report(task-353)` filed.** Status `in_review`. `reportRef: reports/task-353-v1-report.md`. All 6 task-353 deliverables checked; ship-green at 51 files / 748 tests (unchanged — docs-only PR).
- ✅ **Calibration data captured.** Sizing band M-low (1–1.25 eng-days) vs actual ~5.5 hours = pattern-replication missions trend toward the lower edge. Useful for future repository-pattern-continuation work.

### T2/W9 (NotificationStore → NotificationRepository) — shipped locally 2026-04-25

- ✅ **`hub/src/entities/notification-repository.ts` — new file (~145 LOC).** `NotificationRepository implements INotificationStore`; composes any `StorageProvider` (no counter — ULID IDs are self-monotonic). `persist()` lazy-inits `monotonicFactory()` on first call (matches Memory impl semantics — one factory per repository instance) then writes via `createOnly("notifications/v2/${ulid}.json", ...)` and throws on `{ok:false}` per mission-47 repository discipline. `listSince()` filters keys by path-encoded ULID before reading bodies — same set + same order as legacy GcsNotificationStore-which-read-every-file, fewer round-trips on the common cursor path. `cleanup()` walks list+get+delete preserving the legacy `< cutoff` semantic and the O(N) characteristic per mission anti-goal.
- ✅ **`hub/src/index.ts` — wiring further consolidated.** Removed 2 `notificationStore = new ...NotificationStore(...)` sites (gcs branch + 2× memory variants) and the local-fs branch's "AuditStore + NotificationStore remain in-memory" startup note + console.log — limitation no longer exists. Replaced with single `notificationStore = new NotificationRepository(storageProvider);` adjacent to the W8 audit wiring. `MemoryNotificationStore` + `GcsNotificationStore` imports removed; `NotificationRepository` added to entities barrel import.
- ✅ **`hub/src/state.ts` — `MemoryNotificationStore` class deleted (was 40 LOC).** Replaced with mission-49-W9 tombstone comment matching the W5/W6/W8 pattern. `INotificationStore` + `Notification` interfaces preserved in state.ts (consumers in `hub-networking.ts` continue to import from there).
- ✅ **`hub/src/gcs-state.ts` — `GcsNotificationStore` class deleted (was 84 LOC).** `Notification` + `INotificationStore` removed from imports (no longer referenced in this file). Replaced with mission-49-W9 tombstone comment noting `notifications/v2/` namespace is preserved byte-identically; pre-v2 integer-id notifications stay frozen in the legacy keyspace.
- ✅ **`hub/test/unit/notification-repository.test.ts` — new file (~210 LOC).** 22 repository-level tests parameterized across `MemoryStorageProvider` + `LocalFsStorageProvider` (`mkdtemp`/`rm` per-test root; same fixture pattern as W8). Coverage: ULID monotonicity + lex-sortability; 50-concurrent-persist uniqueness; listSince ordering (lex-ascending = chronological for ULIDs); cursor semantics (`afterId=""` returns all; `afterId=ULID` strictly-greater filter); role filter; TTL boundary on cleanup with off-by-one parity (`< cutoff` deletes / `>= cutoff` keeps; backdated via direct `provider.put` — no clock faking; provider-agnostic deterministic test); namespace isolation; persist/listSince round-trip body fidelity (event + data + targetRoles + timestamp).
- ✅ **`AllStores` discovery: NotificationStore is NOT an AllStores member.** Quieter wiring than W8 — `hub-networking.ts:101` injects `INotificationStore` directly rather than via the policy `AllStores` interface. `policy/test-utils.ts` and `test/e2e/orchestrator.ts` did NOT need notification fixture changes (unlike W8's audit fixture). Captured as architecturally-relevant quirk: not all stores live behind the policy `AllStores` seam.
- ✅ **Verification.** `npm test` (hub): 51 files / 748 passed / 5 skipped (was 50 / 726 / 5 after W8 — delta +1 file / +22 tests / 0 regressions). `npm run build`: clean. `npx tsc --noEmit`: clean. `@ois/storage-provider` tests: 40 passed (unchanged — no contract delta).
- ✅ **`create_report(task-352)` filed.** Status `in_review`. `reportRef: reports/task-352-v1-report.md`.
- ✅ **`create_report(task-351)` filed (duplicate detection).** Architect-side duplicate of task-350 — same title, same scope, same correlationId. Report cross-referenced task-350's shipped artifacts; recommended architect dismiss task-351. Status `in_review`. `reportRef: reports/task-351-v1-report.md`.

### T1/W8 (AuditStore → AuditRepository) — shipped locally 2026-04-25

- ✅ **`hub/src/entities/audit-repository.ts` — new file (~110 LOC).** `AuditRepository implements IAuditStore`; composes any `StorageProvider` + `StorageBackedCounter`. `logEntry` issues unpadded `audit-${N}` IDs via `counter.next("auditCounter")`, writes via `provider.createOnly("audit/v2/${id}.json", ...)`, throws on `{ok:false}` rather than swallowing. `listEntries` parses counter suffix on the key list for descending numeric sort — preserves the legacy GcsAuditStore early-break optimization without depending on lex-sortable IDs.
- ✅ **`hub/src/entities/counter.ts` — `Counters` interface extended.** Added `auditCounter: number` field; `zeroCounters()` initializer extended. Mirrors mission-47 W3's `directorNotificationCounter` precedent; sanitize() iterates Object.keys so the new field is auto-handled.
- ✅ **`hub/src/index.ts` — wiring consolidated.** Removed 3 `auditStore = new ...AuditStore(...)` sites across the gcs/local-fs/memory branches; replaced with single `auditStore = new AuditRepository(storageProvider, storageCounter);` after the counter is constructed. Local-fs branch's startup note updated: AuditStore no longer in the "not-yet-migrated" set; only NotificationStore remains for W9. `MemoryAuditStore` + `GcsAuditStore` imports removed; `AuditRepository` added to the entities barrel import.
- ✅ **`hub/src/policy/test-utils.ts` — `createTestContext` audit fixture migrated.** `audit: new MemoryAuditStore()` → `audit: new AuditRepository(storageProvider, storageCounter)`. `MemoryAuditStore` import removed; `AuditRepository` added.
- ✅ **`hub/test/e2e/orchestrator.ts` — same migration on the E2E test orchestrator's `createStores()`.** Caught only after first test run revealed 170 failures all rooted in `MemoryAuditStore is not a constructor` — the production tsconfig.json scopes only `src/`, so initial typecheck looked clean while orchestrator.ts still imported the deleted symbol. Lesson: grep for legacy class names before declaring delete-task complete; don't trust `tsc --noEmit` from the production tsconfig to catch test-only references.
- ✅ **`hub/src/state.ts` — `MemoryAuditStore` class deleted (was 26 LOC).** Replaced with mission-49-W8 tombstone comment matching the W5/W6 pattern. `IAuditStore` + `AuditEntry` interfaces preserved in state.ts (mirrors how mission-47 left ITaskStore + IThreadStore in state.ts when their MemoryStores were removed — minimal diff to importers; consumers in `hub-networking.ts` + `policy/types.ts` + `policy/audit-policy.ts` untouched).
- ✅ **`hub/src/gcs-state.ts` — `GcsAuditStore` class deleted (was 44 LOC).** `IAuditStore` + `AuditEntry` removed from imports. Replaced with mission-49-W8 tombstone comment noting the legacy `gs://$bucket/audit/${ts}` namespace freezes as historical / grep-only.
- ✅ **`hub/test/unit/audit-repository.test.ts` — new file (~190 LOC).** 20 repository-level tests parameterized across `MemoryStorageProvider` + `LocalFsStorageProvider` (`mkdtemp`/`rm` per-test root). Coverage: counter-based unpadded ID format; newest-first ordering across the lex-vs-numeric boundary (audit-9 vs audit-10 — the regression case lex sort would introduce); actor filter; limit; empty repo; collision-free invariant via 100 concurrent `repo.logEntry` calls (validates the emergent-correctness fix); `audit/v2/` namespace isolation; relatedEntity preservation + null normalization. GCS provider variant deliberately not covered at this layer — primitive-level invariants live in the @ois/storage-provider conformance suite (Point C terminology discipline).
- ✅ **Verification.** `npm test` (hub): 50 files / 726 passed / 5 skipped (was 49 / 706 / 5 — delta +1 file / +20 tests / 0 regressions). `npm run build` (hub): clean. `npx tsc --noEmit` (hub): clean. `npm test` (@ois/storage-provider): 2 files / 40 passed (unchanged — no contract delta as expected).
- ✅ **`create_report(task-350)` filed.** Task status `in_review`. Report covers all deliverables, architect-ratified design points (A/B/C), the emergent-correctness fix narrative, verification, out-of-scope explicitly enumerated. `reportRef: reports/task-350-v1-report.md`.

---

## Edges (dependency chains)

```
T1/W8 ✅─┐
T2/W9 ✅─┼─[merge gates]─→ mission-48 M-Local-FS-Cutover (inherited-verification dependency)
T3    ✅─┘                  ↑
                            └─[unblocks on merge of W8+W9 only — T3 is docs-only,
                               not a structural prerequisite for mission-48]

Architect-owned remaining (out of engineer scope):
  • docs/reviews/mission-49-retrospective.md (architect retrospective)
  • mission-status flip mission-49 → completed (architect-gated)
```

Outside-mission downstream: mission-48's success-criterion 5 ("no regression in audit or notification durability post-cutover") is verifiable as soon as W8 + W9 PRs both merge. Director's β split sequencing (thread-303 round 5) chose this mission first explicitly to satisfy that dependency.

---

## Session log (append-only)

- **2026-04-25 late** — Architect issued task-353 (T3 closing audit) manually due to mission-advancement-cascade stall after MCP timeout on task-352 review (architect-noted bug-31 amendment). Engineer shipped T3 deliverables in a docs-only patch: ~250-line closing report at `docs/audits/m-audit-notification-repository-migration-closing-report.md` (mission-43/46/47-shape; full deliverable scorecard + emergent-correctness narrative + ADR-024 no-delta confirmation + structural asymmetry note for the AllStores vs HubNetworking divergence) plus a new §Hub GCS state layout section in `deploy/README.md` documenting the audit `audit/v2/` cutover + the preserved `notifications/v2/` namespace + a catch-all guidance for non-Hub-API-visible historical blobs. Filed `create_report(task-353)`; status `in_review`. Calibration data captured: thread-304 sized M-low (1–1.25 eng-days); actual was ~5.5 hours single-session — pattern-replication missions trend toward the lower edge of the sizing band. Engineer-side scope complete; architect-owned retrospective + mission-status flip remain.

- **2026-04-25 mid (continuation)** — Architect issued task-352 for T2/W9 NotificationStore migration in flight (without waiting for T1 PR merge); also issued task-351 which was a duplicate of task-350. Engineer filed duplicate-detection report on task-351, then shipped T2/W9 on the same working tree as T1/W8: `NotificationRepository` (~145 LOC) over StorageProvider; ULID IDs preserved; `notifications/v2/` namespace preserved byte-identically; `MemoryNotificationStore` (40 LOC) + `GcsNotificationStore` (84 LOC) deleted with tombstone comments; 22 cross-provider tests added. Discovery: `AllStores` does NOT include `NotificationStore` — it's injected directly into `HubNetworking` at hub-networking.ts:101, so `policy/test-utils.ts` + `test/e2e/orchestrator.ts` needed no notification fixture changes (quieter wiring than W8). Cumulative mission-49 diff (W8+W9): +36/-222 LOC across 7 modified + 4 new files; 51 test files / 748 passed (vs pre-mission-49 baseline 49/706/5: +2 files / +42 tests / 0 regressions). Filed `create_report(task-352)`; status `in_review`. Mission-49 entity-store migration scope is structurally complete on the working tree; T3 retrospective queued.

- **2026-04-25 mid** — Mission-49 design round (thread-304) converged 3 rounds; architect ratified all 3 engineer-surfaced design points (A unpadded counter / B `audit/v2/` namespace cutover / C repository-level test terminology) plus refinement on A. Director activated mission immediately post-seal. Architect issued task-350 for T1/W8. Engineer shipped T1 locally: `AuditRepository` + counter extension + 3 wiring sites consolidated + 2 legacy classes deleted + 20 cross-provider tests; full test suite green at 726/731 (was 706/711 pre-migration). Encountered missed `test/e2e/orchestrator.ts` reference to deleted `MemoryAuditStore` — initial typecheck was misleadingly clean because hub `tsconfig.json` excludes `test/`. Filed report via `create_report(task-350)`; status `in_review`. Filed idea-195 (NotificationRepository cleanup() O(N) → range-scan optimization) as the post-seal commitment from thread-304. Trace landed at `6be7bc2` (`[planning]` commit); code changes still on working tree uncommitted, awaiting architect review-pass on the reports.

---

## Canonical references

- **Mission entity:** `get_mission(mission-49)` (Hub) — title `M-Audit-Notification-Repository-Migration`; cascade-spawned from thread-304 action-1.
- **Source idea:** `get_idea(idea-194)` — filed 2026-04-25 post Flag #1 finding in thread-303.
- **Design round thread:** thread-304 — architect lily + engineer greg, 3 rounds, converged 2026-04-25.
- **Cross-mission dependency:** mission-48 M-Local-FS-Cutover blocked-on this mission completing — see thread-303 + `m-local-fs-cutover-work-trace.md` (filed when mission-48 activates).
- **Pattern precedents (mission-47):** `m-sovereign-storage-interface-work-trace.md`; specifically `entities/director-notification-repository.ts` (W3, ID-shape precedent) + `entities/tele-repository.ts` (W1, contract-validation ground).
- **ADR context:** [`docs/decisions/024-sovereign-storage-provider.md`](../decisions/024-sovereign-storage-provider.md) — defines the StorageProvider contract this mission consumes.
- **Trace methodology:** `docs/traces/trace-management.md`.
- **Commit conventions:** `[mission-49]` prefix on code commits; `[planning]` prefix on this trace's patches; no `Co-Authored-By: Claude` trailers per `CLAUDE.md`.
- **Follow-up filed:** `get_idea(idea-195)` — NotificationRepository.cleanup() O(N) range-scan optimization (sourced from thread-304).
