#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TDIR="$(mktemp -d)"
trap 'rm -rf "$TDIR"' EXIT

pack_manifest() {
  local package_dir="$1" key="$2"
  local result filename
  result="$(npm pack "$package_dir" --ignore-scripts --json --pack-destination "$TDIR")"
  filename="$(jq -r '.[0].filename' <<<"$result")"
  tar -xOf "$TDIR/$filename" package/package.json > "$TDIR/$key.json"
}

pack_manifest "$REPO/packages/network-adapter" network
pack_manifest "$REPO/adapters/claude-plugin" claude

node --input-type=module - "$TDIR/network.json" "$TDIR/claude.json" "$REPO/package-lock.json" <<'NODE'
import { readFileSync } from "node:fs";
const [networkPath, claudePath, lockPath] = process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const network = read(networkPath);
const claude = read(claudePath);
const lock = read(lockPath);
const exact = /^\d+\.\d+\.\d+$/;
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(network.name === "@apnex/network-adapter", "packed network name");
assert(network.version === "0.1.14", "packed network version");
assert(network.dependencies["@apnex/cognitive-layer"] === "0.1.4", "packed network→cognitive exact version");
assert(network.dependencies["@apnex/message-router"] === "0.1.3", "packed network→message-router exact version");
assert(claude.name === "@apnex/claude-plugin", "packed Claude name");
assert(claude.version === "0.1.18", "packed Claude candidate version");
assert(Object.keys(claude.dependencies ?? {}).length === 0, "packed Claude candidate has no consumer runtime dependencies");

for (const pkg of [network, claude]) {
  for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
    if (name.startsWith("@apnex/")) assert(exact.test(version), `${pkg.name} has non-exact internal dependency ${name}@${version}`);
  }
}

const networkLock = lock.packages["packages/network-adapter"];
const claudeLock = lock.packages["adapters/claude-plugin"];
assert(networkLock.version === "0.1.14", "network workspace lock version");
assert(networkLock.dependencies["@apnex/cognitive-layer"] === "0.1.4", "lock network→cognitive exact version");
assert(networkLock.dependencies["@apnex/message-router"] === "0.1.3", "lock network→message-router exact version");
assert(claudeLock.version === "0.1.18", "Claude workspace lock candidate version");
assert(Object.keys(claudeLock.dependencies ?? {}).length === 0, "lock records the dependency-free Claude candidate");
console.log("PASS: packed manifests and workspace lock bind exact network lineage plus a dependency-free Claude candidate");
NODE
