# Agentic Network: Architecture Overview

## Purpose

This document describes the agentic network infrastructure — the transport, routing, and connection management layer that enables distributed multi-agent communication. This layer is **functionally decoupled** from any specific agents, workflows, or tools running on top of it.

## System Topology

```
┌─────────────────┐          ┌─────────────────────────┐          ┌──────────────────────┐
│   Agent A        │          │         Hub              │          │   Agent B             │
│                  │          │    (Relay Router)         │          │                      │
│  ┌────────────┐  │   MCP    │  ┌───────────────────┐  │   MCP    │  ┌────────────────┐  │
│  │ Connection │◄─┼──HTTP/SSE┼─►│  Session Manager   │◄─┼──HTTP/SSE┼─►│  Connection     │  │
│  │ Manager    │  │          │  │                     │  │          │  │  Manager        │  │
│  └────────────┘  │          │  ├───────────────────┤  │          │  └────────────────┘  │
│                  │          │  │  Notification       │  │          │                      │
│  Agent Logic     │          │  │  Broker             │  │          │  Agent Logic          │
│  (excluded)      │          │  ├───────────────────┤  │          │  (excluded)           │
│                  │          │  │  Tool Router        │  │          │                      │
│                  │          │  │  (28 tools)         │  │          │                      │
│                  │          │  └───────────────────┘  │          │                      │
└─────────────────┘          └─────────────────────────┘          └──────────────────────┘
                                        │
                                        │ GCS
                                        ▼
                              ┌───────────────────┐
                              │  Persistence       │
                              │  (GCS or Memory)   │
                              └───────────────────┘
```

## Three Components

### 1. Hub (Relay Router)

**What it is:** A central message router deployed as a Cloud Run service. It hosts MCP server sessions, brokers notifications between connected agents, and manages session lifecycle.

**Source:** `hub/src/index.ts`
**Runtime:** Node.js 22 on Cloud Run
**Network role:** Server — accepts inbound MCP connections from agents

**Infrastructure responsibilities:**
- Accept and manage MCP sessions (one per connected agent)
- Route tool calls to the appropriate handler
- Broadcast notifications to connected agents via SSE
- Persist notifications to GCS for replay on reconnection
- Emit keepalive heartbeats to all SSE streams
- Reap stale sessions
- Authenticate inbound connections

**What is NOT infrastructure:** The 28 tool implementations (task management, proposals, threads, etc.) are workflow logic built on top of the router. The router does not know or care what the tools do.

### 2. Network Adapter Package (`@ois/network-adapter`)

**What it is:** A reusable client library that any agent imports to connect to the Hub. Split into two layers: an L4 wire transport (`ITransport` / `McpTransport`) that owns the MCP streamable-HTTP socket, SSE watchdog, and wire-level reconnect, and an L7 session client (`IAgentClient` / `McpAgentClient`) that owns the session FSM, enriched handshake, state sync, and session-invalid retry. Dual-channel health monitoring and automatic reconnection at both layers.

**Source:** `packages/network-adapter/src/`
**Runtime:** Any Node.js or Bun environment
**Network role:** Client — establishes outbound MCP connection to the Hub

**Infrastructure responsibilities:**
- Establish and maintain a persistent MCP connection to the Hub
- Monitor connection health on both HTTP POST and SSE channels
- Detect and recover from session invalidation, SSE death, and network failures
- Expose tool execution and notification subscription to the consuming agent
- Classify and propagate reconnection reasons

**What is NOT infrastructure:** Nothing. This package is 100% infrastructure — it has zero agent or workflow logic.

### 3. Universal Adapter (Plugin)

**What it is:** An OpenCode plugin that bridges the remote Hub to the local LLM. It runs a local MCP proxy server, forwards tool calls to the Hub, and delivers notifications to the LLM via Push-to-LLM.

**Source:** `adapters/opencode-plugin/src/shim.ts` + `dispatcher.ts`
**Runtime:** Bun (via OpenCode plugin system)
**Network role:** Proxy — bridges remote Hub to local MCP client (OpenCode)

**Infrastructure responsibilities:**
- Run a local MCP server that OpenCode connects to
- Discover tools from the Hub and expose them locally
- Forward tool calls from OpenCode to the Hub
- Receive notifications from the Hub and deliver them to the LLM
- Deduplicate notifications and persist Last-Event-ID
- Rate-limit and queue notifications to protect the LLM
- Manage the session lifecycle between OpenCode and the Hub

