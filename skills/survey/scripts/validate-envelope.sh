#!/usr/bin/env bash
# skills/survey/scripts/validate-envelope.sh — finalize gate for the Survey Skill
#
# Validates a Survey envelope at docs/surveys/<mission>-survey.md against the §15
# Artifact schema codified in `docs/methodology/idea-survey.md` (NEW section per
# AG-9 carve-out from mission-69; spec-enrichment IS in-scope).
#
# Checks (each emits a diagnostic naming the first failure on exit 1):
#   1. Frontmatter required keys present (mission-name, source-idea, methodology-source,
#      director-picks with all 6 picks, mission-class, tele-alignment, skill-meta,
#      calibration-data, calibration-cross-refs)
#   2. Mission-class enum matches one of the 8 canonical values per
#      `docs/methodology/mission-lifecycle.md` §3 Mission-class taxonomy
#   3. Per-question interpretation sub-sections present + non-empty (M1 fold)
#   4. Per-round tele-mapping present (M4 fold; round-1.primary + round-1.secondary
#      + round-2.primary + round-2.secondary)
#   5. Calibration-data fields present (M2 fold; director-time-cost-minutes numeric,
#      comparison-baseline + notes non-empty)
#   6. Contradictory-constraints capture present when frontmatter declares them
#      (M3 fold; cross-frontmatter-prose consistency check)
#   7. Required prose sections present (§0 / §1 / §2 / §3 / §4 / §5 / §6 / §7 /
#      §calibration / §8); §contradictory only when frontmatter declares it
#
# AG-7 clean: pure bash + grep + awk + sed; no python, no yq, no npm.
#
# Tracking: idea-228 (this Skill mission); idea-survey.md §15 schema enrichment.

set -euo pipefail

ENVELOPE_PATH=

for arg in "$@"; do
  case "$arg" in
    --envelope-path=*) ENVELOPE_PATH="${arg#*=}" ;;
    *)
      echo "[validate-envelope] unknown argument: $arg" >&2
      echo "[validate-envelope] usage: validate-envelope.sh --envelope-path=docs/surveys/<mission>-survey.md" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$ENVELOPE_PATH" ]]; then
  echo "[validate-envelope] --envelope-path is required" >&2
  exit 1
fi

if [[ ! -f "$ENVELOPE_PATH" ]]; then
  echo "[validate-envelope] envelope file not found: $ENVELOPE_PATH" >&2
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
' "$ENVELOPE_PATH")

if [[ -z "$FRONTMATTER" ]]; then
  echo "[validate-envelope] FAIL: no YAML frontmatter found (expected '---' delimited block at top)" >&2
  exit 1
fi

fail() {
  echo "[validate-envelope] FAIL: $1" >&2
  exit 1
}

# (1) Frontmatter required keys
for key in mission-name source-idea methodology-source director-picks mission-class tele-alignment skill-meta calibration-data calibration-cross-refs; do
  if ! grep -qE "^${key}:" <<<"$FRONTMATTER"; then
    fail "frontmatter missing required key: $key (per idea-survey.md §15 schema)"
  fi
done

# Director picks (all 6 must be present + non-placeholder)
for q in Q1 Q2 Q3 Q4 Q5 Q6; do
  if ! grep -qE "^[[:space:]]+${q}:" <<<"$FRONTMATTER"; then
    fail "director-picks missing required pick: $q"
  fi
  pick_value=$(grep -E "^[[:space:]]+${q}:" <<<"$FRONTMATTER" | head -1 | sed 's/.*: *//;s/^"//;s/"$//')
  if [[ "$pick_value" =~ ^\<.*\>$ || -z "$pick_value" ]]; then
    fail "director-picks $q is unfilled placeholder or empty (got: '$pick_value')"
  fi
  if [[ ! "$pick_value" =~ ^[a-d]$ ]]; then
    fail "director-picks $q must be a single letter a-d (got: '$pick_value')"
  fi
done

# (2) Mission-class enum check
MISSION_CLASS=$(grep -E "^mission-class:" <<<"$FRONTMATTER" | head -1 | sed 's/^mission-class: *//;s/^"//;s/"$//')
if [[ "$MISSION_CLASS" =~ ^\<.*\>$ || -z "$MISSION_CLASS" ]]; then
  fail "mission-class is unfilled placeholder or empty"
fi
case "$MISSION_CLASS" in
  spike|substrate-introduction|pre-substrate-cleanup|structural-inflection|coordination-primitive-shipment|saga-substrate-completion|substrate-cleanup-wave|distribution-packaging) ;;
  *)
    fail "mission-class '$MISSION_CLASS' not in canonical 8-value enum per docs/methodology/mission-lifecycle.md §3 Mission-class taxonomy"
    ;;
esac

