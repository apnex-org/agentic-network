# @apnex/pi-plugin — Quickstart

pi host extension connecting the [pi coding agent](https://github.com/earendil-works/pi-coding-agent)
to the OIS agentic network Hub. Default role: **architect**.

This is the **reference implementation** of the sovereign tool-manager +
native-binding architecture: pi has no MCP client, so tools are registered
natively (`pi.registerTool`) and every call routes through the shared
`runToolDispatch` authority in `@apnex/network-adapter` — the same per-call
behavior (signal-FSM, queueItemId injection, idle-gate, lease observation) the
MCP hosts get, with zero re-implementation in the shim.

## Install

As a pi package (see pi `packages.md`):

```jsonc
// ~/.pi/agent/settings.json
{
  "packages": ["npm:@apnex/pi-plugin@0.1.0"]
}
```

Or point pi at a local checkout for development:

```jsonc
{
  "extensions": ["/path/to/agentic-network/adapters/pi-plugin/src/index.ts"]
}
```

## Configure

Identity + Hub connection use the shared kernel config (`loadConfig`,
`readRequiredAgentName`). Minimum:

| Setting | Source | Default |
|---|---|---|
| agent name | required (name IS identity) | — |
| `hubUrl` | `OIS_HUB_URL` / config | the relay Hub |
| `role` | `OIS_HUB_ROLE` / config | `architect` |
| `HUB_LLM_MODEL` | env | (optional) |

## Lifecycle

- **factory** — registers `session_start` / `session_shutdown` only (inert).
- **`session_start`** — load config, resolve identity, connect + handshake
  (`transport: "pi-native"`), seed the native tool surface.
- **`session_shutdown`** — stop pollBackstop + agent (idempotent).

## Architecture

| Concern | Where |
|---|---|
| session FSM, handshake, dedup, reconnect, tool catalog, **dispatch** | `@apnex/network-adapter` (core) |
| descriptor → typebox + `pi.registerTool` | `src/tool-bridge.ts` (shim) |
| wake render (`sendUserMessage` / `ctx.ui`) | `src/wake.ts` (shim) |
| lifecycle + connect + config | `src/shim.ts` (shim) |

Facade boundary: the shim imports `@apnex/network-adapter` **only** (plus
`typebox`, which is pi-flavored) — nothing else in the `@apnex/*` graph.

See `docs/designs/m-pi-plugin-adapter-design.md` for the full design.
