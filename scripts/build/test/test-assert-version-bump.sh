#!/usr/bin/env bash
#
# scripts/build/test/test-assert-version-bump.sh — write-build-info.js --assert gate test
#
# idea-355 SLICE-3 / bug-182 (version-bump ASSERT/GATE). Verifies the
# `node scripts/build/write-build-info.js --assert` decision against tiny,
# self-contained, deterministic temp git fixtures:
#
#   1. SKIP  — first-release / no-version-commit (current version never
#              committed into package.json) → exit 0.
#   2. FAIL  — src/ advanced PAST the version bump (a later src-only commit) →
#              exit 1.
#   3. PASS  — version bumped with/after the latest src change → exit 0.
#
# Usage: ./scripts/build/test/test-assert-version-bump.sh
# Exit:  0 on success; non-zero on any expectation miss.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/build/write-build-info.js"

PASS=0
FAIL=0

# Make a temp git repo with package.json (version $1) + a src/ file.
mk_repo() {
  local dir="$1" version="$2"
  mkdir -p "$dir/src"
  ( cd "$dir"
    git init -q
    git config user.email "test@example.com"
    git config user.name "assert-test"
    git config commit.gpgsign false
    printf '{\n  "name": "fixture-pkg",\n  "version": "%s"\n}\n' "$version" > package.json
    printf 'export const x = 1;\n' > src/index.js
    git add -A
    git commit -qm "init: version + src" )
}

# Run the assert in $1; echo the exit code (never aborts under set -e).
run_assert() {
  local dir="$1" rc=0
  ( cd "$dir" && node "$SCRIPT" --assert ) >/dev/null 2>&1 || rc=$?
  echo "$rc"
}

expect() {
  local label="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then
    echo "  ✓ $label (exit $got)"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $label: expected exit $want, got $got"
    FAIL=$((FAIL + 1))
  fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── Case 1: SKIP — current version never committed (first-release class) ──
SKIP_DIR="$TMP/skip"
mk_repo "$SKIP_DIR" "0.0.1"
# Bump the working-tree version WITHOUT committing → versionCommit indeterminate.
( cd "$SKIP_DIR" && printf '{\n  "name": "fixture-pkg",\n  "version": "0.0.2"\n}\n' > package.json )
expect "SKIP on no-version-commit (uncommitted bump)" "$(run_assert "$SKIP_DIR")" "0"

# ── Case 2: FAIL — src advanced past the version bump ────────────────────
FAIL_DIR="$TMP/fail"
mk_repo "$FAIL_DIR" "0.0.1"
( cd "$FAIL_DIR"
  printf 'export const x = 2;\n' > src/index.js   # src-only change, NO version bump
  git add -A
  git commit -qm "feat: change src without bumping version" )
expect "FAIL on src-advanced-past-version" "$(run_assert "$FAIL_DIR")" "1"

# ── Case 3: PASS — version bumped after the latest src change ─────────────
PASS_DIR="$TMP/pass"
mk_repo "$PASS_DIR" "0.0.1"
( cd "$PASS_DIR"
  printf 'export const x = 2;\n' > src/index.js
  git add -A
  git commit -qm "feat: change src"
  printf '{\n  "name": "fixture-pkg",\n  "version": "0.0.2"\n}\n' > package.json
  git add -A
  git commit -qm "chore: bump version to 0.0.2" )
expect "PASS when version bumped after src" "$(run_assert "$PASS_DIR")" "0"

echo ""
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
