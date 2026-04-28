# ADR-008: Shared Hub-Connection Package (@apnex/hub-connection)

**Date:** 2026-04-12 (original), 2026-04-15 (L4/L7 split amendment), 2026-04-16 (renamed to `@apnex/network-adapter@2.0.0`)
**Status:** Accepted — amended by the Phase 7 L4/L7 refactor (see § Amendment below)

> **Rename note (2026-04-16):** The package published today is `@apnex/network-adapter@2.0.0`, living at `packages/network-adapter/`. This ADR's title and body preserve the historical `@apnex/hub-connection` name.
**Threads:** thread-29, thread-31

## Decision

Extract the Hub connection lifecycle management into a shared npm package (`@apnex/hub-connection`). Originally (2026-04-12) this was a single-layer design with a transport-agnostic `IConnectionManager` interface and an `McpConnectionManager` implementation. The Phase 7 refactor (2026-04-15) split this into two layers — see **Amendment** at the bottom. Both the Architect and the Engineer Plugin import and use this package.

## Rationale

The session orphan storm (27 sessions in 3 minutes) was caused by an impedance mismatch between our adapter code and the MCP SDK's transport lifecycle model:

1. The MCP SDK's `StreamableHTTPClientTransport` manages its own SSE reconnection internally via `maxRetries: Infinity`
2. Our adapter code treated transports as disposable — creating new Client + Transport objects on connection failure
3. Old transports' SSE reconnection loops continued running as zombies, creating orphan sessions on the Hub
4. The health monitor (30s) overlapped with the transport's reconnection, compounding the problem

Three options were evaluated (thread-31):
- **Option A (Single-transport-per-lifetime)** — rejected: the MCP Client doesn't re-initialize on transport reconnect, creating zombie clients after Hub redeploy
- **Option B (Controlled dispose-and-recreate)** — rejected: `Transport.close()` doesn't reliably terminate internal SSE loops
- **Option C (Abstraction layer)** — accepted: strict state machine with atomic teardown

## Technical Design

**Interface:** `IConnectionManager` — transport-agnostic, zero MCP types
- `connect()`, `close()`, `isConnected`, `state`
- `executeTool(name, args)` — with auto-reconnect on session invalidation
- `listTools()` — for proxy server tool discovery
- `onNotification(handler)` — SSE event subscription
- `onStateChange(handler)` — lifecycle events

**State Machine:**
```
disconnected → connecting → connected → reconnecting → connecting → ...
```
- Only one state transition at a time (prevents concurrent connects)
- `connecting` flag blocks overlapping reconnect attempts
- `reconnecting` performs atomic teardown before fresh connect

**Atomic Teardown:**
1. Null out Client and Transport references (fail-fast for in-flight operations)
2. Best-effort `client.close()` (may throw on dead connections)
3. 1s settle delay (let zombie SSE loops detect the dead reference)
4. Transition to `connecting` with fresh objects

**Heartbeat:** 30s `listTools()` call verifies connection health. On failure, triggers `reconnecting` transition.

## What It Replaced

- Architect: manual exponential backoff (10s→300s) + health monitor that overlapped with transport reconnection
- Plugin: direct MCP SDK usage with `maxRetries: Infinity` and manual `connectToHub()` function

Both had duplicated connection logic with slightly different bugs.

## Consequences

- **Zero orphan sessions** — steady state of exactly 2-3 sessions (verified over 10+ minutes)
- **Shared code** — one tested implementation used by both Architect and Plugin
- **Transport replaceable** — `IConnectionManager` has no MCP types; implementing `WebSocketConnectionManager` or `HttpConnectionManager` requires no changes to adapter code
- **Package distribution** — `npm pack` + tarball for Cloud Run deployment; `file:` reference for local development
- **Future agents** — any new agent imports `@apnex/hub-connection` and gets bulletproof connection management

## Backlog

- Operational end-to-end stress testing (hard crash simulation, forced disconnect, Last-Event-ID replay under load)
- Extract to publishable npm package when multiple teams/repos consume it

## Amendment — Phase 7 L4/L7 Split (2026-04-15)

The original single-layer `IConnectionManager` design conflated two distinct concerns: wire lifecycle (socket, SSE, heartbeat, wire-level reconnect) and session lifecycle (handshake, state-sync, `session_invalid` retry, event classification). As the enriched handshake (M18), state-sync RPCs, and multiple shim flavours (Claude stdio, Architect manual-sync, OpenCode plugin) accumulated inside the same class, the boundary became load-bearing and deserved its own surface.

Phase 7 (shipped as `@apnex/hub-connection@1.5.0`) split the package into two layers:

- **L4 — `ITransport` / `McpTransport`** (`src/transport.ts`, `src/mcp-transport.ts`). Owns the wire: `connect()`, `close()`, `request(method, params)`, `listMethods()`, wire-level reconnect, SSE watchdog, heartbeat POST, and a coarse 3-state `WireState` (`disconnected → connecting → connected`). Emits `WireEvent`s with a narrow `WireReconnectCause` vocabulary. Knows nothing about sessions, roles, or handshakes.
- **L7 — `IAgentClient` / `McpAgentClient`** (`src/agent-client.ts`, `src/mcp-agent-client.ts`). Owns the 5-state session FSM (`disconnected → connecting → synchronizing → streaming → reconnecting`), the enriched `register_role` handshake, state-sync RPCs, `session_invalid` retry-once, and event classification into `AgentClientCallbacks` (`onActionableEvent`, `onInformationalEvent`, `onStateChange`). Shims talk only to this layer; they pass a `transportConfig` and never construct an `McpTransport` directly.

What changed for consumers: `IClientShim` / `UniversalClientAdapter` / `McpConnectionManager` / `ConnectionState` / `ReconnectReason` are retired. Shims now do `new McpAgentClient({ role, handshake }, { transportConfig })` and register callbacks. A `getTransport()` escape hatch exists for advanced shims that need full MCP tool schemas via `McpTransport.listToolsRaw()` — used by the stdio and Bun.serve proxy shims to re-advertise the Hub's tool surface.

What did not change: the original decision (atomic teardown, heartbeat liveness, SSE watchdog, zero orphan sessions) and all its guarantees carry forward unchanged. The split is structural — it made the boundary explicit rather than introducing new behaviour.

Canonical reference going forward: `docs/network/00-network-adapter-architecture.md`.
