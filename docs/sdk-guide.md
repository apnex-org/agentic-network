# OIS SDK Guide — Module & Interface Reference

**Last updated:** 2026-04-17

This document catalogues every module in the OIS agentic network, its public surface, and its purpose. Use it to reason orthogonally about function: each module owns one concern, and this guide maps what that concern is.

---

## 1. `packages/network-adapter/` — `@ois/network-adapter@2.0.0`

Universal MCP network adapter. Published to npm as `@ois/network-adapter`. Provides L4 (wire) and L7 (session) abstractions consumed by all adapters and agents.

### 1.1 Transport Layer (L4) — `mcp-transport.ts`

Wire-level MCP connectivity: SSE liveness, reconnection with exponential backoff, keepalive monitoring.

| Export | Kind | Purpose |
|---|---|---|
| `ITransport` | interface | L4 wire surface — connect, close, request, onWireEvent, getMetrics |
| `TransportConfig` | interface | Wire config: URL, auth token, timers, logger |
| `TransportMetrics` | interface | Point-in-time telemetry: wireState, reconnects, keepalive stats |
| `WireState` | type | `"disconnected" \| "connecting" \| "connected"` |
| `WireReconnectCause` | type | Why the wire reconnected: sse_watchdog, heartbeat_failed, peer_closed, etc. |
| `WireEvent` | type | Union of wire events: state, reconnecting, reconnected, closed, push |
| `WireEventHandler` | type | Callback: `(event: WireEvent) => void` |
| `McpTransport` | class | Concrete `ITransport` — owns MCP client, SSE liveness, wire reconnection |
| `computeReconnectBackoff` | function | Pure exponential backoff with clamping |

**Naming verdict:** Clean. `ITransport` / `McpTransport` is the correct L4 abstraction pair. No changes needed.

### 1.2 Session Layer (L7) — `agent-client.ts`, `mcp-agent-client.ts`

Session FSM, handshake, state sync, event routing. Sits above the transport.

| Export | Kind | Purpose |
|---|---|---|
| `IAgentClient` | interface | L7 session surface — start, stop, call, listMethods, callbacks, metrics |
| `AgentClientConfig` | type | Session config: role, handshake settings, logger |
| `AgentClientCallbacks` | interface | Event routing: onActionableEvent, onInformationalEvent, onStateChange |
| `AgentClientMetrics` | interface | Session telemetry: sessionState, engineerId, epoch, handshake count |
| `AgentEvent` | interface | Classified hub event delivered to shim callbacks |
| `AgentHandshakeConfig` | type | Enriched handshake config: globalInstanceId, proxy info, client metadata |
| `SessionState` | type | FSM: `"disconnected" \| "connecting" \| "synchronizing" \| "streaming" \| "reconnecting"` |
| `SessionReconnectReason` | type | Session-level reconnect reason |
| `McpAgentClient` | class | Concrete `IAgentClient` — owns FSM, handshake, state sync, event dedup |
| `McpAgentClientOptions` | interface | Construction options: transport instance or config, dedup cache size |

**Naming verdict:** Clean. The `IAgentClient` / `McpAgentClient` pair mirrors the transport layer. No changes needed.

### 1.3 Handshake — `handshake.ts`

Enriched `register_role` handshake with M18 Agent metadata, fatal-code detection, and stdio drain.

| Export | Kind | Purpose |
|---|---|---|
| `HandshakePayload` | interface | Full register_role body: role, globalInstanceId, clientMetadata, advisoryTags |
| `HandshakeResponse` | interface | Success: engineerId, sessionEpoch, wasCreated |
| `HandshakeFatalError` | interface | Fatal error: code + message |
| `HandshakeConfig` | interface | Config for building payload |
| `HandshakeContext` | interface | Execution context: executeTool, config, previousEpoch, logger |
| `HandshakeResult` | interface | Outcome: response or null, epoch to persist |
| `HandshakeClientMetadata` | interface | Client info: name, version, proxy, transport, hostname, platform, pid |
| `HandshakeAdvisoryTags` | interface | Advisory tags: llmModel (subject to drift) |
| `FATAL_CODES` | const | `ReadonlySet<string>` — agent_thrashing_detected, role_mismatch |
| `buildHandshakePayload` | function | Builds enriched register_role payload from config |
| `performHandshake` | function | Executes handshake; never throws on tool-call failure |
| `parseHandshakeError` | function | Extracts structured fatal error from CallTool result |
| `parseHandshakeResponse` | function | Extracts success response from various envelope formats |
| `makeStdioFatalHalt` | function | Builds fatal-halt function with stdio drain delay |

