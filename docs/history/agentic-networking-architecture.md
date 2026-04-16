# Agentic Networking Architecture

**Status:** Implemented (Phase 13e complete, 2026-04-11)
**Authors:** Director, Engineer, Architect
**Date:** 2026-04-11
**Phase:** Phase 13e (Universal MCP Network Adapter + Push-to-LLM)
**Threads:** thread-6, thread-9, thread-10, thread-11, thread-12

---

## 1. Problem Statement

The OIS platform connects LLM agents (Engineer, Architect) to a central Hub for task coordination. The transport layer has evolved through 13 phases. All core problems have been addressed:

- **Session-per-invocation overhead:** The Architect's ADK `McpToolset` creates a new MCP session (~5-10s handshake) for every LLM invocation, causing intermittent timeouts and silent tool-call failures.
- **No push notifications to agents:** The Hub can only push to the Architect via HTTP webhooks. The Engineer (OpenCode) has no push mechanism at all — it must be told to poll.
- **Fragile session identity:** Every Hub redeployment or agent restart invalidates MCP sessions. Agents lose their identity and must re-register.
- **Inconsistent transport per agent:** OpenCode uses native MCP over Streamable HTTP. The Architect uses ADK McpToolset (which wraps MCP with per-invocation lifecycle). Future agents (Claude Desktop, Gemini CLI) would each need their own integration pattern.
- **Webhook coupling:** The Hub's webhook system is a parallel communication channel outside MCP, adding complexity and a separate auth/retry surface.

These are symptoms of not having a designed transport layer. This document defines one.

---

## 2. Design Principles

1. **MCP as the universal transport.** All agent-Hub communication uses the MCP protocol (Streamable HTTP + SSE). No parallel channels unless required for fallback.
2. **Shared core, per-agent adapters.** The Hub exposes one MCP interface. Each agent type has a thin adapter that handles session lifecycle and notification dispatch.
3. **Push via MCP SSE.** Server-initiated notifications use MCP's native SSE channel, not HTTP webhooks. Webhooks remain as a degraded fallback for disconnected agents.
4. **Infrastructure-agnostic.** The design must work whether agents run on Cloud Run, GKE, GCE, or local developer machines. No dependency on a specific compute platform.
5. **OpenCode first.** OpenCode is the priority client. Design decisions should optimize for the OpenCode experience and use its capabilities (Plugins, MCP config) as the reference implementation.
6. **Catch-up over guaranteed delivery.** Sessions will drop. The system handles this via `get_pending_actions` catch-up on reconnect, not via durable message queues.

---

## 3. Agent Landscape

### 3.1 Current Agents

| Agent | Runtime | MCP Client | Push Capability | Current Connection |
|---|---|---|---|---|
| **OpenCode (Engineer)** | Local CLI (terminal) | Native MCP (Streamable HTTP) | None — must poll | Remote MCP to Hub |
| **ADK Architect** | Cloud Run (Python/ADK) | McpToolset (per-invocation sessions) | Webhooks only | McpToolset → Hub |

### 3.2 Planned/Future Agents

| Agent | Runtime | MCP Client | Push Capability | Notes |
|---|---|---|---|---|
| **Claude Desktop/Code** | Local app | Native MCP (stdio, SSE, Streamable HTTP) | MCP SSE possible | Supports MCP server config |
| **Gemini CLI** | Local CLI | MCP via config | Unknown | Google's CLI agent |
| **Custom hosted agents** | Cloud Run / GKE / GCE | Custom (MCP SDK) | MCP SSE possible | Future specialist agents |

### 3.3 Agent Capabilities Matrix

| Capability | OpenCode | ADK Architect | Claude | Gemini CLI |
|---|---|---|---|---|
| MCP Streamable HTTP | Yes | Via McpToolset | Yes | TBD |
| MCP SSE (receive) | Possible (Plugin?) | Must implement | Possible | TBD |
| Persistent session | Yes (terminal lifetime) | No (per-invocation) | Yes (app lifetime) | TBD |
| ACP support | No | No | No | No |
| Plugin system | Yes (OpenCode Plugins) | No (ADK tools only) | No | No |
| Custom adapters | Via Plugins | Via Python module | Via MCP config | Via MCP config |

---

## 4. Transport Architecture

### 4.1 The Hub as MCP Server

The Hub exposes a single MCP endpoint that all agents connect to:

