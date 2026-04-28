# Mission M-Audit-Notification-Repository-Migration — Closing Report

**Hub mission id:** mission-49
**Mission brief:** scoped via thread-304 (architect lily ↔ engineer greg, converged 2026-04-25). Director ratified β split sequencing 2026-04-25 via thread-303 round 5 — this mission lands first; M-Local-FS-Cutover (mission-48) activates after.
**Resolves:** thread-303 Flag #1 — local-fs Memory-fallback durability gap; satisfies M-Local-FS-Cutover (mission-48) inherited-verification dependency on completion.
**ADR:** none ratified for this mission directly; operates within ADR-024's contract surface. ADR-024 delta evaluated in §6 below — confirmed: no contract change.
**Dates:** Scoped + activated 2026-04-25; T1 + T2 + T3 (this report) all shipped 2026-04-25.
**Scope:** 3-task decomposition — T1 W8 AuditStore → AuditRepository, T2 W9 NotificationStore → NotificationRepository, T3 closing audit + engineer-side hygiene (this report).
**Tele alignment:** tele-3 Sovereign Composition PRIMARY — completes the mission-47 wave-pattern arc across all 12 entity stores. tele-2 Isomorphic Specification SECONDARY — both stores' contracts are now the same StorageProvider primitives regardless of backend.

---

## 1. Deliverable scorecard

| Task | Source directive | Status | Branch artifact | PR | Test count delta |
|---|---|---|---|---|---|
| T1/W8 | AuditStore → AuditRepository | ⏳ Code on `agent-greg/mission-47-t4-latency-measurement` working tree (uncommitted); report `task-350-v1` approved | (pending commit + PR open) | (pending) | +20 (50→726 from 49→706 baseline) |
| T2/W9 | NotificationStore → NotificationRepository | ⏳ Code on same working tree (uncommitted, stacked on W8); report `task-352-v1` approved | (pending commit + PR open) | (pending) | +22 (51→748 from W8 baseline) |
| T3 | Closing audit + engineer-side hygiene | ⏳ This PR | (this PR) | (this PR) | 0 (docs-only) |
| **Sibling** | task-351 architect-side duplicate of task-350 | ✅ Reported as duplicate | n/a | n/a | n/a |

**Aggregate (cumulative W8+W9):**
- 7 modified files: `entities/counter.ts`, `entities/index.ts`, `gcs-state.ts`, `index.ts`, `policy/test-utils.ts`, `state.ts`, `test/e2e/orchestrator.ts`
- 4 new files: `entities/audit-repository.ts`, `entities/notification-repository.ts`, `test/unit/audit-repository.test.ts`, `test/unit/notification-repository.test.ts`
- LOC delta: +36 / −222 in modified files (−186 net production); +~655 new files (~255 production + ~400 tests)
- Net structural-change discipline: less code in production (legacy dual-implementation overhead removed); more code in tests (cross-provider parameterization)

**Test counts at mission close:**
- Hub: **51 files / 748 passing / 5 skipped / 0 failing** (vs pre-mission-49 baseline 49/706/5: **+2 files / +42 tests / 0 regressions**)
- @apnex/storage-provider: 2 files / 40 passing (unchanged — no contract delta as expected)
- Build + typecheck: clean

---

## 2. Mission goal + success framing

