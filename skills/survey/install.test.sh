#!/usr/bin/env bash
# install.test.sh — smoke tests for skills/survey/install.sh
#
# Tests cover: dry-run, install (per-user with redirected $HOME),
# idempotency, conflict detection, uninstall, --help.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL="$SCRIPT_DIR/install.sh"

PASS=0
FAIL=0

assert() {
  local desc="$1"
  if eval "$2"; then
    echo "  ✅ $desc"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $desc"
    FAIL=$((FAIL + 1))
  fi
}

# ── Test 1: --help exits 0 + prints usage ───────────────────────────

echo "Test 1: --help"
OUT="$(bash "$INSTALL" --help 2>&1)"
RC=$?
assert "exits 0 with --help" "[[ \$RC -eq 0 ]]"
assert "prints Usage:" "[[ \$OUT == *Usage:* ]]"
assert "lists --target=user" "[[ \$OUT == *--target=user* ]]"
assert "lists --dry-run" "[[ \$OUT == *--dry-run* ]]"
assert "lists --uninstall" "[[ \$OUT == *--uninstall* ]]"

# ── Test 2: --dry-run does not create symlink ───────────────────────

echo ""
echo "Test 2: --dry-run idempotency (no side-effects)"
TMPHOME="$(mktemp -d)"
trap 'rm -rf "$TMPHOME"' EXIT
HOME="$TMPHOME" bash "$INSTALL" --dry-run >/dev/null 2>&1
assert "dry-run does NOT create target dir" "[[ ! -e \"$TMPHOME/.claude/skills/survey\" ]]"

# ── Test 3: install (per-user) creates symlink ──────────────────────

echo ""
echo "Test 3: install --target=user creates symlink"
HOME="$TMPHOME" bash "$INSTALL" --target=user >/dev/null 2>&1
assert "symlink exists" "[[ -L \"$TMPHOME/.claude/skills/survey\" ]]"
assert "symlink points to source" "[[ \"\$(readlink \"$TMPHOME/.claude/skills/survey\")\" == \"$SCRIPT_DIR\" ]]"

# ── Test 4: idempotent re-install (correct target) skips cleanly ────

echo ""
echo "Test 4: idempotent re-install on correct symlink"
OUT="$(HOME="$TMPHOME" bash "$INSTALL" --target=user 2>&1)"
RC=$?
assert "second install exits 0" "[[ \$RC -eq 0 ]]"
assert "prints 'already in place'" "[[ \$OUT == *'already in place'* ]]"

# ── Test 5: conflict detection (wrong existing symlink) errors ──────

echo ""
echo "Test 5: conflict detection on wrong existing symlink"
ln -sfn "/tmp/wrong-target" "$TMPHOME/.claude/skills/survey"
RC=0
HOME="$TMPHOME" bash "$INSTALL" --target=user >/dev/null 2>&1 || RC=$?
assert "exits non-zero on conflict" "[[ \$RC -ne 0 ]]"

# ── Test 6: uninstall removes symlink ───────────────────────────────

echo ""
echo "Test 6: --uninstall removes symlink"
ln -sfn "$SCRIPT_DIR" "$TMPHOME/.claude/skills/survey"
HOME="$TMPHOME" bash "$INSTALL" --target=user --uninstall >/dev/null 2>&1
assert "symlink gone after uninstall" "[[ ! -L \"$TMPHOME/.claude/skills/survey\" ]]"

# ── Test 7: unknown arg errors ──────────────────────────────────────

echo ""
echo "Test 7: unknown arg rejected"
RC=0
bash "$INSTALL" --bogus >/dev/null 2>&1 || RC=$?
assert "unknown arg exits non-zero" "[[ \$RC -ne 0 ]]"

# ── Test 8 (mission-71): --silent suppresses decorative output ──────

echo ""
echo "Test 8: --silent flag (mission-71) suppresses decorative output"
TMPHOME8="$(mktemp -d)"
trap 'rm -rf "$TMPHOME8"' EXIT
OUT_NORMAL="$(HOME="$TMPHOME8" bash "$INSTALL" --target=user 2>&1)"
HOME="$TMPHOME8" bash "$INSTALL" --target=user --uninstall >/dev/null 2>&1
OUT_SILENT="$(HOME="$TMPHOME8" bash "$INSTALL" --target=user --silent 2>&1)"
assert "normal mode prints decorative output" "[[ \${#OUT_NORMAL} -gt 0 ]]"
assert "--silent suppresses output" "[[ \${#OUT_SILENT} -eq 0 ]]"
assert "--silent still creates symlink" "[[ -L \"$TMPHOME8/.claude/skills/survey\" ]]"

# ── Test 9 (mission-71): manual-snippet-print logic removed ─────────

echo ""
echo "Test 9: manual-snippet-print logic removed (M6 retrofit verification)"
SETTINGS_REF_COUNT="$(git grep -c "settings.local.json" "$INSTALL" 2>/dev/null || echo 0)"
assert "0 references to settings.local.json in install.sh" "[[ \$SETTINGS_REF_COUNT -eq 0 ]]"

# ── Test 10 (mission-71): --help lists --silent ─────────────────────

echo ""
echo "Test 10: --help lists --silent flag"
OUT_HELP="$(bash "$INSTALL" --help 2>&1)"
assert "lists --silent" "[[ \$OUT_HELP == *--silent* ]]"

# ── Summary ─────────────────────────────────────────────────────────

echo ""
echo "─────────────────────────────────────"
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] || exit 1
