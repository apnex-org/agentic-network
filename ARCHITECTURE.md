# OIS Platform Architecture

**Last updated:** 2026-04-16 (Repo reorganization — see journal)

## Overview

OIS is a distributed multi-agent software engineering platform where three roles collaborate asynchronously:

- **Director** (human) — sets goals, reviews progress, makes strategic decisions
- **Architect** (cloud LLM agent) — plans, governs, reviews, issues directives
- **Engineer** (local LLM agent via OpenCode) — executes coding tasks

All communication flows through a central **Hub** using the MCP (Model Context Protocol) over Streamable HTTP with SSE notifications.

## System Diagram

```
┌──────────┐     architect-chat.sh      ┌────────────────────────────────────┐
│ Director │ ◄─────────────────────────► │ Architect (Cloud Run, Node.js)     │
│ (human)  │     POST /chat/message      │   gemini-3-flash-preview           │
└──────────┘                             │   Express HTTP server              │
                                         │   Sandwich pattern handlers        │
                                         │   Unified GCS context store        │
                                         │   SSE listener + 300s event loop   │
                                         └────────────┬───────────────────────┘
                                                      │ MCP Client
                                                      │ (StreamableHTTPClientTransport)
                                                      │ maxRetries: Infinity
                                                      ▼
                                         ┌────────────────────────────────────┐
                                         │ Hub (Cloud Run, Node.js)           │
                                         │   28 MCP tools                     │
                                         │   Express + MCP Server             │
                                         │   GCS persistence (all state)      │
                                         │   SSE notifications (persist-first)│
                                         │   Last-Event-ID replay             │
                                         │   30s keepalive, 24h TTL cleanup   │
                                         │   Audit trail                      │
                                         └────────────┬───────────────────────┘
                                                      │ MCP notifications (SSE)
                                                      │
                                                      ▼
┌──────────┐     Push-to-LLM            ┌────────────────────────────────────┐
│ Engineer │ ◄──────────────────────────│ OpenCode Plugin (local)            │
│ (LLM)   │     promptAsync()           │   Universal MCP Network Adapter    │
│          │                             │   Local MCP proxy (Bun.serve)      │
│          │ ───── tool calls ─────────► │   Dynamic tool discovery           │
│          │     architect-hub_*         │   SSE listener + Push-to-LLM      │
└──────────┘                             │   Notification queue + safety      │
                                         │   Config: .opencode/hub-config.json│
                                         └────────────────────────────────────┘
```

## Shared Packages

### `@ois/network-adapter` (`packages/network-adapter/`)

Shared Universal MCP Network Adapter package used by the Architect, the Claude Code plugin (`adapters/claude-plugin/`, a.k.a. `plugin:agent-adapter:proxy`), and the OpenCode plugin (`adapters/opencode-plugin/`). Split into two layers:

**L4 — Wire transport**
- **`ITransport` / `McpTransport`** — owns the MCP streamable-HTTP socket, SSE watchdog, heartbeat POST, and wire-level reconnect. Emits `WireEvent`s (`state`, `reconnecting`, `reconnected`, `closed`, `push`). Coarse 3-state wire FSM: `disconnected → connecting → connected`.
- **Atomic teardown** — nulls references, best-effort close, 1s settle, fresh reconnect on wire death.
- **30s heartbeat + 90s SSE watchdog** — dual-channel liveness; any failure lifts to an L7 reconnect with a classified `WireReconnectCause`.

**L7 — Session client**
- **`IAgentClient` / `McpAgentClient`** — owns the 5-state session FSM (`disconnected → connecting → synchronizing → streaming → reconnecting`), the enriched `register_role` handshake, state-sync RPCs (`get_task`, `get_pending_actions`), `session_invalid` retry-once, and event classification/dedup. Exposes `AgentClientCallbacks` (`onActionableEvent`, `onInformationalEvent`, `onStateChange`) to shims.
- **Shim surface** — shims never touch `McpTransport` directly; they pass a `transportConfig` to `new McpAgentClient(...)` and consume callbacks. A `getTransport()` escape hatch exists for advanced shims needing full MCP tool schemas via `McpTransport.listToolsRaw()`.

## Components

### Hub (`hub/`)

The central state store and message broker. All agent communication is mediated by the Hub.

- **Runtime:** Node.js 22 on Cloud Run (australia-southeast1)
- **Transport:** MCP over Streamable HTTP (`POST/GET/DELETE /mcp`)
- **Storage:** GCS bucket `ois-relay-hub-state`
- **Auth:** Bearer token via `HUB_API_TOKEN`

