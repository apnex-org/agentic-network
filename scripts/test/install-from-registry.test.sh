#!/usr/bin/env bash
#
# scripts/test/install-from-registry.test.sh — install-from-registry test surface
#
# Mission-64 W1+W2-fix deliverable (Calibration #33 fix); would have caught
# the P0 packaging defect in @apnex/claude-plugin@0.1.0 (marketplace.json
# missing from npm-installed location).
#
# Test scope:
#   1. Pack @apnex/claude-plugin via `npm pack` (simulates published tarball)
#   2. Extract tarball + verify marketplace.json present at .claude-plugin/marketplace.json
#   3. Verify plugin.json present at .claude-plugin/plugin.json
#   4. Verify install.sh present + executable
#   5. Verify dist/ pre-built (per Pass 10 §B mechanisation)
#   6. Verify package.json `files` array (or default) bundles .claude-plugin/
#
# This test catches packaging defects BEFORE publish — calibration #33 fix.
# Run as part of pre-merge dry-run validation.
#
# Usage: ./scripts/test/install-from-registry.test.sh
#
# Exit:
#   0 = packaging GREEN (would-be tarball ships all required files)
#   1 = packaging RED (one or more required files missing)

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

echo "=== install-from-registry test for @apnex/claude-plugin ==="

# Setup: pack the would-be tarball + extract
TARBALL_DIR="/tmp/m64-install-from-registry-$$"
mkdir -p "$TARBALL_DIR"
trap "rm -rf $TARBALL_DIR" EXIT

# Apply version-rewrite (* → ^X.Y.Z) so the rendered package.json matches what
# would be published; revert at end. This mirrors the prepublishOnly lifecycle.
node scripts/version-rewrite.js >/dev/null 2>&1

if ! npm pack --workspace=@apnex/claude-plugin --pack-destination "$TARBALL_DIR" >/dev/null 2>&1; then
  assert_fail "0.0 npm pack failed (cannot run downstream tests)"
  node scripts/version-rewrite.js --revert >/dev/null 2>&1
  exit 1
fi

# Locate the tarball (filename = <scope-stripped>-<name>-<version>.tgz)
TARBALL="$(ls "$TARBALL_DIR"/apnex-claude-plugin-*.tgz 2>/dev/null | head -1)"
if [ -z "$TARBALL" ] || [ ! -f "$TARBALL" ]; then
  assert_fail "0.1 tarball not produced at expected location"
  node scripts/version-rewrite.js --revert >/dev/null 2>&1
  exit 1
fi
assert_pass "0.1 tarball produced: $(basename "$TARBALL")"

# Extract to temp dir
EXTRACT_DIR="$TARBALL_DIR/extracted"
mkdir -p "$EXTRACT_DIR"
tar -xzf "$TARBALL" -C "$EXTRACT_DIR"
PKG_ROOT="$EXTRACT_DIR/package"

# Test 1 — marketplace.json present (THE P0 defect that broke 0.1.0)
echo ""
echo "Section 1: marketplace.json bundled (Calibration #33 root-cause fix)"
if [ -f "$PKG_ROOT/.claude-plugin/marketplace.json" ]; then
  assert_pass "1.1 .claude-plugin/marketplace.json present in tarball"
else
  assert_fail "1.1 .claude-plugin/marketplace.json MISSING from tarball" "P0 defect class — claude plugin marketplace add will fail"
fi

