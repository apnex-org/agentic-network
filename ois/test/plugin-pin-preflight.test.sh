#!/usr/bin/env bash
# plugin-pin-preflight.test.sh — bug-368: prove the pinned-plugin preflight is real.
#
# Drives the REAL `claude_plugin_version_resolves` and `claude_npm_ensure` from ois/bin/ois
# (source-guarded; the CLI dispatch is skipped). NOTHING here greps the script for marker
# strings: a fix's own comment always names the construct it fixes, so string-presence checks
# score prose as code with comments kept, and score ZERO on a CORRECT artifact with comments
# stripped. There is no way to run such a check that yields a true answer. Behaviour only.
#
# ISOLATION — absolute. `npm` is a shell function for the whole run, so no real registry call
# and no real install can occur. `npm root -g` is redirected into a throwaway dir, so the live
# global @apnex/claude-plugin install is NEVER read, written, or removed — that install is the
# fleet's only copy of the pinned version and removing it IS the bug-368 outage.
#
# Run:  bash ois/test/plugin-pin-preflight.test.sh   -> PASS/FAIL, exit 0/1
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/../bin/ois"
set +e

TDIR="$(mktemp -d)"; trap 'rm -rf "$TDIR"' EXIT
fail=0
ok()   { echo "  ok: $1"; }
bad()  { echo "  FAIL: $1"; fail=1; }

# --- the stub registry -------------------------------------------------------------------
# NPM_MODE drives what `npm view` reports. `npm install -g` records the attempt rather than
# performing one. `npm root -g` points into the throwaway.
PUBLISHED='["0.1.0","0.1.11","0.1.12","0.1.13","0.1.14","0.1.19","0.1.20"]'
npm() {
  case "$1 ${2:-}" in
    "root -g") echo "$TDIR/nm" ;;
    "view "*)
      local spec="$2" ver="${2##*@}"
      [[ "$spec" == "@apnex/claude-plugin" ]] && { echo "$PUBLISHED"; return 0; }
      case "$NPM_MODE" in
        down) echo "npm ERR! network request to https://registry.npmjs.org failed" >&2; return 1 ;;
        *)    if grep -qF "\"$ver\"" <<<"$PUBLISHED"; then echo "$ver"; return 0
              else echo "npm ERR! code E404 - Not found: @apnex/claude-plugin@$ver is not in this registry" >&2; return 1; fi ;;
      esac ;;
    "install -g"*) echo "INSTALL_ATTEMPTED:$3" >> "$TDIR/installs"; return 0 ;;
    *) return 0 ;;
  esac
}
# FAITHFUL to production: the real fatal() is `echo …; exit 1` (ois:52). An earlier version of
# this stub `return 1`d, so execution fell through to the install line and F1/F2 reported
# "install attempted" — a HARNESS ARTEFACT, not a defect. Modelling the exit (and containing it
# in a subshell below) is the correct fix; relaxing the assertion would have hidden the property
# the case exists to prove.
fatal() { echo "FATAL:$*" >> "$TDIR/fatals"; exit 1; }

# stage a fake global install (or none) then run the REAL claude_npm_ensure
run_ensure() { # <installed_ver|""> <pin> <npm_mode> ; captures stdout+stderr
  local iv="$1" pin="$2" mode="$3"
  rm -rf "$TDIR/nm" "$TDIR/fatals" "$TDIR/installs"
  mkdir -p "$TDIR/nm/@apnex/claude-plugin"
  if [[ -n "$iv" ]]; then printf '{"version":"%s"}' "$iv" > "$TDIR/nm/@apnex/claude-plugin/package.json"; fi
  _CLAUDE_PLUGIN_MP=""            # defeat the once-per-invocation latch
  NPM_MODE="$mode"
  # SUBSHELL so the faithful `fatal … exit 1` terminates the call under test, exactly as it
  # would in production, without terminating this test run.
  ( CLAUDE_PLUGIN_VERSION="$pin" claude_npm_ensure ) > "$TDIR/out" 2>&1
  OUT="$(cat "$TDIR/out" 2>/dev/null)"
  FATALS="$(cat "$TDIR/fatals" 2>/dev/null)"
  INSTALLS="$(cat "$TDIR/installs" 2>/dev/null)"
}

