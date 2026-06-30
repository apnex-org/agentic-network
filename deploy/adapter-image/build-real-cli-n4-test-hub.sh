#!/usr/bin/env bash
# Build the M-Real-CLI-Harness n4 standalone test-Hub-WITH-WORK bundle: a self-contained .mjs
# (real HubNetworking over a MEMORY substrate + the FULL production PolicyRouter via
# bindRouterToMcp + a seeded ready engineer-claimable WorkItem + a thin control server) that
# runs on plain node:22 with NO repo + NO tsx on the VM. esbuild inlines hub/src +
# network-adapter; memory-mode means no `pg` native dep, so it bundles + runs clean. The
# createRequire banner lets the bundled CJS deps (express) resolve node builtins under the ESM
# output (else "Dynamic require of node:events is not supported").
#
#   usage: build-real-cli-n4-test-hub.sh [outfile]   (default: deploy/adapter-image/real-cli-n4-test-hub.mjs)
#
# Then deliver the bundle to the VM + run it on node:22-alpine on the e2e docker network. The
# container adapter sets OIS_HUB_URL=http://<host>:8080/mcp; the shim proxies the FULL catalogue.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
PKG="$ROOT/packages/network-adapter"
OUT="${1:-$ROOT/deploy/adapter-image/real-cli-n4-test-hub.mjs}"
cd "$PKG"
npx esbuild test/real-cli-n4-test-hub.mts \
  --bundle --platform=node --format=esm --target=node22 \
  --banner:js='import { createRequire as __cr } from "module"; import { fileURLToPath as __ftp } from "url"; import { dirname as __dn } from "path"; const require = __cr(import.meta.url); const __filename = __ftp(import.meta.url); const __dirname = __dn(__filename);' \
  --outfile="$OUT"
echo "[n4] bundle -> $OUT ($(wc -c < "$OUT") bytes)"
