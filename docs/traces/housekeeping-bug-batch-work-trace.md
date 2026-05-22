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

---

## PR-3 — bug-112 (create_review backfill on an unreviewed completed task)

**Branch:** `agent-greg/bug-112-create-review-completed-fix` (off `origin/main @ 7b91c5d`)

### Scoping saga — the (a)/(b) fork was on the wrong axis

bug-112's filing framed the task-144 phantom as "stuck `enqueued` items in the
pending-actions queue", and the architect's directional fork — (a) new
force-close tool vs (b) document the `drain → prune` route — inherited that
premise. Scoping verified drain→prune *as a queue operation* was clean (no
re-dispatch, dispatchType+entityRef-scopable, idempotent) → recommended (b),
architect confirmed (b) as a pure-doc runbook.

**STOP at PR-3 build time:** reading `get_pending_actions`'s implementation to
write the runbook revealed the whole axis was wrong. `get_pending_actions.
totalPending` is computed from **task / proposal / thread entity scans, not the
pending-action queue** (`system-policy.ts` — `unreadReports` + `unreviewedTasks`
filters over `task.listTasks()`). drain→prune mutates the queue — a different
store — so it cannot move `totalPending`. The (b) runbook would not have closed
bug-112; its acceptance test would have failed. Surfaced to the architect before
any artifact shipped; architect cross-checked task-144 live (`status: completed`,
`report` non-null, `reviewAssessment: null`, `reviewRef: null`) and re-disposed.

### Root cause (verified)

task-144 was force-`completed` via a gsutil edit (2026-04-18, FSM-bypassed) — it
never travelled `in_review → completed` through `submitReview`, so
`reviewAssessment` was never written. `get_pending_actions` counts a task with a
terminal status + `report != null` + `!reviewAssessment` under BOTH
`unreadReports` and `unreviewedTasks` → `totalPending += 2` (the phantom
"Pending actions: 2"). `create_review(approved)` on a `completed` task hit a
pure no-op idempotency branch (`review-policy.ts:42-58`) — it never called
`submitReview` (the only `reviewAssessment` writer) — so there was no path to
clear it.

### Fix (Option 1 — architect re-disposed)

- `review-policy.ts` — `create_review`'s `completed`-task branch now
  distinguishes "genuinely already reviewed" (`reviewAssessment` present →
  preserve the idempotent no-op) from "completed but never reviewed"
  (`!reviewAssessment` → retroactive backfill via `submitReview`). The backfill
  records `reviewAssessment` + `reviewRef`; `"approved"` re-asserts
  `status: completed` (identity write — no transition); deliberately NO dispatch
  / no `task_completed` cascade / no triggers (bookkeeping backfill on an
  already-terminal task).
- **Class scope — `completed`-only, justified** (architect review point 1): the
  silent-no-op blind spot is structurally `completed`-only — `create_review`'s
  no-op branch is `if (task.status === "completed")`. `failed` / `reported_*` /
  `escalated` tasks don't reach a no-op branch; they hit the `isValidTransition`
  FSM-guard and hard-error (a structurally different defect, not a silent
  no-op). The architect's observed `totalPending: 2` (both task-144) confirms
  `completed` is the only live phantom class — no `failed`/`reported_*`
  instances. A `failed`/`reported_*` analog, if it ever arises, is a separate
  fix (idea-78 territory).
- `test-utils.ts` — `createTestContext` now exposes the backing `substrate` so
  tests can seed entity state the public store API cannot construct (the
  `completed` + no-`reviewAssessment` shape).
- Regression test `test/bug-112-create-review-completed-backfill.test.ts` —
  exercises the fix THROUGH the real `get_pending_actions` (architect review
  point 2): asserts the seeded task drops from `unreadReports` +
  `unreviewedTasks` and `totalPending` goes 2 → 0; plus an idempotency case
  (second `create_review` is a no-op, does not overwrite the first assessment).

### Verification
- `tsc --noEmit` clean.
- Full hub suite green: 115 files / 1498 tests (was 114 / 1496; +1 file +2 tests
  = the new bug-112 regression test).

### Closure
- Option 1 is hub/src → folds into bug-110's Hub-redeploy gate. bug-112's
  acceptance test (`create_review(task-144, approved)` → task-144 drops from
  `get_pending_actions`) runs **post-redeploy**; bug-112 closes at the redeploy
  gate alongside bug-110. PR-merged ≠ bug-closed.
