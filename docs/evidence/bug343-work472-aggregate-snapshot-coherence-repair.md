# bug-343 work-472 aggregate snapshot-coherence repair evidence

WorkItem: `work-472`
Repository: `apnex/agentic-network`
Branch: `drew/bug343-aggregate-snapshot-coherence`
Exact predecessor: `21a42ad0363454d7f794c28837e50bab0f8a9883`
Predecessor tree: `35c266b8d2a93c4fee9cf57a838b7ff0985f3660`
Scope: source, tests, deterministic harness, and evidence only. No PR, merge, deployment, production mutation, bug disposition, historical replay, re-attestation, predecessor mutation, `work-473`, or downstream-surface effect.

## Authority and immutable predecessor FAILs

Before source effect, the V6 authority manifest was fetched through a distinct read-only MCP session and independently written as its exact tool-result UTF-8 bytes:

- path: `docs/authority/workgraph-safe-revision-implementation-authority-manifest-v6.md`;
- frozen binding: `rv=56549641`, `bytes=15072`, `sha256=ca83119d8a77555175fee692d09a1a4f9dfbf5d432875a6d9c22f41711c99c48`;
- fresh result: 15,072 bytes, same SHA-256, ASCII=true, terminal newline=true.

Fresh independent read-only validation established:

- `work-469/scale_repair_seal`: `valid=true`, `invalidReasons=[]`, active `fail`, one history row, no legacy evidence;
- `work-471/truncation_repair_seal`: `valid=true`, `invalidReasons=[]`, active `fail` produced `2026-07-23T18:14:03.627Z`, one history row, no legacy evidence;
- the `work-471` failed review was read from `docs/reviews/bug-343-truncation-repair-gate-fail-cross-dimension-snapshot-21a42ad.md` before implementation.

No write, lease, evidence, or attestation verb was called on either predecessor. Their active-valid FAILs and retained leases remain independent and untouched.

## Defect and repair contract

The predecessor made every Proposal, Thread, and PendingAction dimension individually complete and high-water stable, but `get_pending_actions` read those dimensions sequentially without requiring their revisions to agree. A relevant queue insertion after the first dimension could therefore produce an outward exact total and action membership that described no real database state.

The successor contract is:

1. The in-flight PendingAction queue is read first because it suppresses later Thread actions.
2. Its `snapshotRevision` becomes the aggregate anchor.
3. Every Proposal and Thread first page and every later page must equal that anchor.
4. A first-page mismatch accepts zero rows and returns `snapshot_changed` with explicit expected and observed revisions.
5. Any revision drift retries the **whole aggregate**, never one dimension in isolation.
6. Retries are bounded to three complete attempts so reconnect churn cannot amplify indefinitely.
7. A stable attempt exposes one top-level `snapshotRevision`, exact counts/actions, per-dimension receipts, and every prior attempt's observed revisions.
8. A non-drift incomplete source (for example the 10,000-row safety ceiling) fails immediately and loudly.
9. Three drifting attempts fail actionless and loud: `complete=false`, `truncated=true`, `reason=aggregate_snapshot_retry_exhausted`, `totalPending=null`, `visiblePending=null`, null derived counts, and empty Proposal/Thread action arrays.
10. The adapter logs the failure reason and `visible=unknown`; it never converts the null aggregate into zero work.

This is an optimistic shared-high-water contract rather than a long-held database transaction. It guarantees that an exact result is returned only when no committed entity write occurred between any accepted dimension/page. A write after the final read does not invalidate the historical snapshot just established; a write between reads necessarily advances the global high-water and triggers retry/failure.

## Exact real-PostgreSQL falsifier and successor probes

Image: `postgres:15-alpine`
Profiles: 1 vCPU / 2 GiB and 4 vCPU / 8 GiB
Concurrent reconnects: 12

The harness deterministically establishes high-water `212212`, reads the 600-row queue, then inserts a relevant PendingAction for `thread-scale-0601` at `212213`.

### Failed predecessor reproduced repeatedly

Each profile repeated the exact falsifier 6/6 times:

| Receipt | Value |
|---|---:|
| Queue revision / count | 212212 / 600 |
| Insert revision / entity | 212213 / `thread-scale-0601` |
| Later Proposal revision / count | 212213 / 675 |
| Later Thread revision / count | 212213 / 650 |
| Mixed predecessor total | 725 |
| Authoritative current in-flight / awaiting / total | 601 / 49 / 724 |
| False exact delta | +1 |

