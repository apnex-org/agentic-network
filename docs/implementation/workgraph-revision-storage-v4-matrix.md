# WorkGraph revision storage V4 — implementation and migration matrix

Status: implementation evidence for `work-bp-workgraph_safe_revision_impl0_v6-storage`  
Repository: `apnex/agentic-network`  
Base: `9d28e1f3888456e157cc7cbf7eeaf2151ed40ff5`  
Authority: Mission-140 V6 manifest exact binding (`rv=56549641`, `bytes=15072`, `sha256=ca83119d8a77555175fee692d09a1a4f9dfbf5d432875a6d9c22f41711c99c48`)

## 1. Bounded result

This slice adds inert storage, deterministic projection, migration, verification, and publication primitives only. It does **not** wire the universal currentness fence, expose revision verbs, activate a live head, migrate production rows, merge, deploy, dispose `bug-319`, or change Skills.

The semantic visibility point is one `WorkGraphTopologyHead` CAS. Families, physical WorkItems, generation manifests, shards, edge rows, operation lookup rows, and exact-holder intent rows are prepared first and are noncurrent until that CAS. A correction must publish the exact next generation; pointer rollback, generation gaps, mutable manifest replacement, and same-ID byte drift reject.

## 2. Persistent kind matrix

| Kind | Authority / mutability | Envelope placement | Indexed access |
|---|---|---|---|
| `WorkRevisionFamily` | immutable logical/origin/creator/scope; monotonic `latestAllocatedRevision` CAS, never decrement/reuse | identity in `spec`, `createdAt` in `metadata` | origin physical ID; `(familyScope.kind,familyScope.id)` |
| `WorkGraphTopologyGeneration` | create-only complete manifest, written last during prepare | topology/receipt identifiers and maps in `spec`, `createdAt` in `metadata` | generation, previous generation, operation ID |
| `WorkGraphTopologyShard` | create-only, at most 500 logical bindings per shard | shard body in `spec`, `createdAt` in `metadata` | `(generation,shardIndex)` |
| `WorkGraphTopologyHead` | singleton global CAS; sole topology visibility commit | pointer in `spec`, activation time in `metadata` | primary key (`global-v1`) |
| `WorkGraphTopologyEdge` | create-only complete forward/reverse index row | edge identity in `spec` | `(generation,target,edgeClass)` and `(generation,source,edgeClass)` |
| `WorkGraphRevisionOperation` | immutable request binding plus mutable non-authoritative `prepared→committed` lookup projection | request in `spec`, prepare time in `metadata`, state/commit time in `status` | generation and state; operation ID is primary key |
| `WorkGraphRevisionNotice` | immutable exact-holder intent plus mutable idempotent Message projection state | intent in `spec`, create time in `metadata`, projection in `status` | operation, exact holder, pending projection |
| `WorkItem` V3 additions | immutable physical revision/reference/local identity in `spec`; append-only recall/outbox authority in `status` | preserve-not-inject explicit partitions | logical/current generation plus GIN recall-history and pending-intent lookup |

All seven new kinds have SchemaDefs, per-kind envelope migration modules, write-encoder registration, closed rename-map inventory, filterable-key governance, and restart-stable owned indexes. WorkItem owner writes preserve revision identity, `recallHistory`, and `pendingRecallIntents`; legacy reads may project empty recall collections but never write on read.

## 3. Construction and integrity matrix

