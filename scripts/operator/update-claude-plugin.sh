#!/usr/bin/env bash
#
# update-claude-plugin.sh — pull + install the latest @apnex/claude-plugin release
# into the local "agentic-network" marketplace, ready for a client restart.
#
# Automates the manual adapter hop. The proper consumer/producer auto-refresh
# distribution channel (subscribe the marketplace to a published artifact, à la
# the opencode republish path) is tracked as idea-354; until that lands, this is
# the one-command updater.
#
# It does EVERYTHING EXCEPT the restart: a stdio MCP proxy code-swap requires a
# full Claude Code exit+relaunch, which only the operator can do per client.
# (bug-180's live-refresh covers the Hub tool-surface in a running proxy, NOT the
# proxy's own code.)
#
# Usage:
#   ./update-claude-plugin.sh             # install the latest v* release
#   ./update-claude-plugin.sh v0.1.9      # install a specific tag
#   OIS_REPO=owner/repo ./update-claude-plugin.sh    # override the source repo
#
# Requires: gh (authenticated), jq, tar. Safe to re-run (idempotent: no-ops when
# the release build is already staged; always backs up before swapping).
#
set -euo pipefail

REPO="${OIS_REPO:-apnex-org/agentic-network}"
MARKET="agentic-network"
PLUGIN="agent-adapter"
KM="$HOME/.claude/plugins/known_marketplaces.json"

command -v gh  >/dev/null || { echo "ERROR: gh CLI required + authenticated" >&2; exit 1; }
command -v jq  >/dev/null || { echo "ERROR: jq required" >&2; exit 1; }
command -v tar >/dev/null || { echo "ERROR: tar required" >&2; exit 1; }

# 1. Resolve the staged marketplace directory from the marketplace registration
#    (falls back to the known default if the registration can't be read).
STAGE_DIR="$(jq -r --arg n "$MARKET" '.[$n].source.path // empty' "$KM" 2>/dev/null || true)"
STAGE_DIR="${STAGE_DIR:-/home/apnex/apnex-claude-plugin/package}"
[ -d "$STAGE_DIR" ] || { echo "ERROR: staged plugin dir not found: $STAGE_DIR" >&2; exit 1; }

# 2. Resolve the target tag (explicit arg, else the latest published release)
TAG="${1:-$(gh release view --repo "$REPO" --json tagName --jq '.tagName')}"
[ -n "$TAG" ] || { echo "ERROR: could not resolve a release tag on $REPO" >&2; exit 1; }

CUR_SHA="$(jq -r '.commitSha // "unknown"' "$STAGE_DIR/dist/build-info.json" 2>/dev/null || echo unknown)"
echo "[update] repo=$REPO  target=$TAG"
echo "[update] staged-dir=$STAGE_DIR"
echo "[update] currently staged: commitSha=$CUR_SHA"

# 3. Download the release tarball into a scratch dir
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
gh release download "$TAG" --repo "$REPO" --pattern '*claude-plugin-*.tgz' --dir "$TMP"
TGZ="$(ls "$TMP"/*claude-plugin-*.tgz 2>/dev/null | head -1)"
[ -n "$TGZ" ] || { echo "ERROR: no *claude-plugin-*.tgz asset on release $TAG" >&2; exit 1; }

# 4. Extract (npm-pack → package/) + read its identity
tar xzf "$TGZ" -C "$TMP"
[ -d "$TMP/package" ] || { echo "ERROR: tarball did not contain package/" >&2; exit 1; }
NEW_SHA="$(jq -r '.commitSha // "unknown"' "$TMP/package/dist/build-info.json" 2>/dev/null || echo unknown)"
NEW_VER="$(jq -r '.version // "unknown"' "$TMP/package/package.json" 2>/dev/null || echo unknown)"
echo "[update] release build: version=$NEW_VER  commitSha=$NEW_SHA"

# 5. No-op if the release build is already what's staged
if [ "$NEW_SHA" = "$CUR_SHA" ] && [ "$CUR_SHA" != "unknown" ]; then
  echo "[update] already staged at $CUR_SHA — nothing to swap."
  echo "[update] (if your RUNNING proxy predates it, still do a full Claude Code restart.)"
  exit 0
fi

# 6. Back up the current staged dir, then swap in the new build
BACKUP="$(dirname "$STAGE_DIR")/$(basename "$STAGE_DIR")-backup-${CUR_SHA}-$(date +%Y%m%d-%H%M%S)"
echo "[update] backing up -> $BACKUP"
cp -r "$STAGE_DIR" "$BACKUP"
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
[update] rollback the stage:  rm -rf "$STAGE_DIR" && mv "$BACKUP" "$STAGE_DIR" && bash "$STAGE_DIR/install.sh"
EOF
