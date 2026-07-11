#!/usr/bin/env bash
#
# update-claude-plugin.sh — install/upgrade @apnex/claude-plugin from the npm
# registry into the operator's local "agentic-network" marketplace, ready for a
# client restart.
#
# npmdeliver0 (idea-492): the plugin ships via the npm registry — the Channel-2
# GitHub-Release vendored-tarball path is RETIRED. This one-command operator
# updater mirrors the ois `claude_seed` cutover: a global npm install of an exact
# version + the npm-installed install.sh + a CONVERGE-on-existing re-register
# (uninstall -> drop marketplace -> wipe stale cache -> re-add + install from the
# npm path), so an operator whose marketplace still points at a retired hand-staged
# dir actually moves — a bare re-point is a SILENT NO-OP.
#
# It does EVERYTHING EXCEPT the restart: a stdio MCP proxy code-swap requires a
# full Claude Code exit+relaunch, which only the operator can do per client.
# (bug-180's live-refresh covers the Hub tool-surface in a running proxy, NOT the
# proxy's own code.)
#
# Usage:
#   ./update-claude-plugin.sh             # install the latest published version (resolved to an exact pin)
#   ./update-claude-plugin.sh 0.1.14      # install a specific version (EXACT pin)
#   CLAUDE_CONFIG_DIR=... ./update-claude-plugin.sh   # target a specific seat's config (default: ~/.claude)
#
# Requires: npm, claude (authenticated), jq. Safe to re-run (idempotent: the npm
# install + converge both no-op cleanly when already at the target).
#
set -euo pipefail

# Suppress npm's update-notifier so its "new version available" banner can never
# pollute a command substitution (e.g. `npm root -g`) on a pristine HOME.
export npm_config_update_notifier=false

MARKET="agentic-network"
PLUGIN="agent-adapter"
CDIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

command -v npm    >/dev/null || { echo "ERROR: npm required" >&2; exit 1; }
command -v claude >/dev/null || { echo "ERROR: claude CLI required + authenticated" >&2; exit 1; }
command -v jq     >/dev/null || { echo "ERROR: jq required" >&2; exit 1; }

# 1. Resolve the target version — explicit arg, else the latest PUBLISHED version
#    resolved to an EXACT number (never float a dist-tag).
VER="${1:-}"
if [ -z "$VER" ]; then
  VER="$(npm view @apnex/claude-plugin version 2>/dev/null || true)"
  [ -n "$VER" ] || { echo "ERROR: could not resolve latest @apnex/claude-plugin version from the npm registry" >&2; exit 1; }
fi
echo "[update] target: @apnex/claude-plugin@$VER (npm registry)"

# 2. Current registered marketplace + its staged identity (for the before/after report)
KM="$CDIR/plugins/known_marketplaces.json"
CUR_MP="$(jq -r --arg n "$MARKET" '.[$n].source.path // empty' "$KM" 2>/dev/null || true)"
CUR_SHA="$(jq -r '.commitSha // "unknown"' "$CUR_MP/dist/build-info.json" 2>/dev/null || echo unknown)"
echo "[update] config dir: $CDIR"
echo "[update] currently registered marketplace: ${CUR_MP:-<none>} (commitSha=$CUR_SHA)"

# 3. Global npm install (exact) + resolve the npm-installed marketplace dir
echo "[update] npm install -g @apnex/claude-plugin@$VER ..."
npm install -g "@apnex/claude-plugin@$VER"
# `tail -n1`: take only the path line, defensive against any npm banner on stdout.
MP="$(npm root -g 2>/dev/null | tail -n1)/@apnex/claude-plugin"
[ -d "$MP" ] || { echo "ERROR: npm-installed plugin dir missing at $MP after install" >&2; exit 1; }
NEW_SHA="$(jq -r '.commitSha // "unknown"' "$MP/dist/build-info.json" 2>/dev/null || echo unknown)"
NEW_VER="$(jq -r '.version // "unknown"' "$MP/package.json" 2>/dev/null || echo "$VER")"
echo "[update] npm-installed build: version=$NEW_VER  commitSha=$NEW_SHA"
echo "[update] marketplace dir: $MP"

# 4. install.sh (npm-installed): its `npm install --no-save` populates $MP/node_modules
#    with the sovereign deps (na etc.) so Claude's plugin-cache copy resolves them.
if [ -x "$MP/install.sh" ]; then
  echo "[update] running npm-installed install.sh ..."
  ( cd "$MP" && ./install.sh )
fi

# 5. CONVERGE-on-existing (mirrors ois claude_seed). An operator who already holds the
#    marketplace pointed at a retired hand-staged dir would otherwise SILENT-NO-OP.
#    Uninstall -> drop marketplace -> wipe stale cache -> re-add + install from the npm
#    path so known_marketplaces.json / installed_plugins.json / the cache all converge.
#    Runs under the exported CLAUDE_CONFIG_DIR so every claude-CLI write lands on this seat.
export CLAUDE_CONFIG_DIR="$CDIR"
echo "[update] converging marketplace source -> $MP"
claude plugin uninstall "${PLUGIN}@${MARKET}" 2>/dev/null || true
claude plugin marketplace remove "$MARKET" 2>/dev/null || true
rm -rf "$CDIR/plugins/cache/$MARKET" 2>/dev/null || true
claude plugin marketplace add "$MP"
claude plugin install "${PLUGIN}@${MARKET}"

cat <<EOF

[update] ✅ installed: $PLUGIN $NEW_VER ($NEW_SHA) from the npm registry
[update] ⚠ FINAL STEP — in EACH Claude Code client you want upgraded:
[update]     fully EXIT and relaunch (respawns the proxy).  NOT /reload-plugins.
[update] verify after restart:  get_agents (or scripts/local/get-agents.sh) -> proxyVersion=$NEW_VER, sdkCommitSha=$NEW_SHA
[update] break-glass (proxy still on old sha):  rm -rf "$CDIR/plugins/cache/$MARKET"  then restart.
[update] rollback:  npm install -g @apnex/claude-plugin@<prior-version>  then re-run this script.
EOF
