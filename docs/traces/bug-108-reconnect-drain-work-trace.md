# bug-108 — Lossless reconnect notification delivery — work-trace

**Bug:** bug-108 (Director-prioritized critical, `notification-delivery-invariant`)
**Engineer:** greg
**Coordination:** thread-605 (architect lily — polling, not push, until PR A ships)
**Branch:** `agent-greg/bug-108-reconnect-drain` (off `origin/main @ 851dfb9`)

## Invariant (Director-stated)

A reconnect must not drop a push. On EVERY reconnect the adapter must auto-drain
pending actions AND surface each as a live wake to the session.

## Root cause (confirmed in code)

`performStateSync` (network-adapter `state-sync.ts`) runs `drain_pending_actions`
on every reconnect and invokes `onPendingActionItem` per drained item — recovery
works. The defect is purely where the shims route that hook:

- **claude-plugin** `shim.ts:~622` — `onPendingActionItem` → `appendPendingActionLog`
  → `appendNotification` → `LOG_FILE` + stderr mirror. Never calls
  `pushChannelNotification` (the `notifications/claude/channel` MCP injection = the
  actual LLM wake).
- **opencode-plugin** `shim.ts:~487` — same: log-only via `appendNotification`.
- Live path: SSE notification → `notificationHooks.onActionableEvent` → which DOES
  call `pushChannelNotification`. So live notifications wake the session;
  reconnect-drained ones only get logged.

## Fix plan (concurred — thread-605 r3)

- **PR A (primary, priority):** route reconnect-drained items through the same
  actionable-wake surface live SSE notifications use — converge the drain-handler
  onto the `onActionableEvent` wake path, both shims. Keep the log append as the
  diagnostic mirror. Ships via plugin re-release (v0.1.5) + operator reinstall.
- **PR B (secondary, mitigation):** raise the 300s nginx `proxy_read/send_timeout`
  + add a Cloud Run `timeout` (max 3600s) — `modules/hub/`. Hub redeploy.
- **Integration test:** real reconnect→drain→`pushChannelNotification`→wake path
  end-to-end with a real drained item — not a handler-level unit assertion.
- **Post-ship live verification:** after v0.1.5 + reinstall, force a reconnect and
  confirm a drained notification actually wakes the session live.
- **`Pending actions: 2` observation:** confirm in the trace; if PR A doesn't clear
  it, flag as a separate item — don't absorb it.

## Session log

### 2026-05-21 PM AEST — bug-108 picked up; PR A started

- thread-605: architect surfaced bug-108 (Director-critical). Code-traced the root
  cause, posted the read, architect concurred the fix shape (split, PR A first).
- Branch `agent-greg/bug-108-reconnect-drain` cut off `origin/main @ 851dfb9`.
- **claude-plugin shim fixed** — `onPendingActionItem` now mirrors the live
  `onActionableEvent` path: `appendPendingActionLog` (diagnostic mirror, kept) +
  `pushChannelNotification` (the `notifications/claude/channel` actionable wake),
  pulse-level discriminated via `isPulseEvent`. `tsc --noEmit` clean.
- **opencode-plugin shim fixed** — `onPendingActionItem` now also builds a
  `QueuedNotification` and routes it through the same `notificationQueue` /
  `processNotification` wake the live `onActionableEvent` uses.
- **Finding — opencode-plugin baseline does not typecheck on `main`**: pre-existing
  errors (`assertHostWiringComplete` import, `firstTimerEnabled`, handshake `name`)
  unrelated to this change — opencode-plugin is one of the known-failing non-hub
  CI cells. My edit adds no errors at its lines but rides a broken baseline.
  Surfaced to architect on thread-605.
- **Finding — test-architecture**: the real shim `onPendingActionItem` handler is
  inline in `shim.ts`'s `main()` (not importable; no `isMainModule` guard). A true
  end-to-end test of the real handler needs either a surfacing-extraction to an
  importable module or an `isMainModule` guard on the plugin entry. Surfaced to
  architect for a mechanism call before writing the integration test.
- NEXT: architect input on the test-architecture fork → integration test →
  build+verify → PR A.

### 2026-05-21 PM AEST — extraction done; e2e-harness finding

- Architect concurred (thread-605 r5): proceed with the `notification-surface.ts`
  extraction; do NOT push it to message-router (host-wake injection is adapter-layer);
  opencode-plugin baseline is separate debt she'll track + surface to Director.
- **`notification-surface.ts` created** — `pushChannelNotification` (moved out of
  `shim.ts`, `log` parametrized) + new `surfacePendingActionItem` (the importable
  bug-108 surfacing: diagnostic log + the actionable `<channel>` wake). `shim.ts`
  imports both; the inline claude-plugin fix is replaced by the module call. The
  live `onActionableEvent` path now calls the imported `pushChannelNotification`.
  `tsc --noEmit` clean.
- **Finding — the claude-plugin e2e harness is dead on `main`.** `shim.e2e.test.ts`
  depends on `PolicyLoopbackHub` (`packages/network-adapter/test/helpers/policy-loopback.ts`),
  which imports ~12 `Memory*Store` classes + `registerDocumentPolicy` from `hub/src`
  that the mission-83 substrate migration removed — the suite cannot even load. This
  is why `vitest (adapters/claude-plugin)` is a known-failing CI cell: the harness is
  dead, not flaky. Repairing `policy-loopback.ts` is sizeable + out of bug-108 scope.
- **Resolution:** the bug-108 e2e test will use the lightweight, self-contained
  `LoopbackHub` (`loopback-transport.ts` — no `hub/src` imports, not broken) — real
  `McpAgentClient` + real reconnect (`_simulateWireReconnect("sse_watchdog")`) + real
  `performStateSync` + real `drain_pending_actions` RPC + real `surfacePendingActionItem`
  → assert the `notifications/claude/channel` wake at the mock MCP client. Surfaced the
  harness-dead finding to architect on thread-605.
- NEXT: write the `LoopbackHub`-based e2e test → build+verify → PR A.
