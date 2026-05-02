#!/usr/bin/env bash
# Test cases for survey-init.sh — Survey envelope scaffolding.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="${SCRIPT_DIR}/survey-init.sh"

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

assert_exists() {
  if [[ -f "$1" ]]; then
    echo "  ✓ $2 exists"
    PASS=$((PASS+1))
  else
    echo "  ✗ $2 missing" >&2
    FAIL=$((FAIL+1))
  fi
}

assert_grep() {
  if grep -q "$1" "$2"; then
    echo "  ✓ $3"
    PASS=$((PASS+1))
  else
    echo "  ✗ $3 (pattern '$1' not found in $2)" >&2
    FAIL=$((FAIL+1))
  fi
}

# Each test runs in an isolated working dir copy of the Skill body
setup_workdir() {
  local wd=$1
  mkdir -p "$wd/skills/survey/scripts"
  cp "${SCRIPT_DIR}/../envelope-template.md" "$wd/skills/survey/envelope-template.md"
  cp "$SCRIPT" "$wd/skills/survey/scripts/survey-init.sh"
}

echo "[survey-init.test] Happy path without idea-text-file"
WD="$TMPDIR/happy"
setup_workdir "$WD"
( cd "$WD" && bash skills/survey/scripts/survey-init.sh --mission-name=M-Test-Mission --idea-id=idea-999 >/dev/null 2>&1 )
rc=$?
assert_exit 0 "$rc" "happy-path without idea-text-file"
assert_exists "$WD/docs/surveys/m-test-mission-survey.md" "envelope file"
assert_grep "M-Test-Mission" "$WD/docs/surveys/m-test-mission-survey.md" "mission-name substituted"
assert_grep "idea-999" "$WD/docs/surveys/m-test-mission-survey.md" "idea-id substituted"

echo "[survey-init.test] Happy path with idea-text-file (Tier-1 happy)"
WD="$TMPDIR/with-text"
setup_workdir "$WD"
echo "Test idea body — short description for substrate gap" > "$TMPDIR/idea-text.txt"
( cd "$WD" && bash skills/survey/scripts/survey-init.sh --mission-name=M-Test-Two --idea-id=idea-1000 --idea-text-file="$TMPDIR/idea-text.txt" >/dev/null 2>&1 )
rc=$?
assert_exit 0 "$rc" "happy-path with idea-text-file"
assert_grep "Source idea text" "$WD/docs/surveys/m-test-two-survey.md" "idea-context section seeded"
assert_grep "Test idea body" "$WD/docs/surveys/m-test-two-survey.md" "idea text content present"

echo "[survey-init.test] Missing required arg → exit 1"
WD="$TMPDIR/missing-arg"
setup_workdir "$WD"
set +e; ( cd "$WD" && bash skills/survey/scripts/survey-init.sh --mission-name=M-X >/dev/null 2>&1 ); rc=$?; set -e
assert_exit 1 "$rc" "missing --idea-id"

echo "[survey-init.test] Bad mission-name → exit 1"
WD="$TMPDIR/bad-name"
setup_workdir "$WD"
set +e; ( cd "$WD" && bash skills/survey/scripts/survey-init.sh --mission-name=NotPrefixed --idea-id=idea-1 >/dev/null 2>&1 ); rc=$?; set -e
assert_exit 1 "$rc" "mission-name without 'M-' prefix"

echo "[survey-init.test] Bad idea-id → exit 1"
WD="$TMPDIR/bad-id"
setup_workdir "$WD"
set +e; ( cd "$WD" && bash skills/survey/scripts/survey-init.sh --mission-name=M-Test --idea-id=not-an-idea >/dev/null 2>&1 ); rc=$?; set -e
assert_exit 1 "$rc" "malformed idea-id"

echo "[survey-init.test] Refuse overwrite → exit 1"
WD="$TMPDIR/overwrite"
setup_workdir "$WD"
( cd "$WD" && bash skills/survey/scripts/survey-init.sh --mission-name=M-Once --idea-id=idea-1 >/dev/null 2>&1 )
set +e; ( cd "$WD" && bash skills/survey/scripts/survey-init.sh --mission-name=M-Once --idea-id=idea-1 >/dev/null 2>&1 ); rc=$?; set -e
assert_exit 1 "$rc" "refuse-overwrite on second invocation"

echo
echo "[survey-init.test] Result: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]] || exit 1
exit 0