```
POST /mcp  — Client → Server (tool calls, initialize)
GET  /mcp  — Server → Client (SSE notifications)
DELETE /mcp — Client → Server (session termination)
```

This is already implemented. No protocol changes needed.

### 4.2 Communication Channels

**Channel 1: Tool Calls (Agent → Hub)**
- Agent calls Hub tools via MCP `tools/call`
- Synchronous request-response over POST
- All agents use this identically
- Examples: `submit_report`, `get_directive`, `submit_review`

**Channel 2: Notifications (Hub → Agent)**
- Hub sends MCP notifications via SSE to connected sessions
- Asynchronous, server-initiated
- Only works for agents with an active SSE stream
- Replaces webhooks for connected agents

**Channel 3: Catch-up (Agent → Hub, on reconnect)**
- Agent calls `get_pending_actions` after session creation
- Discovers anything missed during disconnection
- Deterministic, no push required
- Safety net for notification gaps

### 4.3 Notification Schema

Hub notifications use MCP's `notifications/message` (logging) method via `sendLoggingMessage()`. The event payload is embedded in the `data` field:

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/message",
  "params": {
    "level": "info",
    "logger": "hub-event",
    "data": {
      "event": "report_submitted",
      "data": {
        "taskId": "task-25",
        "summary": "Implemented feature X",
        "reportRef": "reports/task-25-report.md"
      },
      "timestamp": "2026-04-11T03:00:00.000Z",
      "targetRoles": ["architect"]
    }
  }
}
```

**Implementation note:** We use `notifications/message` (MCP logging) rather than a custom `notifications/hub_event` method because `logging: {}` capability is already declared and supported by all MCP clients. This avoids requiring clients to handle custom notification types.

**Implemented event types (Phase 13b):**
- `report_submitted` — Engineer submitted a report (target: architect)
- `proposal_submitted` — Engineer submitted a proposal (target: architect)
- `clarification_requested` — Engineer needs clarification (target: architect)
- `directive_acknowledged` — Engineer picked up a directive (target: architect)
- `thread_message` — Message in an ideation thread (target: other party)

**Planned event types (future):**
- `directive_issued` — Architect issued a directive (target: engineer)
- `review_completed` — Architect reviewed a report (target: engineer)
- `proposal_decided` — Architect decided on a proposal (target: engineer)
- `clarification_answered` — Architect answered a question (target: engineer)

### 4.4 Session Lifecycle

```
Agent starts
    │
    ▼
POST /mcp {initialize}
    │
    ▼
Receive session ID
    │
    ├──────────────────────────────┐
    ▼                              ▼
POST /mcp {register_role}     GET /mcp (SSE stream)
    │                              │
    ▼                              │  ← Hub sends notifications
POST /mcp {get_pending_actions}    │
    │                              │
    ▼                              │
[Process catch-up items]           │
    │                              │
    ▼                              │
[Normal operation]                 │
    │                              │
    ▼                              │
POST /mcp {tool calls} ───────────┤
    │                              │
    ...                            │
    │                              │
[Connection drops]                 │
    │                              ▼
    ▼                         SSE stream closes
POST /mcp {initialize}       Hub fires onclose
    │                              │
    ▼                              ▼
