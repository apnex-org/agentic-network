#!/usr/bin/env bash
# ois-fleet-seat-config.test.sh — bug-296/bootstrap centralized seat-config proof.
#
# A single fleet/agent substrate must render equivalent canonical seat fields for
# `ois up <agent> pi` and `ois up <agent> claude`; only the selected harness is
# allowed to differ. OIS_AGENT_NAME is authority and OIS_INSTANCE_ID is retired.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
OIS="$REPO/ois/bin/ois"
DEPLOY="$REPO/ois/deploy.sh"
[[ -f "$OIS" ]] || { echo "FAIL: ois not found at $OIS"; exit 1; }

TDIR="$(mktemp -d)"
trap 'rm -rf "$TDIR"' EXIT
ROOT="$TDIR/home/.config/apnex-agents"
CFG="$ROOT/config"
SEC="$ROOT/secrets"
WORK="$TDIR/workspaces/greg"
mkdir -p "$CFG/agents" "$CFG/harnesses" "$SEC/hub" "$SEC/agents/greg" "$SEC/anthropic" "$WORK/.ois"
cp "$REPO/config/harnesses/pi.json" "$CFG/harnesses/pi.json"
cp "$REPO/config/harnesses/claude.json" "$CFG/harnesses/claude.json"
printf 'fleet-token' > "$SEC/hub/fleet.token"
printf 'gh-token' > "$SEC/agents/greg/gh.token"
printf 'anthropic-token' > "$SEC/anthropic/oauth.token"

cat > "$CFG/fleet.json" <<JSON
{
  "defaults": {
    "eagerSessionClaim": true,
    "labels": {"env": "test", "fleet": "central"},
    "secretEnv": {"GH_TOKEN": "agents/{agent}/gh.token"}
  },
  "hub": {"url": "https://hub.example.invalid/mcp", "tokenRef": "hub/fleet.token"},
  "credentials": {"anthropic": {"secretRef": "anthropic/oauth.token"}}
}
JSON
cat > "$CFG/agents/greg.json" <<JSON
{
  "agent": "greg",
  "agentName": "greg",
  "workspace": "$WORK",
  "role": "engineer",
  "labels": {"env": "test", "seat": "greg"},
  "harness": {
    "pi": {"piProvider": "openai-codex", "piModel": "gpt-5.5", "hubModelTag": "gpt-5.5"},
    "claude": {"hubModelTag": "claude-opus-4-8", "extraExecArgs": ["--permission-mode", "bypassPermissions"]}
  }
}
JSON

fails=0
ok() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; fails=$((fails + 1)); }
contains() { local desc="$1" hay="$2" needle="$3"; [[ "$hay" == *"$needle"* ]] && ok "$desc" || { fail "$desc"; echo "        missing: $needle"; }; }
not_contains() { local desc="$1" hay="$2" needle="$3"; [[ "$hay" != *"$needle"* ]] && ok "$desc" || { fail "$desc"; echo "        unexpected: $needle"; }; }
eq() { local desc="$1" exp="$2" got="$3"; [[ "$exp" == "$got" ]] && ok "$desc" || { fail "$desc"; echo "        expected: [$exp]"; echo "        actual:   [$got]"; }; }

pi_env="$(OIS_INSTANCE_ID=stale HOME="$TDIR/home" "$OIS" env greg pi)"
claude_env="$(OIS_INSTANCE_ID=stale HOME="$TDIR/home" "$OIS" env greg claude)"
contains "pi env renders canonical OIS_AGENT_NAME" "$pi_env" "OIS_AGENT_NAME=greg"
contains "claude env renders canonical OIS_AGENT_NAME" "$claude_env" "OIS_AGENT_NAME=greg"
not_contains "pi env does not render retired OIS_INSTANCE_ID" "$pi_env" "OIS_INSTANCE_ID"
not_contains "claude env does not render retired OIS_INSTANCE_ID" "$claude_env" "OIS_INSTANCE_ID"
contains "pi env has per-seat PI config dir" "$pi_env" "PI_CODING_AGENT_DIR=$TDIR/home/.config/apnex-agents/greg.pi"
contains "claude env has per-seat Claude config dir" "$claude_env" "CLAUDE_CONFIG_DIR=$TDIR/home/.config/apnex-agents/greg.claude"
contains "both harnesses receive the fleet Hub token ref (pi)" "$pi_env" "OIS_HUB_TOKEN=sha256:"
contains "both harnesses receive the fleet Hub token ref (claude)" "$claude_env" "OIS_HUB_TOKEN=sha256:"
contains "pi env renders canonical Hub role" "$pi_env" "OIS_HUB_ROLE=engineer"
contains "claude env renders canonical Hub role" "$claude_env" "OIS_HUB_ROLE=engineer"
contains "claude imports Anthropic credential from fleet catalog" "$claude_env" "CLAUDE_CODE_OAUTH_TOKEN=sha256:"
not_contains "pi does not import Claude-only Anthropic credential" "$pi_env" "CLAUDE_CODE_OAUTH_TOKEN"

