#!/usr/bin/env bash
#
# scripts/build/release-opencode-plugin.sh — build the SOURCE-FREE OpenCode-plugin
# release artifact (idea-329/330: Steve installs a published bundle, never the
# agentic-network source).
#
# Approach: esbuild bundles the plugin + its `@apnex/*` deps (cognitive-layer /
# message-router / network-adapter) FROM SOURCE — the deps are aliased to their
# `src/index.ts` (see the `bundle` script in adapters/opencode-plugin/package.json).
# This deliberately sidesteps a clean-from-scratch `tsc` build of the deps, which
# FAILS because `@apnex/network-adapter` and `@apnex/message-router` have a CIRCULAR
# source-level dependency (network-adapter declares message-router; message-router's
# src imports network-adapter) — tsc cannot emit either's .d.ts without the other's.
# esbuild tolerates the circular module graph and drops the type-only
# `@opencode-ai/plugin` import (the host SDK is provided at runtime), so it inlines
# everything into ONE self-contained file with zero external `@apnex` deps.
# (The circular @apnex source-dep is a pre-existing shared-package hygiene issue —
# bug-116 territory — surfaced by this productionization; flagged to the architect.)
#
# Run this whenever the shared core changes.
# Run from anywhere:  scripts/build/release-opencode-plugin.sh
# Output:  adapters/opencode-plugin/dist/shim.js  (self-contained; zero @apnex deps)

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

echo "[release-opencode] 1/3 clean prior bundle (dist/ is gitignored)"
rm -rf adapters/opencode-plugin/dist

echo "[release-opencode] 2/3 esbuild self-contained bundle (from @apnex SRC — sidesteps the circular tsc dep-build)"
npm run bundle -w @apnex/opencode-plugin

echo "[release-opencode] 3/3 verify self-containment"
OUT="$REPO_ROOT/adapters/opencode-plugin/dist/shim.js"
[ -f "$OUT" ] || { echo "[release-opencode] ERROR: no bundle emitted at $OUT" >&2; exit 1; }
if grep -qE "from[ ]*[\"']@apnex/" "$OUT"; then
  echo "[release-opencode] ERROR: bundle still references @apnex/* — not self-contained." >&2
  exit 1
fi
echo "[release-opencode] done → $OUT ($(wc -c < "$OUT") bytes); self-contained (no @apnex/* imports)."
