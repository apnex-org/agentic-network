#!/usr/bin/env bash
#
# scripts/test/update-adapter-cli.test.sh — CLI-contract regression test
#
# Mission-64 W1+W2 deliverable per Design v1.0 §5.2 #2 + Engineer round-1
# audit + round-2 ratify (thread-405 round-7).
#
# Protects the CLI contract that idea-221's Pass 10 cross-§ orchestration
# runner consumes (Design v1.0 §2.10 + ADR-029 forward-consequences).
# Independent of integration tests; regression-test surface that
# downstream-runner ratifies against.
#
# Contract surface tested:
#   - Exit codes 0 / 1 / 2 / 3 (per Design §2.1.B)
#   - Stdout final structured `key=value` summary line
#   - Flags: --pin <version>, --dry-run, --no-cleanup, --help
#   - No interactive prompts (script runs headless)
#
# Usage: ./scripts/test/update-adapter-cli.test.sh
#
# Exit:
#   0 = all tests passed
#   1 = one or more tests failed (output details for which)

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/local/update-adapter.sh"

PASS=0
FAIL=0
FAILED_TESTS=()

run_test() {
  local name="$1"
  shift
  local expected_exit="$1"
  shift
  local expected_pattern="$1"
  shift
  local cmd=("$@")

  local out rc
  out="$("${cmd[@]}" 2>&1)" || rc=$?
  rc="${rc:-0}"

  if [ "$rc" != "$expected_exit" ]; then
    FAIL=$((FAIL + 1))
    FAILED_TESTS+=("$name: expected exit=$expected_exit got=$rc")
    echo "  ✗ $name (exit code mismatch)"
    return
  fi

  if [ -n "$expected_pattern" ] && ! echo "$out" | grep -qE "$expected_pattern"; then
    FAIL=$((FAIL + 1))
    FAILED_TESTS+=("$name: stdout missing pattern '$expected_pattern'")
    echo "  ✗ $name (stdout pattern mismatch)"
    return
  fi

  PASS=$((PASS + 1))
  echo "  ✓ $name"
}

echo "=== CLI-contract regression test for $SCRIPT ==="

# Test 1 — --help returns exit 0 + shows usage
echo ""
echo "Section 1: --help flag"
run_test "1.1 --help exits 0" 0 "Mission-64" "$SCRIPT" --help
run_test "1.2 --help shows exit codes" 0 "Exit codes:" "$SCRIPT" --help

# Test 2 — --dry-run exits 0 + emits structured stdout final-line
echo ""
echo "Section 2: --dry-run flag"
run_test "2.1 --dry-run exits 0" 0 "result=success" "$SCRIPT" --dry-run
run_test "2.2 --dry-run emits version=" 0 "version=" "$SCRIPT" --dry-run
run_test "2.3 --dry-run emits source=" 0 "source=" "$SCRIPT" --dry-run
run_test "2.4 --dry-run emits elapsed_ms=" 0 "elapsed_ms=" "$SCRIPT" --dry-run

# Test 3 — --pin <version> uses that version
echo ""
echo "Section 3: --pin flag"
run_test "3.1 --pin 0.1.0 --dry-run shows pinned version" 0 "version=0.1.0" "$SCRIPT" --pin 0.1.0 --dry-run
run_test "3.2 --pin 0.1.0 --dry-run source=0.1.0" 0 "source=0.1.0" "$SCRIPT" --pin 0.1.0 --dry-run

# Test 4 — Default uses 'latest'
echo ""
echo "Section 4: default version pin"
run_test "4.1 --dry-run defaults source=latest" 0 "source=latest" "$SCRIPT" --dry-run

# Test 5 — Unknown flag returns exit 3 (unrecoverable)
echo ""
echo "Section 5: invalid flags"
run_test "5.1 --unknown-flag exits 3" 3 "result=unrecoverable" "$SCRIPT" --unknown-flag

# Test 6 — --no-cleanup flag accepted
echo ""
echo "Section 6: --no-cleanup flag"
run_test "6.1 --no-cleanup --dry-run exits 0" 0 "result=success" "$SCRIPT" --no-cleanup --dry-run

# Test 7 — Stdout structured summary line shape (key=value space-separated)
echo ""
echo "Section 7: structured stdout shape"
out="$("$SCRIPT" --dry-run 2>&1)"
last_line="$(echo "$out" | grep "^result=" | tail -1)"
if [ -z "$last_line" ]; then
  FAIL=$((FAIL + 1))
  FAILED_TESTS+=("7.1 final summary line missing")
  echo "  ✗ 7.1 final summary line shape (missing)"
else
  # Verify key=value format with required keys
  required_keys=("result" "version" "source" "elapsed_ms")
  missing=""
  for key in "${required_keys[@]}"; do
    if ! echo "$last_line" | grep -qE "(^|[[:space:]])$key="; then
      missing="$missing $key"
    fi
  done
  if [ -z "$missing" ]; then
    PASS=$((PASS + 1))
    echo "  ✓ 7.1 final summary line shape ($last_line)"
  else
    FAIL=$((FAIL + 1))
    FAILED_TESTS+=("7.1 final summary line missing keys:$missing")
    echo "  ✗ 7.1 final summary line shape (missing keys:$missing)"
  fi
fi

# Test 8 — No interactive prompts (script completes without hanging on stdin)
echo ""
echo "Section 8: headless operation"
out="$(timeout 10s "$SCRIPT" --dry-run </dev/null 2>&1 || echo TIMED_OUT)"
if echo "$out" | grep -qE "TIMED_OUT|read|prompt"; then
  FAIL=$((FAIL + 1))
  FAILED_TESTS+=("8.1 script appears to require stdin (interactive)")
  echo "  ✗ 8.1 headless operation (interactive prompts detected)"
else
  PASS=$((PASS + 1))
  echo "  ✓ 8.1 headless operation"
fi

# Summary
echo ""
echo "=== CLI-contract test results ==="
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Failed tests:"
  for t in "${FAILED_TESTS[@]}"; do
    echo "  - $t"
  done
  exit 1
fi
echo ""
echo "✓ All CLI contract assertions hold; idea-221 runner-consumption interface protected."
exit 0
