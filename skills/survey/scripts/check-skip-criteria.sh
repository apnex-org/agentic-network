#!/usr/bin/env bash
# skills/survey/scripts/check-skip-criteria.sh — pre-Survey Idea Triage Protocol routing
#
# Walks the 5 skip-criteria from `docs/methodology/strategic-review.md` §Idea Triage
# Protocol §(a) and reports the suggested route ((a) skip-direct / (b) triage-thread /
# (c) Strategic Review queue) plus per-criterion result.
#
# Criteria 1 + 3 require source/context evidence the script can't infer from text; the
# caller passes them via --source + --contest flags (Claude pre-determines from Hub
# context: idea.createdBy.role + open threads on the idea).
# Criteria 2 + 4 + 5 can be partially detected from idea text via grep heuristics; the
# caller can override with --scope-concrete / --tele-aligned / --single-mission-shape
# flags when the heuristic is too coarse.
#
# Tracking: idea-228 (this Skill mission); strategic-review.md §Idea Triage Protocol.

set -euo pipefail

IDEA_ID=
IDEA_TEXT_FILE=
SOURCE=
CONTEST=
SCOPE_OVERRIDE=
TELE_OVERRIDE=
SINGLE_OVERRIDE=

for arg in "$@"; do
  case "$arg" in
    --idea-id=*)             IDEA_ID="${arg#*=}" ;;
    --idea-text-file=*)      IDEA_TEXT_FILE="${arg#*=}" ;;
    --source=*)              SOURCE="${arg#*=}" ;;
    --contest=*)             CONTEST="${arg#*=}" ;;
    --scope-concrete=*)      SCOPE_OVERRIDE="${arg#*=}" ;;
    --tele-aligned=*)        TELE_OVERRIDE="${arg#*=}" ;;
    --single-mission-shape=*) SINGLE_OVERRIDE="${arg#*=}" ;;
    *)
      echo "[check-skip-criteria] unknown argument: $arg" >&2
      echo "[check-skip-criteria] usage: check-skip-criteria.sh --idea-id=idea-<N> [--idea-text-file=<path>] [--source=director|architect|engineer] [--contest=none|engineer|peer] [--scope-concrete=true|false] [--tele-aligned=true|false] [--single-mission-shape=true|false]" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$IDEA_ID" ]]; then
  echo "[check-skip-criteria] --idea-id is required" >&2
  exit 1
fi

# Criterion-1: source ratification (Director-originated OR Director-ratified)
case "${SOURCE:-unknown}" in
  director)             c1="met";    c1_note="Director-originated" ;;
  architect|engineer)   c1="needs-review"; c1_note="${SOURCE}-originated; check architect-relayed Director directive per mission-lifecycle.md §1.5.1" ;;
  unknown)              c1="unknown"; c1_note="--source not provided; cannot verify (default: needs-review)" ;;
  *)                    c1="unknown"; c1_note="unrecognized --source value: $SOURCE" ;;
esac

# Criterion-3: no contest (no engineer/peer pushback; no under-specification at boundaries)
case "${CONTEST:-unknown}" in
  none)                 c3="met";    c3_note="no contest reported" ;;
  engineer|peer)        c3="failed"; c3_note="${CONTEST}-side contest detected; bilateral negotiation needed" ;;
  unknown)              c3="unknown"; c3_note="--contest not provided; cannot verify (default: needs-review)" ;;
  *)                    c3="unknown"; c3_note="unrecognized --contest value: $CONTEST" ;;
esac

# Criterion-2: scope concrete (in-scope / out-of-scope / anti-goals declared in text)
if [[ -n "$SCOPE_OVERRIDE" ]]; then
  case "$SCOPE_OVERRIDE" in
    true)  c2="met";    c2_note="explicit override" ;;
    false) c2="failed"; c2_note="explicit override" ;;
    *)     c2="unknown"; c2_note="unrecognized --scope-concrete value" ;;
  esac
