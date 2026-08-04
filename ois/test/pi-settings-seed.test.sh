#!/usr/bin/env bash
# pi-settings-seed.test.sh — bug-272: prove pi per-seat settings.json seeding is a
# fail-closed fleet-rendered file, not implicit ~/.pi/agent or workspace .pi inheritance.
set -uo pipefail

TDIR="$(mktemp -d)"
export HOME="$TDIR/home"
mkdir -p "$HOME"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/../bin/ois"   # loads pi_settings_seed; source-guard skips CLI dispatch
set +e

cleanup() { rm -rf "$TDIR"; }
trap cleanup EXIT

fail=0
fail_case() { echo "  FAIL: $*"; fail=1; }
ok_case() { echo "  ok: $*"; }

# piSettings is the harness-wide UI/compaction baseline ONLY; defaultProvider/defaultModel are
# derived from the cell's piProvider/piModel, which is what makes seat-file-vs-exec-flag
# disagreement unrepresentable rather than merely detectable.
BASE_SETTINGS='{"theme":"dark","defaultThinkingLevel":"xhigh","terminal":{"showTerminalProgress":true},"transport":"auto","compaction":{"enabled":true,"reserveTokens":32000,"keepRecentTokens":24000},"packages":["npm:pi-tool-display","npm:pi-web-access"]}'
CATALOG='{"openai-codex":{"models":{"gpt-5.5":{"contextWindow":400000}}},"litellm-test":{"baseUrl":"http://proxy.test/v1","api":"anthropic-messages","credential":"litellm-test","models":{"big-model":{"contextWindow":1000000,"maxTokens":128000}}}}'
SEL='"piProvider":"openai-codex","piModel":"gpt-5.5","fleetProviders":'"$CATALOG"
CELL='{"cellAgent":"greg",'"$SEL"',"piSettings":'"$BASE_SETTINGS"'}'
CELL_RESERVE='{"cellAgent":"greg",'"$SEL"',"piReserveTokens":160000,"piKeepRecentTokens":24000,"piSettings":'"$BASE_SETTINGS"'}'
# Reserve derived as a fraction of the CATALOG window — for 1M-window models a hand-tuned
# constant does not travel, and 0.4*400000 reproduces the fleet's existing 160000 exactly.
CELL_FRACTION='{"cellAgent":"greg",'"$SEL"',"piReserveFraction":0.4,"piKeepRecentTokens":24000,"piSettings":'"$BASE_SETTINGS"'}'
PROXY_CELL='{"cellAgent":"greg","piProvider":"litellm-test","piModel":"big-model","fleetProviders":'"$CATALOG"',"piSettings":'"$BASE_SETTINGS"'}'
NO_SETTINGS_CELL='{"cellAgent":"greg",'"$SEL"'}'
NO_SELECTION_CELL='{"cellAgent":"greg","piSettings":'"$BASE_SETTINGS"'}'
BAD_CELL='{"cellAgent":"greg",'"$SEL"',"piSettings":{"theme":"light","defaultThinkingLevel":"xhigh","terminal":{"showTerminalProgress":true},"compaction":{"enabled":true,"reserveTokens":32000,"keepRecentTokens":24000}}}'
SEAT="$TDIR/seat-pi"
mkdir -p "$SEAT"

write_good_settings() {
  cat > "$1" <<'JSON'
{
  "theme": "dark",
  "defaultProvider": "openai-codex",
  "defaultModel": "gpt-5.5",
  "defaultThinkingLevel": "xhigh",
  "terminal": { "showTerminalProgress": true },
  "transport": "auto",
  "compaction": { "enabled": true, "reserveTokens": 32000, "keepRecentTokens": 24000 },
  "packages": ["npm:pi-tool-display", "npm:pi-web-access"]
}
JSON
}

write_extra_settings() {
  cat > "$1" <<'JSON'
{
  "theme": "dark",
  "defaultProvider": "openai-codex",
  "defaultModel": "gpt-5.5",
  "defaultThinkingLevel": "xhigh",
  "terminal": { "showTerminalProgress": true },
  "transport": "auto",
  "compaction": { "enabled": true, "reserveTokens": 32000, "keepRecentTokens": 24000 },
  "packages": ["npm:pi-tool-display", "npm:pi-web-access"],
  "unknownLocalPolicy": true
}
JSON
}

CONFIG_PI="$DIR/../../config/harnesses/pi.json"
# The harness config alone is NOT a valid settings file any more — it deliberately omits the
# derived defaults — so validate it as the baseline it is, then assert the omission.
if [[ -f "$CONFIG_PI" ]] && pi_settings_valid <(jq '.piSettings + {defaultProvider:"x",defaultModel:"y"}' "$CONFIG_PI"); then
  ok_case "repo config/harnesses/pi.json declares the required pi UI/compaction baseline"
