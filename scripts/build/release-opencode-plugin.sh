#!/usr/bin/env bash
#
# scripts/build/release-opencode-plugin.sh — build the SOURCE-FREE OpenCode-plugin
# release artifact (idea-329/330: Steve installs a published bundle, never the
# agentic-network source).
#
# Why a bundle: the plugin depends on the `@apnex/*` workspace packages
# (cognitive-layer / message-router / network-adapter), which a standalone /
# source-free install cannot resolve (the bug-116 deps-first snag, confirmed at
# productionization). esbuild inlines them + their transitive deps into ONE
# self-contained `dist/shim.js` whose only external is the host-provided
# `@opencode-ai/plugin` SDK. Run this whenever the shared core changes.
#
# Run from the repo root:  scripts/build/release-opencode-plugin.sh
# Output:  adapters/opencode-plugin/dist/shim.js  (self-contained, zero @apnex deps)
#          adapters/opencode-plugin/dist/shim.d.ts (types, from tsc)

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

echo "[release-opencode] 0/4 clean prior dist (idempotent rebuild — dist/ is gitignored;"
echo "                       a stale dist makes the deps' tsc collide with its own emitted .d.ts, TS5055)"
rm -rf packages/network-adapter/dist packages/cognitive-layer/dist \
       packages/message-router/dist adapters/opencode-plugin/dist

echo "[release-opencode] 1/4 build @apnex/* workspace deps (deps-first; else TS2307)"
npm run build -w @apnex/network-adapter -w @apnex/cognitive-layer -w @apnex/message-router

echo "[release-opencode] 2/4 typecheck + emit the plugin (tsc → dist + shim.d.ts)"
npm run build -w @apnex/opencode-plugin

echo "[release-opencode] 3/4 bundle into a self-contained dist/shim.js (esbuild)"
npm run bundle -w @apnex/opencode-plugin

echo "[release-opencode] 4/4 verify self-containment"

OUT="$REPO_ROOT/adapters/opencode-plugin/dist/shim.js"
echo "[release-opencode] done → $OUT ($(wc -c < "$OUT") bytes)"
# Self-containment guard: the bundle must carry ZERO unresolved @apnex imports.
if grep -qE "from[ ]*[\"']@apnex/" "$OUT"; then
  echo "[release-opencode] ERROR: bundle still references @apnex/* — not self-contained." >&2
  exit 1
fi
echo "[release-opencode] self-contained OK (no @apnex/* imports remain)."
