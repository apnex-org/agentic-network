# Agentic Network: Safety & Resilience Guarantees

## Connection Guarantees (G1-G5)

These are the invariants enforced by the L4/L7 split in `@apnex/network-adapter`. G1–G4 live in the L4 transport (`McpTransport`) which owns the wire, SSE watchdog, and heartbeat POST. G5 lives in the L7 session client (`McpAgentClient`) which owns the session FSM and propagates `SessionReconnectReason` to shim callbacks. See `src/transport.ts` and `src/agent-client.ts` for the contracts.

### G1: If connected, SSE is proven alive

**Mechanism:** The `sseVerified` flag is set to `true` only when the first keepalive message is received on the SSE stream. Until this flag is set, the connection is technically `connected` (MCP handshake passed) but SSE is unproven.

**Implication:** Consumers can check `isConnected` for tool execution (which uses POST), but should not assume notifications are flowing until the ConnectionManager logs `SSE stream verified`.

**Current limitation:** `isConnected` returns `true` as soon as the MCP handshake completes, before SSE is verified. A future enhancement could expose `sseVerified` as a public property.

### G2: If SSE never opens, detected within firstKeepaliveDeadline

**Mechanism:** A 60-second one-shot timer starts when the connection transitions to `connected`. If no keepalive arrives within this window, the SSE GET stream is assumed to have never opened, and reconnection is triggered with reason `sse_never_opened`.

**Why this matters:** The MCP handshake (HTTP POST) and the SSE stream (HTTP GET) are independent connections. The handshake can succeed while the SSE connection fails silently — for example, if an intermediate proxy or load balancer blocks long-lived GET requests.

**Threshold rationale:** The Hub emits keepalives every 30s. A 60s deadline gives 2x margin for the first keepalive to arrive. Shorter risks false positives on slow connections; longer wastes time when SSE genuinely fails.

### G3: If SSE dies mid-stream, detected within sseKeepaliveTimeout

**Mechanism:** An interval timer (every 30s) checks whether `Date.now() - lastKeepaliveAt` exceeds the 90-second threshold. This only activates after `sseVerified === true` — the first-keepalive deadline handles the pre-verification case.

**Why this matters:** TCP connections can half-close silently. Intermediate infrastructure (NAT gateways, load balancers, Cloud Run) can drop long-lived connections without sending a FIN/RST. The MCP SDK's transport-level reconnection only triggers on visible errors, not silent drops.

**Threshold rationale:** 90s = 3x the Hub's 30s keepalive interval. This tolerates up to 2 missed keepalives (network jitter, Hub garbage collection pauses, or a brief Hub redeploy cold start of ~10-15s) before declaring death.

### G4: Consecutive SSE failures trigger exponential backoff

**Mechanism:** The `consecutiveSseFailures` counter increments on every `sse_watchdog` or `sse_never_opened` reconnection. The reconnect delay is calculated as `min(5000 * 2^consecutiveSseFailures, 60000)`, producing the sequence: 5s, 10s, 20s, 40s, 60s, 60s...

**Reset:** The counter resets to 0 when the first keepalive is received after a reconnect, proving SSE is actually working again.

