#!/usr/bin/env bash
# install.test.sh — smoke tests for adapters/claude-plugin/lib/bootstrap-skills.sh
#
# Tests cover bootstrap_skills() + merge_skill_permissions() +
# emit_snippet_fallback() per mission-71 Design §6.1 (12 cases).
#
# Created NEW in mission-71 Phase 8 — Design §6.1 + greg's round-1 audit
# referenced this file as "(existing): extend" but it didn't exist;
# preflight §F3 caught the gap; CREATED here modeled on
# skills/survey/install.test.sh test pattern.
#
# Test approach: source lib/bootstrap-skills.sh directly with synthesized
# PLUGIN_DIR + CONTEXT + REPO_ROOT env vars; no claude-plugin install main
# flow involved. Each test isolates HOME via mktemp.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$SCRIPT_DIR/lib/bootstrap-skills.sh"

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

# Helper: run bootstrap_skills() in an isolated subshell with synthesized env.
# Args: $1=skills-parent-dir (becomes REPO_ROOT in source-tree mode), $2=HOME
# Returns the captured stdout/stderr in $RESULT global.
run_bootstrap() {
  local repo_root="$1"
  local fake_home="$2"
  local result
  result="$(
    set +e
    HOME="$fake_home" \
    PLUGIN_DIR="$repo_root/adapters/claude-plugin" \
    CONTEXT="source-tree" \
    REPO_ROOT="$repo_root" \
    bash -c "
      source '$LIB'
      bootstrap_skills 2>&1
    "
  )"
  RESULT="$result"
  RC=$?
}

# ── Test 1: bootstrap_skills with empty skills dir → no-op success ──

echo "Test 1: bootstrap_skills with empty skills dir"
TMP1="$(mktemp -d)"
mkdir -p "$TMP1/skills"
TMPHOME1="$(mktemp -d)"
run_bootstrap "$TMP1" "$TMPHOME1"
assert "exits 0" "[[ \$RC -eq 0 ]]"
assert "summary reports 0 installed" "[[ \"\$RESULT\" == *'installed: 0'* ]]"
rm -rf "$TMP1" "$TMPHOME1"

# ── Test 2: one skill with valid fragment → installed + merged ──

echo ""
echo "Test 2: one skill with valid .skill-permissions.json"
TMP2="$(mktemp -d)"
mkdir -p "$TMP2/skills/foo"
cat > "$TMP2/skills/foo/install.sh" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$TMP2/skills/foo/install.sh"
cat > "$TMP2/skills/foo/.skill-permissions.json" <<'EOF'
{"schema-version": "1.0", "permissions": {"allow": ["Bash(foo:*)"]}}
EOF
TMPHOME2="$(mktemp -d)"
run_bootstrap "$TMP2" "$TMPHOME2"
assert "exits 0" "[[ \$RC -eq 0 ]]"
assert "reports 1 installed" "[[ \"\$RESULT\" == *'installed: 1'* ]]"
assert "permissions merged" "jq -e '.permissions.allow | index(\"Bash(foo:*)\") != null' \"$TMPHOME2/.claude/settings.local.json\" >/dev/null"
rm -rf "$TMP2" "$TMPHOME2"

# ── Test 3: skill missing install.sh → skipped ──

echo ""
echo "Test 3: skill missing install.sh → skipped"
TMP3="$(mktemp -d)"
mkdir -p "$TMP3/skills/bar"
TMPHOME3="$(mktemp -d)"
run_bootstrap "$TMP3" "$TMPHOME3"
assert "exits 0" "[[ \$RC -eq 0 ]]"
assert "reports skipped: 1" "[[ \"\$RESULT\" == *'skipped: 1'* ]]"
rm -rf "$TMP3" "$TMPHOME3"

# ── Test 4: skill install.sh exits nonzero → failed ──

echo ""
echo "Test 4: skill install.sh exits nonzero → failed"
TMP4="$(mktemp -d)"
mkdir -p "$TMP4/skills/baz"
cat > "$TMP4/skills/baz/install.sh" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod +x "$TMP4/skills/baz/install.sh"
TMPHOME4="$(mktemp -d)"
run_bootstrap "$TMP4" "$TMPHOME4"
assert "exits 0 (best-effort)" "[[ \$RC -eq 0 ]]"
assert "reports failed: 1" "[[ \"\$RESULT\" == *'failed: 1'* ]]"
rm -rf "$TMP4" "$TMPHOME4"

