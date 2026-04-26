# Agentic Network: Configuration Reference

## Hub Configuration

All Hub configuration is via environment variables. There is no config file.

| Variable           | Type     | Default                   | Required | Purpose                                                     |
| ------------------ | -------- | ------------------------- | -------- | ----------------------------------------------------------- |
| `PORT`               | `number`   | `8080`                      | No       | HTTP listen port (set automatically by Cloud Run)           |
| `HUB_API_TOKEN`      | `string`   | `""` (auth disabled)        | No       | Bearer token for authenticating `/mcp` requests               |
| `STORAGE_BACKEND`    | `string`   | `"memory"`                  | No       | Storage backend: `"gcs"` for production, `"memory"` for testing |
| `GCS_BUCKET`         | `string`   | `"ois-relay-hub-state"`     | No       | GCS bucket name (only used when `STORAGE_BACKEND=gcs`)        |
| `ARCHITECT_WEBHOOK_URL` | `string` | `""` (disabled)            | No       | Fallback webhook URL when no SSE sessions available         |

### Hardcoded Constants

These values are not configurable and are defined in source code:

| Constant                     | Value        | Location              | Purpose                                       |
| ---------------------------- | ------------ | --------------------- | --------------------------------------------- |
| `SSE_KEEPALIVE_INTERVAL`       | `30,000ms`     | `index.ts:1395`         | Interval between keepalive pings              |
| Session TTL                  | `180,000ms`    | `index.ts:1436`         | Max inactivity before session is pruned       |
| Orphan TTL                   | `60,000ms`     | `index.ts:1443`         | Max time for unregistered session before prune |
| Session Reaper interval      | `60,000ms`     | `index.ts:1470`         | How often the reaper sweeps                   |
| `NOTIFICATION_MAX_AGE`         | `86,400,000ms` | `index.ts:1422`         | Notification TTL (24 hours)                   |
| `NOTIFICATION_CLEANUP_INTERVAL` | `3,600,000ms` | `index.ts:1423`        | Notification cleanup sweep interval (1 hour)  |
| Notification replay delay    | `2,000ms`      | `index.ts:1592`         | Delay before replaying notifications on SSE open |
| Notification ID padding      | 6 digits     | GCS state module      | Zero-padded for lexicographic ordering        |

## Hub Connection Package Configuration

Configuration is split across two layers. Wire-level timers are passed via `TransportConfig` to `new McpTransport(...)` (or into `McpAgentClient` as `options.transportConfig`). Session-level config (role, enriched handshake) is passed via `AgentClientConfig` to `new McpAgentClient(...)`.

| Parameter                | Type     | Default      | Required | Purpose                                              |
| ------------------------ | -------- | ------------ | -------- | ---------------------------------------------------- |
| `url`                      | `string`   | —            | Yes      | Hub endpoint URL (e.g., `https://hub.../mcp`)          |
| `token`                    | `string`   | —            | Yes      | Bearer authentication token                          |
| `role`                     | `string`   | —            | Yes      | Role to register: `"engineer"` or `"architect"`          |
| `heartbeatInterval`        | `number`   | `30,000ms`     | No       | POST heartbeat interval (`listTools()` health check)   |
| `reconnectDelay`           | `number`   | `5,000ms`      | No       | Base delay before reconnect (subject to backoff)     |
| `sseKeepaliveTimeout`      | `number`   | `90,000ms`     | No       | Max gap between keepalives before SSE declared dead  |
| `firstKeepaliveDeadline`   | `number`   | `60,000ms`     | No       | Max time to wait for first keepalive after connect   |
| `sseWatchdogInterval`      | `number`   | `30,000ms`     | No       | How often the watchdog polls for keepalive gaps      |

### Hardcoded Constants

| Constant                  | Value     | Purpose                                      |
| ------------------------- | --------- | -------------------------------------------- |
| Backoff multiplier cap    | `12`        | Max multiplier (12 * 5000 = 60000ms cap)     |
| Backoff max delay         | `60,000ms`  | Absolute cap on reconnect delay              |
| Teardown settle delay     | `1,000ms`   | Post-close settle time for zombie SSE loops  |

**MCP SDK reconnection options (passed to `StreamableHTTPClientTransport`):**

| Option                        | Value      | Purpose                                  |
| ----------------------------- | ---------- | ---------------------------------------- |
| `initialReconnectionDelay`      | `1,000ms`    | First retry delay (unused — maxRetries=0)|
| `maxReconnectionDelay`          | `30,000ms`   | Cap on retry delay (unused)              |
| `reconnectionDelayGrowFactor`   | `1.5`        | Multiplier per retry (unused)            |
| `maxRetries`                    | `0`          | **CRITICAL: Disabled.** ConnectionManager owns SSE lifecycle. |

**Why `maxRetries: 0`:** The SDK's internal reconnection opens a new SSE GET stream using the same session ID, but the notification handler remains wired to the original transport. This creates a split-brain where keepalives arrive on the old stream but hub-event notifications go to the new one. Disabling SDK reconnection and handling all lifecycle at the `McpTransport` level (under `McpAgentClient` ownership) eliminates this failure class.

### Session Invalidation Patterns

Error strings matched (case-insensitive) to detect Hub session rejection:

```
"No valid session ID"
"Bad Request"
"Session not found"
"invalid session"
```

When any of these appear in a tool call error, the ConnectionManager triggers `reconnectWithReason("session_invalid")` and retries the tool call once on the new session.