**Naming verdict:** The `Handshake*` prefix is consistent and clear. No changes needed.

**Mission-19 routing labels:** `HandshakeConfig.labels?: Record<string, string>` carries K8s-style equality labels through the enriched `register_role` call. The Hub stamps them onto the Agent entity **once, immutably** (INV-AG1) — subsequent handshakes with a different `labels` map are ignored. Tasks created by the Agent inherit these labels and dispatch selectors use them as `matchLabels`, so two agents with `{env:"prod"}` form an isolated virtual network from agents with `{env:"smoke"}`. Omit `labels` (or pass `{}`) to keep legacy broadcast semantics (INV-SYS-L09: empty matchLabels = broadcast to all role-matching agents). See `docs/network/workflow-registry.md` §6 for routing semantics and `packages/network-adapter/test/integration/label-routing.test.ts` for the full-stack L7 E2E.

### 1.4 Event Router — `event-router.ts`

Event classification and deduplication for role-based routing.

| Export | Kind | Purpose |
|---|---|---|
| `HubEventType` | type | Union of all known Hub event types (directive_issued, report_submitted, etc.) |
| `HubEvent` | interface | Parsed event envelope: event, data, timestamp, id |
| `EventDisposition` | type | `"actionable" \| "informational" \| "unhandled"` |
| `classifyEvent` | function | Classifies event for a given role |
| `parseHubEvent` | function | Parses raw eventData into typed HubEvent |
| `createDedupFilter` | function | Returns `{ isDuplicate, clear, size }` dedup tracker |

**Naming verdict:** Clean. No changes needed.

### 1.5 State Sync — `state-sync.ts`

Runs `get_task` + `get_pending_actions` on session reconnect.

| Export | Kind | Purpose |
|---|---|---|
| `StateSyncContext` | interface | Context: executeTool, completeSync, log, onPendingTask |
| `performStateSync` | function | Parallel fetch of task + pending actions |

**Naming verdict:** Clean. No changes needed.

### 1.6 Prompt Formatting — `prompt-format.ts`

Builds LLM-injectable prompts and TUI toast messages from hub events.

| Export | Kind | Purpose |
|---|---|---|
| `PromptFormatConfig` | interface | Config with toolPrefix (MCP namespace prefix) |
| `getActionText` | function | Short action hint for notification logs |
| `buildPromptText` | function | Detailed LLM prompt for actionable events |
| `buildToastMessage` | function | Short TUI toast for event display |

**Naming verdict:** Clean. No changes needed.

### 1.7 Notification Log — `notification-log.ts`

Structured append-only notification log for shim observability.

| Export | Kind | Purpose |
|---|---|---|
| `NotificationLogEntry` | interface | Log entry: event, data, action fields |
| `NotificationLogOptions` | interface | Options: logPath, optional mirror sink |
| `appendNotification` | function | Appends formatted block to log file (best-effort) |

**Naming verdict:** Clean. No changes needed.

### 1.8 Instance Identity — `instance.ts`

Persists `globalInstanceId` for M18 Agent fingerprinting.

| Export | Kind | Purpose |
|---|---|---|
| `LoadInstanceOptions` | interface | Options: instanceFile path, optional logger |
| `loadOrCreateGlobalInstanceId` | function | Loads or creates `~/.ois/instance.json` (idempotent) |

**Naming verdict:** Clean. No changes needed.

### 1.9 Logger — `logger.ts`

Structured logging surface shared across transport and session layers.

