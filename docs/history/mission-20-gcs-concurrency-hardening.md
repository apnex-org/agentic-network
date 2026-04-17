# Mission Brief: GCS Read-Modify-Write Audit & Concurrency Hardening (Mission-20)

**Status:** Proposed
**Author:** Claude Code (engineer-claude-1, `eng-6889bc8b6932`)
**Date:** 2026-04-17
**Intended audience:** Architect for review; Engineer for execution
**Origin:** Thread-109, converged 2026-04-17. Raised during task-223 Phase 1 reproduction. task-223 is the pilot case for the virtual-view half of the pattern; this mission generalises the remediation.

---

## 1. Why this document exists

task-223 fixed a single symptom — `mission.tasks` silently dropped task IDs during M19 auto-linkage because `GcsMissionStore.linkTask` did a naked `readJson` → mutate → `writeJson` on a shared document under concurrent writers. The code that failed was three lines long, had existed in the store since it was written, and failed silently the instant concurrent load crossed a threshold.

The fix pattern (retire the stored array, compute the view on read) works for `mission.tasks` and `mission.ideas`. But the same read-modify-write shape — naked `readJson` → mutate → `writeJson` on a path with more than one potential writer — is pervasive across the GCS entity stores. Nothing else has burned us yet only because M19-class bursts haven't hit those paths.

Leaving the remaining sites exposed is structurally unacceptable for a platform whose whole purpose is multi-agent concurrency. This brief scopes a deliberate audit, abstraction, and migration pass to eliminate the class.

---

## 2. Summary

1. **Discovery.** Grep the entity stores for every `readJson` → mutate → `writeJson` pair on the same path. Classify each site by concurrency exposure (P1 / P2 / P3). Validate each classification against the actual writer model — some sites are FSM-gated and effectively single-writer despite appearing multi-writer.

2. **Abstraction.** Introduce three named call-site primitives at the storage layer: `createOnly`, `updateExisting`, `upsert`. Retire naked `writeJson` as a call site for anything other than initial creation. Capture the invariant in a new ADR.

3. **Implementation.** Migrate P1 sites to virtual-view (the task-223 pattern). Migrate P2 sites to `updateExisting` (CAS-wrapped). Leave P3 sites alone, or opt them into CAS for defense in depth if cheap.

The two halves of the remediation are structurally different — virtual-view **eliminates** the RMW; CAS **wraps** it. The brief treats them as distinct workstreams and lets each site's discovery evidence decide which half it gets.

---

## 3. The CAS vs. Virtual-View bifurcation

Architect's thread-109 framing mapped P1 → virtual-view and P2 → CAS. That framing is correct, with one refinement the brief carries forward:

- **The `updateExisting` / `updateJson` abstraction is a P2/P3 tool only.** It wraps CAS; P1 sites have no RMW left to wrap. `mission.tasks` post-task-223 has no `updateJson` call anywhere because the collection is no longer stored. Virtual-view migrations each require a bespoke "retire the stored collection" refactor, touching the entity shape, the writer paths, and any read-side callers that assumed the stored array was authoritative.

- **The P1 label is a hypothesis, not a default fix.** Some collection-shaped fields (notably `thread.messages`) are FSM-gated — only one party owns the turn at any moment — and may be effectively serialised by convention. When discovery confirms serialisation, CAS is sufficient and avoids the bespoke-refactor cost of virtual-view. When discovery shows genuine multi-writer contention, virtual-view wins. The classification column in the inventory is the hypothesis; the Phase 1 deliverable is the confirmation.

---

## 4. Phase 1 — Discovery: site inventory

### 4.1 Pre-audit inventory

I ran `grep -n "readJson\|writeJson" hub/src` and manually walked each hit. This is the seed inventory; Phase 1's job is to validate and refine it, not to re-enumerate from scratch.

#### P1 — Multi-writer collections (virtual-view candidates)

