#!/usr/bin/env bash
#
# update-claude-plugin.sh — pull + install a published @apnex/claude-plugin
# version from the npm registry into the local "agentic-network" marketplace,
# ready for a client restart.
#
# The npm registry is the single publish channel for the plugin family
# (publish-npm.yml, `npm-v*` tags); this updater is the consumer-side hop.
#
# It does EVERYTHING EXCEPT the restart: a stdio MCP proxy code-swap requires a
# full Claude Code exit+relaunch, which only the operator can do per client.
# (bug-180's live-refresh covers the Hub tool-surface in a running proxy, NOT the
# proxy's own code.)
#
# Usage:
#   ./update-claude-plugin.sh             # install the latest published version
#   ./update-claude-plugin.sh 0.1.12      # install a specific version
#
# Requires: npm, jq, tar. Safe to re-run (idempotent: no-ops when the published
# build is already staged; always backs up before swapping).
#
set -euo pipefail

PKG="@apnex/claude-plugin"
MARKET="agentic-network"
PLUGIN="agent-adapter"
KM="$HOME/.claude/plugins/known_marketplaces.json"

command -v npm >/dev/null || { echo "ERROR: npm required" >&2; exit 1; }
command -v jq  >/dev/null || { echo "ERROR: jq required" >&2; exit 1; }
command -v tar >/dev/null || { echo "ERROR: tar required" >&2; exit 1; }

# 1. Resolve the staged marketplace directory from the marketplace registration
#    (falls back to the known default if the registration can't be read).
STAGE_DIR="$(jq -r --arg n "$MARKET" '.[$n].source.path // empty' "$KM" 2>/dev/null || true)"
STAGE_DIR="${STAGE_DIR:-/home/apnex/apnex-claude-plugin/package}"
[ -d "$STAGE_DIR" ] || { echo "ERROR: staged plugin dir not found: $STAGE_DIR" >&2; exit 1; }

# 2. Resolve the target version (explicit arg, else the registry's latest)
VER="${1:-$(npm view "$PKG" dist-tags.latest 2>/dev/null)}"
[ -n "$VER" ] || { echo "ERROR: could not resolve a published version of $PKG" >&2; exit 1; }

CUR_SHA="$(jq -r '.commitSha // "unknown"' "$STAGE_DIR/dist/build-info.json" 2>/dev/null || echo unknown)"
echo "[update] package=$PKG  target=$VER"
echo "[update] staged-dir=$STAGE_DIR"
echo "[update] currently staged: commitSha=$CUR_SHA"

# 3. Pull the published tarball into a scratch dir
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
( cd "$TMP" && npm pack "$PKG@$VER" --silent >/dev/null )
TGZ="$(ls "$TMP"/*claude-plugin-*.tgz 2>/dev/null | head -1)"
[ -n "$TGZ" ] || { echo "ERROR: npm pack produced no tarball for $PKG@$VER" >&2; exit 1; }

# 4. Extract (npm-pack → package/) + read its identity
tar xzf "$TGZ" -C "$TMP"
[ -d "$TMP/package" ] || { echo "ERROR: tarball did not contain package/" >&2; exit 1; }
NEW_SHA="$(jq -r '.commitSha // "unknown"' "$TMP/package/dist/build-info.json" 2>/dev/null || echo unknown)"
NEW_VER="$(jq -r '.version // "unknown"' "$TMP/package/package.json" 2>/dev/null || echo unknown)"
echo "[update] published build: version=$NEW_VER  commitSha=$NEW_SHA"

# 5. No-op if the published build is already what's staged
if [ "$NEW_SHA" = "$CUR_SHA" ] && [ "$CUR_SHA" != "unknown" ]; then
  echo "[update] already staged at $CUR_SHA — nothing to swap."
  echo "[update] (if your RUNNING proxy predates it, still do a full Claude Code restart.)"
  exit 0
fi

# 6. Back up the current staged dir (compressed), then swap in the new build
BACKUP="$(dirname "$STAGE_DIR")/$(basename "$STAGE_DIR")-backup-${CUR_SHA}-$(date +%Y%m%d-%H%M%S).tar.gz"
echo "[update] backing up -> $BACKUP"
tar czf "$BACKUP" -C "$(dirname "$STAGE_DIR")" "$(basename "$STAGE_DIR")"
chmod 600 "$BACKUP"
rm -rf "$STAGE_DIR"
mv "$TMP/package" "$STAGE_DIR"

# 7. Reinstall: refreshes the marketplace + reinstalls + clears the stale cache
if [ -f "$STAGE_DIR/install.sh" ]; then
  echo "[update] running staged install.sh ..."
  bash "$STAGE_DIR/install.sh"
else
  echo "[update] install.sh absent; invoking claude plugin commands directly"
  claude plugin marketplace add "$STAGE_DIR" || true
  claude plugin install "${PLUGIN}@${MARKET}"
fi

cat <<EOF

[update] ✅ staged + installed: $PLUGIN $NEW_VER ($NEW_SHA)
[update] ⚠ FINAL STEP — in EACH Claude Code client you want upgraded:
[update]     fully EXIT and relaunch (respawns the proxy).  NOT /reload-plugins.
[update] verify after restart:  get_agents (or scripts/local/get-agents.sh) -> proxyVersion=$NEW_VER, sdkCommitSha=$NEW_SHA
[update] break-glass (proxy still on old sha):  rm -rf ~/.claude/plugins/cache/$MARKET  then restart.
[update] rollback the stage:  rm -rf "$STAGE_DIR" && tar xzf "$BACKUP" -C "$(dirname "$STAGE_DIR")" && bash "$STAGE_DIR/install.sh"
EOF