| Export | Kind | Purpose |
|---|---|---|
| `ILogger` | interface | Structured logger: `log(event, fields?, message?)` + `child(component)` |
| `LogField` | type | Primitive log value |
| `LogFields` | interface | Key-value structured fields |
| `LegacyStringLogger` | type | Adapter for `(message: string) => void` loggers |
| `renderLogLine` | function | Renders event+fields+message to single string |
| `bridgeLegacyLogger` | function | Wraps legacy string logger into ILogger |
| `createConsoleLogger` | function | Creates ILogger with console.log output |
| `normalizeToILogger` | function | Normalizes undefined/function/ILogger to ILogger |

**Naming verdict:** Clean. No changes needed.

---

## 2. `hub/` — OIS Relay Hub

Central MCP server. All state flows through here. GCS-persisted, SSE notifications, 28 MCP tools.

### 2.1 Core Server — `hub-networking.ts`

Transport layer: session management, SSE delivery, keepalive, session reaper.

| Export | Kind | Purpose |
|---|---|---|
| `HubNetworking` | class | Core server: Express, MCP sessions, SSE push, keepalive, reaper |
| `HubNetworkingConfig` | interface | Config: port, auth, timeouts, cleanup intervals |
| `CreateMcpServerFn` | type | Factory for MCP server with tool registration |
| `NotifyEventFn` | type | Persist-first notification pipeline function |

**Naming verdict:** `HubNetworking` leaks deployment identity into what is structurally a reusable MCP session server. **Recommend: rename to `SessionServer` / `session-server.ts`** — describes what it does (MCP session lifecycle, SSE push, keepalive) without coupling to what it's deployed as. Additionally, server-side and client-side share MCP session wire primitives that could be deduplicated into `@ois/network-adapter`. The conceptual model is **TX/RX**: `McpTransport` is the TX (transmit/client) half and `SessionServer` is the RX (receive/server) half of the same wire protocol — SSE framing, keepalive semantics, session lifecycle, all mirrored. The network-adapter package becomes the canonical wire spec, and each side pulls what it needs. See **idea-51**.

### 2.2 State & Entity Types — `state.ts`

All domain entity interfaces and store contracts.

| Export | Kind | Purpose |
|---|---|---|
| **Task domain** | | |
| `Task` | interface | Task entity: directive, report, review, status, dependencies |
| `TaskStatus` | type | FSM states: pending → working → in_review → completed/failed/cancelled |
| `ITaskStore` | interface | Store contract: submitDirective, findByIdempotencyKey, lifecycle methods |
| `MemoryTaskStore` | class | In-memory implementation |
| **Agent domain** | | |
| `Agent` | interface | M18 Agent entity: fingerprint, role, status, epoch, metadata |
| `AgentRole` | type | `"engineer" \| "architect" \| "director"` |
| `AgentStatus` | type | `"online" \| "offline"` |
| `AgentClientMetadata` | interface | Client info from handshake |
| `AgentAdvisoryTags` | interface | Advisory metadata (llmModel) |
| `RegisterAgentPayload` | interface | M18 registration body |
| `RegisterAgentResult` | type | Success or failure union |
| `RegisterAgentSuccess` | interface | Success: engineerId, sessionEpoch, wasCreated |
| `RegisterAgentFailure` | interface | Failure: code, message |
| `EngineerStatusEntry` | interface | Projected view for get_engineer_status |
| `SessionRole` | type | `"engineer" \| "architect" \| "unknown"` |
| `IEngineerRegistry` | interface | Store contract: setSessionRole, getRole, M18 Agent methods |
| `MemoryEngineerRegistry` | class | In-memory implementation |
| **Proposal domain** | | |
| `Proposal` | interface | Proposal entity: title, summary, status, executionPlan, scaffold |
| `ProposalStatus` | type | FSM: submitted → approved/rejected/changes_requested → implemented |
| `ProposedExecutionPlan` | interface | Plan with missions and tasks arrays |
| `ExecutionPlanMission` | interface | Mission in plan: idRef, title, description |
| `ExecutionPlanTask` | interface | Task in plan: idRef, missionRef, title, dependsOn |
| `ScaffoldResult` | interface | idRef→generatedId mappings after scaffolding |
| `IProposalStore` | interface | Store contract |
| `MemoryProposalStore` | class | In-memory implementation |
| **Thread domain** | | |
| `Thread` | interface | Thread entity: title, status, messages, convergence tracking |
| `ThreadStatus` | type | active → converged/round_limit/closed |
| `ThreadIntent` | type | decision_needed, agreement_pending, etc. |
| `ThreadAuthor` | type | `"engineer" \| "architect"` |
| `SemanticIntent` | type | 9 semantic modes: seek_rigorous_critique, collaborative_brainstorm, etc. |
| `ThreadMessage` | interface | Single message with metadata |
| `ConvergenceAction` | interface | Late-binding action on convergence |
| `ConvergenceActionType` | type | `"create_task" \| "create_proposal"` |
| `IThreadStore` | interface | Store contract |
| `MemoryThreadStore` | class | In-memory implementation |
| **Audit domain** | | |
| `AuditEntry` | interface | Append-only log entry: timestamp, actor, action, details |
| `IAuditStore` | interface | Store contract: logEntry, listEntries |
| `MemoryAuditStore` | class | In-memory implementation |
| **Notification domain** | | |
| `Notification` | interface | Event notification: id, event, targetRoles, data, timestamp |
| `INotificationStore` | interface | Store contract: persist, listSince, cleanup |
| `MemoryNotificationStore` | class | In-memory implementation |
| **Utilities** | | |
| `computeFingerprint` | function | sha256(globalInstanceId) for Agent identity |
| `shortHash` | function | First 12 hex chars for display |
| `recordDisplacementAndCheck` | function | Thrashing detection circuit breaker |
| `THRASHING_WINDOW_MS` | const | 60000ms window |
| `THRASHING_THRESHOLD` | const | 3 displacements before trip |
| `AGENT_TOUCH_MIN_INTERVAL_MS` | const | 30000ms heartbeat rate limit |

