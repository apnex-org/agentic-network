---
title: Network Adapter Architecture — L4/L7 Split
status: canonical reference
version: "@ois/network-adapter@2.0.0"
updated: 2026-04-16
---

# Network Adapter Architecture

This document is the single source of truth for the shared network-adapter
package (`@ois/network-adapter`, formerly `@ois/hub-connection`): what it
owns, what it delegates to shims, how the two internal
layers (L4 wire / L7 session) fit together, and how to stand up a new
shim on top of it.

For the original single-layer decision and the amendment that introduced
the split, see `docs/decisions/008-connection-manager.md`.

## 1. Goals of the Universal Adapter

These are the load-bearing properties the adapter must hold, anchored in concrete scars from recent adapter evolution (L4/L7 `McpTransport`/`McpAgentClient` split, M18 first-class Agent work, `ConnectedEngineer` purge). They are the rubric by which any future adapter change should be judged. They are deliberately ordered: correctness and observability precede performance.

1. **Modular.** The adapter must attach to *any* agentic-network-resident component — human-driven CLI (Claude Code, OpenCode), autonomous agent (Vertex + Cloud Run shell), back-end service (hub-side shims), on-prem host, or cloud runtime. One package, many mount points. No adapter behavior may live in a per-host shim.
   - *Canonical scar*: M18 (`globalInstanceId` bootstrap, enriched `register_role` handshake, epoch tracking, fatal-halt handling, structured notification logging) was added to `claude-engineer/src/hub-proxy.ts` only, not to `packages/hub-connection/`. OpenCode silently inherited pre-M18 behavior. Two engineers on the same Hub, two identity schemes, un-designed-for state. The shared-adapter refactor exists to undo this.

2. **Portable.** No assumptions about the host runtime's MCP implementation version, transport, identity scheme, or lifecycle events beyond what the MCP spec and `@modelcontextprotocol/sdk` guarantee. If a future host drops stdio-MCP for something else, only the transport leaf changes.
   - *Canonical scar*: the L4/L7 split (`McpTransport` vs `McpAgentClient`) was introduced precisely because earlier versions of the adapter baked transport assumptions into the agent-level logic. Anything that re-couples them is a regression.

3. **Resilient.** The adapter survives the failure modes we have actually seen in production — not hypothetical ones. Correctness and fault-tolerance trump performance. An efficient adapter that drops notifications is useless.
   - *Canonical scars*: SSE partition behind Cloud Run's proxy (outbound keepalive succeeds while inbound is dead — fixed by making liveness prove itself via inbound POSTs, ADR-007); displacement on plugin restart (fixed by epoch rebinding on `registerAgent`); shared-token collisions between engineers (fixed by fingerprint-derived `engineerId`); zombie sessions that pass keepalive but can't receive targeted push (fixed by session reaper + `markAgentOffline` on cleanup); GCS OCC contention on concurrent registrations (fixed by `ifGenerationMatch` + bounded retry + thrashing circuit breaker).

4. **Authoritative.** Every entity has exactly one canonical source of truth. No dual-store projections, no legacy-namespace mirroring, no "this field lives in two places and we reconcile on read". When an entity has dual namespaces, drift and race conditions are mathematically guaranteed over time.
   - *Canonical scar*: `ConnectedEngineer` (legacy `engineers/*.json`) coexisted with the M18 `agents/*.json` store. `getStatusSummary` read the legacy namespace; M18 `registerAgent` wrote the new one. Operators saw 7 connected zombies that didn't exist, the live plugin session missing from status, and `clientMetadata`/`sessionEpoch`/`globalInstanceId` absent from the projection — three distinct symptoms, all one root cause. Fixed by purging `ConnectedEngineer` entirely and projecting `get_engineer_status` from `listAgents()`. State is written once, to one place, and read from that same place.

