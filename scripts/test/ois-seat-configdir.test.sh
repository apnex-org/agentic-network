#!/usr/bin/env bash
# ois-seat-configdir.test.sh — piuplift0 p1 regression (steve, PR #606).
#
# The sovereign per-seat config-dir resolution must NEVER emit the literal string "null".
# `jq -r '.configDirTemplate'` on a missing/null key yields the STRING "null"; without the
# `// empty` guard, pi_seed would `export PI_CODING_AGENT_DIR=null` and seed "null/skills" on
# a pi cell that declares no configDirTemplate (the current estate state — pi.json carries no
# template yet). This proves the shared cell_configdir helper returns empty (never "null")
# and that pi_seed fails CLOSED — aborting BEFORE pi_na_ensure/npm — rather than seeding a
# bogus/shared path. A shared default (e.g. ~/.pi/agent) is deliberately NOT used: it would
# collide every pi seat on one skills dir + one managed-ledger, breaking per-seat sovereignty.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OIS="$HERE/../../ois/bin/ois"
[[ -f "$OIS" ]] || { echo "FAIL: ois not found at $OIS"; exit 1; }

# Source ois for its functions — BASH_SOURCE != $0 skips the dispatch (source-guard, ois:~923).
# ois runs `set -euo pipefail` + a jq presence check at source time; relax the flags after so a
# failed assertion is REPORTED, not an abort of the whole harness.
# shellcheck disable=SC1090
source "$OIS"
set +e +u +o pipefail

fails=0
eq() { # <desc> <expected> <actual>
  if [[ "$2" == "$3" ]]; then
    echo "ok   - $1"
  else
    echo "FAIL - $1"; echo "        expected: [$2]"; echo "        actual:   [$3]"; fails=$((fails + 1))
  fi
}

# 1. declared template → {agent}- and ~-expanded path (never null).
eq "cell_configdir expands {agent} + ~ for a declared template" \
  "$HOME/.config/apnex-agents/greg.pi" \
  "$(cell_configdir '{"cellAgent":"greg","configDirTemplate":"~/.config/apnex-agents/{agent}.pi"}')"

# 2. no template → EMPTY (the load-bearing guard), and specifically NOT the literal "null".
got="$(cell_configdir '{"cellAgent":"greg"}')"
eq "cell_configdir returns empty when no template declared" "" "$got"
eq "  ...and is not the literal string null" "false" "$([[ "$got" == "null" ]] && echo true || echo false)"

# 3. explicit JSON null → also empty (// empty catches JSON null, not just a missing key).
eq "cell_configdir returns empty for an explicit JSON-null template" "" \
  "$(cell_configdir '{"cellAgent":"greg","configDirTemplate":null}')"

# 4. pi_seed(no template) fails CLOSED — non-zero, BEFORE pi_na_ensure/npm, no null path.
#    Subshell (fatal exits); stub pi_na_ensure so a regressed guard can't silently npm-install.
seed_out="$(
  pi_na_ensure() { echo "REACHED_PI_NA_ENSURE"; }
  ( pi_seed '{"cellAgent":"greg"}' ) 2>&1
)"
seed_rc=$?
eq "pi_seed(no template) exits non-zero (fail-closed)" "nonzero" \
  "$([[ $seed_rc -ne 0 ]] && echo nonzero || echo zero)"
eq "pi_seed(no template) aborts BEFORE pi_na_ensure/npm" "false" \
  "$(grep -q REACHED_PI_NA_ENSURE <<<"$seed_out" && echo true || echo false)"
eq "pi_seed(no template) emits no null/shared skills path" "false" \
  "$(grep -qE 'null/skills|=null' <<<"$seed_out" && echo true || echo false)"

echo
if [[ $fails -eq 0 ]]; then
  echo "PASS: ois seat-configdir regression green (no literal null; pi_seed fail-closed)"
  exit 0
else
  echo "FAIL: $fails assertion(s) failed"
  exit 1
fi