### Whole-aggregate retry succeeds exactly

Each profile repeated the successor interleaving 10/10 times:

- attempt 1 anchored at 212212 and observed Proposal/Thread at 212213, so it was discarded;
- attempt 2 anchored every dimension at 212213;
- outward exact total was 724;
- all 675 Proposal IDs and all 49 awaiting Thread IDs exactly equaled independent SQL authority;
- `thread-scale-0601` was correctly suppressed;
- no mixed attempt rows escaped.

### Retry exhaustion is loud and actionless

Each profile repeated sustained mutation 6/6 times:

- attempt anchors: 212212, 212213, 212214;
- each queue read was followed by a new relevant insertion;
- latest authority after three writes was 675 Proposals + 47 awaiting Threads = 722;
- outward result did **not** guess 722 or expose partial actions;
- it returned `totalPending=null`, `visiblePending=null`, `aggregate_snapshot_retry_exhausted`, and all action arrays empty.

Every repetition and complete authoritative ID set is retained in each raw JSON trace.

## Scale and over-cap parity

Each independently seeded deterministic profile carried:

| Measure | Value |
|---|---:|
| Workload entities | 212,157 |
| Total entities including six SchemaDefs | 212,163 |
| Logical JSON bytes | 416,633,859 |
| Physical JSONB bytes | 421,481,044 |
| Audit/history rows | 209,981 |
| Submitted Proposal | 675, exact in 2 pages |
| Active architect-turn Thread | 650, exact in 2 pages |
| In-flight PendingAction | 600, exact in 2 pages |
| Enqueued drain queue | 300, exact in 1 page |

Both profiles passed all six authoritative ID-set comparisons (submitted/approved Proposal, active/converged Thread, in-flight/drain PendingAction). Quiescent dimension receipts all shared revision 212212. The corpus exceeds the 210,781-row and 310 MiB physical JSONB floors.

## Phase-separated CPU and admission

Both phases execute the same 108 list queries (12 reconnects × 9 admitted reads). Admission observations and cgroup CPU counters are reset immediately before each phase, preventing serialized-phase or lower-query-count masking.

### 1 vCPU / 2 GiB

| Phase | p50 | p95 | wall | DB CPU | active/queued high-water | admitted/rejected |
|---|---:|---:|---:|---:|---:|---:|
| Predecessor unfenced complete paging | 264.72 ms | 273.91 ms | 274.90 ms | 101.18% | 4 / 8 | 108 / 0 |
| Successor coherent complete paging | 204.02 ms | 209.48 ms | 213.00 ms | 99.37% | 4 / 8 | 108 / 0 |

### 4 vCPU / 8 GiB

| Phase | p50 | p95 | wall | DB CPU | active/queued high-water | admitted/rejected |
|---|---:|---:|---:|---:|---:|---:|
| Predecessor unfenced complete paging | 214.10 ms | 220.52 ms | 221.84 ms | 153.75% | 4 / 8 | 108 / 0 |
| Successor coherent complete paging | 203.22 ms | 212.45 ms | 214.03 ms | 141.18% | 4 / 8 | 108 / 0 |

There were zero reconnect errors, queue-full rejections, or admission timeouts. The comparison is bounded and honest: the revision fence adds no query in a quiescent attempt, and CPU is measured for identical work.

## Query plans

Both profiles retain `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` plans. Relevant identities:

- high-water: `entities_rv_idx`, one-row `Index Only Scan`;
- Proposal page 2: `proposal_status_phase_idx`, 675 matching / 175 returned;
- Thread page 2: `thread_status_phase_currentturn_idx`, 650 matching / 150 returned;
- PendingAction page 2: `pa_spec_target_idx`, 600 matching / 100 returned.

No relevant complete-paging plan contains a `Seq Scan`. The global high-water lookup and substrate filters remain indexed.

## Data and history preservation

Receipts bind `kind:id:resourceVersion:md5(data)` for every row after fixture/schema setup and before any falsifier, then repeat after all probes/phases/plans.

