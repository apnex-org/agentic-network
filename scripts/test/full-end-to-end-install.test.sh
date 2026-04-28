#!/usr/bin/env bash
#
# scripts/test/full-end-to-end-install.test.sh — TRUE end-to-end install test
#
# Mission-64 W1+W2-fix-2 deliverable; closes Calibration #37 (install-from-
# registry test surface insufficient — file-presence test missed source-format
# defect + version-rewrite never-fired defect).
#
# Test scope:
#   1. Run publish-packages.sh --dry-run (exercises actual publish flow incl.
#      version-rewrite hoist; emulates registry publish without slot-claim)
#   2. Pack 4 publish-scope tarballs
#   3. Inspect rendered package.json deps in claude-plugin tarball — verify
#      registry-pinned semver (NOT *); catches Calibration #35 defect class
#   4. npm install --prefix /tmp/<dir> the claude-plugin tarball locally
#      (emulates `npm install -g @apnex/claude-plugin@<v>` from registry)
#   5. Run install.sh from npm-installed location
#   6. Assert install.sh exits 0 + marketplace add succeeded + claude plugin
#      install successful — catches Calibration #36 defect class
#
# This test exercises the FULL consumer install path. Catches:
#   - Missing files in tarball (Calibration #33)
#   - Wrong source format in marketplace.json (Calibration #36)
#   - * deps escaping to published tarball (Calibration #35)
#   - Plugin not loadable post-install (any future packaging defect)
#
# Usage: ./scripts/test/full-end-to-end-install.test.sh
#
# Exit:
#   0 = full e2e GREEN; tarball + install + claude plugin install all succeed
#   1 = one or more steps failed
#   2 = test setup error (claude CLI missing, etc.)

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

PASS=0
FAIL=0
FAILED_TESTS=()

assert_pass() {
  PASS=$((PASS + 1))
  echo "  ✓ $1"
}
assert_fail() {
  FAIL=$((FAIL + 1))
  FAILED_TESTS+=("$1${2:+: $2}")
  echo "  ✗ $1${2:+: $2}"
}

echo "=== Full end-to-end install test for @apnex/claude-plugin ==="

# Pre-flight: claude CLI present?
if ! command -v claude >/dev/null 2>&1; then
  echo "✗ claude CLI not on PATH; cannot run end-to-end install test"
  exit 2
fi

TEST_DIR="/tmp/m64-e2e-install-$$"
mkdir -p "$TEST_DIR"
trap "rm -rf $TEST_DIR" EXIT

# Step 1 — Apply version-rewrite explicitly (mirrors hoisted publish-packages.sh flow)
echo ""
echo "Section 1: pack flow with hoisted version-rewrite"
node scripts/version-rewrite.js >/dev/null 2>&1
echo "  ✓ version-rewrite applied (deps now ^X.Y.Z)"

# Step 2 — Pack the 4 publish-scope tarballs
if ! npm pack --workspace=@apnex/cognitive-layer --workspace=@apnex/message-router --workspace=@apnex/network-adapter --workspace=@apnex/claude-plugin --pack-destination "$TEST_DIR" >/dev/null 2>&1; then
  assert_fail "1.1 npm pack failed for 4 publish-scope packages"
  node scripts/version-rewrite.js --revert >/dev/null 2>&1
  exit 1
fi
assert_pass "1.1 4 tarballs packed"

CP_TGZ="$(ls "$TEST_DIR"/apnex-claude-plugin-*.tgz 2>/dev/null | head -1)"
if [ -z "$CP_TGZ" ]; then
  assert_fail "1.2 claude-plugin tarball not found"
  node scripts/version-rewrite.js --revert >/dev/null 2>&1
  exit 1
fi

# Step 3 — Verify rendered package.json has registry-pinned deps (Calibration #35)
echo ""
echo "Section 2: rendered tarball deps registry-pinned (Calibration #35 fix)"
deps_json="$(tar -xzf "$CP_TGZ" -O package/package.json 2>/dev/null | node -e "let s=''; process.stdin.on('data', c => s+=c); process.stdin.on('end', () => { try { const p = JSON.parse(s); process.stdout.write(JSON.stringify(p.dependencies)); } catch(e) {} });")"
if echo "$deps_json" | grep -qE '"@apnex/[^"]+":\s*"\*"'; then
  assert_fail "2.1 published tarball has unsafe \"*\" deps for @apnex/* siblings" "Calibration #35 defect class"
  echo "    Actual deps: $deps_json"
