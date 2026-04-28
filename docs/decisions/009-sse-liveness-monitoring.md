# ADR-009: SSE Liveness Monitoring and Dual-Channel Heartbeat

**Date:** 2026-04-12
**Status:** Accepted
**Threads:** thread-33, thread-36, thread-37, thread-38, thread-39, thread-40
**Supersedes:** ADR-007 (Stability Phase — closes the SSE liveness gap)
**Complements:** ADR-005 (Persist-First Notifications), ADR-008 (ConnectionManager)

## Decision

Implement a comprehensive SSE reliability model in `McpConnectionManager` that:
1. Independently monitors both HTTP POST and SSE GET channels (three-layer liveness)
2. Disables MCP SDK internal SSE reconnection (`maxRetries: 0`) — all lifecycle management owned by ConnectionManager
3. Detects transport-level stream death via `onclose`/`onerror` handlers
4. Classifies all reconnections by reason with exponential backoff
5. Enforces SSE singleton per session on the Hub (Fix A)

## Context

On 2026-04-12, extensive debugging revealed a chain of four interconnected issues causing silent notification loss:

### Issue 1: Silent SSE Death (Initial Discovery)
The Engineer Plugin's SSE stream silently died after a restart. The MCP handshake (HTTP POST) succeeded, `listTools()` heartbeat continued passing, but zero keepalive messages arrived on the SSE stream and notifications were never delivered.

**Root cause:** MCP uses two independent HTTP connections (POST for request/response, GET for SSE). The heartbeat only validated POST. Keepalives on the SSE stream were silently discarded.

### Issue 2: Cloud Run 300s Request Timeout (Root Cause)
Cloud Run's default request timeout of 300 seconds was killing the SSE GET stream every 5 minutes. The MCP SDK's internal reconnection (`maxRetries: Infinity`) reopened the stream, but the new stream received notifications while the old stream (still wired to our notification handler) only received keepalives.

**Root cause:** The SSE GET is a long-lived HTTP request. Cloud Run terminates requests exceeding the timeout.

**Fix:** Increased Cloud Run request timeout to 3600s on both Hub and Architect services.

### Issue 3: SDK Internal SSE Reconnection (Split-Brain)
With `maxRetries: Infinity`, the MCP SDK's `StreamableHTTPClientTransport` internally cycled the SSE connection every 5 minutes (matching the Cloud Run timeout). The new SSE stream received notifications but our `client.setNotificationHandler()` remained wired to the original transport, creating a split-brain where keepalives arrived but hub-events were lost.

**Root cause:** The SDK opens a new GET request using the same session ID, but the notification handler is bound to the Client object's original transport connection.

**Fix:** Set `maxRetries: 0` — disables SDK internal reconnection entirely. All lifecycle management elevated to `McpConnectionManager`.

### Issue 4: Hub Duplicate SSE Streams (Fix A)
The Hub's GET handler accepted multiple SSE GET requests for the same session without closing previous streams, enabling split-brain state.

**Fix:** SSE singleton enforcement — when a new GET arrives for a session with an existing active stream, close the old stream before registering the new one. Uses a `sseReplacingInProgress` set to prevent the `res.on("close")` handler from incorrectly marking the session as inactive.

## Technical Design

### Three-Layer Liveness Model

| Layer                        | Channel  | Detects                               | Mechanism                                               | Threshold    |
| ---------------------------- | -------- | ------------------------------------- | ------------------------------------------------------- | ------------ |
| **POST Heartbeat**           | HTTP POST | Hub unreachable, session expired     | `listTools()` every `heartbeatInterval`                   | 1 failure    |
| **SSE Watchdog**             | SSE GET   | Silent stream death mid-session      | `lastKeepaliveAt` gap check every `sseWatchdogInterval`   | `sseKeepaliveTimeout` |
| **First Keepalive Deadline** | SSE GET   | SSE stream never opened after connect | One-shot timer started on `connected` transition         | `firstKeepaliveDeadline` |

### Transport Event Handlers

With `maxRetries: 0`, the SDK fires `onerror` when reconnection is exhausted and `onclose` when the transport closes. Both trigger immediate reconnection:

```typescript
this.transport.onclose = () => {
  if (this._state === "connected") {
    this.reconnectWithReason("sse_watchdog");
  }
};
this.transport.onerror = (err: Error) => {
  if (this._state === "connected") {
    this.reconnectWithReason("sse_watchdog");
  }
};
```

