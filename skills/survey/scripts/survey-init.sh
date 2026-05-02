#!/usr/bin/env bash
# skills/survey/scripts/survey-init.sh — Init gate for the Survey Skill (mission-69 W1)
#
# Scaffolds a Phase 3 Survey envelope at docs/surveys/<mission>-survey.md from the
# envelope template, seeding the idea-context section if Claude pre-fetched the idea
# text via Hub `get_idea` and wrote it to a temp file.
#
# Tier 1 dispatch: Claude calls Hub `get_idea` first, writes the result to a temp
# file, then calls this script with --idea-text-file pointing at the temp file.
# If the file is missing or empty, the script proceeds with a manual-fill placeholder
# (Tier-3 fallback per Skill prose; not the script's concern).
#
# Tracking: idea-228 (this Skill mission); idea-229 (umbrella); bug-45 (Hub get_idea).

set -euo pipefail

MISSION_NAME=
IDEA_ID=
IDEA_TEXT_FILE=

for arg in "$@"; do
  case "$arg" in
    --mission-name=*) MISSION_NAME="${arg#*=}" ;;
    --idea-id=*)      IDEA_ID="${arg#*=}" ;;
    --idea-text-file=*) IDEA_TEXT_FILE="${arg#*=}" ;;
    *)
      echo "[survey-init] unknown argument: $arg" >&2
      echo "[survey-init] usage: survey-init.sh --mission-name=M-<name> --idea-id=idea-<N> [--idea-text-file=<path>]" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$MISSION_NAME" || -z "$IDEA_ID" ]]; then
  echo "[survey-init] required arguments missing" >&2
  echo "[survey-init] usage: survey-init.sh --mission-name=M-<name> --idea-id=idea-<N> [--idea-text-file=<path>]" >&2
  exit 1
fi

if [[ ! "$MISSION_NAME" =~ ^M- ]]; then
  echo "[survey-init] mission-name must start with 'M-' (got: $MISSION_NAME)" >&2
  exit 1
fi

if [[ ! "$IDEA_ID" =~ ^idea-[0-9]+$ ]]; then
  echo "[survey-init] idea-id must match 'idea-<N>' (got: $IDEA_ID)" >&2
  exit 1
fi

# Mission name → file slug: M-Survey-Process-as-Skill → m-survey-process-as-skill
# Per convention in docs/surveys/ (all existing files use 'm-' lowercase prefix).
SLUG=$(echo "$MISSION_NAME" | tr '[:upper:]' '[:lower:]')
ENVELOPE_PATH="docs/surveys/${SLUG}-survey.md"

if [[ -e "$ENVELOPE_PATH" ]]; then
  echo "[survey-init] envelope already exists at $ENVELOPE_PATH (refusing to overwrite)" >&2
  echo "[survey-init] delete or rename it first if you want to re-scaffold" >&2
  exit 1
fi

mkdir -p docs/surveys

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TEMPLATE_PATH="${SCRIPT_DIR}/../envelope-template.md"

if [[ ! -f "$TEMPLATE_PATH" ]]; then
  echo "[survey-init] envelope template not found at $TEMPLATE_PATH" >&2
  exit 1
fi

# Substitute placeholders in the template + write to envelope path.
sed \
  -e "s|M-<name>|$MISSION_NAME|g" \
  -e "s|idea-<N>|$IDEA_ID|g" \
  "$TEMPLATE_PATH" > "$ENVELOPE_PATH"

# Seed §0 Context with idea text if Claude provided it (Tier 1 happy path).
if [[ -n "$IDEA_TEXT_FILE" && -s "$IDEA_TEXT_FILE" ]]; then
  IDEA_TEXT=$(cat "$IDEA_TEXT_FILE")
  # Append idea-text snippet to §0 Context. Use printf heredoc per AG-7 (no python/yq).
  TMP_OUT=$(mktemp)
  trap 'rm -f "$TMP_OUT"' EXIT INT TERM HUP
  awk -v idea_text="$IDEA_TEXT" '
    /^## §0 Context$/ {
      print
      getline blank; print blank
      print "**Source idea text** (pulled via Hub `get_idea` at Survey init gate):"
      print ""
      print "> " idea_text
      print ""
      next
    }
    { print }
  ' "$ENVELOPE_PATH" > "$TMP_OUT"
  mv "$TMP_OUT" "$ENVELOPE_PATH"
  trap - EXIT INT TERM HUP
  echo "[survey-init] scaffolded $ENVELOPE_PATH (idea text seeded from $IDEA_TEXT_FILE)"
else
  echo "[survey-init] scaffolded $ENVELOPE_PATH (no idea text provided; §0 Context placeholder retained for manual fill)"
fi

echo "[survey-init] Next: Skill flow Step 2 — Round-1 question design + dispatch (load round-1-template.md)"
exit 0