- idea-78 (broad Task-FSM governance) stays a separate audited triage item;
  bug-112's filing cross-links it.

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
  bug-109 companion comment-refs reworded (3rd already gone). Surfaced as #239;
  architect cross-approved + merged to main @ `7b91c5d`. bug-114 filed for the
  cache-invalidation design gap.

### 2026-05-22 — PR-3 scoping STOP + re-disposition

- PR-3 scoped: located idea-78 (broad stale-task-admin idea); verified
  drain→prune; recommended (b); architect confirmed (b) as a pure-doc runbook.
- STOP at build time — reading `get_pending_actions` showed the (a)/(b) fork's
  shared premise ("queue problem") was wrong; surfaced with code evidence.
- Architect re-disposed to Option 1 (`create_review` backfill). PR-3 re-shaped
  to the policy fix + regression test; the runbook is dropped. Branch cut off
  `origin/main @ 7b91c5d`. Implemented + verified (full suite 115/1498 green).
  NEXT: commit + push + open PR-3 + surface on thread-608.

### 2026-05-22 — PR-4 (bug-109) triage + PR-4a

- Triaged the 4 non-hub CI cells (CI job logs + local runs). Verified finding:
  all 4 cells die at `actions/setup-node` — `cache-dependency-path` references
  per-package lockfiles that don't exist post-npm-workspaces (idea-186 landed).
  No cell currently runs tests in CI.
- Per-cell underlying state: cognitive-layer GREEN; network-adapter dead
  `PolicyLoopbackHub` harness (mission-83-removed `hub/src` Memory stores);
  claude-plugin dead-harness + a real masked regression (`eager-claim`, 5
  failures); opencode-plugin dead-harness + `shim.ts` symbols that exist in
  current network-adapter source (FINDING 2 corrected — stale-built-dep, not
  source drift).
- PolicyLoopbackHub: recommend REPAIR (rewire to `createMemoryStorageSubstrate`
  + `*RepositorySubstrate`, the `test-utils.ts` pattern) over replace.
- Surfaced triage on thread-608; architect routed PR-4 off the PR body (thread
  outgrew `get_thread`'s 10-message page). Shape: split 4a/4b/4c.
- **PR-4a** — `vitest-non-hub` CI-job fix: root `npm ci` + topological
  sovereign build + per-cell test (replaces the dead per-package `npm ci`).
  Branch off `origin/main @ 0b4d3db`. NEXT: push + open PR-4a (full triage in
  the PR body) + short thread ping.
- PR-4a #241 opened; first CI run un-masked a second layer — root
  `package-lock.json` stale (nested `file:ois-*.tgz` refs for opencode-plugin;
  the AG-5-deferred hazard). Architect concurred the triage + 4a/4b/4c split +
  PolicyLoopbackHub repair; disposed the lockfile regen into PR-4a. Regenerated
  the root lockfile (`rm package-lock.json && npm install` — 3 stale `file:`
  refs → 0; 7 workspace links). Verified the full CI sequence locally: clean
  `npm ci` OK, 4-pass topological build OK, all 4 cells reach their tests
  (cognitive-layer 173/173 green; the other 3 reach real per-cell failures).

### 2026-05-22 — PR-4b split + bug-109 tail sequence

- PR-4b draft #242 surfaced a scoping finding: the "2nd stale-import site" is
  not a one-line import — it is `test-hub.ts`, a second 404-line dead harness
  whose `HubNetworking` constructor call is API-stale (drifted mission-56/83).
- Architect disposed (thread-609): land #242 as the `policy-loopback.ts` repair
  ONLY (re-title, un-draft); `test-hub.ts` is its own slice. bug-109 tail
  sequence: **#242 (policy-loopback)** → **test-hub.ts slice** (store-rewire +
  HubNetworking reconciliation) → **session-FSM slice** (`getAgentForSession
  →null`, 27 e2e tests) → **PR-4c residuals** (eager-claim regression, opencode
  stale-dist, aggregator re-adds + `continue-on-error` drops).
- #242 finalized as the bounded `policy-loopback.ts` import-rewire: the
  claude-plugin e2e + 3 network-adapter integration files now load. The 27
  session-FSM reds it exposes are continue-on-error / non-blocking + now
  specific (the un-masking working as intended).

### 2026-05-22 ~12:50 AEST — session cleared mid-batch; bug-109 session-FSM fixture-fix slice