5. **Verifiable.** The adapter's current state must be inspectable from outside without reading session transcripts or SSH-ing into the process. Operators and the Architect need to answer "which engineer is on which model, which build, which epoch, how fresh, what SSE state" from a single tool call. Observability is a distinct architectural requirement, not a byproduct of resilience — a system can be perfectly resilient and still completely opaque.
   - *Canonical scar*: before the M18 projection rewrite, the `ConnectedEngineer` shape lacked `clientMetadata`, `proxyName`, `sessionEpoch`, and `globalInstanceId` entirely. A full Architect ↔ Engineer debugging session was needed on 2026-04-14 to establish identity facts that should have been one tool call away. The post-rewrite projection surfaces the full Agent entity (engineerId, sessionId, status, sessionEpoch, clientMetadata, advisoryTags, firstSeenAt, lastSeenAt) in the `get_engineer_status` response.

6. **Efficient.** Hot paths (notification delivery, session heartbeat, tool invocation) must scale to single-connection-at-max throughput on a Cloud Run `maxScale: 1` instance without introducing quadratic behavior or speculative fan-out. Efficiency is last because it is the most tempting premature optimization — and because the first five goals constrain the solution space enough that efficiency usually falls out of correctness done right.
   - *Canonical scar*: `touchAgent` is rate-limited to one persisted GCS write per 30 seconds per agent because writing on every inbound POST would thrash GCS at steady-state tool-call volume, burn quota, and amplify OCC contention into thrashing-circuit-breaker territory. The rate-limit is an in-memory bookkeeping step (`lastTouchAt` map) that collapses concurrent heartbeats into a single write — the simplest intervention that preserves correctness.

These goals are **not** a generic software-architecture wishlist. Every scar cited is a bug that shipped to production, was diagnosed, and was fixed. Future adapter changes that cannot justify themselves against this rubric should not ship.

## 2. Design principle — shared core + last-mile shim

Every agent that talks to the Hub needs the same boring things: open a
wire, hold it open, handshake a session, sync state, classify inbound
events, reconnect on failure, and expose a typed tool surface to the host
LLM. Historically each of our shims (Claude Code engineer, OpenCode
plugin, Architect agent) rebuilt some of that by hand with slightly
different bugs. The shared package makes every one of those things
exactly once, in real production code, and lets each shim do **only**
the host-specific last mile.

> **Shared core:** wire, session FSM, handshake, state sync, event routing, reconnect.
>
> **Shim:** how a host LLM is discovered and prompted; stdio vs Bun.serve vs Express; URL/token bootstrap; toast formatting; persistence.

A shim is typically ~150–300 lines. The shared core is ~2k lines.

## 3. Two layers

```
┌──────────────────────────────────────────────────────────────────────┐
│  Host LLM (Claude Code, OpenCode, Architect Gemini)                  │
└───────────────────────┬──────────────────────────────────────────────┘
                        │ AgentClientCallbacks + call(method, params)
                        ▼
┌──────────────────────────────────────────────────────────────────────┐
│  L7 — IAgentClient / McpAgentClient                                  │
│                                                                       │
│  • Session FSM: disconnected → connecting → synchronizing → streaming │
│    ↔ reconnecting                                                     │
│  • Enriched handshake (register_role plain + enriched)               │
│  • State sync (get_task, get_pending_actions)                        │
│  • session_invalid retry-once                                        │
│  • Event classification (actionable / informational / state)        │
│  • Dedup + routing into AgentClientCallbacks                         │
└───────────────────────┬──────────────────────────────────────────────┘
                        │ ITransport.request / listMethods / WireEvent
                        ▼
┌──────────────────────────────────────────────────────────────────────┐
│  L4 — ITransport / McpTransport                                       │
│                                                                       │
│  • Wire FSM: disconnected → connecting → connected                   │
│  • request(method, params)                                            │
│  • SSE watchdog + heartbeat POST                                     │
│  • Wire-level reconnect, classified as WireReconnectCause             │
│  • listMethods() discovery                                            │
│  • Emits WireEvent stream up to L7                                   │
└───────────────────────┬──────────────────────────────────────────────┘
                        │ MCP StreamableHTTP (POST + GET/SSE)
                        ▼
                    Hub (Cloud Run)
```

### 3.1 Why two layers

The responsibilities above don't naturally fit on the same object. Wire
concerns (opening a socket, keepalives, retry on ECONNRESET) have
nothing to do with session concerns (who am I, what epoch am I on, what
did the Hub forget about me while I was gone). Smushing them together
was load-bearing: every time we added a new shim or a new handshake
field, the code touched both halves of the old `McpConnectionManager`
and produced surprising edge cases. Splitting them makes each half
small enough to test in isolation, and makes it possible to stand up a
non-MCP transport later without touching session code.

