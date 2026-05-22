# OIS SDK Guide — Module Map

**Last updated:** 2026-05-22 (mission-87 W2 — rewritten as a module-concern map)

This guide maps each module in the OIS agentic network to **the one concern it
owns**. It deliberately does *not* enumerate exports, signatures, or types — that
detail lives in the code, which is the truth. A reference that mirrors the export
surface rots by construction (it can't stay isomorphic with the code without
constant manual re-sync); this guide states the stable architecture and points
you at the source for the volatile detail.

Read a module's source for its public surface; read this guide to know *which*
module to open.

---

## `packages/network-adapter/` — `@apnex/network-adapter`

The Universal MCP Network Adapter. Both host plugins (claude-plugin,
opencode-plugin) — and therefore both the Architect and Engineer agents —
consume it. Two layers: L4 wire, L7 session.

### Wire — L4 (`src/wire/`)
- `mcp-transport.ts` / `transport.ts` — the MCP streamable-HTTP socket: SSE
  liveness watchdog, heartbeat POST, wire-level reconnect with exponential
  backoff. Coarse 3-state wire FSM. Emits `WireEvent`s upward.

### Session kernel — L7 (`src/kernel/`)
- `mcp-agent-client.ts` / `agent-client.ts` — the session client: the 5-state
  session FSM, `register_role` handshake orchestration, event classification +
  callbacks to the host shim. Shims construct this and never touch the transport
  directly.
- `handshake.ts` — the enriched `register_role` handshake (agent identity,
  client metadata, advisory tags, fatal-code detection).
- `event-router.ts` — classifies Hub events (actionable / informational) for the
  agent's role and deduplicates them.
- `state-sync.ts` — on every reconnect, drains pending actions + re-syncs task
  state so nothing pushed while disconnected is lost.
- `poll-backstop.ts` — periodic `list_messages` poll + transport-heartbeat timer;
  the safety net behind the SSE push path.
- `session-claim.ts` — parses the `claim_session` response (eager-warmup path).

### Tool manager (`src/tool-manager/`)
- `dispatcher.ts` — the host-independent MCP boundary: owns the Initialize /
  ListTools / CallTool handlers, queue-item-id tracking, activity-FSM signal
  wrapping. Mounted by each host shim.
- `tool-catalog-cache.ts` — the probe-safe per-`WORK_DIR` tool-catalog cache
  (`.ois/tool-catalog.json`), keyed off the Hub's `toolSurfaceRevision` ETag
  (bug-114).

### Cross-cutting (`src/`)
- `prompt-format.ts` — renders Hub events into LLM-injectable prompts + TUI toasts.
- `notification-log.ts` — append-only notification log for shim observability.
- `logger.ts` — the structured logging surface shared across layers.
- `hub-error.ts` — error-envelope normalization.

## `packages/message-router/` — `@apnex/message-router`

Sovereign package: Message-ID dedup (push + poll race) + kind→hook routing. One
place owns "did we already surface this Message, and which host hook handles it."

## `packages/cognitive-layer/`

The optional cognitive pipeline — `onListTools` / `onCallTool` middleware
(tool-description enrichment, response summarization, telemetry). Composed into
`McpAgentClient` when not bypassed.

## `packages/storage-provider/` — `@apnex/storage-provider`

The sovereign six-primitive StorageProvider contract (ADR-024). Post-mission-84
this package is a **test-only affordance** — `MemoryStorageProvider` +
`contract.ts` + `conformance.ts`; the local-fs and GCS providers were retired at
the substrate cutover. Consumed by `@apnex/repo-event-bridge`'s cursor store.

## `packages/repo-event-bridge/` — `@apnex/repo-event-bridge`

Ingests GitHub repository events (PR open/close/merge, reviews, pushes) by
polling the GH API and dispatching them through the Hub's `create_message` verb.
Off by default (no `OIS_GH_API_TOKEN` → skipped). See `deploy/README.md`.

---

## `hub/` — OIS Relay Hub

The central state store + message broker. Production: a docker-compose stack on a
GCE VM (mission-86). See `ARCHITECTURE.md`.

- `index.ts` — bootstrap: builds the `PolicyRouter` (registers every domain
  policy), wires the storage substrate, constructs `HubNetworking`, computes the
  tool-surface revision.
- `hub-networking.ts` — `HubNetworking`: the Express + MCP session server — MCP
  session lifecycle, SSE push (persist-first), keepalive, the session reaper, the
  `/health` endpoint.
- `state.ts` — the domain entity types + store interfaces (the domain model).
- `webhook.ts` — the webhook fallback when no SSE session is connected.

### `policy/` — Layer 7 tool router
- `router.ts` — `PolicyRouter`: registry-based command router. Domain policies
  register tools (name, description, zod schema, handler, RBAC role-tag, tier);
  the router dispatches calls + drains internal domain events.
- `mcp-binding.ts` — `bindRouterToMcp`: binds every registered tool onto an MCP
  server instance.
- `tool-surface-revision.ts` — computes the `toolSurfaceRevision` ETag over the
  router's tool registrations (bug-114; served on `/health`).
- `<domain>-policy.ts` — one file per domain (task, system, tele, audit,
  document, session, idea, mission, turn, clarification, review, proposal,
  thread, bug, pending-action, message), each `register<Domain>Policy(router)`.
- `agent-projection.ts` — the single point-of-truth that projects an internal
  `Agent` to the canonical wire shape.

### `storage-substrate/` — `HubStorageSubstrate`
The sovereign state backplane since the mission-83 W5 cutover: postgres +
LISTEN/NOTIFY + JSONB + a SchemaDef reconciler.
- `postgres-substrate.ts` / `memory-substrate.ts` — the substrate implementations
  (memory is the test affordance).
- `schema-reconciler.ts` + `schemas/` — SchemaDef-driven table reconciliation
  (20 entity kinds — see `hub/scripts/entity-kinds.json`).
- `migration-runner.ts` + `migrations/` — SQL migration application at bootstrap.
- `token-store.ts` — the postgres-backed bearer-token store (mission-86).
- `repo-event-bridge-adapter.ts` — wires `@apnex/repo-event-bridge` to the substrate.

### `entities/`
Per-entity types (`bug.ts`, `idea.ts`, `message.ts`, `mission.ts`, `tele.ts`,
`pending-action.ts`, …) paired with their substrate repository
(`<entity>-repository-substrate.ts`). `substrate-counter.ts` issues monotonic
per-kind IDs.

### Supporting
- `handlers/` — internal-event + transport-heartbeat handlers.
- `amp/` — ULID envelope helpers (the `Message` entity, mission-56, is the live
  notification primitive).
- `admin/`, `middleware/`, `observability/`, `lib/` — admin routes, request
  middleware, telemetry, shared utilities.

---

## `adapters/` — host plugins

Per-host integration layers (Layer 3). Each constructs an `McpAgentClient` + the
shared tool-manager dispatcher and binds the adapter's events into the host's
render surface.

- `claude-plugin/` (`@apnex/claude-plugin`, a.k.a. `plugin:agent-adapter:proxy`)
  — `shim.ts`: the Claude Code host entry. stdio MCP transport; surfaces Hub
  events as `<channel>` actionable wakes. The Architect and Engineer agents both
  run this adapter, differentiated only by `role`.
- `opencode-plugin/` (`@apnex/opencode-plugin`) — `shim.ts` + `dispatcher.ts`:
  the OpenCode host entry. Bun.serve transport; surfaces events via the OpenCode
  SDK's `promptAsync`.
