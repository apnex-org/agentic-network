# Agentic Network: Test Specification

## Scope

All tests target the shared network-adapter package (`@ois/network-adapter`) in isolation — no Cloud Run agents, no Gemini, no OpenCode. Tests use **real production code** for both the Hub networking layer (`hub-networking.ts`) and the client (`McpTransport` + `McpAgentClient`), connected via real MCP SDK transports. The only shim is a minimal `register_role` tool — everything else is production code. Mission-19 L7 tests additionally run against `PolicyLoopbackHub`, which plugs the real Hub `PolicyRouter` (all 13 policies) + in-memory stores behind the `ILoopbackHub` contract, so the full policy stack executes without spinning up HTTP/SSE.

**Run tests:** `cd packages/network-adapter && npm test`

## Architecture

```
┌────────────────────────────┐          ┌──────────────────────────────────┐
│  McpAgentClient  (L7)      │          │  HubNetworking (real code)       │
│   └─ McpTransport (L4)     │   MCP    │  + MemoryEngineerRegistry        │
│      (real production code)│◄─HTTP/SSE─►│  + MemoryNotificationStore       │
│      + timers/watchdogs    │          │  + register_role tool (shim)     │
└────────────────────────────┘          └──────────────────────────────────┘
```

The split in production code carries into the test tree. L4 wire behaviour
is pinned against `McpTransport` directly in `test/integration/mcp-transport.test.ts`;
L7 session behaviour is pinned against `McpAgentClient` in `test/integration/mcp-agent-client.test.ts`
and the two invariant tests that ride on top of it.

## Layout

| File                                          | Layer | Tests | Pins                                                                                                 |
| --------------------------------------------- | ----- | ----- | ---------------------------------------------------------------------------------------------------- |
| `test/unit/handshake.test.ts`                 | L7    | 19    | `parseHandshakeError`, `parseHandshakeResponse`, `buildHandshakePayload`, `performHandshake` (fatal halt, malformed body, epoch jump logging). |
| `test/unit/instance.test.ts`                  | L7    | 6     | `loadOrCreateGlobalInstanceId`: first-run generation, persistence, corruption recovery.              |
| `test/unit/deferred-backlog.test.ts`          | Shim  | 19    | Rate-limited prompt queue + deferred backlog for the engineer-side helpers (`prompt-format.ts`, `notification-log.ts`). |
| `test/unit/reconnect-backoff.test.ts`         | L4    | 6     | **G1** — `computeReconnectBackoff` curve (start at `baseDelay`, double per failure, clamp at `maxDelay`). |
| `test/integration/mcp-transport.test.ts`      | L4    | 7     | L4 surface: `connect()` / `close()`, `request()`, `listMethods()`, SSE watchdog, heartbeat POST failure, silent-drop recovery. |
| `test/integration/mcp-agent-client.test.ts`   | L7    | 6     | L7 surface: 5-state session FSM, enriched handshake, state sync, `session_invalid` retry-once, event classification. Runs on `LoopbackTransport`. |
| `test/integration/register-role-payload.test.ts` | L7  | 1     | **Invariant #9** — two `register_role` calls on the same session, plain first then enriched. Runs on `LoopbackTransport`. |
| `test/integration/sync-phase-rpcs.test.ts`    | L7    | 1     | **Invariant #10** — `get_task` + `get_pending_actions` fire during `synchronizing`, strictly after enriched `register_role`, strictly before `streaming`. Runs on `LoopbackTransport`. |
| `test/integration/invariant-gaps.test.ts`    | L7    | 3     | **G2/G3/G4** — duplicate hub-event dedup, `getTransport()` + `listMethods()` live pass-through, 401 handshake propagates out of `start()`. |
| `test/integration/label-routing.test.ts`     | L7    | 5     | **Mission-19** — handshake label plumbing + dispatch selector isolation + INV-AG1 (immutable labels) + INV-SYS-L09 (empty matchLabels = broadcast). Runs on `PolicyLoopbackHub` (real Hub `PolicyRouter` + all 13 policies behind `LoopbackTransport`). |

**Totals:** 10 files, 73 tests.

## Invariant coverage

This table maps the behavioural invariants the package is required to enforce back to the test that pins them. An invariant is **covered** when its failure produces a red test.

