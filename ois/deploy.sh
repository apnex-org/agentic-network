#!/usr/bin/env bash
#
# ois/deploy.sh — install the canonical ois (ois/bin/ois, the source of truth)
# to the Director's workstation live path, with a pre-overwrite backup.
#
#   ./ois/deploy.sh          install to ~/.config/apnex-agents/bin/ois
#   ./ois/deploy.sh --diff   show canonical-vs-live diff, change nothing
#
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bin/ois"
DEST="$HOME/.config/apnex-agents/bin/ois"

[[ -f "$SRC" ]] || { echo "error: canonical source not found at $SRC" >&2; exit 1; }
bash -n "$SRC" || { echo "error: canonical source fails bash -n; refusing to deploy" >&2; exit 1; }

if [[ "${1:-}" == "--diff" ]]; then
  diff -u "$DEST" "$SRC" && echo "live copy is identical to canonical"
  exit 0
fi

mkdir -p "$(dirname "$DEST")"
if [[ -f "$DEST" ]]; then
  BAK="$DEST.bak-$(date +%Y%m%d-%H%M%S)"
  cp -p "$DEST" "$BAK"
  echo "backed up live copy -> $BAK"
fi
install -m 0755 "$SRC" "$DEST"
echo "deployed $SRC -> $DEST"
echo "verify: ois doctor"