### 3.2 What each layer must NOT do

| Layer | Must NOT                                                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L4    | Know about roles, sessions, handshakes, `session_invalid`, event dedup, or shim callbacks. Its vocabulary is `method`, `params`, `WireState`, `WireReconnectCause`.      |
| L7    | Touch sockets, SSE, heartbeat timers, or raw `StreamableHTTPClientTransport`. Its vocabulary is `call`, `SessionState`, `SessionReconnectReason`, `AgentEvent`.           |

Violating either of these is how we get drift. Reviewers: enforce it.

## 4. Package map

```
packages/network-adapter/
├── src/
│   ├── index.ts               — public surface re-exports
│   │
│   ├── transport.ts           — ITransport, TransportConfig, WireEvent types  (L4)
│   ├── mcp-transport.ts       — McpTransport implementation                   (L4)
│   │
│   ├── agent-client.ts        — IAgentClient, AgentClientCallbacks,
│   │                            SessionState, SessionReconnectReason types    (L7)
│   ├── mcp-agent-client.ts    — McpAgentClient implementation                 (L7)
│   │
│   ├── handshake.ts           — buildHandshakePayload, performHandshake,
│   │                            parseHandshakeError, FATAL_CODES              (L7 helper)
│   ├── state-sync.ts          — performStateSync (get_task + get_pending_actions)
│   ├── event-router.ts        — classifyEvent, parseHubEvent, createDedupFilter
│   ├── instance.ts            — loadOrCreateGlobalInstanceId (identity bootstrap)
│   ├── logger.ts              — ILogger, LegacyStringLogger bridging
│   │
│   ├── prompt-format.ts       — engineer-side prompt text helpers (shim-facing)
│   └── notification-log.ts    — engineer-side notification append helper (shim-facing)
│
└── test/
    ├── unit/
    │   ├── handshake.test.ts        — 19 tests
    │   ├── instance.test.ts         —  6 tests
    │   ├── deferred-backlog.test.ts — 19 tests
    │   └── reconnect-backoff.test.ts —  6 tests (G1 — backoff curve)
    └── integration/
        ├── mcp-transport.test.ts         — 7 tests  (L4 surface, real wire)
        ├── mcp-agent-client.test.ts      — 6 tests  (L7 surface + FSM, loopback)
        ├── register-role-payload.test.ts — 1 test   (Invariant #9, loopback)
        ├── sync-phase-rpcs.test.ts       — 1 test   (Invariant #10, loopback)
        └── invariant-gaps.test.ts        — 3 tests  (G2/G3/G4, loopback)
```

**Total:** 68 tests across 9 files. L4 runs against real `McpTransport` + a loopback-bound `TestHub`; L7 runs against `McpAgentClient` + in-memory `LoopbackTransport`/`LoopbackHub`. See `06-test-specification.md` for the invariant-to-test map.

## 5. L4 — ITransport / McpTransport

### 5.1 Contract

`ITransport` is a deliberately small string-keyed request surface:

```typescript
interface ITransport {
  readonly wireState: WireState;           // "disconnected" | "connecting" | "connected"
  connect(): Promise<void>;                // idempotent
  close(): Promise<void>;
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  listMethods(): Promise<string[]>;
  onWireEvent(handler: WireEventHandler): void;
  getMetrics(): TransportMetrics;
}
```

Untyped `request(method, params)` is deliberate: the adapter and shim
above must be transport-agnostic. A future loopback or gRPC transport
satisfies the same contract with no change at L7.

### 5.2 Wire FSM

Three states, no surprises:

```
disconnected → connecting → connected
     ▲                         │
     └─────── close() ─────────┘
```

Wire-level reconnect happens **inside** the L4 layer without crossing
back through `disconnected` visibly to L7 — the wire tears itself down
and comes back up, emitting `reconnecting` → `reconnected` events on
the `WireEvent` stream. Only a wire death the transport decides it
can't recover from (or an explicit `close()`) lands back in `disconnected`.

### 5.3 WireEvent stream