| # | Site | File:line | Collection field | Why P1 |
|---|------|-----------|------------------|--------|
| 1 | `GcsTurnStore.linkMission` | `hub/src/entities/gcs/gcs-turn.ts:79-89` | `Turn.missionIds[]` | Identical shape to the task-223 bug. Auto-linkage from concurrent `create_mission` calls. Not yet hit in prod. |
| 2 | `GcsTurnStore.linkTask` | `hub/src/entities/gcs/gcs-turn.ts:91-101` | `Turn.taskIds[]` | Same shape as #1, driven by concurrent `create_task`. Same risk profile. |
| 3 | `GcsThreadStore.replyToThread` | `hub/src/gcs-state.ts:1071-1101` | `Thread.messages[]` | **Hypothesis only** — `thread.currentTurn` gates writes to one party per round. May be P2 in practice; discovery decides. |
| 4 | `GcsAuditStore.logEntry` (markdown log) | `hub/src/gcs-state.ts:1170-1199` | `audit/log-YYYY-MM-DD.md` line-append | In-process `auditLock` serialises within one Cloud Run instance but does not cross replicas. JSON-per-entry writes at `audit/{id}.json` are already single-writer and safe; only the daily rollup markdown is at risk. |

#### P2 — State transitions (CAS candidates)

| # | Site | File:line | Field(s) updated |
|---|------|-----------|------------------|
| 1 | `GcsTaskStore.submitReport` | `hub/src/gcs-state.ts:446-484` | `Task.status`, `report*`, `verification` |
| 2 | `GcsTaskStore.cancelTask` | `hub/src/gcs-state.ts:527-537` | `Task.status` |
| 3 | `GcsTaskStore.requestClarification` | `hub/src/gcs-state.ts:539-549` | `Task.status`, `clarificationQuestion` |
| 4 | `GcsTaskStore.respondToClarification` | `hub/src/gcs-state.ts:551-561` | `Task.status`, `clarificationAnswer` |
| 5 | `GcsTaskStore.submitReview` | `hub/src/gcs-state.ts:563-604` | `Task.status`, `revisionCount`, `reviewAssessment` |
| 6 | `GcsTaskStore.unblockDependents` | `hub/src/gcs-state.ts:378-406` | `Task.status` (per-task inner loop) |
| 7 | `GcsTaskStore.cancelDependents` | `hub/src/gcs-state.ts:408-423` | `Task.status` (per-task inner loop) |
| 8 | `GcsTaskStore.getNextDirective` | `hub/src/gcs-state.ts:425-444` | `Task.status → working` (in-process `taskLock`; does not cross replicas) |
| 9 | `GcsTaskStore.getNextReport` | `hub/src/gcs-state.ts:486-511` | `Task.status → reported_*` (in-process `taskLock`; does not cross replicas) |
| 10 | `GcsIdeaStore.updateIdea` | `hub/src/entities/gcs/gcs-idea.ts:61-77` | `Idea.status`, `missionId`, `tags` |
| 11 | `GcsTurnStore.updateTurn` | `hub/src/entities/gcs/gcs-turn.ts:61-77` | `Turn.status`, `scope`, `tele` |
| 12 | `GcsMissionStore.updateMission` | `hub/src/entities/gcs/gcs-mission.ts:72-88` | `Mission.status`, `description`, `documentRef` |
| 13 | `GcsProposalStore.reviewProposal` | `hub/src/gcs-state.ts:994-1007` | `Proposal.status`, `decision`, `feedback` |
| 14 | `GcsProposalStore.closeProposal` | `hub/src/gcs-state.ts:1009-1019` | `Proposal.status` |
| 15 | `GcsProposalStore.setScaffoldResult` | `hub/src/gcs-state.ts:1021-1029` | `Proposal.scaffoldResult` |
| 16 | `GcsThreadStore.closeThread` | `hub/src/gcs-state.ts:1121-1130` | `Thread.status` |
| 17 | `GcsThreadStore.setConvergenceAction` | `hub/src/gcs-state.ts:1132-1140` | `Thread.convergenceAction` |

