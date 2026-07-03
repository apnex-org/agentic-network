# Changelog — @apnex/network-adapter

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
