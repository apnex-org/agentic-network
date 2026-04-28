# Agentic Network: State Machines & Timers

## 1. Hub Session State Machine

The Hub manages session lifecycle through presence in four concurrent maps. There is no single `state` field — the effective state is derived from map membership.

### States

| State            | Condition                                                          | Meaning                                       |
| ---------------- | ------------------------------------------------------------------ | --------------------------------------------- |
| **Initialized**    | Session ID exists in `transports` and `servers` maps                   | MCP handshake complete, session is live        |
| **Registered**     | Initialized + `register_role` called (role is not `"unknown"`)         | Agent has declared its role                    |
| **SSE-Active**     | Registered + `sseActive.get(sessionId) === true`                     | SSE stream is open, notifications can be sent  |
| **SSE-Inactive**   | Registered + `sseActive.get(sessionId) === false`                    | SSE stream closed, but session still exists    |
| **Unregistered**   | Initialized + role is `"unknown"` (no `register_role` yet)            | Orphan candidate — pruned after 60s            |
| **Pruned**         | Removed from all maps                                              | Session destroyed                              |

### Transitions

```
                         POST /mcp (initialize)
                                │
                                ▼
                          Initialized
                          (role: unknown)
                                │
                    ┌───────────┼───────────────┐
                    │                           │
              register_role              60s without register
                    │                           │
                    ▼                           ▼
               Registered                   Pruned
                    │                      (orphan reaper)
                    │
              GET /mcp (SSE)
                    │
                    ▼
               SSE-Active ◄────────────── Replay missed
                    │                     notifications
                    │                     (2s delay)
                    │
          ┌─────────┼──────────┐
          │                    │
    res.on("close")    keepalive failure
          │                    │
          ▼                    ▼
     SSE-Inactive         SSE-Inactive
          │                    │
          └────────┬───────────┘
                   │
          3min no activity
                   │
                   ▼
                Pruned
           (session reaper)
```

### Map Operations by Transition

| Transition              | `transports`        | `servers`            | `sseActive`          | `sessionLastActivity`   |
| ----------------------- | ------------------- | -------------------- | -------------------- | ----------------------- |
| Initialize              | `.set(sid, transport)` | `.set(sid, server)`    | (not set yet)        | `.set(sid, Date.now())`   |
| SSE Open                | —                   | —                    | `.set(sid, true)`      | `.set(sid, Date.now())`   |
| SSE Close               | —                   | —                    | `.set(sid, false)`     | —                       |
| Keepalive Success       | —                   | —                    | —                    | `.set(sid, Date.now())`   |
| Keepalive Failure       | —                   | —                    | `.set(sid, false)`     | —                       |
| Prune (reaper/delete)   | `.delete(sid)`        | `.delete(sid)`         | `.delete(sid)`         | `.delete(sid)`            |

### Cleanup on Prune

When a session is pruned (by reaper, explicit DELETE, or transport close):
1. `transport.close()` — best-effort, may throw
2. `engineerRegistry.markDisconnected(sid)` — updates engineer status
3. Delete from all four maps

## 2. Session FSM (McpAgentClient)

The L7 session surface (`McpAgentClient` in `@apnex/network-adapter`) runs an
explicit 5-state session FSM, exposed to shims via
`AgentClientCallbacks.onStateChange(state, previous, reason?)`. The L4
transport (`McpTransport`) has its own coarse 3-state wire surface
(`disconnected → connecting → connected`) and emits `WireEvent`s that the
agent client lifts into session transitions.

### States

| State             | Meaning                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `disconnected`    | Not started, or fully torn down. Initial state.                                                    |
| `connecting`      | Underlying wire being opened. `McpTransport.connect()` in flight.                                  |
| `synchronizing`   | Wire up + enriched handshake done. Running state-sync RPCs (`get_task`, `get_pending_actions`).    |
| `streaming`       | SSE proven live (first keepalive received). Tool calls and push notifications flowing.             |
| `reconnecting`    | Session-level reconnect in progress, classified by `SessionReconnectReason`.                       |

### Full Transition Diagram

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
  │     transport.connect() + register_role
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
  │      teardown() + fresh McpTransport.connect()
  │                    │
  └────────────────────┘
         (re-enters connecting)
