# ADR-011: GCS Concurrency Model — Named Primitives and Write-Path Invariant

**Date:** 2026-04-17
**Status:** Accepted
**Threads:** thread-110
**Supersedes:** (none — formalises post-Mission-20 invariant)
**Complements:** ADR-005 (Persist-First Notifications), ADR-009 (Cloud Run `max-instances=1`)
**Mission:** Mission-20 (GCS Concurrency Hardening)

## Decision

All GCS writes to paths that may already exist go through one of three named concurrency-aware primitives exported from `hub/src/gcs-state.ts`:

| Primitive        | When to use                                                                                              | Preconditions                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `createOnly`     | Fresh ID that nothing else should be writing (mission create, task create, proposal create, ...)         | `ifGenerationMatch=0`: write fails if the object exists   |
| `updateExisting` | Read-modify-write on an object that must already exist (gated state transitions, append to messages)     | Reads with generation, writes with `ifGenerationMatch=gen`; retries on precondition failure; throws `GcsPathNotFound` if absent |
| `upsert`         | Either-create-or-update where concurrent racing is possible (not currently used in entity paths)         | Same as `updateExisting` but tolerates missing-path       |

The raw `writeJson` helper is **not exported**. It remains module-internal in `gcs-state.ts` and is reserved for a short list of documented exceptions (counter updates, intentional blind mirror writes). Attempts to add naked `writeJson` imports from outside the module must fail compilation.

## Context

### The Lost-Update Bug Class

Prior to Mission-20, every `Gcs*Store.update*` method followed the pattern:

```typescript
const current = await readJson(bucket, path);
if (!current) return null;
// apply mutations
await writeJson(bucket, path, current);
```

Under concurrent writers, two callers could both read generation `N`, both mutate in memory, and both write — the second write silently clobbered the first. For scalar fields this was latent (the last-writer-wins value is often acceptable for updated metadata). For collection fields it was catastrophic: `task-223` was lost when two auto-linkage calls on `mission.tasks[]` raced.

### task-223 Triage → Mission-20

Task-223 was fixed by removing `mission.tasks[]` as a stored field and making it a virtual view over `task.correlationId` (see `policy-network-v1.md §6`). That was the right fix for that specific collection — it eliminated the RMW entirely rather than guarding it.

But the underlying class of bug was broader: any RMW on any field was vulnerable. Mission-20 Phase 1 (see `docs/history/mission-20-phase1-audit.md`) classified every naked RMW in `gcs-state.ts` into three tiers:

- **P1 — lost-update already observed or plausible on current hot path.** Fix by restructuring (virtual-view split) or deletion (dead code).
- **P2 — lost-update possible under concurrent writes; same-field contention.** Fix by CAS-wrapping (this ADR).
- **P3 — lost-update gated by a lock or by `max-instances=1`.** Leave guarded, document the assumption.

### Why Primitives, Not a Provider/Adapter

The initial convergence on thread-110 considered an `IStorageProvider` interface with `GcsStorageProvider` and `MemoryStorageProvider` implementations, managed by a `StorageManager`. We rejected that shape because:

1. The sovereign abstraction is already the `*Store` interface layer — policy code talks to `ITaskStore`, `IMissionStore`, etc. Interposing another abstraction between the *Store and GCS would be a third indirection for no new capability.
2. Each *Store already has a Memory variant for tests. A `MemoryStorageProvider` duplicates what `MemoryTaskStore` / `MemoryMissionStore` already provide.
3. The concurrency contract is a property of individual writes, not a property of a storage implementation. Named primitives make the intent (`createOnly` vs `updateExisting`) explicit at every call site; a generic `provider.write(path, data)` does not.

Functional primitives push the invariant down to the write call and out of the store's mental model, which is what thread-110 converged on.

## The Write-Path Invariant

> **No code outside `hub/src/gcs-state.ts` may write a JSON path that has ever existed without going through `createOnly` / `updateExisting` / `upsert`.**

Enforced by:

1. `writeJson` is declared `async function writeJson(...)` — **not exported**. TypeScript blocks any external import.
2. The Mission-20 Phase 1 audit catalogues the three remaining internal `writeJson` sites and why each is safe under today's deployment (all P3 under `max-instances=1`; two are intentional blind mirrors following an authoritative OCC write).
3. New write paths must declare their concurrency intent by primitive choice; this ADR is the gate.

## The CAS Retry Loop

`updateExisting` and `upsert` are both thin wrappers around `__casRetryForTest` (also exported for unit-test harness use). The loop:

1. Read the path with its GCS `generation`.
2. Apply `transform(current)` to produce the next state.
3. Write with `ifGenerationMatch=<generation>`.
4. If the write succeeds, return.
5. If the write fails with `GcsOccPreconditionFailed` (HTTP 412), sleep with jittered exponential backoff and go to step 1.
6. If any other error escapes `transform` or the writer, propagate immediately (not retried — business gates and infra errors are authoritative).
7. After 5 attempts, throw `GcsOccRetryExhausted`.

