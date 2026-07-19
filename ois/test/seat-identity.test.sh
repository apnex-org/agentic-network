#!/usr/bin/env bash
# seat-identity.test.sh — bug-303 (oisfix3): PROVE the canonical per-seat identity OIS_SEAT_ID is
# CANONICAL-WINS and unforgeable through the REAL do_launch path (steve's oisfix2 verifier blockers
# 1 + 2). Drives `ois launch` END-TO-END under a fully throwaway HOME (isolated ROOT/CFG/SEC/STATE)
# with a non-claude/pi "probe" harness whose exec is `printenv OIS_SEAT_ID`, so the value observed
# is exactly the one the REAL do_launch exported — not an in-test re-implementation.
#
# MUTATION-PROOF (each guard, when deleted from ois/bin/ois, turns a specific assertion RED):
#   - (2) do_launch stamps OIS_SEAT_ID and OVERWRITES an inherited value  -> T2 red if the stamp is deleted
#   - (1) cell_json REJECTS a config-authored OIS_SEAT_ID in .envTemplate/.env/.secretEnv
#         -> T3a/b/c red if the corresponding lacks_seat_id(<layer>) check is deleted
#   - (2) do_launch validates seat tokens BEFORE cell_json (steve constraint 3)
#         -> T4 red if the entry validation is deleted (a bad token then dies as 'unknown agent')
# Positive controls (T1) prove the happy path DOES stamp the canonical id, so a gate that never
# fires can't masquerade as passing. SANDBOX-ONLY; never touches a live seat/socket/config.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OIS="$HERE/../bin/ois"
[[ -x "$OIS" ]] || { echo "FAIL: ois not executable at $OIS"; exit 1; }
fail=0
TMPS=()
cleanup() { local d; for d in "${TMPS[@]:-}"; do [[ -n "$d" && -d "$d" ]] && rm -rf "$d"; done; }
trap cleanup EXIT

# make_sandbox [clobber_layer: envTemplate|env|secretEnv] [clobber_value] -> echoes a throwaway HOME.
# A minimal VALID fleet/agent/harness config + a fake hub-token secret. If a clobber layer is given,
# the agent config AUTHORS OIS_SEAT_ID in that layer (the attack cell_json must reject).
make_sandbox() {
  local layer="${1:-}" val="${2:-ois-foreign-pi}" home cfg sec
  home="$(mktemp -d)"; TMPS+=("$home")
  cfg="$home/.config/apnex-agents/config"; sec="$home/.config/apnex-agents/secrets"
  mkdir -p "$cfg/agents" "$cfg/harnesses" "$sec"
  printf 'x' > "$sec/hubtok"
  cat > "$cfg/fleet.json" <<JSON
{ "defaults": { "renders": ["pi-settings"] },
  "hub": { "url": "http://127.0.0.1:1/mcp", "tokenRef": "hubtok" },
  "credentials": {} }
JSON
  # probe harness: NOT claude/pi (skips seed + configDirTemplate requirement); exec prints just the id.
  cat > "$cfg/harnesses/probe.json" <<JSON
{ "hubModelTag": "test-tag", "exec": ["printenv", "OIS_SEAT_ID"] }
JSON
  local clob=""
  [[ -n "$layer" ]] && clob=", \"$layer\": { \"OIS_SEAT_ID\": \"$val\" }"
  cat > "$cfg/agents/lily.json" <<JSON
{ "agent": "lily", "agentName": "lily", "role": "engineer", "workspace": "$home",
  "harness": { "probe": {} }$clob }
JSON
  echo "$home"
}

