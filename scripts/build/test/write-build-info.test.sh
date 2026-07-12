#!/usr/bin/env bash
#
# scripts/build/test/write-build-info.test.sh — unit test for write-build-info.js
#
# M-Build-Identity-AdvisoryTag (idea-256) Phase 8 deliverable.
# Design v1.0 §2.1 — verifies the prepack-script writes a well-formed
# dist/build-info.json with all 4 expected fields, the dirty-detection
# bit flips correctly when the working tree is dirty, and the
# graceful-fallback path emits "unknown" / null / false rather than
# failing the build when git is unavailable.
#
# Test scope:
#   1. Clean-tree case: invoke from a fresh git repo with one commit.
#      Verify dist/build-info.json has commitSha (7-hex), dirty=false,
#      buildTime (ISO-8601), branch=main.
#   2. Dirty-tree case: add an untracked file. Verify dirty=true.
#   3. No-git case: invoke from a non-git directory. Verify all fields
#      fall back to "unknown" / false (no exception).
#
# Usage: ./scripts/build/test/write-build-info.test.sh
#
# Exit: 0 on success; non-zero on any assertion failure.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/build/write-build-info.js"
TMP_BASE="$(mktemp -d -t build-info-test-XXXXXX)"
trap 'rm -rf "$TMP_BASE"' EXIT

PASS=0
FAIL=0

# Cases 1-3 verify the git-derived FALLBACK path — unset the idea-493 provenance
# overrides so ambient env (e.g. a publish shell) can't leak in and skew them.
# Case 4 sets them explicitly to verify the override.
unset OIS_BUILD_SHA OIS_BUILD_DIRTY OIS_BUILD_BRANCH

assert() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  ✓ $desc"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $desc"
    echo "    expected: $expected"
    echo "    actual:   $actual"
    FAIL=$((FAIL + 1))
  fi
}

assert_match() {
  local desc="$1" pattern="$2" actual="$3"
  if [[ "$actual" =~ $pattern ]]; then
    echo "  ✓ $desc"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $desc"
    echo "    pattern: $pattern"
    echo "    actual:  $actual"
    FAIL=$((FAIL + 1))
  fi
}

# ── Case 1: clean git tree ────────────────────────────────────────────
echo "Case 1: clean-tree case"
CLEAN_DIR="$TMP_BASE/clean"
mkdir -p "$CLEAN_DIR"
cd "$CLEAN_DIR"
git init -q
git config user.email "test@example.com"
git config user.name "test"
git checkout -q -b main 2>/dev/null || git branch -m main
echo "hello" > README.md
git add README.md
git commit -q -m "initial commit"

node "$SCRIPT" >/dev/null

[ -f dist/build-info.json ] || { echo "  ✗ dist/build-info.json missing"; FAIL=$((FAIL + 1)); }

# Use node to parse JSON portably (jq may not be present)
COMMIT_SHA=$(node -e "console.log(JSON.parse(require('fs').readFileSync('dist/build-info.json','utf-8')).commitSha)")
DIRTY=$(node -e "console.log(JSON.parse(require('fs').readFileSync('dist/build-info.json','utf-8')).dirty)")
BUILD_TIME=$(node -e "console.log(JSON.parse(require('fs').readFileSync('dist/build-info.json','utf-8')).buildTime)")
BRANCH=$(node -e "console.log(JSON.parse(require('fs').readFileSync('dist/build-info.json','utf-8')).branch)")

# F6 internal-stored regex contract: 7-hex OR "unknown"
assert_match "commitSha matches /^[a-f0-9]{7}\$|^unknown\$/" "^[a-f0-9]{7}$|^unknown$" "$COMMIT_SHA"
assert "dirty=false on clean tree" "false" "$DIRTY"
assert_match "buildTime is ISO-8601 UTC" "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]+Z$" "$BUILD_TIME"
assert "branch=main" "main" "$BRANCH"

# ── Case 2: dirty git tree ────────────────────────────────────────────
echo "Case 2: dirty-tree case"
echo "uncommitted" > untracked.txt
node "$SCRIPT" >/dev/null
DIRTY2=$(node -e "console.log(JSON.parse(require('fs').readFileSync('dist/build-info.json','utf-8')).dirty)")
assert "dirty=true with untracked file" "true" "$DIRTY2"

# ── Case 3: no-git fallback ───────────────────────────────────────────
echo "Case 3: no-git fallback case"
NOGIT_DIR="$TMP_BASE/nogit"
mkdir -p "$NOGIT_DIR"
cd "$NOGIT_DIR"
node "$SCRIPT" >/dev/null

NOGIT_SHA=$(node -e "console.log(JSON.parse(require('fs').readFileSync('dist/build-info.json','utf-8')).commitSha)")
NOGIT_DIRTY=$(node -e "console.log(JSON.parse(require('fs').readFileSync('dist/build-info.json','utf-8')).dirty)")
NOGIT_BRANCH=$(node -e "console.log(JSON.parse(require('fs').readFileSync('dist/build-info.json','utf-8')).branch)")
assert "no-git: commitSha=unknown" "unknown" "$NOGIT_SHA"
assert "no-git: dirty=false (git status fails → empty → not non-empty)" "false" "$NOGIT_DIRTY"
assert "no-git: branch=unknown" "unknown" "$NOGIT_BRANCH"

# ── Case 4: idea-493 provenance override ──────────────────────────────
# The publish path captures the VERIFIED-CLEAN source identity BEFORE
# version-rewrite.js dirties the tree, and exports OIS_BUILD_SHA/DIRTY/BRANCH so
# this prepack stamp (which fires AFTER the rewrite) attests the true source
# rather than the transient rewrite churn. Reuse the Case-2 repo, which still has
# untracked.txt (live git → dirty=true); the exported OIS_BUILD_DIRTY=false must
# win, proving a genuinely-dirty live tree can't override an explicit clean stamp.
echo "Case 4: idea-493 provenance-override case"
cd "$CLEAN_DIR"
OIS_BUILD_SHA="abc1234" OIS_BUILD_DIRTY="false" OIS_BUILD_BRANCH="release" node "$SCRIPT" >/dev/null
OVR_SHA=$(node -e "console.log(JSON.parse(require('fs').readFileSync('dist/build-info.json','utf-8')).commitSha)")
OVR_DIRTY=$(node -e "console.log(JSON.parse(require('fs').readFileSync('dist/build-info.json','utf-8')).dirty)")
OVR_BRANCH=$(node -e "console.log(JSON.parse(require('fs').readFileSync('dist/build-info.json','utf-8')).branch)")
assert "override: commitSha honors OIS_BUILD_SHA" "abc1234" "$OVR_SHA"
assert "override: dirty honors OIS_BUILD_DIRTY=false despite dirty tree" "false" "$OVR_DIRTY"
assert "override: branch honors OIS_BUILD_BRANCH" "release" "$OVR_BRANCH"

# ── Result ────────────────────────────────────────────────────────────
echo ""
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
