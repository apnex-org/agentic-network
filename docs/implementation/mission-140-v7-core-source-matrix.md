# Mission-140 V7 Repair2 core-source implementation matrix

## Scope and authority

This source slice implements the public semantic-revision/current-resolution/recommit path authorized by the Repair2 `core_source` node. It does **not** create or mutate a PR, merge, deploy, publish production state, execute dispositions, modify Skills, or alter historical FAIL rows or the old V6 driver.

The implementation composes the active-valid V4 node-contract, immutable revision storage, currentness fence, pause/recall repair, bounded-list/real-PostgreSQL, and repository-policy authorities. It preserves exact historical physical rows and treats one topology-head CAS as the only visibility commit.

## Invariant matrix

| Obligation | Mechanism | Adversarial evidence |
|---|---|---|
| Explicit current resolver | `get_current_work(logicalId)` pins the active generation and returns logical/physical/revision/predecessor/local identity plus the exact row | `revise-work-v4.test.ts`: historical exact read vs current logical projection |
| Public semantic mutation | `revise_work` admits contract fields, replacement logical edges, and references; type/evidence/history/status are absent from the request schema | policy registration and spoof-proof actor tests |
| Immutable successor lineage | Deterministic physical successor ID; `predecessorPhysicalId`, `revisedBy`, reason, and generation persisted; old row is never rewritten or redirected by `get_work` | mixed-edge closure test and real-PG restart test |
| Exhaustive affected set | Stable complete edge scan; reverse transitive closure combines `dependsOn` and `completionDependsOn`; optional exact closure CAS | mixed-edge test; non-exhaustive rejection; 1,001-node scale test |
| Single visibility commit | Families, physical rows, edges, shards, generation, and operation are inert drafts; only `WorkGraphTopologyHead` CAS activates | storage/currentness suites; competing expected-generation writers |
| Claim/revise race | Revision executes under the same WorkGraph global writer fence as lifecycle CAS and head publication | concurrent claim is fenced behind revision and rejects on historical physical ID |
| Crash-safe successor materialization | New physical successors use substrate `createBatchOnly`; PostgreSQL transaction and memory validate-then-commit prevent partial creation. Prepared operation lookup is persisted last | real-PG revision/restart flow; batch create conflict rollback |
| Atomic exact recommit | `unpause_work` batch mode validates exact generation/set/revisions and uses one cross-kind `putBatchIfMatch` transaction for every paused→ready row plus operation receipt | memory conflict keeps all paused; real-PG one-conflict rollback; restart retry is read-only |
| Evidence non-migration | Successors birth with empty evidence, attestations/history, executor history, friction, recall/outbox, failed-seal projection, lease, and timers | successor assertions across task/entity scenarios |
| SEAL author separation | New current creator/reviser is excluded; immutable family original creator and `revisedBy` are also added to self-attestation exclusions | source-level guard in `addRevisionAuthorExclusions` plus existing SEAL tests |
| Reference authority | Existing mutable doc/entity bindings are re-resolved before preparation and immediately before head CAS; same-path overwrite fails closed. Changed doc/entity/inline refs are rebound from substrate bytes/state; changed git refs reject without authoritative blob bytes | stale same-path test; changed Hub-document rebind test |
| Current projections | Graph projection follows stable logical bindings while direct `get_work(physicalId)` remains exact; disconnected generations retain the same physical/local identity | currentness suite plus revision tests |
| Generic entity targeting | Target refs remain opaque/advisory but contract-bound; GitHub-issue, Decision, review, incident, calibration, and Skill target scenarios revise without evidence migration | table-driven six-scenario test |
| Scale/truncation honesty | Reverse edges use `listAllStable`; no 500-row substrate cap is treated as complete | 1,001-node/1,000-edge revision test; 611-edge real-PG indexed traversal |
| PostgreSQL session/transaction correctness | Nested WorkGraph locks route CRUD to the lock-owning session; create/recommit batches execute `BEGIN`/validate/write/`COMMIT` on that same client | real-PG allocation, revision/restart, create rollback, and CAS rollback tests |
| Operation idempotency | Request hash binds caller + exact request. Same operation/different bytes rejects; prepared retry revalidates bindings and finishes activation; committed retry returns the persisted receipt | revision retry and recommit restart retry |
| No semantic no-op | Contract digest and both edge arrays must change before revision allocation | source guard before physical revision allocation |

## Storage changes

- Added `createBatchOnly` and `putBatchIfMatch` to `HubStorageSubstrate`.
- Memory implementation commits batches in one synchronous turn and emits only after all rows install.
- PostgreSQL implementation pins one client and transaction across validation and every row write.
- Revision operation status now records `recommittedSet`, `recommitOperationId`, `recommitRequestHash`, and `recommittedAt`; `recommitSet` is cleared in the same transaction that readies successors.
- Operation envelope/schema mappings preserve the new mutable status projection.
- In-memory advisory locks are reentrant through `AsyncLocalStorage`, matching PostgreSQL nested same-session lock composition.

## Tests

Focused implementation coverage:

- `hub/src/entities/__tests__/revise-work-v4.test.ts`
- `hub/src/entities/__tests__/work-revision-storage-v4.test.ts`
- `hub/src/entities/__tests__/workgraph-currentness-fence-v4.test.ts`
- `hub/src/entities/__tests__/pause-recall-v4.test.ts`
- `hub/src/entities/__tests__/pause-recall-frozen-authority-v4.test.ts`
- `hub/src/policy/__tests__/work-item-policy.test.ts`
- `hub/src/policy/__tests__/update-work-contract.test.ts`
- `hub/src/storage-substrate/__tests__/memory-substrate.test.ts`
- `hub/src/storage-substrate/__tests__/renamemap-contract-w1.test.ts`
- `hub/src/storage-substrate/__tests__/work-revision-storage-pg.test.ts`

The real-PostgreSQL test exercises full public revise → current resolve → restart → atomic recommit → second restart/idempotent retry, in addition to transaction rollback and indexed complete traversal.

## Explicit non-effects

No PR was opened or changed. No merge, deploy, production migration, publication, disposition, Skills action, Work-465 binding change, predecessor FAIL rewrite, V6 driver mutation, or direct effect against another WorkItem occurred in this slice.