else
  fail_case "repo config/harnesses/pi.json does not declare the required baseline"
fi
if [[ -f "$CONFIG_PI" ]] && jq -e '(.piSettings.defaultProvider == null) and (.piSettings.defaultModel == null) and (.piModels == null)' "$CONFIG_PI" >/dev/null 2>&1; then
  ok_case "repo config/harnesses/pi.json restates no provider/model (derivation is sole source)"
else
  fail_case "repo config/harnesses/pi.json still restates a provider/model"
fi

DEPLOY_SH="$DIR/../deploy.sh"
out=$(HOME="$TDIR/deploy-home" "$DEPLOY_SH" --diff 2>&1); rc=$?
if [[ $rc -eq 0 && "$out" == *"config/harnesses/pi.json diff"* && "$out" != *"missing repo pi harness config"* ]]; then
  ok_case "deploy --diff resolves repo-root config/harnesses/pi.json for co-ship guard"
else
  fail_case "deploy --diff did not resolve repo pi harness config correctly rc=$rc: $out"
fi

out=$(pi_settings_seed greg "$SEAT" "$NO_SETTINGS_CELL" 2>&1); rc=$?
[[ $rc -ne 0 ]] && ok_case "missing fleet piSettings declaration rejected fail-closed" || fail_case "missing fleet piSettings declaration was accepted"

out=$(pi_settings_seed greg "$SEAT" "$NO_SELECTION_CELL" 2>&1); rc=$?
[[ $rc -ne 0 ]] && ok_case "cell with no piProvider/piModel to derive from rejected fail-closed" || fail_case "cell with no provider/model selection was accepted"

out=$(pi_settings_seed greg "$SEAT" "$CELL" 2>&1); rc=$?
[[ $rc -eq 0 ]] || fail_case "missing target seed returned rc=$rc: $out"
[[ -f "$SEAT/settings.json" && ! -L "$SEAT/settings.json" ]] || fail_case "per-seat settings.json is not an explicit rendered file"
[[ ! -e "$HOME/.pi/agent/settings.json" ]] || fail_case "test unexpectedly created/relied on global ~/.pi/agent/settings.json"
pi_settings_valid "$SEAT/settings.json" openai-codex gpt-5.5 && ok_case "rendered settings derive defaults from the cell selection, without global fallback" || fail_case "rendered settings policy is not valid"
[[ "$(jq -r '.defaultProvider' "$SEAT/settings.json")" == "openai-codex" && "$(jq -r '.defaultModel' "$SEAT/settings.json")" == "gpt-5.5" ]] \
  && ok_case "derived defaults equal the cell's piProvider/piModel exactly" || fail_case "derived defaults do not match the cell selection"
[[ "$(stat -c '%a' "$SEAT/settings.json")" == "600" ]] && ok_case "rendered settings file mode is 600" || fail_case "rendered settings file mode is not 600"

out=$(pi_settings_seed greg "$SEAT" "$CELL" 2>&1); rc=$?
[[ $rc -eq 0 ]] && ok_case "existing matching rendered settings file is idempotent" || fail_case "idempotent settings seed failed rc=$rc: $out"

rm -f "$SEAT/settings.json"
out=$(pi_settings_seed greg "$SEAT" "$CELL_RESERVE" 2>&1); rc=$?
[[ $rc -eq 0 ]] && ok_case "reserve override rendered from cell config" || fail_case "reserve override seed failed rc=$rc: $out"
[[ "$(jq -r '.compaction.reserveTokens' "$SEAT/settings.json")" == "160000" ]] && ok_case "piReserveTokens overrides fleet baseline while preserving per-cell compaction semantics" || fail_case "piReserveTokens did not override compaction reserve"

rm -f "$SEAT/settings.json"
printf '{"lastChangelogVersion":"0.80.3"}\n' > "$SEAT/settings.json"
out=$(pi_settings_seed greg "$SEAT" "$CELL" 2>&1); rc=$?
[[ $rc -eq 0 ]] || fail_case "legacy lastChangelogVersion-only placeholder should be replaceable rc=$rc: $out"
pi_settings_valid "$SEAT/settings.json" && ok_case "legacy placeholder replaced by fleet-rendered settings" || fail_case "legacy placeholder replacement invalid"

VALID_LINK_TARGET="$TDIR/global-settings.json"
write_good_settings "$VALID_LINK_TARGET"
rm -f "$SEAT/settings.json" && ln -s "$VALID_LINK_TARGET" "$SEAT/settings.json"
out=$(pi_settings_seed greg "$SEAT" "$CELL" 2>&1); rc=$?
[[ $rc -eq 0 ]] || fail_case "valid mitigation symlink should be replaceable rc=$rc: $out"
[[ -f "$SEAT/settings.json" && ! -L "$SEAT/settings.json" ]] && ok_case "valid mitigation symlink replaced by explicit rendered file" || fail_case "valid settings symlink was not replaced"

