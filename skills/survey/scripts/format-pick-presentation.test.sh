#!/usr/bin/env bash
# Test cases for format-pick-presentation.sh — Round-N question rendering.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="${SCRIPT_DIR}/format-pick-presentation.sh"

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

cat > "$TMPDIR/questions.md" <<'EOF'
**Q1 — MVP scope:** What feature scope?
- (a) minimal
- (b) targeted
- (c) extended
- (d) full

**Q2 — Sovereignty depth:** How deep is sovereignty?
- (a) flat
- (b) tier-1 only
- (c) tier-1 + tier-2
- (d) tier-1 + tier-2/3 stubbed

**Q3 — Pattern posture:** How explicit is the pattern?
- (a) implicit
- (b) noted
- (c) anchored
- (d) codified

**Q4 — Helper invocation:** How are scripts invoked?
- (a) per-call
- (b) batched per round
- (c) per phase
- (d) batched gates

**Q5 — Stub marking:** How are stubs marked?
- (a) inline comments
- (b) separate scripts
- (c) status matrix
- (d) frontmatter only

**Q6 — Output format:** What output format?
- (a) prose only
- (b) table
- (c) JSON
- (d) frontmatter
EOF

echo "[format-pick-presentation.test] Round 1 happy path"
set +e; bash "$SCRIPT" --round=1 --questions-file="$TMPDIR/questions.md" >/dev/null 2>&1; rc=$?; set -e
assert_exit 0 "$rc" "Round 1 renders"

echo "[format-pick-presentation.test] Round 2 happy path"
set +e; bash "$SCRIPT" --round=2 --questions-file="$TMPDIR/questions.md" >/dev/null 2>&1; rc=$?; set -e
assert_exit 0 "$rc" "Round 2 renders"

echo "[format-pick-presentation.test] Missing question → exit 1"
cat > "$TMPDIR/missing.md" <<'EOF'
**Q1 — MVP scope:** What feature scope?
- (a) one
EOF
set +e; bash "$SCRIPT" --round=1 --questions-file="$TMPDIR/missing.md" >/dev/null 2>&1; rc=$?; set -e
assert_exit 1 "$rc" "Q2/Q3 missing in Round 1 → exit 1"

echo "[format-pick-presentation.test] Invalid round → exit 1"
set +e; bash "$SCRIPT" --round=3 --questions-file="$TMPDIR/questions.md" >/dev/null 2>&1; rc=$?; set -e
assert_exit 1 "$rc" "round=3 invalid"

echo "[format-pick-presentation.test] Missing required arg → exit 1"
set +e; bash "$SCRIPT" --round=1 >/dev/null 2>&1; rc=$?; set -e
assert_exit 1 "$rc" "missing --questions-file"

echo "[format-pick-presentation.test] Missing file → exit 1"
set +e; bash "$SCRIPT" --round=1 --questions-file="$TMPDIR/does-not-exist.md" >/dev/null 2>&1; rc=$?; set -e
assert_exit 1 "$rc" "missing questions-file"

echo
echo "[format-pick-presentation.test] Result: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]] || exit 1
exit 0
