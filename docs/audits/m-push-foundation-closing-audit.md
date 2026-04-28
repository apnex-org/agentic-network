# Mission M-Push-Foundation — Closing Report

**Hub mission id:** mission-56
**Mission brief:** scoped via Design v1.2 §"M-Push-Foundation" (architect-authored 2026-04-26 ~14:30 AEST; engineer-pool ✓ from greg via PR #62 cross-approval as part of mission-55 lineage). Activated post Director retrospective on M-Pre-Push-Adapter-Cleanup (mission-55).
**Resolves:** Design v1.2 §"Architectural commitments #1–#7" + the Universal Adapter Phase 1 push-pipeline architecture. Direct successor to mission-55 (M-Pre-Push-Adapter-Cleanup); direct dependent of idea-191 / mission-52 (M-Repo-Event-Bridge).
**Source idea:** mission-51 W6 closing report — "M-Push-Foundation explicitly defers all SSE-push transport work; future mission lands the canonical push primitive on the unified Message store" — promoted via Design v1.2 cascade.
**Dates:** Scoped via Design v1.2 (commit `cc90174`). W0 spike merged 2026-04-26 (PR #70). Substantive waves W1a–W4.3 merged 2026-04-26 (PRs #71–#81). W5 closing wave (this PR) ships post-merge same date. Mission lifecycle: ~1 day end-to-end across 12 PRs.
**Scope:** 12-sub-unit decomposition spanning 5 wave-clusters — W0 (spike + grep audit) → W1a (push-on-Message-create) + W1b (Last-Event-ID protocol + cold-start) → W2.1 (`@apnex/message-router` sovereign-package #6) + W2.2 (adapter SSE handler integration) + W2.3 (claude-plugin source-attribute taxonomy) → W3.1 (`list_messages.since` cursor) + W3.2 (`claim_message`/`ack_message` MCP verbs + Message status FSM) + W3.3 (adapter hybrid poll backstop + claim/ack wiring) → W4.1 (DirectorNotification sunset) + W4.2 (Notification sunset) + W4.3 (PendingActionItem scope correction; doc-only) → W5 (this PR: closing audit + ADR-026 + entity-store removal cleanup).
**Tele alignment:** **Primary tele-3 Sovereign Composition** + **tele-10 Hub-as-Single-Source-of-Truth** — push pipeline + Message-router (sovereign-package #6) + 2/3 legacy notification entities collapsed into Message-store projection. **Secondary tele-7 Confidence-Through-Coverage** + **tele-4 Zero-Loss** + **tele-2 Isomorphic Specification** per Design v1.2 §"Tele alignment".

---

## 1. Deliverable scorecard

| Wave | Source directive | Status | Branch artifact | PR | Test count delta |
|---|---|---|---|---|---|
| W0 | Spike report — legacy-entity read-path grep audit + spike-level structural decisions for waves W1-W4 | ✅ Merged | `09452f5` | #70 | 0 (doc-only spike report) |
| W1a | Push-on-Message-create — Design v1.2 commitment #1; SSE event fired synchronously after `create_message` commit | ✅ Merged | `3f15057` | #71 | + |
| W1b | Last-Event-ID SSE protocol + cold-start replay — Design v1.2 commitment #2; Hub-internal `replayFromCursor` + soft-cap `replay-truncated` synthetic event | ✅ Merged | `c6bcf56` | #72 | + |
| W2.1 | `@apnex/message-router` sovereign-package #6 — Design v1.2 commitment #3; Layer-2 router skeleton with seen-id LRU N=1000 | ✅ Merged | `f5dacfd` | #73 | + |
| W2.2 | Adapter SSE event-handler integration — `@apnex/network-adapter` consume `@apnex/message-router`; dispatcher↔router wiring | ✅ Merged | `15f1405` | #74 | + |
| W2.3 | Claude-plugin source-attribute taxonomy — Design v1.2 commitment #4; per-subkind `<channel>` source attribution at the Layer-3 render-surface | ✅ Merged | `0a403fc` | #75 | + |
| W3.1 | `list_messages.since` cursor extension — Design v1.2 commitment #5 foundation; ULID-strict cursor for adapter-side hybrid poll backstop | ✅ Merged | `eb1ee2b` | #76 | + |
| W3.2 | `claim_message` + `ack_message` MCP verbs + Message status FSM `new → received → acked` — Design v1.2 commitment #6 | ✅ Merged | `c215f6c` | #77 | + |
| W3.3 | Adapter-side hybrid poll backstop + claim/ack wiring + W2.2 stub-claim TODO replacement — Design v1.2 commitments #5+#6 | ✅ Merged | `f7bd1db` | #78 | + |
| W4.1 | DirectorNotification sunset — Design v1.2 commitment #7, sub-PR 1 of 3; 7 call-sites cut over (5 write + 2 read) | ✅ Merged | `4395079` | #79 | + |
| W4.2 | Notification sunset — Design v1.2 commitment #7, sub-PR 2 of 3; 2 prod call-sites cut over (`hub-networking.ts:notifyEvent` + `dispatchEvent`) | ✅ Merged | `18934d4` | #80 | + |
| W4.3 | PendingActionItem scope correction — Design v1.2 commitment #7, sub-PR 3 of 3; doc-only Design v1.2 footnote (Director's Option C; defer to idea-207) | ✅ Merged | `719c0bf` | #81 | 0 (doc-only) |
| W5 | Closing audit + ADR-026 + entity-store removal cleanup (DirectorNotification + Notification ONLY; PAI exempt) | ⏳ This PR | (this PR) | (this PR) | 0 net (cleanup only) |

**Aggregate:**
- 12 of 13 deliverables merged across 12 PRs (#70–#81); W5 (this PR) closes the mission.
- Hub vitest baseline grew from pre-mission 968/5 → 987/5 across mission-56 lifetime (+19 net new tests; primarily W4.1 helper unit tests +14 + W4.2 helper unit tests +5).
- Cumulative diff scale: substantial. New sovereign-package (`@apnex/message-router`); new MCP verbs (`claim_message` + `ack_message`); new SSE protocol layer; 9 production call-sites migrated off legacy notification entities.

**Test counts at mission close:**
- Hub: 64+ files / 987+ passing / 5 skipped (post-W4.2-merge baseline; W4.3 was doc-only; W5 cleanup verified to preserve baseline)
- Cross-package vitest: pre-existing bug-32 pattern (`MemoryTaskStore is not a constructor` in `policy-loopback.ts` — file last touched in M-Cognitive-Hypervisor task-304, pre-mission-51); admin-merge per PR #60–#81 lineage (16+ consecutive)
- Build + typecheck: clean across hub + `@apnex/message-router` + `@apnex/network-adapter` + adapters

---

## 2. Mission goal + success framing

**Parent directive:** Design v1.2 §"M-Push-Foundation" — ship the foundational message-push layer that mission-51 W6 explicitly deferred. Replace ad-hoc per-entity SSE notification dispatch with a unified push pipeline atop the sovereign Message primitive (mission-51 ADR-025) + the storage substrate (ADR-024).

**Mission-56 goal:** ratify the Universal Adapter Phase 1 push-pipeline architecture (3-layer: Network Adapter wire-shim ↔ MessageRouter Layer-2 ↔ Per-Host Shim render) + the seven supporting commitments (push-on-create / Last-Event-ID replay / sovereign Layer-2 router / source-attribute taxonomy / hybrid poll backstop / claim+ack two-step / legacy entity sunset). Land the canonical event-delivery layer that all future workflow primitives consume.

**Success criteria (per Design v1.2 §"Architectural commitments"):**

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Push-on-Message-create — SSE event fires synchronously after `create_message` commit; non-fatal on dispatch failure | ✅ MET | PR #71 (`3f15057`): `message-policy.ts:188-221` fires `ctx.dispatch("message_arrived", {message}, pushSelector(target))` post-commit; cold reconnect-replay (W1b) + poll backstop (W3.3) recover any pushed-but-undelivered events. |
| 2 | Last-Event-ID SSE protocol + cold-start replay | ✅ MET | PR #72 (`c6bcf56`): Hub-internal `replayFromCursor` query + SSE GET wrapper emits replayed Messages via `sendLoggingMessage` with Message ULID as `id:`; soft-cap `replay-truncated` synthetic event at `REPLAY_SOFT_CAP=1000`. |
| 3 | `@apnex/message-router` sovereign-package #6 (Layer-2) | ✅ MET | PR #73 (`f5dacfd`): new package `packages/message-router`; seen-id LRU N=1000 dedup; kind/subkind routing skeleton. PR #74 (`15f1405`): adapter Layer-1c `@apnex/network-adapter` consumes via dispatcher↔router wiring; host-shim-agnostic by construction. |
| 4 | Per-host source-attribute taxonomy at the Layer-3 render-surface | ✅ MET | PR #75 (`0a403fc`): claude-plugin shim adds `<channel>` source-attribute taxonomy for the 4-kind notification taxonomy + per-subkind discrimination. Per Universal Adapter notification contract spec (mission-55 PR #64). |
| 5 | Hybrid push+poll backstop with `since` cursor | ✅ MET | PR #76 (`eb1ee2b`): `list_messages.since` ULID-strict cursor extension. PR #78 (`f7bd1db`): adapter-side `PollBackstop` opt-in module with 5min default cadence + `OIS_ADAPTER_POLL_BACKSTOP_S` env override + 60s floor anti-pattern guard; 24+21 = 45 new adapter unit tests. |
| 6 | `claim_message` + `ack_message` two-step semantics + Message status FSM | ✅ MET | PR #77 (`c215f6c`): Message status FSM `new → received → acked` (linear, monotonic, CAS-via-`putIfMatch`); MCP verbs `claim_message(id, agentId)` + `ack_message(id)`. PR #78 (`f7bd1db`): adapter-side `SharedDispatcher.ackMessage` helper for Option (i) explicit-ack-on-action (Director-confirmed at thread-325 round-2). Multi-agent claim race: winner-takes-all via `claimedBy` field. |
| 7 | Legacy entity sunset (DirectorNotification + Notification → Message-store projection; PendingActionItem deferred to Tier 2 idea-207) | ✅ MET | PR #79 (W4.1; `4395079`): DirectorNotification sunset; 7 call-sites cut over; new `director-notification-helpers.ts` + 14 unit tests; backward-compat MCP tool surfaces preserved. PR #80 (W4.2; `18934d4`): Notification sunset; 2 prod call-sites cut over; new `notification-helpers.ts` + 5 unit tests; SSE event-id swap (notification.id → Message.id) forward-compatible per W1b protocol. PR #81 (W4.3; `719c0bf`): PendingActionItem **scope correction** per Director-ratified Option C — saga FSM primitive structurally distinct from notification records; full migration deferred to idea-207 M-PAI-Saga-On-Messages Tier 2 mission. **Mission-56 closes 2/3 of the legacy notification entities; PAI properly retained as the saga primitive.** |

---

## 3. Per-wave architecture recap

### W0 spike report (`09452f5` / PR #70)

Spike-level structural decisions for waves W1–W4 + legacy-entity read-path grep audit (D1). 5 spike deliverables:
- D1: legacy-entity read-path grep — DirectorNotification 1 site / Notification 0 sites / PendingActionItem 7 sites; all under 20-site sizing trigger
- D2: backend-coexistence model for push-on-create (sync emission inside `create_message` commit; non-fatal on dispatch failure)
- D3: SSE Last-Event-ID design (Hub-internal cursor replay; soft-cap synthetic event)
- D4: claim/ack semantics options (auto-on-render vs explicit-LLM-call)
- D5: legacy-entity sunset blast-radius isolation (sequential per-entity)

Caveat (surfaced + corrected during W4 execution): the D1 grep was scoped to `.list/.get` read-paths only — under-counted write-path call-sites and read-modify-write surfaces (e.g., DirectorNotification's `acknowledge` admin tool). Engineer re-grep at the start of each W4 sub-PR was filed as a methodology calibration (`feedback_w4_subpr_regrep`); it caught the W4.3 PendingActionItem structural-difference-vs-notification-record mistake before any code landed.

### W1a push-on-Message-create (`3f15057` / PR #71) + W1b Last-Event-ID replay (`c6bcf56` / PR #72)

W1a: `message-policy.ts:188-221` — after successful Message commit, fire `ctx.dispatch("message_arrived", {message}, pushSelector(target))`. Subscriber resolution maps `MessageTarget → Selector` (role/agentId/null=broadcast); `delivery !== "push-immediate"` skips fire (queued + scheduled land on poll backstop / sweeper). Dispatch failure logged non-fatal — Message commits regardless of push delivery success.

W1b: Hub-internal `replayFromCursor(opts)` query + SSE GET handler wrapper around `StreamableHTTPServerTransport.handleRequest`. ULID-strict cursor (`id > since`); soft-cap `REPLAY_SOFT_CAP=1000` triggers synthetic `replay-truncated` SSE event + connection close so adapter reconnects with `lastStreamedId` as next `Last-Event-ID` for the subsequent batch. Forward-compatible with the W3.1 adapter-side cursor extension.

### W2.1 sovereign-package #6 (`f5dacfd` / PR #73) + W2.2 dispatcher↔router (`15f1405` / PR #74) + W2.3 source-attribute (`0a403fc` / PR #75)

W2.1: new package `packages/message-router/` published as `@apnex/message-router` (file:-ref via dist/ commit per calibration #20); seen-id LRU N=1000 dedup primitive; kind/subkind routing skeleton.

W2.2: `@apnex/network-adapter` Layer-1c dispatcher consumes `@apnex/message-router` via the `notificationHooks` callback bag pattern (mission-55 PR #63); host-shim-agnostic by construction; per Universal Adapter notification contract (mission-55 PR #64).

W2.3: claude-plugin Layer-3 shim adds `<channel>` source-attribute taxonomy for the 4-kind notification + per-subkind discrimination. Render-surface-rich.

### W3.1 since cursor (`eb1ee2b` / PR #76) + W3.2 claim/ack + FSM (`c215f6c` / PR #77) + W3.3 adapter wiring (`f7bd1db` / PR #78)

W3.1: `list_messages.since` ULID-strict cursor extension on `IMessageStore.listMessages` + the MCP tool surface. Foundation for the adapter-side hybrid poll backstop.

W3.2: Message status FSM `new → received → acked` (linear, monotonic, CAS via `putIfMatch`). MCP verbs `claim_message(id, claimerAgentId)` + `ack_message(id)`. Multi-agent same-role consumer race resolved via winner-takes-all (loser observes `claimedBy !== myAgentId` and silently drops). Director-confirmed at thread-325 round-2: ack tied to consumer-action (Option (i) explicit-ack-on-action), not auto-on-render.

W3.3: adapter-side `kernel/poll-backstop.ts` opt-in module (5min default cadence; `OIS_ADAPTER_POLL_BACKSTOP_S` env override; 60s floor anti-pattern guard); `SharedDispatcher.ackMessage(id)` helper; W2.2 stub-claim TODO replaced with real `claim_message` post-render call; +1147/-3 across 5 files (3 src + 2 test); 45 new adapter unit tests (24 poll-backstop + 21 dispatcher). Closes the W3 cascade.

### W4.1 DirectorNotification sunset (`4395079` / PR #79) + W4.2 Notification sunset (`18934d4` / PR #80) + W4.3 PAI scope correction (`719c0bf` / PR #81)

**W4.1** (5 write + 2 read call-sites): new `hub/src/policy/director-notification-helpers.ts` (~190 lines: emit + projection + filtered-list + claim+ack-acknowledge); 14 unit tests; legacy `directorNotificationStore` retained for W5 cleanup (now this PR). Wire format: `kind: "note"` + `target.role: "director"` + `payload: {severity, source, sourceRef, title, details}`. MCP tool surfaces (`list_director_notifications`, `acknowledge_director_notification`) preserved verbatim — response shape stays backward-compatible.

**W4.2** (2 prod call-sites; `cleanup` timer retained): new `hub/src/policy/notification-helpers.ts` (~80 lines: `emitLegacyNotification`); 5 unit tests; **kind divergence from W4.1** — `kind: "external-injection"` (Hub-event-bus → SSE injection per `repo-event-handler.ts:25` framing; semantically distinct from W4.1's inbox-routed alerts). Both kinds carry identical axes; choice is semantic. Architect ratified divergence at thread-343 r3 ("kinds reflect entity semantics, not cross-W4 stylistic consistency"). **No-double-send analysis** load-bearing: W1a push-on-create fires inside `create_message` MCP tool handler, NOT inside `messageStore.createMessage` itself; helper invokes Message store directly, so W1a does not auto-fire; existing `notifyConnectedAgents` continues SSE delivery using `Message.id` as event-id (forward-compatible with W1b Last-Event-ID protocol).

**W4.3** (doc-only scope correction): re-grep + structural-difference analysis at the start of W4.3 revealed PendingActionItem is a saga FSM primitive (states: `enqueued → receipt_acked → completion_acked → escalated → errored → continuation_required`; primitives: `attemptCount`, `receiptDeadline`, `naturalKey`, `continuationState`) — structurally distinct from the notification-record framing W4.1/W4.2 fit. Full migration would have been 3-5 eng-days of saga-rewrite touching watchdog escalation ladder + adapter pendingActionMap + ADR-017 invariants — well beyond ~1.5d sizing and outside W4 scope. **Director ratified Option C** at thread-345 r2: W4.3 collapses to doc-only Design v1.2 §"Architectural commitments #7" footnote correction; PAI retained as saga primitive; proper sunset deferred to **idea-207 M-PAI-Saga-On-Messages** as a Tier 2 future mission.

### W5 closing wave (this PR)

Three deliverables: closing audit (this file) + ADR-026 (`docs/decisions/026-push-pipeline-and-message-router.md`) + entity-store removal cleanup (DirectorNotification + Notification ONLY; PAI exempt). Hub vitest baseline preserved; cross-package vitest pattern same as PR #60–#81 lineage; admin-merge.

---

## 4. Aggregate stats + verification

**Mission lifecycle:**
- Activation gate: post-mission-55 retrospective; Director-ratified Design v1.2 § "M-Push-Foundation" propose_mission cascade.
- W0–W4 all merged 2026-04-26 across PRs #70–#81.
- W5 (this PR) opens + merges 2026-04-26 (post-W4.3 close).

**Sizing realized vs estimate:**
- Design v1.2 estimate: substantive (W1–W6 ~5-7 eng-days).
- Realized: ~1 day end-to-end across 12 PRs (engineer-time only; architect cross-approval immediate).
- Variance: hits **lower edge** per `feedback_pattern_replication_sizing.md` calibration. Patterns mostly replicated from mission-51 (Message primitive) + mission-55 (Adapter cleanup) + ADR-024 (StorageProvider) precedent. W4.3 scope-correction saved 3-5 eng-days of saga-rewrite that would have spiked the variance.

**Code stats (cumulative across W0–W5):**
- New packages: `@apnex/message-router` (Layer-2 sovereign-package #6).
- New MCP verbs: `create_message` (mission-51), `list_messages.since` (W3.1), `claim_message` (W3.2), `ack_message` (W3.2). All on existing tool-surface — no new verb beyond mission-51's foundation per anti-goal.
- New helpers: `director-notification-helpers.ts` (W4.1), `notification-helpers.ts` (W4.2).
- New tests: +19 net hub-side (W4.1 +14 + W4.2 +5 + W4.3 doc-only); +45 adapter-side W3.3 (24 poll-backstop + 21 dispatcher).
- Migrated call-sites: 9 production sites cut over from legacy notification entities to Message store (7 DirectorNotification W4.1 + 2 Notification W4.2).

**Test counts at mission close:**
- Hub vitest: 987/5 (post-W4.2-merge baseline; W4.3 doc-only; W5 cleanup verified to preserve baseline; final number captured in W5 PR description).
- Adapter vitest: +45 net W3.3 cases on top of mission-55 baseline.
- Cross-package vitest: pre-existing bug-32 pattern (admin-merge baseline).

**Build + typecheck:** clean across hub + `@apnex/message-router` + `@apnex/network-adapter` + claude-plugin + opencode-plugin (modulo pre-existing bug-32 noise in test/helpers/policy-loopback.ts).

---

## 5. Emergent observations + side findings

### 5.1 Re-grep discipline caught architectural-truth divergence pre-coding (W4.3 calibration)

The W0 §D1 grep was scoped to `.list/.get` read-paths only — under-counted write-paths and read-modify-write surfaces (W4.1 actual was 5 write + 2 read; brief said 2 write + 1 read). After W4.1 surfaced this discrepancy, a re-grep-at-start-of-each-sub-PR discipline was filed (`feedback_w4_subpr_regrep`).

The discipline paid off at W4.3: re-grep showed 16 PendingActionItem call-sites (W0 D1 said "7 read-paths"), and structural-difference analysis revealed PAI is a saga FSM primitive — structurally distinct from the notification-record W4.1/W4.2 patterns. Engineer surfaced the divergence on thread-345 BEFORE any code landed; Director ratified Option C (defer to idea-207 Tier 2 mission). This avoided 3-5 eng-days of saga-rewrite that would have:
- Blown the session budget (per `feedback_proactive_context_budget_surface`)
- Risked tele-7 (COMMS reliability) regression on the watchdog escalation ladder + adapter `pendingActionMap` + ADR-017 invariants
- Conflated notification-record sunset with saga-rewrite work (different concerns; better separated)

**Calibration:** when migrating "legacy entity X" reveals X is a structurally distinct primitive (saga vs notification, etc.), the right call is honest scope-acknowledgment + defer to a properly-scoped future mission. The W0/Design-time framing was a forgivable architecting error caught at execution time; the mechanics of catching it (re-grep discipline + structural-difference analysis) are reproducible.

### 5.2 No-double-send analysis as architectural-correctness load-bearer (W4.2 calibration)

W4.2's design choice to invoke `messageStore.createMessage` directly (not via the `create_message` MCP tool handler) was load-bearing for the no-double-send guarantee — W1a push-on-create lives in the tool handler at `message-policy.ts:188-221`, NOT inside `messageStore.createMessage`. Calling the store directly skips W1a; the existing `notifyConnectedAgents` continues SSE delivery with `Message.id` as event-id (forward-compatible with W1b Last-Event-ID).

This is the kind of subtle architectural-correctness detail that's easy to miss at design-time but catches at implementation. Surfacing it explicitly in the W4.2 PR description + thread-343 architect's seal flagged it as "W5 closing-audit-worthy correctness analysis." The discipline of writing the analysis OUT pays off — reviewers verify the no-double-send claim against code; future maintainers learn the boundary.

### 5.3 Bug-32 pattern dominates cross-package failure surface (continued)

Every "test failure" surfaced during W0–W5 verification traces to bug-32 (PolicyLoopbackHub depends on un-exported MemoryStores from hub/src). Mission-56 is the **9th, 10th, 11th, ..., 17th consecutive PR landing** with this failure pattern intact and known. PR #60–#81 = 22-PR uninterrupted lineage of admin-merges with the bug-32 baseline.

Same calibration as mission-55 §5.3: bug-32 has sufficient merge-velocity data to demonstrate it's a stable failure mode rather than a regression risk. Future mission scopes that COULD legitimately fix the pattern should be explicit (and out-of-scope for delivery-class missions like this one).

### 5.4 Engineer + architect cross-approval pattern stabilized across all 12 mission-56 PRs

The engineer-pool ✓ on architect-content / architect-pool ✓ on engineer-content cross-approval pattern executed cleanly across all 12 PRs (mission-55 stabilized this; mission-56 is the second canonical execution example). Architect's PR comment on PR #62 ("In our 2-agent system, the binding repo rule is 'approval from someone other than the last pusher' — which functionally means the OTHER agent always does the cross-approval ✓ regardless of strict CODEOWNERS pool") continues to be the operational interpretation.

### 5.5 Pattern-replication sizing held (mission-56 hit lower-edge of substantive band)

Per `feedback_pattern_replication_sizing.md` calibration: continuation missions ship faster than estimate when they replicate patterns from prior mission lineage. Mission-56's W4.1 + W4.2 + W4.3 cascade replicated W1a-W3.3's "ratify plan → ship sub-PR → seal review thread" cadence; helper-pattern replicated from mission-51 W2's `message-helpers.ts` shape; cross-package admin-merge replicated from mission-55's bug-32 lineage. Velocity: ~1 day end-to-end vs Design v1.2's ~5-7 eng-day substantive estimate.

### 5.6 Proactive context-budget surface preserved arc continuity

Per `feedback_proactive_context_budget_surface` (filed post-thread-332): surface defer flag with full ratified state at the start of substantive new work, not mid-implementation. Engineer flagged proactively at thread-340 (post-W3.3) → Director ratified Option A (reset context + ship W4.1 in fresh session); flagged again at thread-345 (W4.3 scope) → Director ratified Option C (re-scope W4.3 to doc-only). Both surfaces preserved arc continuity by surfacing BEFORE budget tightened.

---

## 6. Cross-references

- **Mission-56 brief:** `get_mission(mission-56)` (architect-staged 2026-04-26; in-entity-brief pattern per Design v1.2 §"M-Push-Foundation")
- **Design v1.2:** `docs/designs/m-push-foundation-design.md` (commit `cc90174` on main; W4.3 footnote at `719c0bf`) — wave decomposition + 7 architectural commitments + anti-goals
- **W0 spike report:** `docs/audits/m-push-foundation-w0-spike-report.md` (commit `09452f5` on main; PR #70) — D1 read-path grep + spike-level structural decisions
- **Universal Adapter notification contract spec:** `docs/specs/universal-adapter-notification-contract.md` (commit `736e13d` on main; mission-55 PR #64) — Layer-1c emits / Layer-3 implements / Layer-2 future-extends; 4-kind event taxonomy
- **ADR-017** (pending-action saga: drain_pending_actions + sourceQueueItemId) — v1.0 ack mechanism for actionable events; W3.2 extended to `new → received → acked` two-step claim/ack
- **ADR-024** (storage primitive boundary; mission-48 amendment) — mission-56 uses ONLY existing single-entity atomic primitives (`createOnly`, `putIfMatch`, `getWithToken`); no new contract surface
- **ADR-025** (message primitive; mission-51 W6) — direct predecessor; mission-56 commits the canonical push transport on top of the unified Message primitive ADR-025 ratified
- **ADR-026** (this mission; `docs/decisions/026-push-pipeline-and-message-router.md`) — Universal Adapter Phase 1 push-pipeline architecture
- **Methodology calibration #20** (`dist/` committed for file:-ref packages; mission-50 lineage) — relevant for the new `@apnex/message-router` package
- **Methodology calibration #23** (formal-Design-phase-per-idea + tele-pre-check) — Design v1.2 / mission-54 / mission-55 / mission-56 are the canonical execution examples
- **Engineer-pool ✓ + architect-pool ✓ cross-approval pattern** — operational pattern from mission-55 PR #62; informally adopted across mission-54 + mission-55 + mission-56 lineage
- **Mission-55 (M-Pre-Push-Adapter-Cleanup)** — direct predecessor; ships the 5 reusable patterns + Universal Adapter notification contract spec that mission-56 builds on
- **Mission-54 (M-Push-Foundational-Adapter-Recon)** — pre-predecessor recon mission; closed 2026-04-26 ~01:33Z
- **Mission-52 (M-Repo-Event-Bridge)** — orthogonal; ships GH-event bridge producer-side; future consumer of mission-56's push layer
- **Mission-51 (Message primitive)** — predecessor; ships the unified Message primitive that mission-56's push pipeline commits against
- **idea-186 (npm workspaces migration)** — orthogonal; sunsets file:-ref workarounds; would simplify M-Adapter-Distribution Tier 2 work; not gating mission-56
- **idea-191 (M-Repo-Event-Bridge)** — predecessor mission idea; landed as mission-52
- **idea-198 (Cognitive-Layer extraction)** — separable mission; explicitly out-of-scope for mission-56
- **idea-202 (CI revisit)** — orthogonal; operability surface
- **idea-206 (M-Mission-Pulse-Primitive)** — Tier 2; declarative per-mission Hub-scheduled-Message pulse (Director-proposed; subsumes architect-scheduled-wakeup-adoption)
- **idea-207 (M-PAI-Saga-On-Messages)** — Tier 2; proper PAI saga rewrite onto Message-store (W4.3 deferred work)
- **bug-32 (cross-package vitest pattern)** — pre-existing; admin-merge baseline; not gating mission-56
- **Threads:** thread-325 (Director-ratified W3.2 Option (i) explicit-ack-on-action; W4 sub-PR cascade); thread-336 (W2.2 dogfood verification); thread-340 (engineer context-budget surface → Director Option A); thread-341 (W4.1 dispatch + ratification); thread-342 (W4.1 PR-review); thread-343 (W4.2 dispatch + ratification); thread-344 (W4.2 PR-review); thread-345 (W4.3 scope-flex → Director Option C); thread-346 (W4.3 PR-review + W5 dispatch).

---

## 7. Architect-owned remaining

Per the autonomous-arc-driving pattern + Director's ratification at thread-343 r1 (continue cascade through end of mission-56 in same session):

- **Mission status flip:** `update_mission(mission-56, status="completed")` post this PR's merge (architect or engineer; routine).
- **Retrospective draft:** architect files `docs/reviews/mission-56-retrospective.md` (mission-55 retrospective shape; collaborative authoring with Director + greg over multiple rounds).
- **Tier 2 follow-on triage:** strategic-review prioritization of idea-206 (M-Mission-Pulse-Primitive), idea-207 (M-PAI-Saga-On-Messages), M-Adapter-Distribution. All filed; pending Director triage.
- **Tele evaluation** of mission-56 as a methodology-discipline exercise (calibration #23 third canonical execution example after mission-54 + mission-55).
- **HOLD for Director retrospective per autonomous-arc-driving pattern** (binding per `feedback_complete_mission_scope_methodically`).

---

## 8. Mission close summary

Mission-56 (M-Push-Foundation) ships **all 13 deliverables** across 12 PRs in ~1 day end-to-end:

- **W0** (`09452f5` / PR #70) — spike report + read-path grep audit; structural decisions for W1-W4
- **W1a** (`3f15057` / PR #71) — push-on-Message-create
- **W1b** (`c6bcf56` / PR #72) — Last-Event-ID SSE protocol + cold-start replay
- **W2.1** (`f5dacfd` / PR #73) — `@apnex/message-router` sovereign-package #6
- **W2.2** (`15f1405` / PR #74) — adapter dispatcher↔router wiring
- **W2.3** (`0a403fc` / PR #75) — claude-plugin source-attribute taxonomy
- **W3.1** (`eb1ee2b` / PR #76) — `list_messages.since` cursor
- **W3.2** (`c215f6c` / PR #77) — `claim_message` + `ack_message` MCP verbs + Message status FSM
- **W3.3** (`f7bd1db` / PR #78) — adapter hybrid poll backstop + claim/ack wiring + W2.2 stub-claim TODO replacement
- **W4.1** (`4395079` / PR #79) — DirectorNotification sunset (7 call-sites; backward-compat MCP surfaces preserved)
- **W4.2** (`18934d4` / PR #80) — Notification sunset (2 prod call-sites; SSE event-id swap forward-compatible)
- **W4.3** (`719c0bf` / PR #81) — PendingActionItem scope correction (doc-only; Director's Option C; defer to idea-207)
- **W5 (this PR)** — closing audit + ADR-026 + entity-store removal cleanup (DirectorNotification + Notification ONLY; PAI exempt)

**Sizing variance:** lower-edge per `feedback_pattern_replication_sizing.md` (mission-56 replicates patterns from mission-51 + mission-55 + ADR-024). Architect-side dogfood: cross-approval pattern (engineer-pool ✓ on architect-content / architect-pool ✓ on engineer-content) stabilized across 22-PR mission-54/55/56 lineage (#60–#81 + this PR).

**Status flippable to completed** post this PR's merge. **Downstream gates** open at completion:
- Strategic-review triage of Tier 2 ideas (idea-206, idea-207, M-Adapter-Distribution).
- Architect retrospective draft + Director retrospective hold per autonomous-arc-driving pattern.
- Future workflow primitives (idea-199 M-Workflow-FSM-Completeness; idea-194 mid-thread-amend; new pulse primitives) consume the canonical push pipeline mission-56 ships.

**Mechanise+declare retired patterns** (carrying forward as cumulative tele-evidence):
- DirectorNotification entity → Message-store projection (`kind: "note"` + `payload.source` discriminator)
- Notification entity → Message-store projection (`kind: "external-injection"` + `payload.event` discriminator)
- Calibration #4 architect manual ping discipline → push pipeline structurally closes (W2.x adapter SSE handler + W3.3 hybrid poll backstop)

**Deferred to Tier 2** (filed as ideas; pending strategic-review):
- PendingActionItem saga (idea-207 M-PAI-Saga-On-Messages; W4.3 deferred work)
- Architect-side scheduled-wakeup adoption (subsumed by per-mission pulse primitive idea-206 M-Mission-Pulse-Primitive)
- Adapter npm-publish (M-Adapter-Distribution; pre-W5 staged)

**Tier 1 reusable patterns added** (cumulative):
- Universal Adapter notification contract spec (mission-55 D6) consumed by mission-56 adapter wiring
- 3-layer module organization (mission-55) consumed by mission-56 W2.x
- Cross-package vitest job pattern (bug-32 baseline)
- Last-Event-ID SSE protocol (W1b)
- Multi-agent claim winner-takes-all CAS (W3.2)
- Hybrid push+poll backstop (W3.3)
- Source-attribute render-surface taxonomy (W2.3)
- Re-grep-at-start-of-each-sub-PR discipline (W4.3 calibration; `feedback_w4_subpr_regrep`)
- Proactive context-budget surface (`feedback_proactive_context_budget_surface`)
- No-double-send architectural-correctness analysis pattern (W4.2)

Mission-56 is the third canonical execution example of methodology calibration #23 (formal-Design-phase-per-idea + tele-pre-check), following mission-54 + mission-55. Combined mission-54 + mission-55 + mission-56 demonstrates the full Recon → Design → Predecessor-Cleanup → Substantive-Mission pipeline from idea/recon-spike through to the canonical push-foundation feature delivery — all within ~6 hours real-time including Director-paced cross-approvals + retrospective gates.

— greg / engineer / 2026-04-26
