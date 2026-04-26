# OpenCode Plugin — Quickstart

Install the OIS agent adapter plugin into OpenCode. This bridges OpenCode into the OIS agentic network as an Engineer agent via the MCP Relay Hub.

## Quick install (from GitHub)

No clone required. Point your OpenCode plugin config at the repo directly:

```jsonc
// .opencode/config.json
{
  "plugins": {
    "hub-notifications": {
      "github": "apnex/agentic-network",
      "path": "adapters/opencode-plugin/src/shim.ts"
    }
  }
}
```

Then configure credentials (see step 1 below) and launch OpenCode as usual.

---

## Developer install (from clone)

Use this path if you need to modify the plugin, deploy other components, or work on the codebase.

### Prerequisites

- OpenCode with plugin support and `@opencode-ai/plugin` SDK
- Bun runtime (the plugin uses `Bun.serve` for the local MCP proxy)
- Access to a running OIS Hub instance (URL + auth token)

### 1. Configure Hub credentials

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
```

The `OIS_` variables are shared across all OIS plugins.

### 2. Register the plugin

Add the plugin to your OpenCode configuration, pointing to the `src/shim.ts` file:

```jsonc
// .opencode/config.json (or your OpenCode plugin config)
{
  "plugins": {
    "hub-notifications": {
      "path": "/path/to/agentic-network/adapters/opencode-plugin/src/shim.ts"
    }
  }
}
```

The plugin exports `HubPlugin` which OpenCode loads at startup.

### 3. Launch OpenCode

Start OpenCode in your project directory as usual. The plugin initialises in the background:

1. Connects to the Hub via `McpAgentClient` (MCP Streamable HTTP)
2. Performs an enriched `register_role` handshake (M18 Agent identity)
3. Starts a local `Bun.serve` MCP proxy on a dynamic port
4. Begins listening for SSE notifications
5. Exposes all Hub tools to OpenCode via the local proxy

## How it works

Unlike the Claude Code plugin (which uses stdio), the OpenCode plugin runs a local HTTP MCP proxy via `Bun.serve`. OpenCode connects to this proxy as an MCP client, and the proxy forwards tool calls to the remote Hub.

Actionable notifications from the Hub are delivered via `promptAsync()` — injecting structured prompts directly into the LLM context. Informational events display as toasts via `showToast()`.

A rate limiter (30s) prevents prompt flooding. Events arriving during cooldown are queued and delivered when the window opens.

## Configuration reference

| Source | Location | Priority |
|---|---|---|
| Config file | `<workdir>/.ois/adapter-config.json` | Default |
| Environment | `OIS_HUB_URL`, `OIS_HUB_TOKEN`, `OIS_HUB_ROLE`, `HUB_PLUGIN_AUTO_PROMPT` | Overrides config file |

| Field | Required | Default | Description |
|---|---|---|---|
| `hubUrl` | Yes | — | Full URL of the Hub MCP endpoint (include `/mcp` path) |
| `hubToken` | Yes | — | Bearer token for Hub authentication |
| `role` | No | `engineer` | Agent role: `engineer` or `architect` |
| `autoPrompt` | No | `true` | Enable push-to-LLM via `promptAsync()` on actionable events |

## Troubleshooting

- **No Hub connection** — Check that `hubUrl` and `hubToken` are set in `.ois/adapter-config.json` or via `OIS_HUB_URL` and `OIS_HUB_TOKEN`. The URL must include the `/mcp` path.
- **Tools not appearing** — The plugin starts the Hub connection in the background after a short delay. Wait a few seconds, then check available tools.
- **Bun not found** — The local MCP proxy requires Bun runtime. Install from https://bun.sh.
- **Prompt flooding** — If notifications arrive too frequently, the 30s rate limiter queues them. Set `autoPrompt: false` to disable push-to-LLM entirely.

## Diagnostics

The plugin writes diagnostic logs to `<workdir>/.ois/hub-plugin.log` and structured notification logs to `~/.ois/notifications.log`.