| Obligation | Implementation |
|---|---|
| Deterministic legacy projection | `buildWorkRevisionStorageV4` deep-copies inputs, projects legacy `logicalId=id` / `revision=1`, never mutates source rows, and uses node-contract/topology V4 primitives. |
| Exact reference identity | Bootstrap binder receives the exact stable scan high-water token; reference cardinality and foundation binding validation fail closed. |
| Complete topology | Full forward and reverse adjacency for both `dependsOn` and `completionDependsOn`; dangling, self/mixed-edge cycle, duplicate physical/logical binding, and duplicate edge rejection. |
| Uncapped traversal | Stable 500-row pages with deterministic ID ordering and one unchanged scan token; real-PG proof reads 611 reverse dependents. |
| Sharding | Deterministic sorted shards, maximum 500 logical IDs, per-shard hashes, ordered hash inventory in the manifest. |
| Local/global separation | Contract, node-topology, direct-target binding, local execution identity, and global topology hash are recomputed independently; disconnected generation churn does not change unrelated local identity. |
| Failed gate precedence | `isFailedGateSealed` runs before phase/currentness classification in build, legacy CAS migration, activation physical-row validation, and restore validation. Raw-ready legacy FAIL cannot be blessed as ordinary work. |
| Family allocation | Global WorkGraph advisory lock plus family-row CAS returns unique monotonic revisions. Identity drift rejects; failed attempts may burn a number but never reuse or roll back it. |
| Physical rows | New rows are create-only exact bytes. Legacy migration compares the fresh row to the exact shadow source and applies revision fields by one CAS; any intervening change or partial identity fails closed. |
| Prepared persistence | Request identity is immutable and retryable. Family high water advances only. Projected operation/notice state survives later prepare retries. Generation is written last. |
| Publication | Activation validates the complete prepared snapshot and every bound physical row/hash/local identity before one global head CAS. Operation state is a non-authoritative post-head projection. |
| Crash recovery | A retry detecting an already-committed exact head repairs a missing `committed` operation projection first, then reruns complete snapshot and physical-row guards. |
| No ABA/rollback | Generation must equal `previousGeneration + 1`; current head must equal declared previous; old/same-different pointers reject. |
| Dual read | `compareShadowGenerationV4` names every divergent generation dimension, including schema, maps, reverse maps, hashes, intents, shards, and creation binding. |
| Snapshot / restore | Recomputes generation, manifest, shard, edge, family, operation, notice, head, and optional physical-row invariants. `RevisionSnapshotManifestV4` binds counts and exact canonical snapshot hash; mismatch blocks restore mutation. |

## 4. Real PostgreSQL index proof

`hub/src/storage-substrate/__tests__/work-revision-storage-pg.test.ts` reconciles the production SchemaDefs against PostgreSQL 15, exercises envelope writes, and checks `EXPLAIN (COSTS OFF)` uses:

- `worktopoedge_reverse_idx`;
- `workrevfamily_spec_scope_idx`;
- `workrevop_spec_generation_idx`;
- `workrevnotice_status_projected_idx`;
- `workitem_status_recallhistory_gin_idx`;
- `workitem_status_pendingrecallintents_gin_idx`.

The same test proves 611-row reverse traversal past the substrate page cap, concurrent real-PG family allocation under the global advisory lock, preserve-not-inject WorkItem placement, exact physical-row-gated head publication, and integrity-guarded snapshot readback.

## 5. Test evidence map

| Suite | Coverage |
|---|---|
| `work-revision-storage-v4.test.ts` | deterministic projection; bootstrap stable token; legacy CAS migration; direct/disconnected hash behavior; references/dangling/duplicates/mixed cycles; >500 topology; failed-seal-first; dual read; snapshot corruption; monotonic allocation; absent-physical activation rejection; one-head CAS; post-head crash repair; operation/notice retry; immutable conflict |
| `work-revision-storage-pg.test.ts` | PostgreSQL schema/encoder/index plans, 611 reverse rows, concurrent allocation, physical activation, snapshot readback |
| `renamemap-contract-w1.test.ts` | exact closed rename-map inventory and migration-module placement for WorkItem plus seven new kinds; restart-stable DDL |
| `filterable-keys-drift-gate.test.ts` | static call-site coverage and acknowledged uncapped generic pager |
| `filter-roundtrip-oracle.test.ts` | real-PG value round trip for every new filterable field |
| `write-encoder-and-watch-w4.test.ts` | writer registry and existing envelope/watch regressions |
| full Hub suite | regression fence across all Hub behavior |

## 6. Explicit non-claims

- No MCP/public revision, recall, recommit, or deployment tool is introduced.
- No existing WorkItem is migrated or activated by this commit.
- No production database, head, Message, bug, mission, Skills asset, PR, or branch outside this worktree is mutated.
- `bug-319` remains unresolved; its existing failed-seal authority remains first and immutable.
- Universal readers/writers, pause/recall semantics, semantic revision orchestration, projector integration, chaos qualification, protected merge, and deployment remain separately gated V6 nodes.