[Reconnect cycle]            Hub marks agent disconnected
```

### 4.5 Fallback: Webhooks for Disconnected Agents

When the Hub needs to notify an agent that has no active SSE stream:

1. Check if the target role has a connected session with an active SSE stream
2. If yes → send MCP notification via SSE (preferred)
3. If no → fall back to webhook HTTP POST (current behavior)
4. If no webhook configured → log and skip (agent will catch up on reconnect)

This ensures the system degrades gracefully. Webhooks are not removed — they become the backup channel.

---

## 5. Per-Agent Adapters

### 5.1 Adapter Responsibilities

Each agent adapter handles:
1. **Session creation** — Connect to Hub, initialize MCP session
2. **SSE listener** — Open and maintain the GET/SSE stream
3. **Reconnection** — Detect session drops, reconnect, catch up
4. **Notification dispatch** — Route incoming notifications to agent logic
5. **Role registration** — Call `register_role` on connect

### 5.2 OpenCode Adapter (Priority)

**Implementation path: OpenCode Plugin (Node.js)**

OpenCode supports custom Plugins that can extend its capabilities. The adapter will be implemented in **Node.js** (matching OpenCode's own runtime). The Plugin will:
- Maintain the MCP session (already done by OpenCode's MCP client)
- Open the SSE stream for Hub notifications
- Surface notifications as system messages or prompts to the user/agent
- Call `get_pending_actions` on startup for catch-up

**Key question:** Does OpenCode's MCP client already listen on the SSE stream? If so, the adapter may just need to handle the notification display. If not, the Plugin can open a separate SSE connection.

**Investigation needed:**
- OpenCode Plugin API — what hooks are available?
- OpenCode MCP client — does it support server-initiated notifications?
- How to surface Hub notifications within an OpenCode session

### 5.3 Architect Adapter

**Implementation path: Custom Python MCP client module (`hub_client.py`)** — IMPLEMENTED (Phase 13a)

Replaces `McpToolset` for all background tasks. Webhooks remain as a delivery fallback.

```
hub_client.py (implemented)
├── HubClient class
│   ├── Singleton cached MCP ClientSession (AsyncExitStack lifecycle)
│   ├── Auto-reconnect on failure (one retry with session recreation)
│   ├── _call_tool_raw(name, args) — generic MCP tool caller with JSON parsing
│   └── Typed convenience methods (calling _call_tool_raw internally):
│       ├── get_pending_actions() → dict
│       ├── submit_review(task_id, assessment) → dict
│       ├── submit_audit_entry(action, details, entity) → dict
│       ├── read_document(path) → str
│       ├── reply_to_thread(thread_id, message, converged, intent) → dict
│       ├── get_thread(thread_id) → dict
│       ├── respond_to_clarification(task_id, answer) → dict
│       ├── review_proposal(proposal_id, decision, feedback) → dict
│       └── ... (11 wrappers total, extensible)
└── get_hub_client() — module-level singleton accessor

