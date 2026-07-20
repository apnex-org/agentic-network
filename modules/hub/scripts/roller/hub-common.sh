#!/usr/bin/env bash
# hub-common.sh — shared roller library (design 9548d827 §1.1/§1.2/§1.5/§1.8).
# Sourced by hub-resolve.sh, hub-launch.sh, roll-engine.sh, roller.sh. No side effects
# at source time except constant/function definitions. NEVER logs secret material.
set -euo pipefail

# ── frozen identities (design §1.1/§1.3; bound to the prod-observation receipt) ──
: "${HUB_ROLLER_REG:=australia-southeast1-docker.pkg.dev/labops-389703/cloud-run-source-deploy/hub}"
REG="$HUB_ROLLER_REG"
DOCKER_CONFIG_PATH="/var/lib/hub/docker-config"     # literal (§1.1/S4); unit hard-codes it
export DOCKER_CONFIG="$DOCKER_CONFIG_PATH"
ROLLER_DIR="/var/lib/hub-roller"                    # scripts + persistent state (§1.1/§1.8)
STATE_DIR="$ROLLER_DIR"
RECEIPTS_DIR="$ROLLER_DIR/receipts"
RUN_DIR="/run/hub-roller"                           # RuntimeDirectory (§1.2/V2)
LOCK_PATH="$RUN_DIR/lock"                            # single-owner lock (U2)
LOCK_FD=9                                            # fixed inherited fd (§1.2/V2)
HUB_NAME="ois-hub-prod"
PG_NAME="ois-postgres-prod"
export HUB_ROLLER_STATE_DIR="$STATE_DIR" HUB_ROLLER_REG="$REG"
_SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HUB_STATE_PY="$_SELF_DIR/hub-state.py"
DIGEST_RE="^${REG}@sha256:[0-9a-f]{64}$"

# ── frozen timeout bounds — §1.2 counted stage table (seconds; kill-grace = 10) ──
KILL_GRACE=10
TMO_TOKEN=5 TMO_SM=10 TMO_PULL=180 TMO_INSPECT=10 TMO_CREATE=30 TMO_CP=10 TMO_DOCKEROP=30
HEALTH_WINDOW=120 HEALTH_INTERVAL=5                  # §1.5 frozen 120s / every 5s (<=24)
RECON_WINDOW=30 RECON_INTERVAL=5                     # §1.2 per-[M] reconciliation loop

# ── logging: timestamped, to stderr, NEVER secret-bearing ──
log(){ printf '[%s] [hub-roller] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
die(){ log "FATAL: $*"; exit 1; }

# ── tmo: hard-bounded command (child GNU timeout, W4 layer-i). rc124/137 => fail-closed
#    (caller treats a nonzero as that step FAILED). GNU order: options BEFORE duration. ──
tmo(){ local b="$1"; shift; timeout --kill-after="$KILL_GRACE" "$b" "$@"; }

is_canonical_ref(){ [[ "${1:-}" =~ $DIGEST_RE ]]; }

# ── inherited single-owner lock: assert by INODE/FD identity, not pathname (§1.2/V2).
#    The owner (roller tick / boot controller) already holds fd LOCK_FD flocked. Helpers
#    call this; a delete+recreate of the dir (systemd cleanup) => inode mismatch => fail. ──
assert_lock_held(){
  [ -e "/proc/self/fd/$LOCK_FD" ] || die "lock fd $LOCK_FD not inherited (no owner)"
  local fd_ino path_ino
  fd_ino="$(stat -L -c '%i' "/proc/self/fd/$LOCK_FD" 2>/dev/null)" || die "cannot stat held lock fd"
  path_ino="$(stat -c '%i' "$LOCK_PATH" 2>/dev/null)" || die "lock path $LOCK_PATH gone (dir recreated?)"
  [ "$fd_ino" = "$path_ino" ] || die "lock inode drift: held fd=$fd_ino path=$path_ino (dir deleted+recreated) — fail-closed"
}

# ── observed-state reconciliation after a MUTATING docker op (§1.2). Bounds daemon-side
#    continuation: re-check up to RECON_WINDOW; unknown/unconverged => fail-closed. ──
reconcile_absent(){ # $1=container name
  local name="$1" waited=0
  while [ "$waited" -lt "$RECON_WINDOW" ]; do
    if ! tmo "$TMO_INSPECT" docker inspect "$name" >/dev/null 2>&1; then return 0; fi
    tmo "$TMO_DOCKEROP" docker rm -f "$name" >/dev/null 2>&1 || true   # idempotent re-drive
    sleep "$RECON_INTERVAL"; waited=$((waited + RECON_INTERVAL))
  done
  die "reconcile: container $name still present after ${RECON_WINDOW}s (fail-closed)"
}
reconcile_running_digest(){ # $1=container name, $2=expected canonical ref
  local name="$1" want="$2" waited=0 got
  while [ "$waited" -lt "$RECON_WINDOW" ]; do
    got="$(running_repodigest "$name" 2>/dev/null || true)"
    if [ "$got" = "$want" ]; then
      tmo "$TMO_INSPECT" docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null | grep -qx true && return 0
    fi
    sleep "$RECON_INTERVAL"; waited=$((waited + RECON_INTERVAL))
  done
  die "reconcile: $name not running exact ${want##*@} after ${RECON_WINDOW}s (fail-closed)"
}
reconcile_image_present(){ # $1=canonical ref — verify the pulled image's RepoDigest
  local want="$1" waited=0
  while [ "$waited" -lt "$RECON_WINDOW" ]; do
    if image_has_repodigest "$want"; then return 0; fi
    sleep "$RECON_INTERVAL"; waited=$((waited + RECON_INTERVAL))
  done
  die "reconcile: image ${want##*@} not present after ${RECON_WINDOW}s (fail-closed)"
}

# ── digest helpers — exactly-one canonical RepoDigest membership (never index [0]) ──
_repodigests_of(){ # $1=image ref/id -> newline-list of RepoDigests
  tmo "$TMO_INSPECT" docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$1" 2>/dev/null || true
}
_one_canonical_member(){ # stdin=RepoDigests -> the single REG@sha256 member, else fail
  local members; members="$(grep -E "$DIGEST_RE" || true)"
  [ "$(printf '%s' "$members" | grep -c .)" = "1" ] || return 1
  printf '%s\n' "$members"
}
image_has_repodigest(){ _repodigests_of "$1" | grep -qxE "$(printf '%s' "$1" | sed 's/[].[*^$]/\\&/g')"; }
running_repodigest(){ # $1=container name -> the canonical RepoDigest of its running image
  local name="${1:-$HUB_NAME}" img
  img="$(tmo "$TMO_INSPECT" docker inspect -f '{{.Image}}' "$name" 2>/dev/null)" || return 1
  _repodigests_of "$img" | _one_canonical_member
}

# ── state wrappers (all durability via hub-state.py, §1.8) ──
state_get_lastgood(){ tmo "$TMO_INSPECT" python3 "$HUB_STATE_PY" get lastgood; }
state_get_dbad(){ tmo "$TMO_INSPECT" python3 "$HUB_STATE_PY" get dbad; }
state_set_lastgood(){ tmo "$TMO_INSPECT" python3 "$HUB_STATE_PY" set lastgood "$1"; }
state_set_dbad(){ tmo "$TMO_INSPECT" python3 "$HUB_STATE_PY" set dbad "$1"; }
state_clear_dbad(){ tmo "$TMO_INSPECT" python3 "$HUB_STATE_PY" clear dbad; }