Constants: `OCC_RETRY_MAX_ATTEMPTS = 5`, `OCC_RETRY_INITIAL_BACKOFF_MS = 20`. Each attempt sleeps `base + jitter` where `base = 20 * 2^attempt` and `jitter ∈ [0, base)`. Worst-case total sleep before exhaustion: ~600ms.

### Business Gates Are Not Retried

State-machine gates (e.g. "only cancel a pending task", "only reply when it's your turn on an active thread") throw a module-internal `TransitionRejected` from inside the `transform`. The CAS loop only retries on `GcsOccPreconditionFailed` — any other error (including `TransitionRejected`) propagates out. Call sites catch `TransitionRejected` / `GcsPathNotFound` and map to their existing `false` / `null` return contracts.

This matters because the gate check must run against the freshly-read state. Retrying on a gate failure would spin forever if the gate is closed; failing fast gives the caller a crisp answer.

## Documented Exceptions (Internal `writeJson` Callers)

The three remaining `writeJson` call-sites inside `gcs-state.ts`:

| Site                              | Path                                      | Why safe                                                                                       |
| --------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `getAndIncrementCounter`          | `meta/counter.json`                       | Guarded by in-process `AsyncLock` + Cloud Run `max-instances=1`. Latent P2; revisit on scale-out. |
| `reconcileCounters`               | `meta/counter.json`                       | Startup-only; same lock; reads current state first.                                             |
| `registerAgent` / `touchAgent` / `markAgentOffline` (per-engineer + by-fingerprint mirrors) | `agents/<eid>.json`, `agents/by-fingerprint/<fp>.json` | Authoritative write went through `writeJsonWithPrecondition` against the by-fingerprint index; the per-engineer file is a best-effort mirror for list convenience. A lost mirror write is reconciled on next registration. |

Each is commented in code with a reference back to this ADR.

## Consequences

### Positive

- Every RMW that could previously lose an update now either succeeds atomically, retries with backoff, or fails loudly with `GcsOccRetryExhausted`. No silent overwrites.
- The write-path invariant is enforceable at compile time — `writeJson` is not in scope outside `gcs-state.ts`.
- Primitive names read as intent at the call site: a reviewer can tell at a glance that `createOnly` must never collide, that `updateExisting` requires the object to exist, that `upsert` tolerates either state. No more reading surrounding code to decipher what a `writeJson` call means.
- `__casRetryForTest` provides deterministic unit coverage (8 tests, `hub/test/unit/gcs-occ-primitives.test.ts`) with injected reader/writer/sleep.

### Negative

- Every RMW is now two GCS round-trips (read + write). Under today's low traffic this is negligible; under scale-out it's the cost of correctness.
- Transform functions run multiple times on contention — they must be **idempotent** (no external side-effects, no reliance on mutable outer-scope state that differs across retry attempts). This is a new contract call-sites must respect.
- The CAS loop cannot protect against writes that span multiple GCS paths. Cross-path atomicity (e.g. updating a task and appending to an audit entry in one step) remains eventually-consistent; failures between the two writes leave the system in an intermediate state. This is out-of-scope for Mission-20 and accepted as the cost of using GCS as the system-of-record.

### Neutral

- Under Cloud Run `max-instances=1` (ADR-009), the OCC guards are effectively dormant — there are no concurrent writers in prod today. The primitives are a pre-requisite for lifting the instance pin; Mission-20 is the prep work, not the scale-out event itself.
- Phase 3 of Mission-20 will fold the remaining stored collections (`Thread.messages`, audit daily log rollup) into virtual views or deletions, further shrinking the RMW surface. Those changes will reference this ADR.

## Implementation

- Primitives and error types: `hub/src/gcs-state.ts` lines 97–296.
- `TransitionRejected` sentinel (module-internal): same file, after the retry constants.
- Entity-store migrations: `hub/src/entities/gcs/gcs-{idea,tele,turn,mission}.ts`.
- Internal *Store migrations: `GcsTaskStore`, `GcsProposalStore`, `GcsThreadStore`, `GcsAuditStore`, `GcsNotificationStore` in `gcs-state.ts`.
- Unit tests: `hub/test/unit/gcs-occ-primitives.test.ts` (8 tests covering happy-path, retry-then-succeed, retry exhaustion, missing-path, transform-error propagation, non-precondition writer-error propagation, and backoff bounds).
- Phase 1 audit reference: `docs/history/mission-20-phase1-audit.md`.
- Mission brief: `docs/history/mission-20-gcs-concurrency-hardening.md`.
