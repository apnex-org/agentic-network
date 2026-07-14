#!/usr/bin/env bash
# pi-models-bridge.test.sh — bug-271: prove pi per-seat models.json seeding is a
# fail-closed symlink bridge for the required gpt-5.5 400k model policy.
#
# The test sets HOME to a temp dir BEFORE sourcing ois, so pi_models_bridge's default
# ~/.pi/agent/models.json source and all OIS globals point at throwaway paths only.
set -uo pipefail

TDIR="$(mktemp -d)"
export HOME="$TDIR/home"
mkdir -p "$HOME"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/../bin/ois"   # loads pi_models_bridge; source-guard skips CLI dispatch
set +e

cleanup() { rm -rf "$TDIR"; }
trap cleanup EXIT

fail=0
fail_case() { echo "  FAIL: $*"; fail=1; }
ok_case() { echo "  ok: $*"; }

write_models_400k() {
  cat > "$1" <<'JSON'
{
  "providers": {
    "openai-codex": {
      "modelOverrides": {
        "gpt-5.5": {
          "contextWindow": 400000
        }
      }
    }
  }
}
JSON
}

write_models_bad_ctx() {
  cat > "$1" <<'JSON'
{
  "providers": {
    "openai-codex": {
      "modelOverrides": {
        "gpt-5.5": {
          "contextWindow": 272000
        }
      }
    }
  }
}
JSON
}

SRC="$HOME/.pi/agent/models.json"
SEAT="$TDIR/seat-pi"
mkdir -p "$(dirname "$SRC")" "$SEAT"
write_models_400k "$SRC"

out=$(pi_models_bridge greg "$SEAT" 2>&1); rc=$?
[[ $rc -eq 0 ]] || fail_case "missing target bridge returned rc=$rc: $out"
[[ -L "$SEAT/models.json" ]] || fail_case "per-seat models.json is not a symlink"
[[ "$(readlink -f "$SEAT/models.json")" == "$(readlink -f "$SRC")" ]] || fail_case "models symlink does not point at source"
pi_models_400k_valid "$SEAT/models.json" && ok_case "missing target linked to source with gpt-5.5 400k policy" || fail_case "linked models policy is not valid 400k"

out=$(pi_models_bridge greg "$SEAT" 2>&1); rc=$?
[[ $rc -eq 0 ]] && ok_case "existing correct models symlink is idempotent" || fail_case "idempotent models symlink bridge failed rc=$rc: $out"

rm -f "$SEAT/models.json"
write_models_400k "$SEAT/models.json"
out=$(pi_models_bridge greg "$SEAT" 2>&1); rc=$?
[[ $rc -eq 0 ]] || fail_case "matching non-symlink target should be replaceable rc=$rc: $out"
[[ -L "$SEAT/models.json" ]] && ok_case "matching non-symlink target replaced by symlink" || fail_case "matching non-symlink target was not symlinked"

OTHER="$TDIR/other-models.json"
write_models_400k "$OTHER"
rm -f "$SEAT/models.json" && ln -s "$OTHER" "$SEAT/models.json"
out=$(pi_models_bridge greg "$SEAT" 2>&1); rc=$?
[[ $rc -ne 0 ]] && ok_case "wrong models symlink rejected fail-closed" || fail_case "wrong models symlink was silently accepted"

rm -f "$SEAT/models.json"
write_models_bad_ctx "$SEAT/models.json"
out=$(pi_models_bridge greg "$SEAT" 2>&1); rc=$?
[[ $rc -ne 0 ]] && ok_case "non-matching per-seat models rejected fail-closed" || fail_case "non-matching target was overwritten"
pi_models_400k_valid "$SEAT/models.json" && fail_case "bad per-seat models was modified to 400k" || ok_case "non-matching per-seat models was preserved"

BAD_SRC="$TDIR/bad-source-models.json"
write_models_bad_ctx "$BAD_SRC"
rm -f "$SEAT/models.json"
out=$(OIS_PI_MODELS_SOURCE="$BAD_SRC" pi_models_bridge greg "$SEAT" 2>&1); rc=$?
[[ $rc -ne 0 ]] && ok_case "source without gpt-5.5 400k rejected fail-closed" || fail_case "bad models source was accepted"

MISSING_SRC="$TDIR/missing-models.json"
out=$(OIS_PI_MODELS_SOURCE="$MISSING_SRC" pi_models_bridge greg "$SEAT" 2>&1); rc=$?
[[ $rc -ne 0 ]] && ok_case "missing models source rejected fail-closed" || fail_case "missing models source was accepted"

# A real `pi --list-models gpt-5.5` check is intentionally not load-bearing here: in an
# isolated temp PI_CODING_AGENT_DIR it needs provider auth/model registry state, and this test
# must not copy or log live credentials. The jq predicate above is the durable launch contract.

echo
if [[ $fail -eq 0 ]]; then
  echo "PASS: pi models bridge symlinks the 400k policy, is idempotent, and fails closed on unsafe states"
  exit 0
else
  echo "FAIL: pi models bridge contract violated"
  exit 1
fi
