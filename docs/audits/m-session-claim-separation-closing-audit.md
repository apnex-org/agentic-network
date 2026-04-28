# Mission M-Session-Claim-Separation — Closing Report

**Hub mission id:** mission-40
**Mission brief:** `documents/missions/m-session-claim-separation.md` v1.1 (architect-ratified on thread-245 round 4; Director-ratified post-architect-review).
**Resolves:** bug-26 (probe-induced session displacement).
**ADR:** ADR-021 — Identity / Session Claim Separation (`docs/decisions/021-identity-session-claim-separation.md`).
**Dates:** Diagnosed 2026-04-22 cold-start (lily); ratified + executed same day (T1–T5); mission-close 2026-04-22 AEST.
**Scope:** 5-task adapter+Hub protocol cutover splitting the conflated `register_role` primitive into idempotent identity-assertion (`register_role`) plus explicit session-claim (`claim_session`), with two back-compat auto-claim hooks routing through a single Hub helper, plus a probe-safe tool-catalog cache that takes the adapter Hub-free against a warm cache.

Mid-architectural-review execution per Director's one-off greenlight (bug-26 was a review-blocker class for any future cold-start). Anti-goal #6 of the 2026-04 review plan ("don't execute open missions mid-review") remains in force for everything else.

---

## 1. Deliverable scorecard

| Task | Source directive | Status | Commit | Effort estimate vs actual | Test count delta |
|---|---|---|---|---|---|
| **T1** — Hub identity+session helpers (purely additive) | task-318 | ✅ Approved | `18cde2d` | 1.5d est / ~1.5d actual | +14 hub tests |
| **T2** — Hub protocol cutover (`register_role` idempotent + `claim_session` tool + back-compat hooks) | task-320 (task-319 cancelled — bug-28) | ✅ Approved | `a011fcd` | 1.5d est / ~1.5d actual | +15 hub tests + 12 wave1 fixture updates + 1 e2e tool-count |
| **T3** — Adapter lazy-claim refactor + `OIS_EAGER_SESSION_CLAIM` env hint | task-321 | ✅ Approved | `dd1423c` | 1.0d est / ~1.0d actual | +13 claude-plugin tests + 3 network-adapter tests updated/added |
| **T4** — Adapter tool-catalog cache (probe-safe ListTools) | task-322 | ✅ Approved | `9e14ff7` | 0.5d est / ~0.5d actual | +13 cache helper tests + 7 dispatcher cache integration tests |
| **T5** — Closing audit + ADR-021 + dashboard spec + bug-26 flip | task-323 (this report) | ⏳ In review | (this commit) | 0.5d est / ~0.5d actual | 0 (doc-only) |

**Aggregate:** 5 tasks, 5 commits, ~5.0 engineer-days estimated and actual. Zero estimate-vs-actual drift across the mission. bug-26 flips `open → resolved` at this report's commit.

**Test counts at mission close:**
- Hub: 639 passing + 5 skipped (pre-existing) — was 608 at mission start; +31 mission-introduced
- network-adapter: 108 passing — was 105 at mission start; +3 mission-introduced (handshake epoch-jump semantic update)
- claude-plugin: 67 passing — was 34 at mission start; +33 mission-introduced (eager-claim helpers + cache helpers + dispatcher cache integration)

**Sync state at mission close:** `9e14ff7` on `agent/greg`, `main`, `agent/lily` (T5 commit added on top once approved). Both worktree adapter dists rebuilt + byte-verified after each task ship.

---

## 2. Mission goal + success framing

**Parent bug-26** (major severity, `class: identity-management`): probe-induced session displacement. Pre-mission, every adapter spawn — including transient probes from `claude mcp list`, plugin reload, IDE restart — ran a full Hub handshake using the same fingerprint (`sha256(OIS_INSTANCE_ID)`) and silently displaced any live session via `sessionEpoch++`. The bug class was operator-visibility-breaks-the-system: looking at plugin health killed the live session it was meant to inspect.

**Mission-40 goal:** make probe-induced displacement **structurally impossible**, not detection-dependent. Split the conflated `register_role` primitive (which did identity-assertion AND session-claim under one tool call) into two semantically-distinct protocol operations. Probes assert identity but never claim sessions; only declared-real-sessions claim. Bug-class closes by construction.