main.py (refactored)
├── Sandwich handlers (using HubClient for fetch/execute, LLM for reasoning):
│   ├── _sandwich_review_report() — read report → LLM assessment → submit_review
│   ├── _sandwich_review_proposal() — read proposal → LLM decision → review_proposal
│   ├── _sandwich_thread_reply() — read thread → LLM response → reply_to_thread
│   └── _sandwich_clarification() — LLM answer → respond_to_clarification
└── Event loop — deterministic poll via hub_client → dispatch to sandwich handlers
```

**SSE listener** — Not yet implemented (Phase 13c). Currently the Architect's hub_client uses request/response only.

**The "Sandwich" Pattern:**
For notification handlers that need LLM reasoning:
1. **Fetch** — deterministic data retrieval via HubClient (fast, reliable)
2. **Reason** — pass context to LLM as plain text (LLM generates assessment/response)
3. **Execute** — deterministic state mutation via HubClient (fast, reliable)

The LLM only handles the non-deterministic middle step. Infrastructure calls are deterministic Python.

### 5.4 Future Agent Adapters

For Claude Desktop, Gemini CLI, and other agents:
- Configure the Hub as an MCP server in their MCP config
- The agent's native MCP client handles session lifecycle
- SSE support depends on the agent's MCP implementation
- Catch-up via `get_pending_actions` on connect

---

## 6. ADK Evaluation

### 6.1 Current ADK Usage

The Architect uses Google ADK (Agent Development Kit) for:
- `Agent` class — wraps the LLM with tool definitions and system instructions
- `McpToolset` — discovers Hub tools via MCP protocol
- `Runner` — executes the agent (LLM + tools) with session management
- `DatabaseSessionService` — SQLite-based conversation history
- `get_fast_api_app()` — generates FastAPI endpoints for the agent

### 6.2 What ADK Provides vs. What We Need

| ADK Feature | What It Does | Do We Still Need It? |
|---|---|---|
| `Agent` + `Runner` | LLM invocation with tool calling | Yes, but could be replaced with direct Vertex AI API calls |
| `McpToolset` | Dynamic MCP tool discovery | **No** — we're replacing this with `hub_client.py` |
| `DatabaseSessionService` | Conversation history (SQLite) | Partially — ephemeral on Cloud Run anyway |
| `get_fast_api_app()` | Auto-generates API endpoints | Partially — we're adding custom endpoints anyway |
| `FunctionTool` | Wraps Python functions as LLM tools | Yes, useful for presenting Hub tools to the LLM |

### 6.3 The Question

If we implement `hub_client.py` with typed Python wrappers for all Hub tools, and wrap those as `FunctionTool` for the LLM, we've replaced `McpToolset` — which was the main reason to use ADK.

The remaining ADK value is:
- `Agent` + `Runner` for LLM invocation (but Vertex AI SDK can do this directly)
- `FunctionTool` for tool definitions (but we could use Vertex AI's function calling directly)
- `get_fast_api_app()` for the Director chat API (but we have custom FastAPI routes already)

**Decision needed:** Is the remaining ADK value worth the dependency? The alternative is a lightweight custom agent that uses:
- Vertex AI SDK for LLM calls
- `hub_client.py` for Hub communication
- Custom FastAPI for the Director chat API
- Custom session management (GCS-backed instead of ephemeral SQLite)

This is not a Phase 12/13 decision — it's a longer-term architectural question. But it should be on the radar as we design the transport layer, since the transport design may make ADK's MCP integration irrelevant.

---

## 7. Hub Changes Required

### 7.1 Server-Initiated Notifications

The Hub needs to send MCP notifications to connected sessions:

```typescript
// When an event occurs, notify relevant connected sessions
async function notifyConnectedAgents(event: string, data: object, targetRoles: string[]) {
  for (const [sessionId, transport] of transports) {
    const role = engineerRegistry.getRole(sessionId);
    if (targetRoles.includes(role)) {
      try {
        await transport.sendNotification("notifications/hub_event", {
          event,
          data,
          timestamp: new Date().toISOString(),
          targetRoles,
        });
      } catch (err) {
        // Session may be disconnected — log and continue
        console.log(`[Notify] Failed to notify ${sessionId}: ${err}`);
      }
    }
  }
}
```

### 7.2 Hybrid Notification + Webhook

Replace the current `fireWebhook()` calls with a hybrid function:

```typescript
async function notifyEvent(event: string, data: object, targetRoles: string[]) {
  // Try MCP notifications first (for connected agents)
  const notified = await notifyConnectedAgents(event, data, targetRoles);

  // Fall back to webhook for disconnected agents
  if (!notified) {
    await fireWebhook(event, data);
  }
}
```

### 7.3 Session Metadata

Track which sessions have an active SSE stream:

```typescript
interface SessionMetadata {
  sessionId: string;
  role: string;
  sseActive: boolean;     // Is the GET/SSE stream open?
  connectedAt: string;
  lastActiveAt: string;
}
```

---

## 8. Implementation Phases (Converged in thread-6)

### Phase 13a: Tactical Hub Client (`hub_client.py`) — REQUEST/RESPONSE ONLY
Build the Architect's direct Hub client without SSE. Immediate fix for the 5-10s McpToolset timeout.
- Singleton cached MCP `ClientSession` with auto-reconnect
- Critical subset of typed Python wrappers:
  - `hub_get_pending_actions()`
  - `hub_submit_review(task_id, assessment)`
  - `hub_submit_audit_entry(action, details, entity)`
  - `hub_read_document(path)`
  - `hub_reply_to_thread(thread_id, message, converged, intent)`
- Refactor webhook handler to use "sandwich" pattern (deterministic fetch → LLM → deterministic execute)
- Refactor event loop to use deterministic polling + targeted LLM invocation
- Validate connection stability and the sandwich pattern before expanding surface area

### Phase 13b: Hub-Side SSE Notifications
Add server-initiated notifications to the Hub.
- Implement `notifyConnectedAgents(event, data, targetRoles)` — sends MCP notifications to sessions with active SSE streams
- Replace `fireWebhook()` with hybrid `notifyEvent()` — tries SSE first, falls back to webhook
- Track `sseActive` boolean per session in Hub session state
- Implement SSE keepalive: Hub sends `:keepalive` SSE comment every 30s
- Reject/ignore SSE connections from sessions that haven't registered a role
- Validate with `curl` scripts before wiring to agents

### Phase 13c: Agent SSE Listeners
Add SSE listening and auto-reconnect to agents.
- Architect `hub_client.py`: open SSE stream after session init, dispatch notifications to handlers
- Auto-reconnect loop: detect SSE drop → create new session → call `get_pending_actions` → reopen SSE
- OpenCode Plugin adapter: investigate Plugin API, implement notification display
- Handle race window: notifications during reconnect fall back to webhook → same `hub_client.py` processing

### Phase 13d+13e: Universal MCP Network Adapter — IMPLEMENTED (threads 8-12)
Unified OpenCode Plugin acting as MCP-to-MCP proxy with Push-to-LLM.

**Architecture (MCP-to-MCP Proxy):**
- Plugin runs a local MCP Server via `Bun.serve()` + `WebStandardStreamableHTTPServerTransport`
- Plugin maintains a single MCP Client connection to the remote Hub
- Plugin registers the local proxy with OpenCode via `client.mcp.add("architect-hub", ...)`
- OpenCode connects to the local proxy and discovers 28 tools dynamically
- `tools/list` and `tools/call` are forwarded transparently to the remote Hub
- No `opencode.json` MCP server config needed — Plugin is self-contained

**Configuration:**
- `.opencode/hub-config.json` — hubUrl, hubToken, autoPrompt, role
- Environment variable overrides: `MCP_HUB_URL`, `HUB_API_TOKEN`, `HUB_PLUGIN_AUTO_PROMPT`, `HUB_PLUGIN_ROLE`

**Push-to-LLM:**
- SSE notifications received via `LoggingMessageNotificationSchema` handler
- Session tracking via `session.created`/`session.updated`/`session.status`/`session.idle` events
- Notification queue: buffers during active LLM processing, flushes on `session.idle`
- ACTIONABLE events (`thread_message`, `clarification_answered`): `client.session.promptAsync()` triggers LLM
- INFORMATIONAL events (`directive_issued`, `review_completed`, `proposal_decided`): context injection via `noReply: true`
- Toast notifications via `client.tui.showToast()`
- Safety: idempotency cache (100 events), 30s rate limit, `HUB_PLUGIN_AUTO_PROMPT=false` kill switch

**Validated:** Autonomous Architect → Engineer thread conversation (threads 17, 18, 20) — Architect opens thread → Hub SSE → Plugin → promptAsync → LLM reads and replies — no Director intervention.

**Current Push-to-LLM status (half-duplex):**
- Architect → Engineer (via Plugin Push-to-LLM): **WORKING** — fully autonomous
- Engineer → Architect (via hub_client.py SSE): **FRAGILE** — the Python MCP SDK `ClientSession` suffers `ClosedResourceError` when the write stream closes during Hub redeploys. The reconnect loop doesn't fully recreate the session. Requires `architect-chat.sh` fallback. **Phase 14 fix** — ADK removal + hub_client.py rewrite will address session lifecycle.

**Key fixes during implementation:**
- Non-blocking init: all network ops deferred to `setTimeout(3000)`
- `Bun.serve({ idleTimeout: 0 })` prevents SSE stream closure
- `StreamableHTTPClientTransport({ reconnectionOptions: { maxRetries: Infinity } })` keeps SSE alive
- Hub `servers` Map population moved to `onsessioninitialized` callback (was storing before session ID assignment)
- Hub author detection: `unknown` role → assume architect (ADK McpToolset doesn't call `register_role`)

### Phase 14: Architect Node.js Rewrite — IMPLEMENTED (thread-21)
Complete rewrite from Python/ADK to Node.js/TypeScript. Standardized entire stack on one language.

**Architecture:**
```
architect-agent/ (Node.js)
├── src/
│   ├── index.ts          — Express HTTP server, startup, SIGTERM handling
│   ├── hub-adapter.ts    — MCP Client to Hub (shared pattern with Plugin)
│   ├── llm.ts            — Gemini 3.1 Pro via @google/genai, function calling
│   ├── context.ts        — Unified GCS context store (Director + autonomous)
│   ├── sandwich.ts       — Sandwich handlers (review, proposal, thread, clarification)
│   ├── notifications.ts  — SSE notification dispatch to sandwich handlers
│   ├── event-loop.ts     — 300s catch-up polling
│   └── director-chat.ts  — Director chat API with function calling
├── package.json          — @google/genai, @modelcontextprotocol/sdk, express
├── Dockerfile            — Node 22
└── tsconfig.json
```

**Key outcomes:**
- Full-duplex autonomous SSE communication (ClosedResourceError eliminated)
- Unified context persistence: Director chats + reviews + threads + decisions in GCS
- Director chat with function calling (LLM can call Hub tools during conversation)
- Shared MCP adapter pattern between Plugin and Architect
- Python/ADK entirely removed
- architect-chat.sh updated with clean API paths (`/chat/session`, `/chat/message`)
- Plugin log output moved to file (`.opencode/hub-plugin.log`) to prevent TUI interference

**Validated:** thread-22 — full-duplex round-trip in 18 seconds. Engineer opens thread → Architect auto-replies via SSE → Plugin Push-to-LLM prompts Engineer → Engineer responds. Zero Director intervention.

### Future: Additional Agent Support
- Claude Desktop/Code MCP config
- Gemini CLI MCP config
- Custom hosted agents on GKE/GCE

---

## 8.1 Agreed Architectural Decisions (thread-6)

| Decision | Resolution | Rationale |
|---|---|---|
| Primary push mechanism | MCP SSE | Outbound connections traverse NATs/firewalls; works for local and hosted agents |
| Fallback push mechanism | HTTP webhooks | Resilience for serverless environments; graceful degradation |
| hub_client.py scope | Critical subset first | Validate sandwich pattern and connection stability before expanding |
| ADK future | Remove in Phase 14 | Liability not asset; opaque timeouts; replaceable with ~200 lines |
| Phase ordering | 13a → 13b → 13c | Build cached session first (immediate win), layer SSE on top |
| Reconnection strategy | Last-Event-ID replay from GCS | Persistent notification queue replays missed events on reconnect (Phase 15) |
| Heartbeat mechanism | SSE `:keepalive` comments every 30s | Standard-compliant; forces TCP failure detection without client logic |
| Auth model | Existing bearer token + register_role | Unified security model; reject unregistered SSE connections |
| Session state tracking | Explicit `sseActive` boolean per session | Accurate routing: SSE if connected, webhook if disconnected |

---

## 8.2 Push-to-LLM Design (Converged in thread-9)

The final piece of the agentic networking architecture: when the Hub sends an SSE notification, the Plugin autonomously prompts the LLM to act — no Director intervention needed.

### Mechanism

The OpenCode SDK provides `client.session.prompt()` which sends a prompt to the active session and triggers an LLM response. The Plugin uses this to bridge Hub SSE notifications into LLM actions.

### Notification Flow

```
Hub event (e.g., Architect replies to thread)
    │
    ▼