| #  | Invariant                                                                                     | Layer | Pinned by                                                    | Status     |
| -- | --------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------ | ---------- |
| 1  | Wire `connect()` is idempotent; second call on a connected transport is a no-op.              | L4    | `mcp-transport.test.ts`                                      | covered    |
| 2  | Wire `close()` leaves `wireState === "disconnected"` and drains in-flight handlers.           | L4    | `mcp-transport.test.ts`                                      | covered    |
| 3  | G2: If SSE never opens, detected within `firstKeepaliveDeadline` (cause `sse_never_opened`).  | L4    | `mcp-transport.test.ts`                                      | covered    |
| 4  | G3: If SSE dies mid-stream, detected within `sseKeepaliveTimeout` (cause `sse_watchdog`).     | L4    | `mcp-transport.test.ts`                                      | covered    |
| 5  | G1: Heartbeat POST failure lifts to an L4→L7 reconnect with cause `heartbeat_failed`.         | L4    | `mcp-transport.test.ts`                                      | covered    |
| 6  | Fatal handshake codes (`agent_thrashing_detected`, `role_mismatch`) halt instead of retry.    | L7    | `handshake.test.ts`                                          | covered    |
| 7  | `globalInstanceId` is stable across restarts; corrupt file triggers recovery, not crash.      | L7    | `instance.test.ts`                                           | covered    |
| 8  | Session FSM obeys `disconnected → connecting → synchronizing → streaming`, no skipped states. | L7    | `mcp-agent-client.test.ts`                                   | covered    |
| 9  | `register_role` is called twice per session: plain first (wire init), enriched second (M18).  | L7    | `register-role-payload.test.ts`                              | covered    |
| 10 | State-sync RPCs (`get_task`, `get_pending_actions`) fire during `synchronizing`, ordered after enriched `register_role` and before `streaming`. | L7 | `sync-phase-rpcs.test.ts` | covered    |
| 11 | G5: Every re-entry to `reconnecting` carries a `SessionReconnectReason`.                      | L7    | `mcp-agent-client.test.ts`                                   | covered    |
| 12 | `session_invalid` classification triggers reconnect + retry-once on the fresh session.        | L7    | `mcp-agent-client.test.ts`                                   | covered    |
| 13 | Event classification dedups hub events by id and routes into actionable/informational.       | L7    | `mcp-agent-client.test.ts`                                   | covered    |
| 14 | `AgentClientCallbacks.onStateChange` fires for every FSM transition in both directions.      | L7    | `mcp-agent-client.test.ts`                                   | covered    |
| 15 | Deferred backlog drops duplicates by content hash, not by raw reference.                      | Shim  | `deferred-backlog.test.ts`                                   | covered    |
| 16 | Rate-limited prompts queue up to the configured cap and flush in order.                      | Shim  | `deferred-backlog.test.ts`                                   | covered    |
| G1 | Consecutive SSE failures trigger exponential backoff (`baseDelay` → 60s cap, reset on connect). | L4    | `reconnect-backoff.test.ts`                                  | covered    |
| G2 | Duplicate hub-event (same id + entity + timestamp) is delivered to callbacks exactly once.   | L7    | `invariant-gaps.test.ts`                                     | covered    |
| G3 | `getTransport()` returns the injected instance live; `listMethods()` reflects hub state.    | L7    | `invariant-gaps.test.ts`                                     | covered    |
| G4 | A non-retriable handshake error (e.g. 401) propagates out of `start()` and leaves `disconnected`. | L7    | `invariant-gaps.test.ts`                                     | covered    |
| M19-AG1 | Agent.labels stamped on first register_role; later handshakes with different labels cannot overwrite (immutability). | L7 | `label-routing.test.ts`                                      | covered    |
| M19-L7a | `HandshakeConfig.labels` flows through enriched `register_role` onto the Agent entity; omitting it persists `labels = {}`. | L7 | `label-routing.test.ts`                                      | covered    |
| M19-L7b | `ctx.dispatch` with `matchLabels: {env:"prod"}` delivers only to Agents whose `labels` match; `matchLabels: {}` broadcasts to all role-matching Agents (INV-SYS-L09). | L7 | `label-routing.test.ts`                                      | covered    |

### Known gaps

None. All 16 primary invariants plus G1–G4 and the Mission-19 L7 round-trip
rows are pinned. New gaps should be added here as the package grows.

## Test conventions

- **Real code, in-memory stores.** Tests construct a real `McpTransport`
  and/or `McpAgentClient` against an in-process Hub that uses
  `MemoryEngineerRegistry` + `MemoryNotificationStore`. No Cloud Run, no GCS.
- **Fake timers for SSE timing.** Timer-sensitive tests use vitest's
  `vi.useFakeTimers()` so watchdog and deadline thresholds can be driven
  deterministically without real waits.
- **One invariant per integration test when possible.** `register-role-payload.test.ts`
  and `sync-phase-rpcs.test.ts` each hold a single `it(...)` block — the
  invariant they guard is the file's only reason to exist.
- **Header comment is mandatory.** Each test file opens with a block comment
  naming (a) the invariant number(s) it pins and (b) the layer (L4 / L7 /
  shim) — see the "Invariant coverage" table for the canonical numbering.

## Running subsets

```bash
# Everything
cd packages/network-adapter && npm test

# L4 wire only
npx vitest run test/integration/mcp-transport.test.ts

# L7 session FSM
npx vitest run test/integration/mcp-agent-client.test.ts

# Just the two invariant regressions
npx vitest run test/integration/register-role-payload.test.ts test/integration/sync-phase-rpcs.test.ts

# Mission-19 label routing (L7 full-stack E2E through real PolicyRouter)
npx vitest run test/integration/label-routing.test.ts

# Unit (handshake primitives + instance bootstrap + deferred backlog)
npx vitest run test/unit
```

## See also

- `docs/network/00-network-adapter-architecture.md` — the canonical L4/L7 architecture reference.
- `docs/network/03-state-machines-and-timers.md` — session FSM + wire FSM diagrams and timer table.
- `docs/network/04-safety-and-resilience.md` — G1–G5 guarantees and the safety-mechanism catalog.
- `docs/decisions/008-connection-manager.md` — the original decision + the Phase 7 L4/L7 amendment.
