#!/usr/bin/env bash
#
# scripts/local/update-adapter.sh — single-command adapter update for local-dev
#
# Mission-64 M-Adapter-Streamline W1+W2 deliverable per Design v1.0 §2.1.B.
# Frontend to npm-published @apnex/claude-plugin; ergonomic single-command
# wrapper that handles namespace migration cleanup + npm install + system-side
# install action (delegates to bundled install.sh per Design v1.0 §2.6).
#
# CLI contract (idea-221 runner-consumable per Design v1.0 §2.10):
#
# Exit codes:
#   0 = success (adapter updated; restart pending or completed)
#   1 = registry/install error (npm pull failed, network, auth, etc.)
#   2 = restart-required-but-not-attempted (npm install OK; user must restart manually)
#   3 = unrecoverable (config corruption, missing prerequisites, etc.)
#
# Stdout format:
#   - Human-readable lines for operator
#   - Final structured `key=value` summary line for runner-consumption:
#     "result=<success|restart_required|registry_error|unrecoverable> version=<X.Y.Z> source=<latest|pinned> elapsed_ms=<n>"
#
# Flags:
#   --pin <version>  Pin install to specific version (e.g., 0.1.0); defaults to "latest"
#   --dry-run        Report what would happen; no actual changes
#   --no-cleanup     Skip @ois/* legacy uninstall step (advanced; rarely needed)
#
# No interactive prompts — CI/operator-runner-friendly.
#
# Calibration #25 root-cause class closed structurally: silent SDK staleness
# becomes detectable via §2.7 version visibility (final stdout summary line +
# `npm ls` chain + canonical envelope adapterVersion advisoryTag).

set -euo pipefail

START_MS=$(date +%s%3N)
PIN_VERSION="latest"
DRY_RUN=0
NO_CLEANUP=0

while [ $# -gt 0 ]; do
  case "$1" in
    --pin)
      PIN_VERSION="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --no-cleanup)
      NO_CLEANUP=1
      shift
      ;;
    -h|--help)
      grep -E "^# " "$0" | head -45
      exit 0
      ;;
    *)
      echo "[update-adapter] ✗ Unknown flag: $1" >&2
      echo "result=unrecoverable version= source= elapsed_ms=0"
      exit 3
      ;;
  esac
done

PACKAGE="@apnex/claude-plugin"
PACKAGE_VERSION_SPEC="$PACKAGE@$PIN_VERSION"
LEGACY_PACKAGES=(
  "@ois/claude-plugin"
  "@ois/network-adapter"
  "@ois/cognitive-layer"
  "@ois/message-router"
)

echo "[update-adapter] OIS Adapter Update — single-command consumer flow"
echo "[update-adapter] Target: $PACKAGE_VERSION_SPEC"
[ $DRY_RUN -eq 1 ] && echo "[update-adapter] DRY-RUN MODE — no changes will be made"

# Step 1 — Conditional cleanup of legacy @ois/* installations
# (Skip on fresh-install consumers; runs only if @ois/* packages are present)
if [ $NO_CLEANUP -eq 0 ]; then
  echo ""
  echo "[update-adapter] [1/3] Checking for legacy @ois/* installations..."
  HAS_LEGACY=0
  for legacy_pkg in "${LEGACY_PACKAGES[@]}"; do
    if npm ls -g "$legacy_pkg" >/dev/null 2>&1; then
      HAS_LEGACY=1
      break
    fi
  done

  if [ $HAS_LEGACY -eq 1 ]; then
    echo "[update-adapter] Found legacy @ois/* installations; cleaning up..."
    if [ $DRY_RUN -eq 0 ]; then
      # Uninstall explicit list (no shell-glob; @ois/* is npm-scope-syntax)
      npm uninstall -g "${LEGACY_PACKAGES[@]}" 2>&1 | grep -v "^npm warn" || true
    fi
    echo "[update-adapter] ✓ Legacy cleanup complete"
  else
    echo "[update-adapter] ✓ No legacy @ois/* installations (skip cleanup)"
  fi
fi

# Step 2 — Install latest @apnex/claude-plugin
echo ""
echo "[update-adapter] [2/3] Installing $PACKAGE_VERSION_SPEC..."
if [ $DRY_RUN -eq 1 ]; then
  echo "[update-adapter] (dry-run; would run: npm install -g $PACKAGE_VERSION_SPEC)"
else
  if ! npm install -g "$PACKAGE_VERSION_SPEC" 2>&1 | tail -3; then
    rc=$?
    echo "[update-adapter] ✗ npm install failed (exit $rc)"
    elapsed=$(($(date +%s%3N) - START_MS))
    echo "result=registry_error version= source=$PIN_VERSION elapsed_ms=$elapsed"
    exit 1
  fi
fi

# Step 3 — Run install.sh from npm-installed location
echo ""
echo "[update-adapter] [3/3] Running install.sh..."
if [ $DRY_RUN -eq 1 ]; then
  INSTALLED_PATH="<npm-prefix>/lib/node_modules/$PACKAGE/install.sh"
  echo "[update-adapter] (dry-run; would run: $INSTALLED_PATH)"
else
  NPM_PREFIX="$(npm config get prefix)"
  INSTALLED_PATH="$NPM_PREFIX/lib/node_modules/$PACKAGE/install.sh"
  if [ ! -x "$INSTALLED_PATH" ]; then
    echo "[update-adapter] ✗ install.sh not found at $INSTALLED_PATH"
    elapsed=$(($(date +%s%3N) - START_MS))
    echo "result=unrecoverable version= source=$PIN_VERSION elapsed_ms=$elapsed"
    exit 3
  fi
  if ! "$INSTALLED_PATH"; then
    rc=$?
    echo "[update-adapter] ✗ install.sh failed (exit $rc)"
    elapsed=$(($(date +%s%3N) - START_MS))
    echo "result=registry_error version= source=$PIN_VERSION elapsed_ms=$elapsed"
    exit 1
  fi
fi

# Resolve installed version for visibility (§2.7 closes calibration #25)
INSTALLED_VERSION=""
if [ $DRY_RUN -eq 0 ]; then
  INSTALLED_VERSION="$(npm ls -g "$PACKAGE" --depth=0 --json 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", c => s += c); process.stdin.on("end", () => {
      try {
        const j = JSON.parse(s);
        const deps = j.dependencies || {};
        const pkg = deps["'"$PACKAGE"'"];
        process.stdout.write(pkg ? pkg.version : "");
      } catch (e) { process.stdout.write(""); }
    });
  ' 2>/dev/null || echo "")"
fi

elapsed=$(($(date +%s%3N) - START_MS))

echo ""
echo "[update-adapter] ✓ Adapter updated to $PACKAGE@${INSTALLED_VERSION:-$PIN_VERSION}"
echo "[update-adapter] Restart your Claude session to pick up the new shim"
echo ""
# Final structured stdout summary line for runner-consumption
echo "result=success version=${INSTALLED_VERSION:-$PIN_VERSION} source=$PIN_VERSION elapsed_ms=$elapsed"
exit 0
