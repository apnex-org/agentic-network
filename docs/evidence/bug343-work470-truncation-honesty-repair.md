# bug-343 work-470 truncation-honesty repair evidence

WorkItem: `work-470`
Repository: `apnex/agentic-network`
Branch: `drew/bug343-truncation-honesty`
Exact predecessor: `be7272dd7e19fd9e91c351d7f9905e834b1d8772`
Predecessor tree: `2c84eae07f76ac51181b236a01d71bf633e9ccd7`
Scope: source, tests, and evidence only. No PR, merge, deployment, production mutation, bug disposition, historical replay, re-attestation, `work-469` mutation, `work-471`, or downstream-surface effect.

## Authority and failed-predecessor preservation

Before source effect, the V6 manifest was freshly fetched through a distinct read-only MCP session and independently written as exact UTF-8 bytes:

- path: `docs/authority/workgraph-safe-revision-implementation-authority-manifest-v6.md`;
- frozen binding: `rv=56549641`, `bytes=15072`, `sha256=ca83119d8a77555175fee692d09a1a4f9dfbf5d432875a6d9c22f41711c99c48`;
- fresh result: 15,072 bytes, same SHA-256, ASCII=true, terminal newline=true.

Fresh `verify_attestation(work-469, scale_repair_seal)` returned `valid=true`, `invalidReasons=[]`, active verdict `fail`, produced `2026-07-23T17:03:40.462Z` by `agent-f148389d`, with one preserved history row and no legacy review evidence. This repair did not call any write or attestation verb on `work-469`; the active-valid FAIL remains the immutable predecessor verdict.

The first local authority-response parser incorrectly expected a JSON-encoded document object while this Hub returned raw Markdown. That local-only failure is preserved as `docs/evidence/work470-failed-runs/012-authority-rehash-parser-shape.txt`; the distinct corrected parser consumed `result.content[0].text` directly. Neither attempt mutated Hub state.

## Repair contract

`get_pending_actions` no longer relies on repository methods that silently return the first 500 matching rows.

1. `listCompleteStable` reads immutable-id-ordered pages of at most 500 rows.
2. Every accepted page must report the same substrate-wide high-water revision as page 1.
3. A short terminal page proves completeness and yields an exact count.
4. Snapshot drift stops before mixed-snapshot rows are accepted and returns `complete=false`, `truncated=true`, `reason=snapshot_changed`, and `nextOffset`.
5. A 10,000-row per-dimension safety ceiling is likewise loud (`reason=safety_limit`) rather than pretending the partial result is complete.
6. PostgreSQL maps the reserved `id` sort to the canonical `entities.id` column; paging is deterministic and can use kind/id indexing.
7. Proposal, Thread, and PendingAction repositories expose complete stable methods while their unrelated legacy list surfaces remain unchanged.
8. `get_pending_actions` exposes per-dimension `returnedCount`, `exactCount`, `pagesRead`, `snapshotRevision`, `nextOffset`, and reason. `totalPending` is a number only when every source is complete; otherwise it is `null` with `visiblePending`, top-level `truncated=true`, and the non-dark retrieval receipt.
9. Architect reconnect logging emits an explicit `Pending actions INCOMPLETE` event instead of coercing a null exact total to zero.
10. Admission telemetry records resettable observed active/queued high-water, admitted count, queue-full rejection, and timeout rejection without changing gate behavior.

Unit coverage proves both successful 675-row reconstruction and loud snapshot/safety truncation. Policy coverage proves exact 675/650/600 reconstruction and the outward `totalPending=null` snapshot-change contract.

## Real PostgreSQL corpus

Image: `postgres:15-alpine`
Fixture: original 209,981 immutable Audit rows plus over-cap operational dimensions

| Measure | Value |
|---|---:|
| Workload entities | 212,156 |
| Total entities after six SchemaDef rows | 212,162 |
| Logical JSON bytes | 416,633,433 |
| Physical `pg_column_size(JSONB)` bytes | 421,480,569 |
| Audit/history rows | 209,981 |
| Concurrent reconnects | 12 |

This exceeds both original incident floors (210,781 entities and 310 MiB physical JSONB) without removing any predecessor Audit row.

## Authoritative over-cap reconstruction

The same real PostgreSQL corpus carried:

| Filtered dimension | Authoritative SQL count | Reconstructed | Pages | Exact/complete |
|---|---:|---:|---:|---|
| submitted Proposal | 675 | 675 | 2 | yes |
| active architect-turn Thread | 650 | 650 | 2 | yes |
| target in-flight PendingAction | 600 | 600 | 2 | yes |
| target enqueued drain queue | 300 | 300 | 1 | yes |
| approved Proposal | 0 | 0 | 1 | yes |
| converged Thread | 0 | 0 | 1 | yes |

All six authoritative ID-set comparisons passed. The 600 in-flight thread-message rows suppress the matching first 600 active threads, so the policy-level complete result contains 675 pending proposals, 50 threads awaiting reply, and exact `totalPending=725`.

## Phase-separated CPU and admission evidence

Container CPU comes from the Docker container's cgroup-v1 `cpuacct.usage`, sampled separately around each measured phase. `100%` means one fully utilized vCPU; aggregate percentage may exceed 100 on multi-vCPU profiles. Admission observations are reset immediately before each phase.

### e2-small equivalent — 1 vCPU / 2 GiB

