#!/usr/bin/env bash
# roll-engine.sh — ROLL v8 engine cut (design 9548d827 §1.5), generalized to D_new/D_prev.
# Sourced by roller.sh (tick) and reachable from the boot controller's cold-start path.
# Provides: roll_hub <D_new> <D_new_gitsha>   and   verify_running <ref> <gitsha>.
#
# Dispositions (exit code): 0 = roll_success ; 2 = rolled_back (VERIFIED rollback to
# D_prev — NEVER forward-success) ; 3 = rollback_unproven (fail-loud). Every terminal
# path writes a create-once receipt (§1.8) binding causality + PG invariants + transitions;
# NO secrets. Health check = the FROZEN bounded poll: every HEALTH_INTERVAL up to a single
# HEALTH_WINDOW monotonic wall-clock deadline (<=24 attempts), local AND external, matching
# gitSha AND running RepoDigest == the exact ref.
set -euo pipefail
_ENG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$_ENG_DIR/hub-common.sh"
HUB_LAUNCH="$_ENG_DIR/hub-launch.sh"
HUB_HEALTH_LOCAL_URL="${HUB_HEALTH_LOCAL_URL:-http://localhost:8080/health}"
HUB_HEALTH_EXT_URL="${HUB_HEALTH_EXT_URL:-}"          # bound at install from the prod receipt
HEALTH_JQ="${HEALTH_JQ:-.gitSha}"

_health_gitsha(){ # $1=url (cache-busted) -> gitSha, or empty on any failure
  local url="$1" nonce; nonce="$(date +%s%N 2>/dev/null || echo x)"
  tmo "$TMO_INSPECT" curl -sf -H 'Cache-Control: no-cache' "${url}?_cb=${nonce}" 2>/dev/null \
    | jq -re "$HEALTH_JQ" 2>/dev/null || true
}

# verify_running <ref> <expected_gitsha> : FROZEN 120s/5s monotonic poll; 0 = verified.
verify_running(){
  local ref="$1" want_git="$2"
  [ -n "$HUB_HEALTH_EXT_URL" ] || die "HUB_HEALTH_EXT_URL not configured (external /health required, fail-closed)"
  local deadline=$((SECONDS + HEALTH_WINDOW)) lg eg rg
  while [ "$SECONDS" -lt "$deadline" ]; do
    lg="$(_health_gitsha "$HUB_HEALTH_LOCAL_URL")"
    eg="$(_health_gitsha "$HUB_HEALTH_EXT_URL")"
    rg="$(running_repodigest "$HUB_NAME" 2>/dev/null || true)"
    if [ "$lg" = "$want_git" ] && [ "$eg" = "$want_git" ] && [ "$rg" = "$ref" ]; then
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
  done
  return 1
}

_pg_snapshot(){ # id|mount|healthy  — PG invariant fingerprint (§1.5)
  local id mnt live
  id="$(tmo "$TMO_INSPECT" docker inspect -f '{{.Id}}' "$PG_NAME" 2>/dev/null)" || return 1
  mnt="$(tmo "$TMO_INSPECT" docker inspect -f '{{range .Mounts}}{{.Source}}->{{.Destination}};{{end}}' "$PG_NAME" 2>/dev/null)" || return 1
  if tmo "$TMO_DOCKEROP" docker exec "$PG_NAME" pg_isready -U hub -d hub >/dev/null 2>&1; then live=healthy; else live=unhealthy; fi
  printf '%s|%s|%s' "$id" "$mnt" "$live"
}

_write_receipt(){ # $1=disposition, rest via env vars — create-once JSON, no secrets
  local disp="$1" ts; ts="$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$RECEIPTS_DIR"; chmod 0700 "$RECEIPTS_DIR" 2>/dev/null || true
  jq -cn \
    --arg disp "$disp" --arg ts "$ts" \
    --arg dnew "${R_DNEW:-}" --arg dprev "${R_DPREV:-}" --arg dgit "${R_DGIT:-}" \
    --arg lgit "${R_LGIT:-}" --arg egit "${R_EGIT:-}" --arg rrd "${R_RRD:-}" \
    --arg pg0 "${R_PG0:-}" --arg pgn "${R_PGN:-}" --arg helper "${R_HELPER:-}" \
    --arg lgset "${R_LGSET:-}" --arg dbadset "${R_DBADSET:-}" \
    '{node:"hub-roller-tick", disposition:$disp, ts:$ts,
      candidate:$dnew, previous:$dprev, candidate_gitsha:$dgit,
      health:{local:$lgit, external:$egit}, running_repodigest:$rrd,
      pg:{pre:$pg0, post:$pgn}, helper_sha256:$helper,
      lastGoodDigest_set:$lgset, D_bad_set:$dbadset, secrets:"none"}' \
    | python3 "$_ENG_DIR/hub-state.py" receipt "$RECEIPTS_DIR/${ts}.json" \
    || log "WARN: receipt create-once failed (evidence gap) for $disp"
}