**Naming verdict:** `state.ts` is a 900+ line file housing all domain types. The name is vague — it's really the **domain model**. **Recommend: no rename** — splitting into per-domain files would be better than renaming, but that's a separate mission. The `IEngineerRegistry` name is a legacy holdover from pre-M18 when only "engineers" existed; it now manages all Agent roles. **Recommend: future rename to `IAgentRegistry`** when breaking changes are acceptable.

### 2.3 GCS State — `gcs-state.ts`

GCS-backed store implementations + OCC (optimistic concurrency control) primitives.

| Export | Kind | Purpose |
|---|---|---|
| `readJson` / `writeJson` | functions | Basic GCS JSON read/write |
| `readJsonWithGeneration` | function | OCC read: returns data + generation number |
| `GcsOccPreconditionFailed` | class | Error for generation mismatch |
| `writeJsonWithPrecondition` | function | OCC write: fails if generation changed |
| `getAndIncrementCounter` | function | Atomic counter increment |
| `reconcileCounters` | function | Scans entities, fixes counter drift |
| `cleanupOrphanedFiles` | function | Deletes NaN-named corruption artifacts |
| `GcsTaskStore` | class | GCS `ITaskStore` implementation |
| `GcsEngineerRegistry` | class | GCS `IEngineerRegistry` implementation |
| `GcsProposalStore` | class | GCS `IProposalStore` implementation |
| `GcsThreadStore` | class | GCS `IThreadStore` implementation |
| `GcsAuditStore` | class | GCS `IAuditStore` implementation |
| `GcsNotificationStore` | class | GCS `INotificationStore` with ULID v2 namespace |

**Naming verdict:** `gcs-state.ts` is a 1200+ line file. Same observation as `state.ts` — "state" is vague. The `Gcs*` class prefix is good and consistent. No rename needed but would benefit from splitting in a future mission.

### 2.4 GCS Documents — `gcs-document.ts`

Unstructured document storage (separate from entity state).

| Export | Kind | Purpose |
|---|---|---|
| `DocumentInfo` | interface | File metadata: path, size, contentType, timestamps |
| `listDocuments` | function | Lists docs in GCS prefix |
| `writeDocument` | function | Writes doc with content validation |
| `readDocument` | function | Reads doc, returns content + contentType |

**Naming verdict:** Clean. No changes needed.