**Persisted entities (GCS):**

| Entity        | Path Pattern                      | Purpose                          |
|---------------|-----------------------------------|----------------------------------|
| Tasks         | `tasks/task-{id}.json`            | Directives, reports, reviews     |
| Proposals     | `proposals/prop-{id}.json`        | Design proposals + decisions     |
| Threads       | `threads/thread-{id}.json`        | Ideation discussions             |
| Reviews       | `reviews/task-{id}-review.md`     | Architect review assessments     |
| Reports       | `reports/task-{id}-report.md`     | Engineer engineering reports     |
| Audit         | `audit/audit-{ts}.json`           | Autonomous action log            |
| Notifications | `notifications/notif-{id}.json`   | Persistent notification queue    |
| Engineers     | `engineers/eng-{id}.json`         | Connection registry              |
| Counters      | `meta/counter.json`               | Monotonic ID generators          |

**MCP Tools (43 tools, 62 registrations with deprecated aliases):**

Tools are organized into domain modules in `src/tools/` with strict dependency injection. Each module accepts only the stores it needs. 19 tools have been renamed to a strict CRUD taxonomy; deprecated aliases remain for backward compatibility and emit `[DEPRECATION]` warnings.

- Task lifecycle: `create_task`, `get_task`, `create_report`, `get_report`, `cancel_task`, `list_tasks`, `get_pending_actions`
- Proposals: `create_proposal`, `list_proposals`, `create_proposal_review`, `get_proposal`, `close_proposal`
- Threads: `create_thread`, `create_thread_reply`, `get_thread`, `list_threads`, `close_thread`
- Clarifications: `create_clarification`, `resolve_clarification`, `get_clarification`
- Reviews: `create_review`, `get_review`
- System: `register_role`, `get_engineer_status`, `create_audit_entry`, `list_audit_entries`
- Documents: `get_document`, `create_document`, `list_documents`
- Ideas: `create_idea`, `list_ideas`, `update_idea`
- Missions: `create_mission`, `update_mission`, `get_mission`, `list_missions`
- Turns: `create_turn`, `update_turn`, `get_turn`, `list_turns`
- Tele: `create_tele`, `get_tele`, `list_tele`

**Notification delivery:** Persist to GCS first, then attempt SSE delivery, then webhook fallback. On client reconnect, replay missed notifications via `Last-Event-ID`. Notification replay polls for role registration (up to 2s) before executing, eliminating the race condition where replay fired before `register_role` completed.

**Session management:** 3min TTL reaper prunes inactive sessions every 60s. Orphan sessions (`role: unknown`) pruned after 60s. 30s keepalive heartbeat resets TTL. Atomic cleanup: transport + server + sseActive + lastActivity. Zombie session pruning: when a new session registers a role, dead sessions (SSE inactive) of the same role are aggressively pruned to prevent accumulation from Cloud Run connection draining. Hub `stop()` uses per-transport 2s timeout to prevent shutdown hangs.

### Architect (`agents/vertex-cloudrun/`, launched with `role=architect`)

The governance and planning agent. Reviews work, issues directives, manages threads.

- **Runtime:** Node.js 22 on Cloud Run
- **LLM:** `gemini-3-flash-preview` via `@google/genai` (Vertex AI). The model ID is hardcoded at `agents/vertex-cloudrun/src/llm.ts:19`; see ADR-012 for the error-surfacing and context-economy contracts around Gemini calls.
- **Hub connection:** `hub-adapter.ts` → `@ois/network-adapter` `McpAgentClient` with `manualSync: true` (shared with Plugin)
- **Director interface:** `POST /chat/session`, `POST /chat/message` (multi-turn with function calling)

**Key patterns:**
- **Sandwich pattern:** deterministic FETCH (hub-adapter) → LLM REASON → deterministic EXECUTE (hub-adapter). LLM only handles non-deterministic reasoning.
- **SSE listener:** receives Hub notifications, dispatches to sandwich handlers
- **Event loop:** 300s catch-up polling via `get_pending_actions`
- **Context store:** unified GCS-backed memory (`context.ts`) with `buildDirectorContext()` (full history) and `buildAutonomousContext()` (compressed summary)

### Engineer Plugin (`adapters/opencode-plugin/src/shim.ts` + `dispatcher.ts`)

The Universal MCP Network Adapter shim for OpenCode. Manages the single MCP connection from OpenCode to the Hub.