# roll_hub <D_new> <D_new_gitsha> : execute the roll+verify+rollback (§1.5 steps 1-7).
roll_hub(){
  local D_NEW="$1" D_GIT="$2" D_PREV PG0 PGN
  is_canonical_ref "$D_NEW" || die "roll_hub: D_new not canonical: $D_NEW"
  [ -n "$D_GIT" ] || die "roll_hub: missing provenance gitSha for $D_NEW"
  export R_DNEW="$D_NEW" R_DGIT="$D_GIT" R_HELPER="${HUB_HELPER_SHA256:-}"

  # 1. D_prev = running RepoDigest BEFORE any mutation, validated single-membership.
  D_PREV="$(running_repodigest "$HUB_NAME")" || die "roll aborted: no valid single-membership D_prev (no safe rollback target)"
  is_canonical_ref "$D_PREV" || die "roll aborted: D_prev not canonical: $D_PREV"
  export R_DPREV="$D_PREV"
  # 2. PG pre-snapshot.
  PG0="$(_pg_snapshot)" || die "roll aborted: cannot snapshot $PG_NAME (PG invariant)"; export R_PG0="$PG0"

  # 3. launch D_new (preflight-before-remove inside the launcher).
  "$HUB_LAUNCH" "$D_NEW"

  # 4. verify.
  if verify_running "$D_NEW" "$D_GIT"; then
    # 5. success.
    R_LGIT="$D_GIT" R_EGIT="$D_GIT" R_RRD="$D_NEW"
    PGN="$(_pg_snapshot)" || die "post-verify: cannot snapshot $PG_NAME"; export R_PGN="$PGN"
    [ "$PGN" = "$PG0" ] || die "PG invariant VIOLATED (pre=$PG0 post=$PGN) — roll must never touch PG"
    state_set_lastgood "$D_NEW"; export R_LGSET="$D_NEW"
    _write_receipt "roll_success"
    log "roll_success -> ${D_NEW##*@} (gitSha $D_GIT)"
    return 0
  fi

  # 6. verify FAIL => ROLLBACK to D_prev (dynamic). rc2 is NEVER forward-success.
  log "verify FAILED for ${D_NEW##*@} — rolling back to ${D_PREV##*@}"
  state_set_dbad "$D_NEW"; export R_DBADSET="$D_NEW"     # quarantine the bad candidate
  "$HUB_LAUNCH" "$D_PREV" || { _write_receipt "rollback_unproven"; die "rollback launch failed (rollback_unproven, rc3)"; }
  # rollback verify: running == D_prev (RepoDigest membership; gitSha of D_prev unknown here,
  # so verify identity by exact running RepoDigest over the same monotonic window).
  local deadline=$((SECONDS + HEALTH_WINDOW)) rg
  while [ "$SECONDS" -lt "$deadline" ]; do
    rg="$(running_repodigest "$HUB_NAME" 2>/dev/null || true)"
    [ "$rg" = "$D_PREV" ] && break
    sleep "$HEALTH_INTERVAL"
  done
  if [ "${rg:-}" != "$D_PREV" ]; then
    _write_receipt "rollback_unproven"; die "rollback did not reach D_prev (rollback_unproven, rc3)"
  fi
  PGN="$(_pg_snapshot)" || true; export R_PGN="${PGN:-}"; R_RRD="$D_PREV"
  [ "${PGN:-}" = "$PG0" ] || log "WARN: PG snapshot changed across rollback (pre=$PG0 post=${PGN:-})"
  _write_receipt "rolled_back"
  log "rolled_back to ${D_PREV##*@}; quarantined ${D_NEW##*@}. NOT a forward success."
  return 2
}