# ── Test 5: malformed .skill-permissions.json → warn + skip ──

echo ""
echo "Test 5: malformed .skill-permissions.json → warn + skip"
TMP5="$(mktemp -d)"
mkdir -p "$TMP5/skills/qux"
cat > "$TMP5/skills/qux/install.sh" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$TMP5/skills/qux/install.sh"
echo "{not valid json" > "$TMP5/skills/qux/.skill-permissions.json"
TMPHOME5="$(mktemp -d)"
run_bootstrap "$TMP5" "$TMPHOME5"
assert "exits 0" "[[ \$RC -eq 0 ]]"
assert "warn surfaces invalid JSON" "[[ \"\$RESULT\" == *'invalid JSON'* ]]"
rm -rf "$TMP5" "$TMPHOME5"

# ── Test 6: idempotent re-run → no duplicate entries ──

echo ""
echo "Test 6: idempotent re-run (no duplicates)"
TMP6="$(mktemp -d)"
mkdir -p "$TMP6/skills/idem"
cat > "$TMP6/skills/idem/install.sh" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$TMP6/skills/idem/install.sh"
cat > "$TMP6/skills/idem/.skill-permissions.json" <<'EOF'
{"schema-version": "1.0", "permissions": {"allow": ["Bash(idem:*)"]}}
EOF
TMPHOME6="$(mktemp -d)"
run_bootstrap "$TMP6" "$TMPHOME6"
run_bootstrap "$TMP6" "$TMPHOME6"   # 2nd run
COUNT="$(jq '.permissions.allow | map(select(. == "Bash(idem:*)")) | length' "$TMPHOME6/.claude/settings.local.json")"
assert "exactly 1 occurrence after 2 runs" "[[ \$COUNT -eq 1 ]]"
rm -rf "$TMP6" "$TMPHOME6"

# ── Test 7 (m4 NEW): skills dir absent entirely → no-op success ──

echo ""
echo "Test 7: skills/ dir absent entirely (m4 fold)"
TMP7="$(mktemp -d)"
# NO skills/ subdir
TMPHOME7="$(mktemp -d)"
run_bootstrap "$TMP7" "$TMPHOME7"
assert "exits 0 with no skills dir" "[[ \$RC -eq 0 ]]"
assert "reports 'no skills dir found'" "[[ \"\$RESULT\" == *'no skills dir found'* ]]"
rm -rf "$TMP7" "$TMPHOME7"

# ── Test 8 (M4 NEW): permissions exists but allow absent → step 2.5 creates ──

echo ""
echo "Test 8: permissions exists but allow absent (M4 fold step 2.5)"
TMP8="$(mktemp -d)"
mkdir -p "$TMP8/skills/m4test"
cat > "$TMP8/skills/m4test/install.sh" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$TMP8/skills/m4test/install.sh"
cat > "$TMP8/skills/m4test/.skill-permissions.json" <<'EOF'
{"schema-version": "1.0", "permissions": {"allow": ["Bash(m4test:*)"]}}
EOF
TMPHOME8="$(mktemp -d)"
mkdir -p "$TMPHOME8/.claude"
echo '{"permissions": {"deny": ["Bash(rm:*)"]}}' > "$TMPHOME8/.claude/settings.local.json"
run_bootstrap "$TMP8" "$TMPHOME8"
assert "permissions.allow created" "jq -e '.permissions.allow | type == \"array\"' \"$TMPHOME8/.claude/settings.local.json\" >/dev/null"
assert "permissions.deny preserved" "jq -e '.permissions.deny | index(\"Bash(rm:*)\") != null' \"$TMPHOME8/.claude/settings.local.json\" >/dev/null"
assert "fragment merged into allow" "jq -e '.permissions.allow | index(\"Bash(m4test:*)\") != null' \"$TMPHOME8/.claude/settings.local.json\" >/dev/null"
rm -rf "$TMP8" "$TMPHOME8"

# ── Test 9 (M1 NEW): schema-version 1.x accepted (major-version-compat) ──

