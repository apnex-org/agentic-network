#!/usr/bin/env bash
# scripts/local/test-skill-bootstrap.sh — integration smoke-test for the
# claude-plugin sovereign-Skill bootstrap flow (mission-71; idea-230).
#
# Runs the full flow against the live repo's skills/ directory in an isolated
# HOME, then verifies symlink + permission consolidation. Idempotent.
#
# Per Design v1.0 §6.2 verification gate: simulates the consumer-install path
# end-to-end without depending on the `claude` CLI (which is required by the
# main claude-plugin install.sh flow but not by the bootstrap library).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="$REPO_ROOT/adapters/claude-plugin/lib/bootstrap-skills.sh"

if [ ! -f "$LIB" ]; then
  echo "[test-skill-bootstrap] ERROR: lib not found at $LIB" >&2
  exit 1
fi

# Isolated HOME for the test
TMPHOME="$(mktemp -d)"
trap 'rm -rf "$TMPHOME"' EXIT

echo "[test-skill-bootstrap] running bootstrap_skills against $REPO_ROOT/skills/"
echo "[test-skill-bootstrap] HOME redirected to $TMPHOME"
echo ""

PLUGIN_DIR="$REPO_ROOT/adapters/claude-plugin" \
CONTEXT="source-tree" \
REPO_ROOT="$REPO_ROOT" \
HOME="$TMPHOME" \
bash -c "
  source '$LIB'
  bootstrap_skills
"

echo ""
echo "[test-skill-bootstrap] ── Verification gates ──"

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

# Gate 1: skills/survey symlink created at user-global location
assert "symlink ~/.claude/skills/survey exists" "[[ -L \"$TMPHOME/.claude/skills/survey\" ]]"
assert "symlink resolves to sovereign source" "[[ \"\$(readlink \"$TMPHOME/.claude/skills/survey\")\" == \"$REPO_ROOT/skills/survey\" ]]"

# Gate 2: settings.local.json created with permissions.allow array
SETTINGS="$TMPHOME/.claude/settings.local.json"
assert "settings.local.json exists" "[[ -f \"$SETTINGS\" ]]"
assert "settings.local.json is valid JSON" "jq -e . \"$SETTINGS\" >/dev/null"
assert "permissions.allow is an array" "jq -e '.permissions.allow | type == \"array\"' \"$SETTINGS\" >/dev/null"

# Gate 3: survey-skill permission entries consolidated
assert "Bash(skills/survey/scripts/*:*) entry merged" "jq -e '.permissions.allow | index(\"Bash(skills/survey/scripts/*:*)\") != null' \"$SETTINGS\" >/dev/null"
assert "Bash(*skills/survey/scripts/*:*) entry merged" "jq -e '.permissions.allow | index(\"Bash(*skills/survey/scripts/*:*)\") != null' \"$SETTINGS\" >/dev/null"

# Gate 4: idempotent re-run preserves single occurrence
PLUGIN_DIR="$REPO_ROOT/adapters/claude-plugin" \
CONTEXT="source-tree" \
REPO_ROOT="$REPO_ROOT" \
HOME="$TMPHOME" \
bash -c "
  source '$LIB'
  bootstrap_skills
" > /dev/null 2>&1

COUNT="$(jq '[.permissions.allow[] | select(. == "Bash(skills/survey/scripts/*:*)")] | length' "$SETTINGS")"
assert "idempotent re-run: 1 occurrence after 2 runs" "[[ \$COUNT -eq 1 ]]"

# Gate 5: emit_snippet_fallback works with real fragment
SNIPPET="$(
  PLUGIN_DIR="$REPO_ROOT/adapters/claude-plugin" \
  CONTEXT="source-tree" \
  REPO_ROOT="$REPO_ROOT" \
  bash -c "
    source '$LIB'
    emit_snippet_fallback '$REPO_ROOT/skills/survey/.skill-permissions.json'
  " 2>/dev/null
)"
JSON_PORTION="$(echo "$SNIPPET" | sed -n '/^{$/,/^}$/p')"
assert "fallback snippet parses as valid JSON" "echo \"\$JSON_PORTION\" | jq -e . >/dev/null"

echo ""
echo "─────────────────────────────────────"
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] || exit 1
echo ""
echo "[test-skill-bootstrap] ✅ Integration smoke-test PASS"
