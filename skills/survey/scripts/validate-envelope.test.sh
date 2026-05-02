#!/usr/bin/env bash
# Test cases for validate-envelope.sh — Survey envelope §15 schema enforcement.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="${SCRIPT_DIR}/validate-envelope.sh"

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

# Build a complete valid envelope fixture
make_valid_envelope() {
  cat > "$1" <<'EOF'
---
mission-name: M-Test
source-idea: idea-1
methodology-source: docs/methodology/idea-survey.md v1.0
director-picks:
  round-1:
    Q1: a
    Q2: b
    Q3: c
  round-2:
    Q4: d
    Q5: a
    Q6: b
mission-class: substrate-introduction
tele-alignment:
  primary: [tele-3]
  secondary: [tele-2]
  round-1:
    primary: [tele-3]
    secondary: [tele-2]
  round-2:
    primary: [tele-11]
    secondary: [tele-12]
anti-goals-count: 3
architect-flags-count: 2
skill-meta:
  skill-version: survey-v1.0
  tier-1-status: implemented
  tier-2-status: stubbed
  tier-3-status: stubbed
calibration-data:
  director-time-cost-minutes: 5
  comparison-baseline: mission-67
  notes: clean execution
calibration-cross-refs:
  closures-applied: []
  candidates-surfaced: []
---

# M-Test — Phase 3 Survey envelope

## §0 Context

Some context paragraph.

## §1 Round 1 picks

### §1.Q1 — Per-question interpretation

Real interpretation paragraph here. Cites tele.

### §1.Q2 — Per-question interpretation

Real paragraph two.

### §1.Q3 — Per-question interpretation

Real paragraph three.

## §2 Round 2 picks

### §2.Q4 — Per-question interpretation

Real interpretation paragraph.

### §2.Q5 — Per-question interpretation

Real interpretation paragraph.

### §2.Q6 — Per-question interpretation

Real interpretation paragraph.

## §3 Composite intent envelope

Some composite read.

## §4 Mission scope summary

Bound table here.

## §5 Anti-goals

Listed.

## §6 Architect-flags

Listed.

## §7 Sequencing

Listed.

## §calibration

5 minutes; mission-67 baseline; clean.

## §8 Cross-references

Listed.
EOF
}

echo "[validate-envelope.test] Valid envelope → exit 0"
make_valid_envelope "$TMPDIR/valid.md"
set +e; bash "$SCRIPT" --envelope-path="$TMPDIR/valid.md" >/dev/null 2>&1; rc=$?; set -e
assert_exit 0 "$rc" "complete envelope PASS"

echo "[validate-envelope.test] Missing frontmatter key → exit 1"
make_valid_envelope "$TMPDIR/no-mc.md"
sed -i '/^mission-class:/d' "$TMPDIR/no-mc.md"
set +e; bash "$SCRIPT" --envelope-path="$TMPDIR/no-mc.md" >/dev/null 2>&1; rc=$?; set -e
assert_exit 1 "$rc" "missing mission-class FAIL"

echo "[validate-envelope.test] Bad mission-class enum value → exit 1"
make_valid_envelope "$TMPDIR/bad-mc.md"
sed -i 's/^mission-class: substrate-introduction/mission-class: not-a-real-class/' "$TMPDIR/bad-mc.md"
set +e; bash "$SCRIPT" --envelope-path="$TMPDIR/bad-mc.md" >/dev/null 2>&1; rc=$?; set -e
assert_exit 1 "$rc" "bad mission-class FAIL"

echo "[validate-envelope.test] Missing per-question interpretation → exit 1"
make_valid_envelope "$TMPDIR/no-q1-interp.md"
# Replace §1.Q1 sub-section header so it can't be found
sed -i 's/^### §1.Q1 — Per-question interpretation/### §1.Bogus heading/' "$TMPDIR/no-q1-interp.md"
set +e; bash "$SCRIPT" --envelope-path="$TMPDIR/no-q1-interp.md" >/dev/null 2>&1; rc=$?; set -e
assert_exit 1 "$rc" "missing §1.Q1 interp FAIL"

