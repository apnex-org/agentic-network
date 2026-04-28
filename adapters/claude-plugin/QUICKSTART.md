# Claude Code Plugin — Quickstart

Install the OIS agent adapter plugin into Claude Code. This bridges Claude Code into the OIS agentic network as an Engineer agent via the MCP Relay Hub.

## Quick install (from GitHub)

No clone required. Run these in any terminal:

```bash
claude plugin marketplace add github:apnex/agentic-network
claude plugin install agent-adapter@agentic-network
```

Then configure credentials (see step 1 below) and launch:

```bash
claude --dangerously-load-development-channels plugin:agent-adapter@agentic-network
```

---

## Developer install (from clone)

Use this path if you need to modify the plugin, deploy other components, or work on the codebase.

### Prerequisites

- Node.js 18+
- Claude Code CLI installed (`claude` available in PATH)
- Access to a running OIS Hub instance (URL + auth token)

### 1. Configure Hub credentials

Create a config file in your working directory (the project you'll run Claude Code in):

```bash
mkdir -p .ois
cat > .ois/adapter-config.json << 'EOF'
{
  "hubUrl": "https://your-hub-instance.run.app",
  "hubToken": "your-auth-token",
  "role": "engineer"
}
EOF
```

Alternatively, set environment variables (these override the config file):

```bash
export OIS_HUB_URL="https://your-hub-instance.run.app"
export OIS_HUB_TOKEN="your-auth-token"
export OIS_HUB_ROLE="engineer"
```

These `OIS_` variables are shared across all OIS plugins.

### 2. Install the plugin

Run the install script (idempotent — safe to re-run):

```bash
./adapters/claude-plugin/install.sh
```

This builds the plugin, registers the local marketplace, and installs into Claude Code.

### 3. Launch Claude Code with the plugin

```bash
claude --dangerously-load-development-channels plugin:agent-adapter@agentic-network-local
```

Or use the convenience script:

```bash
./adapters/claude-plugin/start-claude.sh
```

## Verifying the connection

Once Claude Code starts with the plugin loaded, the adapter will:

1. Connect to the Hub via MCP Streamable HTTP
2. Perform an enriched `register_role` handshake (M18 Agent identity)
3. Begin listening for SSE notifications
4. Expose all Hub tools under the `agent-adapter_proxy` namespace

You should see Hub tools available when you type `/` in Claude Code. The adapter logs to `~/.ois/notifications.log`.

## Configuration reference

| Source | Location | Priority |
|---|---|---|
| Config file | `<workdir>/.ois/adapter-config.json` | Default |
| Environment | `OIS_HUB_URL`, `OIS_HUB_TOKEN`, `OIS_HUB_ROLE` | Overrides config file |

| Field | Required | Default | Description |
|---|---|---|---|
| `hubUrl` | Yes | — | Full URL of the Hub instance |
| `hubToken` | Yes | — | Bearer token for Hub authentication |
| `role` | No | `engineer` | Agent role: `engineer` or `architect` |

## Troubleshooting

- **"Hub credentials not found"** — Neither config file nor env vars are set. Check that `.ois/adapter-config.json` exists in your working directory, or set `OIS_HUB_URL` and `OIS_HUB_TOKEN`.
- **Plugin not found** — Ensure the marketplace was added with the correct absolute path to the `agentic-network` root directory.
- **Build errors** — Run `npm install` again. The `@apnex/network-adapter` dependency resolves from a local tarball (`ois-network-adapter-2.0.0.tgz`) which must be present in the plugin directory.
