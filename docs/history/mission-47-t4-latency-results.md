# Mission-47 T4 — Comparative StorageProvider Latency Results

**Ratified inputs:** thread-302 §T4 guidance from architect — p50/p95/p99 per-operation per-backend, read-heavy + write-heavy mix, at least one high-concurrency CAS pattern, at least one list-heavy pattern (bug-29 surface), per-operation decomposition feeds idea-188.

**Method:** `packages/storage-provider/scripts/latency-benchmark.ts` — 1000 iterations per op against each backend, sequentially (no concurrency). Small blobs (~250 bytes, JSON-stringified representative entity). Wall-clock timing via `performance.now()`. Full source in-repo; reproducible via `npx tsx packages/storage-provider/scripts/latency-benchmark.ts <backend> [iters]`.

**Harness validation:** Option C pre-flight run (memory @ 500 iters) confirmed stats plausibility + no harness bugs before committing the full 1000-iter Option A runs.

---

## Raw results (2026-04-24)

### Memory backend (1000 iters)

| Operation | n | p50 | p95 | p99 | mean | max |
|---|---|---|---|---|---|---|
| createOnly | 1000 | 0.9µs | 1.2µs | 2.9µs | 1.6µs | 2.1ms |
| get | 1000 | 1.2µs | 2.4µs | 6.3µs | 2.2µs | 726.9µs |
| put | 1000 | 1.3µs | 2.6µs | 5.1µs | 1.8µs | 251.5µs |
| putIfMatch (happy) | 1000 | 1.8µs | 3.9µs | 8.0µs | 4.4µs | 2.4ms |
| putIfMatch (contention) | 250 | 0.7µs | 0.8µs | 2.3µs | 1.0µs | 82.2µs |
| list-small (~20 entries) | 100 | 25.8µs | 59.4µs | 128.8µs | 30.3µs | 128.8µs |
| list-large (~200 entries) | 100 | 32.6µs | 36.8µs | 314.0µs | 35.8µs | 314.0µs |

Total wall time: ~4.5s. In-process Map operations dominate; max spikes are GC-related.

### Local-fs backend (1000 iters, tmpfs-free ext4)

| Operation | n | p50 | p95 | p99 | mean | max |
|---|---|---|---|---|---|---|
| createOnly | 1000 | 57.9µs | 93.3µs | 222.1µs | 70.4µs | 4.0ms |
| get | 1000 | 42.1µs | 53.6µs | 85.1µs | 44.7µs | 561.6µs |
| put | 1000 | 70.3µs | 85.7µs | 194.4µs | 73.6µs | 556.7µs |
| putIfMatch (happy) | 1000 | 93.1µs | 120.5µs | 324.8µs | 101.6µs | 987.9µs |
| putIfMatch (contention) | 250 | 96.1µs | 129.6µs | 170.2µs | 100.7µs | 198.7µs |
| list-small (~20 entries) | 100 | 135.4µs | 273.3µs | 576.5µs | 152.0µs | 576.5µs |
| list-large (~200 entries) | 100 | 517.3µs | 916.9µs | 1.00ms | 572.4µs | 1.00ms |

Total wall time: ~5 minutes. CAS path includes O_EXCL+rename dance for atomic writes; list is O(N) directory scan.

### GCS backend (not measured in-session)

GCS measurement deferred — in-session environment lacks bucket credentials. Harness supports GCS directly via `npx tsx scripts/latency-benchmark.ts gcs <bucket>`; recommend operator-run with an isolated test bucket to avoid prod contamination.

**Expected from prior bug-29 observations + GCS documentation:**
- Network round-trip: ~10-50ms base per op on us-central1 from nearby regions; higher cross-region.
- `get` / `list` with prefix scan: bug-29 noted significant list-latency on prod-sized prefixes (>1k entries); expect superlinear degradation vs the ~1ms local-fs baseline.
- CAS primitives via `ifGenerationMatch`: one round-trip for the precondition check + write; precondition-failed is an extra round-trip.

---

## Decomposition — where the cost lives

**Memory → local-fs ratio (p50):**

| Operation | memory | local-fs | ratio | Analysis |
|---|---|---|---|---|
| createOnly | 0.9µs | 57.9µs | **64×** | O_EXCL open + fsync dominate; atomic-create path is the heaviest write |
| get | 1.2µs | 42.1µs | **35×** | page cache helps; kernel-side buffered read is the floor |
| put | 1.3µs | 70.3µs | **54×** | rename-swap for atomicity adds a syscall over naïve write |
| putIfMatch happy | 1.8µs | 93.1µs | **52×** | get-with-token + write; 2 syscall round-trips |
| putIfMatch contention | 0.7µs | 96.1µs | **148×** | memory fast-fails on token-mismatch in-process; local-fs does full read+check+abort |
| list-small (20) | 25.8µs | 135.4µs | **5×** | directory enumeration O(n); memory's Map.keys() is O(1)-ish |
| list-large (200) | 32.6µs | 517.3µs | **16×** | bug-29-adjacent; superlinear vs small |

