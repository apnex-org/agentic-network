# @apnex/claude-plugin

Self-contained OIS agent adapter for Claude Code. The npm package carries its complete runtime closure and has no consumer runtime dependencies or lifecycle scripts.

## Install with ordinary npm and Claude marketplace commands

```bash
npm install --global @apnex/claude-plugin@0.1.20 --ignore-scripts
plugin_root="$(npm root --global)/@apnex/claude-plugin"

claude plugin marketplace add "$plugin_root" --scope user
claude plugin install agent-adapter@agentic-network --scope user
```

OIS supplies the seat-specific Hub URL, token, role, and agent name when it launches Claude. For a disposable configuration, set `CLAUDE_CONFIG_DIR` before the two Claude commands.

The package's `.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json`, and npm `package.json` all carry version `0.1.20`. `dist/identity.json` and `dist/member-manifest.json` expose the exact built source and installed-file projection used by protected release verification.