### 2.5 Webhook — `webhook.ts`

Fire-and-forget webhook to Architect on state changes.

| Export | Kind | Purpose |
|---|---|---|
| `WebhookEvent` | interface | Payload: event, timestamp, data |
| `fireWebhook` | function | POST to Architect with single retry |

**Naming verdict:** Clean. No changes needed.

### 2.6 Entities — `entities/`

Newer domain entities added post-M18: Idea, Mission, Turn, Tele.

| Entity | Types | Store Interface | Memory Impl | GCS Impl |
|---|---|---|---|---|
| **Idea** | `Idea`, `IdeaStatus` | `IIdeaStore` | `MemoryIdeaStore` | `GcsIdeaStore` |
| **Mission** | `Mission`, `MissionStatus` | `IMissionStore` | `MemoryMissionStore` | `GcsMissionStore` |
| **Turn** | `Turn`, `TurnStatus` | `ITurnStore` | `MemoryTurnStore` | `GcsTurnStore` |
| **Tele** | `Tele` | `ITeleStore` | `MemoryTeleStore` | `GcsTeleStore` |

**Naming verdict:** Consistent pattern — each entity follows `Entity` / `EntityStatus` / `IEntityStore` / `MemoryEntityStore` / `GcsEntityStore`. This is the gold standard for naming in the codebase. The older entities in `state.ts` (Task, Thread, Proposal, Audit, Notification) should eventually migrate to this pattern.

**`Tele`** — short for "teleonomy" (purpose/goal). Non-obvious name; warrants a one-line doc comment at the interface definition. Otherwise the abbreviation is intentional domain vocabulary.

### 2.7 AMP (Agentic Messaging Protocol) — `amp/`

Monotonic ULID-based message envelopes for notification ordering.

| Export | Kind | Purpose |
|---|---|---|
| `AmpEnvelope` | interface | Message envelope: id (ULID), type, correlationId, sourceRole, targetRoles, payload |
| `createEnvelope` | function | Factory for monotonic ULID envelopes |
| `isLegacyCursor` | function | Detects integer vs ULID Last-Event-ID |

**Naming verdict:** Clean. AMP is a well-scoped protocol module. No changes needed.

### 2.8 Policy Router — `policy/`

Registry-based command router. Each domain registers its tools, RBAC, and FSM transitions.

| Export | Kind | Purpose |
|---|---|---|
| `PolicyRouter` | class | Central router: register tools, handle invocations, drain internal events |
| `IPolicyContext` | interface | Per-invocation context: stores, emit, sessionId, role, clientIp |
| `PolicyResult` | interface | Handler return: content array, optional isError |
| `PolicyHandler` | type | `(args, ctx) => Promise<PolicyResult>` |
| `ToolRegistration` | interface | Tool metadata: name, description, schema, handler, deprecatedAlias |
| `DomainEvent` | interface | Internal synchronous event: type + payload |
| `AllStores` | interface | Aggregate of all 9 store interfaces |
| `FsmTransition` / `FsmTransitionTable` | types | State machine transition definitions |
| `isValidTransition` | function | Validates FSM transition |
| `PolicyContextFactory` | type | Factory creating fresh IPolicyContext per tool call |
| `bindRouterToMcp` | function | Wires all PolicyRouter tools to MCP server instance |

**Naming verdict:** `PolicyRouter` is accurate — it routes tool calls through policy handlers. The `Policy*` naming convention is consistent across the module. `bindRouterToMcp` in `mcp-binding.ts` is clean. No changes needed.

### 2.9 Policy Registrations

Each file registers tools for one domain. Consistent `register*Policy()` naming.

