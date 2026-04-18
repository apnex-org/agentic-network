# Agentic Network: Protocol Specification

## Transport

All agent-Hub communication uses **MCP Streamable HTTP** — a protocol defined by the Model Context Protocol specification. It multiplexes request/response and event streaming over a single HTTP endpoint using content negotiation.

### Channels

| Channel             | HTTP Method | Content-Type              | Purpose                                   | Lifecycle         |
| ------------------- | ----------- | ------------------------- | ----------------------------------------- | ----------------- |
| **Request/Response** | `POST`        | `application/json`          | Tool calls, MCP initialize handshake      | Per-request       |
| **SSE Stream**       | `GET`         | `text/event-stream`         | Server-pushed notifications and keepalives | Long-lived        |
| **Session Teardown** | `DELETE`      | N/A                       | Explicit session close                    | Per-request       |

Both channels share the same endpoint URL: `/mcp`.

### MCP SDK Configuration

**Server-side (Hub):**
```typescript
new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID()
})
```

**Client-side (network-adapter):**
```typescript
new StreamableHTTPClientTransport(url, {
  requestInit: {
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Authorization": "Bearer <token>"
    }
  },
  reconnectionOptions: {
    initialReconnectionDelay: 1000,    // 1s
    maxReconnectionDelay: 30000,       // 30s
    reconnectionDelayGrowFactor: 1.5,
    maxRetries: 0  // Disabled — ConnectionManager owns SSE lifecycle
  }
})
```

## Endpoints

### `POST /mcp`

Handles two request types, distinguished by the JSON-RPC body:

**1. Initialize (MCP handshake)**
- Detected by `isInitializeRequest()` from the MCP SDK
- Creates a new session: generates session ID, creates `StreamableHTTPServerTransport` + `McpServer` pair, stores in session maps
- Returns MCP server capabilities and the session ID (via `mcp-session-id` response header)
- Subsequent requests must include `mcp-session-id` header to route to the correct session

**2. Tool call (post-handshake)**
- Requires `mcp-session-id` header
- Looks up the session's transport, delegates to it
- If session not found: returns HTTP 400 `{ error: "No valid session ID" }`
- Transport routes the JSON-RPC request to the appropriate tool handler

### `GET /mcp`

Opens a Server-Sent Events stream for the session identified by the `mcp-session-id` header.

- **SSE Singleton Enforcement:** If an active SSE stream already exists for this session, closes the old stream before registering the new one (prevents split-brain where keepalives flow on one stream but notifications on another)
- Sets `sseActive = true` for the session, tracks the response in `activeSseResponses`
- Updates `sessionLastActivity`
- On stream close: sets `sseActive = false` (unless close was triggered by intentional replacement)
- After 2 seconds (replay delay), replays any missed notifications if `Last-Event-ID` header is present

**Note on replay ordering:** A live notification broadcast within the 2-second replay window may arrive before replayed historical notifications. The client's dedup layer (S10 + S11) handles this, but strict chronological ordering should not be assumed during the first 2 seconds.

### `DELETE /mcp`

Explicitly closes a session.

- Requires `mcp-session-id` header
- Calls `transport.handleRequest()` for the delete
- Cleans up session from all maps

### `GET /health`

Unauthenticated health check endpoint.

- Returns `200 OK` with `{ status: "ok", timestamp, activeSessions, sseStreams }`
- `activeSessions`: count of entries in `transports` map
- `sseStreams`: count of entries in `sseActive` map where value is `true`

### `GET /engineers/status`

Unauthenticated engineer status endpoint.

- Returns the engineer registry state (connected/disconnected engineers, task counts, IPs)

### `GET /sessions/status`

Unauthenticated session diagnostic endpoint.

- Returns all sessions with their roles, SSE activity status, and last activity timestamps

## Authentication