| Phase | SQL calls | p50 | p95 | wall | DB CPU | admission active/queued high-water | admitted/rejected |
|---|---:|---:|---:|---:|---:|---:|---:|
| Failed predecessor capped fan-out | 72 | 202.19 ms | 287.37 ms | 288.46 ms | 113.59% | 0 / 0 (bypassed gate) | 0 / 0 |
| Complete stable paging | 108 | 351.72 ms | 357.65 ms | 359.27 ms | 88.72% | 4 / 8 | 108 / 0 |

Completeness necessarily executes the second pages omitted by the predecessor. The result is therefore not represented as a latency reduction. It is bounded and lossless: zero errors, active high-water exactly at the configured cap 4, queue high-water 8 of 96, no queue-full or timeout rejection, and lower phase-separated database CPU amplification.

### e2-standard compatibility — 4 vCPU / 8 GiB, same corpus without reseed

| Phase | SQL calls | p50 | p95 | wall | DB CPU | admission active/queued high-water | admitted/rejected |
|---|---:|---:|---:|---:|---:|---:|---:|
| Failed predecessor capped fan-out | 72 | 88.29 ms | 147.96 ms | 149.14 ms | 243.21% | 0 / 0 | 0 / 0 |
| Complete stable paging | 108 | 264.92 ms | 273.25 ms | 274.89 ms | 133.83% | 4 / 8 | 108 / 0 |

This proves recovery-class compatibility while keeping admission—not VM size—as the concurrency boundary.

## Query plans

Every second-page plan is recorded with `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` and contains no `Seq Scan`:

- high-water: `entities_rv_idx`, one-row `Index Only Scan`;
- Proposal: `proposal_status_phase_idx`, 675 matching rows, second page 175;
- Thread: `thread_status_phase_currentturn_idx`, 650 matching rows, second page 150;
- PendingAction: `pa_spec_target_idx`, 600 matching rows, second page 100.

The bounded 600–675-row sort establishes immutable-id page order after index filtering; it does not scan the 212,162-row corpus.

## Data and history preservation

Each profile computes receipts after schema reconciliation and before any measured reconnect phase, then repeats them afterward.

| Profile | Audit count/digest before → after | Whole-data count/digest before → after |
|---|---|---|
| e2-small | 209,981 / `f4013981d671707192c9cdd97480f66a` unchanged | 212,162 / `e489550531ea7ffd461a5ab17892a8f6` unchanged |
| e2-standard | 209,981 / `f4013981d671707192c9cdd97480f66a` unchanged | 212,162 / `edae006bca2eb429e49d91f6a54371d5` unchanged |

The whole-data digest binds `kind:id:resourceVersion:md5(data)` for every row. Total row count is unchanged in both phases. No test measurement deletes, compacts, rewrites, or transitions an entity.

## Tests and raw artifacts

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `bug343-work470-overcap-e2-small.json` | 11,739 | `1175f1d2c54e50b798def1efa92af23fa5fa019ae973239491a8da7db1d5b36f` |
| `bug343-work470-overcap-e2-small.txt` | 11,887 | `f48d91a0e78bc3f3e1bc199c0b9ba51f2d83154ffac1ce4fa645cd6c60ab31a5` |
| `bug343-work470-overcap-e2-standard.json` | 11,741 | `59116966b50ddf6126c490b0e4a5cce654dfd2e102f562bb5ae787e2ba308bbc` |
| `bug343-work470-overcap-e2-standard.txt` | 11,889 | `67ced8658914c98fd9a005824e4803492e0694c6f95511aab3982969efcdba15` |
| `bug343-work470-hub-tests.txt` | 3,031,782 | `921f61f8dd86241c793b07dd61ecb372318083347ab8caa9c508e978a898bd48` |
| `bug343-work470-adapter-tests.txt` | 116,600 | `ff7ce1deef6bc06189b062a18012fb069ee0ac36284efa681e748cc325e12bdf` |
| `work470-docker-update-standard.txt` | 30 | `4484c8a5082e22ecd19c72fc2fc93b1f6fc8e9d7374367309268f094a93813a5` |

Final suites:

- Hub: 218 files passed / 1 skipped; 2,729 tests passed / 5 skipped;
- network adapter: 47 files / 382 tests passed;
- focused Hub paging/policy/admission/filter-drift: 4 files / 11 tests passed;
- focused adapter sync: 2 files / 5 tests passed;
- affected Hub and adapter TypeScript builds passed.

## Preserved failed runs

No failed execution was erased or rewritten:

| Receipt | Failure | Resolution |
|---|---|---|
| `001-adapter-build-unknown-logfield.txt` | structured logger rejected unknown retrieval object | serialize retrieval in the log field; build and tests pass |
| `002-hub-build-test-stub-listoptions.txt` | test stub inferred `{}` rather than `ListOptions` | type the stub; build passes |
| `003-focused-hub-missing-claim-session.txt` | router test agent fixture omitted current-session identity | make session binding explicit; policy tests pass |
| `004-e2-small-scale-failure.{json,txt}` | first cgroup probe assumed pure v2 while host uses hybrid v1 | add cgroup-v1 `cpuacct.usage` support; both required-CPU traces pass |
| `009-full-hub-tests-failure.txt` | static filter drift gate correctly rejected two unannotated helper sites | add reviewed generic-pager and PendingAction helper annotations; final full Hub suite passes |
| `012-authority-rehash-parser-shape.txt` | local parser expected JSON tool text instead of raw Markdown | distinct raw-text extraction produced the exact manifest binding |

These are implementation/harness failures, not concealed candidate successes. The prior `work-469` verifier FAIL remains separately active-valid and untouched.