Entries 8 and 9 are mechanically protected by `taskLock` (in-process `AsyncLock`) but the Hub runs multi-replica on Cloud Run — the lock does not serialise across replicas. A second replica polling concurrently could assign the same task to two engineers. Currently no evidence of this in prod, but CAS closes it.

#### P3 — Single-writer / already OCC-safe

| # | Site | File:line | Status |
|---|------|-----------|--------|
| 1 | `getAndIncrementCounter` | `hub/src/gcs-state.ts:194-229` | In-process `AsyncLock` only. Cross-replica concurrent increments can duplicate IDs. **Borderline P2** — promote if discovery confirms multi-replica is live. |
| 2 | `GcsEngineerRegistry.registerAgent` | `hub/src/gcs-state.ts:687-795` | Already OCC with explicit retry loop. No change. |
| 3 | `GcsEngineerRegistry.touchAgent` | `hub/src/gcs-state.ts:846-872` | Already OCC, skip-on-conflict. No change. |
| 4 | `GcsEngineerRegistry.markAgentOffline` | `hub/src/gcs-state.ts:879-901` | Already OCC, skip-on-conflict. No change. |

### 4.2 Discovery deliverables

- Confirmed inventory: each row above either validated or reclassified, with one sentence of evidence (git-blame of the writer, grep of callers, FSM shape).
- Explicit decision on three borderline rows: `replyToThread` (P1 vs P2), `getAndIncrementCounter` (P3 vs P2), `audit markdown rollup` (P1 vs P3 via "single-replica in practice").
- Any new sites surfaced that the pre-audit missed (e.g., future entity stores added post-task-223).

---

## 5. Phase 2 — Abstraction

### 5.1 Call-site API

Three named primitives on the storage layer, exported from `hub/src/gcs-state.ts`:

```typescript
// Precondition: path must not exist. Fails with GcsOccPreconditionFailed if it does.
async function createOnly<T>(bucket: string, path: string, data: T): Promise<void>;

// CAS-wrapped update. Reads with generation, applies transform, writes with precondition.
// Internally: exponential-backoff retry up to N attempts (default 3) on precondition failure.
// Fails with GcsOccPreconditionFailed if path doesn't exist or retry budget exhausted.
async function updateExisting<T>(
  bucket: string,
  path: string,
  transform: (current: T) => T
): Promise<T>;

// For the rare legitimate either-create-or-update path.
async function upsert<T>(
  bucket: string,
  path: string,
  transform: (current: T | null) => T
): Promise<T>;
```

`writeJson` stops being a public call site. It remains as an internal primitive used by `createOnly` / `updateExisting` / `upsert` and by the OCC-safe registry paths that already handle preconditions themselves. New writers must go through one of the three named primitives or justify the exception in review.

The named-primitive shape (not `updateJson` alone, not `dangerouslyWriteWithoutPrecondition` as an opt-out) was an explicit refinement carried out of thread-109: call-site intent should be legible from the function name, and "rare legitimate either-or" should have its own name rather than hide inside `updateJson`'s null-handling.

### 5.2 ADR

Draft `docs/decisions/NNN-gcs-concurrency-model.md` (next available number) capturing:

- **Invariant:** no naked `writeJson` on an existing path. All mutating writes go through `createOnly` / `updateExisting` / `upsert`.
- **When to reach for virtual-view vs. CAS:** decision tree based on writer cardinality and FSM serialisation.
- **When to hold a stored collection:** the rare case where read-side cost dominates and the write path is provably single-writer.
- **Retry policy:** exponential backoff, max attempts, escalation on exhausted budget.
- **Test requirement:** every migrated site ships with a concurrency reproduction test that would have caught the regression before the fix.

---

## 6. Phase 3 — Implementation

### 6.1 P1 migrations (virtual-view)

For each confirmed P1 site, follow the task-223 template:

1. **Regression test first.** Drive N concurrent writers through the real policy router; assert every ID lands in the view. Must fail against the current implementation.
2. **Eliminate the stored collection.** Remove the array field from the stored entity JSON. Remove the `link*` method from the store interface and all implementations.
3. **Compose on read.** Give the store constructor dependencies on the source-of-truth stores; hydrate the view in `get*` / `list*`.
4. **Fix callers.** Any caller that assumed the stored array was authoritative gets updated.
5. **Pin the test.** Leave the regression test in the suite permanently — it is the invariant's durable guard.

