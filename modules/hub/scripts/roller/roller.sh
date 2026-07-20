#!/usr/bin/env bash
# roller.sh — roller TICK body (design 9548d827 §1.1/§1.3/§1.5). ExecStart of
# hub-roller.service. Single oneshot per tick. Owns the single-owner lock (fixed fd 9),
# asserts the reviewed runtime baseline + script hashes, resolves a typed candidate, and
# advances a roll ONLY on `fresh_candidate` that is new-vs-running (R1 no-backwards-roll).
#
# Timeout layers (W4): each network/docker step is child-GNU `timeout`-bounded (hub-common
# `tmo`); the whole ExecStart is additionally bounded by the unit `TimeoutStartSec=2200`
# (systemd `Result=timeout` backstop) sized never to hit the counted worst case.
set -euo pipefail
_TICK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$_TICK_DIR/hub-common.sh"

# ── SIGTERM posture (T9): defer a NEW roll, but let an in-flight atomic op finish so a
#    `systemctl stop`/shutdown can never sever a rollback (TimeoutStopSec=1500 covers it). ──
_STOPPING=0
trap '_STOPPING=1; log "SIGTERM received — no new roll will start; finishing any in-flight op"' TERM

# ── single-owner lock: acquire ONCE on the FIXED fd 9; held ⇒ another tick/wrapper owns
#    it ⇒ no-op exit 0 (systemd coalescing already prevents a 2nd timer instance). ──
exec 9>"$LOCK_PATH" || die "cannot open lock $LOCK_PATH (RuntimeDirectory missing?)"
if ! flock -n 9; then log "lock held — another sanctioned writer owns it; no-op"; exit 0; fi

# ── reviewed runtime baseline (§1.1/T5/S4): assert live COS/helper/python == the pinned
#    receipt; fail-DISABLED on mismatch/absence/drift (never dynamic capture-and-trust).
#    baseline.env is installed alongside from the reviewer-accepted prod-observation receipt. ──
assert_runtime_baseline(){
  local be="$_TICK_DIR/baseline.env"
  [ -r "$be" ] || die "runtime baseline pin missing ($be) — fail-DISABLED"
  # shellcheck source=/dev/null
  source "$be"   # provides PIN_OS_ID PIN_OS_VERSION PIN_OS_BUILD_ID PIN_HELPER_SHA256 PIN_PY_SHA256 PIN_HELPER_PATH PIN_PY_PATH
  local os_id os_ver os_bid
  os_id="$(. /etc/os-release && echo "$ID")"; os_ver="$(. /etc/os-release && echo "$VERSION")"; os_bid="$(. /etc/os-release && echo "${BUILD_ID:-}")"
  [ "$os_id" = "$PIN_OS_ID" ] && [ "$os_ver" = "$PIN_OS_VERSION" ] && [ "$os_bid" = "$PIN_OS_BUILD_ID" ] \
    || die "COS runtime != reviewed baseline (live ${os_id}/${os_ver}/${os_bid}) — fail-DISABLED"
  [ -x "$PIN_HELPER_PATH" ] && [ "$(sha256sum "$PIN_HELPER_PATH" | cut -d' ' -f1)" = "$PIN_HELPER_SHA256" ] \
    || die "docker-credential-gcr helper != pinned sha — fail-DISABLED"
  [ -x "$PIN_PY_PATH" ] && [ "$(sha256sum "$PIN_PY_PATH" | cut -d' ' -f1)" = "$PIN_PY_SHA256" ] \
    || die "python3 != pinned sha — fail-DISABLED"
  export HUB_HELPER_SHA256="$PIN_HELPER_SHA256"
}

# ── R8: re-assert each co-located script's content SHA before use (fail-closed on drift).
#    manifest.sha256 (install-pinned) holds `<sha256>  <basename>` lines. ──
assert_script_hashes(){
  local man="$_TICK_DIR/manifest.sha256" f
  [ -r "$man" ] || die "script hash manifest missing ($man) — fail-closed"
  while read -r want f; do
    [ -n "$f" ] || continue
    [ "$(sha256sum "$_TICK_DIR/$f" | cut -d' ' -f1)" = "$want" ] || die "script drift: $f != $want — fail-closed"
  done < "$man"
}

# ── §3 no-exec provenance (SEAM greg §3): extract + validate D_new build-info WITHOUT
#    running the image; echo the 40-hex gitSha on success, nonzero on reject. ──
provenance_gitsha(){ # $1 = D_new (canonical)
  local cid bi git built
  cid="$(tmo "$TMO_CREATE" docker create "$1" 2>/dev/null)" || return 1
  bi="$(tmo "$TMO_CP" docker cp "$cid:/repo/hub/build-info.json" - 2>/dev/null | tar -xO 2>/dev/null)" || { tmo "$TMO_DOCKEROP" docker rm "$cid" >/dev/null 2>&1 || true; return 1; }
  tmo "$TMO_DOCKEROP" docker rm "$cid" >/dev/null 2>&1 || true
  git="$(printf '%s' "$bi" | jq -re '.gitSha' 2>/dev/null)" || return 1
  built="$(printf '%s' "$bi" | jq -re '.builtAt' 2>/dev/null)" || return 1
  [[ "$git" =~ ^[0-9a-f]{40}$ ]] || return 1
  [[ "$built" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || return 1
  printf '%s' "$git"
}

main(){
  assert_runtime_baseline
  assert_script_hashes
  [ "$_STOPPING" -eq 0 ] || { log "stopping — skip tick"; exit 0; }

  # resolve (typed). new-vs-running/typing/roll are ours (§1); hub-detect is greg's §2.
  # shellcheck source=/dev/null
  source "$_TICK_DIR/hub-resolve.sh"
  local outcome digest; read -r outcome digest < <(hub_resolve)
  case "$outcome" in
    fresh_candidate)
      is_canonical_ref "$digest" || die "resolver emitted non-canonical fresh_candidate: $digest"
      local running; running="$(running_repodigest "$HUB_NAME" 2>/dev/null || true)"
      if [ "$digest" = "$running" ]; then log "no-op: :latest ($digest) already running"; exit 0; fi
      # provenance-validate the NEW candidate; reject ⇒ quarantine (S7), never a re-pull loop.
      local git
      if ! git="$(provenance_gitsha "$digest")"; then
        state_set_dbad "$digest"; die "provenance REJECTED ${digest##*@} — quarantined (no roll)"
      fi
      [ "$_STOPPING" -eq 0 ] || { log "stopping — skip roll of ${digest##*@}"; exit 0; }
      # dispatch the roll; roll-engine returns 0 (success) / 2 (rolled_back) / 3 (unproven).
      source "$_TICK_DIR/roll-engine.sh"
      local rc=0; roll_hub "$digest" "$git" || rc=$?
      exit "$rc" ;;   # rc2 (rolled_back) is a distinct disposition, NEVER forward-success
    boot_fallback) log "boot_fallback outcome on a TICK — NO-OP (tick never rolls to lastGood)"; exit 0 ;;
    quarantined)   log "quarantined outcome — NO-OP (known-bad :latest not re-rolled)"; exit 0 ;;
    error|*)       log "resolve error/unknown outcome ($outcome) — NO-OP (never roll on uncertainty)"; exit 0 ;;
  esac
}
main "$@"