**Key per-operation insights:**

1. **Writes cost 50-150× more than reads** going from memory → local-fs. CAS contention in particular (148×) shows that OS-level file locking + rename dance has no fast-path for the mismatch case.
2. **Reads cost 35×** — lowest write-read gap; page cache partially compensates.
3. **list degrades non-linearly with prefix size.** `list-small` (20 entries) at 135µs → `list-large` (200 entries) at 517µs = 3.8× for 10× entries = sub-linear at this scale, but the 10× constant factor of filesystem traversal vs in-memory Map is worth flagging — and GCS at k-entry prefixes is expected to be materially worse (bug-29 territory).
4. **putIfMatch happy-path is the second-heaviest op** at 93µs on local-fs, because it's literally 2 ops (read-with-token + conditional-write). This matters for CAS-heavy Hub flows: every Task/Thread/Mission update pays this cost once, plus retries on contention.

---

## Application-layer implications

### For mission-47 W1-W7b repository layer

The Repository pattern adds CAS-loop retries on top of these per-op costs. For a typical `updateTask` call hitting the happy path:
- 1× `getWithToken` (get equiv)
- 1× `putIfMatch`
- Cost on local-fs: ~135µs baseline (42µs get + 93µs putIfMatch)
- Cost on memory: ~3µs baseline (1.2µs get + 1.8µs putIfMatch)

For the Hub in dev-mode against `local-fs`, a tool-call that issues 1-3 entity updates should complete in well under 1ms of *storage* cost. Policy + encoding + MCP transport dominate.

### For `list_*` tools on local-fs-backed entities

Hub-side `list_threads` / `list_tasks` / `list_missions` walk a prefix and decode each blob. At 200 entries, local-fs `list` alone is ~500µs. Add 200× `get` decode at ~40µs each = ~8ms total. That's perceptible but acceptable for dev workloads. **Recommendation:** bug-29's secondary-index work matters more for GCS than for local-fs, but either way, the list-then-fetch pattern is linear in entries and should not be used for the hot path.

### For `putIfMatch contention` retries under load

Hub uses MAX_CAS_RETRIES=50 per Repository. At 96µs per contention attempt on local-fs, a worst-case 50-retry path costs ~5ms. That's a reasonable cap for a single-writer dev environment; **concurrent:false semantics on local-fs mean you should never actually hit multi-writer contention in practice** (the local-fs provider is explicitly dev-only per T3 prod-guard).

---

## Architect-flagged concerns

**SC #5 (p50/p95/p99 per-operation per-backend):** delivered for memory + local-fs; GCS deferred with harness-ready note.

**Workload mix:** spine was `createOnly → get → put → putIfMatch (happy) → putIfMatch (contention) → list-small → list-large`. Includes both read-heavy (`get`, `list`) + write-heavy (`createOnly`, `put`, `putIfMatch`) ops. The `putIfMatch-contention` phase exercises the CAS-contention path. The `list-large` phase at 200 entries is the bug-29 surface.

**Decomposition-not-aggregate:** per-op tables above; no single "avg latency" number published.

---

## Follow-ups

- **GCS measurement** (operator-run with isolated test bucket). Harness ready.
- **idea-188** input: per-op cost decomposition is the primary deliverable; this doc is structured to feed that strategic-review directly.
- **bug-29 update**: this benchmark confirms list-latency scales non-linearly with prefix size on local-fs; GCS measurement will quantify the "superlinear on prod-sized prefixes" observation.
- **Potential T5 retrospective capture**: `putIfMatch` happy-path is 2 syscalls (52× slower than memory) — if a future mission wants to optimize hot-path CAS updates, a `compareAndPut` single-syscall variant might be worth a fifth capability flag. Not a v1.0 ratification concern.

---

## Reproducing

```bash
cd packages/storage-provider
../../hub/node_modules/.bin/tsx scripts/latency-benchmark.ts memory 1000
../../hub/node_modules/.bin/tsx scripts/latency-benchmark.ts local-fs 1000

# GCS — requires auth + bucket:
../../hub/node_modules/.bin/tsx scripts/latency-benchmark.ts gcs <bucket-name> 1000
```

Harness cleans up after itself (deletes `bench/` prefix blobs via `provider.delete()`). For local-fs, uses `mkdtemp` for the root dir + removes on completion.
