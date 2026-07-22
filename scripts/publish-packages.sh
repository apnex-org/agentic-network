#!/usr/bin/env bash
#
# scripts/publish-packages.sh — topological @apnex/* family publish
#
# Walks the @apnex/* dep-graph in topological order and publishes each package to
# the npm registry. Originally a first-publish bootstrap (when no @apnex/*
# packages existed on registry); now also handles the steady-state PARTIAL
# release via an idempotent skip-if-already-published guard (see the publish loop
# below) — a release that bumps only SOME packages skips the unchanged ones
# rather than fatally aborting on an E403 over-publish. Safe to re-run.
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

# Topological order (manually maintained; small dep-graph for mission-64 +
# mission-101 W6):
#   1. cognitive-layer  (leaf; no @apnex/* deps)
#   2. message-router   (peerDep on @apnex/network-adapter; type-only via import type)
#   3. network-adapter  (deps on cognitive-layer + message-router)
#   4. opencode-plugin  (deps on network-adapter; mission-101 npm cutover) — after net-adapter
#   5. pi-plugin        (deps on network-adapter; M-Shim-Distribution) — after net-adapter
#
# "@apnex/claude-plugin" is intentionally excluded. Its dependency-free candidate
# has one protected path: .github/workflows/publish-claude-plugin.yml.
# storage-provider + repo-event-bridge: workspace-only (not for the registry).
# They are now marked `private:true` (cleanslate0 npm_dedual), so `npm publish`
#   fail-closes on them anyway; this script still publishes an EXPLICIT list
#   (rather than `--workspaces`) because it also hoists version-rewrite, which
#   `npm publish --workspace=X` skips per calibration #35.
PACKAGES=(
  "@apnex/cognitive-layer"
  "@apnex/message-router"
  "@apnex/network-adapter"
  "@apnex/opencode-plugin"
  "@apnex/pi-plugin"
)

# Pre-flight: verify NPM_TOKEN sourced (skip in dry-run; npm publish --dry-run doesn't auth)
if [ -z "$DRY_RUN" ] && [ -z "${NPM_TOKEN:-}" ]; then
  echo "[publish-packages] ✗ NPM_TOKEN not set"
  echo "[publish-packages] Source the token first:"
  echo "[publish-packages]   source ~/.config/apnex-agents/greg.env"
  exit 1
fi

# Pre-flight: verify a usable .npmrc exists. Local publishes keep one at the
# repo root (or claude-plugin dir). In CI, actions/setup-node (with registry-url)
# writes an .npmrc wired to NODE_AUTH_TOKEN and points npm at it via
# NPM_CONFIG_USERCONFIG — so honour that path too, otherwise the real (non-dry)
# publish false-fails the preflight even though `npm publish` IS authenticated
# (observed: publish run #28555177746).
NPMRC_FOUND=""
for npmrc in "${NPM_CONFIG_USERCONFIG:-}" "$REPO_ROOT/.npmrc" "$REPO_ROOT/adapters/claude-plugin/.npmrc" "${HOME:-}/.npmrc"; do
  if [ -n "$npmrc" ] && [ -f "$npmrc" ]; then
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
  # idea-509 (survey G6, bug-254/255): a declared `bin` MUST be present in the tarball —
  # a missing bin ships a broken published package (install ok, CLI entrypoint absent).
  if ! node "$REPO_ROOT/scripts/build/assert-pack-contents.js" "$actual_dir"; then
    echo "[publish-packages] ✗ $pkg — declared bin absent from tarball (bug-254 class); refusing to publish"
    exit 2
  fi
done

echo "[publish-packages] Pre-flight checks passed"

