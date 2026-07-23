# bug-343 reconnect state-sync repair evidence

WorkItem: `work-468`
Repository: `apnex/agentic-network`
Branch: `drew/bug343-reconnect-scale-repair`
Clean base: `5cb985c7c33391708faeb70535338af434ce778e` (`work-bp-workgraph_safe_revision_impl0_v6-foundation`)
Scope boundary: source, tests, and evidence only; no PR, merge, deployment, production mutation, historical-gate replay, or entity disposition.

## Pre-effect authority receipt

| Check | Fresh result |
|---|---|
| Manifest path | `docs/authority/workgraph-safe-revision-implementation-authority-manifest-v6.md` |
| Manifest metadata | list result remained `15072` bytes with `createdAt == updatedAt == 2026-07-23T12:48:24.929Z` |
| Independent raw MCP rehash | `bytes=15072`, `sha256=ca83119d8a77555175fee692d09a1a4f9dfbf5d432875a6d9c22f41711c99c48`, ASCII=true |
| V6 blueprint gate | `blueprint_v6_seal=PASS`, `verify_attestation.valid=true`, no invalid reasons, no legacy evidence |
| Continuation3 final admission | `final_admission_seal=PASS`, `verify_attestation.valid=true`, no invalid reasons, no legacy evidence |
| Design gate | `design_gate_seal=PASS`, `verify_attestation.valid=true`, no invalid reasons, no legacy evidence |
| Authority envelope | done and exact-bound as `rv=56552051`, `bytes=42819`, `sha256=2733f304f1f0f5bce465630cbf030443c90acef84fff2665d288416db4e48ce1` |
| Foundation dependency | done at commit `5cb985c7c33391708faeb70535338af434ce778e` |
| Constitution | `stale=false`, source SHA `8d3886823dfc1c971e5a47eec53d22eee3b91911` |

## Repair mechanics

1. **Store-free reconnect probe** — state sync uses `get_now`, not `list_missions`; the retired Task directive left `list_missions` serving only as an expensive liveness read that hydrated Mission/Idea rows.
2. **Role-aware sequential sync** — only architects call `get_pending_actions`; each reconnect issues at most one reconciliation RPC at a time instead of a three-way `Promise.all` fan-out.
3. **Substrate-filtered aggregate** — pending proposals query `submitted`; anomalies query `approved`; threads query `active + currentTurn=architect` and `converged`; the in-flight queue queries target plus `{enqueued,receipt_acked}`.
4. **Filtered drain** — `drain_pending_actions` retains target+`enqueued` substrate filtering and gains a composite target/state index.
5. **Filtered session rehydration** — Hub-restart fallback pinpoints `status.currentSessionId`, then uses a bounded GIN membership fallback on `status.registeredSessions`; it never calls `listAgents()`.
6. **Indexed high-water** — substrate list reads the latest `resource_version` with backward `LIMIT 1` on `entities_rv_idx` rather than spelling a table-wide aggregate.
7. **Bounded server admission** — PostgreSQL list work passes a FIFO gate (default 8 active / 128 queued / 30s loud timeout) before pg Pool's otherwise-unbounded waiter queue.
8. **Reconnect jitter** — reconnect state sync receives stable per-agent FNV-1a jitter in `[0,1000]ms`; first boot remains immediate.
9. **No deletion/compaction path** — the repair adds indexes and read/admission behavior only. It introduces no delete, truncation, history rewrite, or polarity migration production path.

## Real PostgreSQL scale method

Harness: `hub/scripts/bug343-reconnect-scale.ts`
Image: `postgres:15-alpine`
Workload rows before six SchemaDef rows: exactly `210,781`
Immutable Audit/history rows: `209,981`
Logical JSON text: `416,065,441` bytes
Physical `pg_column_size(JSONB)`: `420,852,194` bytes
Concurrent reconnect clients: `12`

The ephemeral setup uses independently-generated MD5 blocks so the JSONB is physically greater than 310 MiB rather than a compressible nominal payload. Setup reset is confined to the throwaway test database. The measurement phase performs no deletion.

