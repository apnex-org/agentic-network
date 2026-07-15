#!/usr/bin/env bash
# pi-models-bridge.test.sh — bug-271: prove pi per-seat models.json seeding is a
# fail-closed fleet-rendered file, not an implicit ~/.pi/agent or workspace fallback.
#
# The test sets HOME to a temp dir BEFORE sourcing ois. It deliberately does NOT create
# ~/.pi/agent/models.json; the durable contract is that pi_seed can render the gpt-5.5 400k
# policy into PI_CODING_AGENT_DIR from OIS fleet declaration/code alone.
set -uo pipefail

TDIR="$(mktemp -d)"
export HOME="$TDIR/home"
mkdir -p "$HOME"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/../bin/ois"   # loads pi_models_seed; source-guard skips CLI dispatch
set +e

cleanup() { rm -rf "$TDIR"; }
trap cleanup EXIT

fail=0
fail_case() { echo "  FAIL: $*"; fail=1; }
ok_case() { echo "  ok: $*"; }

CELL='{"cellAgent":"greg"}'
SEAT="$TDIR/seat-pi"
mkdir -p "$SEAT"

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

out=$(pi_models_seed greg "$SEAT" "$CELL" 2>&1); rc=$?
[[ $rc -eq 0 ]] || fail_case "missing target seed returned rc=$rc: $out"
[[ -f "$SEAT/models.json" && ! -L "$SEAT/models.json" ]] || fail_case "per-seat models.json is not an explicit rendered file"
[[ ! -e "$HOME/.pi/agent/models.json" ]] || fail_case "test unexpectedly created/relied on global ~/.pi/agent/models.json"
pi_models_400k_valid "$SEAT/models.json" && ok_case "missing target rendered explicit gpt-5.5 400k policy without global fallback" || fail_case "rendered models policy is not valid 400k"
cat > "$SEAT/auth.json" <<'JSON'
{"openai-codex":{"type":"api_key","key":"fake-test-key"}}
JSON
if command -v pi >/dev/null 2>&1; then
  list_out=$(PI_CODING_AGENT_DIR="$SEAT" pi --offline --list-models gpt-5.5 2>&1); list_rc=$?
  [[ $list_rc -eq 0 && "$list_out" == *"openai-codex"* && "$list_out" == *"gpt-5.5"* && "$list_out" == *"400K"* ]] \
    && ok_case "pi --list-models sees openai-codex/gpt-5.5 as 400K with fake auth + rendered models" \
    || fail_case "pi --list-models did not report gpt-5.5 400K: rc=$list_rc output=$list_out"
else
  ok_case "pi CLI not on PATH; skipped optional --list-models smoke"
fi

out=$(pi_models_seed greg "$SEAT" "$CELL" 2>&1); rc=$?
[[ $rc -eq 0 ]] && ok_case "existing matching rendered models file is idempotent" || fail_case "idempotent models seed failed rc=$rc: $out"
[[ -f "$SEAT/models.json" && ! -L "$SEAT/models.json" ]] || fail_case "idempotent seed left models.json as symlink"

VALID_LINK_TARGET="$TDIR/valid-linked-models.json"
write_models_400k "$VALID_LINK_TARGET"
rm -f "$SEAT/models.json" && ln -s "$VALID_LINK_TARGET" "$SEAT/models.json"
out=$(pi_models_seed greg "$SEAT" "$CELL" 2>&1); rc=$?
[[ $rc -eq 0 ]] || fail_case "valid mitigation symlink should be replaceable rc=$rc: $out"
[[ -f "$SEAT/models.json" && ! -L "$SEAT/models.json" ]] && ok_case "valid mitigation symlink replaced by explicit rendered file" || fail_case "valid symlink was not replaced by rendered file"
pi_models_400k_valid "$SEAT/models.json" || fail_case "rendered replacement after valid symlink is not 400k"

BAD_LINK_TARGET="$TDIR/bad-linked-models.json"
write_models_bad_ctx "$BAD_LINK_TARGET"
rm -f "$SEAT/models.json" && ln -s "$BAD_LINK_TARGET" "$SEAT/models.json"
out=$(pi_models_seed greg "$SEAT" "$CELL" 2>&1); rc=$?
[[ $rc -ne 0 ]] && ok_case "wrong models symlink rejected fail-closed" || fail_case "wrong models symlink was accepted"
[[ -L "$SEAT/models.json" ]] || fail_case "wrong symlink was modified"

rm -f "$SEAT/models.json"
write_models_bad_ctx "$SEAT/models.json"
out=$(pi_models_seed greg "$SEAT" "$CELL" 2>&1); rc=$?
[[ $rc -ne 0 ]] && ok_case "non-matching per-seat models rejected fail-closed" || fail_case "non-matching target was overwritten"
pi_models_400k_valid "$SEAT/models.json" && fail_case "bad per-seat models was modified to 400k" || ok_case "non-matching per-seat models was preserved"

BAD_CELL='{"cellAgent":"greg","piModels":{"providers":{"openai-codex":{"modelOverrides":{"gpt-5.5":{"contextWindow":272000}}}}}}'
rm -f "$SEAT/models.json"
out=$(pi_models_seed greg "$SEAT" "$BAD_CELL" 2>&1); rc=$?
[[ $rc -ne 0 ]] && ok_case "bad rendered fleet declaration rejected fail-closed" || fail_case "bad rendered fleet declaration was accepted"

echo
if [[ $fail -eq 0 ]]; then
  echo "PASS: pi models seed renders the 400k policy explicitly and fails closed on unsafe states"
  exit 0
else
  echo "FAIL: pi models seed contract violated"
  exit 1
fi