# Hoist version-rewrite into publish-packages.sh explicitly (Calibration #35 fix).
# npm `--workspace=X` flag uses the workspace's own lifecycle hooks, NOT root's;
# so root package.json's `prepublishOnly: node scripts/version-rewrite.js` never
# fires when this script invokes `npm publish --workspace=...`. We hoist the
# rewrite call here as architect-lean (a): single-source-of-truth; bypasses
# npm lifecycle quirk; controls the whole flow.
#
# ── Provenance capture (idea-493) ───────────────────────────────────
# The authoritative fail-closed clean-tree GATE runs UPSTREAM at the only correct
# moment — post-checkout, PRE-install/pre-rewrite (.github/workflows/publish-npm.yml).
# By the time THIS script runs, the caller has already `npm install`ed (which
# rewrites the TRACKED package-lock.json) and is about to version-rewrite the
# package.jsons, so a `git status` here CANNOT distinguish real source drift from
# expected tooling churn — gating on it would false-fail every publish. So: TRUST
# the caller-provided provenance when present (CI exports OIS_BUILD_* from the gate
# via $GITHUB_ENV) and pass it through to write-build-info.js — fired by each
# `npm publish` prepack, AFTER version-rewrite — so the stamp attests the true
# pre-rewrite source rather than our own churn. For a bare LOCAL run with no
# upstream gate, best-effort capture sha/branch and WARN to publish from a clean
# tree (the CI tag path is the attestable release path; local is a fallback).
if [ -z "${OIS_BUILD_SHA:-}" ]; then
  # DIRECT/LOCAL path — no upstream YAML gate vouched for the tree. The script
  # still supports a real `source greg.env && ./publish-packages.sh` publish (its
  # NPM_TOKEN/.npmrc preflights exist for exactly that; it was the pre-CI method),
  # so close the provenance hole HERE too — but ONLY on this env-absent path, so
  # the CI env-vouched path (OIS_BUILD_SHA already set) is NEVER re-gated and can't
  # regress. Measure genuine SOURCE dirt, ignoring the package-lock.json churn
  # `npm install` legitimately produces (preflight already required node_modules);
  # version-rewrite has not run yet, so the package.jsons are still pristine here.
  export OIS_BUILD_SHA="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  export OIS_BUILD_BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  if [ -n "$(git -C "$REPO_ROOT" status --porcelain -- ':!package-lock.json' 2>/dev/null || true)" ]; then
    if [ -z "$DRY_RUN" ]; then
      echo "[publish-packages] ✗ dirty source tree (no upstream gate) — refusing to publish unattestable artifacts (idea-493). Commit/clean the tree, or publish via the CI tag path."
      git -C "$REPO_ROOT" status --porcelain -- ':!package-lock.json'
      exit 3  # unrecoverable: cannot attest a dirty-tree publish
    fi
    echo "[publish-packages] ⚠ dirty source (excl. lockfile) — dry-run continues, but a real direct publish would REFUSE (idea-493)."
    export OIS_BUILD_DIRTY="${OIS_BUILD_DIRTY:-true}"
  else
    export OIS_BUILD_DIRTY="${OIS_BUILD_DIRTY:-false}"
    echo "[publish-packages] no upstream gate (idea-493) — source clean (excl. lockfile)."
  fi
fi
echo "[publish-packages] Provenance: sha=$OIS_BUILD_SHA dirty=$OIS_BUILD_DIRTY branch=$OIS_BUILD_BRANCH"

# Trap revert on any exit (success or failure) so source-tree always returns
# to placeholder state for dev workflow continuity.
echo ""
echo "[publish-packages] Rewriting cross-@apnex/* deps * → ^X.Y.Z (pre-publish)"
node "$REPO_ROOT/scripts/version-rewrite.js" || {
  echo "[publish-packages] ✗ version-rewrite failed; aborting"
  exit 2
}
trap 'echo "[publish-packages] Reverting cross-@apnex/* deps ^X.Y.Z → * (post-publish)"; node "$REPO_ROOT/scripts/version-rewrite.js" --revert' EXIT

# Publish each package in topological order.
#
# IDEMPOTENT SKIP-IF-ALREADY-PUBLISHED GUARD (mission-99 release / #458 follow-up):
# this script was written as a FIRST-PUBLISH bootstrap (see header) and had no
# guard for the already-published case. On a partial release (only SOME packages
# version-bumped — the common case for every release after the first), the
# unchanged packages sit at versions already on the registry. `npm publish` of an
# existing version returns E403 ('cannot publish over previously published
# version') = a nonzero exit the loop below treats as FATAL — so the run would
# abort on the FIRST unchanged package (cognitive-layer) and publish NOTHING,
# including the genuinely-new packages later in the list.
#
# The guard PRE-CHECKS registry existence and SKIPS an exact-version match. It is
# purely ADDITIVE: when a version is genuinely new the probe is empty and we fall
# through to the identical publish path (zero behavior change). It does NOT mask a
# real publish failure — the skip fires ONLY on a confirmed exact-version match
# (`npm view pkg@ver version` echoing back that exact version); any OTHER publish
# error (auth/registry/E403-for-a-different-reason) still hits the fatal branch
# below unchanged.
for pkg in "${PACKAGES[@]}"; do
  echo ""
  echo "[publish-packages] === Publishing $pkg ==="

  # Read the local (to-be-published) version from the workspace's package.json.
  pkg_dir="$(readlink -f "$REPO_ROOT/node_modules/$pkg")"
  ver="$(node -p "require('$pkg_dir/package.json').version" 2>/dev/null || true)"
  if [ -z "$ver" ]; then
    echo "[publish-packages] ✗ $pkg — could not read local version from package.json"
    exit 2  # publish-flow error
  fi

  # Registry existence probe: `npm view pkg@ver version` echoes the EXACT version
  # iff that version is already published; empty (E404) otherwise. Distinguishes
  # 'already published' (skip) from 'publish failed for other reasons' (fatal).
  published="$(npm view "$pkg@$ver" version 2>/dev/null || true)"
  if [ "$published" = "$ver" ]; then
    echo "[publish-packages] ↷ skip $pkg@$ver — already published (idempotent guard)"
    continue
  fi

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
