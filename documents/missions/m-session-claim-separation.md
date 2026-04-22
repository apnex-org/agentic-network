# Mission: M-Session-Claim-Separation

> **Live state will be tracked in `docs/traces/m-session-claim-separation-work-trace.md`** once the mission is ratified — this brief documents scope, sequencing rationale, and the design decisions absorbed during review-thread convergence.

**Status:** v1.1 (2026-04-22, post-architect-review revisions absorbed; pending architect ratification on thread-245 round 4).
**Hub mission id:** PENDING (assigned via `create_mission` after architect ratification)
**Proposed:** 2026-04-22 (mid-architectural-review, Director-greenlit fix-now scope)
**Proposed by:** Engineer (greg) — diagnostic discovery by Architect (lily) on 2026-04-22 cold-start session
**Revision history:**
- **v1.0** (2026-04-22 round 1) — initial draft on thread-245.
- **v1.1** (2026-04-22 round 3) — absorbs lily's six revisions from thread-245 round 2: (i) T1+T2 restructured per Option (b) so each is independently deployable + reviewable, (ii) single `claimSession()` registry helper with `trigger` field on audit emissions, (iii) tele-1 added for defensive-observability, (iv) anti-goals expand with director-chat / reaper / MCP-auth-trust pins, (v) T1 references bug-16 C5 label-refresh contract + T3 keys on `sessionClaimed` field not epoch delta, (vi) idea-121 cross-ref pins `claim_session` verb stability across v2.0 envelope migration. §10 also gains 3 items.
**Owner:** Engineer (implementation); Architect (directive issuance + per-task review)
**Governance:** Director ratified mid-review execution; Architect issues per-task directives; Engineer implements + reports.
**Peer of:** none directly; companion to the already-shipped startup-race fix (commit `83b57e3`). Together those two fixes close the adapter-startup defect class lily surfaced this morning.
**Background docs:**
- `docs/reviews/bug-candidate-mcp-probe-displacement.md` — original symptom + three-path analysis
- `docs/reviews/bug-candidate-adapter-startup-race.md` — companion (already shipped)

---

## 1. Goal

Eliminate **probe-induced session displacement** by separating identity claim from session claim at the Hub protocol layer. After this mission, the bug is structurally impossible — not merely undetected. Probes (e.g. `claude mcp list`) become observably idempotent on Hub session state.

**Success criteria:**

1. `claude mcp list` (or any other transient adapter spawn) leaves `sessionEpoch` and `currentSessionId` of the live agent **unchanged**. Verifiable via Hub log (no `Agent displaced` entry triggered by the probe) and via integration test pinning the contract.
2. A real session restart still correctly displaces the prior session (the takeover semantics that protect SSE delivery integrity remain intact for legitimate session reclaims).
3. The Hub protocol surface explicitly distinguishes identity assertion from session claim — `register_role` is idempotent; `claim_session` is the displacing op. Auditable and testable as separate concerns.
4. Existing adapters that never update keep working unchanged — Hub auto-claims session on SSE-subscribe with explicit `agent_session_implicit_claim` audit emission so the implicit-path is observable + deprecation-trackable.
5. Tele-3 ("Sovereign Composition" — Logic Leakage fault) is closed at the Hub-side identity contract: two distinct concerns no longer share one tool call.

---

## 2. Scope

### In scope