echo "[validate-envelope.test] Empty per-question interpretation → exit 1"
make_valid_envelope "$TMPDIR/empty-q2-interp.md"
# Replace the body of §1.Q2 with placeholder text only
awk '
  BEGIN { skip = 0 }
  /^### §1.Q2 — Per-question interpretation$/ { print; print ""; print "<placeholder>"; print ""; skip = 1; next }
  skip && /^### / { skip = 0 }
  skip && /^## / { skip = 0 }
  !skip { print }
' "$TMPDIR/empty-q2-interp.md" > "$TMPDIR/empty-q2-interp.md.new"
mv "$TMPDIR/empty-q2-interp.md.new" "$TMPDIR/empty-q2-interp.md"
set +e; bash "$SCRIPT" --envelope-path="$TMPDIR/empty-q2-interp.md" >/dev/null 2>&1; rc=$?; set -e
assert_exit 1 "$rc" "placeholder-only §1.Q2 interp FAIL"

echo "[validate-envelope.test] Missing per-round tele-mapping → exit 1"
make_valid_envelope "$TMPDIR/no-round1-tele.md"
# Drop the round-1 sub-block of tele-alignment
awk '
  BEGIN { skip = 0; depth = 0 }
  /^tele-alignment:/ { print; in_te = 1; next }
  in_te && /^[[:space:]]+round-1:/ { skip = 1; next }
  skip && /^[[:space:]]+round-2:/ { skip = 0 }
  skip && /^[a-zA-Z]/ { skip = 0; in_te = 0 }
  !skip { print }
' "$TMPDIR/no-round1-tele.md" > "$TMPDIR/no-round1-tele.md.new"
mv "$TMPDIR/no-round1-tele.md.new" "$TMPDIR/no-round1-tele.md"
set +e; bash "$SCRIPT" --envelope-path="$TMPDIR/no-round1-tele.md" >/dev/null 2>&1; rc=$?; set -e
assert_exit 1 "$rc" "no round-1 tele-mapping FAIL"

echo "[validate-envelope.test] Missing calibration-data field → exit 1"
make_valid_envelope "$TMPDIR/no-calib-notes.md"
sed -i '/^[[:space:]]\+notes:/d' "$TMPDIR/no-calib-notes.md"
set +e; bash "$SCRIPT" --envelope-path="$TMPDIR/no-calib-notes.md" >/dev/null 2>&1; rc=$?; set -e
assert_exit 1 "$rc" "missing calibration-data.notes FAIL"

echo "[validate-envelope.test] Non-integer director-time-cost-minutes → exit 1"
make_valid_envelope "$TMPDIR/bad-dtc.md"
sed -i 's/director-time-cost-minutes: 5/director-time-cost-minutes: five/' "$TMPDIR/bad-dtc.md"
set +e; bash "$SCRIPT" --envelope-path="$TMPDIR/bad-dtc.md" >/dev/null 2>&1; rc=$?; set -e
assert_exit 1 "$rc" "non-integer director-time-cost-minutes FAIL"

echo "[validate-envelope.test] Missing prose section → exit 1"
make_valid_envelope "$TMPDIR/no-anti-goals.md"
sed -i 's/^## §5 Anti-goals$/## §5 Removed/' "$TMPDIR/no-anti-goals.md"
set +e; bash "$SCRIPT" --envelope-path="$TMPDIR/no-anti-goals.md" >/dev/null 2>&1; rc=$?; set -e
assert_exit 1 "$rc" "missing §5 Anti-goals FAIL"

echo "[validate-envelope.test] Missing required arg → exit 1"
set +e; bash "$SCRIPT" >/dev/null 2>&1; rc=$?; set -e
assert_exit 1 "$rc" "missing --envelope-path"

echo
echo "[validate-envelope.test] Result: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]] || exit 1
exit 0