This provides immediate detection (vs waiting for the watchdog's polling interval) when the SSE stream dies with a visible error.

### SDK Transport Configuration

```typescript
new StreamableHTTPClientTransport(url, {
  requestInit: { headers },
  reconnectionOptions: {
    initialReconnectionDelay: 1000,
    maxReconnectionDelay: 30000,
    reconnectionDelayGrowFactor: 1.5,
    maxRetries: 0,  // CRITICAL: Disabled — ConnectionManager owns lifecycle
  },
});
```

### State Fields

```typescript
private lastKeepaliveAt: number = 0;        // Updated on every keepalive
private sseVerified: boolean = false;        // True after first keepalive
private consecutiveSseFailures: number = 0;  // Drives exponential backoff
private watchdogTickCount: number = 0;       // Diagnostic: watchdog tick counter
private lastWatchdogTick: number = 0;        // Diagnostic: suspension detection
private readonly instanceId: string;         // Diagnostic: silent restart detection
private pendingReason?: ReconnectReason;     // Propagated through transition()
```

### ReconnectReason Classification

```typescript
type ReconnectReason =
  | "heartbeat_failed"   // POST channel dead
  | "sse_watchdog"       // SSE stream died mid-session (or transport.onclose/onerror)
  | "sse_never_opened"   // SSE never established after connect
  | "session_invalid";   // Hub rejected session
```

### Configurable Parameters

```typescript
interface ConnectionConfig {
  heartbeatInterval?: number;        // Default: 30,000ms
  reconnectDelay?: number;           // Default: 5,000ms
  sseKeepaliveTimeout?: number;      // Default: 90,000ms
  firstKeepaliveDeadline?: number;   // Default: 60,000ms
  sseWatchdogInterval?: number;      // Default: 30,000ms
}
```

### Close() Ordering

`close()` transitions to `disconnected` BEFORE calling `teardown()`. This prevents `transport.onclose` (fired during teardown) from triggering a reconnection during intentional shutdown.

### cleanupSession Re-Entry Guard

On the Hub, `cleanupSession()` uses a `cleaningUp` Set to prevent stack overflow. `transport.close()` fires `onclose` which calls `cleanupSession` — the guard breaks the recursion.

### Hub SSE Singleton Enforcement (Fix A)

```typescript
// In GET /mcp handler:
const existingRes = activeSseResponses.get(sessionId);
if (existingRes) {
  sseReplacingInProgress.add(sessionId);
  try { existingRes.end(); } catch {}
  sseReplacingInProgress.delete(sessionId);
}
activeSseResponses.set(sessionId, res);

res.on("close", () => {
  if (sseReplacingInProgress.has(sessionId)) return; // Don't mark inactive during replacement
  sseActive.set(sessionId, false);
  activeSseResponses.delete(sessionId);
});
```

### Diagnostic Enhancements

- **Instance ID:** 8-char UUID per `McpConnectionManager` instance, logged on creation and every watchdog tick. Detects silent plugin restarts.
- **Time-delta check:** Measures actual interval between watchdog ticks vs expected. Logs `SUSPENSION DETECTED` if delta exceeds expected + 5s.
- **Watchdog heartbeat logging:** Every 5th tick (~2.5 min) logs `SSE watchdog alive [tick N, inst X]: lastKeepalive=Xs ago, sseVerified=T/F, delta=Xs`.
- **Notification handler logging:** Logs every non-keepalive notification received and dispatch count.
- **GlobalThis timer refs:** Heartbeat and watchdog timers attached to `globalThis` to prevent Bun runtime GC.

## What It Replaced

- Keepalive messages silently discarded (no liveness signal)
- Single-channel heartbeat (POST only, blind to SSE death)
- SDK internal SSE reconnection causing split-brain
- Hub allowing duplicate SSE streams per session
- No classification of reconnection reasons
- Fixed 5s reconnect delay regardless of failure pattern
- `close()` after teardown (caused cascading reconnection)
- No re-entry guard on session cleanup (stack overflow)

## Consequences

- **G1: "Connected" means SSE is proven alive** — `sseVerified` flag confirms at least one keepalive received
- **G2: SSE-never-opened detected in `firstKeepaliveDeadline`** — covers the exact failure we experienced
- **G3: Silent SSE death detected in `sseKeepaliveTimeout`** — 3x the Hub's keepalive interval
- **G4: Persistent failures back off** — prevents hammering the Hub on systematic SSE issues
- **G5: Failures are observable** — consumers know why reconnections happen via `ReconnectReason`
- **No SDK split-brain** — `maxRetries: 0` + Hub singleton enforcement eliminates the failure class entirely
- **Backward compatible** — `StateChangeHandler` reason parameter is optional; existing consumers unaffected
- **Shared across all agents** — Architect and Plugin both run the same `@apnex/hub-connection` v1.1.0
- **Testable** — `sseWatchdogInterval` configurable for accelerated testing (1s in tests vs 30s in production)

## Deployment Requirements

- **Cloud Run request timeout:** Must be set to 3600s on both Hub and Architect services. Add `--timeout=3600` to all `gcloud run deploy` commands. The default 300s kills SSE streams every 5 minutes.
- **Cloud Run max-instances:** Must remain at 1 for the Hub until a Pub/Sub backplane is introduced. In-memory session maps are not shared across instances.

## Threshold Rationale

- **90s watchdog:** Hub emits keepalives every 30s. 90s tolerates up to 2 missed keepalives (network jitter, Hub redeploy cold start ~10-15s) before declaring death.
- **60s first-keepalive deadline:** After MCP handshake, the Hub should send its first keepalive within 30s. 60s gives 2x margin.
- **60s backoff cap:** Prevents unbounded delay while allowing the system to settle after cascading failures.
- **30s watchdog interval:** Matches the Hub's keepalive interval. Configurable via `sseWatchdogInterval` for testing.

## Verified By

101 automated tests across 13 files in `packages/hub-connection/test/` running against the real Hub networking code (`hub-networking.ts`) with in-memory stores. Tests cover state machine transitions, SSE watchdog, first-keepalive deadline, exponential backoff, failure recovery, notification delivery, persist-first race conditions, fault injection, memory leak validation, session push notifications, zombie heartbeat/reaper, client lifecycle (orphan storm), UniversalClientAdapter singleton, deferred backlog, and document operations. See `docs/network/06-test-specification.md` for the full inventory.