# launch <home> <agent> [ambient KEY=VAL ...] -> sets globals OUT (combined stdout+stderr) and LRC.
# NB: sets GLOBALS (not called in $()) so the ois exit code survives to the caller. Scrubs any ambient
# OIS_SEAT_ID / CLAUDE_CONFIG_DIR from the test-runner (hermetic), then applies the caller's explicit
# assignments (e.g. an inherited OIS_SEAT_ID for the overwrite test).
launch() {
  local home="$1" agent="$2"; shift 2
  OUT="$(env -u OIS_SEAT_ID -u CLAUDE_CONFIG_DIR HOME="$home" "$@" "$OIS" launch "$agent" probe 2>&1)"
  LRC=$?
}
# the exec is `printenv OIS_SEAT_ID`, so the emitted id is a bare `ois-<agent>-<harness>` full line.
seat_id_of() { grep -oE '^ois-[A-Za-z0-9_]+-[A-Za-z0-9_]+$' <<<"$1" | tail -1; }

echo "== (T1) POSITIVE CONTROL: a clean launch stamps the canonical OIS_SEAT_ID =="
H="$(make_sandbox)"; launch "$H" lily; GOT="$(seat_id_of "$OUT")"
if [[ "$GOT" == "ois-lily-probe" ]]; then echo "  ok: canonical id stamped ($GOT)"; else echo "  FAIL: expected ois-lily-probe, got '$GOT' (rc=$LRC)"; echo "$OUT" | sed 's/^/    | /'; fail=1; fi

echo "== (T2) INHERITED-OVERWRITE: an ambient OIS_SEAT_ID is OVERWRITTEN by the canonical stamp =="
echo "       (mutation: delete do_launch's \`export OIS_SEAT_ID\` -> the spawner id survives -> RED)"
H="$(make_sandbox)"; launch "$H" lily OIS_SEAT_ID=ois-spawner-claude; GOT="$(seat_id_of "$OUT")"
if [[ "$GOT" == "ois-lily-probe" ]]; then echo "  ok: inherited 'ois-spawner-claude' overwritten to '$GOT'";
else echo "  FAIL: inherited id not overwritten (got '$GOT', rc=$LRC)"; echo "$OUT" | sed 's/^/    | /'; fail=1; fi

echo "== (T3) CONFIG-AUTHORSHIP REJECTION: a config layer authoring OIS_SEAT_ID is FATAL (cell_json) =="
echo "       (mutation: delete lacks_seat_id(<layer>) -> launch no longer fatals -> RED, per layer)"
for LAYER in envTemplate env secretEnv; do
  H="$(make_sandbox "$LAYER" ois-foreign-pi)"; launch "$H" lily
  if [[ $LRC -ne 0 ]] && grep -q 'OIS_SEAT_ID' <<<"$OUT" && grep -qiE 'authority|invalid merged cell' <<<"$OUT"; then
    echo "  ok: .$LAYER OIS_SEAT_ID authorship rejected (fatal, rc=$LRC)"
  else
    echo "  FAIL: .$LAYER OIS_SEAT_ID authorship NOT rejected (rc=$LRC) — config could clobber the kill key"
    echo "$OUT" | sed 's/^/    | /'; fail=1
  fi
  # belt: even if a future reader mis-handles it, the id that WOULD launch must never be the foreign value.
  GOT="$(seat_id_of "$OUT")"; [[ "$GOT" == "ois-foreign-pi" ]] && { echo "  FAIL: foreign id '$GOT' reached the launched env"; fail=1; }
done

echo "== (T4) TOKEN VALIDATION runs BEFORE cell_json: a delimiter-ambiguous token is FATAL as a token =="
echo "       (mutation: delete the do_launch-entry validation -> dies as 'unknown agent' instead -> RED)"
H="$(make_sandbox)"; launch "$H" bad-agent   # 'bad-agent' has a hyphen; no config file needed
if [[ $LRC -ne 0 ]] && grep -q 'seat tokens must match' <<<"$OUT"; then
  echo "  ok: bad token rejected by the production validation (before cell_json)"
else
  echo "  FAIL: bad token not caught by token validation (rc=$LRC) — validation not before cell_json"
  echo "$OUT" | sed 's/^/    | /'; fail=1
fi

echo
if [[ $fail -eq 0 ]]; then
  echo "PASS: OIS_SEAT_ID is canonical-wins — inherited overwritten, config-authorship rejected per-layer, token-validated before cell_json"
  exit 0
else
  echo "FAIL: seat-identity guard(s) violated"
  exit 1
fi
