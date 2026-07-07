# Changelog — @apnex/network-adapter

## 0.1.10 — Publish idea-465 retry-gap hardening (HCAP Slice-1.x)

### Fixed
- Publishes the post-#552 HCAP tool-surface reconciler hardening: the applied
  Hub revision is no longer advanced before the consumer refresh succeeds, so a
  transient `listTools`/refresh failure leaves the held revision behind and the
  next heartbeat retries instead of masking drift until the next Hub redeploy.
- Carries the corrected reconciler semantics used by `@apnex/pi-plugin@0.1.5`
  for live `[hcap-source]` convergence verification.

## 0.1.7 — Publish the NotificationCoalescer facade re-export (bug-215)

### Fixed
- **`NotificationCoalescer` is now exported from the published package.** The
  facade re-export (`export { NotificationCoalescer } from "@apnex/message-router"`)
  was added in mission-101 W4 (#468) but shipped WITHOUT a version bump, so the
  registry `0.1.6` build lacked the export. `@apnex/opencode-plugin` imports
  `NotificationCoalescer` from this package, so an npm install of the plugin threw
  `SyntaxError: does not provide an export named 'NotificationCoalescer'` at module
  load and silently failed to activate (no Hub handshake). Bumping to 0.1.7 forces
  a republish that carries the export. See bug-215.

## 0.1.6 — Per-agent poll/heartbeat jitter (mission-99 F2)

### Added
- **±20% per-agent poll/heartbeat jitter** (`poll-backstop.ts`) — each agent's
  Tier-C reads are desynchronized via symmetric ±20% jitter on the poll/heartbeat
  interval (self-rescheduling `setTimeout`, injectable RNG, stop-race guard). This
  prevents a synchronized fleet-wide read burst (tele-11) and underpins the swarm
  footer's heartbeat-piggybacked pull path in `@apnex/pi-plugin` ≥ 0.1.2.

## 0.1.5 and earlier

Sovereign tool-manager + `runToolDispatch` authority shared by all host adapters
(pi, claude). Signal-FSM, queueItemId injection, idle-gate, lease observation,
work-protocol lifecycle verbs.
