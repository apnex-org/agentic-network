# Mission-51 W0 — Storage Transactional Capability Spike Report

**Hub task id:** task-369
**Mission:** mission-51 M-Message-Primitive (Tier 1; Director-ratified Position A; activated 2026-04-25 ~19:35Z)
**Wave:** W0 (front-loaded sizing-determinant; investigation + recommendation, NOT implementation)
**Date authored:** 2026-04-25
**Author:** engineer (greg)

---

## TL;DR

- **Local-fs:** atomic SINGLE-entity (O_EXCL + atomic rename); NO native multi-entity transaction.
- **GCS:** atomic SINGLE-object (precondition-write via generation); NO native multi-object transaction.
- **Repository pattern (mission-47):** composes single-entity ops; does NOT compose into multi-entity transactional boundaries.
- **Existing cascade (mission "M-Cascade-Perfection Phase 1"):** already a saga / idempotency-keyed at-least-once execution, NOT a transaction. Each cascade action persists independently; per-action failure is isolated; recovery is implicit via `findByCascadeKey` short-circuit.

**Recommendations:**

- **W5 path (cascade transactional boundary):** **(c) hybrid lean-toward-(b)** — formalize the existing idempotency-keyed-saga pattern by adding an explicit `cascade_pending` marker on the parent thread + a Hub-restart sweeper. NO new multi-entity transactional primitive at the StorageProvider contract layer. Uses ONLY existing single-entity atomic primitives (`putIfMatch` for the marker; existing per-action `createOnly` + `findByCascadeKey` for the per-action idempotency). Composes uniformly across local-fs + GCS.

- **W2 path (thread-message normalization migration shim):** **async-shadow with bounded sweeper** — bounded shadow-lag AC ≤ 5s achievable with a polling sweeper OR an in-process projector firing on thread-reply commit. This is the natural fit because thread-messages are ALREADY stored as per-file entities (`threads/<id>/messages/<seq>.json`); W2 is a path-rewrite + kind-discriminator projection, not a scalar-to-entity decomposition. Each per-message projection is idempotent (same source → same target), so re-projection on sweeper restart is safe.

- **Sizing call:** **L holds.** XL trigger #1 ("W0 finds atomic-transactions infeasible AND requires WAL/replay-as-primary architecture") does NOT fire — see §5 for full reasoning. The recommended W5 architecture is mechanical extension of the existing cascade machinery (single-file marker + restart-sweeper), not invention of new transactional infrastructure.

---

## 1. Empirical characterization per backend

### 1.1 StorageProvider contract surface

The sovereign six-primitive contract (`packages/storage-provider/src/contract.ts`) is deliberately storage-only and exposes ALL atomicity at the SINGLE-PATH granularity:

| Primitive | Semantics | Atomicity scope |
|---|---|---|
| `get(path)` | Read blob or null | N/A (read) |
| `list(prefix)` | List paths under prefix | N/A (read) |
| `delete(path)` | Idempotent remove | Single-path |
| `put(path, data)` | Unconditional write (clobbers) | Single-path |
| `createOnly(path, data)` | Atomic create-if-absent | **Single-path** |
| `putIfMatch(path, data, token)` | Read-modify-write CAS | **Single-path** |

There is no contract surface for cross-path atomicity. The contract docstring is explicit: *"the contract is deliberately storage-only — no entity semantics, no ID-generation helpers, no counter management."* Mission-47's success anti-criterion (*"if a repository ever has `if (provider instanceof GcsStorageProvider)`, the abstraction has leaked"*) means callers cannot reach beneath the contract for backend-specific multi-entity primitives.

### 1.2 Local-fs (`LocalFsStorageProvider`)

Capabilities: `{cas:true, durable:true, concurrent:false}`.

Single-path atomicity primitives:

- **`createOnly`** — `fs.open(path, "wx")` with `O_EXCL` semantics; on EEXIST returns `{ok:false}`. POSIX-atomic per-file.
- **`put`** — write to `.tmp.<random>` sidecar, then `fs.rename` to final path. Atomic-on-same-filesystem rename; readers see either old content or new content, never partial.
- **`putIfMatch`** — read-current-content + content-hash comparison + atomic-rename write. Single-writer assumed (`concurrent:false`); the read-check-write sequence is atomic from this process's view.

Multi-path atomicity: **not provided**. POSIX has no built-in multi-file atomic transaction. Pattern primitives that COULD be composed if the contract were widened:

| Pattern | Feasible on local-fs? | Caveats |
|---|---|---|
| Stage all N writes in a tmp-dir, atomic-rename the tmp-dir into place | Yes for N entities under a single parent dir | Single dir-rename is atomic; cross-dir staging requires separate renames (no longer single-atomic) |
| Write a manifest blob first, then write payloads, then commit-marker | Yes (composes single-path ops) | This IS the WAL pattern — at the application layer, not native |
| flock-coordinated multi-file write | Possible on POSIX but `concurrent:false` skips this | Architectural mismatch — local-fs is single-writer by ratified profile |

**Practical interpretation:** local-fs CAN host an application-layer WAL/saga pattern (write marker, write entities, write commit), but the StorageProvider contract does not surface a primitive to wrap "write N entities all-or-none." Composition of single-path ops is the only path.

### 1.3 GCS (`GcsStorageProvider`)

Capabilities: `{cas:true, durable:true, concurrent:true}`.

Single-object atomicity primitives:

- **`createOnly`** — `bucket.file(path).save(data, {preconditionOpts: {ifGenerationMatch: 0}})`; on 412 returns `{ok:false}`. Single-object atomic per GCS conditional-write semantics.
- **`putIfMatch`** — `ifGenerationMatch: <generation>`; on 412 fetches current generation and returns `{ok:false, currentToken: <gen>}`. Single-object atomic.
- **`put`** — unconditional save. Single-object atomic.