| Profile | Audit count/digest before → after | Whole-data count/digest before → after |
|---|---|---|
| 1 vCPU / 2 GiB | 209,981 / `f4013981d671707192c9cdd97480f66a` unchanged | 212,163 / `f6a55aec971bcb3a5f2538be80bc3686` unchanged |
| 4 vCPU / 8 GiB | 209,981 / `f4013981d671707192c9cdd97480f66a` unchanged | 212,163 / `46838b0c72f65b6420957ff123e6119b` unchanged |

No authoritative corpus or Audit/history row was deleted, compacted, rewritten, or transitioned. Synthetic mutation markers exist only during the explicitly ephemeral concurrent-write probes and are removed before the matching after-receipt; both count and complete data digest return exactly to the before value. Fixture `TRUNCATE ... RESTART IDENTITY` is setup-only in the throwaway database and makes each profile independently reproduce the exact 212212→212213 transition.

## Tests, environment, and raw artifacts

Environment: Linux `5.8.18-100.fc31.x86_64`; Node `24.12.0`; npm `11.6.2`; Git `2.25.4`; TypeScript `5.9.3`; Vitest `4.1.7`; tsx `4.22.3`; pg `8.22.0`; testcontainers `11.14.0`; PostgreSQL `15-alpine`.

Final suites before commit:

- Hub: 218 files passed / 1 skipped; 2,732 tests passed / 5 skipped;
- network adapter: 47 files / 382 tests passed;
- focused Hub paging/coherence/admission/filter-drift: 4 files / 14 tests passed;
- focused adapter state sync: 2 files / 5 tests passed;
- affected Hub and adapter TypeScript builds passed.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `bug343-work472-coherence-e2-small.json` | 553,081 | `a6eccb15397514fbeabd73dbc8cb63f36ccfb531a585a26bb595b60054ed0415` |
| `bug343-work472-coherence-e2-small.txt` | 553,217 | `52ed1d889ce7c391c143ed264620aab9256da12f0c0d6006f2298f49759eda4e` |
| `bug343-work472-coherence-e2-standard.json` | 553,091 | `b4613f5246684ecd50af7419202ebd02a0e2833a7eabf8f5efc4f55d36a34704` |
| `bug343-work472-coherence-e2-standard.txt` | 553,227 | `06b3b95325ff3edb5d365f02f6370bc66d27ea7ff75ce37777ca4c3a46b9ff79` |
| `bug343-work472-hub-tests.txt` | 3,033,202 | `b5b19f592e54aba9145651112000f0a775836b9902501f5337d1fb02a44f6f60` |
| `bug343-work472-adapter-tests.txt` | 116,607 | `b90cb1309c68a386261be2b7c8a6a02cdfe24fe64ca2b7dc9475579a8dd7bcc2` |
| `work472-docker-update-standard.txt` | 20 | `a6471248da8d3c1397e4ce978ada7e67c98437f2d2207c1e089562a514406fbf` |

## Preserved failed runs

No failed execution was erased or rewritten:

| Artifact | Bytes / SHA-256 | Failure and resolution |
|---|---|---|
| `001-hub-build.txt` | 497 / `f94f9f71346b8244eab03fe0f6717908aa195942435d46b4aab120cc6d3addd6` | New worktree had no ignored `node_modules`; shared exact predecessor dependencies via an ignored symlink; build passed. |
| `002-adapter-build.txt` | 659 / `78acc43026abb5dd7edc4f9ec491b861a723c21bb089150917e96667a9d6131e` | Same missing-dependency condition; subsequent adapter build passed. |
| `009-docker-standard-resize.txt` | 436 / `f43d57c82ea9700f08305710ca6db0d2ec01fbda2798236f95e56d346fb26305` | Docker required memory-swap to change with the memory limit; atomic memory/swap retry succeeded. |
| `010-e2-standard-scale-failure.json` | 767 / `4ea5c974fb6a93e5c4fa3bfb1382634b4f2dbbf2fe7254496c5413dfc9486f0f` | `TRUNCATE` did not reset the RV sequence, so the second deterministic profile inherited max 424374 and failed loudly before measurement. |
| `010-e2-standard-scale-failure.txt` | 621 / `c2eaf6b59e1825aa4b012338ede924f197df46f24fa22166ff4c5e58924315ea` | Raw stderr for the same failed profile; setup now uses `RESTART IDENTITY` plus explicit sequence reset, and both profiles pass from exact 212212. |

These setup/harness failures do not overwrite the predecessor verifier FAILs or masquerade as candidate successes.