elif [[ -n "$IDEA_TEXT_FILE" && -s "$IDEA_TEXT_FILE" ]]; then
  if grep -qiE 'in[- ]?scope|out[- ]?of[- ]?scope|anti[- ]?goals?' "$IDEA_TEXT_FILE"; then
    c2="met"; c2_note="scope keywords detected in idea text"
  else
    c2="needs-review"; c2_note="no in-scope/out-of-scope/anti-goals keywords detected; may be vague concept-stub"
  fi
else
  c2="unknown"; c2_note="no idea text + no override provided"
fi

# Criterion-4: tele-aligned (tele alignment self-evident OR explicitly stated)
if [[ -n "$TELE_OVERRIDE" ]]; then
  case "$TELE_OVERRIDE" in
    true)  c4="met";    c4_note="explicit override" ;;
    false) c4="failed"; c4_note="explicit override" ;;
    *)     c4="unknown"; c4_note="unrecognized --tele-aligned value" ;;
  esac
elif [[ -n "$IDEA_TEXT_FILE" && -s "$IDEA_TEXT_FILE" ]]; then
  if grep -qE 'tele-[0-9]+' "$IDEA_TEXT_FILE"; then
    c4="met"; c4_note="tele-N citation detected in idea text"
  else
    c4="needs-review"; c4_note="no tele-N citation detected; alignment may be implicit"
  fi
else
  c4="unknown"; c4_note="no idea text + no override provided"
fi

# Criterion-5: single-mission-shape (not part of idea-cluster requiring consolidation)
if [[ -n "$SINGLE_OVERRIDE" ]]; then
  case "$SINGLE_OVERRIDE" in
    true)  c5="met";    c5_note="explicit override" ;;
    false) c5="failed"; c5_note="explicit override" ;;
    *)     c5="unknown"; c5_note="unrecognized --single-mission-shape value" ;;
  esac
else
  # Default to needs-review; cluster-detection requires Hub context (sister-idea inventory).
  c5="needs-review"
  c5_note="single-mission-shape requires Hub-side cluster check; default needs-review"
fi

# Report per-criterion result
echo "[check-skip-criteria] Idea Triage Protocol results for $IDEA_ID"
echo "[check-skip-criteria] (per docs/methodology/strategic-review.md §Idea Triage Protocol §(a))"
printf "  %-2s  %-13s  %s\n" "C1" "$c1" "Source ratification — $c1_note"
printf "  %-2s  %-13s  %s\n" "C2" "$c2" "Scope concrete — $c2_note"
printf "  %-2s  %-13s  %s\n" "C3" "$c3" "No contest — $c3_note"
printf "  %-2s  %-13s  %s\n" "C4" "$c4" "Tele-aligned — $c4_note"
printf "  %-2s  %-13s  %s\n" "C5" "$c5" "Single-mission-shape — $c5_note"

# Determine route per Idea Triage Protocol mechanics:
# - All 5 met → route (a) skip-direct → exit 0
# - C1 failed/unknown OR C3 failed/unknown → route (b) triage-thread → exit 1
# - C5 failed → route (c) Strategic Review queue → exit 2
# - Otherwise (C2/C4 needs-review/unknown) → default to (b) for safety

ROUTE=
ROUTE_DESC=

if [[ "$c1" == "met" && "$c2" == "met" && "$c3" == "met" && "$c4" == "met" && "$c5" == "met" ]]; then
  ROUTE=0
  ROUTE_DESC="(a) skip-direct — all 5 criteria met; architect calls update_idea(status='triaged')"
elif [[ "$c5" == "failed" ]]; then
  ROUTE=2
  ROUTE_DESC="(c) Strategic Review queue — single-mission-shape criterion failed; idea surfaces in next Strategic Review Phase 1 Cartography clustering"
elif [[ "$c1" == "failed" || "$c1" == "needs-review" || "$c1" == "unknown" || "$c3" == "failed" || "$c3" == "needs-review" || "$c3" == "unknown" ]]; then
  ROUTE=1
  ROUTE_DESC="(b) triage-thread — bilateral negotiation needed (source ratification or contest unresolved)"
else
  ROUTE=1
  ROUTE_DESC="(b) triage-thread — at least one criterion not met cleanly; bilateral conversation safer than autonomous skip"
fi

echo "[check-skip-criteria] Suggested route: $ROUTE_DESC"
exit "$ROUTE"
