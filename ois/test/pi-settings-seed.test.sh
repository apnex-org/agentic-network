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

CELL='{"cellAgent":"greg","piSettings":{"theme":"dark","defaultProvider":"openai-codex","defaultModel":"gpt-5.5","defaultThinkingLevel":"xhigh","terminal":{"showTerminalProgress":true},"transport":"auto","compaction":{"enabled":true,"reserveTokens":32000,"keepRecentTokens":24000},"packages":["npm:pi-tool-display","npm:pi-web-access"]}}'
CELL_RESERVE='{"cellAgent":"greg","piReserveTokens":160000,"piKeepRecentTokens":24000,"piSettings":{"theme":"dark","defaultProvider":"openai-codex","defaultModel":"gpt-5.5","defaultThinkingLevel":"xhigh","terminal":{"showTerminalProgress":true},"transport":"auto","compaction":{"enabled":true,"reserveTokens":32000,"keepRecentTokens":24000},"packages":["npm:pi-tool-display","npm:pi-web-access"]}}'
NO_SETTINGS_CELL='{"cellAgent":"greg"}'
BAD_CELL='{"cellAgent":"greg","piSettings":{"theme":"light","defaultProvider":"openai-codex","defaultModel":"gpt-5.5","defaultThinkingLevel":"xhigh","terminal":{"showTerminalProgress":true},"compaction":{"enabled":true,"reserveTokens":32000,"keepRecentTokens":24000}}}'
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
if [[ -f "$CONFIG_PI" ]] && pi_settings_valid <(jq '.piSettings' "$CONFIG_PI"); then
  ok_case "repo config/harnesses/pi.json declares required piSettings UI/model policy"
else
  fail_case "repo config/harnesses/pi.json does not declare required piSettings policy"
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

out=$(pi_settings_seed greg "$SEAT" "$CELL" 2>&1); rc=$?
[[ $rc -eq 0 ]] || fail_case "missing target seed returned rc=$rc: $out"
[[ -f "$SEAT/settings.json" && ! -L "$SEAT/settings.json" ]] || fail_case "per-seat settings.json is not an explicit rendered file"
[[ ! -e "$HOME/.pi/agent/settings.json" ]] || fail_case "test unexpectedly created/relied on global ~/.pi/agent/settings.json"
pi_settings_valid "$SEAT/settings.json" && ok_case "missing target rendered explicit dark/openai-codex/gpt-5.5 settings without global fallback" || fail_case "rendered settings policy is not valid"
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

echo
if [[ $fail -eq 0 ]]; then
  echo "PASS: pi settings seed renders fleet UI/model policy explicitly and fails closed on unsafe states"
  exit 0
else
  echo "FAIL: pi settings seed contract violated"
  exit 1
fi
