# Housekeeping bug-batch (bug-109/110/111/112/113) — work-trace

**Scope:** Director-directed housekeeping sweep (2026-05-22) — squash the five
post-mission-86 housekeeping bugs.
**Engineer:** greg
**Coordination:** thread-608 (architect lily; the coordination spine for the batch)
**correlationId:** `housekeeping-2026-05-22`

## The batch

| Bug | Sev | PR | Summary |
|-----|-----|----|---------|
| bug-110 | minor | PR-1 | `vitest (hub)` flaky — pg connection open at testcontainer teardown → unhandled `57P01` |
| bug-111 | major | PR-2 | `get-agents.sh` defaults to decommissioned `localhost:8080` local Hub |
| bug-113 | minor | PR-2 | `list_available_peers` advertised on MCP surface but uncallable — prune the stale advertiser + doc currency |
| bug-112 | minor | PR-3 | task-144 phantom `Pending actions: 2`; stale-task admin gap |
| bug-109 | major | own mission | non-hub CI cells masked structural debt — claude-plugin e2e harness dead, opencode-plugin baseline broken |

**Sequencing (thread-608, concurred):** PR-1 first (de-risk the flaky CI cell so
it doesn't red-herring PRs 2-4) → PR-2 → PR-3 → bug-109 spins into its own
mission with a Survey pass (opencode-plugin deprecate-vs-maintain is a
Director-strategic call; PolicyLoopbackHub repair-vs-replace is a design fork).

**PR cadence:** apnex-org repo → PR-flow. Engineer opens each PR; architect
cross-approves (Hub thread + `gh pr review --approve`) and merges on green CI.

---

## PR-1 — bug-110 (vitest teardown race)

**Branch:** `agent-greg/bug-110-vitest-teardown-race` (off `origin/main @ a3252eb`)

### Root cause (confirmed in code — refines the bug's attribution)

bug-110 names `substrate-counter.race.test.ts` as "leaves a pg client open."
Code-read finding: that test does NOT leak — it already calls `substrate.close()`
in `afterAll`. The real root cause is broader and structural:

**pg's documented contract** — a `Pool`/`Client` with NO `'error'` listener turns
a backend error on an *idle* connection into an UNCAUGHT exception that crashes
the process. The hub substrate constructed its pg resources WITHOUT that handler
at 4 long-lived sites:

- `postgres-substrate.ts:42` — substrate `Pool`
- `postgres-substrate.ts:232` — `watch()` dedicated LISTEN `Client`
- `schema-reconciler.ts:67` — reconciler `Pool`
- `token-store.ts:56` — token-store `Pool`

(`migration-runner.ts:43` — `Client` — EXCLUDED: provably short-lived, always
`client.end()`-ed in `finally` before the function returns; cannot be open at
teardown.)

In CI a postgres testcontainer's `container.stop()` racing the pool's own
teardown delivers a `57P01` to a still-idle connection → uncaught exception →
`vitest (hub)` exits 1 even though all tests pass (tripped #236 + #237). Same gap
in production: a postgres failover/restart would crash the Hub process.

### Fix (shipped in PR-1)

- New `src/storage-substrate/pg-error-handler.ts` — `attachPgErrorHandler(emitter,
  label)`: the canonical pg `'error'` handler (log non-fatal, don't crash). DRY
  across the 4 sites.
- Applied at all 4 pg-resource sites above.
- `HubStorageSubstrate` interface — `close(): Promise<void>` promoted to the
  interface (was an implementation-only method reached via an `as unknown` cast).
  `MemoryStorageSubstrate.close()` added as a no-op (no connections).
- `substrate-counter.race.test.ts` `afterAll` — `await substrate.close()`
  (typed; no cast, no optional-chain that silently no-ops a missing teardown).
- Regression guard: `__tests__/pg-error-handler.test.ts` — deterministic
  (no container) — proves a post-attach `'error'` is handled, not thrown.

### Verification

- `tsc --noEmit` clean (no interface-fake breakage).
- Full hub suite green: 114 files passed / 1 skipped, 1496 tests passed / 7
  skipped (was 113 / 1493 pre-PR; +1 file +3 tests = the new helper test).
- substrate subset (25 testcontainer files) green ×16.
- Note: the rare flake did NOT reproduce locally pre-fix (~36 runs); the fix is
  mechanically certain (the missing handler is pg's documented crash contract)
  and the unit test is the dispositive deterministic proof.

## Session log

### 2026-05-22 AM AEST — batch picked up; PR-1 implemented

- thread-608: architect surfaced the 5-bug batch + proposed grouping. Confirmed
  grouping/sequencing with refinements (PR-2 one-PR; bug-113 hub-side already
  done at idea-252 §2; PR-3 directional (a)-new-tool vs (b)-document-drain→prune;
  bug-109 → own mission). Architect concurred all.
- PR-1 root-caused (above), implemented, verified. Branch cut off `origin/main
  @ a3252eb`. NEXT: commit + push + open PR-1 + surface on thread-608.
