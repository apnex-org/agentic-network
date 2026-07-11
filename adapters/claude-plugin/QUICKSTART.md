# Claude Code Plugin — Quickstart

Install the OIS agent adapter plugin into Claude Code. This bridges Claude Code into the OIS agentic network as an Engineer agent via the MCP Relay Hub.

## Install (no source clone required)

The plugin ships on the public npm registry (npmdeliver0 / idea-492 — the
GitHub-Release vendored-tarball channel is retired). No clone, no workspace,
no toolchain — just `npm` + `bash`:

```bash
npm install -g @apnex/claude-plugin
bash "$(npm prefix -g)/lib/node_modules/@apnex/claude-plugin/install.sh"
```

`npm install` resolves the sovereign dependencies (`@apnex/network-adapter`
et al.) from the registry; `install.sh` (npm-installed mode) registers the
`agentic-network` marketplace and installs the plugin into Claude Code. Pin
an exact version for reproducible installs, e.g. `@apnex/claude-plugin@0.1.14`.

After install, configure credentials (see [Developer install §1
below](#1-configure-hub-credentials)) and launch:

```bash
claude --dangerously-load-development-channels plugin:agent-adapter@agentic-network
```

### Verify build identity

The npm-installed plugin embeds a build-info stamp. Confirm post-install:

```bash
cat ~/.claude/plugins/cache/agentic-network/agent-adapter/*/dist/build-info.json
```

Expect a JSON object with `commitSha`, `dirty`, `buildTime`, and
`branch` matching the release.

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

#### Per-agent identity (idea-251 D-prime)

The canonical per-agent config surface is `~/.config/apnex-agents/{name}.env`
— operator-managed file (chmod 600), one per agent identity, sourced by the
operator's per-name `start-{name}.sh` wrapper:

```bash
# ~/.config/apnex-agents/greg.env
OIS_AGENT_NAME=greg                # Identity (drives agentId derivation
                                   # in Hub: agent-{8-char-hash-of-name}).
                                   # 1-32 chars, alphanumeric + `_-`.
                                   # Reserved names rejected:
                                   # director / system / hub / engineer / architect
                                   # (case-insensitive).
GH_TOKEN=github_pat_...            # Other per-agent secrets / config
```

When `OIS_AGENT_NAME` is unset and `globalInstanceId` is also unset, the
Hub rejects the handshake (loud-error so the misconfiguration is visible).

> **Retired (idea-251 D-prime):** the legacy `OIS_INSTANCE_ID` env-var
> override is no longer read by the adapter. If still set in your wrappers,
> it is ignored. Use `OIS_AGENT_NAME` for identity instead.

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

| Env var | Required | Default | Description |
|---|---|---|---|
| `OIS_AGENT_NAME` | Yes (or transitional `globalInstanceId`) | — | idea-251 D-prime: identity input. Drives agentId derivation (`agent-{8-char-hash}`) and is surfaced as the display name in get_agents. 1-32 chars, alphanumeric + `_-`. Reserved: director/system/hub/engineer/architect. Set in `~/.config/apnex-agents/{name}.env`. |
| `OIS_INSTANCE_ID` | — | — | RETIRED (idea-251 D-prime). Ignored by adapter; remove from wrappers. |

## Troubleshooting

- **"Hub credentials not found"** — Neither config file nor env vars are set. Check that `.ois/adapter-config.json` exists in your working directory, or set `OIS_HUB_URL` and `OIS_HUB_TOKEN`.
- **Plugin not found** — Ensure the marketplace was added with the correct absolute path to the `agentic-network` root directory.
- **Build errors (developer install)** — Run `npm install` again from the repo root so workspace symlinks for `@apnex/{network-adapter,message-router,cognitive-layer}` are populated.
- **npm install fails to resolve `@apnex/...`** — `@apnex/network-adapter` (+ `cognitive-layer`, `message-router`) resolve from the npm registry as dependencies of `@apnex/claude-plugin`; a resolution failure is usually a registry/network issue — retry `npm install`.