Multi-object atomicity: **not provided.** GCS Storage does not expose multi-object transactions (firestore does; storage doesn't). Pattern alternatives if the contract were widened:

| Pattern | Feasible on GCS? | Caveats |
|---|---|---|
| GCS native multi-object transaction | **No** | GCS ≠ Firestore; the GCS storage product has no transaction API |
| Commit-marker pattern (write payloads, write commit blob last) | Yes | Application-layer WAL; same shape as local-fs |
| Two-phase commit via marker object | Yes | More elaborate; same shape; requires a coordinator |

**Practical interpretation:** GCS is structurally identical to local-fs at the contract level — single-object atomic only; multi-object atomicity is an application-layer concern, not a backend capability.

### 1.4 Backend-uniformity observation

Local-fs and GCS expose identical atomicity granularity through the contract: single-path atomic CAS, no multi-path. **This is a feature, not a limitation:** the StorageProvider contract was designed (mission-47 thread-290 convergence) so that repository code does not branch on backend. Adding a multi-entity transactional primitive that ONE backend supports natively (e.g., a hypothetical Firestore provider) but the others would have to emulate would re-introduce the abstraction-leak that mission-47 explicitly disallowed.

The architectural answer for cross-entity atomicity is therefore at the application layer (above the contract), not at the contract layer.

### 1.5 Repository pattern (mission-47) composition

Mission-47 ratified twelve repositories over the StorageProvider contract (Thread, Notification, Audit, Mission, Task, Idea, Bug, Proposal, Tele, Turn, Agent, DirectorNotification + the post-mission-49 NotificationRepository v2 + AuditRepository v2). Each repository:

- Composes single-entity ops over the provider primitives.
- Manages its own ID generation, namespace path, JSON encoding, and CAS-retry loops.
- Does NOT expose multi-entity transactional shapes.

Cross-repository operations today (e.g., "convergence-action commits → spawn task → emit notification") are explicit per-step calls, not transactional. The cascade runner (next section) is the orchestrator.

### 1.6 Existing cascade orchestration (`hub/src/policy/cascade.ts`)

The cascade runner (post-mission "M-Cascade-Perfection Phase 1" / ADR-015) is the existing cross-entity workflow primitive. Key properties relevant to W5:

- **Per-action failure isolation** — explicit non-atomic. Quote from `runCascade`: *"per-action failure is isolated — one handler failure doesn't abort the remaining actions."* This is the OPPOSITE of all-or-none transactional semantics.
- **Idempotency via natural key** — `cascadeIdempotencyKey(thread, action) = {sourceThreadId, sourceActionId}`. For `kind: "spawn"` ActionSpecs, the runner pre-checks `findByCascadeKey` BEFORE execute; if the entity already exists, the action is `skipped_idempotent` with an `action_already_executed` audit entry.
- **Backlinks on spawned entities** — every cascade-spawned entity carries `{sourceThreadId, sourceActionId, sourceThreadSummary}`. This is the marker that makes idempotency lookup work.
- **Recoverability layers** — audit failures don't block dispatch (INV-TH26); dispatch failures don't block subsequent actions (subscribers recover via poll). Each persistent step is independently durable.
- **Depth bound** — `MAX_CASCADE_DEPTH = 3` prevents recursive-cascade explosions.

**The cascade is already a saga / at-least-once-with-idempotency execution model**, just without a top-level "transaction is in flight" marker. It works because each action's persistence is the marker for that action's completion (`findByCascadeKey` lookup over spawned entities).

What it lacks for W5's "single-transaction wrap per bug-31 closure":

- **No top-level cascade-pending marker.** If the Hub process dies AFTER thread converges but BEFORE all cascade actions complete, no scheduled re-runner fires. Recovery happens implicitly only if some external event re-triggers cascade for the same thread (and even then, only via idempotency short-circuit on already-completed actions).
- **No automated restart sweeper.** The orphaned mid-cascade thread sits idle; admin intervention or manual re-trigger is the only path.

Closing this gap is mechanical: add a top-level marker + restart sweeper, both built from existing single-entity primitives.

### 1.7 Existing saga-adjacent infrastructure: PendingActionItem (ADR-017)

`hub/src/entities/pending-action.ts` already implements a saga-style FSM for the agent-dispatch dimension:

```
enqueued → receipt_acked → completion_acked    (happy path)
        → escalated                            (Director handoff)
        → errored                              (non-recoverable)
        → continuation_required                (graceful exhaustion)
```

Every dispatched event that expects an agent response **enqueues a PendingActionItem BEFORE SSE fires** (INV-COMMS-L01). The FSM persists across Hub restarts; the queue is truth, SSE is delivery hint.

**This is the architectural template for W5.** The cascade architecture already has saga-style mechanics for the agent-dispatch dimension (PendingActionItem); extending the same pattern to the cross-entity Hub-internal dimension is precedent-aligned, not novel infrastructure.

### 1.8 Cross-entity scenarios from mission-51 brief — feasibility per backend

| Scenario | Local-fs | GCS | Notes |
|---|---|---|---|
| W2 "create message + remove duplication marker on thread" atomically | Single-tx: NO; via shim: YES | Single-tx: NO; via shim: YES | Each is single-entity atomic; sequence is at-least-once via sweeper; idempotency-by-source-message-id makes re-projection safe |
| W5 "approve task → spawn next task → flip plannedTask slot → emit notification" atomically | Single-tx: NO; via marker+sweeper: YES | Single-tx: NO; via marker+sweeper: YES | Same shape as existing cascade; needs explicit cascade-pending marker + restart-sweeper |
| W5 cascade-on-thread-converge (any of the 8 staged-action types) | Single-tx: NO; via marker+sweeper: YES | Single-tx: NO; via marker+sweeper: YES | Today: idempotency-keyed at-least-once with NO restart-sweeper. After W5: same with restart-sweeper. |

**Verdict:** identical feasibility profile across backends. The right architecture for both is the application-layer marker + sweeper composition (path b/c hybrid; details in §2).

---

## 2. W5 path recommendation

### 2.1 Pick: (c) hybrid that is operationally indistinguishable from (b)

Path (a) — wrap cascade in a single StorageProvider transaction — is **infeasible** without widening the contract surface in a way that mission-47's no-leakage discipline forbids.

Path (b) — write-ahead log / saga / replay-as-primary — is the architectural fit, but the existing cascade machinery is already 80% of the way there. The remaining 20% is the explicit cascade-pending marker on the parent thread + a Hub-restart sweeper that re-runs incomplete cascades.

Path (c) — hybrid where some backends use (a) and others use (b) — is **not warranted** because both backends have identical atomicity granularity (single-path only). There is no backend where (a) is achievable, so the "hybrid" collapses to (b) in all cases.

**Recommendation: formalize the existing saga pattern with two additions:**

#### 2.1.1 Cascade-pending marker on parent thread (single-entity atomic)

On thread-convergence path (`thread-policy.ts:handleThreadConvergedWithAction`), BEFORE invoking `runCascade`:

```typescript
// Single-entity CAS update on the thread itself — atomic via existing
// putIfMatch primitive. Sets cascadePending = true with the count of
// committed actions. Token-CAS prevents concurrent cascade re-entry.
await threadStore.casUpdate(threadId, (t) => ({
  ...t,
  cascadePending: true,
  cascadePendingActionCount: committedActions.length,
  cascadePendingStartedAt: new Date().toISOString(),
}));
```

After all cascade actions complete (success OR failure-isolated):

```typescript
await threadStore.casUpdate(threadId, (t) => ({
  ...t,
  cascadePending: false,
  cascadePendingActionCount: undefined,
  cascadePendingStartedAt: undefined,
  cascadeCompletedAt: new Date().toISOString(),
}));
```

Both steps use the existing `putIfMatch` primitive on the thread blob — single-entity atomic, no new contract surface.

#### 2.1.2 Hub-restart cascade-replay sweeper

On Hub startup, before serving traffic:

```typescript
// Scan threads for cascadePending=true; re-run cascade for each.
// Idempotency keys (findByCascadeKey) short-circuit already-completed
// actions — re-running is safe and bounded.
const orphans = await threadStore.findCascadePending();
for (const thread of orphans) {
  const committed = thread.convergenceActions.filter(a => a.status === "committed");
  await runCascade(ctx, thread, committed, thread.summary);
  await threadStore.clearCascadePending(thread.id);
}
```

The sweeper re-runs cascade for any thread that was mid-cascade when the previous Hub instance died. Idempotency-key short-circuit (existing `findByCascadeKey` per ActionSpec) ensures already-spawned entities are not duplicated; the sweeper only re-runs the actions that hadn't completed pre-crash.

#### 2.1.3 What this delivers

- **At-least-once cascade execution** (every committed action fires at least once across crashes/restarts).
- **Idempotent on retry** (existing per-spawn idempotency keys + per-update idempotent-by-construction semantics).
- **Bounded recovery time** (sweeper runs once at startup; not a steady-state polling concern).
- **No new contract primitives** (uses `putIfMatch` for the marker; uses existing `findByCascadeKey` for idempotency).
- **Backend-uniform** (works identically on local-fs + GCS; no capability-flag detection needed).
- **Aligns with PendingActionItem precedent** (ADR-017's saga FSM is the architectural template for the cross-entity dimension).

### 2.2 What this does NOT need

- A new `transaction()` primitive on StorageProvider.
- A separate WAL / journal storage namespace.
- A backend-capability flag for transactional support.
- A cross-process coordination layer (single-Hub-writer profile holds via existing `concurrent:false` enforcement on local-fs + start-hub.sh single-instance discipline).

### 2.3 W5 implementation surface size

The estimated implementation surface for W5 is bounded:

| Component | Approximate effort |
|---|---|
| `Thread` schema additions: `cascadePending`, `cascadePendingActionCount`, `cascadePendingStartedAt`, `cascadeCompletedAt` (all optional) | ~10 lines schema + Zod |
| `ThreadRepository` methods: `markCascadePending`, `clearCascadePending`, `findCascadePending` | ~30 lines + tests |
| `runCascade` wrapper in `thread-policy.ts:handleThreadConvergedWithAction` | ~10 lines (mark before, clear after) |
| Hub startup sweeper integration in `hub/src/index.ts` | ~20 lines |
| Tests: marker set/clear roundtrip; sweeper re-runs after simulated crash; idempotency short-circuit on re-run | ~5-7 tests |

Total: well under 1 eng-day for the W5 cascade-transactional layer. Mission-51's L sizing (1-1.5 eng-weeks for entire mission) is comfortable for this scope.

---

## 3. W2 path recommendation

### 3.1 Pick: async-shadow with bounded sweeper (lag AC ≤ 5s)

Thread messages are ALREADY stored as per-file entities (`threads/<threadId>/messages/<seq>.json`) per `ThreadRepository`'s "Per-file messages split (Phase 3 P1) preserved" docstring. Reply transform never RMWs an array; each new round appends a new per-file message via `createOnly`. This means W2 is fundamentally a **path-rewrite + kind-discriminator projection**, not a scalar-to-entity decomposition.

The migration shim shape:

#### 3.1.1 Source-of-truth policy during migration

- Phase A (W2 ship → W6 sunset): writes go to BOTH paths.
  - Existing path: `threads/<threadId>/messages/<seq>.json` (legacy thread-message)
  - New path: `messages/<messageId>.json` with `{kind: "thread-message", subkind: "reply", threadId, sourceMessageSeq, ...}` (universal message primitive)
- Reads can come from either; new code uses the universal message primitive; legacy thread-aware code keeps using the per-thread path.
- Phase B (W6): sunset legacy path; new path is sole source of truth.

#### 3.1.2 Atomicity strategy: async-shadow with sweeper

The two-write sequence (legacy path + new path) is NOT atomic. Strategy:

1. **Primary write to legacy path** (existing semantics; existing `createOnly` is single-entity atomic).
2. **Async-shadow projection to new path** via either:
   - **In-process projector** (tighter bound; fires on every thread-reply commit; bounded shadow-lag effectively zero in steady state) OR
   - **Polling sweeper** (looser bound; periodic scan of `threads/*/messages/` for entries with no shadow at `messages/<id>.json`; idempotent re-projection).
3. **Bounded shadow-lag AC ≤ 5s** — achievable via either path. In-process projector achieves ~ms; polling sweeper at 1-3s interval achieves bound trivially.

Each per-message projection is **idempotent**: same source `(threadId, seq)` always produces same target `messageId` (deterministic, e.g., `thread-msg-<threadId>-<seq>` or hash-based). Re-projection on sweeper restart is safe; `createOnly` returns `{ok:false}` on already-shadowed entries; the sweeper continues without duplicating.

#### 3.1.3 Why this beats transaction-wrap

There is no native two-path transaction available. A "transaction-wrap" via marker pattern would just BE the async-shadow with sweeper, dressed as a transaction. The async-shadow framing is honest about the at-least-once semantics, and is composable with the existing thread-reply hot path (no synchronous projection in the request path).

The bounded shadow-lag AC ≤ 5s is the durable contract; in-process projector + sweeper backstop together achieve it.

### 3.2 W2 implementation surface size

| Component | Approximate effort |
|---|---|
| Universal `Message` entity schema + Repository (depends on W1) | (W1 scope; not W2) |
| Thread-message → universal-message translator | ~50 lines pure function + tests |
| In-process projector hook in `ThreadRepository` reply path | ~20 lines |
| Polling sweeper for backstop / startup catch-up | ~50 lines + tests |
| Bounded-lag invariant test (write thread-reply, assert shadow visible within 5s) | ~3-5 tests |

Total: well under 2-3 eng-days for W2. No new transactional infrastructure; idempotent-by-construction projection.

---

## 4. Sizing call: L holds

Mission-51 was sized **L (1-1.5 eng-weeks)** in thread-311 round-3 ratification. The pre-authorized XL trigger #1 from the brief: *"W0 finds atomic-transactions infeasible AND requires WAL/replay-as-primary architecture"*.

### 4.1 Trigger evaluation

The trigger has TWO conjunctive conditions that must BOTH fire:

1. **"atomic-transactions infeasible"** — ✅ TRUE. Both backends are single-path-atomic only; no native multi-entity transaction surface; widening the contract would violate mission-47's no-leakage discipline.

2. **"requires WAL/replay-as-primary architecture"** — ❌ FALSE.
   - The "WAL/replay-as-primary" framing implies inventing new transactional infrastructure (e.g., a separate journal namespace + replay-on-restart machinery + idempotency-key-store + in-flight-transaction state).
   - The recommended architecture (§2.1) does NOT invent that. It adds two single-entity flags to the existing `Thread` schema + a Hub-startup sweeper. The "replay" is just a re-run of existing cascade execution against threads tagged `cascadePending=true`. The "idempotency keys" already exist as `findByCascadeKey` lookups on spawned entities. The "in-flight state" is just a boolean on the thread.
   - Effectively: the existing cascade is already 80% saga; W5 fills in the remaining 20% (top-level marker + restart sweeper). That's a mechanical extension, not WAL-as-primary architecture.

**Trigger does NOT fire** — both conditions are needed; the second one is false.

### 4.2 Why L holds

- W5's cascade-transactional surface is bounded (< 1 eng-day; see §2.3).
- W2's migration shim is bounded (< 2-3 eng-days; see §3.2).
- Both compose ENTIRELY on existing single-entity atomic primitives. No new contract surface. No new sovereign infrastructure.
- The `Thread` schema additions are minimal (4 optional fields).
- The Hub-startup sweeper integration is a single function called once before traffic.
- Idempotency-by-construction (existing per-action `findByCascadeKey` + W2's deterministic source→target ID derivation) means at-least-once semantics is acceptable everywhere; no "exactly-once" infrastructure required.

### 4.3 Confidence

High. The recommendation is essentially "formalize what already exists." The existing cascade machinery (saga-by-construction, idempotency-keyed) and the existing PendingActionItem FSM (ADR-017 saga template) are precedents. W5 is mechanical extension; W2 is a path-rewrite projection.

If a counter-finding emerges during W1/W2 implementation (e.g., a cross-entity shape that genuinely cannot be expressed as marker-plus-sweeper), the L→XL escalation can be re-litigated mid-mission via thread-311 follow-up. The current evidence does not support escalation.

---

## 5. Pre-authorized trigger evaluation (formal)

Per mission-51 brief XL trigger #1: *"W0 finds atomic-transactions infeasible AND requires WAL/replay-as-primary architecture"*.

| Condition | Evaluation | Evidence |
|---|---|---|
| Atomic-transactions infeasible | ✅ TRUE | §1.2 (local-fs single-path atomic only); §1.3 (GCS single-object atomic only); §1.4 (backend-uniform — abstraction-leak forbidden by mission-47) |
| Requires WAL/replay-as-primary architecture | ❌ FALSE | §1.6 (existing cascade is already saga-by-construction); §2.1 (W5 adds 4 optional Thread fields + 1 startup sweeper — mechanical, not WAL-as-primary); §2.3 (< 1 eng-day surface area); §1.7 (PendingActionItem ADR-017 is the precedent template — extension is precedent-aligned, not novel) |

**Trigger fires?** No — conjunctive trigger, second condition false.

**Sizing call:** L holds. Mission-51 proceeds at 1-1.5 eng-weeks scope.

**Recommendation: proceed to W1** (message entity schema design) without sizing escalation.

---

## 6. Cross-references

- **Mission entity:** `get_mission(mission-51)` (Hub) — `M-Message-Primitive`.
- **Mission brief:** PR #40 (architect-docs-batch; merged at `0fea3d1`); thread-311 6-round design convergence 2026-04-25.
- **Source idea:** idea-192 (universal message primitive).
- **Storage contract:** `packages/storage-provider/src/contract.ts` — six-primitive sovereign contract (mission-47 T1).
- **Storage implementations:** `packages/storage-provider/src/{local-fs,gcs,memory}.ts`.
- **Repository pattern (mission-47):** twelve repositories under `hub/src/entities/*-repository.ts`.
- **Cascade runner:** `hub/src/policy/cascade.ts` (M-Cascade-Perfection Phase 1; ADR-015).
- **Cascade ActionSpec registry:** `hub/src/policy/cascade-spec.ts`.
- **PendingActionItem saga:** `hub/src/entities/pending-action.ts` (ADR-017) — architectural template for W5.
- **Mission-50 closing arc:** `docs/audits/m-cloud-build-tarball-codification-closing-report.md` — engineer-side mission immediately preceding mission-51.
- **bug-31:** cascade-bookkeeping issue that mission-51 W2 absorbs (per brief).
- **Out-of-scope for W0 / deferred to W1+:** Message entity schema design (W1), thread normalization migration code (W2), trigger machinery (W3), scheduled-message sweeper (W4), cascade transactional boundary IMPLEMENTATION (W5; this spike informs the path), legacy-read sunset + tool-surface migration (W6).

---

## 7. Open questions for architect ratification

These are NOT blocking the W0 close but are worth a brief architect read-through before W1 issues:

1. **Marker placement on Thread.** §2.1.1 proposes 4 optional fields directly on `Thread` (`cascadePending`, `cascadePendingActionCount`, `cascadePendingStartedAt`, `cascadeCompletedAt`). Alternative: a separate sidecar entity (`thread-cascade-state/<threadId>.json`). Engineer's recommendation: on-thread, because (a) it keeps the marker in the same atomic boundary as the convergence-actions list (single CAS for marker-set + actions-update pre-cascade); (b) the sidecar adds another single-entity atomic boundary that has no advantage. Architect call.

2. **Sweeper granularity on Hub startup.** §2.1.2 proposes a single startup sweep (run once before serving traffic). Alternative: also include a periodic sweep at runtime (every N minutes) to catch threads orphaned by transient cascade-runtime errors that didn't cleanly clear the marker. Engineer's recommendation: startup-only for v1; add periodic sweep only if metrics show orphan-rate > 0 in the wild. Architect call.

3. **W2 in-process projector vs polling sweeper.** §3.1.2 lists both as valid; the in-process projector has tighter shadow-lag bound but tighter coupling to the thread-reply hot path. Engineer's recommendation: ship in-process projector as primary + polling sweeper as backstop (catches anything the in-process path missed due to crashes during projection). Architect call.

4. **Universal message ID derivation for thread-message migration.** §3.1.2 mentions "deterministic, e.g., `thread-msg-<threadId>-<seq>` or hash-based." Engineer's recommendation: prefix-form `thread-msg-<threadId>-<seq>` for grep-ability and direct-decode of the source pointer; ULID-based ID with the source pointer in the message payload is also viable. Architect call (or defer to W1 schema design).

These are all non-blocking; W1 can proceed against any of these resolutions.

---

## 8. Closing

Spike concluded. Backend-capability characterization complete; W5 + W2 paths chosen; sizing call made (L holds; XL trigger does not fire). The recommended W5 architecture is a mechanical extension of the existing cascade saga, NOT a new WAL-as-primary infrastructure invention. The recommended W2 architecture is async-shadow with bounded-lag sweeper, fitting naturally over the per-file message storage layout that ThreadRepository already uses.

Engineer-side W0 100% delivered at this report. Ready for architect ratification of the recommendation + W1 issuance.