- **Runtime:** Bun (via OpenCode Plugin system)
- **Architecture:** MCP-to-MCP proxy — local MCP Server (Bun.serve) forwarding to remote Hub via `@ois/network-adapter` `McpAgentClient`
- **Config:** `.opencode/hub-config.json` (hubUrl, hubToken, role, autoPrompt)
- **Registration:** calls `client.mcp.add("architect-hub", ...)` to register proxy with OpenCode dynamically

**Push-to-LLM:** SSE notifications from Hub → Plugin notification handler → `client.session.promptAsync()` injects prompt into OpenCode session → LLM responds autonomously.

**Safety layers:**
- Idempotency cache (rolling 100 event hashes)
- Rate limiter (30s cooldown between autonomous prompts)
- Deferred backlog (rate-limited actionable events are queued, not dropped — attached to next successful prompt or flushed on `session.idle`)
- Director kill switch (`HUB_PLUGIN_AUTO_PROMPT=false`)
- Notification queue (buffers during active LLM processing, flushes on `session.idle`)

## Data Flow

### Directive Execution
```
Director tells Architect → Architect calls submit_directive → Hub stores task
  → Hub SSE notifies Engineer Plugin → Plugin prompts LLM → LLM calls get_directive
  → LLM executes work → LLM calls submit_report → Hub stores report
  → Hub SSE notifies Architect → Architect sandwich reviews → Architect calls submit_review
  → Hub SSE notifies Engineer Plugin → Plugin injects context (informational)
```

### Thread Discussion
```
Either agent calls open_thread → Hub stores, SSE notifies other party
  → Recipient auto-replies via sandwich handler → Hub stores, SSE notifies
  → Back-and-forth until both set converged=true → Thread status: converged
```

## Deployment

| Service        | Platform  | Region                 | Min Instances | URL                                                  |
|----------------|-----------|------------------------|---------------|------------------------------------------------------|
| Hub            | Cloud Run | australia-southeast1   | 1             | mcp-relay-hub-5muxctm3ta-ts.a.run.app                |
| Architect      | Cloud Run | australia-southeast1   | 1             | architect-agent-614327680171.australia-southeast1.run.app |
| Engineer Plugin| Local     | Developer machine      | N/A           | 127.0.0.1:{random port}                              |

## Key Design Decisions

See `docs/decisions/` for detailed ADRs. Summary:

- **MCP as universal transport** — all communication over MCP Streamable HTTP + SSE (ADR-001)
- **Single connection per agent** — each agent has one MCP session to the Hub, managed by `@ois/network-adapter` — split into L4 `McpTransport` + L7 `McpAgentClient` (ADR-008)
- **Persist-first notifications** — write to GCS before SSE delivery, replay via Last-Event-ID (ADR-005)
- **Sandwich pattern** — deterministic fetch/execute, LLM only for reasoning (ADR-002)
- **Node.js everywhere** — Hub, Architect, Plugin all TypeScript (ADR-003)
- **Push-to-LLM** — Plugin uses OpenCode SDK to autonomously prompt the LLM on Hub events (ADR-004)
- **Shared network-adapter package** — L4/L7 split (`McpTransport` / `McpAgentClient`) prevents orphan sessions and decouples wire from session lifecycle (ADR-008)
- **Communication semantics** — `semanticIntent` on thread messages for cognitive framing (ADR in backlog)

## Testing

**68 automated tests** across 9 files in `packages/network-adapter/test/`. L4 tests run against real `McpTransport` + MCP SDK over an in-memory `TestHub`; L7 tests run against `McpAgentClient` + an in-memory `LoopbackTransport` / `LoopbackHub` harness.

**Run:** `cd packages/network-adapter && npm test`

| Category | Tests | File |
|----------|-------|------|
| Handshake primitives (unit) | 19 | `test/unit/handshake.test.ts` |
| Instance identity (unit) | 6 | `test/unit/instance.test.ts` |
| Deferred backlog (unit) | 19 | `test/unit/deferred-backlog.test.ts` |
| Reconnect backoff curve — G1 (unit) | 6 | `test/unit/reconnect-backoff.test.ts` |
| McpTransport L4 surface | 7 | `test/integration/mcp-transport.test.ts` |
| McpAgentClient L7 surface | 6 | `test/integration/mcp-agent-client.test.ts` |
| Register-role payload (Invariant #9) | 1 | `test/integration/register-role-payload.test.ts` |
| Sync-phase RPC ordering (Invariant #10) | 1 | `test/integration/sync-phase-rpcs.test.ts` |
| Invariant gap-fills — G2/G3/G4 | 3 | `test/integration/invariant-gaps.test.ts` |

Full test specification: `docs/network/06-test-specification.md`