- **Hub protocol split**: `register_role` → idempotent identity assertion (no displacement). New `claim_session` MCP tool → displacing session claim with audit emission.
- **Hub-side SSE-subscribe gate**: SSE stream open requires prior `claim_session`. Auto-claim path (backward-compat for un-updated adapters) emits `agent_session_implicit_claim` audit.
- **Adapter-side lazy-claim refactor**: `register_role` may run early (cheap, no displacement); `claim_session` triggered only by first SSE-subscribe / first tool call / explicit eager-warmup env hint.
- **Tool-catalog cache**: probe-safe `ListTools` serves a locally cached tool catalog (`$WORK_DIR/.ois/tool-catalog.json`) when no Hub session yet; one-time bootstrap fetches if no cache exists; cache invalidated on Hub version change.
- **Eager-warmup env hint**: `OIS_EAGER_SESSION_CLAIM=1` set by `start-greg.sh` / `start-lily.sh` triggers Phase B (claim_session) in parallel with stdio open. Probes don't set this; they stay lazy.
- **Migration audit + observability**: dashboard counters for `agent_session_claimed` (explicit) vs `agent_session_implicit_claim` (auto-claim path) so the deprecation runway can be tracked.
- **Tests**: unit-level pinning of idempotency vs displacement contracts; integration tests pinning the four shapes (probe-only, real session, mixed concurrent, implicit-claim back-compat); E2E updates to `dispatcher.test.ts` for the lazy-claim flow.

### Out of scope

- **Probe-detection heuristics** (process-tree introspection, MCP clientInfo signature matching, idle-timeout). Rejected: fights the protocol instead of fixing it. The whole point of this mission is to make detection unnecessary.
- **Same-fingerprint N-coexistence** (Path 3 of the bug-candidate doc). Different problem; rejected as wrong scope.
- **Smart NIC / Cognitive Implant Layer** (idea-152). Target-state replacement of MCP/Hub plumbing. This mission is the right transitional fix; Smart NIC inherits the cleaner identity model when it lands.
- **Removing the auto-claim back-compat path.** Deferred to post-architectural-review hardening — see §10.
- **`reset_agent` operator affordance** (idea-122). Distinct concern (deliberate operator-side identity reset). This mission's `claim_session` is a building block that idea-122 will consume but is not delivered here.

---

## 3. Tasks + sequencing

Five tasks, linear with one parallel branch. Each task ships independently and is architect-reviewed before the next is issued.

### Task 1 — Hub: introduce identity + session helpers (PURELY ADDITIVE; behavior unchanged)