echo ""
echo "Test 9: schema-version 1.5 accepted (M1 major-version-compat)"
TMP9="$(mktemp -d)"
mkdir -p "$TMP9/skills/m1test"
cat > "$TMP9/skills/m1test/install.sh" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$TMP9/skills/m1test/install.sh"
cat > "$TMP9/skills/m1test/.skill-permissions.json" <<'EOF'
{"schema-version": "1.5", "permissions": {"allow": ["Bash(m1test:*)"]}, "future-key": "ignored"}
EOF
TMPHOME9="$(mktemp -d)"
run_bootstrap "$TMP9" "$TMPHOME9"
assert "1.5 fragment merged" "jq -e '.permissions.allow | index(\"Bash(m1test:*)\") != null' \"$TMPHOME9/.claude/settings.local.json\" >/dev/null"
rm -rf "$TMP9" "$TMPHOME9"

# ── Test 10 (M1 NEW): schema-version 2.0 rejected ──

echo ""
echo "Test 10: schema-version 2.0 rejected (M1 MAJOR mismatch)"
TMP10="$(mktemp -d)"
mkdir -p "$TMP10/skills/v2test"
cat > "$TMP10/skills/v2test/install.sh" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$TMP10/skills/v2test/install.sh"
cat > "$TMP10/skills/v2test/.skill-permissions.json" <<'EOF'
{"schema-version": "2.0", "permissions": {"allow": ["Bash(v2test:*)"]}}
EOF
TMPHOME10="$(mktemp -d)"
run_bootstrap "$TMP10" "$TMPHOME10"
assert "warn surfaces unsupported schema major" "[[ \"\$RESULT\" == *'unsupported schema major'* ]]"
assert "v2 fragment NOT merged" "! jq -e '.permissions.allow | index(\"Bash(v2test:*)\") != null' \"$TMPHOME10/.claude/settings.local.json\" >/dev/null 2>&1"
rm -rf "$TMP10" "$TMPHOME10"

# ── Test 11 (M3 NEW): per-skill stale-symlink refuse → bootstrap reports failed ──

echo ""
echo "Test 11: per-skill install.sh refuses on stale symlink (M3 fold)"
TMP11="$(mktemp -d)"
mkdir -p "$TMP11/skills/stale"
cat > "$TMP11/skills/stale/install.sh" <<'EOF'
#!/usr/bin/env bash
# Simulates skills/survey/install.sh refuse-and-exit on stale symlink
echo "[install] ❌ stale symlink (simulated)" >&2
exit 1
EOF
chmod +x "$TMP11/skills/stale/install.sh"
TMPHOME11="$(mktemp -d)"
run_bootstrap "$TMP11" "$TMPHOME11"
assert "exits 0 (best-effort)" "[[ \$RC -eq 0 ]]"
assert "reports failed: 1" "[[ \"\$RESULT\" == *'failed: 1'* ]]"
rm -rf "$TMP11" "$TMPHOME11"

# ── Test 12 (n1 NEW round-2): fallback emits valid JSON across multi-fragment ──

echo ""
echo "Test 12: emit_snippet_fallback emits valid JSON (n1 fold)"
TMP12="$(mktemp -d)"
cat > "$TMP12/frag1.json" <<'EOF'
{"schema-version": "1.0", "permissions": {"allow": ["Bash(a:*)", "Bash(b:*)"]}}
EOF
cat > "$TMP12/frag2.json" <<'EOF'
{"schema-version": "1.0", "permissions": {"allow": ["Bash(c:*)"]}}
EOF
TMPHOME12="$(mktemp -d)"
SNIPPET="$(
  HOME="$TMPHOME12" \
  PLUGIN_DIR="$TMP12/adapters/claude-plugin" \
  CONTEXT="source-tree" \
  REPO_ROOT="$TMP12" \
  bash -c "
    source '$LIB'
    emit_snippet_fallback '$TMP12/frag1.json' '$TMP12/frag2.json'
  " 2>/dev/null
)"
# Extract just the JSON portion (between first { and last })
JSON="$(echo "$SNIPPET" | sed -n '/^{$/,/^}$/p')"
assert "fallback parses as valid JSON" "echo \"\$JSON\" | jq -e . >/dev/null"
COUNT12="$(echo "$JSON" | jq -r '.permissions.allow | length')"
assert "fallback contains all 3 entries" "[[ \$COUNT12 -eq 3 ]]"
rm -rf "$TMP12" "$TMPHOME12"

# ── Summary ─────────────────────────────────────────────────────────

echo ""
echo "─────────────────────────────────────"
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] || exit 1
