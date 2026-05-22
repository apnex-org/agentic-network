# OIS Platform Architecture

**Last updated:** 2026-05-22 (mission-87 W2 docs-currency pass)

## Overview

OIS is a distributed multi-agent software-engineering platform where three roles collaborate asynchronously:

- **Director** (human) — sets goals, reviews progress, makes strategic decisions
- **Architect** (LLM agent) — plans, governs, reviews, drives missions
- **Engineer** (LLM agent) — executes coding tasks

The Architect and the Engineer are each a host-LLM session (e.g. Claude Code) running the `@apnex/claude-plugin` agent-adapter — the *same* adapter, differentiated only by `role`. All inter-agent communication flows through a central **Hub** using MCP (Model Context Protocol) over Streamable HTTP with SSE notifications.

## System Diagram

```
┌──────────┐                            ┌────────────────────────────────────┐
│ Director │ ◄────── host session ─────► │ Architect — host-LLM session       │
│ (human)  │                             │   @apnex/claude-plugin, role=architect│
└──────────┘                             │   network-adapter → Hub /mcp       │
                                         └────────────┬───────────────────────┘
                                                      │ MCP (Streamable HTTP + SSE)
                                                      ▼
                                         ┌────────────────────────────────────┐
                                         │ Hub — GCE VM (australia-southeast1) │
                                         │   docker-compose: Hub + Postgres    │
                                         │     + Watchtower                    │
                                         │   Cloud Run nginx proxy (TLS/ingress)│
                                         │   PolicyRouter — 71 MCP tools        │
                                         │   HubStorageSubstrate (postgres)     │
                                         │   SSE notifications (persist-first)  │
                                         │   Last-Event-ID replay               │
                                         └────────────┬───────────────────────┘
                                                      │ MCP notifications (SSE)
                                                      ▼
┌──────────┐                             ┌────────────────────────────────────┐
│ Engineer │ ◄────── host session ─────► │ Engineer — host-LLM session        │
│ (human + │                             │   @apnex/claude-plugin, role=engineer│
│  LLM)   │                             │   (opencode-plugin is the alt host) │
└──────────┘                             │   network-adapter → Hub /mcp       │
                                         └────────────────────────────────────┘
```

## Shared Packages

### `@apnex/network-adapter` (`packages/network-adapter/`)

The shared Universal MCP Network Adapter, used by both the Architect and Engineer host sessions via their per-host plugin (`adapters/claude-plugin/` — a.k.a. `plugin:agent-adapter:proxy` — and `adapters/opencode-plugin/`). Split into two layers:

**L4 — Wire transport**
- **`ITransport` / `McpTransport`** — owns the MCP streamable-HTTP socket, SSE watchdog, heartbeat POST, and wire-level reconnect. Emits `WireEvent`s (`state`, `reconnecting`, `reconnected`, `closed`, `push`). Coarse 3-state wire FSM: `disconnected → connecting → connected`.
- **30s heartbeat + 90s SSE watchdog** — dual-channel liveness; any failure lifts to an L7 reconnect with a classified `WireReconnectCause`.

**L7 — Session client**
- **`IAgentClient` / `McpAgentClient`** — owns the 5-state session FSM (`disconnected → connecting → synchronizing → streaming → reconnecting`), the enriched `register_role` handshake, state-sync RPCs, `session_invalid` retry-once, and event classification/dedup. Exposes `AgentClientCallbacks` (`onActionableEvent`, `onInformationalEvent`, `onStateChange`) to shims.
- **Shim surface** — shims never touch `McpTransport` directly; they pass a `transportConfig` to `new McpAgentClient(...)` and consume callbacks.

The adapter's tool-manager (`tool-manager/dispatcher.ts`) owns the MCP Initialize / ListTools / CallTool handlers and a probe-safe tool-catalog cache.

## Components

### Hub (`hub/`)

The central state store and message broker. All agent communication is mediated by the Hub.

- **Runtime:** Node.js 22, deployed as a docker-compose stack (Hub + Postgres + Watchtower) on a single internal-only GCE VM (`australia-southeast1`), fronted by a Cloud Run nginx proxy for public HTTPS + TLS termination. Provisioned by mission-86 (`deploy/hub/` + `modules/hub/`).
- **Transport:** MCP over Streamable HTTP (`POST/GET/DELETE /mcp`)
- **Storage:** `HubStorageSubstrate` — postgres with LISTEN/NOTIFY + JSONB + a SchemaDef reconciler (the sovereign state backplane since the mission-83 W5 cutover). FS-mode (gcs / local-fs) + memory-mode are retired from the production path; local-fs / memory survive only as test/dev affordances.
- **Auth:** Bearer token via `HUB_API_TOKEN` (or the mission-86 postgres-backed token store)