L7 subscribes to a narrow event set. This is the entire L4→L7 protocol:

```typescript
type WireEvent =
  | { type: "state"; from: WireState; to: WireState }
  | { type: "reconnecting"; cause: WireReconnectCause }
  | { type: "reconnected" }
  | { type: "closed"; reason?: string }
  | { type: "push"; method: string; payload: unknown };
```

`WireReconnectCause` is the L4 vocabulary for why the wire flapped:

| Cause               | Meaning                                                                       |
| ------------------- | ----------------------------------------------------------------------------- |
| `sse_watchdog`      | Keepalive gap exceeded `sseKeepaliveTimeout` mid-stream.                      |
| `sse_never_opened`  | First keepalive never arrived within `firstKeepaliveDeadline` after connect.  |
| `heartbeat_failed`  | Heartbeat POST errored (wire-visible failure).                                |
| `peer_closed`       | Remote ended the stream cleanly.                                              |
| `wire_error`        | Transport-level unexpected error.                                             |

The L7 client lifts these into `SessionReconnectReason` at its end of
the seam — L7 has a stricter vocabulary because it also knows about
`session_invalid`, which L4 cannot classify.

### 5.4 Invariants (pinned by `mcp-transport.test.ts`)

- **G1/2/3/4:** The wire-level SSE guarantees documented in `04-safety-and-resilience.md` live here, not at L7. L7 just observes the `WireEvent` stream.
- **Idempotent connect:** `connect()` on an already-connected transport is a no-op.
- **Clean close:** After `close()` resolves, `wireState === "disconnected"` and no further `WireEvent`s fire except a final state transition if one hadn't already.
- **Escape hatch:** `McpTransport.listToolsRaw()` returns full MCP tool schemas (name + inputSchema) for shims that need to re-advertise the Hub's tool surface to their own MCP clients (stdio / Bun.serve proxy pattern). This is NOT on `ITransport` — it's a concrete `McpTransport` method reached via `(agent.getTransport() as McpTransport).listToolsRaw()`.

## 6. L7 — IAgentClient / McpAgentClient

### 6.1 Contract

```typescript
interface IAgentClient {
  readonly state: SessionState;    // 5-state session FSM
  readonly isConnected: boolean;   // alias: state === "streaming"

  start(): Promise<void>;
  stop(): Promise<void>;
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
  listMethods(): Promise<string[]>;
  setCallbacks(callbacks: AgentClientCallbacks): void;
  getSessionId(): string | undefined;
  getMetrics(): AgentClientMetrics;
  getTransport(): ITransport | undefined;  // escape hatch
}
```

### 6.2 Session FSM

```
                    start()
                       │
                       ▼
  ┌──────────────► disconnected ◄──────── stop()
  │                    │
  │                    │ start()
  │                    ▼
  │               connecting
  │                    │
  │     transport.connect() + register_role (plain) + enriched handshake
  │                    │
  │                    ▼
  │              synchronizing
  │                    │
  │          get_task + get_pending_actions
  │                    │
  │                    ▼
  │               streaming
  │                    │
  │  ┌─────────────────┼──────────────────┬────────────────┐
  │  │                 │                  │                │
  │ heartbeat_failed  sse_watchdog   sse_never_opened  session_invalid
  │  │                 │                  │                │
  │  └─────────────────┼──────────────────┴────────────────┘
  │                    ▼
  │              reconnecting
  │                    │
  │      teardown() + fresh transport.connect()
  │                    │
  └────────────────────┘
```

**Guarantees when `state === "streaming"`:**

- **G1:** SSE stream is proven alive (at least one keepalive received).
- **G2:** If SSE never opens, detected within `firstKeepaliveDeadline`.
- **G3:** If SSE dies mid-stream, detected within `sseKeepaliveTimeout`.
- **G4:** Consecutive SSE failures trigger exponential backoff.
- **G5:** All re-entries to `reconnecting` carry a classified `SessionReconnectReason`.

G1–G4 are physically enforced by `McpTransport` and observed by `McpAgentClient` via `WireEvent`. G5 is owned by `McpAgentClient` — it is the authority for what the session reconnected because of.

### 6.3 Enriched handshake

Two `register_role` calls happen on every fresh session, in order, on
the same session id:

1. **Plain** — during `connecting`, at the wire-init seam. No enriched payload. Establishes the session id.
2. **Enriched** — immediately after, carrying `globalInstanceId`, `proxyName`, `proxyVersion`, `transport`, `sdkVersion`, `clientInfo`, optional `llmModel`, and optional Mission-19 `labels`. This is the M18 identity — how the Hub tells two sessions belonging to the same physical agent apart from two agents racing the same token.

Fatal handshake codes (`agent_thrashing_detected`, `role_mismatch`) do
NOT retry. They invoke `onFatalHalt` and the shim is expected to exit
the host process (`makeStdioFatalHalt` is provided for stdio shims).

**Mission-19 routing labels.** The enriched call also forwards `labels?: Record<string, string>` from `HandshakeConfig.labels`. The Hub stamps these onto the Agent entity **once, immutably** (INV-AG1) — a later handshake with a different label map cannot overwrite them. Downstream, `task.labels` inherits from the creator Agent and `ctx.dispatch` uses them as `matchLabels`, so agents with `{env:"prod"}` form an isolated virtual network from agents with `{env:"smoke"}`. Omit `labels` for the legacy broadcast behavior (INV-SYS-L09: empty `matchLabels` matches all role-qualified Agents). See `docs/network/workflow-registry.md` §6 for selector semantics and `packages/network-adapter/test/integration/label-routing.test.ts` for the full L7 round-trip E2E.

