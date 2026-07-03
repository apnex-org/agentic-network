# OpenCode Plugin — Quickstart

Install the OIS agent adapter plugin into OpenCode. This bridges OpenCode into the OIS agentic network as an Engineer agent via the MCP Relay Hub.

> **Release status:** mission-101 W6 prepares the npm package shape. The canonical post-release install target is `npm:@apnex/opencode-plugin`, but the final publish/release decision is gated later in the mission. Until that release is published, keep existing GitHub/source installs on their current pinned channel.

## Canonical install target — npm package

After the mission-101 release node publishes `@apnex/opencode-plugin`, configure OpenCode to load the package from npm:

```jsonc
// opencode.json or .opencode/config.json
{
  "plugin": ["npm:@apnex/opencode-plugin"]
}
```

Then configure credentials (see [Configure Hub credentials](#configure-hub-credentials)) and launch OpenCode as usual.

### What the npm package contains

The npm package is graph-published like the Claude/Pi family members:

- package entry: `dist/plugin-entry.js` — exports `HubPlugin` only, matching OpenCode's loader requirement that plugin exports are functions;
- runtime internals: `./shim` and `./runtime` subpath exports for tests/dev tooling;
- dependency graph: `@apnex/network-adapter` + `@modelcontextprotocol/sdk` (no direct cognitive/message-router dependency);
- package metadata/docs: `QUICKSTART.md`, `CHANGELOG.md`, `AGENTS.md`, `tsconfig.json`.

## Migration from GitHub/source config

Existing live OpenCode configs may point at the old GitHub/source channel, for example:

```jsonc
{
  "plugin": ["github:apnex/opencode-hub-plugin"]
}
```

or an older source-path object:

```jsonc
{
  "plugins": {
    "hub-notifications": {
      "github": "apnex/agentic-network",
      "path": "adapters/opencode-plugin/src/shim.ts"
    }
  }
}
```

After npm publication is approved, replace those entries with:

```jsonc
{
  "plugin": ["npm:@apnex/opencode-plugin"]
}
```

Do this as a coordinated cutover: restart OpenCode after changing the plugin source, then verify build identity and Hub registration.

## Legacy compatibility bridge — self-contained bundle

The repository still keeps the legacy self-contained bundle path:

```bash
npm run bundle --workspace=@apnex/opencode-plugin
# or, for the legacy release gate:
scripts/build/release-opencode-plugin.sh
```

That bundle emits `adapters/opencode-plugin/dist/shim.js`, inlines the `@apnex/*` runtime graph, and exports only `HubPlugin`. It is retained as a migration bridge for existing GitHub/source consumers, not as the canonical long-term distribution channel.

## Developer install from a clone

Use this path if you need to modify the plugin, deploy other components, or work on the codebase.

### Prerequisites

- OpenCode with plugin support and `@opencode-ai/plugin` SDK
- Bun runtime (the plugin uses `Bun.serve` for the local MCP proxy)
- Node.js 22+ for local workspace builds/tests
- Access to a running OIS Hub instance (URL + auth token)

### Build from source

```bash
npm install --no-audit --no-fund --ignore-scripts \
  --workspace=@apnex/cognitive-layer \
  --workspace=@apnex/message-router \
  --workspace=@apnex/network-adapter \
  --workspace=@apnex/opencode-plugin

npm run build --workspace=@apnex/cognitive-layer
npm run build --workspace=@apnex/network-adapter || true
npm run build --workspace=@apnex/message-router
rm -rf packages/network-adapter/dist
npm run build --workspace=@apnex/network-adapter
npm run build --workspace=@apnex/opencode-plugin
```

For local source development, point OpenCode at the workspace source file if your OpenCode version supports source-path plugins:

```jsonc
{
  "plugins": {
    "hub-notifications": {
      "path": "/path/to/agentic-network/adapters/opencode-plugin/src/shim.ts"
    }
  }
}
```

For package-shape testing without publishing:

```bash
npm pack --workspace=@apnex/opencode-plugin --dry-run --ignore-scripts --json
```

## Configure Hub credentials

In your project directory (where you run OpenCode), create a config file:

```bash
mkdir -p .ois
cat > .ois/adapter-config.json << 'EOF'
{
  "hubUrl": "https://your-hub-instance.run.app/mcp",
  "hubToken": "your-auth-token",
  "role": "engineer",
  "autoPrompt": true
}
EOF
```

Alternatively, set environment variables (these override the config file):

```bash
export OIS_HUB_URL="https://your-hub-instance.run.app/mcp"
export OIS_HUB_TOKEN="your-auth-token"
export OIS_HUB_ROLE="engineer"
export HUB_PLUGIN_AUTO_PROMPT="true"
export OIS_AGENT_NAME="steve"   # or another operator-managed identity
```

The `OIS_` variables are shared across all OIS plugins.

## Launch and verify

Start OpenCode in your project directory as usual. The plugin initialises in the background:

1. Connects to the Hub via `McpAgentClient` (MCP Streamable HTTP)
2. Performs an enriched `register_role` handshake with name-based identity
3. Starts a local `Bun.serve` MCP proxy on a dynamic port
4. Registers that proxy with OpenCode as the `architect-hub` MCP server
5. Begins listening for Hub notifications and exposes Hub tools to OpenCode

Verification checklist:

```bash
npm view @apnex/opencode-plugin version       # after npm release only
npm ls @apnex/opencode-plugin --depth=0       # if installed into a project-local plugin graph
```

Inside Hub/agent observability, confirm the OpenCode agent reports `proxyName: @apnex/opencode-plugin` and the expected adapter version/build identity.

## How it works

Unlike the Claude Code plugin (which uses stdio), the OpenCode plugin runs a local HTTP MCP proxy via `Bun.serve`. OpenCode connects to this proxy as an MCP client, and the proxy forwards tool calls to the remote Hub through `@apnex/network-adapter`.

Actionable notifications from the Hub are delivered via `promptAsync()` — injecting structured prompts directly into the LLM context. Informational events display as toasts via `showToast()`.

A coalescer/rate limiter prevents prompt flooding. Events arriving during cooldown are queued and delivered when the window opens.

## Configuration reference

| Source | Location | Priority |
|---|---|---|
| Config file | `<workdir>/.ois/adapter-config.json` | Default |
| Environment | `OIS_HUB_URL`, `OIS_HUB_TOKEN`, `OIS_HUB_ROLE`, `HUB_PLUGIN_AUTO_PROMPT`, `OIS_AGENT_NAME` | Overrides config file |

| Field | Required | Default | Description |
|---|---|---|---|
| `hubUrl` | Yes | — | Full URL of the Hub MCP endpoint (include `/mcp` path) |
| `hubToken` | Yes | — | Bearer token for Hub authentication |
| `role` | No | `engineer` | Agent role: `engineer` or `architect` |
| `autoPrompt` | No | `true` | Enable push-to-LLM via `promptAsync()` on actionable events |

| Env var | Required | Default | Description |
|---|---|---|---|
| `OIS_AGENT_NAME` | Yes | — | Name-based identity. Use one operator-managed name per running agent. |
| `OIS_INSTANCE_ID` | — | — | Retired; ignored by the adapter. |

## Troubleshooting

- **No Hub connection** — Check that `hubUrl` and `hubToken` are set in `.ois/adapter-config.json` or via `OIS_HUB_URL` and `OIS_HUB_TOKEN`. The URL must include the `/mcp` path.
- **Missing/duplicate identity** — Set `OIS_AGENT_NAME` to the intended agent name (for example `steve` or `greg`).
- **Tools not appearing** — The plugin starts the Hub connection in the background after a short delay. Wait a few seconds, then check available tools.
- **Bun not found** — The local MCP proxy requires Bun runtime. Install from https://bun.sh.
- **Prompt flooding** — If notifications arrive too frequently, the coalescer queues them. Set `autoPrompt: false` to disable push-to-LLM entirely.
- **Npm package not found** — The npm channel is only valid after the release node publishes `@apnex/opencode-plugin`. Before then, keep using the legacy GitHub/source channel.

## Diagnostics

The plugin writes diagnostic logs to `<workdir>/.ois/hub-plugin.log` and structured notification logs to `<workdir>/.ois/hub-plugin-notifications.log`.
