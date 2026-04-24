# M-Sovereign-Storage-Interface — Work Trace (live state)

**Mission scope.** Mission-47 — harden hub storage into a sovereign architectural surface. CSI-inspired `StorageProvider` contract packaged as `@ois/storage-provider/`, parallel to `@ois/network-adapter` + `@ois/cognitive-layer`. Entity repositories compose the provider without backend-specific branches.

**Mission brief:** `get_mission(mission-47)` (Hub entity; cascade-spawned from thread-290 action-1).
**Design round:** thread-290 (architect lily + engineer greg, converged 2026-04-24).
**Release-gate:** thread-291 (Director approval, 2026-04-24).
**ADR:** [`docs/decisions/024-sovereign-storage-provider.md`](../decisions/024-sovereign-storage-provider.md).
**Coordination model:** Option C hybrid — DAG-driven serialization + 4 architect-gated checkpoint threads (post-T1, post-W1, pre-W7, T5) + routine waves via normal PR-review.
**How to read + update this file:** `docs/traces/trace-management.md`.

**Status legend:** ▶ in-flight · ✅ done this session · ○ queued / filed · ⏸ blocked

---

## Resumption pointer (cold-session brief)

If you're picking up cold on mission-47:

1. **Read this file first**, then the ADR (`docs/decisions/024-sovereign-storage-provider.md`), then thread-290 + thread-291 for convergence context.
2. **DAG:** T1 → T2 (W1..W7) → T3 → T4 → T5. Sequenced; next wave unblocks on prior merge.
3. **Current state:** T1 complete + PR up (see In-flight below). Awaiting architect post-T1 acceptance thread before W1 unblocks.
4. **Pre-authorized carve-outs:** Agent (W7) to sibling mission if contract gaps surface in W1-W5; L-escalation honest-flag.
5. **Ship-green discipline:** each wave adds conformance + repository tests + removes legacy per-backend entity tests in its own PR. Tests are first-class scope per Director direction.

---

## In-flight

- ▶ **T2-W2 — bug + idea repository migrations.** PR #12 open against main. Hub CI green (`vitest (hub)` passing; continue-on-error cells as expected). Awaiting architect routine-review.
- ▶ **T2-W3 — director-notification repository migration.** PR #13 stacked on #12. Awaiting review.
- ▶ **T2-W4 — mission repository migration.** PR #14 stacked on #13. Virtual-view hydration + plannedTasks cascade preserved. Awaiting review.
- ▶ **T2-W5 — task + proposal repository migrations.** PR #15 stacked on #14. FSM gates preserved via TransitionRejected sentinel → boolean/null mapping. Awaiting review.
- ▶ **T2-W6 — thread repository migration.** PR #16 stacked on #15. Awaiting review.
- ▶ **T2-W7a — turn + pending-action repository migrations.** Shipped locally on `agent-greg/mission-47-t2-w7-turn-pendingaction-agent` (stacked on W6). Hub suite 706/711 pass. Turn virtual-view hydration preserved (missionIds + taskIds computed on read). PendingAction natural-key idempotency preserved (INV-PA2); all FSM gates preserved via TransitionRejected with save_continuation/resume_continuation log parity. No contract drift surfaced — honest-flag did not trigger. Pre-W7 gate (thread-296) converged with `close_no_action`. **Agent (W7b) deferred to fresh session** — see handoff note below.
- ○ **T2-W7b — agent repository migration (pending).** Agent migration is the largest/most complex surface in the mission (MemoryEngineerRegistry + GcsEngineerRegistry combined ~900+ lines: M18 handshake, session-claim, displacement rate-limit, reaper, migrateAgentQueue). W7a shipped with zero contract drift, so architect's Option 1 go-signal stands — Agent ships in-mission. But doing justice to the Agent surface requires a fresh session; ramming it through while context is tight risks honest-flag-worthy shortcuts. Will open a continuation thread once W7a lands + architect has reviewed.

## Queued / filed
- ○ **T3 sync script + STORAGE_BACKEND=local-fs wiring** — blocked on W7.
- ○ **T4 comparative latency measurement** — blocked on T3.
- ○ **T5 closing audit + hygiene** — blocked on T4; mission-status flip architect-gated.

---

## Done this session

### T2-W7a (turn + pending-action repository migrations) — shipped 2026-04-24

