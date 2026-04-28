#!/usr/bin/env bash
#
# install.sh — Install the Claude Code agent-adapter plugin.
#
# Idempotent — safe to re-run. Builds the plugin (if invoked from source-tree
# context), registers the local marketplace, and installs into Claude Code.
#
# Mission-64 W1+W2 update: bundled into @apnex/claude-plugin npm package per
# Design v1.0 §2.6 (location-pick (a) bundled at $(npm prefix -g)/lib/...).
# When run from npm-installed context, dist/ is pre-built (no rebuild needed);
# when run from source-tree context, build is invoked. Both contexts auto-detected.
#
# Usage:
#   ./adapters/claude-plugin/install.sh           # source-tree usage (legacy)
#   $(npm prefix -g)/lib/node_modules/@apnex/claude-plugin/install.sh   # npm-installed usage
#

set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARKETPLACE="agentic-network"
PLUGIN_NAME="agent-adapter"

# Detect context: source-tree (invoked from <repo>/adapters/claude-plugin/)
# vs npm-installed (invoked from $(npm prefix -g)/lib/node_modules/@apnex/claude-plugin/)
if [ -d "$PLUGIN_DIR/../../packages/network-adapter" ]; then
  CONTEXT="source-tree"
  REPO_ROOT="$(cd "$PLUGIN_DIR/../.." && pwd)"
  MARKETPLACE_PATH="$REPO_ROOT"
else
  CONTEXT="npm-installed"
  # When npm-installed, marketplace path is the plugin dir itself
  # (claude plugin marketplace expects a directory containing the plugin manifest)
  MARKETPLACE_PATH="$PLUGIN_DIR"
fi

echo "[install] Context: $CONTEXT"
echo "[install] Plugin dir: $PLUGIN_DIR"

# Build only in source-tree context (npm-installed dist/ is pre-built per Design §2.2 §B mechanisation)
if [ "$CONTEXT" = "source-tree" ]; then
  echo "[install] Building plugin ..."
  cd "$PLUGIN_DIR"
  # Note: in workspaces context, deps are symlinked via root npm install;
  # this `npm install` is a no-op when run from within a workspace
  if [ ! -L "$PLUGIN_DIR/node_modules/@apnex/network-adapter" ] && [ ! -d "$PLUGIN_DIR/node_modules/@apnex/network-adapter" ]; then
    echo "[install] WARNING: workspace deps not yet symlinked; run 'npm install' from repo root first"
  fi
  npm run build
elif [ ! -d "$PLUGIN_DIR/dist" ]; then
  echo "[install] ✗ npm-installed context but no dist/ found — package may be malformed" >&2
  exit 2
fi

# Cache invalidation per Design v1.0 §2.8: claude-plugin cache stomp
# protection — wipe stale cache entry before plugin install so fresh dist/
# from the new install actually loads.
CACHE_ROOT="${CLAUDE_PLUGIN_CACHE_DIR:-$HOME/.claude/plugins/cache}"
CACHE_DIR="$CACHE_ROOT/$MARKETPLACE/$PLUGIN_NAME"
if [ -d "$CACHE_DIR" ]; then
  echo "[install] Clearing stale cache at $CACHE_DIR ..."
  rm -rf "$CACHE_DIR"
fi

echo "[install] Registering local marketplace ..."
claude plugin marketplace add "$MARKETPLACE_PATH"

echo "[install] Installing $PLUGIN_NAME@$MARKETPLACE ..."
claude plugin install "$PLUGIN_NAME@$MARKETPLACE"

echo ""
echo "[install] Done. Restart Claude Code to activate the plugin."
