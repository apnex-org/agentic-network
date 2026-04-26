# M-Push-Foundation — W0 Spike Report

**Hub mission id:** mission-56
**Wave:** W0 (spike — bounded engineer-side audit; verification-only, no write-paths or new tests)
**Branch:** `agent-greg/mission-56-w0-spike` (fresh-off-`origin/main` at `b6d5955`)
**Activation gate:** mission-56 active 2026-04-26 ~05:33Z (architect-flip per autonomous-arc-driving authority post PR #66/#67/#68/#69 lineage merge + Director's autonomous-arc directive)
**Author:** greg / engineer
**Date:** 2026-04-26

---

## Purpose

Per Design v1.2 §"Wave decomposition" W0 + thread-325 round-2 audit answers #5 + #6: confirm trigger-probability assumptions + de-risk W1+W2 sizing before substantive work begins. Scope is **audit-only** — no write-paths, no new tests, no scope decisions outside Design v1.2 + round-2 audit ratified commitments.

## TL;DR verdicts

| Deliverable | Verdict | Impact |
|---|---|---|
| **D1. Legacy-entity read-path grep** | DirectorNotification: **1 site**; Notification: **0 sites** (read-paths); PendingActionItem: **7 sites** | All 3 entities ≤ 7 sites — well under the ~20 site threshold. **W4 sizing trigger does NOT fire**; 2-3 day W4 estimate holds. |
| **D2. Thread-313 scope cross-map** | All 8 mission-53 scope items map cleanly to W2 + W3 + already-shipped post-cleanup foundations. **No orphaned scope.** | W2/W3 absorption confirmed; mission-53 abandoned status correct. |
| **D3a. SSE Last-Event-ID partial-existing** | `isLegacyCursor()` + ULID envelope + `sseActive` map exist; **no Last-Event-ID replay wiring** (current state-based-reconnect: clients call `get_pending_actions()` post-reconnect). | Trigger (a) ~30% probability **CONFIRMED**. W1 wiring delta estimated ~5h (within "~half-day"). |
| **D3b. MCP-handshake-on-reconnect post-cleanup** | `kernel/handshake.ts` separation makes reconnect path cleanly bounded. `reconnectSession()` re-runs `runSynchronizingPhase` → `performHandshake` synchronously. SSE Last-Event-ID is wire-layer concern (separate seam from handshake). | Trigger (b) ~30% probability **CONFIRMED** (no refinement). (a) AND (b) gate at ~9% combined per round-2 audit holds. **L-firm sizing baseline holds; XL escalation increasingly unlikely.** |
| **D4. `list_messages` since-cursor** | `MessageQuery` shape (`hub/src/entities/message.ts:356`) does NOT have `since` field; `list_messages` policy (`hub/src/policy/message-policy.ts:51`) does NOT extract `since` from args. **NEEDS-ADD.** | W3 scope-flex per round-2 audit answer #5 fires (~quarter-day to extend `MessageQuery` + `listMessages` impl + tool args + tests). |

**Net W0 outcome:** Design v1.2 sizing assumptions confirmed; W4 baseline (2-3 days) holds; (a) + (b) XL escalation gate stays at ~9% combined; W3 absorbs ~quarter-day for `list_messages` `since` cursor extension. **No surprises requiring scope-flex via thread.**

---

## D1. Legacy-entity read-path grep

Per Design v1.2 §"Architectural commitments #7" + §"Round-2 audit asks" #6: enumerate read-path call-sites for the 3 legacy entities scheduled for sunset in W4. Threshold: any single entity exceeds ~20 read-path sites → W4 sizing trigger fires (3-4 days vs 2-3).

### DirectorNotification — 1 read-path site

```
hub/src/policy/pending-action-policy.ts:52   ctx.stores.directorNotification.list(filter)
```

That's it. Plus 1 write-path call-site (`hub/src/policy/task-policy.ts:519` `.create(...)`) and 1 watchdog call-site (`hub/src/policy/watchdog.ts:123` `.create(...)`); both write-paths, not read-paths.

**W4 sub-step 1 ordering**: DirectorNotification first as warm-up — confirmed correct given the smallest read-path coverage. ~30 min sub-step.

### Notification — 0 read-path sites

Notification entity is currently consumed exclusively via write-paths (`hub-networking.ts`):
- `notificationStore.persist(...)` × 2 (lines 323, 351; SSE event creation)
- `notificationStore.cleanup(...)` × 1 (line 243; retention pruning)

The entity has a `listSince` method defined (`notification-repository.ts:100`) BUT **no callers**. State-based-reconnect (hub-networking.ts:738) replaced cursor-based replay; `listSince` is currently dead code.

**Implication:** Notification sunset in W4 is the "biggest tele-3+10 win" per Design v1.2 — but the read-path sunset surface is minimal. The win comes from sunsetting the WRITE path (replacing `notificationStore.persist` with `messageRepository.createMessage`). W4 sub-step 2 sizing should account for this: write-path migration is the lift, not read-path drainage.

**W4 sub-step 2 ordering**: Notification second (largest tele-3+10 win) — confirmed correct given the WRITE-path migration scope; read-path drainage is trivial.

### PendingActionItem — 7 read-path sites

```
hub/src/index.ts:436                           pendingActionStore.listNonTerminalByEntityRef(...)
hub/src/index.ts:581                           pendingActionStore.listContinuationItems()
hub/src/policy/watchdog.ts:81                  stores.pendingAction.listExpired(...)
hub/src/policy/system-policy.ts:35             stores.pendingAction.listForAgent(...)
hub/src/policy/thread-policy.ts:863            stores.pendingAction.listForAgent(...)
hub/src/policy/pending-action-policy.ts:27     stores.pendingAction.listForAgent(...)
hub/src/policy/pending-action-policy.ts:95     stores.pendingAction.listStuck(...)
```

7 read-paths spanning 5 files (index.ts, watchdog, system-policy, thread-policy, pending-action-policy). Higher than DirectorNotification + Notification, but well under the 20-site threshold.

**Methods called**: `listForAgent` (×3), `listExpired` (×1), `listStuck` (×1), `listNonTerminalByEntityRef` (×1), `listContinuationItems` (×1). The diversity means W4 sub-step 3 isn't a single search-and-replace — each method needs its Message-store projection equivalent.

**W4 sub-step 3 ordering**: PendingActionItem last (ADR-017 saga FSM; highest regression risk) — confirmed correct given (i) the diversity of read-method shapes, (ii) the saga-FSM coupling, (iii) all 5 consuming files are in the policy-router hot path.

### W4 sizing verdict

All 3 entities ≤ 7 read-path sites; **threshold of 20 NOT exceeded for any entity**. Design v1.2 sizing assumption holds: **W4 = 2-3 eng-days** (no 3-4 day trigger).

Per-sub-step sizing estimate (engineer guidance for W4 wave-internal task DAG):
- DirectorNotification sub-step 1: ~half-day (1 read-path + write-paths)
- Notification sub-step 2: ~1 eng-day (0 read-paths, but write-path migration is the substantive lift)
- PendingActionItem sub-step 3: ~1-1.5 eng-day (7 read-paths × diverse method shapes + ADR-017 saga regression risk)
- Closing/integration tests + entity-store removal: ~half-day

Total W4: ~3 eng-days at the upper edge of Design v1.2's 2-3 day range. Comfortably L-firm.

---

## D2. Thread-313 scope cross-map

Per Design v1.2 §"Mission-53 absorption" + §"Round-2 audit asks" #6: confirm mission-53 absorbed scope maps cleanly to W2 + W3 + already-shipped post-cleanup foundations. mission-53 status was flipped to abandoned at mission-56 preflight time.

Mission-53 (M-Adapter-Reconnection; thread-313 ratified 2026-04-25) had 8 binding architectural commitments. Cross-mapping each to current state:

| Mission-53 commitment | Current state | Wave |
|---|---|---|
| 1. Network-adapter sovereign-package owns reconnect lifecycle | **Shipped** (post-cleanup `src/kernel/` ownership; PR #69 merged) | Existing |
| 2. onReconnecting/onReconnected hooks for claude-plugin MCP-handshake layering | **Shipped** as `notificationHooks.onStateChange` callback bag (mission-55 PR #63 merged; codified in Universal Adapter notification contract spec PR #64) | Layer-3 contract via mission-55 |
| 3. TCP/SSE close PRIMARY + heartbeat-timeout SECONDARY disconnect detection | **Shipped** (existing `wire/mcp-transport.ts` SSE watchdog + heartbeat POST loop; pre-existing) | Existing |
| 4. Backoff 1s/2s/5s/10s/30s cap with ±10-20% jitter | **Shipped** (`wire/mcp-transport.ts:computeReconnectBackoff()`; tested in `test/unit/reconnect-backoff.test.ts`) | Existing |
| 5. Total-fail threshold via `OIS_ADAPTER_RECONNECT_MAX_DURATION_S` env var (default 300s) | **Verify in W2 spike** — env var presence confirmed at code-comment level; need to verify default 300s holds | W2 |
| 6. Memory-only cursor (in-process; persists across reconnect within session) | Maps to **seen-id LRU N=1000** (Design v1.2 commitment #4 / W2 + W3); cursor-replay primitive will be Hub-side via Last-Event-ID (W1) instead of adapter-issued listSince | W2 + W3 |
| 7. Idempotency dedup last-1000 ULID-LRU | Maps to **seen-id LRU N=1000 with `OIS_ADAPTER_SEEN_ID_CACHE_N` env override** (round-2 audit answer #4 + Design v1.2 commitment #4) | W2 + W3 |
| 8. Heartbeat consumption (Hub-side from bug-35 era) | **Shipped** (existing `wire/mcp-transport.ts` 30s heartbeat POST + 90s SSE watchdog) | Existing |

**Net cross-map result:** **0 orphaned scope items**.

- 5 of 8 commitments already shipped (network-adapter sovereign + reconnect detection + backoff + heartbeat consumption + Layer-3 hook contract via mission-55)
- 2 commitments map to Design v1.2 W2 + W3 commitments (memory-only cursor + LRU dedup → seen-id LRU N=1000)
- 1 commitment is verification (env var confirmation) — bounded sub-task within W2

mission-53 anti-goals (NO buffer-and-replay, NO adapter-side persistence, NO Hub URL auto-discovery) carry forward into Design v1.2 as orthogonal anti-goals (NOT MCP-handshake redesign, NOT Hub-side changes, NOT broader resilience surfaces) — none contradicted by Design v1.2 commitments.

**Verdict:** mission-53 absorption is **clean**. Abandoned status at mission-56 preflight time correct. bug-34 closes at M-Push-Foundation merge per Design v1.2 §"Mission-53 absorption".

---

## D3. Trigger-probability confirm

### D3a. SSE Last-Event-ID protocol — partial-existing audit

Round-2 audit estimated trigger (a) at ~30% probability. Confirmation:

**Existing primitives:**
- `hub/src/amp/envelope.ts:39` — `isLegacyCursor(lastEventId): boolean` detects legacy-integer vs ULID format. ULID envelope (`createEnvelope`) is monotonic, decodable.
- `hub/src/hub-networking.ts:81` — `sseActive: Map<string, boolean>` tracks SSE liveness per session
- `hub/src/hub-networking.ts:91` — Shutdown signal for cancelling outstanding replay operations (placeholder; not active for Last-Event-ID replay)

**NOT existing:**
- **No Last-Event-ID replay wiring.** Current SSE GET handler explicitly state-based-reconnects per `hub-networking.ts:738`: "State-Based Reconnect: No event replay. Clients call `get_pending_actions()` + `completeSync()` after connecting." Comment references `docs/network/07-agentic-messaging-protocol.md`.
- **`Notification.listSince(...)` exists but has zero callers** (verified in D1 above). State-based-reconnect made it dead code.
- **No SSE `id:` field emission with ULID** today (events emit without monotonic-id wrapping for replay-purposes).

**W1 wiring delta estimate:**
- Add `Last-Event-ID` header parsing in SSE GET handler (`hub-networking.ts`) — ~30 min
- Add Message-store query for backfill (Messages where `id > Last-Event-ID AND target matches subscriber AND status === "new"`) — ~60 min
- Replay events via SSE `id:` field before resuming live emit — ~45 min
- Add cold-start stream-all-with-soft-cap path (Design v1.2 commitment #3) — ~90 min
- `replay-truncated` synthetic event for soft-cap pagination — ~30 min
- Test replay-then-live with no duplicates/gaps — ~60 min

**Total W1 wiring delta: ~5h.** Within Design v1.2's "W1 ~half-day" estimate.

**Trigger (a) verdict: ~30% probability CONFIRMED.** Partial-existing primitives + bounded extension work; does NOT realize as "full M-class extension".

### D3b. MCP-handshake-on-reconnect post-cleanup

Round-2 audit estimated trigger (b) at ~30% probability post-cleanup (down from ~50% pre-cleanup). Confirmation:

Post-cleanup, the kernel layer (`packages/network-adapter/src/kernel/`) cleanly separates session-FSM concerns from wire-FSM concerns:

**`kernel/mcp-agent-client.ts:reconnectSession()` (lines 580-594):**
```
1. transition("reconnecting", reason)     — FSM transition
2. transport.close()                      — wire-level close
3. transport.connect()                    — wire-level reconnect
4. runSynchronizingPhase()                — re-runs handshake + state sync
```

`runSynchronizingPhase` re-calls `performHandshake` (line 525) on every reconnect. The handshake is bounded; the Last-Event-ID concern is wire-layer (HTTP header on the SSE GET, not handshake-payload).

**For W2 adapter SSE event-handler integration:**
- SSE Last-Event-ID belongs in `wire/mcp-transport.ts` (sets HTTP header before `transport.connect()` retry)
- Kernel handshake stays unchanged (re-runs as today)
- Adapter SSE handler subscribes once + receives replayed events transparently
- Boundary clean: wire-layer adds Last-Event-ID; kernel doesn't need awareness

**Trigger (b) verdict: ~30% probability CONFIRMED (no refinement).** Post-cleanup `wire/` ↔ `kernel/` separation makes the W2 integration path cleanly bounded. (a) AND (b) combined gate stays at ~9% per round-2 audit. **L-firm baseline holds; XL escalation increasingly unlikely.**

---

## D4. `list_messages` since-cursor support verify

Per round-2 audit answer #5: if `since` parameter not supported today, W3 scope flex (~quarter-day) absorbed.

### Current `list_messages` tool surface

`hub/src/policy/message-policy.ts:51-99` — `listMessages` policy function extracts these args from caller:
- `threadId?: string`
- `targetRole?: MessageAuthorRole`
- `targetAgentId?: string`
- `authorAgentId?: string`
- `status?: MessageStatus`
- `delivery?: MessageDelivery`

Calls `ctx.stores.message.listMessages({...})` with those fields.

### Underlying `MessageQuery` interface

`hub/src/entities/message.ts:356` — `MessageQuery` interface fields:
- `threadId?: string`
- `targetRole?: MessageAuthorRole`
- `targetAgentId?: string`
- `authorAgentId?: string`
- `status?: MessageStatus`
- `delivery?: MessageDelivery` (Mission-51 W4)
- `scheduledState?: MessageScheduledState` (Mission-51 W4)

**No `since` field.**

### Verdict: NEEDS-ADD

`list_messages` does NOT support `since` cursor today. W3 scope-flex per round-2 audit answer #5 fires.

**W3 scope-flex estimate (~quarter-day):**
- Extend `MessageQuery` interface with `since?: string` (ULID-ordered) — ~5 min
- Update `MessageRepository.listMessages` impl to filter `id > since` — ~30 min
- Extend `list_messages` policy args extraction + tool-input schema — ~15 min
- Add unit test for `since` filtering behavior — ~30 min
- Update tool docstring + AMP envelope ID semantics doc — ~15 min

**Total W3 scope-flex: ~95 min.** Within "~quarter-day" per round-2 audit.

---

## Cross-references

- **Mission-56 brief:** `get_mission(mission-56)` (architect-staged 2026-04-26 ~05:33Z; in-entity-brief pattern)
- **Design v1.2:** `docs/designs/m-push-foundation-design.md` (commit `cc90174` on main; PR #62 merged)
- **Round-2 audit thread:** `thread-325` (closed; Design v1.2 ratified at engineer-spec level)
- **Mission-56 preflight:** `docs/missions/mission-56-preflight.md` (commit `dd9cf5b` on main; PR #68 merged)
- **Bundled rename PR:** `b6d5955` (mission-55 PR #69; activation gate #1 satisfier)
- **Mission-55 closing audit:** `docs/audits/m-pre-push-adapter-cleanup-closing-report.md`
- **Recon Report:** `docs/designs/m-push-foundational-adapter-recon.md`
- **Universal Adapter notification contract spec:** `docs/specs/universal-adapter-notification-contract.md`
- **Thread-313 (mission-53 design):** ratified scope cross-mapped in §D2 above
- **ADR-008** — L4/L7 split foundation
- **ADR-017** — pending-action saga; PendingActionItem read-path consumers
- **ADR-024** — storage primitive boundary (W4 sunset preserves)
- **ADR-025** — Message primitive (mission-51 W6; M-Push-Foundation extends)
- **bug-32** — pre-existing cross-package vitest pattern; admin-merge baseline

## Anti-goals (per Design v1.2 W0 spike scope)

This spike honored:
- NO write-path modifications (audit-only; W1 starts the writes)
- NO new tests (verification-only)
- NO scope decisions outside Design v1.2 ratified commitments + round-2 audit answers

## Next steps

W0 spike report ready for architect ratification → W1 dispatch follows. Per architect's stated workflow (multi-PR-velocity-skew calibration #8 + coord-handoff calibration #4): architect proactively dispatches W1 on a fresh thread post W0 merge.

W1 scope per Design v1.2 6-bundled wave shape (engineer-final post-cleanup):
- Hub-side push-on-Message-create (commitment #1)
- Last-Event-ID protocol (commitment #2; ~5h delta per D3a above)
- Cold-start stream-all-with-soft-cap + replay-truncated (commitment #3)
- Estimated total: ~half-day per Design v1.2; W0 confirms partial-existing primitives reduce delta

— greg / engineer / 2026-04-26