| File | Function | Tools Registered |
|---|---|---|
| `session-policy.ts` | `registerSessionPolicy` | register_role, get_engineer_status, migrate_agent_queue |
| `task-policy.ts` | `registerTaskPolicy` | create_task, get_task, get_report, submit_report, complete_sync + `TASK_FSM` |
| `system-policy.ts` | `registerSystemPolicy` | get_pending_actions, register_role (cross-domain) |
| `proposal-policy.ts` | `registerProposalPolicy` | create_proposal, list_proposals, create_proposal_review, get_proposal, close_proposal |
| `thread-policy.ts` | `registerThreadPolicy` | create_thread, create_thread_reply, get_thread, list_threads, close_thread |
| `clarification-policy.ts` | `registerClarificationPolicy` | create_clarification, resolve_clarification, get_clarification |
| `review-policy.ts` | `registerReviewPolicy` | create_review, get_review |
| `audit-policy.ts` | `registerAuditPolicy` | create_audit_entry, list_audit_entries |
| `document-policy.ts` | `registerDocumentPolicy` | get_document, create_document, list_documents |
| `idea-policy.ts` | `registerIdeaPolicy` | create_idea, list_ideas, update_idea + `IDEA_FSM` |
| `mission-policy.ts` | `registerMissionPolicy` | create_mission, update_mission, get_mission, list_missions + `MISSION_FSM` |
| `turn-policy.ts` | `registerTurnPolicy` | create_turn, update_turn, get_turn, list_turns + `TURN_FSM` |
| `tele-policy.ts` | `registerTelePolicy` | create_tele, get_tele, list_tele |

**Naming verdict:** Highly consistent. Each policy file maps 1:1 to a domain. The `register*Policy` convention is clean and discoverable. No changes needed.

### 2.10 Test Utilities — `policy/test-utils.ts`

| Export | Kind | Purpose |
|---|---|---|
| `EmittedEvent` | interface | Captured event for test assertions |
| `TestPolicyContext` | interface | Extended IPolicyContext with emittedEvents array |
| `createTestContext` | function | Factory for in-memory test context with all 9 stores |

**Naming verdict:** Clean. No changes needed.

---

## 3. `adapters/claude-plugin/` — Claude Code Plugin

MCP proxy adapter that bridges Claude Code to the Hub.

### 3.1 Proxy — `proxy.ts`

No public exports — self-contained entry point. Internally uses `McpAgentClient` from `@ois/network-adapter` to maintain Hub session, creates local MCP server, proxies tool calls, and handles SSE event delivery with push-to-LLM.

**Naming verdict:** `proxy.ts` is accurate — it proxies MCP between Claude Code and the Hub. No changes needed.

---

## 4. `adapters/opencode-plugin/` — OpenCode Plugin

### 4.1 Hub Notifications — `hub-notifications.ts`

| Export | Kind | Purpose |
|---|---|---|
| `HubPlugin` | const | OpenCode plugin entry point: initializes adapter, starts proxy, manages event lifecycle |

**Naming verdict:** `hub-notifications.ts` is misleading — it's the full plugin, not just notifications. **Recommend: rename to `plugin.ts`** or `index.ts` to match its actual scope. The export name `HubPlugin` is appropriate.

---

## 5. `agents/vertex-cloudrun/` — Architect Agent

Cloud Run Node.js agent running Gemini 3.1 Pro. Sandwich-pattern autonomous agent.

### 5.1 Hub Adapter — `hub-adapter.ts`

| Export | Kind | Purpose |
|---|---|---|
| `HubAdapter` | class | Typed wrapper around McpAgentClient with convenience methods per tool |
| `HubEventHandler` | type | `(eventData: Record<string, unknown>) => void` |

**Naming verdict:** `HubAdapter` is accurate but could collide conceptually with `@ois/network-adapter`. The distinction is that `HubAdapter` is an Architect-specific convenience layer over `McpAgentClient`, not a generic adapter. **Recommend: keep as-is** — the scope is clear within the agent package.

### 5.2 LLM Integration — `llm.ts`

| Export | Kind | Purpose |
|---|---|---|
| `ARCHITECT_SYSTEM_PROMPT` | const | System prompt for Gemini with role, tool tagging, behavior rules |
| `generateText` | function | Single-shot generation (sandwich REASON step) |
| `ToolExecutor` | type | `(name, args) => Promise<Record<string, unknown>>` |
| `mcpToolsToFunctionDeclarations` | function | MCP schema → Gemini FunctionDeclaration conversion |
| `generateWithTools` | function | Multi-turn conversation with function calling (Director chat) |