### e2-small-equivalent profile

Container limit: 1 vCPU / 2 GiB.

| 12-client reconnect batch | Errors | p50 | p95 | max |
|---|---:|---:|---:|---:|
| Pre-fix six-query concurrent fan-out | 0 | 210.15 ms | 219.46 ms | 220.61 ms |
| Post-fix sequential + admission cap 4 | 0 | 110.70 ms | 111.89 ms | 112.30 ms |

Post-fix p95 is 49.0% lower and remained bounded with zero errors.

Trace: `docs/evidence/bug343-reconnect-scale-e2-small.json`
Bytes/SHA-256: `4255` / `04ce59ae87553961c0b8aa599efcb8d34c3d3a04a68fccbb609396c49e9ffb34`

### e2-standard recovery-compatibility profile

The same persistent PostgreSQL corpus was reused after raising the container limit to 4 vCPU / 8 GiB; no reseed occurred.

| 12-client reconnect batch | Errors | p50 | p95 | max |
|---|---:|---:|---:|---:|
| Pre-fix six-query concurrent fan-out | 0 | 53.49 ms | 100.18 ms | 100.24 ms |
| Post-fix sequential + admission cap 4 | 0 | 45.72 ms | 47.53 ms | 47.60 ms |

This proves the repair remains compatible with the resized recovery class; resize is not treated as the fix.

Trace: `docs/evidence/bug343-reconnect-scale-e2-standard.json`
Bytes/SHA-256: `4255` / `c1726c4b7fdd8616081da4caedbdfb41aed2bd28f373d62f1749d99bd8e22b0f`

## Query-plan receipt

The post-fix plan in both profiles used:

- `entities_rv_idx` via one-row `Index Only Scan` for the high-water mark;
- `pa_spec_target_state_idx` via `Index Scan`, returning exactly 10 drain candidates;
- no `Seq Scan` node.

The pre-fix representative Mission read returned all 200 Mission entities before the adapter discarded the payload as a liveness probe. The post-fix probe is `get_now` and touches no entity row. Exact plan node/buffer records are in both JSON traces.

## Semantic parity and preservation

Both hardware profiles independently passed all six legacy-result versus substrate-filtered ID-set comparisons:

- submitted proposals;
- approved proposals;
- active architect-turn threads;
- converged threads;
- in-flight per-agent queue;
- enqueued drain queue.

Preservation before/after each measurement:

| Invariant | Before | After | Result |
|---|---|---|---|
| Audit/history count | 209,981 | 209,981 | PASS |
| Audit id/resourceVersion/data digest | `c64dba5f61b806b1f0ef637dc8985903` | same | PASS |
| Total entity rows | 210,787 | 210,787 | PASS |

No Message, executor, attestation, gate, or historical production entity was touched; the scale corpus is local and ephemeral.

## Test receipts

| Command | Result |
|---|---|
| `npm test --workspace=hub` | PASS — 216 files passed, 1 skipped; 2,724 tests passed, 5 skipped |
| `npm test --workspace=@apnex/network-adapter` | PASS — 47 files / 381 tests |
| `npx vitest run --config hub/vitest.config.ts` over admission, agent session scale, rename-map, and filter-drift gates | PASS — 4 files / 24 tests |
| `npx vitest run` over adapter admission/order, sync RPC, and reconnect integration | PASS — 3 files / 10 tests |
| `npm run build --workspace=hub` | PASS |
| `npm run build --workspace=@apnex/network-adapter` | PASS |
| `npm run build` from the final clean source commit | PASS — all workspaces, including the clean-tree Claude packaging gate |
| `hub/scripts/bug343-reconnect-scale.ts`, 1-vCPU/2-GiB profile | PASS — scale, parity, preservation, plan, and latency gates |
| same persisted corpus, 4-vCPU/8-GiB profile | PASS — compatibility, parity, and preservation gates |