## Adapter (Plugin) Configuration

### Config File

**Path:** `.opencode/adapter-config.json`

```json
{
  "hubUrl": "https://mcp-relay-hub-5muxctm3ta-ts.a.run.app/mcp",
  "hubToken": "<bearer-token>",
  "autoPrompt": true,
  "role": "engineer"
}
```

### Environment Variable Overrides

Environment variables override config file values:

| Variable                   | Config Key    | Default                                           | Purpose                    |
| -------------------------- | ------------- | ------------------------------------------------- | -------------------------- |
| `MCP_HUB_URL`               | `hubUrl`        | `https://mcp-relay-hub-5muxctm3ta-ts.a.run.app/mcp` | Remote Hub endpoint        |
| `HUB_API_TOKEN`             | `hubToken`      | `""`                                                | Bearer authentication token |
| `HUB_PLUGIN_AUTO_PROMPT`    | `autoPrompt`    | `true`                                              | Kill switch for Push-to-LLM |
| `HUB_PLUGIN_ROLE`           | `role`          | `"engineer"`                                        | Role to register on Hub    |

### Hardcoded Constants

| Constant                  | Value        | Location                    | Purpose                                    |
| ------------------------- | ------------ | --------------------------- | ------------------------------------------ |
| `RATE_LIMIT_MS`             | `30,000ms`     | `src/shim.ts`                 | Cooldown between `promptLLM()` calls         |
| `MAX_PROCESSED_CACHE`       | `100`          | `src/shim.ts`                 | LRU dedup cache size                       |
| Init defer delay          | `3,000ms`      | `src/shim.ts`                 | Delay before network I/O on plugin load    |
| Bun idle timeout          | `0` (disabled) | `src/shim.ts`                 | Prevents Bun from closing SSE streams      |
| Proxy bind address        | `127.0.0.1`    | `src/shim.ts`                 | Localhost only — no external access        |
| Proxy port                | `0` (random)   | `src/shim.ts`                 | OS-assigned port                           |

### Persistence Files

| File                           | Purpose                                    | Format                                   |
| ------------------------------ | ------------------------------------------ | ---------------------------------------- |
| `.opencode/hub-plugin-state.json` | Persists `lastSeenNotificationId` across restarts | `{ "lastSeenNotificationId": <number> }`   |
| `.opencode/hub-plugin.log`       | Plugin diagnostic log                      | Timestamped line-per-entry               |
| `.opencode/adapter-config.json`      | Plugin configuration                       | JSON object                              |

## Timer Tuning Guide

### Relationship Constraints

Several timers have implicit relationships that must be maintained for correct operation:

```
Hub keepalive interval (30s)
    × 3 = ConnectionManager SSE watchdog threshold (90s)
    × 2 = ConnectionManager first-keepalive deadline (60s)

Hub session TTL (180s)
    > ConnectionManager heartbeat interval (30s)
    (heartbeat keeps session alive by generating activity)

Hub session reaper interval (60s)
    < Hub session TTL (180s)
    (reaper must sweep more frequently than the TTL)

Hub notification replay delay (2s)
    < Hub keepalive interval (30s)
    (replay must complete before the first keepalive, so the
     ConnectionManager can verify SSE with the keepalive)
```

### Safe Tuning Ranges

| Parameter                 | Current | Min    | Max    | Constraint                                     |
| ------------------------- | ------- | ------ | ------ | ---------------------------------------------- |
| Hub keepalive interval    | 30s     | 10s    | 60s    | Must be < session TTL / 3                      |
| Session TTL               | 180s    | 90s    | 600s   | Must be > 3 × heartbeat interval               |
| SSE watchdog threshold    | 90s     | 60s    | 180s   | Must be >= 2 × Hub keepalive interval          |
| First-keepalive deadline  | 60s     | 30s    | 120s   | Must be > Hub keepalive interval               |
| Heartbeat interval        | 30s     | 10s    | 60s    | Must be < session TTL / 3                      |
| Base reconnect delay      | 5s      | 1s     | 30s    | Lower = faster recovery, higher = less hammering |
| Rate limiter cooldown     | 30s     | 5s     | 120s   | Lower = more responsive, higher = less LLM spam |

## Cloud Run Deployment Requirements

These are platform-level configurations that MUST be set for the network to function correctly. They cannot be set in Dockerfiles — they are Cloud Run runtime parameters.

| Parameter        | Service         | Value  | Reason                                                            |
| ---------------- | --------------- | ------ | ----------------------------------------------------------------- |
| `--timeout`        | Hub             | `3600`   | SSE GET is a long-lived request. Default 300s kills it every 5 min. |
| `--timeout`        | Architect       | `3600`   | Same — Architect's SSE stream to Hub is long-lived.                |
| `--min-instances`  | Hub             | `1`      | Prevents cold start on first request. Hub holds in-memory state.  |
| `--max-instances`  | Hub             | `1`      | In-memory session maps are not shared. Multiple instances cause split-brain. |

**Deploy command template:**
```bash
gcloud run deploy <service> --source . --region <region> --min-instances 1 --timeout=3600 --quiet
```

**Note on `--max-instances`:** Until a shared backplane (Redis Pub/Sub or similar) is introduced for session state, the Hub MUST run as a single instance. If Cloud Run scales to 2+ instances, an agent connected to Instance A will not receive notifications from tools executed on Instance B.
