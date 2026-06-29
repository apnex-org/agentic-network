#!/usr/bin/env bash
# swap-staged-adapter.sh — activate a locally-STAGED claude-plugin build by swapping it into
# the live marketplace directory. (Directory-source install model — distinct from the
# npm-global model in update-adapter.sh; reconciling the two is idea-390/391 future work.)
#
# Phase-B of the stint-6 prep arc (idea-389): brings the rebuilt adapter (which carries the
# ToolSurfaceReconciler, #375) live, so the blueprint verbs (seed_blueprint /
# get_current_stint / legal_moves) become reachable on the next claude-code session start.
# The deployed-but-stale build (8556b99, 11 commits behind) lacked the reconciler — which is
# why those verbs stayed invisible even across a plain restart.
#
# RUN ONLY AFTER STOPPING ALL claude-code sessions (lily + greg). The live proxies execute
# directly from the live dir's dist/shim.js, so swapping while they run risks a lazy-load
# fault. Guard 1 REFUSES to run while a live proxy is detected.
# Steve (opencode) uses a different adapter and is unaffected — keep him live for the run.
#
# Usage:  bash swap-staged-adapter.sh [STAGED_DIR]
#   STAGED_DIR defaults to the current stint-6 staged build (package-staged-567ccd6).
# Rollback: stop sessions, then mv the preserved package-old-<ts> dir back to .../package.
set -euo pipefail

MARKET="/home/apnex/apnex-claude-plugin"
LIVE="$MARKET/package"
STAGED="${1:-$MARKET/package-staged-567ccd6}"

echo "== swap-staged-adapter: activate  $STAGED  ->  $LIVE =="

# GUARD 1 — refuse to swap while a live claude-code proxy runs from the live dir.
if pgrep -f "$LIVE/dist/shim.js" >/dev/null 2>&1; then
  echo "ABORT: a claude-code proxy is STILL running from $LIVE/dist/shim.js."
  echo "       Stop ALL claude-code sessions (lily + greg), then re-run this script."
  exit 1
fi

# GUARD 2 — staged + live dirs sane before touching anything.
[ -d "$STAGED" ]              || { echo "ABORT: staged build not found: $STAGED"; exit 1; }
[ -f "$STAGED/dist/shim.js" ] || { echo "ABORT: staged build missing dist/shim.js: $STAGED"; exit 1; }
[ -d "$LIVE" ]                || { echo "ABORT: live dir not found: $LIVE"; exit 1; }

BAK="$MARKET/package-old-$(date +%Y%m%d-%H%M%S)"
mv "$LIVE" "$BAK"
mv "$STAGED" "$LIVE"

echo "OK — adapter activated."
echo "  live now : $LIVE   (rebuilt build; ToolSurfaceReconciler #375 present)"
echo "  previous : $BAK    (rollback: stop sessions, mv this back to $LIVE)"
echo
echo "NEXT: relaunch the claude-code sessions (lily + greg); ensure Steve (opencode) is live."
echo "      Then in lily's session send 'continue' -> she verifies the blueprint verbs are"
echo "      reachable -> Phase C (seed + run the autonomous strategic-review)."