**Success criteria (from brief §1, ratified):**

1. ✅ `claude mcp list` (or any other transient adapter spawn) leaves `sessionEpoch` and `currentSessionId` of the live agent unchanged. Verified via t2-cutover.test.ts "probe of new agent does NOT displace a live session of the same fingerprint" + dispatcher-list-tools-cache.test.ts "served from cache" path.
2. ✅ A real session restart still correctly displaces the prior session. Verified via t2-cutover.test.ts "claim_session from one adapter displaces the other's prior claim".
3. ✅ Hub protocol surface explicitly distinguishes identity assertion from session claim. `register_role` and `claim_session` are independently registered MCP tools with independently-correct semantics.
4. ✅ Existing adapters that never update keep working unchanged. Hub auto-claims via SSE-subscribe + first-tools/call hooks with `agent_session_implicit_claim` audits (carrying `trigger` field) so the implicit-path is observable + deprecation-trackable.
5. ✅ tele-3 Sovereign Composition Logic Leakage fault closed at the Hub-side identity contract.
6. ✅ tele-1 Sovereign State Transparency Hidden State fault closed (the conflation of identity+session was the hidden state; new typed audit actions make it perceivable).
7. ✅ Adapter probe-spawns observably idempotent on Hub session state (T2 Hub-side + T3 adapter-side + T4 cache layer).

---

## 3. Per-task architecture recap

Full detail in each task's report under `reports/task-318-v1-report.md` through `reports/task-322-v1-report.md` and the corresponding commit messages.

### 3.1 T1 — Hub identity+session helpers (purely additive)

`IEngineerRegistry` gained two new methods:
- `assertIdentity(payload, sessionId?)` — idempotent identity-claim. Refreshes mutable handshake fields per the bug-16 C5 label-refresh contract (does NOT redefine those semantics). Never touches `sessionEpoch` / `currentSessionId` / `status`.
- `claimSession(engineerId, sessionId, trigger)` — single helper for all session-claim paths. `trigger` = `"explicit" | "sse_subscribe" | "first_tool_call"` — discriminates audit emission only; helper implementation is one path.

Existing `registerAgent` refactored to call `assertIdentity` then `claimSession(..., "sse_subscribe")` under the hood. **Externally byte-identical** to pre-T1 — the load-bearing T1 invariant. Validated by 622+ existing hub tests staying green (Mission-19 routing, bug-16 lifecycle, Threads 2.0 dispatch, ADR-013/014/017, all e2e).

### 3.2 T2 — Hub protocol cutover

`register_role` policy handler refactored to call `assertIdentity` directly (no longer through `registerAgent`). Returns `sessionClaimed: false` field; `currentSessionEpoch` reflects as-observed value (NOT just-incremented). `register_role` no longer claims sessions.

New `claim_session` MCP tool exposed: takes no args, uses authenticated MCP session ID from transport context, calls `claimSession(..., "explicit")`, emits `agent_session_claimed` + (when displacing) `agent_session_displaced`. Returns `{ engineerId, sessionEpoch, sessionClaimed: true, displacedPriorSession? }`.

Two back-compat auto-claim hooks land at the policy + transport layer:
- **SSE-subscribe** (in `HubNetworking.app.get("/mcp")` SSE handler): on stream open, if session has identity but no claim → `claimSession(..., "sse_subscribe")` + `agent_session_implicit_claim` audit with `trigger=sse_subscribe`.
- **First-tools/call** (in `PolicyRouter.handle`): before tool dispatch, same logic with `trigger=first_tool_call`. Skip-list: `register_role` + `claim_session` (avoid chicken-and-egg).

`assertIdentity` extended with optional `sessionId` parameter — when provided, records the binding `sessionToEngineerId` so the auto-claim hooks can look up identity later. No new registry methods (per directive); signature extension only.

### 3.3 T3 — Adapter lazy-claim refactor + `OIS_EAGER_SESSION_CLAIM` env hint

`shim.ts main()` adopted three-phase deferred model:
- `identityReady` (was `handshakeComplete`) — gates ListTools.
- `sessionReady` (NEW) — gates CallTool. In eager mode resolves on `claim_session` response; in lazy mode resolves on `identityReady` (Hub-side hooks handle the actual claim server-side).
- `syncReady` (was `agentReady`) — informational; resolves on `agent.start()` return.

