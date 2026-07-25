# WorkGraph topology/currentness fence V4 — integration inventory

## Scope and authority

This artifact covers only V6 node `work-bp-workgraph_safe_revision_impl0_v6-fence`, continuing from storage commit `bd314c4ebc2b4cfc43819c9e1774cad59e6ed35b`.

The pre-effect authority check read and independently rehashed the exact UTF-8 manifest binding:

- path: `docs/authority/workgraph-safe-revision-implementation-authority-manifest-v6.md`
- resource version: `56549641`
- bytes: `15072`
- SHA-256: `ca83119d8a77555175fee692d09a1a4f9dfbf5d432875a6d9c22f41711c99c48`

The repaired-design, V6-blueprint, Continuation3-final-admission, and failed-gate prerequisite attestations were fresh-verified active-valid before implementation (`invalidReasons=[]`; no legacy review evidence). This node does not authorize a PR, push, merge, deployment, live migration, production qualification, bug disposition, Skills effect, or another WorkItem.

## Authority model

`WorkGraphTopologyHead/global-v1` is the single topology publication point. `WorkGraphCurrentnessFenceV4` implements two modes:

1. **Legacy/shadow:** no head exists. Existing WorkItem behavior and current IDs remain unchanged.
2. **Generation-active:** every authoritative write takes the global WorkGraph advisory lock, then reads and validates one fresh immutable head/generation. Every current projection pins one head/generation and checks that the head did not move before returning.

An active physical WorkItem must exactly match the pinned generation's logical binding, revision, contract hash, topology hash, and recomputed local execution identity. A disconnected later generation may retain an unchanged physical binding; `topologyGeneration` records first materialization rather than falsely requiring equality with every later head.

Old/draft physical IDs remain exact-queryable for audit, evidence history, and persisted outbox intent, but are excluded from current lists, dependency traversal, completion gates, ready queues, lease sweeps, pulses, watchdog projections, PR binding projections, and current SEAL target resolution. `legal_moves` on an old/draft row returns every move as illegal with typed currentness metadata. Exact IDs are never silently followed to a successor. A pending failed-seal exact-holder notice is the deliberate exception: its historical persist-first intent remains projectable after supersession, without granting lifecycle authority.

## PostgreSQL transaction and old-binary fence

- Lock namespace: `LOCK_CLASS.workGraphGlobal = 5`.
- Lock key: FNV-1a-32(`global-v1`) = `36511236`.
- `PostgresStorageSubstrate` now routes bounded CRUD/CAS/list operations through the lock-owning pool session using `AsyncLocalStorage`; nested global + WIP locks use that same session and concurrent `Promise.all` queries are serialized per client.
- `005-workgraph-writer-fence.sql` adds a fail-closed trigger. Once `WorkGraphTopologyHead/global-v1` exists, PostgreSQL rejects every `WorkItem` insert/update/delete unless the calling backend holds advisory lock `(5,36511236)`. This fences an old binary that still speaks the pre-V4 WorkItem CAS protocol.
- New physical revision materialization and preserve-not-inject legacy migration also take the global writer lock. Draft generation/family/operation rows remain inert; head CAS remains publication.
- The SQL migration is implemented and real-PG tested only. It was not applied to any live environment by this node.

Memory parity uses the same `WorkGraphCurrentnessFenceV4` pin/lock/currentness semantics through the memory substrate's advisory-lock implementation. The database-level old-binary trigger is necessarily PostgreSQL-specific.

## Complete WorkItem writer inventory

A mechanical test (`workgraph-currentness-inventory-v4.test.ts`) fails if a listed writer disappears or no longer enters `withWriterFence` / the fenced CAS seam.

| Writer surface | Fence path |
|---|---|
| `createWorkItem` | global writer; rejected after activation (`revision_required`) |
| `createBlueprintNode` | global writer; rejected after activation |
| `deleteWorkItem` | global writer; rejected after activation |
| `updateWorkItem` | global writer + fresh current binding before CAS |
| `claimWorkItem` | global writer, then same-session per-agent WIP lock, current CAS |
| `startWork` | fenced CAS |
| `blockWork` / `resumeWork` | fenced CAS |
| `systemUnblock` | fenced CAS (Decision execution path) |
| `renewLease` | global writer, current holder CAS, current reverse-parent heartbeat traversal |
| `releaseWork` / `abandonWork` | fenced CAS |
| `pauseWork` / `unpauseWork` | fenced CAS |
| `expireLease` | fenced CAS, including failed-seal-first authority |
| `completeWork` | global writer across evidence validation, completion dependencies, and CAS |
| `attestEvidence` | global writer across target relation/self-attestation checks and CAS |
| `markFailedSealNoticeProjected` | fenced idempotent CAS |
| ancestor heartbeat writer | private fenced CAS reached by `renewLease` |
| revision materialization/migration | storage global lock + later exact activation validation |