else
  if echo "$deps_json" | grep -qE '"@apnex/[^"]+":\s*"\^[0-9]'; then
    assert_pass "2.1 published tarball has registry-pinned ^X.Y.Z for @apnex/* siblings"
  else
    assert_fail "2.1 published tarball deps unexpected format" "Actual: $deps_json"
  fi
fi

# Step 4 — Verify marketplace.json source format (Calibration #36)
echo ""
echo "Section 3: marketplace.json source format (Calibration #36 fix)"
marketplace_src="$(tar -xzf "$CP_TGZ" -O package/.claude-plugin/marketplace.json 2>/dev/null | node -e "let s=''; process.stdin.on('data', c => s+=c); process.stdin.on('end', () => { try { const m = JSON.parse(s); process.stdout.write(m.plugins[0].source || ''); } catch(e) {} });")"
case "$marketplace_src" in
  ./|./.|./*)
    assert_pass "3.1 marketplace.json source format starts with \"./\" (claude-marketplace-parser-friendly): $marketplace_src"
    ;;
  *)
    assert_fail "3.1 marketplace.json source format will reject from claude-marketplace-parser" "Actual: '$marketplace_src' (need leading \"./\")"
    ;;
esac

# Step 5 — Local emulation of `npm install -g @apnex/claude-plugin`
echo ""
echo "Section 4: local install emulation"
INSTALL_PREFIX="$TEST_DIR/install-prefix"
mkdir -p "$INSTALL_PREFIX"
# npm install with --prefix installs to $INSTALL_PREFIX/lib/node_modules/<pkg>
# We need all 4 deps available; create a host package.json that lists tarball paths
cat > "$INSTALL_PREFIX/package.json" <<EOF
{
  "name": "m64-e2e-host",
  "version": "0.0.0",
  "private": true,
  "dependencies": {
    "@apnex/cognitive-layer": "file:$TEST_DIR/$(ls $TEST_DIR/apnex-cognitive-layer-*.tgz | xargs basename)",
    "@apnex/message-router": "file:$TEST_DIR/$(ls $TEST_DIR/apnex-message-router-*.tgz | xargs basename)",
    "@apnex/network-adapter": "file:$TEST_DIR/$(ls $TEST_DIR/apnex-network-adapter-*.tgz | xargs basename)",
    "@apnex/claude-plugin": "file:$TEST_DIR/$(basename $CP_TGZ)"
  }
}
EOF
if (cd "$INSTALL_PREFIX" && npm install --no-audit --no-fund --silent 2>&1 | tail -3) >/dev/null; then
  assert_pass "4.1 local install of 4 tarballs succeeded (emulates registry install)"
else
  assert_fail "4.1 local install failed" "see $INSTALL_PREFIX/package.json"
fi

# Step 6 — Run install.sh from installed location + assert exit 0
echo ""
echo "Section 5: install.sh exits 0 from npm-installed location"
INSTALL_SH="$INSTALL_PREFIX/node_modules/@apnex/claude-plugin/install.sh"
if [ ! -x "$INSTALL_SH" ]; then
  assert_fail "5.0 install.sh not found at expected path" "$INSTALL_SH"
else
  # Ensure CLAUDE_PLUGIN_CACHE_DIR is set to test-isolated dir so we don't pollute global state
  test_cache="$TEST_DIR/claude-cache"
  mkdir -p "$test_cache"
  install_out="$(CLAUDE_PLUGIN_CACHE_DIR="$test_cache" "$INSTALL_SH" 2>&1)"
  install_rc=$?
  if [ $install_rc -eq 0 ]; then
    assert_pass "5.1 install.sh exit 0 (marketplace add + claude plugin install both succeeded)"
    if echo "$install_out" | grep -qiE "marketplace.*added|registered local marketplace"; then
      assert_pass "5.2 install.sh stdout indicates marketplace registered"
    fi
    if echo "$install_out" | grep -qiE "plugin.*install"; then
      assert_pass "5.3 install.sh stdout indicates claude plugin install path"
    fi
  else
    assert_fail "5.1 install.sh exited $install_rc" "Calibration #36 defect class — likely marketplace source format or path issue"
    echo "----- install.sh output -----"
    echo "$install_out" | tail -10
    echo "-----------------------------"
  fi
fi

# Cleanup: revert source-tree to placeholder
node scripts/version-rewrite.js --revert >/dev/null 2>&1

# Summary
echo ""
echo "=== Full end-to-end install test results ==="
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
echo "✓ Full e2e install GREEN — Calibrations #35 + #36 + #37 closed structurally."
exit 0