Pinned by: `handshake.test.ts` (unit) + `register-role-payload.test.ts` (integration, Invariant #9) + `label-routing.test.ts` (Mission-19 L7 E2E).

### 6.4 State sync

On entry to `synchronizing`, `McpAgentClient` calls `get_task` and
`get_pending_actions` in parallel. A shim may opt out of this with
`manualSync: true` in options — the Architect shim uses this because
it drives its own sync via `HubAdapter.onSync()` / `completeSync()`.

Pinned by: `sync-phase-rpcs.test.ts` (Invariant #10).

### 6.5 Event routing

Inbound push notifications from the wire (`WireEvent` of type `"push"`)
are parsed by `event-router.ts` into `AgentEvent`, dedup-filtered by
event id, classified as `actionable` or `informational`, and dispatched
into the shim's `AgentClientCallbacks`:

```typescript
interface AgentClientCallbacks {
  onActionableEvent?: (event: AgentEvent) => void;
  onInformationalEvent?: (event: AgentEvent) => void;
  onStateChange?: (
    state: SessionState,
    previous: SessionState,
    reason?: SessionReconnectReason,
  ) => void;
}
```

All three callbacks are optional. A shim that doesn't care about
informational events just omits the handler — the agent client drops
them silently.

### 6.6 session_invalid retry-once

When `call(method, params)` surfaces a Hub response that classifies as
`session_invalid`, `McpAgentClient` does exactly one thing: transitions
to `reconnecting` with reason `session_invalid`, drives the FSM back
through a fresh handshake to `streaming`, and retries the original
call exactly once on the new session. If that retry fails for any
reason, the error bubbles to the shim. The retry is not recursive.

## 7. Instantiation pattern

Every shim does the same three things:

```typescript
import {
  McpAgentClient,
  McpTransport,
  type AgentClientCallbacks,
  makeStdioFatalHalt,
} from "@ois/network-adapter";

// 1. Build callbacks.
const callbacks: AgentClientCallbacks = {
  onActionableEvent: (event) => {/* shim last-mile: prompt LLM, toast, etc. */},
  onInformationalEvent: (event) => {/* shim last-mile: inject context */},
  onStateChange: (state, prev, reason) => {/* shim logging / UI */},
};

// 2. Construct the agent client (it owns the transport internally).
const agent = new McpAgentClient(
  {
    role: "engineer",
    logger: myLogger,
    handshake: {
      globalInstanceId,
      proxyName: "@ois/claude-plugin",
      proxyVersion: "1.2.3",
      transport: "stdio",
      sdkVersion: "@ois/network-adapter@2.0.0",
      getClientInfo: () => ({ name: "Claude Code", version: "..." }),
      onFatalHalt: makeStdioFatalHalt(),
    },
  },
  {
    transportConfig: { url: hubUrl, token: hubToken },
  },
);

agent.setCallbacks(callbacks);

// 3. Drive the lifecycle.
await agent.start();
// ... shim runs ...
await agent.stop();
```

**Advanced escape hatch.** If the shim needs full MCP tool schemas
(name + inputSchema) to re-advertise them to its own local MCP client
— as the stdio and Bun.serve proxy shims do — it goes through
`McpTransport.listToolsRaw()`:

```typescript
const transport = agent.getTransport() as McpTransport;
const tools = await transport.listToolsRaw();
```

Direct transport construction (`new McpTransport(...)` outside an agent
client) is supported by the interface but discouraged for shims. The
two-layer split exists specifically so that shims talk to L7 only.

## 8. Shims today

Three shims consume `@ois/network-adapter@2.0.0`.

| Shim                                              | Transport host   | Manual sync | Notes                                                                                                 |
| ------------------------------------------------- | ---------------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| `adapters/claude-plugin/src/shim.ts` + `dispatcher.ts` | stdio MCP server | no  | Split into `shim.ts` (stdio + config) and `dispatcher.ts` (MCP server + CallTool handler + pendingActionMap). Shipped as `plugin:agent-adapter:proxy`. |
| `adapters/opencode-plugin/hub-notifications.ts`   | Bun.serve proxy  | no          | ~300 lines. Local MCP proxy on random port, registered with OpenCode via `client.mcp.add(...)`.       |
| `agents/vertex-cloudrun/src/hub-adapter.ts`       | Express (Cloud Run) | **yes**  | Preserves public `HubAdapter` class surface (`onSync`/`completeSync`). Passes `manualSync: true`.     |

Each shim does its own host-specific bootstrap (how to discover URL +
token, how to format toasts, how to persist `globalInstanceId`) and
funnels everything else through `McpAgentClient`.

## 9. Adding a new shim

The checklist:

1. **Pin the tarball.** Add `"@ois/network-adapter": "file:./ois-network-adapter-2.0.0.tgz"` (or newer) to your `package.json`. Don't float it.
2. **Bootstrap identity.** Call `loadOrCreateGlobalInstanceId()` once per process with a host-appropriate path (e.g. `~/.ois/<host>-instance.json`). Persist the result across restarts.
3. **Build callbacks.** Implement `AgentClientCallbacks` — only the handlers you actually need. Shims that don't prompt LLMs can omit `onActionableEvent`.
4. **Construct.** `new McpAgentClient({role, handshake, logger}, {transportConfig})`. Pass the full enriched handshake unless you genuinely don't care about the M18 identity (Architect is the only such case, and it's grandfathered).
5. **Start / stop.** `await agent.start()` on boot, `await agent.stop()` on shutdown. Don't swallow exceptions from `start()` — fatal handshake codes need to halt the process.
6. **Tool surface.** If the host needs full MCP tool schemas, use `(agent.getTransport() as McpTransport).listToolsRaw()`. If not, `agent.listMethods()` returns the flat string list and is cheaper.
7. **Don't instantiate `McpTransport` yourself.** If you find yourself wanting to, you're probably pushing session concerns into the wire — stop and re-read § 2.2.

## 10. Versioning

| Component                         | Version                    |
| --------------------------------- | -------------------------- |
| `@ois/network-adapter` (package)  | 2.0.0                      |
| Tarball consumers                 | pinned via `file:` path    |
| Phase 7 refactor                  | complete (2026-04-15)       |
| Phase 8 doc / test cleanup        | in progress                 |

Consumers pin tarball paths rather than floating a version range so a
package bump can't silently break an agent.

## 11. See also

- `docs/network/01-architecture-overview.md` — higher-level "what is the network".
- `docs/network/03-state-machines-and-timers.md` — FSM diagrams, timer reference.
- `docs/network/04-safety-and-resilience.md` — G1–G5 guarantees, safety-mechanism catalog.
- `docs/network/05-configuration-reference.md` — `TransportConfig` + `AgentClientConfig` parameters.
- `docs/network/06-test-specification.md` — invariant coverage map, test layout.
- `docs/decisions/008-connection-manager.md` — original decision + Phase 7 amendment.
