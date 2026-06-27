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

echo "[release-opencode] 1/5 version-bump gate (idea-355 SLICE-3 / bug-182 fork-4 ship-path assert)"
# opencode ships via the esbuild bundle (not npm pack), so the --assert gate
# the 6 wired packages get in their `prepack` hook lives HERE on the ship path.
# Stamp-only `npm run bundle` (prebuild + bundle-opencode.js) never asserts — so
# dev/CI bundling can't fail; the release gate runs once, here, before publish.
( cd "$REPO_ROOT/adapters/opencode-plugin" && node "$REPO_ROOT/scripts/build/write-build-info.js" --assert )

echo "[release-opencode] 2/5 clean prior bundle (dist/ is gitignored)"
rm -rf adapters/opencode-plugin/dist

echo "[release-opencode] 3/5 esbuild self-contained bundle (from @apnex SRC — sidesteps the circular tsc dep-build)"
npm run bundle -w @apnex/opencode-plugin

echo "[release-opencode] 4/5 verify self-containment (zero @apnex imports)"
OUT="$REPO_ROOT/adapters/opencode-plugin/dist/shim.js"
[ -f "$OUT" ] || { echo "[release-opencode] ERROR: no bundle emitted at $OUT" >&2; exit 1; }
if grep -qE "from[ ]*[\"']@apnex/" "$OUT"; then
  echo "[release-opencode] ERROR: bundle still references @apnex/* — not self-contained." >&2
  exit 1
fi

echo "[release-opencode] 5/5 verify export surface = HubPlugin ONLY (OpenCode 1.3.x: every export must be a plugin fn, thread-667)"
# esbuild emits the export block multi-line (export {\n  HubPlugin\n};) — capture the whole block.
EXPORTS="$(sed -n '/^export[ ]*{/,/};/p' "$OUT" | tr '\n' ' ')"
echo "$EXPORTS" | grep -q "HubPlugin" || { echo "[release-opencode] ERROR: bundle does not export HubPlugin." >&2; exit 1; }
if echo "$EXPORTS" | grep -qE "_testOnly|buildPluginCallbacks|makeOpenCodeFetchHandler"; then
  echo "[release-opencode] ERROR: bundle export surface includes test/internal symbols — OpenCode 1.3.x would throw 'Plugin export is not a function'." >&2
  exit 1
fi
echo "[release-opencode] done → $OUT ($(wc -c < "$OUT") bytes); self-contained + exports HubPlugin only."
