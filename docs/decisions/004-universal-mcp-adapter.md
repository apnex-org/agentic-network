# ADR-004: Universal MCP Network Adapter (Plugin Architecture)

**Date:** 2026-04-11
**Status:** Accepted
**Threads:** thread-8, thread-10, thread-11

## Decision

The Engineer's Hub connection is managed by an OpenCode Plugin that acts as a local MCP-to-MCP proxy. The Plugin runs a local MCP server (`Bun.serve` on a random port), forwards `tools/list` and `tools/call` to the remote Hub via a single MCP Client connection, and registers itself with OpenCode dynamically via `client.mcp.add()`.

## Rationale

Multiple approaches were evaluated:

1. **MCP server config in `opencode.json`** — simple but no SSE notification handling, no Push-to-LLM
2. **Plugin with static tool stubs** — non-blocking but requires manual maintenance of 28 tool definitions
3. **Plugin with dynamic discovery** — blocks OpenCode startup during MCP handshake (caused TUI hang)
4. **Code generation** — auto-generates tool stubs from Hub schema, but not dynamic
5. **MCP-to-MCP proxy** (chosen) — defers all network to background, dynamically registers proxy with OpenCode, tools appear when ready

The proxy pattern is the Universal MCP Network Adapter concept: a self-contained module that handles full bidirectional MCP transport. The same pattern is reusable for other LLM clients (Claude Desktop, Gemini CLI, future agents).

## What It Replaced

The `opencode.json` MCP server config entry for `architect-hub` was removed. Previously OpenCode managed the Hub MCP connection directly, but this didn't support SSE notifications or Push-to-LLM.

## Consequences

- Single MCP connection per agent (Plugin-managed)
- Dynamic tool discovery — tools auto-sync when Hub adds/removes tools
- Non-blocking startup — all network deferred to `setTimeout(3000)`
- Push-to-LLM via `client.session.promptAsync()` on Hub notifications
- Configuration via `.opencode/adapter-config.json` (no opencode.json changes needed)
- Plugin logs to `.opencode/hub-plugin.log` (no TUI interference)
- `Bun.serve({ idleTimeout: 0 })` required to prevent SSE stream closure
- `StreamableHTTPClientTransport({ maxRetries: Infinity })` required for persistent SSE

## See also

The load-bearing properties the adapter must hold (the rubric by which any future adapter change is judged — Modular, Portable, Resilient, Authoritative, Verifiable, Efficient) are codified in [`docs/network/00-network-adapter-architecture.md#1-goals-of-the-universal-adapter`](../network/00-network-adapter-architecture.md). Each goal is anchored in a concrete production scar.