- ✅ **`hub/src/entities/turn-repository.ts` — `TurnRepository implements ITurnStore`.** Composes `StorageProvider` + shared `StorageBackedCounter` + missionStore/taskStore (for virtual-view hydration). Layout `turns/<id>.json`. Virtual-view hydration preserved: `missionIds` + `taskIds` computed on read from injected stores by `turnId` match (mirrors MissionRepository pattern from W4).
- ✅ **`hub/src/entities/pending-action-repository.ts` — `PendingActionRepository implements IPendingActionStore`.** Composes `StorageProvider` + `StorageBackedCounter`. Layout `pending-actions/<id>.json`. Natural-key idempotency (INV-PA2) preserved via list+filter at enqueue time. All FSM gates + save_continuation/resume_continuation flow preserved through a single `tryCasUpdate` helper; gate failures throw `TransitionRejected` (surfaces warn-log with the legacy "save_continuation:" / "resume_continuation:" prefix for parity) and map to null.
- ✅ **Legacy classes deleted.** `MemoryTurnStore` removed from `turn.ts`; `gcs/gcs-turn.ts` deleted. `MemoryPendingActionStore` (~230 lines) removed from `pending-action.ts`; `gcs/gcs-pending-action.ts` (~360 lines) deleted. The `hub/src/entities/gcs/` directory is now empty and removed — all GCS-specific entity stores have been fully migrated to the Repository pattern.
- ✅ **`hub/src/index.ts` fully unified.** All 10 migrated entities (Task, Proposal, Idea, Bug, Tele, DirectorNotification, Thread, Mission, Turn, PendingAction) now construct via repositories in a single shared block over the StorageProvider. Only 4 non-migrated backend-specific stores remain: EngineerRegistry (W7b pending), AuditStore, NotificationStore (different entity from DirectorNotification), ThreadStore (now migrated). The GCS/memory if-else branch only allocates those 4 plus the StorageProvider itself.
- ✅ **Test scaffolds updated.** `test-utils.ts` + `orchestrator.ts` both build TurnRepository + PendingActionRepository via the shared provider/counter.
- ✅ **`__debugSetItem` test-only escape hatch on PendingActionRepository.** Symmetric to `__debugSetTask` / `__debugSetThread` from W5/W6.
- ✅ **Test sweep (delegated to Agent).** 27 direct-mutation test sites rewritten across 2 files: `pending-action-prune.test.ts` (13 sites — 3 MemoryPendingActionStore constructors + 11 internal-Map mutations + 3 describe renames) and `gcs-pending-action.test.ts` (14 tests — full rewrite from `GcsFakeStorage + vi.mock` pattern to `MemoryStorageProvider + PendingActionRepository`; 2 race-backdating sites rewritten to `__debugSetItem`).
- ✅ **Obsolete gcs-p2-repro.test.ts deleted entirely.** After W6 removed the last remaining describe (GcsThreadStore), W7 removed the final GcsTurnStore describe with the gcs-turn.ts deletion. The file was down to just GcsTurnStore — deleted rather than leaving a 1-test vestigial file. All P2 reproduction coverage now lives in the `@ois/storage-provider` conformance suite + per-Repository casUpdate loops.
- ✅ **Verification.** tsc strict-mode clean; hub suite 706/711 pass (5 skipped; 707→706 delta = 1 extra P2 reproduction removed in the final file deletion; zero functional regressions).
- ⏸ **Agent (W7b) deferred to fresh session.** Pre-W7 gate (thread-296) issued Option 1 go-signal; W7a shipped with zero contract drift, so architect's go-signal stands. But the Agent surface (M18 + displacement + reaper + migrateAgentQueue) is large enough that doing it within the remaining session context would risk honest-flag-worthy shortcuts. Per the architect's standing L-escalation honest-flag, the right call is to pause here rather than half-ship Agent. Will open a continuation thread to lily once W7a PR lands.

### T2-W6 (thread repository migration) — shipped 2026-04-24