render_json() {
  local harness="$1"
  HOME="$TDIR/home" "$OIS" render greg "$harness" | awk 'BEGIN{emit=0} /^=====/{emit=1; next} emit{print}'
}
pi_render="$(render_json pi)"
claude_render="$(render_json claude)"
eq "adapter-config role is identical across pi/claude" \
  "$(jq -r '.role' <<<"$pi_render")" "$(jq -r '.role' <<<"$claude_render")"
eq "adapter-config hubUrl is identical across pi/claude" \
  "$(jq -r '.hubUrl' <<<"$pi_render")" "$(jq -r '.hubUrl' <<<"$claude_render")"
eq "adapter-config labels are identical across pi/claude" \
  "$(jq -S '.labels' <<<"$pi_render")" "$(jq -S '.labels' <<<"$claude_render")"
contains "adapter-config carries engineer role" "$pi_render" '"role": "engineer"'
contains "adapter-config carries canonical seat label" "$pi_render" '"seat": "greg"'

grep -q 'unset OIS_INSTANCE_ID' "$OIS" && ok "launch path strips inherited OIS_INSTANCE_ID before exec" || fail "launch path strips inherited OIS_INSTANCE_ID before exec"

deploy_out="$(HOME="$TDIR/home" "$DEPLOY" --diff 2>&1 || true)"
contains "deploy --diff includes claude harness config surface" "$deploy_out" "config/harnesses/claude.json diff"
not_contains "deploy guard does not report missing claude harness config" "$deploy_out" "missing repo claude harness config"

cat > "$CFG/agents/bad-missing-name.json" <<JSON
{"agent":"bad-missing-name","workspace":"$WORK","role":"engineer","harness":{"pi":{"piProvider":"openai-codex","piModel":"gpt-5.5","hubModelTag":"gpt-5.5"}}}
JSON
bad_out="$(HOME="$TDIR/home" "$OIS" env bad-missing-name pi 2>&1)" && bad_rc=0 || bad_rc=$?
[[ $bad_rc -ne 0 ]] && ok "missing agentName fails loud" || fail "missing agentName fails loud"
contains "missing agentName error names invalid merged cell" "$bad_out" "invalid merged cell 'bad-missing-name/pi'"

cat > "$CFG/agents/bad-instance.json" <<JSON
{"agent":"bad-instance","agentName":"bad-instance","workspace":"$WORK","role":"engineer","env":{"OIS_INSTANCE_ID":"legacy"},"harness":{"pi":{"piProvider":"openai-codex","piModel":"gpt-5.5","hubModelTag":"gpt-5.5"}}}
JSON
legacy_out="$(HOME="$TDIR/home" "$OIS" env bad-instance pi 2>&1)" && legacy_rc=0 || legacy_rc=$?
[[ $legacy_rc -ne 0 ]] && ok "config-layer OIS_INSTANCE_ID fails loud" || fail "config-layer OIS_INSTANCE_ID fails loud"
contains "legacy instance-id error names invalid merged cell" "$legacy_out" "no OIS_INSTANCE_ID authority"

cp "$REPO/config/harnesses/pi.json" "$CFG/harnesses/pi.json"
jq 'del(.configDirTemplate)' "$CFG/harnesses/pi.json" > "$CFG/harnesses/pi.json.tmp" && mv "$CFG/harnesses/pi.json.tmp" "$CFG/harnesses/pi.json"
nocdir_out="$(HOME="$TDIR/home" "$OIS" env greg pi 2>&1)" && nocdir_rc=0 || nocdir_rc=$?
[[ $nocdir_rc -ne 0 ]] && ok "pi without per-seat configDirTemplate fails loud" || fail "pi without per-seat configDirTemplate fails loud"
contains "missing configDirTemplate error names invalid merged cell" "$nocdir_out" "per-seat configDirTemplate"

echo
if [[ $fails -eq 0 ]]; then
  echo "PASS: OIS fleet/seat config equivalence green"
  exit 0
else
  echo "FAIL: $fails assertion(s) failed"
  exit 1
fi
