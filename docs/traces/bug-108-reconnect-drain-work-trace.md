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

### 2026-05-21 PM AEST — e2e test GREEN; no regressions; PR A

- Architect concurred (thread-605 r7): LoopbackHub call is right, meets the bar;
  keep driving.
- **`bug-108-reconnect-drain.test.ts` written + passing.** Real `McpAgentClient` +
  `LoopbackHub` + `LoopbackTransport`; real reconnect (`_simulateWireReconnect(
  "sse_watchdog")`) → real `performStateSync` → real `drain_pending_actions` RPC →
  real `surfacePendingActionItem` → asserts the `notifications/claude/channel` wake
  lands at the mock MCP client (`meta.event=thread_message`, `meta.threadId`,
  `meta.level=actionable`, non-empty content). Only the Hub's drain *response* is
  stubbed. Discriminating: the pre-fix log-only wiring produces no channel push →
  the `waitFor` would time out.
- **No regressions — baseline-verified.** claude-plugin suite, my changes stashed
  vs applied: baseline `5 failed | 131 passed`; with PR A `5 failed | 132 passed`
  (the +1 is the new bug-108 test). The 4 failed files / 5 failed tests are
  byte-identical pre-existing debt — `shim.e2e.test.ts` + `bug-25-truncation.e2e.test.ts`
  (dead `PolicyLoopbackHub`), `eager-claim.test.ts` (`parseClaimSessionResponse`
  drift), `MockClaudeClient.test.ts`. claude-plugin `tsc --noEmit` clean.
- CI expectation for PR A: the 5 required gates green; `vitest (adapters/claude-plugin)`
  fails with the SAME pre-existing 5 — the known non-hub debt, not a PR-A regression.
- NEXT: commit the e2e test → open PR A.

### 2026-05-21 PM AEST — PR A MERGED; v0.1.5 release-prep

- **PR #234 (PR A) cross-approved + MERGED → `main @ 1232920f`.** Architect reviewed
  the full diff — fix correct, e2e test real + discriminating, CI 5/5 required green,
  no regressions. thread-605 converged.
- Architect filed **bug-109** for the separate test-infra debt (dead `PolicyLoopbackHub`
  e2e harness + opencode-plugin baseline) — out of bug-108 scope.
- **v0.1.5 release-prep:** PR A did not bump the plugin version, so `release-plugin.yml`
  (tag-triggered) would publish a `0.1.4`-named tarball under a `v0.1.5` release. Bumped
  `adapters/claude-plugin/package.json` `0.1.4 → 0.1.5` + the matching `package-lock.json`
  entry (surgical edit — no `npm install` re-resolve, avoids the optional-peer-dep
  lockfile-strip trap). Version-bump PR → merge → tag `v0.1.5` → `release-plugin.yml`.
- NEXT: open the v0.1.5 version-bump PR → architect cross-approve + merge → tag `v0.1.5`
  → verify the published artifact → operator reinstall → live reconnect verification →
  PR B (infra timeout). Live-verification + PR B coordinated on a fresh thread.

### 2026-05-21 PM AEST — v0.1.5 published; fresh greg on v0.1.5; PR B

- **#235 merged → `main @ 18c8e34`**; annotated tag `v0.1.5` cut on it →
  `release-plugin.yml` run `26222446827` success. **v0.1.5 published + verified** —
  `apnex-claude-plugin-0.1.5.tgz`, `build-info.json commitSha 18c8e34`, the bug-108 fix
  present in the published `dist/` (`notification-surface.js` + `shim.js` calling
  `surfacePendingActionItem`), 3 sovereign tarballs bundled. Surfaced on thread-606.
- **Operator reinstalled both sessions; fresh greg picked up on the v0.1.5 adapter**
  (`@apnex/claude-plugin @ 0.1.5`, build `18c8e34` — confirmed carries the fix).
  shim.log: v0.1.5 session reconnecting on the ~5-min `sse_watchdog` cadence,
  StateSync runs each reconnect, `Pending actions: 0` (greg's queue empty).
- **PR B — infra 300s-timeout mitigation** (branch `agent-greg/bug-108-pr-b-timeout`):
  `modules/hub/proxy/default.conf.template` `proxy_read/send_timeout` 300s → 3600s;
  `modules/hub/cloudrun.tf` add `timeout = "3600s"` to the Cloud Run service template.
  `terraform fmt` clean, `terraform validate` → Success. ~12x less reconnect churn —
  mitigation, not the correctness fix (PR A is). Ships via Hub redeploy (operator/
  Director-coordinated, like the W4 TF apply).
- NEXT: open PR B → architect cross-approve. Live verification (force a reconnect,
  confirm a drained notification wakes the session; confirm `Pending actions` clears)
  is coordinated on thread-606 — needs a notification dispatched during a disconnect
  window, so it is architect-coordinated.

### 2026-05-21 PM/EVE AEST — bug-108 RESOLVED — primary verified live; PR B applied; storm calmed

- **Primary fix verified on the live cloud Hub.** thread-607 verification run: architect
  fired `bug-108-verify` pings across the storm; pings 1–3 all landed `streaming` (live
  `onActionableEvent` — the ~1s disconnect window is hard to hand-time). The dispositive
  hit was organic — at `11:40:01` a real `sse_watchdog` reconnect drained a pending action
  and surfaced it: `[StateSync] Drained 1 pending action item(s)` → `[Channel] Pushed
  thread_message (actionable)`. That is the v0.1.5 `surfacePendingActionItem` →
  `pushChannelNotification` path executing on the live cloud Hub (pre-v0.1.5: log-only,
  no `[Channel] Pushed`). Architect concurred — the drain→surface path is provenance-
  agnostic, so it proves the path for any drained item; the controlled longer-disconnect
  test was skipped as belt-and-suspenders (no new code path).
- **`Pending actions: 2`** — architect traced it to stale `task-144` (M17, retro-closed
  bypassing the FSM). NOT bug-108 loss, NOT a v0.1.5 failure — old queue cruft; closed the
  bug filing's "two items not draining" open question.
- **PR B (#236) merged → `main @ aea11f1`.** The redeploy is 2-step (the nginx
  `proxy_*_timeout` is image-baked — `proxy/Dockerfile` `COPY default.conf.template`):
  (1) rebuilt + pushed `hub-proxy:latest` via `gcloud builds submit` (Cloud Build SUCCESS;
  `sha256:580a2d3c…`, 3600s nginx config baked in); (2) `terraform apply bug108-tfplan`
  on `deploy/hub/` (terraform GCS-backend auth via the `terraform@labops-389703` SA key).
  Plan reviewed at the gate — `0 add, 1 change, 0 destroy`: `timeout 300s→3600s` +
  benign stale-state `scaling`-block drop + W4-closeout token-output materialisation.
- **Apply succeeded** — Cloud Run revision `hub-api-00002-k5t`; live `timeoutSeconds: 3600`;
  `/health` 200; new revision serves the rebuilt proxy.
- **Storm calmed — dispositive.** shim.log: pre-apply 125 `sse_watchdog` reconnects at a
  clockwork ~5-min cadence (08:50 → 12:05); post-apply a 6-reconnect transition cluster
  (12:07–12:12, the Cloud Run revision roll), then **zero reconnects for 10h+** (12:12 →
  22:12). The 300s→3600s SSE-timeout fix works in production.
- **bug-108 → `resolved`** (architect-flipped; fixCommits `1232920` PR A + `aea11f1` PR B).
- Separate test-infra debt (dead `PolicyLoopbackHub` e2e harness + opencode-plugin
  baseline) tracked as bug-109; stale `task-144` queue cleanup deferred — both architect-owned.