- ✅ **`hub/src/entities/thread-repository.ts` — `ThreadRepository implements IThreadStore`.** Composes `StorageProvider` + shared `StorageBackedCounter`. Largest repository. Per-file messages split preserved: scalar at `threads/<id>.json` + per-round entries at `threads/<id>/messages/<seq>.json` (ADR-011 Phase 3). Reply-path transform never RMWs a `messages[]` array — each new round appends a new per-file via `createOnly`.
- ✅ **Convergence bilateral-seal preserved.** `willConverge = converged && prevConverged` + forcing-function gate (Mission-21 Phase 1) + staged-action payload validation (Mission-24 Phase 2, M24-T4, INV-TH19) + `staged → committed` promotion. `ThreadConvergenceGateError` thrown from inside the transform propagates through CAS untouched (caller sees the domain-specific message to self-correct).
- ✅ **INV-TH17/18/20/22/23 preserved.** Agent-pinned turn enforcement; broadcast → unicast coercion on first reply; cascade back-link natural key; proposer shape `{role, agentId}` backfill-on-read; Summary-as-Living-Record at commit.
- ✅ **Reaper + unpin preserved.** `reapIdleThreads` uses listThreads → per-thread casUpdate with re-verification of idleness inside the transform (stale-snapshot-prefilter → authoritative-transform pattern). `unpinCurrentTurnAgent` similarly listThreads → per-match casUpdate with "still pinned to victim?" re-check inside the transform.
- ✅ **`normalizeThreadShape` + helpers (`normalizeRoutingMode`, `isThreadContext`, `normalizeStagedActionShape`) ported into the repository module** — they were `GcsThreadStore`-internal read-side normalisation. Backfill-on-read behavior preserved verbatim: convergenceActions default, routingMode normalisation, idleExpiryMs default, legacy proposer shape widening.
- ✅ **`cloneThread` exported from state.ts** (was private). Repository uses it for transform-isolation: transform mutates a clone of the normalized read; on throw (TransitionRejected / ThreadConvergenceGateError), the clone is discarded and CAS is never attempted.
- ✅ **Legacy classes deleted.** `MemoryThreadStore` removed from `state.ts` (309 lines). `GcsThreadStore` + all normalizeThreadShape helpers removed from `gcs-state.ts` (462 lines). `normalizeAgentShape` (still used by GcsEngineerRegistry) retained with its JSDoc intact. `entities/index.ts` barrel exports `ThreadRepository`.
- ✅ **`hub/src/index.ts` startup.** `threadStore` now constructed unconditionally via `new ThreadRepository(storageProvider, storageCounter)` in the shared repository block.
- ✅ **Test scaffolds updated.** `test-utils.ts` + `orchestrator.ts` both build ThreadRepository.
- ✅ **`__debugSetThread` test-only escape hatch.** Lets tests directly patch thread scalar state (bypassing FSM gates) for setup-only scenarios — symmetric to `__debugSetTask` added in W5.
- ✅ **Test sweep (delegated to Agent).** 16 direct-mutation sites across 4 test files rewritten: `thread-unpin.test.ts` (Category A — full rewrite to ThreadRepository), `thread-truncation.test.ts` (3 store constructions + listThreads assertion reframed to match shipped contract: listThreads does not hydrate per-file messages), `INV-TH6.test.ts` (1 mutation pattern), `wave3b-policies.test.ts` (12 mutation sites including 4 `injectStagedAction` helper conversions sync→async with 8 call sites updated). Also fixed a pre-existing bug in `thread-unpin.test.ts` where `openThread(...)` was being called with wrong positional arg shape.
- ✅ **Obsolete P2 reproduction removed.** `gcs-p2-repro.test.ts` GcsThreadStore section deleted (equivalent coverage in storage-provider conformance suite + Repository casUpdate). File now only retains `GcsTurnStore` reproduction (only entity not yet migrated — W7).
- ✅ **Verification.** tsc strict-mode clean; hub suite 707/712 pass (5 skipped; 711→707 delta = 4 obsolete GcsThreadStore P2 reproductions removed; zero functional regressions).

### T2-W5 (task + proposal repository migrations) — shipped 2026-04-24