Plugin receives SSE notification (LoggingMessageNotificationSchema)
    │
    ├── Toast: client.tui.showToast({ message, variant: "info" })
    │
    ├── Session active? → Queue notification
    │   └── On session.idle → Flush queue as batched prompt
    │
    ├── ACTIONABLE (prompt the LLM to respond):
    │   │   thread_message → "The Architect replied to thread-9. Read and respond."
    │   │   clarification_answered → "Clarification received for task-25. Resume."
    │   └── client.session.prompt({ parts: [...] })
    │
    └── INFORMATIONAL (inject context, don't interrupt):
        │   directive_issued → "FYI: New directive task-25 available."
        │   review_completed → "FYI: Architect reviewed task-25."
        │   proposal_decided → "FYI: Proposal prop-7 approved."
        └── client.session.prompt({ noReply: true, parts: [...] })
```

### Notification Classification

| Event                  | Level          | Action                                         | Rationale                                  |
|---|---|---|---|
| `thread_message`       | ACTIONABLE     | Prompt LLM to read thread and reply            | Timely conversational response needed      |
| `clarification_answered`| ACTIONABLE    | Prompt LLM to resume blocked task              | Unblocks current work                      |
| `directive_issued`     | INFORMATIONAL  | Inject as context (noReply)                    | Don't interrupt current task               |
| `review_completed`     | INFORMATIONAL  | Inject as context (noReply)                    | Non-urgent, LLM can check when ready       |
| `proposal_decided`     | INFORMATIONAL  | Inject as context (noReply)                    | Non-urgent                                 |

### Session Management

1. **Session tracking:** Plugin subscribes to `session.created`/`session.updated` events to maintain `currentSessionId`. Falls back to `client.session.list()` on startup.
2. **Busy detection:** If session is active (LLM processing), notifications are queued.
3. **Queue flush:** On `session.idle`, all queued notifications are batched into a single prompt: "While you were working, the following events occurred: 1. Thread-9 reply, 2. Review completed for task-25. Please address them."

### Safety Layers

| Layer | Mechanism | Purpose |
|---|---|---|
| 1. Origin filtering | Hub routes `thread_message` to OTHER party only | Prevents self-notification loops |
| 2. Idempotency cache | Rolling cache of last 100 event hashes | Drops duplicate notifications |
| 3. Rate limiting | Max 1 autonomous prompt per 30s | Prevents runaway loops; downgrades to noReply if exceeded |
| 4. Director kill switch | `HUB_PLUGIN_AUTO_PROMPT=false` env var | Disables all autonomous prompting |

### Implementation Components

```
Plugin (hub-notifications.ts)
├── SessionTracker
│   ├── currentSessionId: string
│   ├── sessionStatus: "idle" | "active"
│   └── event listeners: session.created, session.updated, session.idle
├── NotificationQueue
│   ├── queue: HubEvent[]
│   ├── enqueue(event) — add to queue if session active
│   ├── flush() — batch queued events into single prompt on session.idle
│   └── processImmediate(event) — prompt LLM now if session idle
├── NotificationRouter
│   ├── classify(event) → "actionable" | "informational"
│   ├── buildPrompt(event) → string
│   └── buildContextInjection(event) → string
├── SafetyGuard
│   ├── processedEvents: Set<string> (rolling cache, max 100)
│   ├── lastPromptTime: number
│   ├── COOLDOWN_MS: 30000
│   ├── isDuplicate(event) → boolean
│   ├── isRateLimited() → boolean
│   └── autoPromptEnabled: boolean (from env var)
└── SDK Client Integration
    ├── client.session.prompt({ path, body }) — trigger LLM
    ├── client.session.prompt({ noReply: true }) — inject context
    └── client.tui.showToast({ body }) — visual notification
```

---

## 9. Open Questions

1. ~~**OpenCode Plugin API:** What hooks does OpenCode expose for Plugins? Can a Plugin listen on the MCP SSE stream? Can it inject system messages into the conversation?~~ **RESOLVED (Phase 13d/13e):** Plugins can create their own MCP connections, listen for notifications via `LoggingMessageNotificationSchema`, inject messages via `client.session.prompt()`, show toasts via `client.tui.showToast()`, and inject context via `noReply: true`.

2. ~~**MCP notification support in agents:** Do any current MCP clients (OpenCode, Claude Desktop) handle `notifications/*` messages from the server? Or do they ignore them?~~ **RESOLVED (Phase 13c):** OpenCode's native MCP client opens SSE but doesn't surface notifications to Plugins. The Plugin manages its own MCP connection with `setNotificationHandler(LoggingMessageNotificationSchema, ...)` to receive and process notifications.

3. **SSE keep-alive on Cloud Run:** Cloud Run has a request timeout. Does the SSE stream count as an active request? If so, it will be killed after the timeout. If not, how long can it stay open? **Partially resolved:** min-instances=1 keeps the Hub alive. The SSE stream stays open as long as the instance is alive. Reconnect loop handles drops.

4. **Multi-instance notification routing:** With min-instances=1 and max-instances=1, there's only one Hub instance. If we scale to multiple instances, how do we route notifications? (Answer: probably Cloud Pub/Sub as a fanout layer, but this is future work.)

5. **ACP relevance:** Is ACP (Agent Communication Protocol) worth evaluating for agent-to-agent communication, or is MCP sufficient for our broker-mediated model?

---

## 10. Glossary

- **MCP** — Model Context Protocol. Agent-to-tool communication protocol.
- **ACP** — Agent Communication Protocol. Agent-to-agent communication protocol.
- **SSE** — Server-Sent Events. One-way server-to-client streaming over HTTP.
- **Streamable HTTP** — MCP transport that uses HTTP POST for requests and SSE for server notifications.
- **McpToolset** — ADK's wrapper around MCP that discovers tools dynamically. Creates per-invocation sessions.
- **Hub** — The MCP Relay Hub. Central broker for all agent communication.
- **Adapter** — Per-agent thin layer that handles session lifecycle and notification dispatch.
- **Sandwich Pattern** — Deterministic fetch → LLM reasoning → Deterministic execute. Ensures reliability by only using the LLM for non-deterministic steps.
- **Catch-up** — On reconnect, an agent calls `get_pending_actions` to discover items missed during disconnection.
- **Push-to-LLM** — Plugin uses `client.session.prompt()` to inject a message into the LLM session when a Hub notification arrives, causing the LLM to act autonomously.
- **Notification Queue** — Buffer that holds Hub notifications while the LLM is actively processing, flushing as a batched prompt on `session.idle`.
- **Director Kill Switch** — `HUB_PLUGIN_AUTO_PROMPT=false` env var that disables all autonomous LLM prompting from the Plugin.
