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
| bug-109 | major | PR-4 | non-hub CI cells masked structural debt — claude-plugin e2e harness dead, opencode-plugin baseline broken |

**Sequencing (thread-608, concurred):** PR-1 first (de-risk the flaky CI cell so
it doesn't red-herring PRs 2-4) → PR-2 → PR-3 → PR-4. bug-109 was originally
slated for its own mission, but the Director disposed opencode-plugin RETAINED
(2026-05-22), collapsing its only Director-strategic fork — so it folds back
into the batch as PR-4. The PolicyLoopbackHub repair-vs-replace fork is settled
bilaterally with the architect at PR-4 scoping.

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

---

## PR-2 — bug-111 + bug-113 (+ bug-109 companion comment-refs)

**Branch:** `agent-greg/bug-111-113-agent-state-diagnostics` (off `origin/main @ 5b48893`)

### bug-111 — get-agents.sh Hub-URL resolution

`scripts/local/get-agents.sh` hardcoded `DEFAULT_HOST="http://localhost:8080"` —
the local Hub decommissioned at mission-86 W5.4. Fix: resolve the Hub URL at
runtime — `--host` flag > `HUB_URL` env > `.ois/adapter-config.json` `hubUrl`
(trailing `/mcp` normalised off; `call_get_agents` re-appends it). No hardcoded
default; an unresolved URL is a hard error (exit 2). **Verified live** — the
script resolved the cloud Hub URL from adapter-config and rendered the agent
table (greg + lily `online_idle`).

### bug-113 — list_available_peers advertised-but-uncallable

Locate step (architect's ListTools-vs-router hypothesis): the Hub builds its
`tools/list` directly from the router via `bindRouterToMcp` — no separate
advertised-schema list. **Verified against the live Hub**: `tools/list` returns
71 tools, `list_available_peers` absent, `get_agents` present. The Hub side is
clean — idea-252 §2's retirement is fully live.

The stale advertiser is the **network-adapter `.ois/tool-catalog.json` cache** —
a gitignored per-WORK_DIR snapshot (fetched 2026-04-22, `hubVersion 1.0.0`, 58
tools, still listing `list_available_peers`). Root cause: `tool-catalog-cache.ts`
invalidates on `hubVersion` mismatch ONLY ("the catalog is static between Hub
deploys" — a false assumption); the Hub stayed `1.0.0` through a month of
tool-surface change (58→71 tools + the idea-252 retirement), so the cache never
invalidated.

- **part-1** — NOT a repo-source change. The stale cache is a local artifact; it
  regenerates on a clean re-fetch. The cache-invalidation design gap
  (version-only) is surfaced to the architect — recommend Hub-version-bump
  discipline on tool-surface changes (lightest fix), or a cache-hardening
  follow-on (TTL / tool-set fingerprint).
- **part-2** — doc currency: `all-schemas.ts:37` index-comment cite updated
  (`list_available_peers` → `get_agents`). `multi-env-operator-setup.md` already
  carries the idea-252 replacement note. Historical design/audit/decision docs
  left as-is (they record history, not current guidance). Architect did the
  `reference_get_agents_canonical_diagnostic` memory.

### bug-109 companion — 3 stale comment-refs

- `hub/src/policy/agent-projection.ts` — ref to removed
  `scripts/migrate-canonical-envelope-state.ts` → comment reworded.
- `.gitignore` — ref to removed `scripts/state-sync.sh` + deleted GCS → comment
  reworded.
- `packages/storage-provider` local-fs `state-backup.sh` ref — already gone:
  `local-fs.ts` itself was deleted at mission-84 W4 (LocalFsStorageProvider
  retirement); the stale comment died with its file. No edit.

### Verification
- `tsc --noEmit` clean (agent-projection.ts + all-schemas.ts are comment-only).
- get-agents.sh verified live against the cloud Hub.

## Session log

### 2026-05-22 AM AEST — batch picked up; PR-1 implemented + merged

- thread-608: architect surfaced the 5-bug batch + proposed grouping. Confirmed
  grouping/sequencing with refinements (PR-2 one-PR; bug-113 hub-side already
  done at idea-252 §2; PR-3 directional (a)-new-tool vs (b)-document-drain→prune;
  bug-109 → own mission). Architect concurred all.
- PR-1 root-caused, implemented, verified, surfaced as #238. Architect
  cross-approved + merged to main @ `5b48893`. bug-110 reattributed minor→major
  (production-failover-crash finding); stays open until the Hub redeploy gate.

### 2026-05-22 AM AEST — PR-2 implemented

- bug-109 disposition changed: Director retained opencode-plugin → bug-109 folds
  back as PR-4 (no separate mission).
- PR-2 implemented (above): get-agents.sh Hub-URL resolution (verified live);
  bug-113 located (stale adapter cache, not a repo defect — surfaced); 2 of 3
  bug-109 companion comment-refs reworded (3rd already gone). Branch cut off
  `origin/main @ 5b48893`. NEXT: commit + push + open PR-2 + surface on
  thread-608.