```

**SessionReconnectReason taxonomy:**

| Reason             | Source layer | Raised by                                         |
| ------------------ | ------------ | ------------------------------------------------- |
| `heartbeat_failed` | L4 wire      | `McpTransport` heartbeat POST failure             |
| `sse_watchdog`     | L4 wire      | `McpTransport` SSE watchdog (mid-stream gap)      |
| `sse_never_opened` | L4 wire      | `McpTransport` first-keepalive deadline           |
| `session_invalid`  | L7 session   | `McpAgentClient` after Hub rejects a request      |

### Transition Guards

| Guard                         | Condition                                             | Effect                              |
| ----------------------------- | ----------------------------------------------------- | ----------------------------------- |
| `connect()` blocked            | State is `connecting` or `reconnecting`                   | Returns immediately, logs warning   |
| `reconnect()` blocked          | State is `connecting` or `reconnecting`                   | Returns immediately, logs warning   |
| No-op transition              | `newState === currentState`                               | Ignored silently                    |

### Post-Transition Actions

| Transition                | Actions Performed                                                               |
| ------------------------- | ------------------------------------------------------------------------------- |
| `→ connected` (initial)    | Reset `sseVerified=false`, `lastKeepaliveAt=0`. Start heartbeat, watchdog, deadline. |
| `→ connected` (reconnect)  | Same as initial, plus log "Reconnected successfully"                            |
| `→ reconnecting`           | Call `teardown()` (stops all timers, nulls refs, best-effort close, 1s settle)  |
| `→ disconnected` (failure) | Call `scheduleReconnect()` with exponential backoff                              |
| `→ disconnected` (close)   | Stop all timers, teardown, no reconnect scheduled                               |

## 3. SSE Liveness State

Within the `connected` state, the SSE stream has its own verification lifecycle:

```
connected (sseVerified=false)
         │
         │ firstKeepaliveDeadline timer running (60s)
         │ sseWatchdog running but dormant (skips if !sseVerified)
         │
    ┌────┼────────────────────┐
    │                         │
  keepalive               60s expires
  received               (no keepalive)
    │                         │
    ▼                         ▼
sseVerified=true         reconnectWithReason
consecutiveSseFailures=0    ("sse_never_opened")
cancel deadline timer     consecutiveSseFailures++
    │
    │ sseWatchdog now active
    │
    ├──── keepalive received ──→ update lastKeepaliveAt
    │
    │ gap > 90s (no keepalive)
    │
    ▼
