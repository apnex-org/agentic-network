#!/usr/bin/env bash
#
# scripts/publish-packages.sh — topological first-publish bootstrap
#
# Walks the @apnex/* dep-graph in topological order and publishes
# each package to the npm registry. Required for first-publish (when
# no @apnex/* packages exist on registry yet); subsequent publishes
# can use `npm publish --workspaces` since registry-resolution finds
# existing versions regardless of alphabetical-vs-topological order.
#
# Mission-64 W1+W2 deliverable per Design v1.0 §2.5 + Risk register R6.
#
# Pre-flight requirements:
#   - NPM_TOKEN sourced (e.g., source ~/.config/apnex-agents/greg.env)
#   - .npmrc configured with @apnex:registry + auth-token reference
#   - @apnex npm org claimed by Director (R1 closed)
#   - All packages built (npm run build --workspaces)
#
# Usage:
#   ./scripts/publish-packages.sh           # actual publish
#   ./scripts/publish-packages.sh --dry-run # validate flow without publishing
#
# Exit codes per CLI contract (consumer = idea-221 runner; subset of update-adapter.sh):
#   0 = all packages published successfully
#   1 = registry/auth error (NPM_TOKEN invalid, registry unreachable, etc.)
#   2 = publish-flow error (package not found in workspace, build artifacts missing)
#   3 = unrecoverable (validate failed; dep-graph violation; etc.)

set -euo pipefail

DRY_RUN=""
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN="--dry-run"
  echo "[publish-packages] DRY-RUN MODE — no actual publishes"
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Topological order (manually maintained; small dep-graph for mission-64):
#   1. cognitive-layer  (leaf; no @apnex/* deps)
#   2. message-router   (peerDep on @apnex/network-adapter; type-only via import type)
#   3. network-adapter  (deps on cognitive-layer + message-router)
#   4. claude-plugin    (deps on cognitive-layer + message-router + network-adapter)
#
# storage-provider + repo-event-bridge: workspace-only (private; not published)
# opencode-plugin: stub-only (private; not published this mission)
PACKAGES=(
  "@apnex/cognitive-layer"
  "@apnex/message-router"
  "@apnex/network-adapter"
  "@apnex/claude-plugin"
)

# Pre-flight: verify NPM_TOKEN sourced (skip in dry-run; npm publish --dry-run doesn't auth)
if [ -z "$DRY_RUN" ] && [ -z "${NPM_TOKEN:-}" ]; then
  echo "[publish-packages] ✗ NPM_TOKEN not set"
  echo "[publish-packages] Source the token first:"
  echo "[publish-packages]   source ~/.config/apnex-agents/greg.env"
  exit 1
fi

# Pre-flight: verify .npmrc exists at repo root or claude-plugin dir
NPMRC_FOUND=""
for npmrc in "$REPO_ROOT/.npmrc" "$REPO_ROOT/adapters/claude-plugin/.npmrc"; do
  if [ -f "$npmrc" ]; then
    NPMRC_FOUND="$npmrc"
    break
  fi
done
if [ -z "$DRY_RUN" ] && [ -z "$NPMRC_FOUND" ]; then
  echo "[publish-packages] ✗ No .npmrc found"
  echo "[publish-packages] Create one with:"
  echo "[publish-packages]   //registry.npmjs.org/:_authToken=\${NPM_TOKEN}"
  echo "[publish-packages]   @apnex:registry=https://registry.npmjs.org/"
  exit 1
fi

# Pre-flight: verify all packages built
for pkg in "${PACKAGES[@]}"; do
  pkg_path="$REPO_ROOT/node_modules/$pkg"
  if [ ! -d "$pkg_path" ]; then
    echo "[publish-packages] ✗ $pkg not found in node_modules — run 'npm install' first"
    exit 2
  fi
  # Resolve workspace symlink to actual package dir
  actual_dir="$(readlink -f "$pkg_path")"
  if [ ! -d "$actual_dir/dist" ]; then
    echo "[publish-packages] ✗ $pkg dist/ not built — run 'npm run build --workspaces' first"
    exit 2
  fi
done

echo "[publish-packages] Pre-flight checks passed"

# Publish each package in topological order
for pkg in "${PACKAGES[@]}"; do
  echo ""
  echo "[publish-packages] === Publishing $pkg ==="
  if npm publish --workspace="$pkg" --access public $DRY_RUN; then
    echo "[publish-packages] ✓ $pkg"
  else
    rc=$?
    echo "[publish-packages] ✗ $pkg (exit $rc)"
    if [ $rc -eq 1 ]; then
      exit 1  # registry/auth error
    else
      exit 2  # publish-flow error
    fi
  fi
done

echo ""
echo "[publish-packages] ✓ All ${#PACKAGES[@]} packages published successfully"
exit 0