| Parameter     | Source                 | Required          |
| ------------- | ---------------------- | ----------------- |
| Token         | `HUB_API_TOKEN` env var  | Conditional       |
| Header        | `Authorization: Bearer <token>` | On all `/mcp` requests |
| Exempt routes | `/health`, `/engineers/status`, `/sessions/status` | Always exempt |

**Behavior:**
- If `HUB_API_TOKEN` is not set or empty, authentication is disabled (all requests pass)
- If set, all `/mcp` requests must include the matching Bearer token
- Failed auth returns HTTP 401 with JSON-RPC error: `{ code: -32001, message: "Unauthorized" }`
- Auth is checked before session lookup — invalid tokens are rejected before any processing

## Session Identification

Every MCP session has a unique ID (UUID v4), generated on initialization.

| Header           | Direction       | Purpose                                      |
| ---------------- | --------------- | -------------------------------------------- |
| `mcp-session-id`   | Client → Server | Identifies which session a request belongs to |
| `mcp-session-id`   | Server → Client | Returned on initialize response               |
| `Last-Event-ID`    | Client → Server | On SSE GET, requests replay from this point  |

## Notification System

### Notification Lifecycle

```
1. Tool handler calls notifyConnectedAgents(event, data, targetRoles)
2. notificationStore.persist(event, data, targetRoles)
   → GCS write: notifications/notif-{paddedId}.json
   → Returns notification with monotonic ID
3. For each session matching targetRoles + sseActive:
   → server.sendLoggingMessage(payload)
4. If zero sessions received it:
   → fireWebhook(event, data) as fallback
```

### Notification Payload Format

Notifications are sent as MCP `LoggingMessageNotification` with these fields:

```typescript
{
  level: "info",
  logger: "hub-event",
  data: {
    id: number,              // Monotonic notification ID
    event: string,           // Event type (e.g., "task_issued")
    data: Record<string, unknown>,  // Event-specific payload (pointer-style)
    timestamp: string,       // ISO 8601
    targetRoles: string[]    // ["engineer"], ["architect"], or ["engineer", "architect"]
  }
}
```

### Event Types

| Event                    | Target Roles          | Payload Data                                    |
| ------------------------ | --------------------- | ----------------------------------------------- |
| `task_issued`         | `["engineer"]`          | `{ taskId }`                                      |
| `directive_acknowledged`   | `["architect"]`         | `{ taskId }`                                      |
| `report_submitted`         | `["architect"]`         | `{ taskId, summary }`                             |
| `review_completed`         | `["engineer"]`          | `{ taskId }`                                      |
| `proposal_submitted`       | `["architect"]`         | `{ proposalId, title, summary }`                  |
| `proposal_decided`         | `["engineer"]`          | `{ proposalId, decision }`                        |
| `clarification_requested`  | `["architect"]`         | `{ taskId, question }`                            |
| `clarification_answered`   | `["engineer"]`          | `{ taskId }`                                      |
| `thread_opened`            | Opposite of initiator | `{ threadId, title }`                             |
| `thread_message`           | Opposite of author    | `{ threadId, title, author, message (truncated) }` |

### Keepalive Payload Format

```typescript
{
  level: "debug",
  logger: "keepalive",
  data: {
    type: "keepalive",
    timestamp: string  // ISO 8601
  }
}
```

Keepalives are distinguishable from notifications by `logger: "keepalive"` (vs `logger: "hub-event"`).

### Notification Persistence Format

Stored in GCS as individual JSON files:

```
notifications/notif-000042.json
```

```json
{
  "id": 42,
  "event": "task_issued",
  "data": { "taskId": "task-29" },
  "targetRoles": ["engineer"],
  "timestamp": "2026-04-12T03:26:17.328Z"
}
```

File naming uses zero-padded IDs (6 digits) for lexicographic ordering, enabling efficient `listSince()` queries.

### Notification Replay Protocol