**Tool surface:** the `PolicyRouter` (Layer 7) registers 71 MCP tools across the domain policies (task, system, tele, audit, document, session, idea, mission, turn, clarification, review, proposal, thread, bug, pending-action, message, transport-heartbeat). `bindRouterToMcp` binds them onto each MCP session. Tools carry a tier annotation (`llm-callable` / `adapter-internal`); the shim filters adapter-internal-tier tools off the LLM catalogue surface.

**Persisted entities** live as JSONB rows in the substrate (20 SchemaDef-governed kinds — see `hub/scripts/entity-kinds.json`): Task, Proposal, Thread, Review, Report, Audit, Message, Agent, Idea, Mission, Turn, Tele, Clarification, Bug, PendingAction, Document, and supporting kinds.

**Notification delivery:** persist-first — write the Message entity to the substrate, then attempt SSE delivery, then webhook fallback. On client reconnect, missed Messages replay via `Last-Event-ID`. A poll-backstop (`list_messages` with a `since` cursor) catches any SSE gap.

**Session management:** a TTL reaper prunes inactive sessions; a keepalive heartbeat resets the TTL; session cleanup is atomic (transport + server + sse-active + last-activity).

### Architect (`role=architect`)

The governance and planning agent — drives missions, reviews work, manages threads. Runs as a host-LLM session (e.g. Claude Code) with `@apnex/claude-plugin` configured `role=architect`, connecting to the Hub `/mcp` endpoint via the bundled network-adapter.

The former standalone Cloud Run Architect service (`agents/vertex-cloudrun/` — a Vertex AI app) was deprecated and removed; the Architect is no longer a separately-deployed service.

### Engineer (`role=engineer`)

The execution agent — implements coding tasks, ships cross-approved PRs. Runs as a host-LLM session with the same `@apnex/claude-plugin` adapter configured `role=engineer` (the `@apnex/opencode-plugin` is the alternate host integration).

**Notification → wake:** an SSE notification from the Hub is routed through the adapter's `MessageRouter` and surfaced to the host as an actionable wake (claude `<channel>` injection / opencode `promptAsync`) so the LLM responds autonomously. Reconnect-drained pending actions surface via the same wake path (bug-108).

## Data Flow

### Task execution
```
Architect calls create_task → Hub stores the Task → Hub SSE-notifies the Engineer
  → Engineer wakes, calls get_task → executes the work → opens a cross-approved PR
  → Engineer calls create_report → Hub SSE-notifies the Architect
  → Architect calls create_review → Hub SSE-notifies the Engineer
```

### Thread discussion
```
Either agent calls create_thread → Hub stores it, SSE-notifies the other party
  → Recipient replies via create_thread_reply (turn-alternating)
  → Back-and-forth until convergence; at converged=true the reply commits the
    thread's staged convergenceActions (Threads 2.0 / ADR-013/014)
```

## Deployment

| Service | Platform | Region | Notes |
|---------|----------|--------|-------|
| Hub | GCE VM (docker-compose) | australia-southeast1 | Hub + Postgres + Watchtower; Cloud Run nginx proxy for TLS/ingress |
| Architect / Engineer | Host-LLM session | Developer machine | `@apnex/claude-plugin` agent-adapter, differentiated by `role` |

Local-dev Hub: `scripts/local/{build,start,stop}-hub.sh` run a Hub container against a local Postgres substrate; config via `~/.config/apnex-agents/hub.env`. See `deploy/README.md`.

## Key Design Decisions

See `docs/decisions/` for the detailed ADRs. Summary:

- **MCP as universal transport** — all communication over MCP Streamable HTTP + SSE (ADR-001)
- **Single connection per agent** — one MCP session per agent, managed by `@apnex/network-adapter`, split into L4 `McpTransport` + L7 `McpAgentClient` (ADR-008)
- **Persist-first notifications** — write the Message to the substrate before SSE delivery; replay via Last-Event-ID (ADR-005)
- **Universal agent-adapter** — Architect and Engineer share one adapter, differentiated by `role`
- **Hub storage substrate** — postgres + LISTEN/NOTIFY + JSONB + SchemaDef reconciler as the sovereign state backplane (mission-83); see `docs/designs/m-hub-storage-substrate-design.md`
- **Communication semantics** — `semanticIntent` on thread messages for cognitive framing

## Testing

Each package carries a `vitest` suite (`npm test` per package); the Hub additionally runs postgres integration/e2e suites via testcontainers. CI runs the full matrix across the Hub, the network-adapter, the cognitive-layer, and both host plugins. The network-adapter L4/L7 split is exercised against an in-memory `TestHub` / `LoopbackTransport` harness.