- ✅ **`hub/src/entities/task-repository.ts` — `TaskRepository implements ITaskStore`.** Composes `StorageProvider` + shared `StorageBackedCounter`. Largest repository yet (~500 lines). Layout `tasks/<id>.json`; counter field `taskCounter`. Internal `tryCasUpdate` helper returns `boolean` — true on success, false when task missing OR transform throws `TransitionRejected`. This preserves the legacy `GcsTaskStore` pattern of "FSM gates inside transforms throw TransitionRejected; mutator maps to caller's boolean/null contract" — byte-for-byte.
- ✅ **Report / review Markdown blobs preserved.** `submitReport` and `submitReview` still write separate Markdown files at `reports/<taskId>-v<N>-report.md` and `reviews/<taskId>-v<N>-review.md` — matches legacy GCS layout exactly so existing report/review files remain grep-compatible. Blob write routes through `provider.put()` (durable on GCS, in-memory for tests).
- ✅ **In-process claim-serialization preserved.** `getNextDirective` + `getNextReport` both use a per-instance `Mutex` (`taskLock`) to serialize claim-polls — matches the historical `AsyncLock` in `gcs-state.ts`. Without this, two concurrent-in-process claim cycles would both walk the list before either CAS'd its claim.
- ✅ **Dependency cascade preserved.** `unblockDependents` + `cancelDependents` both first-pass scan tasks into an in-memory `Map<string, Task>` snapshot for the blocked-set identification, then CAS-update each candidate through `tryCasUpdate` with transforms that re-verify the gate against fresh state. Stale-snapshot prefilter → authoritative transform pattern preserved.
- ✅ **`hub/src/entities/proposal-repository.ts` — `ProposalRepository implements IProposalStore`.** Composes `StorageProvider` + shared `StorageBackedCounter`. Layout `proposals/<id>.json` + `proposals/<id>.md` (proposal body as separate Markdown blob — matches legacy layout). FSM gate on `closeProposal` preserved: submitted → {approved, rejected, changes_requested} → implemented (rejected states aren't direct-closeable).
- ✅ **Legacy classes deleted.** `MemoryTaskStore` + `MemoryProposalStore` deleted from `state.ts`. `GcsTaskStore` + `GcsProposalStore` removed from `gcs-state.ts` (replaced by redirect comments). `entities/index.ts` barrel now exports `TaskRepository` + `ProposalRepository`.
- ✅ **`hub/src/index.ts` startup.** `taskStore` + `proposalStore` now constructed via repositories in the shared block, BEFORE `missionStore` (mission hydration depends on taskStore). Backend-specific block shrinks further — only engineerRegistry, threadStore, auditStore, notificationStore, pendingActionStore + storageProvider remain backend-branched.
- ✅ **Test scaffolds updated.** `test-utils.ts` + `orchestrator.ts` now build TaskRepository + ProposalRepository via the shared provider/counter.
- ✅ **`__debugSetTask` test-only escape hatch.** Added to TaskRepository. Lets tests directly patch a task's on-disk state (bypassing FSM gates) for setup-only scenarios that can't be reached through the public API — e.g., directly setting `status: "failed"` or `revisionCount: 3`. Replaces the legacy pattern of poking `(store as any).tasks.get(id).field = value` against MemoryTaskStore's private Map.
- ✅ **Test sweep (delegated to Agent).** 16 direct-mutation test sites across 4 files rewritten to use `__debugSetTask`: `task-316-mission-advancement.test.ts` (9), `policy-router.test.ts` (4 blocks), `e2e/invariants/INV-T4.test.ts` (1), `mission-19/p2p.test.ts` (2 blocks).
- ✅ **`mission-19/claim.test.ts`.** Direct user of `MemoryTaskStore` rewritten to construct a `TaskRepository` over a fresh `MemoryStorageProvider` + `StorageBackedCounter`.
- ✅ **Obsolete P2 reproductions removed.** `gcs-p2-repro.test.ts` — GcsTaskStore's 9 P2 reproduction blocks + GcsProposalStore's 2 blocks removed (equivalent coverage in storage-provider conformance suite + Repository casUpdate). GcsTurnStore + GcsThreadStore reproductions retained for W6.
- ✅ **Verification.** tsc strict-mode clean; hub suite 711/716 pass (5 skipped; 722→711 delta = 11 obsolete GcsTaskStore + GcsProposalStore P2 reproductions removed; zero functional regressions).

### T2-W4 (mission repository migration) — shipped 2026-04-24

- ✅ **`hub/src/entities/mission-repository.ts` — `MissionRepository implements IMissionStore`.** Composes `StorageProvider` + shared `StorageBackedCounter` + the hydration dependencies `taskStore` + `ideaStore`. Layout `missions/<missionId>.json`; counter field `missionCounter`. Virtual-view hydration preserved — `tasks` + `ideas` computed on read from the injected stores by `correlationId` / `missionId`, matching the historical comment in `mission.ts` about why hydration lives on the read path (prior stored-array implementation lost writes under concurrent auto-linkage).
- ✅ **task-316 / idea-144 Path A preserved.** `markPlannedTaskIssued` + `markPlannedTaskCompleted` both routed through the shared internal `casUpdate` helper. Transform predicate short-circuits (no mutation) when the slot is already transitioned — matches the legacy FSM gates. Returns the transitioned PlannedTask via a closed-over `result` variable (the transform returns the mission itself).
- ✅ **Legacy classes deleted.** `MemoryMissionStore` removed from `hub/src/entities/mission.ts` (unused `ITaskStore` import also dropped). `hub/src/entities/gcs/gcs-mission.ts` deleted. `entities/index.ts` barrel now exports `MissionRepository`.
- ✅ **`hub/src/index.ts` startup.** `missionStore` instantiated via `new MissionRepository(storageProvider, storageCounter, taskStore, ideaStore)` — unified with the other repositories. `turnStore` construction remains backend-specific (W6) but now only sees a single if/else branch.
- ✅ **Test scaffolds updated.** `hub/src/policy/test-utils.ts` + `hub/test/e2e/orchestrator.ts` — both now build `MissionRepository` through the shared provider/counter.
- ✅ **Obsolete P2 reproduction removed.** `hub/test/unit/gcs-p2-repro.test.ts` — `GcsMissionStore.updateMission` lost-update reproduction deleted (equivalent coverage via storage-provider conformance suite + MissionRepository `casUpdate`).
- ✅ **Wave2-policies.test.ts seed updated.** `seedMissionsWithCreatedBy` rewritten to use the public `createMission(title, description, undefined, undefined, createdBy)` API (was poking the now-removed internal `(ctx.stores.mission as any).missions` Map).
- ✅ **Verification.** tsc strict-mode clean; hub suite 722/727 pass (5 skipped; baseline delta: 1 obsolete GcsMissionStore reproduction removed; zero regressions).

### T2-W3 (director-notification repository migration) — shipped 2026-04-24

- ✅ **`hub/src/entities/director-notification-repository.ts` — `DirectorNotificationRepository implements IDirectorNotificationStore`.** Composes `StorageProvider` + shared `StorageBackedCounter` (field: `directorNotificationCounter`, already declared in `Counters` interface). Layout `director-notifications/<id>.json` matches historical GCS keyspace. ID shape preserved: `dn-${YYYY-MM-DD}-${NNN.padStart(3)}` — date prefix is cosmetic; counter is a single running integer (not per-day reset), matching legacy behavior. `acknowledge` has its own CAS loop (not a generic `casUpdate`) because idempotent-early-return (INV-DN2: already-ack'd notifications return unchanged without a write) is a cleaner shape than a transform predicate.
- ✅ **Legacy classes deleted.** `MemoryDirectorNotificationStore` removed from `hub/src/entities/director-notification.ts`. `hub/src/entities/gcs/gcs-director-notification.ts` deleted entirely. `entities/index.ts` barrel now exports `DirectorNotificationRepository` in place of `{Memory,Gcs}DirectorNotificationStore`.
- ✅ **`hub/src/index.ts` startup.** `directorNotificationStore = new DirectorNotificationRepository(storageProvider, storageCounter)` appended to the unified repository block.
- ✅ **Test scaffolds updated.** `hub/src/policy/test-utils.ts` + `hub/test/e2e/orchestrator.ts` — both now build DirectorNotificationRepository via the shared `storageProvider` + `storageCounter`.
- ✅ **Verification.** tsc strict-mode clean; hub suite 723/728 pass (5 skipped; baseline preserved).

### T2-W2 (bug + idea repository migrations) — shipped 2026-04-24

- ✅ **`hub/src/entities/idea-repository.ts` — `IdeaRepository implements IIdeaStore`.** Composes any `StorageProvider` + the shared `StorageBackedCounter` (same instance as W1's tele repo). Layout `ideas/<ideaId>.json` matches historical GCS keyspace. `updateIdea` via internal `casUpdate` (read-with-token → transform → putIfMatch). Missing-idea returns null; all other errors propagate. `findByCascadeKey` uses list+filter (suitable for v1 volumes; indexed lookup deferred to idea-186 if needed).
- ✅ **`hub/src/entities/bug-repository.ts` — `BugRepository implements IBugStore`.** Symmetric pattern to IdeaRepository. Layout `bugs/<bugId>.json`; counter field `bugCounter`. `findByCascadeKey` + `findBySourceIdeaId` via list+filter. Defensive clones on read/returns (bug.tags, linkedTaskIds, fixCommits are mutable arrays).
- ✅ **Legacy classes deleted.** `MemoryIdeaStore` removed from `hub/src/entities/idea.ts`, `MemoryBugStore` from `hub/src/entities/bug.ts`. `hub/src/entities/gcs/gcs-idea.ts` + `hub/src/entities/gcs/gcs-bug.ts` deleted entirely. `hub/src/entities/index.ts` barrel replaces `{Memory,Gcs}{Idea,Bug}Store` exports with `{IdeaRepository, BugRepository}`.
- ✅ **`hub/src/index.ts` startup restructure.** Repository instantiation block now builds Idea/Bug/Tele repositories up-front (single shared counter + provider). `missionStore` + `turnStore` construction moved below the repository block — they depend on `ideaStore`, so ordering matters. GCS vs memory branches now only allocate provider + legacy backend-specific stores; repository construction is backend-agnostic.
- ✅ **Test scaffolds updated.** `hub/src/policy/test-utils.ts` + `hub/test/e2e/orchestrator.ts` — both now build IdeaRepository + BugRepository + TeleRepository instead of legacy memory classes. Fresh provider + counter per test-context.
- ✅ **Obsolete P2 reproduction tests removed.** `hub/test/unit/gcs-p2-repro.test.ts` — the `GcsIdeaStore.updateIdea` lost-update reproduction section removed (GcsIdeaStore no longer exists). Equivalent concurrency coverage now lives in the storage-provider conformance suite (CAS primitive) + implicit in IdeaRepository `casUpdate`. Other P2 reproductions (mission/turn/task/proposal/thread) retained — those entities are not yet migrated.
- ✅ **Wave2-policies.test.ts seed updated.** 5 `seedWithCreatedBy` tests poked at internal `(ctx.stores.idea as any).ideas` Map. Rewritten to use the public `submitIdea(text, createdBy)` API directly, which is backend-agnostic.
- ✅ **Verification.** tsc strict-mode clean. Full hub suite 723 passing / 5 skipped / 0 failing — baseline preserved (725→723 delta explained: 2 obsolete GcsIdeaStore reproductions deleted; no new regressions).

### T2-W1 (tele repository migration) — shipped 2026-04-24

- ✅ **`hub/src/entities/counter.ts` — `StorageBackedCounter`.** Provider-agnostic CAS counter (replaces GCS-specific `getAndIncrementCounter` at the repository layer per ADR-024 §2.5). Uses `getWithToken` + `createOnly` bootstrap + `putIfMatch` retry loop. MAX_CAS_RETRIES=50; in-process Mutex preserves the serialized-counter guarantee from the historical `counterLock`. Full `Counters` interface preserved (`taskCounter`, `teleCounter`, ...) so wave-by-wave rollout doesn't require counter-file renumbering.
- ✅ **`hub/src/entities/tele-repository.ts` — `TeleRepository implements ITeleStore`.** Composes any `StorageProvider` + `StorageBackedCounter`. Layout `tele/<teleId>.json` matches historical GCS keyspace exactly. Read-side `normalizeTele` preserved (mission-43 zero-backfill). `supersedeTele` + `retireTele` via internal `casUpdate` method (read-with-token → transform → putIfMatch with retry; surfaces loudly on exhausted retries rather than silent stale state).
- ✅ **Legacy classes deleted.** `MemoryTeleStore` removed from `hub/src/entities/tele.ts`. `hub/src/entities/gcs/gcs-tele.ts` deleted entirely. `hub/src/entities/index.ts` barrel replaces `{Memory,Gcs}TeleStore` exports with `{TeleRepository, StorageBackedCounter, normalizeTele, Counters, CounterField, TeleStatus}`.
- ✅ **`hub/src/index.ts` startup.** Builds `StorageProvider` (MemoryStorageProvider for memory-mode, GcsStorageProvider for gcs-mode); shares it with `StorageBackedCounter`; instantiates `TeleRepository`. `let teleStore: ITeleStore` declaration unchanged — policy layer untouched.
- ✅ **Test scaffolds updated.** `hub/src/policy/test-utils.ts` + `hub/test/e2e/orchestrator.ts` — both now build MemoryStorageProvider + StorageBackedCounter + TeleRepository instead of MemoryTeleStore. Fresh provider per test-context (no state leakage).
- ✅ **Hub dependency added.** `hub/package.json` gains `"@ois/storage-provider": "file:../packages/storage-provider"`. `prepare: tsc` script on storage-provider triggers automatic build during `npm install`; no tarball ceremony (distinct class from bug-30 adapter tarball issue).
- ✅ **Verification.** tsc strict-mode clean. Full hub suite 725 passing / 5 skipped / 0 failing — identical to pre-W1 baseline. No regressions; structural refactor only.

### T1 (contract + 3 providers + conformance suite + ADR-024) — shipped 2026-04-24

- ✅ **Design round thread-290 convergence.** Architect (lily) + engineer (greg) converged on revised brief. Key engineer-driven refinements: contract surface expanded to 6 primitives (added `createOnly` as first-class); CAS-is-prod-floor reframing (`cas:false` dev-only); counter-primitives-as-repository-helpers. 7-wave migration sequencing accepted as engineer-authored. Agent W7 pre-authorized carve-out with L-escalation honest-flag.
- ✅ **Release-gate thread-291 convergence.** Director approved via architect; Option C hybrid coordination model accepted; DAG + checkpoint gates agreed.
- ✅ **T1 — packages/storage-provider/ sovereign package scaffolded.**
  - `package.json` + `tsconfig.json` + `vitest.config.ts` (matches existing network-adapter + cognitive-layer conventions).
  - `src/contract.ts` — `StorageProvider` interface + `ProviderCapabilities` + `CreateOnlyResult` + `PutIfMatchResult` + `StoragePathNotFoundError` + `StorageProviderError` + optional `StorageProviderWithTokenRead` interface augmentation for read-with-token.
  - `src/memory.ts` — `MemoryStorageProvider` (cas:true, durable:false, concurrent:false). Monotonic-counter tokens; defensive copies on get/put.
  - `src/local-fs.ts` — `LocalFsStorageProvider` (cas:true, durable:true, concurrent:false). SHA-256 content-hash tokens (sidecar-free, deterministic). CAS via O_EXCL on createOnly + atomic rename-swap on put/putIfMatch. Path-traversal defense (rejects `..`). Tmp files filtered from list output.
  - `src/gcs.ts` — `GcsStorageProvider` (cas:true, durable:true, concurrent:true). Wraps `@google-cloud/storage` SDK directly at blob level; uses `ifGenerationMatch` for CAS primitives. Post-write metadata fetch to surface new generation as the next token. Precondition-failure recovery fetches current generation for retry.
  - `src/index.ts` — barrel export.
  - `test/conformance.ts` — CSI-style 20-case suite covering capabilities, get/put, list (empty/prefixed/nested/after-delete), delete (present/absent), createOnly (first/conflict/clobber-by-put), putIfMatch (not-found/match/stale/chained), path handling (nested/traversal), sequential consistency. Factory pattern: fresh provider per test, no state leakage.
  - `test/memory.test.ts` + `test/local-fs.test.ts` — per-provider test runners invoking the shared conformance suite. GCS intentionally not in CI (needs real bucket + auth; validated out-of-band).
  - `README.md` — contract summary, provider comparison table, testing + usage snippets.
- ✅ **ADR-024 Sovereign StorageProvider.** `docs/decisions/024-sovereign-storage-provider.md` — context, 6-primitive contract, capability semantics, token opacity, repository-owns-ID-gen decision, conformance suite, migration pattern, success anti-criterion, 5 alternatives considered + rejected, follow-ups.
- ✅ **Verification (T1 local ship-green).** 40/40 conformance tests pass (2 providers × 20 cases). TypeScript strict-mode clean. No CI run yet (awaiting PR push).

## Edges (dependency chains)

- T1 → W1 → W2 → W3 → W4 → W5 → W6 → W7 → T3 → T4 → T5 (linear DAG per architect thread-291).
- T1 → architect post-T1 acceptance thread → W1 unblock (first checkpoint gate).
- W1 → architect post-W1 contract-validation thread → W2 unblock (second checkpoint gate).
- W6 → architect pre-W7 Agent go/no-go thread → W7 unblock + L-escalation decision (third checkpoint gate).
- T5 → architect mission-close thread + mission-status flip (fourth checkpoint gate).

## Session log (append-only)

- **2026-04-24 07:50Z (AEST late evening)** — Architect opened thread-290 with design-round prompt for idea-189. Engineer engaged with code audit (60 CAS sites across 8 entities confirmed load-bearing) + 8-question response + contract pushback (must-have: `createOnly` as first-class primitive).
- **2026-04-24 07:59Z** — Architect accepted all engineer refinements; staged `propose_mission` with revised brief. Engineer bilateral-sealed thread-290; mission-47 files as `proposed`.
- **2026-04-24 08:00Z** — Director approved release-gate via architect (thread-291).
- **2026-04-24 08:07Z** — Engineer acknowledged Option C hybrid coordination model; accepted 11-task DAG without refinements. Bilateral-sealed thread-291; execution underway.
- **2026-04-24 ~08:10-08:20Z** — T1 scaffolding: `packages/storage-provider/` created; `package.json`, `tsconfig.json`, `vitest.config.ts` match existing-package conventions.
- **2026-04-24 ~08:20-08:25Z** — T1 core: `contract.ts` authored (6 primitives, capability flags, token opacity, errors).
- **2026-04-24 ~08:25-08:30Z** — T1 memory provider: `MemoryStorageProvider` with monotonic-counter tokens.
- **2026-04-24 ~08:30-08:40Z** — T1 local-fs provider: CAS via O_EXCL + atomic rename; SHA-256 content-hash tokens; path-traversal defense.
- **2026-04-24 ~08:40-08:50Z** — T1 GCS provider: wraps `@google-cloud/storage` SDK directly; generation-as-token; precondition-failure recovery.
- **2026-04-24 ~08:50-09:00Z** — T1 conformance suite: 20 CSI-style cases; factory pattern; skippable concurrency section.
- **2026-04-24 ~09:00Z** — `npm install` + `npx tsc --noEmit` clean + `npx vitest run` green (40/40 tests across memory + local-fs).
- **2026-04-24 ~09:00-09:15Z** — ADR-024 authored (full ratification document; 5 alternatives considered).
- **2026-04-24 ~09:15Z** — README + work trace (this file).
- **2026-04-24 ~17:00Z** — T2-W1 (tele repository migration) merged to main via PR #11 (stacked on T1 PR #10). Architect post-W1 contract-validation thread closed; W2 unblocked.
- **2026-04-24 ~19:00-19:15Z** — T2-W2 (bug + idea repository migrations) authored locally: IdeaRepository + BugRepository + idea.ts/bug.ts MemoryStore deletions + gcs-idea.ts/gcs-bug.ts deletion + index.ts barrel update + hub/src/index.ts startup restructure + test-utils.ts + orchestrator.ts migration + wave2 seedWithCreatedBy rewrite + gcs-p2-repro.test.ts obsolete GcsIdeaStore section removal. tsc clean; hub suite 723/728 pass (baseline preserved).
- **2026-04-24 ~19:15Z** — W2 pushed + PR #12 opened against main (routine wave per Option C).
- **2026-04-24 ~19:15-19:20Z** — T2-W3 (director-notification repository migration) authored locally on stacked branch `agent-greg/mission-47-t2-w3-director-notification`: DirectorNotificationRepository + MemoryDirectorNotificationStore deletion + gcs-director-notification.ts deletion + index.ts barrel update + hub/src/index.ts startup + test-utils.ts + orchestrator.ts migration. tsc clean; hub suite 723/728 pass (identical baseline).
- **2026-04-24 ~19:20Z** — W3 pushed + PR #13 opened stacked on W2 #12.
- **2026-04-24 ~19:20-19:30Z** — T2-W4 (mission repository migration) authored locally on stacked branch `agent-greg/mission-47-t2-w4-mission-repository`: MissionRepository (virtual-view hydration preserved; plannedTasks cascade preserved) + MemoryMissionStore deletion + gcs-mission.ts deletion + index.ts barrel update + hub/src/index.ts startup + test-utils + orchestrator migration + wave2 seedMissionsWithCreatedBy rewrite + gcs-p2-repro.test.ts obsolete GcsMissionStore section removal. tsc clean; hub suite 722/727 pass.
- **2026-04-24 ~19:30Z** — W4 pushed + PR #14 opened stacked on W3 #13.
- **2026-04-24 ~19:30-19:50Z** — T2-W5 (task + proposal repository migrations) authored locally on stacked branch `agent-greg/mission-47-t2-w5-task-proposal`. TaskRepository (~500 lines, largest yet) + ProposalRepository; FSM gates preserved via TransitionRejected sentinel pattern; report/review Markdown blobs preserved; claim-serialization Mutex preserved; dependency cascade preserved. Legacy MemoryTaskStore + MemoryProposalStore + GcsTaskStore + GcsProposalStore removed. `__debugSetTask` test-only escape hatch added. Test sweep delegated to Agent — 16 direct-mutation sites rewritten across 4 test files. `mission-19/claim.test.ts` rewritten to use TaskRepository. Obsolete P2 reproductions removed. tsc clean; hub suite 711/716 pass.
- **2026-04-24 ~19:50Z** — W5 pushed + PR #15 opened stacked on W4 #14.
- **2026-04-24 ~19:50-20:10Z** — T2-W6 (thread repository migration) authored locally on stacked branch `agent-greg/mission-47-t2-w6-thread-repository`. ThreadRepository (~500 lines) with per-file messages split preserved; staged-action convergence bilateral-seal preserved; INV-TH17/18/19/20/22/23 preserved; `normalizeThreadShape` helpers ported in; `cloneThread` exported from state.ts. MemoryThreadStore (309 lines) + GcsThreadStore (462 lines) removed. `__debugSetThread` escape hatch added. Agent test sweep: 16 direct-mutation sites across 4 files rewritten (thread-unpin full rewrite, thread-truncation adjustment for listThreads contract delta, INV-TH6 + wave3b-policies 12 sites including 4 injectStagedAction sync→async conversions). GcsThreadStore P2 reproduction deleted. tsc clean; hub suite 707/712 pass.
- **2026-04-24 ~20:10Z** — W6 pushed + PR #16 opened stacked on W5 #15.
- **2026-04-24 ~20:10Z** — Pre-W7 checkpoint thread opened: thread-295 (routing defect — architect's reply rejected with "not your turn" due to `recipientAgentId: "lily"` alias mismatch vs canonical `eng-40903c59d19f`). Architect workaround via thread-296 same minute.
- **2026-04-24 ~20:20Z** — Architect issued W7 Option 1 go-signal via thread-296: ship Agent in-mission. L-escalation honest-flag stays active if contract drift surfaces mid-W7. Canonical recipientAgentId captured to memory for future thread routing. Engineer acknowledged with `close_no_action` bilateral seal.
- **2026-04-24 ~20:30-20:45Z** — T2-W7a (turn + pending-action repository migrations) authored locally on branch `agent-greg/mission-47-t2-w7-turn-pendingaction-agent` (stacked on W6). TurnRepository + PendingActionRepository; virtual-view hydration preserved; natural-key idempotency + save/resume continuation preserved; `__debugSetItem` escape hatch added. MemoryTurnStore + MemoryPendingActionStore + gcs-turn.ts + gcs-pending-action.ts + empty gcs/ directory all deleted. `hub/src/entities/gcs/` now removed entirely — all 10 migrated entity stores construct via the repository pattern in a single unified block. Test sweep: 27 sites across 2 files (pending-action-prune + gcs-pending-action) rewritten. Obsolete gcs-p2-repro.test.ts deleted entirely after last describe became vestigial. tsc clean; hub suite 706/711 pass. Zero contract drift → architect's Option 1 go-signal stands.
- **2026-04-24 ~20:45Z** — W7b (Agent) deferred to fresh session per prudent-honest-flag reasoning: surface is large (~900 lines combined Memory+Gcs Engineer Registry with M18 handshake, displacement rate-limit, reaper, migrateAgentQueue), remaining session context is tight, risk of honest-flag-worthy shortcuts on Agent is non-zero. Pausing here is strictly better than half-shipping. Will open continuation thread to lily once W7a PR lands.

## Canonical references

- **Mission entity:** `mission-47` (`get_mission` for live state).
- **ADR:** `docs/decisions/024-sovereign-storage-provider.md`.
- **Design round:** thread-290.
- **Release-gate:** thread-291.
- **Package root:** `packages/storage-provider/`.
- **Conformance test entry:** `packages/storage-provider/test/conformance.ts`.
- **Related:**
  - idea-189 (source idea).
  - idea-186 (npm workspaces; soft benefits-from).
  - bug-30 (adapter tarball / cross-package-imports; narrow-gate stopgap).
  - bug-29 (GCS list latency; adjacent, not coupling).