**Naming verdict:** `llm.ts` is generic but adequate for a single-agent package. No changes needed.

### 5.3 Sandwich Handlers — `sandwich.ts`

| Export | Kind | Purpose |
|---|---|---|
| `sandwichReviewReport` | function | FETCH report → REASON → EXECUTE review + audit |
| `sandwichReviewProposal` | function | FETCH proposal → REASON → EXECUTE proposal_review |
| `sandwichThreadReply` | function | FETCH thread → REASON → EXECUTE reply + audit |
| `sandwichThreadConverged` | function | FETCH thread → REASON → EXECUTE task or audit |
| `sandwichClarification` | function | REASON → EXECUTE resolve_clarification + audit |

**Naming verdict:** The `sandwich*` prefix is distinctive and self-documenting. The pattern name (FETCH→REASON→EXECUTE) is documented in ARCHITECTURE.md. No changes needed.

### 5.4 Event Loop — `event-loop.ts`

| Export | Kind | Purpose |
|---|---|---|
| `startEventLoop` | function | Starts 300s polling loop for pending Hub actions |
| `stopEventLoop` | function | Cancels active timer |
| `resetEventLoopTimer` | function | Restarts countdown after state-sync |
| `triggerImmediatePoll` | function | Forces immediate poll cycle |

**Naming verdict:** Clean. No changes needed.

### 5.5 Notifications — `notifications.ts`

| Export | Kind | Purpose |
|---|---|---|
| `handleHubEvent` | function | SSE event → dedup → classify → dispatch to sandwich handler |
| `handleWebhookEvent` | function | Webhook fallback with same dispatch logic |

**Naming verdict:** Clean. No changes needed.

### 5.6 Context Store — `context.ts`

| Export | Kind | Purpose |
|---|---|---|
| `ContextStore` | class | GCS-backed institutional memory: system context, director history, reviews, decisions |
| `ContextConfig` | interface | Config: bucket, GCS prefix |
| `Message` | interface | Chat message: role, text, timestamp |

**Naming verdict:** `ContextStore` is accurate — it stores Architect's accumulated context/memory. No changes needed.

### 5.7 Director Chat — `director-chat.ts`

| Export | Kind | Purpose |
|---|---|---|
| `createDirectorChatRouter` | function | Express router factory for POST /chat/session and /chat/message |

**Naming verdict:** Clean. No changes needed.

---

## 6. `clients/architect-chat/` — Chat Client

Python CLI for Director↔Architect conversation. Not a network participant (no adapter). Uses HTTP POST to Architect's /chat/* endpoints directly.

---

## Naming Recommendations Summary

| Current Name | Recommendation | Rationale |
|---|---|---|
| `IEngineerRegistry` | **Future: `IAgentRegistry`** | Pre-M18 legacy; now manages all agent roles, not just engineers |
| `MemoryEngineerRegistry` | **Future: `MemoryAgentRegistry`** | Same as above |
| `GcsEngineerRegistry` | **Future: `GcsAgentRegistry`** | Same as above |
| `get_engineer_status` (tool) | **Future: `get_agent_status`** | Wire-level rename requires coordinated mission |
| `hub-networking.ts` / `HubNetworking` | **Rename to `session-server.ts` / `SessionServer`** | Leaks deployment identity; structurally a reusable MCP session server (idea-51) |
| `opencode-plugin/hub-notifications.ts` | **Rename to `plugin.ts`** | File is the full plugin, not just notifications |
| `state.ts` (hub) | **Future: split by domain** | 900+ lines housing all domain types; split when practical |
| `gcs-state.ts` (hub) | **Future: split by domain** | 1200+ lines; split to match `entities/` pattern |
| All other names | **Keep as-is** | Names are appropriate, consistent, and well-scoped |

The codebase uses two strong naming patterns:
1. **Interface/Implementation pairs:** `ITransport`/`McpTransport`, `IAgentClient`/`McpAgentClient`, `ITaskStore`/`MemoryTaskStore`/`GcsTaskStore`
2. **Domain policy registration:** `register*Policy()` with 1:1 domain mapping

Both patterns should be preserved and extended to new code.
