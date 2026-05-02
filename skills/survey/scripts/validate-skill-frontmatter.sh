#!/usr/bin/env bash
# skills/survey/scripts/validate-skill-frontmatter.sh — grep-only SKILL.md frontmatter check
#
# Smoke-checks SKILL.md frontmatter for required Claude Code Skill keys. AG-7 clean:
# pure bash + grep; no yq, no python, no npm.
#
# Tracking: idea-228 (this Skill mission); AG-7 reviewer-test (zero non-bash deps).

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SKILL_PATH="${SCRIPT_DIR}/../SKILL.md"

# Allow override via --skill-path (used by tests)
for arg in "$@"; do
  case "$arg" in
    --skill-path=*) SKILL_PATH="${arg#*=}" ;;
    *)
      echo "[validate-skill-frontmatter] unknown argument: $arg" >&2
      echo "[validate-skill-frontmatter] usage: validate-skill-frontmatter.sh [--skill-path=<path>]" >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "$SKILL_PATH" ]]; then
  echo "[validate-skill-frontmatter] SKILL.md not found at $SKILL_PATH" >&2
  exit 1
fi

# Extract frontmatter block (between first two '---' lines)
FRONTMATTER=$(awk '
  BEGIN { in_fm = 0; count = 0 }
  /^---$/ {
    count++
    if (count == 1) { in_fm = 1; next }
    if (count == 2) { in_fm = 0; exit }
  }
  in_fm { print }
' "$SKILL_PATH")

if [[ -z "$FRONTMATTER" ]]; then
  echo "[validate-skill-frontmatter] FAIL: no YAML frontmatter found (expected '---' delimited block at top of $SKILL_PATH)" >&2
  exit 1
fi

REQUIRED_KEYS=(name version methodology-source description disable-model-invocation)
for key in "${REQUIRED_KEYS[@]}"; do
  if ! grep -qE "^${key}:" <<<"$FRONTMATTER"; then
    echo "[validate-skill-frontmatter] FAIL: SKILL.md frontmatter missing required key: $key" >&2
    exit 1
  fi
done

# disable-model-invocation MUST be true (this Skill is user-triggered per Q3=a + P2 fold)
DMI_VALUE=$(grep -E "^disable-model-invocation:" <<<"$FRONTMATTER" | head -1 | sed 's/^disable-model-invocation: *//;s/ *#.*$//')
if [[ "$DMI_VALUE" != "true" ]]; then
  echo "[validate-skill-frontmatter] FAIL: disable-model-invocation must be true (got: '$DMI_VALUE')" >&2
  exit 1
fi

echo "[validate-skill-frontmatter] PASS: $SKILL_PATH frontmatter has all required keys"
exit 0