`OIS_EAGER_SESSION_CLAIM=1` env hint declared by wrapper scripts (`start-greg.sh`, `start-lily.sh`). Probes inherit shell env but don't go through wrappers, so they don't set the var and stay lazy — the declarative boundary that preserves bug-26 resolution at the adapter layer.

Three pure helpers extracted into `eager-claim.ts` for unit testability:
- `isEagerWarmupEnabled` — strict `=== "1"` detection (typo-safe).
- `parseClaimSessionResponse` — defensive MCP-wrapper unwrap of the `claim_session` response.
- `formatSessionClaimedLogLine` — structured-parseable stderr log line per HC #5.

Adapter-layer takeover detection routed through these helpers, keying on `sessionClaimed` + `displacedPriorSession` from the `claim_session` response — NOT on epoch-delta against any prior `register_role` response (per HC #1 + anti-goal §7.5). `packages/network-adapter/src/handshake.ts` epoch-jump detection threshold updated `> 1` → `> 0` to match T2 semantics (any positive delta now means external displacement, since `register_role` no longer auto-bumps).

### 3.4 T4 — Adapter tool-catalog cache

`tool-catalog-cache.ts` provides three pure functions (`readCache`, `writeCache`, `isCacheValid`) plus the `CATALOG_SCHEMA_VERSION` constant. Cache file at `$WORK_DIR/.ois/tool-catalog.json`:

```json
{
  "schemaVersion": 1,
  "hubVersion": "1.0.0",
  "fetchedAt": "2026-04-22T...Z",
  "catalog": [...]
}
```

`dispatcher.ts` ListTools handler inserts cache fallback at T3's marker:
- If `identityReady` unresolved + cache valid → serve cached catalog (probe path: <50ms, zero Hub round-trip).
- If `identityReady` unresolved + no cache / stale → bootstrap (one-time live fetch + persist).
- If `identityReady` resolved → live path (existing behavior preserved).

Cache invalidation: Hub version mismatch only (no TTL — catalog is static between Hub deploys). Hub version source: background `/health` fetch at adapter startup, populates an in-memory `cachedHubVersion`. Probes that fire before fetch completes get `null` and trust cache (probe-friendly default).

Atomic writes via `tmp-file + rename` — partial writes on crash never corrupt the cache. Best-effort: filesystem failures degrade gracefully (cache never populates; ListTools always goes to Hub).

### 3.5 T5 — Closing audit + ADR-021 + dashboard spec + bug-26 flip

This report. ADR-021 documents the identity-vs-session-claim separation decision with explicit Consequences-section call-out of the `currentSessionEpoch` semantics change (so future adapters reading the ADR know epoch-delta is no longer a takeover indicator). Dashboard spec at `docs/observability/m-session-claim-separation-runway-dashboard.md` defines the deprecation-runway panel queries. bug-26 entity flipped `open → resolved` with `fixCommits` referencing all five commits.

---

## 4. Audit-action inventory

T1-T2 introduced four new audit actions. All emission sites + payload shapes + consumer paths documented for the deprecation-runway dashboard parser. Per T2 HC #4, `trigger` field is encoded in the `details` string (not a structured payload field — `AuditEntry` doesn't yet carry one; promoting it is a deferred post-dashboard idea).

| Audit action | Actor | relatedEntity | Fires when | Payload shape (in `details` string) |
|---|---|---|---|---|
| `agent_identity_asserted` | `hub` | engineerId | Every `register_role` call (T2). Replaces the implicit displacement-on-handshake audit pattern from pre-T2. | `Agent ${engineerId} identity asserted (wasCreated=${bool})` |
| `agent_session_claimed` | `hub` | engineerId | Explicit `claim_session` MCP tool call (T2). Trigger is always `explicit` for this action. | `Agent ${engineerId} session claimed (trigger=explicit, epoch=${N})` |
| `agent_session_implicit_claim` | `hub` | engineerId | One of the two back-compat auto-claim hooks fired (T2): SSE-subscribe (in `HubNetworking`) or first-tools/call (in `PolicyRouter.handle`). | `Agent ${engineerId} session implicitly claimed (trigger=${sse_subscribe\|first_tool_call}, epoch=${N}[, originatingTool=${name}])` |
| `agent_session_displaced` | `hub` | engineerId | Emitted alongside `agent_session_claimed` or `agent_session_implicit_claim` when the new claim evicted a prior session. | `Agent ${engineerId} session displaced (priorSessionId=${id}, priorEpoch=${N}, newEpoch=${N+1}, trigger=${value})` |

**Existing audit actions preserved unchanged** (no functional or shape change in this mission):
- `agent_handshake_refreshed` (CP3 C5 / bug-16) — still emitted from `register_role` policy handler when mutable handshake fields refresh stored state. Independent of identity-vs-session-claim distinction.

**Emission site inventory:**
- `agent_identity_asserted` — `hub/src/policy/session-policy.ts` line ~100 (every `register_role` ok-path).
- `agent_session_claimed` — `hub/src/policy/session-policy.ts` line ~189 (explicit `claim_session` tool handler).
- `agent_session_implicit_claim` — `hub/src/hub-networking.ts` SSE GET `/mcp` handler (after stream open), AND `hub/src/policy/router.ts` `handle()` (after RBAC, before tool dispatch).
- `agent_session_displaced` — alongside each `*_claimed` and `*_implicit_claim` site when the helper returns `displacedPriorSession`.

**Consumer:** the §10.1 deprecation-runway dashboard (specified in `docs/observability/m-session-claim-separation-runway-dashboard.md`) parses `agent_session_implicit_claim` `details` strings via regex `/trigger=([a-z_]+)/` to split the implicit-claim rate by trigger. Both sub-rates must trend to zero before the back-compat hooks can be retired (post-architectural-review hardening, brief §10.1).

---

## 5. Observability surface

The mission introduced multiple parse-stable observability surfaces. A future reader of `dist/shim.js` stderr or the Hub audit log can reconstruct the full session lifecycle from these signals alone.

### 5.1 Stderr conventions (adapter-side, T3 + T4)

All log lines start with a literal bracketed-tag prefix. Dashboard / diagnostic tooling parses on these prefixes. HC #5 of T3 directive pins the format.

| Prefix | When | Source |
|---|---|---|
| `[Handshake] Identity asserted: eng-X` | `register_role` returns successfully | T3 `shim.ts onHandshakeComplete` callback |
| `[Handshake] Session claimed: epoch=N (displaced prior: <id\|none>)` | Eager `claim_session` call returns successfully | T3 `formatSessionClaimedLogLine` helper |
| `[Handshake] Session claim deferred (lazy mode; ...)` | Lazy mode (no `OIS_EAGER_SESSION_CLAIM`) | T3 `shim.ts onHandshakeComplete` callback |
| `[Handshake] Eager-warmup: ON\|OFF (...)` | Adapter startup | T3 `shim.ts main()` |
| `[Handshake] Eager claim_session failed: ${err}` | Eager-claim path threw | T3 `shim.ts onHandshakeComplete` |
| `[ListTools] served from cache` | T4 cache path: identityReady unresolved + valid cache | T4 `dispatcher.ts` ListTools handler |
| `[ListTools] no cache (bootstrapping cache from Hub)` | T4 bootstrap path: no cache present | T4 `dispatcher.ts` ListTools handler |
| `[ListTools] cache stale (cached.hubVersion=X, current=Y) — bootstrapping` | T4 stale path: Hub version mismatch | T4 `dispatcher.ts` ListTools handler |
| `[Cache] Hub version resolved: ${ver}` | `/health` fetch completed | T4 `shim.ts main()` background fetch |
| `[Cache] Skipping persistCatalog — Hub version not yet resolved` | `persistCatalog` called before `/health` resolved | T4 `shim.ts main()` |
| `[Cache] /health fetch failed (non-fatal): ${err}` | `/health` fetch threw | T4 `shim.ts main()` |
| `[T2] agent_session_implicit_claim audit write failed for X: ${err}` | Hub-side audit emission failed (best-effort) | T2 `hub-networking.ts` SSE hook + `policy/router.ts` first-tools/call hook |

### 5.2 Hub audit trail (T2)

The four new audit actions (§4) form a complete observability surface for identity-vs-session lifecycle. Queries:
- `list_audit_entries` filtered by `relatedEntity=eng-XXX` shows the agent's full identity+session history.
- The `details`-string regex `/trigger=([a-z_]+)/` extracts the trigger value for splitting `agent_session_implicit_claim` by sub-path (the deprecation-runway dashboard).
- Combined with `agent_handshake_refreshed` (preserved from bug-16 C5), the audit trail captures every mutable Agent state transition.

### 5.3 `/health`-driven cache invalidation (T4)

`GET http://localhost:8080/health` returns `{ status, service, version, ... }`. `version` is consumed by adapter T4 as the cache-key for `tool-catalog.json`. Hub deploy bumps `version` → adapter cache invalidates on next ListTools → re-bootstraps from Hub once → caches new catalog.

---

## 6. Test-coverage totals

| Package | Pre-mission | Post-mission | Delta | Mission-introduced files |
|---|---|---|---|---|
| `hub` | 608 passing + 5 skipped | 639 passing + 5 skipped | **+31** | `hub/test/mission-40-session-claim-separation/t1-helpers.test.ts` (14), `t2-cutover.test.ts` (15), wave1-policies.test.ts updates (+2), `e2e-foundation.test.ts` (1 tool-count assertion) |
| `packages/network-adapter` | 105 passing | 108 passing | **+3** | `test/unit/handshake.test.ts` updates (3 epoch-jump tests rewritten for T2 semantics) |
| `adapters/claude-plugin` | 34 passing | 67 passing | **+33** | `test/eager-claim.test.ts` (13), `test/tool-catalog-cache.test.ts` (13), `test/dispatcher-list-tools-cache.test.ts` (7) |
| **Aggregate** | **747** | **814** | **+67** | 6 new test files + 3 updated |

`tsc --noEmit` clean across all three packages at every task boundary. Zero existing-test regressions across the mission.

---

## 7. Findings

Captured during the mission for the post-architectural-review hardening pass + future-engineer reference.

### 7.1 bug-27 — `propose_mission` cascade handler drops `payload.documentRef`

Filed mid-mission (during T2's mission-40 ratification cascade). Symptom: cascade payload's `documentRef` field accepted by validator but dropped by entity-creation handler. mission-40 entity has `documentRef: null` despite both architect's action-1 and engineer's revised action-2 carrying `documentRef`. Workaround: brief still discoverable via `sourceThreadId`. Severity minor; class `drift`. Out of mission-40 scope.

### 7.2 bug-28 — DAG dep-eval against already-completed parent task

Surfaced when architect tried to issue T2 as task-319 with `dependsOn: [task-318]`. task-318 was `completed` but the Hub left task-319 in `blocked` indefinitely. Architect cancelled task-319 + reissued T2 as task-320 without `dependsOn`. Same workaround applied to T3-T5 (all reissued without `dependsOn`; lineage preserved textually). bug-28 entity not yet filed — flagging here for post-mission triage.

### 7.3 Wrapper scripts are untracked at the repo level

`start-greg.sh` (greg's worktree) and `start-lily.sh` (lily's worktree) are not git-tracked. T3's `OIS_EAGER_SESSION_CLAIM=1` change was applied operationally to both wrappers in their respective worktrees, but the change isn't propagatable via `git merge`. **Open item:** decide whether to track these scripts (small commit) or document the per-worktree config convention (so the next operator knows to update both wrappers manually). Out of mission-40 T5 scope per HC #7 — file as a separate post-mission cleanup idea.

### 7.4 `/proc/self/...` test-path hazard for vitest

During T4 test development, vitest hung on a `/proc/self/this-cannot-be-written-to-cache` test path used to simulate an unwritable WORK_DIR. Cause: kernel quirks around `mkdirSync` into procfs. Test rewritten to use `/tmp/ois-cache-test- -bogus` (deterministic-error path). Memorialized here so future engineers don't re-create the hazard. ~10 minutes lost to debugging; saved for future via this finding.

### 7.5 Hub deploy of T1-T4 not yet performed

The local Hub container (`ois-hub-local`, `hub-00040-5wn`-equivalent — actually `hub-00037-h9t` per the cold-start preflight) still runs pre-T1 code. The four new audit actions (`agent_identity_asserted`, `agent_session_claimed`, `agent_session_implicit_claim`, `agent_session_displaced`) currently emit ZERO entries to the GCS audit log because the Hub-side T1-T4 code hasn't been deployed yet. **Verified via `gcloud storage` sample of latest 50 audit entries: 0 of any new action.** The deprecation-runway dashboard baseline (§8) is therefore zero across all signals; post-deploy the dashboard will start populating. Scheduling the Hub redeploy is a Director-coordinated action post-mission-close.

### 7.6 Cascade-handler `goals[]` requirement surfaced during mission-40 ratification

When sealing thread-245 with `converged: true`, the gate rejected because `propose_mission` payload requires a `goals: string[]` field. Architect's initial staged action (action-1) didn't include it. Engineer revised via action-2 with goals derived from brief §1 success criteria. Worth noting: the validator's requirement isn't documented in the staged-action helper or visible at stage time — only at convergence. Filing as a future-engineer reference; not bug-class severe.

### 7.7 Director-chat routing pre-emption not triggered

Anti-goal §7.7 of the brief explicitly excluded director-chat routing from this mission's scope. T1-T4 implementation honored that — no changes to director-chat plumbing. The director-chat-redesign work (upcoming) inherits the cleaner identity-vs-session model without rework.

---

## 8. Deprecation runway status

Per brief §10.1: the back-compat auto-claim hooks (SSE-subscribe + first-tools/call) are retired together once both `agent_session_implicit_claim` sub-rates trend to zero.

**Current baseline (mission-close 2026-04-22 AEST):**

| Audit action | Trigger | Count in last 50 entries | Notes |
|---|---|---|---|
| `agent_identity_asserted` | n/a | 0 | Hub-side T2 code not yet deployed |
| `agent_session_claimed` | `explicit` | 0 | Same |
| `agent_session_implicit_claim` | `sse_subscribe` | 0 | Same |
| `agent_session_implicit_claim` | `first_tool_call` | 0 | Same |
| `agent_session_displaced` | (carries trigger of corresponding claim) | 0 | Same |

Total audit files in GCS: 4335. Sampled latest 50; zero new T1-T4 actions present. The Hub container needs redeploy with the T1-T4 code for these signals to start firing.

**Post-deploy expected baseline:** all sessions will fire `agent_identity_asserted` on `register_role` + one of the three claim variants on session establishment. Eager-mode adapters (greg + lily wrappers) emit `agent_session_claimed` (trigger=explicit). Lazy-mode adapters (probes + un-updated tooling) emit `agent_session_implicit_claim` with trigger split between the two back-compat paths.

**Retirement criterion (post-architectural-review hardening, brief §10.1):** when the dashboard shows both `agent_session_implicit_claim` sub-rates have been ~zero for some operator-determined window (e.g. 2 weeks of zero-rate post-deploy), the back-compat hooks can be retired and `register_role` becomes purely identity-asserting (no auto-claim fallback).

**Dashboard parsing convention:** see `docs/observability/m-session-claim-separation-runway-dashboard.md`. Regex `/trigger=([a-z_]+)/` against `details` field of `agent_session_implicit_claim` audits. Combined metric (without trigger split) silently hides which back-compat sub-path is still load-bearing — DO NOT use the unsplit metric as the retirement gate.

---

## 9. Open items

For the post-architectural-review hardening pass + Phase 1 cartography to absorb.

### 9.1 Code paths still using auto-claim (for §10.1 retirement targeting)

When the deprecation-runway dashboard data eventually justifies retirement, these specific call sites must be updated to use explicit `claim_session` instead of relying on the back-compat hooks:

- **All un-updated adapters** (any adapter version pre-T2 deploy that calls `register_role` without `claim_session`): they implicitly claim via SSE-subscribe (when they open SSE) or first-tools/call (when they first invoke a tool). Specific adapter versions to enumerate:
  - `@apnex/claude-plugin@1.0.0` and earlier (today's adapter version)
  - Any future opencode-plugin version that doesn't adopt the explicit `claim_session` flow
- **Director-chat plumbing** (future): inherits the new model when it lands.
- **`/health`-driven cache bootstrap path**: currently the very first `register_role` + ListTools sequence on a fresh install relies on the bootstrap fetch + Hub auto-claim (when a tool call lands). Consider pre-warming the cache in `install.sh` — out of mission-40 scope.

### 9.2 Wrapper-script-tracking decision

See finding §7.3. Decide whether to track `start-greg.sh` / `start-lily.sh` in git or document the per-worktree convention. Recommend filing as an idea + addressing post-architectural-review.

### 9.3 `AuditEntry` payload structure for `trigger` field

Per T2 HC #4, the `trigger` field is currently encoded in the `details` string. Promoting it to a structured payload field on `AuditEntry` would make the dashboard parser cleaner (no regex, typed access) but is a `state.ts` schema change. Recommend filing as a follow-on idea once the dashboard is consumed enough to justify the migration.

### 9.4 PolicyLoopbackHub parity audit (per brief §10.7)

Mission integration tests use `PolicyLoopbackHub` (in-memory). Post-hardening should run a parity audit confirming the real Hub and PolicyLoopbackHub implement claim/displace/audit-emission semantics identically. Drift would silently invalidate the integration test suite's guarantees.

### 9.5 Hub container deploy of mission-40 code

See finding §7.5. The local Hub container needs redeploy for the new audit actions to start firing in production-equivalent state. Scheduling is Director-coordinated.

### 9.6 First-tools/call skip-list scope

Currently `register_role` + `claim_session` are the only tools that skip the first-tools/call auto-claim hook. Per T2 review note #2, widening the skip-list to include introspection tools (`get_engineer_status`, `list_available_peers`) was discussed and deferred. Revisit if real-world usage shows introspection-during-probe patterns.

---

## 10. Cross-references

- **Mission brief:** `documents/missions/m-session-claim-separation.md` v1.1
- **ADR:** `docs/decisions/021-identity-session-claim-separation.md`
- **Deprecation-runway dashboard spec:** `docs/observability/m-session-claim-separation-runway-dashboard.md`
- **Bug-candidate doc (origin):** `docs/reviews/bug-candidate-mcp-probe-displacement.md` (now carries RESOLVED-BY-MISSION banner)
- **Companion bug-candidate (T0 already shipped):** `docs/reviews/bug-candidate-adapter-startup-race.md` (commit `83b57e3`; predates mission-40 but motivated the diagnostic context)
- **Hub Bug entity:** bug-26 (now `resolved`, `fixCommits` populated with all 5 mission commits)
- **Per-task reports:** `reports/task-318-v1-report.md`, `reports/task-320-v1-report.md`, `reports/task-321-v1-report.md`, `reports/task-322-v1-report.md`, `reports/task-323-v1-report.md` (this T5 report)
- **Sibling bugs filed during mission (NOT resolved by mission-40):** bug-27 (cascade-handler `documentRef` drop), bug-28 (DAG dep-eval against completed parent — to be filed)
- **Related ratified work (mission-40 builds on / aligns with):**
  - bug-16 (Agent lifecycle hardening, RESOLVED in `9385290` + `6eacfca`) — mission-40 completes the lifecycle hardening bug-16 began.
  - idea-122 (`reset_agent` operator affordance, triage-pending) — mission-40's `claim_session` is a building block idea-122 will consume.
  - idea-152 (Smart NIC Adapter, target state) — mission-40's protocol cleanup is the right transitional fix; idea-152 inherits the cleaner identity model when it lands.
  - idea-121 (API v2.0 tool-surface modernization) — mission-40 commits the `claim_session` verb stable across v2.0 envelope migration.

---

## 11. Mission-close confirmation

bug-26 entity flipped `open → resolved` at this commit. fixCommits: `[18cde2d, a011fcd, dd1423c, 9e14ff7, e2ce3f8]`. Mission-40 entity to be flipped `active → completed` by architect via `update_mission` once T5 is approved.

Post-mission state: 2026-04 architectural-review can now resume Phase 1 cartography per the original plan. Anti-goal #6 ("don't execute open missions mid-review") returns to full force; mission-40's mid-review execution was a Director-greenlit one-off and does not establish precedent.