reconnectWithReason("sse_watchdog")
consecutiveSseFailures++
```

## 4. Timer Reference

### 4.1 Hub Timers

#### SSE Keepalive
| Property   | Value                              |
| ---------- | ---------------------------------- |
| Type       | `setInterval`                        |
| Interval   | 30,000ms (30s)                     |
| Scope      | All SSE-active sessions            |
| Action     | Send `sendLoggingMessage` with `logger: "keepalive"` |
| On success | Update `sessionLastActivity`         |
| On failure | Set `sseActive = false` for that session |
| Started    | On Hub boot                        |

#### Session TTL Reaper
| Property     | Value                                  |
| ------------ | -------------------------------------- |
| Type         | `setInterval`                            |
| Interval     | 60,000ms (60s)                         |
| TTL          | 180,000ms (3min) for registered sessions |
| Orphan TTL   | 60,000ms (60s) for unregistered sessions |
| Action       | Prune sessions exceeding TTL           |
| Cleanup      | `transport.close()` + `markDisconnected()` + delete from all maps |
| Started      | On Hub boot                            |

#### Notification Cleanup
| Property   | Value                                 |
| ---------- | ------------------------------------- |
| Type       | `setInterval`                           |
| Interval   | 3,600,000ms (1 hour)                  |
| Max age    | 86,400,000ms (24 hours)               |
| Action     | Delete expired notifications from GCS |
| Started    | On Hub boot                           |

#### Notification Replay Delay
| Property   | Value                                      |
| ---------- | ------------------------------------------ |
| Type       | `setTimeout` (one-shot, per SSE connection)  |
| Delay      | 2,000ms (2s)                               |
| Purpose    | Let SSE stream establish and role register before replaying missed notifications |
| Action     | Call `notificationStore.listSince()` and replay each |
| Started    | On each `GET /mcp` (SSE open)                |

### 4.2 McpTransport Timers

#### POST Heartbeat
| Property   | Value                                 |
| ---------- | ------------------------------------- |
| Type       | `setInterval`                           |
| Interval   | `heartbeatInterval` (default: 30,000ms) |
| Action     | Call `client.listTools()` (HTTP POST)   |
| On success | No-op (connection is healthy)         |
| On failure | `reconnectWithReason("heartbeat_failed")` |
| Started    | On transition to `connected`            |
| Stopped    | On `close()`, `teardown()`, or `stopHeartbeat()` |

#### SSE Watchdog
| Property   | Value                                       |
| ---------- | ------------------------------------------- |
| Type       | `setInterval`                                 |
| Interval   | `sseWatchdogInterval` (default: 30,000ms)     |
| Threshold  | `sseKeepaliveTimeout` (default: 90,000ms)     |
| Condition  | Only fires when `sseVerified === true`        |
| Action     | Compare `Date.now() - lastKeepaliveAt` against threshold |
| On exceed  | `reconnectWithReason("sse_watchdog")`         |
| Diagnostic | Every 5th tick logs `SSE watchdog alive` with lastKeepalive gap, sseVerified, instance ID, and time-delta |
| Started    | On transition to `connected`                  |
| Stopped    | On `close()`, `teardown()`, or `stopSseWatchdog()` |

#### Transport Event Handlers (immediate detection)
| Property   | Value                                       |
| ---------- | ------------------------------------------- |
| Type       | Event callback (not a timer)                |
| Events     | `transport.onclose`, `transport.onerror`      |
| Condition  | Only triggers reconnect when `state === "connected"` |
| Action     | `reconnectWithReason("sse_watchdog")`         |
| Purpose    | Immediate detection when SDK signals stream death (vs waiting for watchdog poll) |
| Note       | With `maxRetries: 0`, the SDK fires `onerror` when reconnection is exhausted |

#### First Keepalive Deadline
| Property   | Value                                       |
| ---------- | ------------------------------------------- |
| Type       | `setTimeout` (one-shot)                       |
| Timeout    | `firstKeepaliveDeadline` (default: 60,000ms)  |
| Condition  | Only fires when `sseVerified === false`       |
| Action     | `reconnectWithReason("sse_never_opened")`     |
| Cancelled  | When first keepalive received (sets `sseVerified = true`) |
| Started    | On transition to `connected`                  |
| Stopped    | On `close()`, `teardown()`, or `cancelFirstKeepaliveDeadline()` |

#### Reconnect Backoff
| Property   | Value                                                         |
| ---------- | ------------------------------------------------------------- |
| Type       | `setTimeout` (one-shot, rescheduled on each failure)            |
| Base delay | `reconnectDelay` (default: 5,000ms)                             |
| Formula    | `min(baseDelay * 2^consecutiveSseFailures, 60000)`              |
| Progression | 5s → 10s → 20s → 40s → 60s → 60s...                         |
| Reset      | `consecutiveSseFailures = 0` when first keepalive received      |
| Note       | Only SSE-related failures (`sse_watchdog`, `sse_never_opened`) increment the counter. `heartbeat_failed` and `session_invalid` do not. |
| Started    | On transition to `disconnected` after a failed connect/reconnect |
| Cancelled  | On `close()` or `cancelReconnect()`                               |

### 4.3 Adapter Timers

#### Rate Limiter
| Property   | Value                                |
| ---------- | ------------------------------------ |
| Type       | Timestamp comparison (not a timer)   |
| Cooldown   | 30,000ms (30s)                       |
| Scope      | Push-to-LLM prompts only             |
| Action     | If `Date.now() - lastPromptTime < 30000`, downgrade actionable event to `injectContext()` instead of `promptLLM()` |
| Reset      | Updated to `Date.now()` on each successful `promptLLM()` call |

#### Init Defer
| Property   | Value                                  |
| ---------- | -------------------------------------- |
| Type       | `setTimeout` (one-shot)                  |
| Delay      | 3,000ms (3s)                           |
| Purpose    | Defer network I/O to avoid blocking OpenCode plugin initialization |
| Action     | Connect to Hub, start proxy, register with OpenCode |
| Started    | On plugin load                         |

## 5. Cross-Component Timer Interaction

### Keepalive Flow

```
Hub Timer                          ConnectionManager
(every 30s)                        (continuous)
    │                                   │
    │ sendLoggingMessage               │
    │ logger="keepalive"               │
    │──────────────────────────────────►│
    │                                   │ updates lastKeepaliveAt
    │                                   │ sets sseVerified=true (first time)
    │                                   │
    │                                   │ SSE Watchdog (every 30s)
    │                                   │ checks: gap > 90s?
    │                                   │ → no: continue
    │                                   │ → yes: reconnect
```

### Session Lifecycle Interaction

```
Hub Reaper                    ConnectionManager
(every 60s)                   (continuous)
    │                              │
    │ Session inactive > 3min?     │ Heartbeat (every 30s)
    │ → prune session              │ → listTools() keeps session alive
    │                              │ → Hub updates sessionLastActivity
    │                              │
    │ Orphan > 60s?                │ register_role on connect
    │ → prune unregistered         │ → moves session out of orphan state
```

The heartbeat's `listTools()` call serves a dual purpose:
1. **Client-side:** Verifies the Hub is reachable via POST
2. **Server-side:** Updates `sessionLastActivity`, preventing the session reaper from pruning the session

### Notification Replay Timing

```
ConnectionManager                Hub
    │                              │
    │ createConnection()           │
    │ ─────────────────────────────► POST /mcp (initialize)
    │ ◄───────────────────────────── session created
    │                              │
    │ register_role                │
    │ ─────────────────────────────► POST /mcp (register_role)
    │ ◄───────────────────────────── registered
    │                              │
    │ (SDK opens SSE GET)          │
    │ ─────────────────────────────► GET /mcp (Last-Event-ID: N)
    │                              │ sseActive=true
    │                              │ 
    │                              │ setTimeout(2000ms)
    │                              │ ...
    │                              │ listSince(N, role)
    │ ◄───────────────────────────── replay notification N+1
    │ ◄───────────────────────────── replay notification N+2
    │ ◄───────────────────────────── ...
    │                              │
    │                              │ keepalive (next 30s tick)
    │ ◄───────────────────────────── logger="keepalive"
    │ sseVerified=true             │
```
