#!/usr/bin/env bash
#
# scripts/build/test/test-assert-pack-contents.sh — assert-pack-contents.js gate test
#
# idea-509 / survey G6 (bug-254/255). Verifies the pack-contents completeness gate against
# tiny npm-pack fixtures (no network, no publish, no lifecycle scripts):
#
#   1. PASS — declared bin PRESENT in the tarball → exit 0.
#   2. FAIL — declared bin ABSENT from the tarball (dist file not built) → exit 1.
#   3. PASS — no bin declared → exit 0 (nothing to assert).
#
# Usage: ./scripts/build/test/test-assert-pack-contents.sh
# Exit:  0 on success; non-zero on any expectation miss.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/build/assert-pack-contents.js"

PASS=0
FAIL=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Fixture package: files:[dist] + a non-bin dist file (so the pack is never empty).
#   $2 = declare a bin (yes/no);  $3 = actually create the bin file (yes/no).
mk_pkg() {
  local dir="$1" withbin="$2" createfile="$3"
  mkdir -p "$dir/dist/bin"
  if [ "$withbin" = "yes" ]; then
    printf '{\n  "name": "fixture-%s",\n  "version": "0.0.1",\n  "files": ["dist"],\n  "bin": {"fixture-cli": "dist/bin/cli.js"}\n}\n' "$(basename "$dir")" > "$dir/package.json"
  else
    printf '{\n  "name": "fixture-%s",\n  "version": "0.0.1",\n  "files": ["dist"]\n}\n' "$(basename "$dir")" > "$dir/package.json"
  fi
  [ "$createfile" = "yes" ] && printf '#!/usr/bin/env node\n' > "$dir/dist/bin/cli.js"
  printf 'export const x = 1;\n' > "$dir/dist/index.js"
}

run() { local rc=0; node "$SCRIPT" "$1" >/dev/null 2>&1 || rc=$?; echo "$rc"; }
expect() {
  local label="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then echo "  ✓ $label (exit $got)"; PASS=$((PASS + 1))
  else echo "  ✗ $label: expected exit $want, got $got"; FAIL=$((FAIL + 1)); fi
}

# ── Case 1: PASS — declared bin present in the tarball ─────────────────────
mk_pkg "$TMP/present" yes yes
expect "PASS: declared bin present in tarball" "$(run "$TMP/present")" "0"

# ── Case 2: FAIL — declared bin absent from the tarball (dist file missing) ─
mk_pkg "$TMP/missing" yes no
expect "FAIL: declared bin absent from tarball (bug-254 class)" "$(run "$TMP/missing")" "1"

# ── Case 3: PASS — no bin declared → nothing to assert ────────────────────
mk_pkg "$TMP/nobin" no yes
expect "PASS: no declared bin" "$(run "$TMP/nobin")" "0"

echo ""
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