BAD_LINK_TARGET="$TDIR/bad-settings.json"
printf '{"theme":"light"}\n' > "$BAD_LINK_TARGET"
rm -f "$SEAT/settings.json" && ln -s "$BAD_LINK_TARGET" "$SEAT/settings.json"
out=$(pi_settings_seed greg "$SEAT" "$CELL" 2>&1); rc=$?
[[ $rc -ne 0 ]] && ok_case "bad settings symlink rejected fail-closed" || fail_case "bad settings symlink was accepted"
[[ -L "$SEAT/settings.json" ]] || fail_case "bad settings symlink was modified"

rm -f "$SEAT/settings.json"
write_extra_settings "$SEAT/settings.json"
out=$(pi_settings_seed greg "$SEAT" "$CELL" 2>&1); rc=$?
[[ $rc -ne 0 ]] && ok_case "non-equivalent settings policy rejected fail-closed" || fail_case "non-equivalent settings policy was overwritten"
grep -q 'unknownLocalPolicy' "$SEAT/settings.json" && ok_case "non-equivalent settings policy was preserved" || fail_case "non-equivalent settings policy was modified"

rm -f "$SEAT/settings.json"
out=$(pi_settings_seed greg "$SEAT" "$BAD_CELL" 2>&1); rc=$?
[[ $rc -ne 0 ]] && ok_case "bad rendered fleet settings rejected fail-closed" || fail_case "bad rendered fleet settings was accepted"

# --- the defect this change exists to make unrepresentable --------------------------------
# A seat file that states one model while the cell runs another used to be VALID: the old
# validator checked the literal `openai-codex`, so any file naming codex passed regardless of
# what the cell selected, and the exec flags silently won. That is how a config could read as
# correct while being false. Consistency is now the property under test.
write_disagreeing_settings() {
  jq -n --argjson s "$BASE_SETTINGS" '$s + {defaultProvider:"openai-codex", defaultModel:"some-other-model"}' > "$1"
}
rm -f "$SEAT/settings.json"; write_disagreeing_settings "$SEAT/settings.json"
pi_settings_valid "$SEAT/settings.json" && ok_case "a disagreeing file still passes the SHAPE-only check (1-arg form)" || fail_case "shape-only check wrongly rejected a well-formed file"
pi_settings_valid "$SEAT/settings.json" openai-codex gpt-5.5 \
  && fail_case "settings naming a different model than the cell were accepted" \
  || ok_case "settings whose defaultModel disagrees with the cell are rejected"
pi_settings_valid "$SEAT/settings.json" litellm-test some-other-model \
  && fail_case "settings naming a different provider than the cell were accepted" \
  || ok_case "settings whose defaultProvider disagrees with the cell are rejected"

# --- derivation carries a non-codex provider and scales the reserve ------------------------
rm -f "$SEAT/settings.json"
out=$(pi_settings_seed greg "$SEAT" "$PROXY_CELL" 2>&1); rc=$?
[[ $rc -eq 0 ]] || fail_case "proxied-provider settings seed failed rc=$rc: $out"
pi_settings_valid "$SEAT/settings.json" litellm-test big-model \
  && ok_case "a non-codex provider renders and validates (no vendor literal left in the gate)" \
  || fail_case "non-codex provider settings did not validate"

rm -f "$SEAT/settings.json"
out=$(pi_settings_seed greg "$SEAT" "$CELL_FRACTION" 2>&1); rc=$?
[[ $rc -eq 0 ]] || fail_case "piReserveFraction seed failed rc=$rc: $out"
[[ "$(jq -r '.compaction.reserveTokens' "$SEAT/settings.json")" == "160000" ]] \
  && ok_case "piReserveFraction 0.4 x 400000 window reproduces the fleet's existing 160000" \
  || fail_case "piReserveFraction did not derive the expected reserve: $(jq -r '.compaction.reserveTokens' "$SEAT/settings.json")"

# Explicit piReserveTokens must still win over a fraction — existing cells keep their tuning.
rm -f "$SEAT/settings.json"
BOTH_CELL=$(jq -nc --argjson c "$CELL_FRACTION" '$c + {piReserveTokens: 99000}')
out=$(pi_settings_seed greg "$SEAT" "$BOTH_CELL" 2>&1); rc=$?
[[ "$(jq -r '.compaction.reserveTokens' "$SEAT/settings.json")" == "99000" ]] \
  && ok_case "explicit piReserveTokens still wins over piReserveFraction" \
  || fail_case "reserve precedence changed"

echo
if [[ $fail -eq 0 ]]; then
  echo "PASS: pi settings seed renders fleet UI/model policy explicitly and fails closed on unsafe states"
  exit 0
else
  echo "FAIL: pi settings seed contract violated"
  exit 1
fi