# Test 2 — marketplace.json source field references plugin correctly
if [ -f "$PKG_ROOT/.claude-plugin/marketplace.json" ]; then
  src_path="$(node -e "
    const m = JSON.parse(require('fs').readFileSync('$PKG_ROOT/.claude-plugin/marketplace.json', 'utf8'));
    process.stdout.write(m.plugins[0].source || '');
  ")"
  if [ -n "$src_path" ]; then
    # claude marketplace parser empirically requires leading "./" (Calibration #36; verified
    # on claude 2.1.121 — bare ".." or "." rejected as "source type your Claude Code version
    # does not support"). Validate format-only here; full e2e exercises actual claude plugin
    # install in scripts/test/full-end-to-end-install.test.sh.
    case "$src_path" in
      ./|./.|./*)
        assert_pass "1.2 marketplace.json source format claude-parser-friendly: '$src_path' (starts with ./)"
        ;;
      *)
        assert_fail "1.2 marketplace.json source format will reject from claude-parser" "Actual: '$src_path' — Calibration #36 defect class (need leading ./)"
        ;;
    esac
  else
    assert_fail "1.2 marketplace.json missing plugins[0].source field"
  fi
fi

# Test 3 — plugin.json present
echo ""
echo "Section 2: plugin manifest"
if [ -f "$PKG_ROOT/.claude-plugin/plugin.json" ]; then
  assert_pass "2.1 .claude-plugin/plugin.json present"
else
  assert_fail "2.1 .claude-plugin/plugin.json MISSING"
fi

# Test 4 — install.sh present + executable mode survives tarball
echo ""
echo "Section 3: install.sh shipping correctly"
if [ -f "$PKG_ROOT/install.sh" ]; then
  assert_pass "3.1 install.sh present in tarball"
  if [ -x "$PKG_ROOT/install.sh" ]; then
    assert_pass "3.2 install.sh executable bit preserved"
  else
    assert_fail "3.2 install.sh present but not executable" "users would need chmod +x"
  fi
else
  assert_fail "3.1 install.sh MISSING from tarball"
fi

# Test 5 — dist/ pre-built (Pass 10 §B mechanisation)
echo ""
echo "Section 4: pre-built dist/ (Pass 10 §B)"
if [ -d "$PKG_ROOT/dist" ] && [ -f "$PKG_ROOT/dist/shim.js" ]; then
  assert_pass "4.1 dist/shim.js pre-built in tarball (consumer skips local tsc)"
else
  assert_fail "4.1 dist/shim.js MISSING from tarball" "consumer would need local tsc; defeats §B mechanisation"
fi

# Test 6 — package.json deps registry-pinned semver (not "*")
echo ""
echo "Section 5: published deps are registry-pinned semver"
deps_check="$(node -e "
const pkg = JSON.parse(require('fs').readFileSync('$PKG_ROOT/package.json', 'utf8'));
let bad = [];
for (const [name, spec] of Object.entries(pkg.dependencies || {})) {
  if (name.startsWith('@apnex/') && (spec === '*' || spec === '')) {
    bad.push(name + ': ' + spec);
  }
}
if (bad.length === 0) {
  process.stdout.write('OK');
} else {
  process.stdout.write(bad.join('; '));
}
")"
if [ "$deps_check" = "OK" ]; then
  assert_pass "5.1 all @apnex/* deps registry-pinned (no '*' placeholders escaped to tarball)"
else
  assert_fail "5.1 unsafe deps in published package.json" "$deps_check"
fi

# Test 7 — install.sh context-detection logic in tarball (npm-installed branch)
echo ""
echo "Section 6: install.sh context-detection"
if [ -f "$PKG_ROOT/install.sh" ]; then
  if grep -q "CONTEXT=\"npm-installed\"" "$PKG_ROOT/install.sh"; then
    assert_pass "6.1 install.sh has npm-installed context branch"
  else
    assert_fail "6.1 install.sh missing npm-installed context branch"
  fi
fi

# Test 8 — .mcp.json bundled (Calibration #38 NEW; mission-64 W1+W2-fix-3)
# .mcp.json registers the MCP server with Claude Code. Without it, Claude
# Code loads the plugin (manifest validation passes) but never spawns the
# shim subprocess. Root-cause class: gitignore-root-anchor-leakage — repo
# root .gitignore rule "/.mcp.json" is re-anchored by npm-packlist to each
# workspace root, silently excluding adapters/claude-plugin/.mcp.json from
# publish. Structural fix: explicit "files" field in package.json bypasses
# gitignore-fallback path entirely.
echo ""
echo "Section 7: .mcp.json bundled (Calibration #38 root-cause fix)"
if [ -f "$PKG_ROOT/.mcp.json" ]; then
  assert_pass "7.1 .mcp.json present in tarball (Claude Code MCP server registration)"
  mcp_proxy="$(node -e "
    const m = JSON.parse(require('fs').readFileSync('$PKG_ROOT/.mcp.json', 'utf8'));
    process.stdout.write(Object.keys(m.mcpServers || {}).join(','));
  ")"
  if echo "$mcp_proxy" | grep -q "proxy"; then
    assert_pass "7.2 .mcp.json declares mcpServers.proxy (canonical server name)"
  else
    assert_fail "7.2 .mcp.json missing mcpServers.proxy declaration" "Actual servers: '$mcp_proxy'"
  fi
else
  assert_fail "7.1 .mcp.json MISSING from tarball" "Calibration #38 defect class — Claude Code will not spawn MCP server"
fi

# Cleanup: revert version-rewrite back to placeholder
node scripts/version-rewrite.js --revert >/dev/null 2>&1

# Summary
echo ""
echo "=== install-from-registry test results ==="
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
echo "✓ Tarball ships all required files; install-from-registry should succeed."
echo "✓ Calibration #33 (consumer-install-from-registry test surface) closed structurally."
exit 0