Expected P1 migrations from the pre-audit:

- `Turn.missionIds` → compose from `MissionStore.listMissions()` filtered by a new `Mission.turnId` field (or via `correlationId` if we can co-opt it).
- `Turn.taskIds` → compose from `TaskStore.listTasks()` filtered by a new `Task.turnId` field.
- `audit/log-YYYY-MM-DD.md` → either drop the rollup entirely (JSON-per-entry already exists) or regenerate it from the JSON files on read/request.

`Thread.messages` stays in its current shape pending Phase 1 validation — virtual-view for messages would mean writing each message as its own file, which is a larger commitment and only worth it if FSM serialisation turns out to be violable.

### 6.2 P2 migrations (CAS-wrapped)

For each P2 site, mechanical:

1. Replace `readJson` + mutate + `writeJson` with a single `updateExisting` call.
2. The transform function becomes the body of the old RMW block.
3. Add a concurrency reproduction test driving N concurrent updates; assert final state is consistent (e.g., `revisionCount` strictly increments, `status` transitions obey the FSM).
4. Keep existing in-process locks in place — they reduce retry pressure without compromising correctness. Remove them only if they become load-bearing complexity.

P1 and P2 can parallelise once Phase 2 (primitives + ADR) lands. They don't share code paths.

### 6.3 Rollout sequence

1. Phase 2 primitives + ADR (serial prerequisite).
2. P1 migrations and P2 migrations in parallel, site-by-site, each with its own regression test.
3. Final pass: grep for any remaining `writeJson` call sites outside `createOnly` / `updateExisting` / `upsert` / the OCC registry paths. Each remaining call is either justified (initial creation) or migrated.

---

## 7. Test strategy

Every migrated site ships with a test that **fails against the pre-migration code and passes against the migrated code**. The task-223 pattern is the template:

- Build the router and stores via the same test harness used in production policy wiring (`createTestContext`).
- Drive N concurrent operations through `Promise.all` — N=7 matches the M19 cohort and is sufficient to expose the race at scale.
- Assert the invariant the user sees (every ID lands, status transitions are consistent, no lost writes).
- Keep the test permanent. It is the invariant's regression guard, not a phase artefact.

For P1 migrations specifically, the test must still be meaningful after the virtual-view migration — the task-223 test continues to pass post-fix because the virtual-view composition is itself idempotent by construction. If a future change reintroduces a stored array, the test catches it.

---

## 8. Open questions

### 8.1 Is `Thread.messages` actually FSM-serialised, or can concurrent replies land?

The `currentTurn` field on a Thread gates `replyToThread` to one party. If both parties submit simultaneously, one should be rejected — but the rejection is checked via `readJson` and therefore may race against itself. Discovery needs to confirm whether the check is load-bearing or whether higher-level orchestration (who holds the floor) makes concurrent reply physically impossible.

### 8.2 Is `getAndIncrementCounter` running multi-replica in production?

If the Hub is single-replica today, the in-process `counterLock` is sufficient and P3. If it's multi-replica (or will be post-M19 scale-up), duplicate ID assignment is a real risk and the counter moves to P2 with CAS. Cloud Run's default scaling for the Hub service should be checked against its current config.

### 8.3 Does the audit markdown rollup still serve a purpose?

`audit/{id}.json` already gives a structured per-entry record. The daily markdown file is a human-readable rollup. If it's unused downstream, drop it; if it's referenced (by an ops runbook, a dashboard, a migration tool), regenerate on read instead of appending on write.

### 8.4 Migration ordering within P2

Some P2 sites interact (task status + mission linkage + turn linkage all touch during create_task flow). Migrating one site at a time is safer than batching, but implies each migration is independently reviewable — the brief assumes this is fine.

