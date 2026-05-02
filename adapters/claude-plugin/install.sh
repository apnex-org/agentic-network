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

# ── Helpers (extracted from inline blocks per mission-71 C1 fold) ────
#
# detect_context: echoes "source-tree" or "npm-installed". Source-tree
# means invoked from <repo>/adapters/claude-plugin/; npm-installed means
# invoked from $(npm prefix -g)/lib/node_modules/@apnex/claude-plugin/.
# Detection: presence of sibling packages/network-adapter directory
# (preserves verbatim the pre-mission-71 inline detection logic).
detect_context() {
  if [ -d "$PLUGIN_DIR/../../packages/network-adapter" ]; then
    echo "source-tree"
  else
    echo "npm-installed"
  fi
}

# detect_repo_root: echoes the repo root in source-tree mode; returns 1
# in npm-installed mode (no repo root exists). Caller must handle the
# return-code branch.
detect_repo_root() {
  if [ -d "$PLUGIN_DIR/../../packages/network-adapter" ]; then
    ( cd "$PLUGIN_DIR/../.." && pwd )
  else
    return 1
  fi
}

CONTEXT="$(detect_context)"
if [ "$CONTEXT" = "source-tree" ]; then
  REPO_ROOT="$(detect_repo_root)"
  MARKETPLACE_PATH="$REPO_ROOT"
else
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

# ── Sovereign-Skill bootstrap (mission-71; idea-230) ────────────────
#
# Walks /skills/<name>/ + invokes each skill's own install.sh + consolidates
# .skill-permissions.json fragments into ~/.claude/settings.local.json.
# Per-skill autonomy preserved (Q6=b compose); all-user target (Q4=d hybrid +
# C2+C3 fold); declarative permissions (Q5=c skill-shipped fragment).
#
# Library lives at lib/bootstrap-skills.sh — extracted for unit-testable
# function-level invocation per mission-71 Phase 8 (Design §6.1 isolation).

source "$PLUGIN_DIR/lib/bootstrap-skills.sh"

echo ""
echo "[install] Bootstrapping sovereign Skills ..."
bootstrap_skills

echo ""
echo "[install] Done. Restart Claude Code to activate the plugin + Skills."