echo "== (F0) INSTRUMENT CALIBRATION — prove the harness discriminates BEFORE trusting any result =="
# Standard set by the verifier: calibrate against known-opposite inputs first. Without this,
# every later 'rejected' could be a harness that rejects unconditionally.
NPM_MODE=normal; claude_plugin_version_resolves "0.1.20"; r_pub=$?
NPM_MODE=normal; claude_plugin_version_resolves "0.1.15"; r_abs=$?
NPM_MODE=down;   claude_plugin_version_resolves "0.1.20"; r_ind=$?
[[ $r_pub -eq 0 ]] && ok "published 0.1.20 -> resolves (0)"        || bad "published 0.1.20 -> got $r_pub, expected 0"
[[ $r_abs -eq 1 ]] && ok "unpublished 0.1.15 -> absent (1)"        || bad "unpublished 0.1.15 -> got $r_abs, expected 1"
[[ $r_ind -eq 2 ]] && ok "registry down -> INDETERMINATE (2), not conflated with absent" || bad "registry down -> got $r_ind, expected 2"

echo "== (F1) no local copy + unobtainable pin -> LOUD, EARLY, NAMES the version, does NOT install =="
run_ensure "" "0.1.15" normal
grep -q "0.1.15" <<<"$OUT"                       && ok "diagnostic names the version"        || bad "diagnostic does not name 0.1.15"
grep -qi "does NOT EXIST" <<<"$OUT"              && ok "states the condition plainly"        || bad "no plain statement of the condition"
grep -qi "idea-584\|PUBLISHED version" <<<"$OUT" && ok "names a remedy"                      || bad "no remedy named"
[[ -n "$FATALS" ]]                               && ok "failed (fatal invoked)"              || bad "did not fail"
[[ -z "$INSTALLS" ]]                             && ok "EARLY: no install attempted"         || bad "install was attempted despite unobtainable pin"

echo "== (F2) the 0.1.16 RIDER that nearly shipped: installed 0.1.15, pin 0.1.16 -> REJECTED =="
run_ensure "0.1.15" "0.1.16" normal
[[ -n "$FATALS" ]]                  && ok "rejected before install"                 || bad "0.1.16 NOT rejected — the rider would have shipped"
grep -q "0.1.16" <<<"$OUT"          && ok "names 0.1.16 specifically"               || bad "does not name 0.1.16"
[[ -z "$INSTALLS" ]]                && ok "no install attempted"                    || bad "attempted to install a 404 version"

echo "== (F3) POSITIVE CONTROL — published pin + no local copy -> installs normally =="
# Without this, F1/F2 would pass on a script that fails unconditionally.
run_ensure "" "0.1.20" normal
[[ -z "$FATALS" ]]                        && ok "no failure on the working path"     || bad "guard broke the WORKING path: $FATALS"
grep -q "INSTALL_ATTEMPTED" <<<"$INSTALLS" && ok "install proceeded"                 || bad "install did not proceed for a published pin"

echo "== (F3b) POSITIVE CONTROL — installed==pin and pin UNOBTAINABLE -> WARNS, never fatals =="
# This is today's live fleet state (installed 0.1.15 == pin 0.1.15, both E404). A guard that
# fataled here would BE the outage it exists to prevent.
run_ensure "0.1.15" "0.1.15" normal
[[ -z "$FATALS" ]]                   && ok "working path preserved (no fatal)"       || bad "FATALED on the live fleet's current state: $FATALS"
grep -q "bug-368" <<<"$OUT"          && ok "warns and cites bug-368"                 || bad "no warning on an irreplaceable local copy"
grep -qi "IRREPLACEABLE" <<<"$OUT"   && ok "names the actual risk"                   || bad "warning does not state the risk"

echo "== (F3c) registry DOWN + install needed -> warns INDETERMINATE, still attempts (no transient brick) =="
run_ensure "0.1.14" "0.1.20" down
[[ -z "$FATALS" ]]                        && ok "transient registry failure did not brick seeding" || bad "bricked on a transient: $FATALS"
grep -q "INSTALL_ATTEMPTED" <<<"$INSTALLS" && ok "fell through to the real install"  || bad "did not attempt install under indeterminate probe"

echo "== (F4) the LIVE pin is UNCHANGED by this work (read-only) =="
LIVE="$HOME/.config/apnex-agents/bin/ois"
if [[ -f "$LIVE" ]]; then
  lv="$(grep -m1 '^CLAUDE_PLUGIN_VERSION=' "$LIVE")"
  [[ "$lv" == 'CLAUDE_PLUGIN_VERSION="0.1.15"' ]] && ok "live pin still 0.1.15 ($lv)" || bad "LIVE PIN MOVED: $lv"
else
  echo "  SKIP: live ois not present"
fi

echo
if [[ $fail -eq 0 ]]; then
  echo "PASS: pin preflight is behaviour-verified — unobtainable pins fail loud and early naming the version and a remedy; the working path and the installed==pin path are preserved; a transient registry failure does not brick seeding"
  exit 0
else
  echo "FAIL: pin preflight"
  exit 1
fi