### 8.5 Does `updateExisting` need a retry-exhaustion callback?

If the retry budget is exhausted, the call fails. Some sites (task assignment, agent registration) have caller-level retry semantics; others (status transitions) probably should surface the failure to the user. Default policy is throw; override per-site if needed.

---

## 9. Out of scope

- Replacing GCS with a different storage backend. The OCC semantics of GCS generations are the substrate this brief builds on.
- Distributed locks across Cloud Run replicas. Not needed if the CAS + virtual-view split covers all sites.
- Migrating the `MemoryIdeaStore` / `MemoryMissionStore` / test doubles. Memory stores are single-threaded by construction. Tests that reproduce GCS concurrency must run against a GCS-compatible harness, not the memory stores.
- Counter reconciliation changes. `reconcileCounters` already handles recovery on startup.
- Any `packages/network-adapter` changes. The concurrency boundary is inside the Hub; adapters don't write to GCS.

---

## 10. Mission decomposition

Five tasks. Task A is serial; Tasks B and C parallelise after A; Tasks D and E parallelise after B.

**Task A — Phase 1 Discovery (~2-3 hours)**
Validate the pre-audit inventory. For each row, produce one sentence of evidence. Reclassify the three borderline rows. Surface any missed sites. Deliverable: updated inventory committed as an appendix to this brief or its own file.

**Task B — Phase 2 Abstraction: primitives (~2-3 hours)**
Implement `createOnly`, `updateExisting`, `upsert` in `gcs-state.ts`. Retry policy, backoff, error types. Unit tests covering happy path, precondition failure, retry exhaustion. Deliverable: new primitives exported, `writeJson` demoted to internal.

**Task C — Phase 2 Abstraction: ADR (~1-2 hours)**
Draft `docs/decisions/NNN-gcs-concurrency-model.md`. Invariant, decision tree, retry policy, test requirement. Deliverable: ADR ready for architect review.

**Task D — Phase 3 P1 migrations (~4-6 hours across 2-3 sites)**
For each confirmed P1 site from Task A: regression test, eliminate stored collection, compose on read, fix callers, pin test. Serial per site but independent across sites.

**Task E — Phase 3 P2 migrations (~4-6 hours across ~15 sites)**
For each P2 site: replace RMW with `updateExisting`, add concurrency reproduction test, keep existing locks. Mechanical; can be batched by entity (all `GcsTaskStore` in one commit, all `GcsProposalStore` in another, etc.).

Parallelisation: A → (B ∥ C) → (D ∥ E). Estimated total: 14-20 engineering hours.

---

## 11. Exit invariants

The mission is complete when all of the following hold:

1. Every confirmed P1 site has been migrated to virtual-view, with a concurrency reproduction test in the permanent suite.
2. Every confirmed P2 site has been migrated to `updateExisting`, with a concurrency reproduction test in the permanent suite.
3. `grep -n "writeJson" hub/src` returns only: (a) calls inside the three named primitives, (b) calls inside the OCC-safe registry paths, (c) calls inside initial-creation paths that `createOnly` would also cover (optional future migration).
4. The GCS Concurrency Model ADR is committed and linked from the architecture index.
5. `writeJson` is no longer exported from `gcs-state.ts`'s public surface (or is explicitly marked internal with a lint rule / comment).
6. The task-223 mission-integrity test and every new concurrency reproduction test pass, and each would have failed against its pre-migration code.

---

## 12. Appendix: relationship to task-223

task-223 is the pilot case for the virtual-view half of this mission. The code landed on 2026-04-17 and serves three roles for Mission-20:

- **Proof the pattern works.** The virtual-view migration of `mission.tasks` and `mission.ideas` eliminated the lost-write class at that site.
- **Template for P1 migrations.** Each P1 site in § 6.1 follows the same five-step shape.
- **Permanent regression guard.** `hub/test/mission-integrity.test.ts` stays in the suite. If a future change reintroduces a stored-array shape on Mission, the test catches it.

Mission-20 generalises the remediation. It does not re-do task-223's work.

---

*End of mission brief.*
