#!/usr/bin/env bash
# /skills/survey/install.sh — Consumer-install bootstrap for the Survey Skill
#
# Symlinks the sovereign /skills/survey/ source into the consumer's
# Claude Code skills location (.claude/skills/survey). Idempotent.
#
# mission-71 (idea-230) ships claude-plugin install.sh's bootstrap_skills()
# which auto-invokes this script across all sovereign Skills + consolidates
# each Skill's .skill-permissions.json fragment automatically. Standalone
# invocation supported for ad-hoc refresh.
#
# Usage: bash skills/survey/install.sh [--target=user|repo] [--dry-run] [--uninstall] [--silent]
#
# AG-7 compliance: pure bash + POSIX utilities; no python/yq/jq.
# Permissions: declared in skills/survey/.skill-permissions.json; consolidated
# by claude-plugin bootstrap. Standalone invocation does not modify Claude
# config — user pastes manually if needed.

set -euo pipefail

# ── Args ────────────────────────────────────────────────────────────

TARGET="user"
DRY_RUN=0
UNINSTALL=0
SILENT=0

for arg in "$@"; do
  case "$arg" in
    --target=user) TARGET="user" ;;
    --target=repo) TARGET="repo" ;;
    --dry-run)     DRY_RUN=1 ;;
    --uninstall)   UNINSTALL=1 ;;
    --silent)      SILENT=1 ;;
    -h|--help)
      cat <<'EOF'
install.sh — Consumer-install for the Survey Skill

Usage: bash install.sh [--target=user|repo] [--dry-run] [--uninstall] [--silent]

  --target=user   Symlink at ~/.claude/skills/survey (default; cross-repo portable)
  --target=repo   Symlink at <repo>/.claude/skills/survey (per-repo; gitignored per AG-1)
  --dry-run       Preview actions; no changes made
  --uninstall     Remove the symlink (does not touch sovereign source)
  --silent        Suppress decorative output (for bootstrap-orchestration; mission-71)

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

# Silent-aware echo helper
say() {
  [[ $SILENT -eq 1 ]] && return 0
  echo "$@"
}

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

say "[install] Skill:  $SKILL_NAME"
say "[install] Source: $SOURCE_DIR"
say "[install] Target: $TARGET_PATH"
say "[install] Mode:   $(if [[ $DRY_RUN -eq 1 ]]; then echo dry-run; else echo execute; fi)"
say ""

# ── Uninstall path ──────────────────────────────────────────────────

if [[ $UNINSTALL -eq 1 ]]; then
  if [[ -L "$TARGET_PATH" ]]; then
    [[ $DRY_RUN -eq 1 ]] || rm "$TARGET_PATH"
    say "[install] ✅ Removed symlink: $TARGET_PATH"
  else
    say "[install] (no symlink to remove; target absent or not a symlink)"
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
    say "[install] ✅ Symlink already in place + correct; skipping"
  else
    # M3 fold: refuse-and-exit on stale/different-source symlink (preserved
    # from pre-mission-71 behavior; safer than auto-remove; respects user's
    # possibly-intentional manual symlinks)
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
  say "[install] ✅ Created symlink"
fi

# ── Permissions handled by claude-plugin bootstrap (mission-71) ─────
# Pre-mission-71 (v1.1) printed a Bash-allowlist snippet for manual paste
# here. v1.2 removes that — claude-plugin install.sh's bootstrap_skills()
# consolidates each Skill's .skill-permissions.json fragment into the
# user-global Claude config automatically. Standalone invocation (no
# claude-plugin) leaves permissions unchanged; user can either run
# `bash adapters/claude-plugin/install.sh` for the full bootstrap, or
# read skills/survey/.skill-permissions.json + paste manually.

if [[ $DRY_RUN -eq 1 ]]; then
  say ""
  say "[install] (dry-run complete; no changes made)"
else
  say ""
  say "[install] survey-skill installed at $TARGET_PATH"
  say "[install] Permissions: handled by claude-plugin bootstrap (or read"
  say "[install]   skills/survey/.skill-permissions.json + paste manually)"
  say "[install] Then restart Claude Code to discover the new Skill (handshake refresh)."
fi
