#!/usr/bin/env bash
# Build the P1e-2 standalone test-Hub bundle: a self-contained .mjs (real HubNetworking over
# MEMORY stores + the silent-wedge control server) that runs on plain node:22 with NO repo +
# NO tsx on the VM. esbuild inlines hub/src + network-adapter; memory-mode means no `pg` native
# dep, so it bundles + runs clean. The createRequire banner lets the bundled CJS deps (express)
# resolve node builtins under the ESM output (else "Dynamic require of node:events is not supported").
#
#   usage: build-p1e2-test-hub.sh [outfile]      (default: deploy/adapter-image/p1e2-test-hub.mjs)
#
# Then deliver the bundle to the VM (e.g. gsutil cp to a bucket -> gsutil cp down) and run it on
# node:22-alpine on the e2e docker network (see p1e2-e2e.README.md §Standalone test-Hub).
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
PKG="$ROOT/packages/network-adapter"
OUT="${1:-$ROOT/deploy/adapter-image/p1e2-test-hub.mjs}"
cd "$PKG"
npx esbuild test/p1e2-standalone-hub.mts \
  --bundle --platform=node --format=esm --target=node22 \
  --banner:js='import { createRequire as __cr } from "module"; import { fileURLToPath as __ftp } from "url"; import { dirname as __dn } from "path"; const require = __cr(import.meta.url); const __filename = __ftp(import.meta.url); const __dirname = __dn(__filename);' \
  --outfile="$OUT"
echo "[p1e2] bundle -> $OUT ($(wc -c < "$OUT") bytes)"
