#!/usr/bin/env bash
# Test cases for tier-stub.sh — parameterized Tier-2/3 stub.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="${SCRIPT_DIR}/tier-stub.sh"

PASS=0
FAIL=0

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

echo "[tier-stub.test] Tier-2 tele dimension → exit 42 sentinel"
set +e; bash "$SCRIPT" --tier=2 --dimension=tele >/dev/null 2>&1; rc=$?; set -e
assert_exit 42 "$rc" "tier=2 dimension=tele returns 42"

echo "[tier-stub.test] Tier-3 idea dimension → exit 42 sentinel"
set +e; bash "$SCRIPT" --tier=3 --dimension=idea >/dev/null 2>&1; rc=$?; set -e
assert_exit 42 "$rc" "tier=3 dimension=idea returns 42"

echo "[tier-stub.test] Invalid tier → exit 1"
set +e; bash "$SCRIPT" --tier=4 --dimension=tele >/dev/null 2>&1; rc=$?; set -e
assert_exit 1 "$rc" "tier=4 (invalid) returns 1"

echo "[tier-stub.test] Invalid dimension → exit 1"
set +e; bash "$SCRIPT" --tier=2 --dimension=bogus >/dev/null 2>&1; rc=$?; set -e
assert_exit 1 "$rc" "dimension=bogus (invalid) returns 1"

echo "[tier-stub.test] Missing required arg → exit 1"
set +e; bash "$SCRIPT" --tier=2 >/dev/null 2>&1; rc=$?; set -e
assert_exit 1 "$rc" "missing dimension returns 1"

echo "[tier-stub.test] Unknown arg → exit 1"
set +e; bash "$SCRIPT" --tier=2 --dimension=tele --bogus=x >/dev/null 2>&1; rc=$?; set -e
assert_exit 1 "$rc" "unknown arg --bogus returns 1"

echo
echo "[tier-stub.test] Result: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]] || exit 1
exit 0