**What is NOT infrastructure:** The prompt text templates and toast message formatting are thin presentation glue specific to the Engineer role. The notification classification (which events are "actionable" vs "informational") is policy that could be configurable.

## Component Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│                    INFRASTRUCTURE LAYER                      │
│                                                             │
│  ┌───────────┐    ┌──────────────────┐    ┌──────────────┐ │
│  │    Hub     │    │  network-adapter  │    │   Adapter    │ │
│  │  (Router)  │    │  (Client Lib)     │    │   (Proxy)    │ │
│  │           │    │                  │    │              │ │
│  │  Session   │    │  State Machine    │    │  Tool Fwd    │ │
│  │  Manager   │    │  Health Monitor   │    │  Notif Pipe  │ │
│  │  Notif     │    │  Reconnection     │    │  Push-to-LLM │ │
│  │  Broker    │    │  Backoff          │    │  Safety      │ │
│  │  Keepalive │    │                  │    │              │ │
│  │  Auth      │    │                  │    │              │ │
│  └───────────┘    └──────────────────┘    └──────────────┘ │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                     AGENT/WORKFLOW LAYER                     │
│                                                             │
│  28 MCP Tools    Architect Logic    Engineer Logic           │
│  GCS Stores      Gemini LLM         OpenCode LLM            │
│  Workflow FSMs   Event Loop          AGENTS.md               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Deployment Model

| Component      | Environment              | Instances | Persistence       |
| -------------- | ------------------------ | --------- | ----------------- |
| Hub            | Cloud Run (aus-se1)      | min 1     | GCS or in-memory  |
| network-adapter| Embedded in each agent   | N/A       | None (stateless)  |
| Adapter        | Local (Bun via OpenCode) | 1         | Local filesystem  |

**Network topology:** Star — all agents connect to the central Hub. Agents do not communicate directly with each other. The Hub is the single point of routing.

**Transport:** MCP Streamable HTTP — HTTP POST for request/response, HTTP GET for SSE notification streams. Both channels use the same endpoint URL (`/mcp`).

**Authentication:** Bearer token on all `/mcp` requests. Token shared between Hub and all agents via environment variable.

## Data Flow

### Tool Call (request/response)

```
OpenCode → [HTTP POST] → Adapter Proxy → [HTTP POST] → Hub → Tool Handler
OpenCode ← [HTTP 200]  ← Adapter Proxy ← [HTTP 200]  ← Hub ← Tool Result
```

### Notification (event-driven)

```
Hub Tool Handler → notificationStore.persist() → notifyConnectedAgents()
                                                        │
                                    ┌───────────────────┼───────────────────┐
                                    ▼                   ▼                   ▼
                              Agent A SSE          Agent B SSE         Webhook
                              (sendLoggingMessage)  (sendLoggingMessage)  (fallback)
```

### Notification Replay (on reconnect)

```
Agent reconnects → GET /mcp (Last-Event-ID: N) → Hub replays notifications > N
```

### Keepalive (liveness)

```
Hub → [SSE sendLoggingMessage logger="keepalive"] → All SSE sessions (every 30s)
                                                          │
                                                    ConnectionManager
                                                    updates lastKeepaliveAt
                                                    sets sseVerified=true
```

## Relationship to ADRs

| ADR     | Network Relevance                                                              |
| ------- | ------------------------------------------------------------------------------ |
| ADR-001 | MCP as universal transport — foundational network decision                     |
| ADR-004 | Universal MCP Network Adapter — the Plugin proxy architecture                  |
| ADR-005 | Persist-first notification delivery — notification broker design               |
| ADR-008 | Shared ConnectionManager — the `@ois/network-adapter` package (formerly `@ois/hub-connection`) |
| ADR-009 | SSE liveness monitoring — dual-channel health model                            |
| ADR-002 | Sandwich pattern — agent logic, NOT network infrastructure                     |
| ADR-003 | Node.js rewrite — agent decision, NOT network (though it unified the runtime)  |
| ADR-006 | Correlation IDs — workflow traceability, NOT network                           |
| ADR-007 | Stability phase — covers both network and agent issues (partially relevant)    |
