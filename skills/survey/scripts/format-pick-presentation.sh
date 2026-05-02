#!/usr/bin/env bash
# skills/survey/scripts/format-pick-presentation.sh — render Round-N questions
#
# Reads a markdown questions-file containing Q-N definitions and emits the standard
# Survey-Skill question shape (Q-N: <axis>: <context>; (a)/(b)/(c)/(d) labels).
# Used at the finalize gate to canonicalize question presentation in the final
# envelope artifact before validate-envelope.sh is called.
#
# Input questions-file format (per round-1-template.md / round-2-template.md):
#   **Q-N — <axis>:** <context>
#   - (a) <option>
#   - (b) <option>
#   - (c) <option>
#   - (d) <option>
#
# Output: same shape, normalized whitespace + canonical label form, emitted to stdout.
#
# Tracking: idea-228 (this Skill mission).

set -euo pipefail

ROUND=
QUESTIONS_FILE=

for arg in "$@"; do
  case "$arg" in
    --round=*)          ROUND="${arg#*=}" ;;
    --questions-file=*) QUESTIONS_FILE="${arg#*=}" ;;
    *)
      echo "[format-pick-presentation] unknown argument: $arg" >&2
      echo "[format-pick-presentation] usage: format-pick-presentation.sh --round=1|2 --questions-file=<path>" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$ROUND" || -z "$QUESTIONS_FILE" ]]; then
  echo "[format-pick-presentation] --round and --questions-file are required" >&2
  exit 1
fi

case "$ROUND" in
  1|2) ;;
  *)
    echo "[format-pick-presentation] --round must be 1 or 2 (got: $ROUND)" >&2
    exit 1
    ;;
esac

if [[ ! -f "$QUESTIONS_FILE" ]]; then
  echo "[format-pick-presentation] questions-file not found: $QUESTIONS_FILE" >&2
  exit 1
fi

# Determine the expected Q numbers for this round
case "$ROUND" in
  1) Q_RANGE="Q1 Q2 Q3" ;;
  2) Q_RANGE="Q4 Q5 Q6" ;;
esac

echo "[format-pick-presentation] rendering Round-$ROUND questions ($Q_RANGE) from $QUESTIONS_FILE"

# Walk the file looking for Q-N blocks and emit normalized form
EXIT_CODE=0
for q in $Q_RANGE; do
  # Match the question header line (e.g., "**Q1 — <axis>:** <context>")
  if ! grep -qE "^\*\*${q}( |\*\*)" "$QUESTIONS_FILE"; then
    echo "[format-pick-presentation] WARNING: $q header not found in $QUESTIONS_FILE" >&2
    EXIT_CODE=1
    continue
  fi
  awk -v q="$q" '
    BEGIN { in_block = 0; lines = 0 }
    /^\*\*Q[1-6]/ {
      if ($0 ~ "^\\*\\*" q "( |\\*\\*)") {
        in_block = 1
        print ""
        print $0
        lines = 1
        next
      } else if (in_block) {
        in_block = 0
      }
    }
    in_block {
      print
      lines++
      if (lines > 10 && /^$/) { in_block = 0 }
    }
  ' "$QUESTIONS_FILE"
done

if [[ "$EXIT_CODE" -ne 0 ]]; then
  echo "[format-pick-presentation] one or more questions missing; exit 1" >&2
  exit 1
fi

echo "[format-pick-presentation] Round-$ROUND rendering complete"
exit 0