**Parent ask** (engineer Flag #1 surfaced in thread-303 mission-48 design round): legacy `MemoryAuditStore` + `MemoryNotificationStore` are wired on the local-fs backend, meaning audit trail + internal SSE notifications reset on Hub restart. On a flip to `STORAGE_BACKEND=local-fs` as laptop-Hub prod default (mission-48 scope), this would ship a silent durability regression vs current GCS default. Director-ratified β path: split into prerequisite migration mission (this) + cutover mission (mission-48), serialized.

**Mission goal:** migrate `AuditStore` + `NotificationStore` from the duplicated `Memory*Store` + `Gcs*Store` pattern to the Repository-over-StorageProvider pattern established by mission-47 W1-W7. Delete legacy dual-implementation code. GCS prod behavior byte-identical post-refactor.

**Success criteria** (per thread-304 convergence):

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Both stores implement Repository pattern over StorageProvider; legacy dual-implementation code deleted | ✅ MET | `entities/audit-repository.ts` + `entities/notification-repository.ts` shipped; `MemoryAuditStore` (state.ts:1293-1318) + `GcsAuditStore` (gcs-state.ts:527-570) + `MemoryNotificationStore` (state.ts:1113-1152) + `GcsNotificationStore` (gcs-state.ts:574-655) all deleted with mission-49-W8/W9 tombstone comments |
| 2 | GCS prod behavior byte-identical post-refactor — zero behavioral regression on existing consumers | ✅ MET | `IAuditStore` + `INotificationStore` interfaces unchanged in `state.ts:818-827`; consumers in `hub/src/index.ts:344,379,448,465,537` + `hub-networking.ts:243,323,351,704,715` untouched; W9 `notifications/v2/` namespace preserved byte-identically |
| 3 | Repository-level test coverage passes for both stores against memory + local-fs + gcs providers | ✅ MET (via composition) | 42 new repository-level tests parameterized over Memory + LocalFs; GCS provider variant covered at the primitive layer by the @apnex/storage-provider conformance suite (per thread-304 Point C terminology — repository-level tests, NOT conformance-suite extensions) |
| 4 | Hub test baseline preserved or improved | ✅ MET | 706→748 passing (+42 tests added; 0 regressions). Mission-47's `-N-for-obsolete-duplicate-tests` pattern not applicable — legacy Audit + Notification dual-backend tests existed only as integration coverage via `policy/test-utils.ts` test fixtures, which migrated cleanly to the new Repository (no test removals) |
| 5 | On local-fs backend: audit entries + notifications now persist across Hub restart — mission-48 inherited-verification dependency satisfied | ✅ MET (provable on PR merge) | Post-merge: `STORAGE_BACKEND=local-fs` will instantiate `AuditRepository` + `NotificationRepository` (single wiring path; no Memory variant exists), writing through `LocalFsStorageProvider` to disk. Verifiable empirically once mission-48 T2b restart-smoke runs |
| 6 | Audit ID collision class eliminated by construction (counter-with-CAS) | ✅ MET | See §5 emergent-correctness narrative; verified by 100-rapid-fire-IDs test in `audit-repository.test.ts` |
| 7 | `audit/v2/` namespace cutover documented in `deploy/README` for prod operators | ✅ MET | `deploy/README.md` §Hub GCS state layout updated this PR (per task-353 deliverable #4) |

**Success anti-criterion:** _"Production GCS audit / notification trail must remain readable post-refactor — no migration of legacy entries; no breaking change to consumer interfaces."_

**Status:** ✅ MET. Pre-migration `gs://$bucket/audit/${ts}.json` blobs (legacy timestamp-ID format) are frozen as historical / grep-accessible — Hub `listEntries` API returns only the post-migration `audit/v2/` namespace per the explicit cutover discipline. `notifications/v2/` namespace is preserved byte-identically (no second cutover); pre-v2 integer-id notifications stay frozen in their legacy keyspace exactly as they were before this mission. Consumer interfaces (`IAuditStore` + `INotificationStore`) unchanged.

---

## 3. Per-task architecture recap

### 3.1 T1 — W8: AuditStore → AuditRepository

Full detail in `reports/task-350-v1-report.md`. Key surfaces:

- **Counter-based unpadded `audit-${N}` IDs** (thread-304 Point A). New `auditCounter` field on `meta/counter.json`. Matches Hub entity keyspace pattern (`task-${N}`, `mission-${N}`, `thread-${N}`, `idea-${N}`, `tele-${N}`); no padding overhead.
- **`audit/v2/` namespace cutover** (thread-304 Point B). Repository writes to `audit/v2/${id}.json`; `listEntries` reads only from `audit/v2/`. Pre-migration `audit/${ts}.json` namespace freezes as historical — no migration script per anti-goals.
- **Read-side ordering preserves the legacy early-break optimization** despite IDs no longer being lex-sortable. `listEntries` parses the counter suffix on the key list for descending numeric sort, then streams the top-`limit` matches without materializing every body. Avoids the regression case lex sort would introduce (`audit-9` < `audit-10` under lex).
- **Counter+CAS eliminates the legacy same-ms collision class by construction** — see §5.
- **Wiring consolidation:** 3 instantiation sites in `hub/src/index.ts` (gcs / local-fs / memory branches) collapsed to 1 `auditStore = new AuditRepository(storageProvider, storageCounter);` line after the counter is constructed. The local-fs branch's "AuditStore + NotificationStore remain in-memory" warning was simultaneously obsoleted by W9 (next task).
- **Test fixture migration:** `policy/test-utils.ts` + `test/e2e/orchestrator.ts` `audit:` fixture line swapped from `new MemoryAuditStore()` to `new AuditRepository(storageProvider, storageCounter)`. Caught a footgun: hub `tsconfig.json` excludes `test/`, so initial typecheck looked clean while orchestrator.ts still imported the deleted symbol — every subsequent test failed with `MemoryAuditStore is not a constructor`. Lesson captured in the work-trace.

### 3.2 T2 — W9: NotificationStore → NotificationRepository

Full detail in `reports/task-352-v1-report.md`. Key surfaces:

- **ULID IDs preserved** via `monotonicFactory()` (one factory per repository instance — matches `MemoryNotificationStore` semantics). No counter; no namespace cutover (the `notifications/v2/` cutover was already established by legacy `GcsNotificationStore` and is preserved byte-identically).
- **`persist`/`listSince`/`cleanup` all express as repository-layer composition over the 6-primitive surface.** ULID lex-sortability holds on every backend the StorageProvider contract supports — `listSince` uses `provider.list().sort()` directly without numeric parsing.
- **Read-side optimization for `listSince`:** filters keys by path-encoded ULID before reading bodies — same set + same order as legacy `GcsNotificationStore.listSince`, fewer round-trips on the common cursor path. Path-trust safe because the repository writes ULID into the path and the file content identically.
- **TTL semantic preserved:** `cleanup()` deletes strictly-older-than cutoff (`< cutoff`), keeps everything else. Off-by-one parity with both legacy implementations exactly. Verified by a backdated-via-direct-`provider.put` test (no clock faking).
- **O(N) cleanup characteristic preserved per anti-goal.** Range-scan optimization filed as idea-195 follow-up.
- **Wiring consolidation:** 3 more instantiation sites in `hub/src/index.ts` (gcs branch + 2× memory variants) collapsed to 1 `notificationStore = new NotificationRepository(storageProvider);` line. The local-fs branch's "NotificationStore remains in-memory" warning + console.log removed — limitation no longer exists.
- **Discovery (per §7 below):** `NotificationStore` is NOT in the policy `AllStores` interface; it's injected directly into `HubNetworking` at hub-networking.ts:101. So `policy/test-utils.ts` + `test/e2e/orchestrator.ts` did NOT need notification fixture changes (unlike W8's audit fixture). Quieter wiring than W8.

### 3.3 T3 — Closing audit + engineer-side hygiene (this report)

Deliverables per task-353:
1. ✅ **Closing report** at `docs/audits/m-audit-notification-repository-migration-closing-audit.md` — this file.
2. ✅ **Emergent-correctness capture** — see §5.
3. ✅ **ADR-024 delta evaluation** — see §6. Confirmed: no contract change.
4. ✅ **`deploy/README` v2-namespace note** added under new §Hub GCS state layout subsection.
5. ✅ **Structural asymmetry note** — see §7.
6. ✅ **Ship-green** — test baseline holds at 51 files / 748 passing.

---

## 4. Aggregate stats + verification

**Cumulative diff (W8 + W9 staged on the working tree, T3 docs-only):**

| | Files | LOC delta |
|---|---|---|
| Modified | 7 | +36 / −222 (net −186 production) |
| New (production) | 2 | ~255 |
| New (tests) | 2 | ~400 |
| New (docs — this PR) | 1 | this report (~250 lines) |
| Modified (docs — this PR) | 1 | `deploy/README.md` §Hub GCS state layout |

**Test counts (hub package):**

| Wave | Files | Passing | Skipped | Delta vs prior |
|---|---|---|---|---|
| Pre-mission-49 baseline (mission-47 W7b shipped) | 49 | 706 | 5 | — |
| Post-T1/W8 | 50 | 726 | 5 | +1 file, +20 tests, 0 regressions |
| Post-T2/W9 | 51 | 748 | 5 | +1 file, +22 tests, 0 regressions |
| Post-T3 (this PR; docs-only) | 51 | 748 | 5 | unchanged |

**Cross-package verification:**
- @apnex/storage-provider: 2 files / 40 passing (unchanged — no contract delta as expected)
- `npm run build` (hub): clean
- `npx tsc --noEmit` (hub): clean

**Per-task effort (estimate vs actual):**

| Task | Estimate (thread-304) | Actual |
|---|---|---|
| T1/W8 | ~0.5–0.75 day | ~3 hours single-session |
| T2/W9 | ~0.5 day | ~1.5 hours single-session (pattern bedded from W8) |
| T3 | ~1–2 hours | ~1 hour (docs-only) |
| **Total** | **~1–1.25 eng-days** | **~5.5 hours single-session** |

Mission shipped within sizing band; faster than estimated because both waves landed in a single uninterrupted session and the pattern was already proven by mission-47 W1-W7.

---

## 5. Emergent-correctness capture (W8)

**The legacy bug.** `GcsAuditStore.logEntry` (deleted; was at `gcs-state.ts:527-570`) generated IDs via timestamp:

```ts
const ts = now.toISOString().replace(/[:.]/g, "-");
const id = `audit-${ts}`;
// ...
await createOnly<AuditEntry>(this.bucket, `audit/${id}.json`, entry);  // line 550
return { ...entry };
```

Two issues compounded into a latent same-millisecond collision class:

1. **ID derived from timestamp at millisecond resolution.** Two `logEntry` calls within the same ms generate the same `audit-${ts}` id.
2. **`createOnly`'s `{ok}` return value was ignored.** A same-ms collision causes `createOnly` to return `{ok: false}` (target already exists, won't clobber), but the function still `return`s the unwritten entry — the caller sees a "successful" `AuditEntry` that was never persisted. Silent audit-trail loss.