1. Agent connects via `GET /mcp` with `Last-Event-ID: N` header
2. Hub waits 2 seconds (lets SSE stream establish and role register)
3. Hub calls `notificationStore.listSince(N, role)` — returns all notifications with `id > N` matching the agent's role
4. Each notification is sent via `sendLoggingMessage()` on the SSE stream
5. Agent's ConnectionManager forwards them through the normal notification handler pipeline

**Guarantee:** Combined with persist-first write, this ensures zero notification loss across disconnections. The only window for loss is if the Hub crashes between persist and SSE delivery — but the agent will replay on reconnect.

### Notification TTL

- **Max age:** 24 hours
- **Cleanup interval:** 1 hour
- Notifications older than 24h are deleted from GCS

## Role Registration

After MCP initialization, agents must register their role:

```
POST /mcp → register_role({
  role: "engineer" | "architect" | "director",
  globalInstanceId?: string,            // M18 Agent fingerprint
  clientMetadata?: { ... },             // M18 enriched payload
  advisoryTags?: { ... },
  labels?: Record<string, string>       // Mission-19 routing labels (K8s equality)
})
```

This binds the session to a role, enabling:
- Role-targeted notification delivery
- Engineer registry tracking (connect/disconnect, task counts)
- Session reaper orphan detection (unregistered sessions pruned after 60s)

### Mission-19 routing labels

`labels` is an optional K8s-style equality map stamped onto the Agent entity **once, immutably** (INV-AG1). Subsequent `register_role` calls for the same `globalInstanceId` cannot rewrite the labels. Tasks created by the Agent inherit the labels and `ctx.dispatch` selectors use them as `matchLabels`, scoping delivery to label-matching agents only. Omit `labels` (or pass `{}`) for legacy broadcast semantics — empty `matchLabels` matches every role-qualified Agent (INV-SYS-L09). See `docs/network/workflow-registry.md` §6 for selector semantics.

## Document Storage

The Hub provides a shared document workspace via GCS, accessible to both Architect and Engineer.

### `write_document`
- **Access:** Any role
- **Parameters:** `path` (must start with `documents/`), `content` (string)
- **Behavior:** Writes content to GCS at the specified path. Blind overwrite if file exists (V1).
- **Namespace enforcement:** Rejects paths not starting with `documents/` to prevent writes to workflow-managed namespaces (`reports/`, `proposals/`, `tasks/`)
- **Path validation:** Rejects directory traversal (`..`) and absolute paths (`/`)
- **Pairs with:** `read_document` (read any path), `list_documents` (list by prefix)

### Co-Authoring Pattern (Option A)
1. Architect writes a draft: `write_document({ path: "documents/planning/brief.md", content: "..." })`
2. Architect opens a Thread: "Review the document at documents/planning/brief.md"
3. Engineer reads via `read_document`, modifies via `write_document`, replies in Thread
4. Turn-based soft locking via Thread turn-taking prevents concurrent edits
5. When mature, Architect issues a Task for the Engineer to commit the document to git

## Proxy Protocol (Adapter)

The Universal Adapter runs a local MCP server that OpenCode connects to as if it were a direct Hub connection:

```
OpenCode → [POST http://127.0.0.1:<port>/mcp] → Adapter → [POST https://hub.../mcp] → Hub
```

| Aspect          | Local (Adapter ↔ OpenCode) | Remote (Adapter ↔ Hub)           |
| --------------- | -------------------------- | -------------------------------- |
| Transport       | MCP Streamable HTTP        | MCP Streamable HTTP              |
| Auth            | None (localhost)           | Bearer token                     |
| Port            | Random (Bun `port: 0`)      | 443 (Cloud Run HTTPS)            |
| Idle timeout    | Disabled (`idleTimeout: 0`)  | Cloud Run default                |
| Tool discovery  | Proxied from Hub           | Direct `listTools()` on Hub session |
| Session binding | One-to-many local sessions | Single remote Hub session        |

The Adapter maintains a single remote Hub connection (via `McpAgentClient`, which owns an `McpTransport` underneath) and multiplexes all local OpenCode sessions through it.
