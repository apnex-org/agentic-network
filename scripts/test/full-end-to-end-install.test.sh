#!/usr/bin/env bash
#
# scripts/test/full-end-to-end-install.test.sh — npm-registry end-to-end install test
#
# npmdeliver0 (idea-492): validates the SINGLE surviving delivery channel —
# `npm install @apnex/claude-plugin@<ver>` from the npm registry (the Channel-2
# GitHub-Release vendored-tarball path is RETIRED). Proves the consumer install path
# end-to-end, exercising exactly what the ois claude_seed cutover relies on:
#   1. `npm install @apnex/claude-plugin@<ver>` resolves from the registry
#   2. @apnex/network-adapter comes FROM THE REGISTRY (no vendored apnex-*.tgz), and
#      claude-plugin declares it as registry semver (^X.Y.Z), NOT a file: ref
#   3. marketplace.json source format is claude-marketplace-parser-friendly ("./")
#   4. @apnex/network-adapter + dist/shim.js are loadable from the installed location
#   5. install.sh (npm-installed mode) exits 0 + registers the marketplace + plugin
#   6. .mcp.json is delivered (else Claude Code never spawns the shim)
#
# <ver> is read from the source tree's adapters/claude-plugin/package.json, so the
# test tracks the current version (which must be published to the registry to pass).
#
# Usage: ./scripts/test/full-end-to-end-install.test.sh
# Exit:
#   0 = e2e GREEN (registry install + install.sh + shape all succeed)
#   1 = one or more assertions failed
#   2 = test setup error (npm/claude missing, version unreadable, registry unreachable)

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

PASS=0
FAIL=0
FAILED_TESTS=()
assert_pass() { PASS=$((PASS + 1)); echo "  ✓ $1"; }
assert_fail() { FAIL=$((FAIL + 1)); FAILED_TESTS+=("$1${2:+: $2}"); echo "  ✗ $1${2:+: $2}"; }

# Pre-flight
command -v npm >/dev/null 2>&1 || { echo "✗ npm not on PATH; cannot run npm-registry install test"; exit 2; }
command -v claude >/dev/null 2>&1 || { echo "✗ claude CLI not on PATH; cannot run end-to-end install test"; exit 2; }
VER="$(node -p "require('./adapters/claude-plugin/package.json').version" 2>/dev/null)"
[ -n "$VER" ] || { echo "✗ could not read adapters/claude-plugin/package.json version"; exit 2; }

echo "=== npm-registry end-to-end install test for @apnex/claude-plugin@$VER ==="

# Fully-isolated throwaway: isolated npm prefix + CLAUDE_CONFIG_DIR + plugin cache + HOME,
# so install.sh's marketplace-add / cache-stomp / skill-bootstrap never touch real state.
TEST_DIR="/tmp/npmdeliver0-e2e-$$"
NPM_PREFIX="$TEST_DIR/npm"
CFG_DIR="$TEST_DIR/config.claude"
CACHE_DIR="$TEST_DIR/plugin-cache"
FAKE_HOME="$TEST_DIR/home"
mkdir -p "$NPM_PREFIX" "$CFG_DIR" "$CACHE_DIR" "$FAKE_HOME"
trap 'rm -rf "$TEST_DIR"' EXIT

# Section 1 — real registry install (na@^0.1.x auto-resolves from the registry)
echo ""
echo "Section 1: npm install @apnex/claude-plugin@$VER (registry)"
if npm install --prefix "$NPM_PREFIX" "@apnex/claude-plugin@$VER" --no-audit --no-fund >/dev/null 2>&1; then
  assert_pass "1.1 npm install @apnex/claude-plugin@$VER succeeded"
else
  assert_fail "1.1 npm install @apnex/claude-plugin@$VER FAILED" "is @$VER published + registry reachable?"
fi
CP_DIR="$NPM_PREFIX/node_modules/@apnex/claude-plugin"
[ -d "$CP_DIR" ] && assert_pass "1.2 installed at $CP_DIR" || assert_fail "1.2 installed claude-plugin dir missing" "$CP_DIR"

# Section 2 — na FROM THE REGISTRY (Channel-2 retired: no vendored tgz), semver dep not file:
echo ""
echo "Section 2: na resolved from the registry (no vendored tarball)"
NA_DIR="$(find "$NPM_PREFIX/node_modules" -type d -path '*@apnex/network-adapter' 2>/dev/null | head -1)"
NA_VER="$([ -n "$NA_DIR" ] && node -p "require('$NA_DIR/package.json').version" 2>/dev/null)"
case "$NA_VER" in
  0.1.*) assert_pass "2.1 @apnex/network-adapter resolved from registry: $NA_VER";;
  *)     assert_fail "2.1 na version unexpected/unresolved" "got '$NA_VER'";;