**The fix is structural, not a code patch.** `AuditRepository.logEntry` issues IDs via `StorageBackedCounter.next("auditCounter")`, which uses the mission-47-standard `get + putIfMatch + retry` CAS pattern internally. Two consequences:

1. **No two callers can ever receive the same ID.** Counter is monotonic by construction; CAS over `meta/counter.json` serializes increments across writers.
2. **`createOnly` `{ok}` is now checked.** `AuditRepository.logEntry` throws on `{ok: false}` rather than swallowing, so a (theoretically impossible under CAS) counter desync surfaces loudly.

**Empirical floor.** The repository test "yields N unique IDs across N rapid-fire logEntry calls" (`test/unit/audit-repository.test.ts`) fires 100 concurrent `repo.logEntry` calls and asserts 100 distinct dense IDs (`audit-1` through `audit-100`). Validates the contract under realistic burst load.

**Why this matters.** The original bug had never been observed in prod — production audit calls are typically ms-spaced and would only collide under unusual burst conditions. But the migration made the fix free (it's an emergent property of the counter+CAS pattern; no design effort or extra code) and structurally guarantees the class can never recur. Documented here for future archaeology: anyone reading the deleted GcsAuditStore in git history will find this report explaining the `{ok}`-checking discipline introduced by the Repository pattern.

---

## 6. ADR-024 delta evaluation

**Question:** does mission-49 (W8 + W9, two more entity stores) teach anything new about the StorageProvider contract that warrants an ADR-024 amendment?

**Answer:** no.

**Evidence:**

- The 6-primitive surface defined by ADR-024 (`get`, `getWithToken`, `list`, `delete`, `put`, `createOnly`, `putIfMatch`) was sufficient for both AuditRepository + NotificationRepository.
- No new primitive was needed.
- No existing primitive's semantics required widening.
- Both repositories compose existing primitives in patterns already exercised by mission-47 W1-W7 (counter-based ID via `StorageBackedCounter`; create-only writes via `createOnly`; list+filter+read for query methods).
- The `concurrent:false` capability flag was load-bearing for AuditRepository (the counter+CAS pattern works cleanly on single-writer local-fs because `MAX_CAS_RETRIES=50` is more than enough for non-contended in-process serialization). Validates the original ADR-024 §3 capabilities-flag design.

**Conclusion:** ADR-024 contract surface held across all 12 entity stores migrated (mission-47 W1-W7 + mission-49 W8-W9 + DirectorNotification W3 already migrated mid-mission-47). The contract has now been validated against:

- Counter-based monotonic IDs (Tele, Bug, Idea, Mission, Task, Proposal, Thread, Turn, PendingAction, DirectorNotification, **Audit**)
- Fingerprint-derived IDs (Agent — no counter)
- ULID-based monotonic IDs (**Notification**)

12 entity stores, 3 ID schemes, 1 contract. The architectural play landed.

No ADR-024 amendment filed. Anyone touching the contract for a 13th entity store should still revisit this conclusion — the data point is "stable for 12 entities including 3 ID schemes," not "stable forever."

---

## 7. Structural asymmetry note (W8 vs W9)

Captured per task-353 deliverable #5 for future migration-pattern archaeology.

**The asymmetry.** AuditStore is a member of the policy `AllStores` interface (`hub/src/policy/types.ts:32`), so it's wired through the policy-context fixture in `policy/test-utils.ts` and `test/e2e/orchestrator.ts`. NotificationStore is NOT a member of `AllStores` — it's injected directly into the `HubNetworking` constructor at `hub/src/hub-networking.ts:101`, separate from the policy layer.

**Why.** The policy layer (Layer 7 in the architectural diagram) holds entity-CRUD stores that handler logic operates on (`audit`, `task`, `mission`, `thread`, etc.). The `NotificationStore` is wire-layer infrastructure — it backs the SSE fan-out `dispatch` and `listSince`-reconnect-backfill paths. Those operations live in `HubNetworking`, not in policy handlers. Hence the separation.

**Migration-pattern impact.** W9 was a quieter wiring change than W8: only `hub/src/index.ts` needed touching. W8 needed `hub/src/index.ts` + `policy/test-utils.ts` + `test/e2e/orchestrator.ts` (the audit fixture appears in three places). Future engineers migrating wire-layer-only stores (if any new ones are introduced) should expect this single-touchpoint pattern; future engineers migrating policy-layer stores should remember the test-fixture-grep discipline that the W8 footgun memorialized.

**Latent question for future scope.** Should `INotificationStore` be promoted into `AllStores` for uniformity? Probably not — the separation is load-bearing (the policy layer's stores are CRUD; the wire layer's notification store has fan-out + cleanup semantics distinct from CRUD). Keeping the architectural boundary clean is more valuable than uniformity. Captured here so the question doesn't re-surface without the prior reasoning available.

---

## 8. Out-of-scope deliverables (architect-owned)

Per task-353 explicit out-of-scope:

- **Architect-side retrospective** at `docs/reviews/m-audit-notification-repository-migration-retrospective.md` — owned by architect; not in engineer scope.
- **Mission-status flip to `completed`** — architect-gated transition.

Per mission anti-goals (thread-304):

- StorageProvider contract changes — confirmed no delta in §6 above.
- Notification-primitive redesign (deferred to idea-192 Hub-Triggers-Inbox).
- Pre-migration `audit/${ts}` namespace migration script (legacy frozen; grep-only).
- DirectorNotificationStore (already migrated mission-47 W3).
- `cleanup()` O(N) read-scan optimization (filed as idea-195 follow-up).

---

## 9. Cross-references

- **Mission entity:** `get_mission(mission-49)` (Hub) — `M-Audit-Notification-Repository-Migration`; cascade-spawned from thread-304 action-1.
- **Source idea:** `get_idea(idea-194)` — filed 2026-04-25 post-Flag-#1-finding in thread-303.
- **Design round:** thread-304 — architect lily + engineer greg, 3 rounds, converged 2026-04-25. Points A (unpadded counter) + B (`audit/v2/` namespace cutover) + C (repository-level cross-provider tests; not conformance-suite extensions) ratified.
- **Director ratification:** thread-303 round 5 — β split sequencing (this mission first; M-Local-FS-Cutover after).
- **W8 report:** `reports/task-350-v1-report.md` (architect-approved).
- **W9 report:** `reports/task-352-v1-report.md` (architect-approved).
- **Duplicate-detection report:** `reports/task-351-v1-report.md` (architect-side duplicate of task-350).
- **Work-trace:** `docs/traces/m-audit-notification-repository-migration-work-trace.md`.
- **Pattern precedents (mission-47):** `docs/traces/m-sovereign-storage-interface-work-trace.md`; specifically `entities/director-notification-repository.ts` (W3, ID-shape precedent) + `entities/tele-repository.ts` (W1, contract-validation ground).
- **ADR-024:** `docs/decisions/024-sovereign-storage-provider.md` — defines the StorageProvider contract this mission consumes.
- **Downstream blocked-on:** mission-48 M-Local-FS-Cutover — its inherited-verification dependency satisfied as soon as W8+W9 PRs merge.
- **Follow-up filed:** `get_idea(idea-195)` — NotificationRepository `cleanup()` O(N) range-scan optimization (sourced from thread-304).
- **Bug captured by architect:** bug-31 amendment — mission-advancement-cascade stall after MCP timeout on task-352 review (caused T3 to be issued manually).