- Session cleared (Director-initiated) mid-batch. Cold-pickup: re-read this
  trace + thread-609 (the tail spine). Current task per architect: the
  session-FSM fixture-fix slice.
- **Diagnosis (already concurred, thread-609) — (b), test-fixture gap.**
  `createActor` + inline handshakes generate agent names from a full
  `randomUUID()` (54 / 44 chars); the Hub's `register_role` enforces an
  idea-251 name-length limit `[1,32]` (`session-policy.ts:73`, `invalid_name`).
  Over-length name → register_role rejected → no Agent → `agentIdForSession
  → null` → "Agent entity was not created". No FSM-semantics gap.
- **Sweep (architect discipline ask — grep EVERY name-gen site):**
  - network-adapter: 6 over-length `handshake.name` sites — `label-routing.ts:45`
    + `threads-2-smoke.ts:49` (`loopback-${role}-${randomUUID()}`, 54 chars);
    `cognitive-integration.ts:56/147/201/266` (`cog-int-/cb-/std-/err-` + full
    UUID, 39-44). All 6 fixed → `randomUUID().slice(0, 8)` (16-27 chars; the
    first 8 UUID chars are hex, no dash — clears NAME_REGEX too).
  - claude-plugin + opencode e2e: NO over-length `name`. They pass the RETIRED
    `globalInstanceId` field (idea-251 D-prime renamed it → `name`) and omit
    the now-required `name`. Failure mode there is `handshake.parse_failed`,
    NOT `invalid_name` — a distinct fixture-staleness defect. Surfaced to the
    architect for PR-4c folding (same harness-staleness class as eager-claim).
- **Verification:** baseline 3 integration files = 20 failed / 3 passed →
  post-fix 23 / 23 passed. Full network-adapter suite: 1 file failed (the 7
  `mcp-transport.test.ts` reds = the separate `test-hub.ts` slice,
  `MemoryEngineerRegistry is not a constructor`) / 16 passed; 188 tests,
  181 passed. `tsc --noEmit` clean.
- Branch `agent-greg/bug-109-session-fsm-fixture-names` off `origin/main @ 3dd33cb`;
  commit `7b7d687`. **PR #243 opened**, surfaced on thread-609 for cross-approval.
- PR #243 cross-approved + merged to `origin/main @ f837c32`. Architect concurred
  the sweep + the `globalInstanceId→name` fold into PR-4c.

### 2026-05-22 ~13:05 AEST — bug-109 test-hub.ts slice (substrate store-rewire + HubNetworking reconciliation)

- The 2nd dead harness — `test/helpers/test-hub.ts`, consumed by
  `mcp-transport.test.ts` (7 reds, `MemoryEngineerRegistry is not a
  constructor`). Two drift axes, exactly as architect-characterised:
  - **Store-rewire:** the harness built `AllStores` from the mission-83-removed
    `Memory*Store` classes. Rebuilt on `createMemoryStorageSubstrate` +
    `SubstrateCounter` + the `*RepositorySubstrate` repositories — the
    `test-utils.ts` / PR-4b `policy-loopback.ts` pattern. `AllStores` had also
    gained `bug` / `pendingAction` / `message` since the harness was last
    current; all three added.
  - **HubNetworking-constructor reconciliation:** `test-hub.ts:336` called the
    pre-mission-56 4-arg shape `(engineerRegistry, notificationStore,
    createMcpServerFn, config)`. Current signature (`hub-networking.ts:208`):
    `(engineerRegistry, createMcpServerFn, config, auditStore, messageStore,
    tierLookup?, tokenStore?)` — the legacy `notificationStore` 2nd arg was
    removed at mission-56 W5 (push pipeline flows through the Message store);
    `auditStore` + `messageStore` are now required tail args. Rewired.
  - **Companion drift:** `CreateMcpServerFn` gained a 4th `dispatchEvent` arg;
    `IPolicyContext` gained required `dispatch` + dropped `config` (mission-84
    W5). `createMcpServer` now threads `dispatchEvent` into `ctx.dispatch`; the
    stale `config` field is dropped.
- No additional crossing — every `HubNetworking` public method `TestHub`
  delegates to still exists; `TestHub`'s public API is unchanged.
- **Verification:** `mcp-transport.test.ts` 7-failed → 7/7 passed. Full
  network-adapter suite **17 files / 188 tests, all green** (was 16/17 files,
  181/188 tests). `tsc --noEmit` clean.