esac
if [ -z "$(find "$NPM_PREFIX" -name 'apnex-*.tgz' 2>/dev/null | head -1)" ]; then
  assert_pass "2.2 no vendored apnex-*.tgz in the tree (na is a registry dependency)"
else
  assert_fail "2.2 unexpected vendored apnex-*.tgz present (Channel-2 vendoring should be gone)"
fi
CP_NA_DEP="$(node -p "require('$CP_DIR/package.json').dependencies['@apnex/network-adapter'] || ''" 2>/dev/null)"
if [ -n "$CP_NA_DEP" ] && [[ "$CP_NA_DEP" != file:* ]]; then
  assert_pass "2.3 claude-plugin declares na as registry semver (not file:): $CP_NA_DEP"
else
  assert_fail "2.3 claude-plugin na dep is not registry semver" "got '$CP_NA_DEP'"
fi

# Section 3 — marketplace.json source format
echo ""
echo "Section 3: marketplace.json source format"
MP_SRC="$(node -p "JSON.parse(require('fs').readFileSync('$CP_DIR/.claude-plugin/marketplace.json','utf8')).plugins[0].source || ''" 2>/dev/null)"
case "$MP_SRC" in
  ./ | ./. | ./*) assert_pass "3.1 marketplace.json source starts with \"./\": $MP_SRC";;
  *)              assert_fail "3.1 marketplace.json source bad format (parser rejects)" "got '$MP_SRC'";;
esac

# Section 4 — na + shim.js loadable from the installed location
echo ""
echo "Section 4: na + dist/shim.js loadable from the installed plugin"
if node -e "require(require.resolve('@apnex/network-adapter',{paths:['$CP_DIR','$NPM_PREFIX']}))" 2>/dev/null; then
  assert_pass "4.1 @apnex/network-adapter require()s from the installed plugin"
else
  assert_fail "4.1 na not require-able from the installed plugin location"
fi
node --check "$CP_DIR/dist/shim.js" 2>/dev/null && assert_pass "4.2 dist/shim.js parses (node --check)" || assert_fail "4.2 dist/shim.js failed node --check"

# Section 5 — install.sh (npm-installed) exits 0 + registers marketplace/plugin (isolated)
echo ""
echo "Section 5: install.sh (npm-installed) exits 0 under isolated config"
INSTALL_SH="$CP_DIR/install.sh"
if [ ! -x "$INSTALL_SH" ]; then
  assert_fail "5.0 install.sh missing/not-executable" "$INSTALL_SH"
else
  INSTALL_OUT="$(HOME="$FAKE_HOME" CLAUDE_CONFIG_DIR="$CFG_DIR" CLAUDE_PLUGIN_CACHE_DIR="$CACHE_DIR" "$INSTALL_SH" 2>&1)"
  INSTALL_RC=$?
  if [ $INSTALL_RC -eq 0 ]; then
    assert_pass "5.1 install.sh exit 0"
    echo "$INSTALL_OUT" | grep -qiE 'Context: npm-installed' && assert_pass "5.2 install.sh auto-detected npm-installed context"
    echo "$INSTALL_OUT" | grep -qiE 'added marketplace: agentic-network|Registering local marketplace' && assert_pass "5.3 marketplace agentic-network registered"
    echo "$INSTALL_OUT" | grep -qiE 'installed plugin: agent-adapter|Installing agent-adapter' && assert_pass "5.4 plugin agent-adapter installed"
  else
    assert_fail "5.1 install.sh exited $INSTALL_RC"
    echo "----- install.sh output (tail) -----"; echo "$INSTALL_OUT" | tail -12; echo "------------------------------------"
  fi
fi

# Section 6 — .mcp.json delivered (else Claude Code never spawns the shim)
echo ""
echo "Section 6: .mcp.json delivered to npm-installed location"
INSTALLED_MCP="$CP_DIR/.mcp.json"
if [ -f "$INSTALLED_MCP" ] && node -e "process.exit(JSON.parse(require('fs').readFileSync('$INSTALLED_MCP','utf8')).mcpServers && JSON.parse(require('fs').readFileSync('$INSTALLED_MCP','utf8')).mcpServers.proxy ? 0 : 1)" 2>/dev/null; then
  assert_pass "6.1 .mcp.json declares mcpServers.proxy (Claude Code will spawn the shim)"
else
  assert_fail "6.1 .mcp.json missing/invalid at npm-installed path" "Calibration #38 — MCP server never registers"
fi

# Summary
echo ""
echo "=== npm-registry end-to-end install test results ==="
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Failed tests:"
  for t in "${FAILED_TESTS[@]}"; do echo "  - $t"; done
  exit 1
fi
echo ""
echo "✓ npm-registry e2e install GREEN — na-from-registry + registry-semver deps + install.sh(npm-installed) + .mcp.json."
exit 0
