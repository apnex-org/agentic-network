#!/usr/bin/env bash
# pi-auth-bridge.test.sh — bug-268: prove pi per-seat auth seeding is a symlink bridge,
# not a secret copy, and that it fails closed instead of overwriting credential policy.
#
# The test sets HOME to a temp dir BEFORE sourcing ois, so pi_auth_bridge's default
# ~/.pi/agent/auth.json source and all OIS globals point at throwaway paths only.
set -uo pipefail

TDIR="$(mktemp -d)"
export HOME="$TDIR/home"
mkdir -p "$HOME"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/../bin/ois"   # loads pi_auth_bridge; source-guard skips CLI dispatch
set +e

cleanup() { rm -rf "$TDIR"; }
trap cleanup EXIT

fail=0
fail_case() { echo "  FAIL: $*"; fail=1; }
ok_case() { echo "  ok: $*"; }

SRC="$HOME/.pi/agent/auth.json"
SEAT="$TDIR/seat-pi"
mkdir -p "$(dirname "$SRC")" "$SEAT"
printf '{"openai-codex":{"token":"redacted-test-token"}}\n' > "$SRC"
printf '{}\n' > "$SEAT/auth.json"

# Capture output and assert it does not contain the dummy token. Paths are allowed; contents are not.
out=$(pi_auth_bridge greg "$SEAT" 2>&1); rc=$?
[[ $rc -eq 0 ]] || fail_case "empty placeholder bridge returned rc=$rc: $out"
[[ ! "$out" == *"redacted-test-token"* ]] || fail_case "bridge output leaked auth contents"
[[ -L "$SEAT/auth.json" ]] || fail_case "per-seat auth.json is not a symlink"
[[ "$(readlink -f "$SEAT/auth.json")" == "$(readlink -f "$SRC")" ]] || fail_case "auth symlink does not point at source"
[[ "$(cat "$SEAT/auth.json")" == "$(cat "$SRC")" ]] && ok_case "empty placeholder replaced by symlink without copying contents"
printf '{"openai-codex":{"token":"rotated-via-symlink"}}\n' > "$SEAT/auth.json"
[[ "$(cat "$SRC")" == *"rotated-via-symlink"* ]] && ok_case "auth writes through per-seat symlink to the shared source" || fail_case "auth symlink did not write through to source"

out=$(pi_auth_bridge greg "$SEAT" 2>&1); rc=$?
[[ $rc -eq 0 ]] && ok_case "existing correct symlink is idempotent" || fail_case "idempotent symlink bridge failed rc=$rc: $out"

OTHER="$TDIR/other-auth.json"
printf '{"openai-codex":{"token":"other"}}\n' > "$OTHER"
rm -f "$SEAT/auth.json" && ln -s "$OTHER" "$SEAT/auth.json"
out=$(pi_auth_bridge greg "$SEAT" 2>&1); rc=$?
[[ $rc -ne 0 ]] && ok_case "wrong symlink rejected fail-closed" || fail_case "wrong symlink was silently accepted"

rm -f "$SEAT/auth.json"
printf '{"openai-codex":{"token":"seat-specific"}}\n' > "$SEAT/auth.json"
out=$(pi_auth_bridge greg "$SEAT" 2>&1); rc=$?
[[ $rc -ne 0 ]] && ok_case "non-empty per-seat auth rejected fail-closed" || fail_case "non-empty target was overwritten"
[[ "$(cat "$SEAT/auth.json")" == *"seat-specific"* ]] || fail_case "non-empty per-seat auth was modified"

EMPTY_SRC="$TDIR/empty-source.json"
printf '{}\n' > "$EMPTY_SRC"
rm -f "$SEAT/auth.json"
out=$(OIS_PI_AUTH_SOURCE="$EMPTY_SRC" pi_auth_bridge greg "$SEAT" 2>&1); rc=$?
[[ $rc -ne 0 ]] && ok_case "empty source rejected fail-closed" || fail_case "empty source was accepted"

echo
if [[ $fail -eq 0 ]]; then
  echo "PASS: pi auth bridge symlinks only, is idempotent, and fails closed on unsafe credential states"
  exit 0
else
  echo "FAIL: pi auth bridge contract violated"
  exit 1
fi
