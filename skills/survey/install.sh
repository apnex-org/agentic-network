#!/usr/bin/env bash
# /skills/survey/install.sh — Consumer-install bootstrap for the Survey Skill
#
# Symlinks the sovereign /skills/survey/ source into the consumer's
# Claude Code skills location (.claude/skills/survey). Idempotent.
#
# Pre-idea-230 (claude-plugin install bootstrap will automate this for
# all sovereign Skills via per-skill install.sh discovery + invocation).
#
# Usage: bash skills/survey/install.sh [--target=user|repo] [--dry-run] [--uninstall]
#
# AG-7 compliance: pure bash + POSIX utilities; no python/yq/jq.
# settings.local.json snippet is printed for manual paste (jq-free).

set -euo pipefail

# ── Args ────────────────────────────────────────────────────────────

TARGET="user"
DRY_RUN=0
UNINSTALL=0

for arg in "$@"; do
  case "$arg" in
    --target=user) TARGET="user" ;;
    --target=repo) TARGET="repo" ;;
    --dry-run)     DRY_RUN=1 ;;
    --uninstall)   UNINSTALL=1 ;;
    -h|--help)
      cat <<'EOF'
install.sh — Consumer-install for the Survey Skill

Usage: bash install.sh [--target=user|repo] [--dry-run] [--uninstall]

  --target=user   Symlink at ~/.claude/skills/survey (default; cross-repo portable)
  --target=repo   Symlink at <repo>/.claude/skills/survey (per-repo; gitignored per AG-1)
  --dry-run       Preview actions; no changes made
  --uninstall     Remove the symlink (does not touch sovereign source)

Run from any directory (resolves source via $BASH_SOURCE).
EOF
      exit 0
      ;;
    *)
      echo "[install] ERROR: unknown arg: $arg" >&2
      echo "[install]   try: bash install.sh --help" >&2
      exit 1
      ;;
  esac
done

# ── Resolve paths ───────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR"            # /skills/survey/
SKILL_NAME="$(basename "$SOURCE_DIR")"
REPO_ROOT="$(cd "$SOURCE_DIR/../.." && pwd)"

if [[ "$TARGET" == "user" ]]; then
  TARGET_PARENT="$HOME/.claude/skills"
elif [[ "$TARGET" == "repo" ]]; then
  TARGET_PARENT="$REPO_ROOT/.claude/skills"
fi

TARGET_PATH="$TARGET_PARENT/$SKILL_NAME"

# ── Header ──────────────────────────────────────────────────────────

echo "[install] Skill:  $SKILL_NAME"
echo "[install] Source: $SOURCE_DIR"
echo "[install] Target: $TARGET_PATH"
echo "[install] Mode:   $(if [[ $DRY_RUN -eq 1 ]]; then echo dry-run; else echo execute; fi)"
echo ""

# ── Uninstall path ──────────────────────────────────────────────────

if [[ $UNINSTALL -eq 1 ]]; then
  if [[ -L "$TARGET_PATH" ]]; then
    [[ $DRY_RUN -eq 1 ]] || rm "$TARGET_PATH"
    echo "[install] ✅ Removed symlink: $TARGET_PATH"
  else
    echo "[install] (no symlink to remove; target absent or not a symlink)"
  fi
  exit 0
fi

# ── Validate source ─────────────────────────────────────────────────

if [[ ! -f "$SOURCE_DIR/SKILL.md" ]]; then
  echo "[install] ERROR: sovereign source missing SKILL.md at $SOURCE_DIR" >&2
  exit 1
fi

# ── Symlink (idempotent) ────────────────────────────────────────────

if [[ -L "$TARGET_PATH" ]]; then
  EXISTING="$(readlink "$TARGET_PATH")"
  if [[ "$EXISTING" == "$SOURCE_DIR" ]]; then
    echo "[install] ✅ Symlink already in place + correct; skipping"
  else
    echo "[install] ❌ Existing symlink points elsewhere:" >&2
    echo "[install]    expected: $SOURCE_DIR" >&2
    echo "[install]    actual:   $EXISTING" >&2
    echo "[install]    resolve:  rm $TARGET_PATH" >&2
    exit 1
  fi
elif [[ -e "$TARGET_PATH" ]]; then
  echo "[install] ❌ Target exists but is not a symlink: $TARGET_PATH" >&2
  echo "[install]    resolve manually before re-running install" >&2
  exit 1
else
  if [[ $DRY_RUN -eq 0 ]]; then
    mkdir -p "$TARGET_PARENT"
    ln -s "$SOURCE_DIR" "$TARGET_PATH"
  fi
  echo "[install] ✅ Created symlink"
fi

# ── settings.local.json snippet ─────────────────────────────────────

echo ""
echo "[install] Bash permission allowlist — add to .claude/settings.local.json"
echo "[install] under permissions.allow (eliminates per-script prompts at gate invocations):"
echo ""
cat <<'EOF'
  "Bash(skills/survey/scripts/*:*)"
EOF
echo ""
echo "[install] Then restart Claude Code to discover the new Skill (handshake refresh)."

if [[ $DRY_RUN -eq 1 ]]; then
  echo ""
  echo "[install] (dry-run complete; no changes made)"
fi