`tryCasUpdate` is the central mutation seam: it fresh-reads the physical row, enforces current binding/local identity, applies the transform, and CASes while the global lock is held. Head publication uses the same lock, making lifecycle CAS and topology publication serializable.

## Complete current-read inventory

| Read/projection surface | Currentness behavior |
|---|---|
| `listWorkItems` / list-work control plane | resolves only generation bindings; annotates returned rows with observed generation/hash |
| `listReadyForRole` | generation-pinned current rows; current dependency and WIP predicates |
| `getCompletionProgress` | current arc and current children under one pin |
| `getStintProjection` | current subtree under one pin; returns observed generation/hash |
| `getNextAction` | current arc/children/dependencies under one pin; returns observed generation/hash |
| `getLegalMoves` | current row under one pin; old/draft rows get all-false moves and current target metadata |
| PR review binding lookup | current generation rows only |
| projection-key lookup | current generation rows only |
| expired-lease scan | current generation rows only |
| pending failed-seal notice scan | exact persisted outbox intents, including historical rows; pin prevents topology mixing but does not erase notification authority |
| dependency/completion traversal | current physical bindings only; no historical row can open a gate |
| reverse-parent traversal | generation-complete reverse topology, not a capped WorkItem scan |
| evidence review relation | physical evidence/history refs remain exact; current target/gate traversal is pinned |
| `verifyAttestation` | exact attestation row remains historical; current relation checks execute under one pin |

Intentional exact-read exceptions are `getWorkItem(id)` and generic `entityExists(kind,id)`. They preserve audit/evidence/history addressability and never imply mutation or current projection authority.

## Cross-cutting integration inventory

| Integration | Pin/fence source |
|---|---|
| WorkItem lifecycle/tools | repository global writer or current read seam |
| lease sweeper | entire pass composed with `withTopologyReadPin`; each expiry mutation escalates to the global writer lock and revalidates currentness |
| node pulse sweeper | node pass composed with `withTopologyReadPin`; bookkeeping writes escalate to writer lock |
| driver liveness watchdog | complete multi-status/child/next-action evaluation under one topology pin |
| transition/dependency events | events originate from a just-committed current mutation; dependency wakes scan current-ready rows and current dependency IDs; event entity refs remain exact historical refs |
| PR review requested handler/projection | current PR-binding lookup plus fenced WorkItem creation/mutation (direct creation fails after activation, requiring revision protocol) |
| Decision execution | `systemUnblock` fenced CAS; old/draft targets reject |
| executor evidence/completion | `completeWork` global writer and current completion traversal |
| SEAL attestation | `attestEvidence` global writer; current target resolution; immutable exact attestation history |
| SEAL independent verification | exact attestation verification under pinned current target/relation context |
| failed-gate notice projector | pinned exact-intent scan and global-lock idempotent projection mark, including historical failed-sealed rows; FAIL authority remains failed-seal-first |

## Shadow and race proof

The focused memory and real-PostgreSQL tests prove:

1. No-head legacy behavior is unchanged.
2. Exact historical reads remain available while current projections exclude old/draft rows.
3. Direct creates and old-row writes reject after activation; current lifecycle writes succeed.
4. Unchanged active holders survive disconnected later generations without false local-identity invalidation.
5. A same-logical successor makes the predecessor non-current and returns typed current target metadata.
6. Current lists return one observed topology generation/hash.
7. A held WorkGraph writer blocks concurrent head publication in real PostgreSQL.
8. A head move during an unlocked pinned read fails with `workgraph.currentness.head_changed`; mixed-generation data cannot escape.
9. A raw old-binary-style PostgreSQL WorkItem update without the global lock is rejected by the database trigger.
10. A current binary's nested global + WIP lock mutation succeeds on the same PostgreSQL session.
11. Existing advisory-lock contention, timeout, cross-class parallelism, lease sweeper, pulse, watchdog, failed-gate, SEAL, completion, and storage tests remain green.
12. `compareShadowGenerationV4` and storage integrity validation remain the exact legacy-vs-generation topology shadow oracle; activation still validates complete families, shards, edges, notices, bound rows, hashes, and failed-seal-first state before head CAS.

## Files

- `hub/src/entities/workgraph-currentness-fence-v4.ts`
- `hub/src/entities/work-item-repository-substrate.ts`
- `hub/src/entities/work-item.ts`
- `hub/src/entities/work-item-contract-v4.ts`
- `hub/src/entities/work-revision-storage-v4.ts`
- `hub/src/storage-substrate/postgres-substrate.ts`
- `hub/src/storage-substrate/migrations/005-workgraph-writer-fence.sql`
- `hub/src/policy/work-item-lease-sweeper.ts`
- `hub/src/policy/pulse-sweeper.ts`
- `hub/src/policy/driver-liveness-watchdog.ts`
- `hub/src/entities/__tests__/workgraph-currentness-fence-v4.test.ts`
- `hub/src/entities/__tests__/workgraph-currentness-inventory-v4.test.ts`
- `hub/src/storage-substrate/__tests__/workgraph-currentness-fence-pg.test.ts`
