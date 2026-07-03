#!/usr/bin/env bash
#
# scripts/build/release-opencode-plugin.sh — build the LEGACY SOURCE-FREE
# OpenCode-plugin compatibility artifact.
#
# Mission-101 W6 makes graph-published npm (`@apnex/opencode-plugin`) the
# canonical target. This script is retained as a compatibility bridge for the
# existing GitHub/source-bundle channel (idea-329/330: Steve installed a
# published bundle, not the agentic-network source) until the coordinated npm
# cutover is complete.
#
# Approach: esbuild bundles the plugin + its `@apnex/*` deps FROM SOURCE — the
# deps are aliased to their `src/index.ts` (see scripts/build/bundle-opencode.js).
# This produces ONE self-contained file with zero external `@apnex` deps and a
# HubPlugin-only export surface, which is what the legacy OpenCode loader path
# requires.
#
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
