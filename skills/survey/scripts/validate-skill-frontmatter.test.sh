#!/usr/bin/env bash
# Test cases for validate-skill-frontmatter.sh — grep-only SKILL.md frontmatter check.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="${SCRIPT_DIR}/validate-skill-frontmatter.sh"

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

echo "[validate-skill-frontmatter.test] Real SKILL.md (in-repo) passes"
set +e; bash "$SCRIPT" >/dev/null 2>&1; rc=$?; set -e
assert_exit 0 "$rc" "in-repo SKILL.md PASS"

echo "[validate-skill-frontmatter.test] Synthetic complete frontmatter passes"
cat > "$TMPDIR/good.md" <<'EOF'
---
name: survey
version: v1.0
methodology-source: docs/methodology/idea-survey.md v1.0
description: test description
disable-model-invocation: true
---

# Body
EOF
set +e; bash "$SCRIPT" --skill-path="$TMPDIR/good.md" >/dev/null 2>&1; rc=$?; set -e
assert_exit 0 "$rc" "synthetic complete frontmatter PASS"

echo "[validate-skill-frontmatter.test] Missing required key → exit 1"
cat > "$TMPDIR/missing-key.md" <<'EOF'
---
name: survey
version: v1.0
description: test description
disable-model-invocation: true
---
EOF
set +e; bash "$SCRIPT" --skill-path="$TMPDIR/missing-key.md" >/dev/null 2>&1; rc=$?; set -e
assert_exit 1 "$rc" "missing methodology-source FAIL"

echo "[validate-skill-frontmatter.test] disable-model-invocation: false → exit 0 (v1.1+ accepts both true|false per Director directive 2026-05-02)"
cat > "$TMPDIR/dmi-false.md" <<'EOF'
---
name: survey
version: v1.1
methodology-source: docs/methodology/idea-survey.md v1.0
description: test description
disable-model-invocation: false
---
EOF
set +e; bash "$SCRIPT" --skill-path="$TMPDIR/dmi-false.md" >/dev/null 2>&1; rc=$?; set -e
assert_exit 0 "$rc" "disable-model-invocation: false PASS (auto-invocation enabled)"

echo "[validate-skill-frontmatter.test] disable-model-invocation: bogus → exit 1"
cat > "$TMPDIR/dmi-bogus.md" <<'EOF'
---
name: survey
version: v1.1
methodology-source: docs/methodology/idea-survey.md v1.0
description: test description
disable-model-invocation: maybe
---
EOF
set +e; bash "$SCRIPT" --skill-path="$TMPDIR/dmi-bogus.md" >/dev/null 2>&1; rc=$?; set -e
assert_exit 1 "$rc" "disable-model-invocation: bogus FAIL (must be true|false)"

echo "[validate-skill-frontmatter.test] No frontmatter at all → exit 1"
cat > "$TMPDIR/no-fm.md" <<'EOF'
# Just a body, no frontmatter
EOF
set +e; bash "$SCRIPT" --skill-path="$TMPDIR/no-fm.md" >/dev/null 2>&1; rc=$?; set -e
assert_exit 1 "$rc" "no frontmatter FAIL"

echo "[validate-skill-frontmatter.test] Missing file → exit 1"
set +e; bash "$SCRIPT" --skill-path="$TMPDIR/does-not-exist.md" >/dev/null 2>&1; rc=$?; set -e
assert_exit 1 "$rc" "missing file FAIL"

echo
echo "[validate-skill-frontmatter.test] Result: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]] || exit 1
exit 0