**Restructure rationale (v1.1, lily's review point #1).** T1 was originally "make `register_role` non-displacing" — but that left a regression window between T1 ship and T2 ship where legitimate session reclaim was broken (no path increments `sessionEpoch` or evicts prior SSE). T1 is now refactored to be **purely additive**: helpers + audit actions land internally; `register_role` STILL invokes both helpers under the hood, so externally-observable behavior is identical to today. T2 then performs the protocol cutover. Each task is independently deployable AND independently reviewable against a known-good baseline.

**Scope.**
- New `IEngineerRegistry.assertIdentity(fp, role, labels) → engineerId` method on Memory + GCS implementations. Idempotent: ensures Agent record exists with the given fingerprint; updates mutable fields per the **bug-16 C5 label-refresh contract** (handshake label refresh on reconnect; lily's review point #5); updates `lastSeenAt`. Never increments `sessionEpoch`. Never touches `currentSessionId`. Never evicts SSE. **Does not redefine bug-16 C5's label-refresh semantics** — invokes the same code path.
- New `IEngineerRegistry.claimSession(engineerId, sessionId, trigger: "explicit" | "sse_subscribe" | "first_tool_call") → { sessionEpoch, displacedPriorSession?: { sessionId, epoch } }` method (Memory + GCS). **Single helper** routing all three claim paths (lily's review point #2). Increments `sessionEpoch`, sets `currentSessionId = thisSession`, evicts prior SSE stream if any.
- Three new audit actions registered (not yet emitted from any non-T1 path):
  - `agent_identity_asserted` — emitted on every `assertIdentity` call.
  - `agent_session_claimed` — emitted on `claimSession(..., "explicit")`.
  - `agent_session_implicit_claim` — emitted on `claimSession(..., "sse_subscribe" | "first_tool_call")`. **Carries `trigger` field** in audit payload distinguishing the two back-compat sub-paths (lily's review point #2 — required for §10's deprecation-runway dashboard to identify which path is still load-bearing).
  - `agent_session_displaced` — emitted (alongside `agent_session_claimed`) when a prior session was evicted.
- `register_role` policy handler refactored INTERNALLY to invoke `assertIdentity` then `claimSession(..., "sse_subscribe")` under the hood. Externally: zero behavior change. Response shape unchanged. Audit emissions are now the new actions (replacing the implicit pre-T1 displacement audit).
- Reaper (`HUB_AGENT_STALE_THRESHOLD_MS`) is **untouched**. The reaper continues to read `lastSeenAt` per its existing heuristics; T1 must not shift reaper thresholds based on the new `agent_identity_asserted` event stream (lily's review point #4).

**Success criteria.**
- 100% of existing `register_role` callers continue to work without modification (response shape + behavior identical).
- New helpers callable internally from policy code; covered by unit tests pinning idempotency of `assertIdentity` and displacement of `claimSession`.
- New audit actions emit with the `trigger` field correctly populated on each claim path.
- Existing integration tests (Mission-19 routing, bug-16 lifecycle, Threads 2.0 dispatch) continue to pass — proves T1 changed implementation without changing behavior.

**Files.** `hub/src/state.ts`, `hub/src/gcs-state.ts`, `hub/src/policy/session-policy.ts`, `hub/src/audit/*` (new action constants), tests under `hub/test/`.

**Effort.** 1.5 engineer-days.

### Task 2 — Hub: protocol cutover — `register_role` becomes idempotent + new `claim_session` tool exposed

**Scope.**
- `register_role` policy handler stops calling `claimSession` internally — becomes pure idempotent identity assertion. Response shape gains `sessionClaimed: false` field (constant in this state; lily's review point #5 — adapters must key on this field, NOT epoch delta).
- `currentSessionEpoch` field semantics in `register_role` response change: it now reflects the current value as-observed, NOT a just-incremented value. **Downstream callers using epoch-delta as a "I just took over" proxy will silently misread.** This is called out in T3 scope (lily's review point #5).
- New MCP tool `claim_session` exposed on the policy router. Takes no args (uses authenticated MCP session ID from transport context — lily's review point #4 acknowledges this is a load-bearing trust assumption on MCP session-auth integrity). Calls `claimSession(engineerId, sessionId, "explicit")` from T1.
- SSE stream open handler in `hub/src/index.ts`: if no prior `claim_session` for the connection, auto-claim via `claimSession(..., "sse_subscribe")` — preserving back-compat for un-updated adapters.
- First-`tools/call` auto-claim hook (lily's review point #2 — second back-compat path): if no prior `claim_session` AND incoming MCP `tools/call` arrives, auto-claim via `claimSession(..., "first_tool_call")`. Same single helper, just a different `trigger` value.
- Hub gate verifies the agent has a session-claim before dispatching SSE notifications to a connection. Without one, the connection cannot receive pushes — only pull-via-tools/call.

**Success criteria.**
- Explicit `claim_session` call increments `sessionEpoch` and emits `agent_session_claimed` + (when displacing) `agent_session_displaced` audits.
- SSE-subscribe auto-claim emits `agent_session_implicit_claim` with `trigger: "sse_subscribe"`.
- First-tools/call auto-claim emits `agent_session_implicit_claim` with `trigger: "first_tool_call"`.
- Probe path (Initialize + ListTools + exit, no SSE subscribe, no `tools/call`, no `claim_session`) emits zero session-claim audits and leaves `sessionEpoch` unchanged.
- Two adapters with same fingerprint can both have asserted identity (`register_role` × 2) without displacing each other; the moment one calls `claim_session`, the other is displaced cleanly.
- New `register_role` response carries `sessionClaimed: false`; downstream code does not error on the new field.

**Files.** `hub/src/policy/policy-router.ts` (new tool registration + first-tools/call hook), `hub/src/policy/session-policy.ts` (handler refactor), `hub/src/index.ts` (SSE-subscribe hook), tests under `hub/test/`.

**Effort.** 1.5 engineer-days.

### Task 3 — Adapter: lazy-claim refactor + eager-warmup env hint

**Scope.**
- `adapters/claude-plugin/src/shim.ts` `main()` refactored: `register_role` runs immediately (in parallel with stdio open, building on commits `83b57e3` + `3bf3bdd`'s ordering + ListTools-gating work). `claim_session` deferred until first SSE subscribe / first `tools/call` / explicit eager-warmup.
- `OIS_EAGER_SESSION_CLAIM` env var: when set, triggers `claim_session` in parallel with `register_role`. Wrapper scripts (`start-greg.sh`, `start-lily.sh`) updated to set this. Probes don't set it; they stay lazy.
- `agentReady` + `handshakeComplete` deferreds (from commits `83b57e3` + `3bf3bdd`) generalized into the new model: `identityReady` (resolves on `register_role` complete — same as today's `handshakeComplete`), `sessionReady` (resolves on `claim_session` complete; safe to receive SSE notifications), `syncReady` (resolves on full agent.start() return — same as today's `agentReady`). Initialize handler ungated. ListTools gated on `identityReady` (preserves the 3bf3bdd fix). CallTool gated on `sessionReady` (semantically more correct than `syncReady` — call requires session, not full sync, but pragmatic equivalence today since they're contiguous).
- **Detection logic must NOT key on `currentSessionEpoch` delta.** Per lily's review point #5: T2 changes `register_role` response so `currentSessionEpoch` no longer indicates "I just took over". Adapter MUST read the new `sessionClaimed: boolean` field from `claim_session` response to know whether displacement occurred. Any code using epoch-delta as a takeover indicator is silently broken.
- Adapter logs the new path explicitly: `[Handshake] Identity asserted: eng-X` (Phase A), `[Handshake] Session claimed: epoch=N (displaced prior: ...)` (Phase B, when it happens).

**Success criteria.**
- `claude mcp list` (probe path) running while a real session is active produces zero `agent_session_claimed` audits and zero SSE-stream evictions.
- `./start-greg.sh` from a fresh terminal claims session within ~1 second of process start (parallel with stdio).
- The eager-warmup path is observable via stderr log lines.
- Existing dispatcher e2e tests still green (cached-catalog fallback exercises the legacy no-`agentReady` path; new tests exercise the new identity-vs-session split).

**Files.** `adapters/claude-plugin/src/shim.ts`, `adapters/claude-plugin/src/dispatcher.ts`, `start-greg.sh`, `start-lily.sh`, dispatcher tests.

**Effort.** 1.0 engineer-days.

### Task 4 — Adapter: tool-catalog cache (probe-safe ListTools)

**Scope.**
- New cache file `$WORK_DIR/.ois/tool-catalog.json` storing `{ catalog, hubVersion, fetchedAt }`.
- Cache writer: on first successful `claim_session` per process, fetch fresh catalog from Hub and persist.
- Cache reader: ListTools handler serves cached catalog when `sessionReady` is unresolved; transparently switches to live catalog after first session claim.
- Cache invalidation: on Hub version mismatch (Hub exposes version via `/health` or via `register_role` response), the cache is wiped and re-fetched.
- Bootstrap path: if no cache exists on first invocation (e.g. fresh install), fall back to fetching from Hub one-time before exiting (probe still completes successfully; just slower the first time).

**Success criteria.**
- Probe-only adapter spawn against a populated cache returns ListTools result in <50ms (no Hub call).
- Cache stale-detection works: bumping the Hub version causes the next adapter spawn to refetch + persist the new catalog.
- Cache-miss bootstrap completes within Hub-handshake budget (~600-1200ms one-time cost).

**Files.** `adapters/claude-plugin/src/dispatcher.ts` (ListTools handler), new helper `adapters/claude-plugin/src/tool-catalog-cache.ts`, tests.

**Effort.** 0.5 engineer-days.

### Task 5 — Backward-compat closing audit + observability

**Scope.**
- Closing audit document `docs/audits/m-session-claim-separation-closing-report.md` mirroring CP3 / mission-38 shape: deliverable scorecard, per-task architecture recap, audit-action inventory, observability surface, findings, test-coverage totals.
- Hub metrics dashboard panel: time-series of `agent_session_claimed` (explicit) vs `agent_session_implicit_claim` (auto-claim back-compat). Tracks the deprecation runway: when `agent_session_implicit_claim` rate trends to zero, the back-compat path can be removed safely (post-architectural-review hardening per §10).
- Filed as part of the closing audit: explicit list of code paths still using auto-claim (so the post-review hardening task can target each one).
- Bug-candidate doc updated with `RESOLVED-BY-MISSION:m-session-claim-separation` reference; Hub Bug entity flipped `open → resolved` with `fixCommits` referencing the mission's commit range.

**Files.** `docs/audits/m-session-claim-separation-closing-report.md`, audit/dashboard config, `docs/reviews/bug-candidate-mcp-probe-displacement.md`.

**Effort.** 0.5 engineer-days.

### Sequencing graph

```
T1 (register_role idempotent)
  └─→ T2 (claim_session tool + SSE-gate)  [T2 depends on T1's idempotent baseline]
        ├─→ T3 (adapter lazy-claim + eager-warmup hint)  [needs T2's tool surface]
        │     └─→ T5 (closing audit + observability)
        └─→ T4 (tool-catalog cache)  [parallel with T3 — independent scope]
              └─→ T5 (closing audit + observability)
```

T1 + T2 are Hub-side and must land before any adapter work (T3, T4). T3 + T4 may run in parallel as their files don't overlap. T5 is the final closing-audit + observability sweep.

---

## 4. Design decisions (to be ratified on review thread)

The following are the engineer's proposed defaults for architect critique. Each may be adjusted on review-thread convergence.

1. **`claim_session` takes no args** — uses the authenticated MCP session ID from transport context. No client-supplied session ID. Rationale: prevents cross-session takeover via spoofed args; the session ID is already the trust boundary.

2. **Auto-claim on SSE-subscribe is the back-compat path** — preserved for un-updated adapters; emits explicit audit so the path is observable. Rationale: zero-breaking-change Hub deploy; existing adapters keep working; dashboard tracks the deprecation runway.

3. **Eager-warmup env hint** is operator-set, not adapter-detected. Wrappers (`start-greg.sh`, `start-lily.sh`) declare "this is a real session" by setting `OIS_EAGER_SESSION_CLAIM=1`. Probes inherit env from their parent shell but don't set this var explicitly, so they default to lazy. Rationale: declarative > heuristic; the hint moves intent expression from negative ("I'm not a probe") to positive ("I'm claiming this session").

4. **Tool-catalog cache is per-WORK_DIR**, not per-fingerprint and not in `~/.ois/`. Rationale: WORK_DIR is the per-agent state dir already; per-fingerprint would create cross-contamination; per-home would be operator-confusing.

5. **Cache invalidation on Hub-version-change only.** No TTL. Rationale: tool catalog is essentially static between Hub deploys; TTL would add noise without value.

6. **First `tools/call` triggers session claim** (not just SSE-subscribe). Rationale: a non-probe interactive Claude Code session may make tool calls before subscribing to notifications; we want session-claim to trigger early enough that the first tool call's result delivery is reliable. Configurable via env if operators disagree.

7. **`agent_identity_asserted` audit action** replaces the implicit displacement-on-handshake pattern. Every `register_role` call emits this audit. Rationale: makes the identity-assertion path observable independently of the session-claim path.

---

## 5. Test strategy

- **Unit tests (Hub):**
  - `assertIdentity` is idempotent across N calls — record state stable, no `sessionEpoch` mutation.
  - `claimSession` increments `sessionEpoch` exactly once per call.
  - `claimSession` displacing a prior session emits `agent_session_displaced` audit with the displaced session's ID + epoch.
  - SSE-subscribe auto-claim emits `agent_session_implicit_claim`.
- **Unit tests (adapter):**
  - Lazy-claim path: `register_role` runs at startup; `claim_session` does not run until first tool call / SSE subscribe.
  - Eager-warmup path: `OIS_EAGER_SESSION_CLAIM=1` triggers `claim_session` in parallel with `register_role`.
  - Tool-catalog cache: probe path serves from cache; cache miss bootstraps from Hub one-time.
- **Integration tests (Hub + adapter via PolicyLoopbackHub):**
  - **Probe path:** start agent A's real session → spawn agent A's probe (Initialize + ListTools + exit) → assert agent A's `sessionEpoch` unchanged + SSE stream intact.
  - **Real-session path:** start agent A → start agent A in a second adapter → assert second adapter displaces first cleanly + audits emitted.
  - **Mixed concurrent:** 3 probes + 1 real session for same fingerprint, assorted timing → assert only the real session ever causes displacement; probes leave state untouched.
  - **Implicit-claim back-compat:** un-updated adapter calls only `register_role` then opens SSE → assert auto-claim fires + `agent_session_implicit_claim` audit emitted + adapter functions normally.
- **E2E tests (`dispatcher.test.ts`):**
  - Update existing tests for new `identityReady` + `sessionReady` deferred shape.
  - Add: ListTools served from cache when `sessionReady` unresolved.
  - Add: First `tools/call` triggers `claim_session` then dispatches.

Total expected new tests: ~25 across unit + integration + E2E. Existing 31 dispatcher tests must remain green.

---

## 6. Bug / idea / ADR linkage

- **Resolves:** **bug-26** (filed 2026-04-22; severity=major, class=identity-management; bug-candidate doc at `docs/reviews/bug-candidate-mcp-probe-displacement.md` is the long-form symptom + analysis).
- **Companion to:** commit `83b57e3` (the startup-race fix shipped earlier today). Together those two changes close the adapter-startup defect class lily surfaced this morning.
- **Cross-references:**
  - **bug-16** (RESOLVED in `9385290` + `6eacfca`) — covered the labels-refresh-on-reconnect and Agent reaper. This mission completes the Agent lifecycle hardening that bug-16 began (reaper + label refresh + now session-claim separation).
  - **idea-122** (`reset_agent` operator affordance — triage-pending) — distinct concern (deliberate operator-side identity reset), but `claim_session` is a building block idea-122 will consume when it lands.
  - **idea-152** (Smart NIC Adapter — target state) — would absorb identity-and-transport entirely; this mission is the correct transitional fix and idea-152 inherits the cleaner identity model.
  - **idea-121** (API v2.0 tool-surface modernization) — orthogonal concern; this mission's protocol additions are ASCII-clean enough to retrofit into the v2.0 envelope when idea-121 lands. No sequencing dependency in either direction. **Verb stability commitment** *(added v1.1 per lily's review point #6)*: the verb `claim_session` is committed as stable across any future API v2.0 envelope migration. Idea-121 may wrap the envelope shape but must not rename the verb. This guarantees adapters introduced by this mission survive the v2.0 retrofit unchanged.
- **ADR**: a brief ADR documenting the identity-vs-session-claim separation decision would be appropriate; recommend `docs/decisions/ADR-021-identity-session-claim-separation.md` authored as part of T1 or T5.
- **Tele alignment:**
  - **tele-3 Sovereign Composition** — separates two concerns that should never have been one. Closes Logic Leakage fault at the contract layer.
  - **tele-7 Resilient Agentic Operations** — eliminates probe-induced cascade-bombs (silent SSE eviction during operator probes).
  - **tele-5 Perceptual Parity** — operator visibility (probes) is no longer destructive. Looking at the system stops breaking the system.
  - **tele-2 Isomorphic Specification** — protocol surface matches semantic distinction; no implicit conflation of identity and session.
  - **tele-1 Sovereign State Transparency** *(added v1.1 per lily's review point #3, defensive-observability dimension)* — the three new audit actions + explicit-vs-implicit-claim dashboard make a previously-hidden state (which protocol path triggered displacement) into perceivable state. Before this mission, displacement events were logged but the *cause* (conflation of identity and session under one tool call) was opaque — Hidden State fault. After: every claim path emits a typed audit with a `trigger` field; the deprecation-runway dashboard renders this state explicitly. The mission closes a structural observability gap, not just a functional bug.

---

## 7. Anti-goals (this mission deliberately does NOT do)

1. **Probe-detection heuristics.** Rejected — fights protocol instead of fixing it.
2. **Same-fingerprint N-concurrent sessions.** Different problem; would break INV-AG3 spirit.
3. **Smart NIC / Cognitive Implant Layer implementation.** Mission-distance away (idea-152); this mission is the transitional fix.
4. **Removing the auto-claim-on-SSE-subscribe back-compat path.** Deferred to post-architectural-review hardening per §10.
5. **`reset_agent` operator tool.** Distinct concern (idea-122); building blocks delivered here.
6. **API v2.0 envelope migration** (idea-121). Orthogonal; this mission's protocol additions are forward-compatible with v2.0.
7. **Director-chat routing changes.** *(Added v1.1 per lily's review point #4.)* The director-chat-redesign is upcoming work; this mission's session-claim changes do not pre-empt its routing decisions. If director-chat needs a different identity-vs-session model, this mission's surface composes — but the mission does not assume any specific director-chat shape.
8. **Modifying Agent reaper / `lastSeenAt` semantics.** *(Added v1.1 per lily's review point #4.)* T1's `assertIdentity` updates `lastSeenAt` per the bug-16 C5 contract. The reaper (`HUB_AGENT_STALE_THRESHOLD_MS`) continues to use its existing liveness heuristics on `lastSeenAt` unchanged. Reaper thresholds must NOT be re-tuned based on the new `agent_identity_asserted` event stream.
9. **Re-opening the MCP-session-authentication trust assumption.** *(Added v1.1 per lily's review point #4.)* Decision §4.1 (claim_session takes no args, uses authenticated MCP session ID) assumes MCP session auth is not weakened. **If MCP session auth is ever modified**, this mission's `claim_session` design becomes a takeover vector and must be re-opened. State this dependency as an explicit assumption now so the future change-trigger is captured.

---

## 8. Effort + risk

- **Effort estimate:** M-class (~4-5 engineer-days end-to-end). Breakdown: T1=1.5, T2=1.5, T3=1.0, T4=0.5, T5=0.5.
- **Risk:** medium. Touches identity-management which is load-bearing for Mission-19 routing + Threads 2.0 dispatch.
- **Mitigations:**
  - Backward-compat auto-claim paths (both SSE-subscribe AND first-tools/call, single helper) keep existing adapters working unchanged (zero deploy-coordination required).
  - All new code paths emit dedicated audit actions with explicit `trigger` field for observability + deprecation-runway tracking.
  - Tests at unit + integration cover all four shapes (probe-only, real session, mixed, implicit-claim).
  - **T1+T2 split per Option (b)** *(refined v1.1 per lily's review point #1)*: T1 is purely additive (helpers + audits internal; `register_role` behavior unchanged externally); T2 is the protocol cutover (`register_role` becomes idempotent, `claim_session` exposed). This eliminates the regression window between T1 ship and T2 ship that the original sequence had — at no point is legitimate session reclaim broken. Each task is independently deployable AND independently architect-reviewable against a known-good baseline.
  - T3, T4 may then land independently (adapter and Hub are now decoupled; no atomic-deploy requirement between Hub side and adapter side).

---

## 9. Sequencing within the broader review

This mission is being executed **mid-architectural-review** under explicit Director greenlight. Justification:

- Bug B (probe-induced displacement) is a review-blocker class for any future cold-start: every fresh agent spawn in the review's remaining phases would face the same operator-visibility-breaks-the-system trap.
- Companion bug A (startup race) was already fixed mid-review for the same reason (lily literally couldn't connect without the fix).
- Filing this mission and shipping it inside the review is more efficient than capturing as backlog, because the diagnostic context is fresh and lily's architect attention is already loaded on the problem.

This does **not** open the door for opportunistic mid-review missions on unrelated scopes — Director approval of THIS mission is scoped to THIS mission only. Anti-goal #6 of the review plan ("Executing any pre-existing open mission. Reviews don't cascade into execution mid-review.") remains in force for everything else.

---

## 10. Post-architectural-review hardening (NOT in this mission)

The following items are deliberately deferred to a follow-on hardening pass after the 2026-04 architectural review concludes:

1. **Deprecate BOTH auto-claim back-compat paths together.** *(Refined v1.1 per lily's review point #2.)* Once dashboard data confirms `agent_session_implicit_claim` rate is ~zero across BOTH `trigger: "sse_subscribe"` AND `trigger: "first_tool_call"`, remove both implicit hooks from the SSE handler and the policy router. They're two halves of one back-compat concession; retire as a unit, not separately. Force explicit `claim_session` calls.
2. **Per-fingerprint session-claim rate limiting.** Defense-in-depth against rapid claim/displace churn (e.g. an adapter restart loop). Architecturally trivial once `claim_session` is its own tool.
3. **Adapter-side: detect concurrent-fingerprint collision before claim.** Use `register_role`'s response to check if another live session exists for this fingerprint; surface a deliberate operator decision rather than silent displacement. (This is a UX-quality improvement, not a bug fix.)
4. **Migration of internal tests away from auto-claim path** to use explicit `claim_session`. Keeps test surface aligned with the protocol's intended use.
5. **Adapter must surface "transport disconnected, please restart" via structured MCP error on tool calls when the Hub session is dead** (instead of silently hanging). *(Added v1.1 per Director feedback during P0 diagnosis of bug-26's failure mode being silent.)* Makes the failure legible to the operator without requiring deep diagnostic work to discover.
6. **Deprecate the `sessionClaimed: false` field on `register_role` response** *(added v1.1 per lily's review §10 add-ons)* — once both back-compat auto-claim paths are retired (§10.1), the field becomes a constant and is noise. Remove from the response shape.
7. **PolicyLoopbackHub parity audit.** *(Added v1.1 per lily's review §10 add-ons.)* Integration tests in this mission hit the loopback Hub. Post-hardening should run a parity audit confirming the real Hub and PolicyLoopbackHub implement claim/displace/audit-emission semantics identically. Drift here would silently invalidate the mission's integration test suite's guarantees.

---

## 11. Director approval flow

1. Engineer (greg) authors this brief — DONE (this document).
2. Engineer files the bug entity via `create_bug` and updates §6 with the bug ID — DONE (bug-26).
3. Engineer opens unicast review thread to Architect (lily) carrying this brief reference + bug ID + recommendation — NEXT.
4. Architect (lily) reviews + critiques + ratifies (or revisions). Refinements absorbed into a v1.1 of this brief.
5. Director ratifies post-architect-review.
6. Mission filed via `create_mission` (architect or director per mission-policy); brief's "Hub mission id" field updated.
7. Tasks issued one at a time per locked sequence (T1 → T2 → T3∥T4 → T5); each task architect-reviewed before next is issued.