**Why this matters:** If the SSE stream is systematically broken (e.g., a firewall rule blocking SSE, or a bug in the Hub's keepalive), the client should not hammer the Hub with rapid reconnections. Backoff gives the infrastructure time to recover and limits resource consumption.

**Scope:** Only SSE-specific failures increment the counter. `heartbeat_failed` and `session_invalid` do not — those are different failure classes with different recovery characteristics.

### G5: All reconnections carry a classified SessionReconnectReason

**Mechanism:** Every path that re-enters `reconnecting` at the L7 layer is tagged with a `SessionReconnectReason`. `McpAgentClient` forwards the reason to `AgentClientCallbacks.onStateChange(state, previous, reason?)`. The L4 transport emits its own narrower `WireReconnectCause` to `WireEvent` subscribers; the session client lifts wire causes into session reasons at the L4→L7 seam.

**Four reasons:**

| Reason             | Trigger                                        | Recovery action                     |
| ------------------ | ---------------------------------------------- | ----------------------------------- |
| `heartbeat_failed`   | `listTools()` POST threw an error                | Teardown + reconnect                |
| `sse_watchdog`       | Keepalive gap exceeded 90s                     | Teardown + reconnect + SSE backoff  |
| `sse_never_opened`   | No keepalive within 60s of connect             | Teardown + reconnect + SSE backoff  |
| `session_invalid`    | Hub rejected request with session-invalid error | Teardown + reconnect + retry tool   |

**Why this matters:** Different failure modes have different root causes and may warrant different consumer-level responses. A `session_invalid` means the Hub restarted — the consumer might want to re-fetch state. An `sse_never_opened` might indicate a systematic infrastructure issue — the consumer might want to alert an operator.

## Safety Mechanisms (12 total)

### Hub Safety

#### S1: Bearer Token Authentication
- **What:** All `/mcp` requests validated against `HUB_API_TOKEN`
- **Failure mode addressed:** Unauthorized access to Hub tools and notifications
- **Behavior:** HTTP 401 with JSON-RPC error `{ code: -32001 }` on mismatch
- **Bypass:** If `HUB_API_TOKEN` is not set, auth is disabled (development mode)

#### S2: Session TTL Reaper
- **What:** Periodic sweep (60s) prunes sessions inactive for >3 minutes
- **Failure mode addressed:** Resource leaks from abandoned sessions (agent crash, network drop without clean close)
- **Behavior:** `transport.close()` + `markDisconnected()` + delete from all maps
- **Secondary rule:** Unregistered sessions (role = "unknown") pruned after 60s — catches orphans from failed handshakes

#### S3: Notification Persistence (Persist-First)
- **What:** Every notification written to GCS before any delivery attempt
- **Failure mode addressed:** Notification loss if SSE delivery fails (silent stream death, Hub crash between emit and delivery)
- **Guarantee:** Combined with Last-Event-ID replay, ensures zero notification loss across any disconnection scenario
- **Trade-off:** Adds GCS write latency (~50-100ms) to every notification. Acceptable for our event frequency.

#### S4: Notification Replay
- **What:** On SSE reconnection, Hub replays all notifications with ID > `Last-Event-ID`
- **Failure mode addressed:** Notifications emitted while agent was disconnected
- **Delay:** 2-second delay after SSE open to let the stream establish and role register
- **Ordering:** Notifications replayed in monotonic ID order (lexicographic file listing in GCS)

#### S5: Notification TTL
- **What:** Notifications older than 24 hours are deleted hourly
- **Failure mode addressed:** Unbounded GCS storage growth
- **Trade-off:** If an agent is disconnected for >24 hours, it will miss notifications from that period. Acceptable — agents should not be offline that long.

#### S6: Graceful Shutdown
- **What:** `SIGINT` handler closes all transports and exits cleanly
- **Failure mode addressed:** Zombie SSE streams on Hub restart
- **Behavior:** Iterates `transports` map, calls `transport.close()` on each, clears maps, `process.exit(0)`

### Transport / AgentClient Safety

#### S7: Atomic Teardown
- **What:** On reconnect, null references first, then best-effort close, then 1s settle
- **Failure mode addressed:** In-flight tool calls or notification handlers using dead client/transport references
- **Sequence:** (1) `client = null; transport = null` (2) `oldClient.close()` in try/catch (3) `setTimeout(1000)` settle
- **Why null-first:** Any in-flight `callToolOnClient()` or notification handler will immediately fail with "No client" rather than hanging on a dead connection

#### S8: Session Invalidation Detection
- **What:** Pattern matching on error strings from Hub responses
- **Patterns:** `"No valid session ID"`, `"Bad Request"`, `"Session not found"`, `"invalid session"`
- **Failure mode addressed:** Hub redeploy or session expiry during active tool call
- **Recovery:** `reconnectWithReason("session_invalid")` + retry the failed tool call once on the new connection

#### S9: Transition Guards
- **What:** `connect()` and `reconnect()` check state before acting
- **Failure mode addressed:** Concurrent reconnection attempts from multiple triggers (e.g., heartbeat and watchdog fire simultaneously)
- **Behavior:** If state is `connecting` or `reconnecting`, the call returns immediately with a log warning

### Adapter Safety

#### S10: Last-Event-ID Persistence
- **What:** `lastSeenNotificationId` persisted to disk (`hub-plugin-state.json`)
- **Failure mode addressed:** Plugin restart causes re-processing of old notifications
- **Behavior:** On each notification, if `notifId <= lastSeenNotificationId`, skip. Updated monotonically. Survives process restarts.
- **Interaction with S4:** When the ConnectionManager reconnects, the MCP SDK sends `Last-Event-ID` in the SSE GET request. The Hub replays notifications > that ID. The Plugin's persisted counter acts as a second-layer dedup on top of the SDK's replay.

#### S11: Notification Dedup (Idempotency)
- **What:** Hash-based event dedup using `event:entityId:timestamp` as key
- **Failure mode addressed:** Duplicate notifications from Hub replay or concurrent SSE streams
- **Cache:** LRU-style set, capped at 100 entries
- **Interaction with S10:** S10 filters by monotonic ID (coarse), S11 filters by content hash (fine). Together they prevent any duplicate from reaching the LLM.

#### S12: Push-to-LLM Rate Limiter
- **What:** 30-second cooldown between `promptLLM()` calls
- **Failure mode addressed:** Notification floods overwhelming the LLM context
- **Behavior:** If rate-limited, actionable events downgrade to `injectContext()` (silent system message) instead of `promptLLM()` (user-visible prompt that triggers response)
- **Kill switch:** `autoPrompt: false` in config disables all Push-to-LLM entirely. Toast notifications still shown.
- **Session-busy queueing:** If the LLM is currently running, notifications are queued in memory and flushed when the session becomes idle. Combined queue messages reduce multiple notifications into a single numbered list.

## Failure Mode Matrix

This matrix maps every known failure mode to the safety mechanism(s) that handle it:

| Failure Mode                            | Safety Mechanisms     | Detection Time   | Recovery                                    |
| --------------------------------------- | --------------------- | ---------------- | ------------------------------------------- |
| Agent crashes without close             | S2 (reaper)           | 60s-180s         | Session pruned, agent reconnects on restart |
| SSE stream never opens                  | G2 (deadline)         | 60s              | Reconnect with `sse_never_opened`             |
| SSE stream dies silently                | G3 (watchdog)         | 90s              | Reconnect with `sse_watchdog`                 |
| Hub redeploys                           | S8 (session invalid)  | On next tool call | Reconnect with `session_invalid` + retry      |
| Hub crashes                             | S7 (heartbeat)        | 30s              | Reconnect with `heartbeat_failed`             |
| Network partition (both channels)       | S7 + G3               | 30-90s           | Reconnect, replay via S3+S4                 |
| Network partition (SSE only)            | G3 (watchdog)         | 90s              | Reconnect with `sse_watchdog`                 |
| Notification emitted during disconnect  | S3 (persist) + S4     | On reconnect     | Replay via Last-Event-ID                    |
| Duplicate notification delivery         | S10 + S11             | Immediate        | Skip (ID filter + hash dedup)               |
| Plugin restarts                         | S10 (persisted ID)    | Immediate        | Resume from persisted Last-Event-ID         |
| Unauthorized access                     | S1 (auth)             | Immediate        | HTTP 401 rejection                          |
| Orphan session (failed handshake)       | S2 (orphan rule)      | 60s              | Pruned from maps                            |
| Notification flood                      | S12 (rate limiter)    | Immediate        | Downgrade to context injection              |
| LLM busy during notification            | S12 (session queue)   | On idle          | Queue + flush as combined message           |
| SSE repeatedly fails to establish       | G4 (backoff)          | N/A              | Exponential delay: 5s→60s cap               |
| GCS storage growth from notifications   | S5 (TTL)              | 1 hour sweep     | Delete notifications >24h old               |
| Dead client/transport reference         | S7 (null-first)       | Immediate        | Fail-fast with "No client" error            |
| Concurrent reconnection attempts        | S9 (guards)           | Immediate        | Second attempt blocked, logged              |
| SDK internal SSE reconnection           | maxRetries=0          | N/A              | Disabled entirely — McpTransport owns wire lifecycle |
| Hub duplicate SSE streams               | SSE singleton (Fix A) | Immediate        | Old stream closed before new one registered |
| Cloud Run request timeout kills SSE     | --timeout=3600        | N/A              | Prevented — 1 hour timeout instead of 5 min |
| close() triggers cascading reconnect    | close() ordering      | Immediate        | Transition to disconnected BEFORE teardown  |
| cleanupSession stack overflow           | Re-entry guard        | Immediate        | cleaningUp Set prevents recursion           |
| Concurrent reconnection attempts        | S9 (guards)           | Immediate        | Second attempt blocked, logged              |

## Resilience Properties

### What the network guarantees

1. **Eventual connectivity:** Given a reachable Hub, any agent will eventually establish a fully verified connection (MCP handshake + SSE stream) with bounded retry delay.

2. **Notification delivery:** Any notification persisted to GCS will eventually be delivered to all target-role agents that reconnect within the 24-hour TTL window.

3. **No duplicate processing:** The two-layer dedup (monotonic ID + content hash) prevents any notification from being processed twice by the same agent.

4. **Bounded resource usage:** Session reaper prevents unbounded session accumulation. Notification TTL prevents unbounded GCS growth. Rate limiter prevents unbounded LLM prompts.

5. **Observable failures:** Every reconnection event carries a classified reason, enabling monitoring and diagnosis without source code inspection.

### What the network does NOT guarantee

1. **Real-time delivery:** Notifications may be delayed up to 90s (watchdog threshold) + reconnect time if the SSE stream dies.

2. **Ordering across agents:** Notifications are delivered per-agent in monotonic ID order, but two agents may process the same notification at different times.

3. **Transactional consistency:** GCS operations across different entity stores are not atomic. A tool that writes to both the task store and notification store could partially fail.

4. **Multi-instance Hub safety:** The Hub assumes single-writer semantics for counters and state files. Running multiple Hub instances concurrently may cause race conditions on counter increments.

5. **Long disconnection recovery:** Agents disconnected for >24 hours will miss notifications beyond the TTL window.
