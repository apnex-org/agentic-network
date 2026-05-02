#!/usr/bin/env bash
# Test cases for check-skip-criteria.sh — Idea Triage Protocol routing.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="${SCRIPT_DIR}/check-skip-criteria.sh"

PASS=0
FAIL=0
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT INT TERM HUP

assert_exit() {
  local expected=$1 actual=$2 label=$3
  if [[ "$actual" -eq "$expected" ]]; then
    echo "  ✓ $label (exit $actual)"
    PASS=$((PASS+1))
  else
    echo "  ✗ $label (expected exit $expected, got $actual)" >&2
    FAIL=$((FAIL+1))
  fi
}

# Idea text with full scope + tele citation (covers C2 + C4 heuristics)
cat > "$TMPDIR/idea-clean.txt" <<'EOF'
Concrete idea with in-scope items, out-of-scope deferrals, and explicit anti-goals.
Tele alignment: tele-3 + tele-2.
EOF

# Idea text without scope keywords or tele
cat > "$TMPDIR/idea-vague.txt" <<'EOF'
Just a vague concept stub with no scope declaration.
EOF

echo "[check-skip-criteria.test] All-met → exit 0 (route a)"
set +e; bash "$SCRIPT" \
  --idea-id=idea-1 \
  --idea-text-file="$TMPDIR/idea-clean.txt" \
  --source=director \
  --contest=none \
  --single-mission-shape=true \
  >/dev/null 2>&1; rc=$?; set -e
assert_exit 0 "$rc" "all 5 met → route (a) skip-direct"

echo "[check-skip-criteria.test] Engineer source + no contest → exit 1 (route b)"
set +e; bash "$SCRIPT" \
  --idea-id=idea-2 \
  --idea-text-file="$TMPDIR/idea-clean.txt" \
  --source=engineer \
  --contest=none \
  --single-mission-shape=true \
  >/dev/null 2>&1; rc=$?; set -e
assert_exit 1 "$rc" "engineer-source needs ratification → route (b) triage-thread"

echo "[check-skip-criteria.test] Engineer contest detected → exit 1 (route b)"
set +e; bash "$SCRIPT" \
  --idea-id=idea-3 \
  --idea-text-file="$TMPDIR/idea-clean.txt" \
  --source=director \
  --contest=engineer \
  --single-mission-shape=true \
  >/dev/null 2>&1; rc=$?; set -e
assert_exit 1 "$rc" "engineer contest → route (b) triage-thread"

echo "[check-skip-criteria.test] Single-mission-shape failed → exit 2 (route c)"
set +e; bash "$SCRIPT" \
  --idea-id=idea-4 \
  --idea-text-file="$TMPDIR/idea-clean.txt" \
  --source=director \
  --contest=none \
  --single-mission-shape=false \
  >/dev/null 2>&1; rc=$?; set -e
assert_exit 2 "$rc" "single-mission-shape=false → route (c) Strategic Review queue"

echo "[check-skip-criteria.test] Vague text without overrides → exit 1 (route b safety)"
set +e; bash "$SCRIPT" \
  --idea-id=idea-5 \
  --idea-text-file="$TMPDIR/idea-vague.txt" \
  --source=director \
  --contest=none \
  --single-mission-shape=true \
  >/dev/null 2>&1; rc=$?; set -e
assert_exit 1 "$rc" "vague idea text → bilateral safety route (b)"

echo "[check-skip-criteria.test] Missing --idea-id → exit 1"
set +e; bash "$SCRIPT" --source=director >/dev/null 2>&1; rc=$?; set -e
assert_exit 1 "$rc" "missing --idea-id"

echo
echo "[check-skip-criteria.test] Result: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]] || exit 1
exit 0