- Branch `agent-greg/bug-109-test-hub-substrate-rewire` off `origin/main @ f837c32`;
  commit `4f6845e`. **PR #244 opened**, surfaced on thread-609 for cross-approval.

### 2026-05-22 ~13:30 AEST — #244 held: CI-vs-local masking → γ fix folded in

- Architect held #244 (PR review): CI's `vitest (packages/network-adapter)` cell
  is RED while my local run was 188/188. **Local-test-masking** — "cell genuinely
  green" was a *local* result; local `node_modules` is root-hoisted, CI's non-hub
  cell does a *scoped* install. Owned it; corrected method = re-verify against CI.
- **Diagnosis (architect-concurred):**
  - The `@apnex/message-router` TS2307 the review flagged is a **non-issue** —
    the CI Build step's per-step conclusion is `success`; the TS2307 is the
    swallowed first pass of test.yml's network-adapter↔message-router cycle-break
    multi-pass build (`( cd … && npm run build ) || true`). Verified via the
    job-step API.
  - The one real failure is **`pg`**: the harnesses import
    `createMemoryStorageSubstrate` from the `storage-substrate/index.js`
    **barrel**, which statically re-exports `postgres-substrate.js` → `import
    'pg'`. `pg` is a `hub`-package dep; the non-hub cells' scoped install
    excludes the `hub` workspace → `ERR_MODULE_NOT_FOUND`. Single reach point —
    entity repos + `policy/index.ts` import the substrate `import type` only
    (erased). claude-plugin/opencode hit it transitively via `policy-loopback.ts`.
- **Fix — (γ), architect-disposed, folded into #244:** repoint the 2 harness
  value-imports — `policy-loopback.ts` + `test-hub.ts` — from the barrel
  `storage-substrate/index.js` → the leaf `storage-substrate/memory-substrate.js`
  (pg-clean — only `import type` from `types.js`). Two one-line changes,
  test-side, no redeploy; clears the `pg` reach across all 3 non-hub cells.
- **α — follow-on note (architect-concurred, OUT of bug-109 scope):** the
  `storage-substrate/index.ts` barrel eagerly static-re-exporting the postgres
  path drags `pg` onto *every* barrel-importer. A lazy/dynamic import of the
  postgres path would let `createMemoryStorageSubstrate` consumers avoid `pg`
  entirely. Hub/src → redeploy gate; low-priority — capture only, do not fix in
  this batch. (β — broaden the CI scoped install — rejected: fights test.yml's
  prepare-hook warning.)
- **Re-verify against CI, not local.** Local tsc + suite green (188/188) is
  sanity only — local resolves `pg`. Dispositive check: the CI
  `vitest (packages/network-adapter)` cell on the #244 push.
- γ pushed (`f8f694d`); CI re-verified — `pg` reach **cleared**, network-adapter
  cell `4 failed → 1 failed / 16 passed`. The remaining 1 (`threads-2-smoke.test.ts`)
  hit a **2nd hub-only dep** — `ulidx`, via `message-repository-substrate.ts:93`'s
  `await import("ulidx")` (ULID message-id gen). Same class as `pg`; the `pg`
  failure had masked it. My prior "single reach point" diagnosis under-scoped (a
  dynamic `import()` a static grep missed).
- Completed the full hub-dep enumeration: of hub's 6 deps absent from the
  non-hub cells, `ulidx` is the only live runtime reach (the other 5 ruled out —
  type-only ×2 / not-imported-in-hub-src / type-only-erased / not in the harness
  graph). So `ulidx` is the last one — fixing it → 17/17.
- **`ulidx` fix — architect-disposed option (1), folded into #244:** `ulidx`
  added as a `network-adapter` devDependency (`^2.4.1`, matches hub). Unlike
  `pg`, `ulidx` can't be dodged by a leaf-import — ULID generation is needed by
  the memory path; the cell genuinely needs the dep. Scoped install + root hoist
  makes it resolvable across all 3 non-hub cells.
- Lockfile: hand-added the `ulidx` + `layerr` (its dep) entries for a minimal
  +22/−0 delta. A plain `npm install --package-lock-only` additionally stripped
  two `@emnapi/*` optional-peer entries (a known `npm ci` hazard) — avoided via
  the surgical edit.
- NEXT: commit + push #244 → watch CI → re-surface on thread-609 when the
  network-adapter cell is genuinely 17/17 green. NEXT (post-merge): PR-4c.