# (4) Per-round tele-mapping (round-1 + round-2 each need primary + secondary keys under tele-alignment)
for round in round-1 round-2; do
  if ! awk -v r="$round" '
    BEGIN { in_te = 0; in_round = 0; found_p = 0; found_s = 0 }
    /^tele-alignment:/ { in_te = 1; next }
    in_te && /^[a-zA-Z]/ { in_te = 0 }
    in_te && $0 ~ "^[[:space:]]+" r ":" { in_round = 1; next }
    in_round && $0 ~ "^[[:space:]]{2,}primary:" { found_p = 1 }
    in_round && $0 ~ "^[[:space:]]{2,}secondary:" { found_s = 1 }
    in_round && /^[[:space:]]{0,2}[a-z]/ && $0 !~ "^[[:space:]]{2,}primary:" && $0 !~ "^[[:space:]]{2,}secondary:" { in_round = 0 }
    END { exit !(found_p && found_s) }
  ' <<<"$FRONTMATTER"; then
    fail "tele-alignment.$round missing required primary + secondary keys (M4 per-round mapping discipline)"
  fi
done

# (5) Calibration-data fields
CALIB_BLOCK=$(awk '
  BEGIN { in_cd = 0 }
  /^calibration-data:/ { in_cd = 1; next }
  /^[a-zA-Z]/ && in_cd { in_cd = 0 }
  in_cd { print }
' <<<"$FRONTMATTER")

if ! grep -qE "^[[:space:]]+director-time-cost-minutes:" <<<"$CALIB_BLOCK"; then
  fail "calibration-data missing director-time-cost-minutes (M2 fold; required per idea-survey.md §15)"
fi
DTC_VALUE=$(grep -E "^[[:space:]]+director-time-cost-minutes:" <<<"$CALIB_BLOCK" | head -1 | sed 's/.*: *//;s/^"//;s/"$//')
if [[ "$DTC_VALUE" =~ ^\<.*\>$ || -z "$DTC_VALUE" ]]; then
  fail "calibration-data.director-time-cost-minutes is unfilled placeholder or empty"
fi
if ! [[ "$DTC_VALUE" =~ ^[0-9]+$ ]]; then
  fail "calibration-data.director-time-cost-minutes must be an integer (got: '$DTC_VALUE')"
fi
for f in comparison-baseline notes; do
  if ! grep -qE "^[[:space:]]+${f}:" <<<"$CALIB_BLOCK"; then
    fail "calibration-data missing $f (M2 fold; required per idea-survey.md §15)"
  fi
  val=$(grep -E "^[[:space:]]+${f}:" <<<"$CALIB_BLOCK" | head -1 | sed 's/.*: *//;s/^"//;s/"$//')
  if [[ -z "$val" || "$val" =~ ^\<.*\>$ ]]; then
    fail "calibration-data.$f is unfilled placeholder or empty"
  fi
done

# (6) Contradictory-constraints frontmatter ↔ prose consistency
if grep -qE "^contradictory-constraints:" <<<"$FRONTMATTER"; then
  CC_BLOCK=$(awk '
    BEGIN { in_cc = 0 }
    /^contradictory-constraints:/ { in_cc = 1; next }
    /^[a-zA-Z]/ && in_cc { in_cc = 0 }
    in_cc { print }
  ' <<<"$FRONTMATTER")
  # Strip pure-comment lines
  CC_NONCOMMENT=$(grep -vE '^[[:space:]]*#' <<<"$CC_BLOCK" | grep -vE '^[[:space:]]*$' || true)
  if [[ -n "$CC_NONCOMMENT" ]]; then
    if ! grep -qE "^## §contradictory" "$ENVELOPE_PATH"; then
      fail "contradictory-constraints declared in frontmatter but §contradictory prose section missing (M3 fold cross-consistency)"
    fi
  fi
fi

# (3) Per-question interpretation sub-sections (M1 fold)
for q in Q1 Q2 Q3 Q4 Q5 Q6; do
  if ! grep -qE "^### §[12]\.${q}" "$ENVELOPE_PATH"; then
    fail "missing §[1|2].${q} per-question interpretation sub-section (M1 fold; required per idea-survey.md §15)"
  fi
  # Ensure non-empty: verify there is at least one non-blank line between this header and the next section header
  if ! awk -v q="$q" '
    BEGIN { found_header = 0; non_empty = 0 }
    /^### §[12]\./ {
      if ($0 ~ "^### §[12]\\." q "[ \t]*—") { found_header = 1; next }
      else if (found_header) { exit !non_empty }
    }
    /^## §/ { if (found_header) exit !non_empty }
    found_header && NF > 0 && !/^<[^>]+>$/ { non_empty = 1 }
    END { exit !(found_header && non_empty) }
  ' "$ENVELOPE_PATH"; then
    fail "§[1|2].${q} per-question interpretation sub-section is empty or contains only placeholder text (M1 fold)"
  fi
done

# (7) Required prose sections
REQUIRED_SECTIONS=("## §0 Context" "## §1 Round 1 picks" "## §2 Round 2 picks" "## §3 Composite intent envelope" "## §4 Mission scope summary" "## §5 Anti-goals" "## §6 Architect-flags" "## §7 Sequencing" "## §calibration" "## §8 Cross-references")
for section in "${REQUIRED_SECTIONS[@]}"; do
  # Match heading line (any trailing characters allowed)
  if ! grep -qE "^${section}" "$ENVELOPE_PATH"; then
    fail "required prose section missing: $section (per idea-survey.md §15 schema)"
  fi
done

echo "[validate-envelope] PASS: $ENVELOPE_PATH conforms to idea-survey.md §15 Artifact schema"
exit 0
