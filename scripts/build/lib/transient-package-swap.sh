#!/usr/bin/env bash
#
# scripts/build/lib/transient-package-swap.sh — sovereign-package tarball
# staging helper.
#
# Extracted from scripts/local/build-hub.sh:139-180 per M-GitHub-Releases-
# Plugin-Distribution Design v1.0 §1.4 lib-extraction prescription. Two
# consumers (build-hub.sh + scripts/build/lib/prepack-claude-plugin.sh)
# share this helper. Sunset condition: idea-186 (npm workspaces) lands +
# all consumers migrate to workspace resolution.
#
# Pattern: for each sovereign package, `npm pack` it into the target
# package's directory + sed-rewrite the target's package.json to swap
# the dep ref (workspace-`*` OR `file:../path`) to `file:./<tarball>`.
# Original package.json is backed up; trap-handler restores on exit.
#
# Why the pattern: container/extracted-tarball install flows can't
# resolve workspace symlinks or `..`-escaping file refs. Bundled
# tarballs survive the upload/extract boundary; the consumer's
# `npm install` resolves them as closed-set siblings.
#
# Usage:
#   source "$REPO_ROOT/scripts/build/lib/transient-package-swap.sh"
#   trap tps_cleanup EXIT INT TERM HUP                     # simple case
#   # OR caller installs its own trap that calls _tps_cleanup_state internally
#   swap_workspace_deps_to_tarballs <package_dir> <pkg_pair_1> [<pkg_pair_N>...]
#
# pkg_pair format: "<package-name>:<source-dir-relative-to-REPO_ROOT>"
#
# Caller must define $REPO_ROOT before invocation.
#
# Single-swap-per-process — nested swaps not supported (module-level state).

# ── Module state ───────────────────────────────────────────────────────

TPS_TARGET_DIR=""
TPS_BACKUP_DIR=""
TPS_STAGED_TARBALLS=()
TPS_SWAP_APPLIED=0

# ── Internal: state-only cleanup (no exit) ─────────────────────────────
#
# Composable cleanup primitive. Use directly when the caller needs to
# layer additional cleanup (e.g., prepack-claude-plugin.sh stages
# skills/ separately and combines its cleanup with this one).

_tps_cleanup_state() {
  if [[ $TPS_SWAP_APPLIED -eq 1 && -n "$TPS_BACKUP_DIR" && -d "$TPS_BACKUP_DIR" ]]; then
    [[ -f "$TPS_BACKUP_DIR/package.json" ]] && mv -f "$TPS_BACKUP_DIR/package.json" "$TPS_TARGET_DIR/package.json"
  fi
  if [[ ${#TPS_STAGED_TARBALLS[@]} -gt 0 ]]; then
    local tarball
    for tarball in "${TPS_STAGED_TARBALLS[@]}"; do
      [[ -f "$tarball" ]] && rm -f "$tarball"
    done
  fi
  if [[ -n "$TPS_BACKUP_DIR" && -d "$TPS_BACKUP_DIR" ]]; then
    rm -rf "$TPS_BACKUP_DIR"
  fi
}

# ── Public: trap handler (simple case) ─────────────────────────────────

tps_cleanup() {
  local rc=$?
  trap - EXIT INT TERM HUP
  _tps_cleanup_state
  exit "$rc"
}

# ── Public: pack-and-swap ──────────────────────────────────────────────

swap_workspace_deps_to_tarballs() {
  local target_dir="$1"; shift
  TPS_TARGET_DIR="$target_dir"

  if [[ -z "${REPO_ROOT:-}" ]]; then
    echo "[transient-swap] ERROR: REPO_ROOT not set" >&2
    return 1
  fi
  if [[ ! -f "$target_dir/package.json" ]]; then
    echo "[transient-swap] ERROR: $target_dir/package.json not found" >&2
    return 1
  fi

  TPS_BACKUP_DIR=$(mktemp -d -t transient-swap-XXXXXX)
  cp "$target_dir/package.json" "$TPS_BACKUP_DIR/package.json"
  TPS_SWAP_APPLIED=1

  local entry pkg_name pkg_source pkg_dir tarball_name
  for entry in "$@"; do
    pkg_name="${entry%%:*}"
    pkg_source="${entry#*:}"
    pkg_dir="$REPO_ROOT/$pkg_source"

    if [[ ! -f "$pkg_dir/package.json" ]]; then
      echo "[transient-swap] ERROR: $pkg_dir/package.json not found (entry: $entry)" >&2
      return 1
    fi

    echo "[transient-swap] ──────── Pack $pkg_name ────────"
    # Pre-install package devDeps so the `prepare` hook (which runs `tsc`)
    # can succeed during npm pack. Idempotent on populated node_modules.
    ( cd "$pkg_dir" && npm install --no-audit --no-fund --silent )
    # idea-355 SLICE-3 (decision B): this is an INTERNAL vendor-pack of sovereign
    # SOURCE into the hub image (traced by the hub's own git-sha), NOT a registry
    # ship — so scope the bug-182 version-bump assert OUT of it. OIS_SKIP_VERSION_ASSERT
    # skips ONLY the assert's FAIL check; `prepare`/tsc + the build-info stamp still
    # run, so dist stays intact (do NOT use --ignore-scripts here). The real
    # consumer-publish paths leave this unset and still gate.
    tarball_name=$( cd "$pkg_dir" && OIS_SKIP_VERSION_ASSERT=1 npm pack --pack-destination "$target_dir" --silent )
    if [[ -z "$tarball_name" || ! -f "$target_dir/$tarball_name" ]]; then
      echo "[transient-swap] ERROR: npm pack did not produce a tarball for $pkg_name." >&2
      return 1
    fi
    TPS_STAGED_TARBALLS+=("$target_dir/$tarball_name")
    echo "[transient-swap] Tarball: $tarball_name"

    # Rewrite "<pkg_name>": "<anything>" → "<pkg_name>": "file:./<tarball>"
    # in target package.json. Handles both workspace `*` and `file:../path`
    # ref shapes. `|` delimiter avoids escape-storm on `/` in pkg names.
    sed -i.sedbak -E "s|\"${pkg_name}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"|\"${pkg_name}\": \"file:./${tarball_name}\"|" "$target_dir/package.json"
    rm -f "$target_dir/package.json.sedbak"

    if ! grep -q "file:./${tarball_name}" "$target_dir/package.json"; then
      echo "[transient-swap] ERROR: $pkg_name ref swap did not take effect in $target_dir/package.json." >&2
      return 1
    fi
  done

  echo "[transient-swap] Staged ${#TPS_STAGED_TARBALLS[@]} tarball(s); package.json refs swapped."
}
