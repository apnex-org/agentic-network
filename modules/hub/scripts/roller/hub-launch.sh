#!/usr/bin/env bash
# hub-launch.sh <REG@sha256:...> — SHARED Hub-ONLY, exact-digest-only launcher
# (design 9548d827 §1.4, T6/U2/S5/R7). Recreates ONLY ois-hub-prod on the EXACT digest.
#
# Contract:
#  - ARG: exactly one `$REG@sha256:[0-9a-f]{64}` ref; FAILS CLOSED on any tag/bare/mutable
#    ref (aborts nonzero BEFORE touching docker).
#  - Runs UNDER the INHERITED single-owner lock (the caller — roller tick §1.2 or boot
#    controller §9.1 — holds fd 9 flocked); asserts it by INODE/FD identity, never
#    re-acquires.
#  - PREFLIGHT before ANY mutation (T6): validate arg -> verify gcr-helper + DOCKER_CONFIG
#    readable -> mint a FRESH metadata token -> fetch+validate EVERY secret (S5, never
#    cached) -> ensure the exact target digest is LOCALLY AVAILABLE via an authenticated
#    exact-digest `docker pull "$1"`. NOT health (post-launch, §1.5). A preflight failure
#    aborts nonzero WITH the current Hub STILL RUNNING (never a remove-then-fail gap).
#  - Only then: `docker rm -f ois-hub-prod` (reconcile absent) -> `docker run -d … "$1"`
#    (reconcile running-exact). NO watchtower.enable label (R7).
#  - NEVER logs a token or secret value (greg §8 sentinel-tested).
set -euo pipefail
_LAUNCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$_LAUNCH_DIR/hub-common.sh"

D_TARGET="${1:-}"
[ -n "$D_TARGET" ] || die "hub-launch.sh requires exactly one \$REG@sha256:… ref"
# fail-closed on ANY non-canonical (tag / bare / mutable) ref, before touching docker
is_canonical_ref "$D_TARGET" || die "refusing non-exact-digest launch target: ${D_TARGET} (tags forbidden)"
assert_lock_held    # inherited single-owner lock (never re-acquire)

# ── metadata + Secret Manager (fresh EVERY invocation, S5; fail-closed; no-log) ──
_md(){ # $1 = instance attribute key
  tmo "$TMO_SM" curl -sf -H 'Metadata-Flavor: Google' \
    "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1"
}
_project(){ tmo "$TMO_SM" curl -sf -H 'Metadata-Flavor: Google' \
    "http://metadata.google.internal/computeMetadata/v1/project/project-id"; }
_mint_token(){ # fresh SA access token; fail-closed on non-200/empty/malformed
  local resp tok
  resp="$(tmo "$TMO_TOKEN" curl -sf -H 'Metadata-Flavor: Google' \
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token")" \
    || die "metadata token mint failed (fail-closed)"
  tok="$(printf '%s' "$resp" | jq -re '.access_token')" || die "metadata token malformed (fail-closed)"
  [ -n "$tok" ] || die "metadata token empty (fail-closed)"
  printf '%s' "$tok"
}
_sm_fetch(){ # $1 = SM secret id, $2 = bearer token -> plaintext (fail-closed, never logged)
  local out val
  out="$(tmo "$TMO_SM" curl -sf -H "Authorization: Bearer $2" \
    "https://secretmanager.googleapis.com/v1/projects/${GCP_PROJECT}/secrets/$1/versions/latest:access")" \
    || die "SM fetch failed for a secret (fail-closed)"
  val="$(printf '%s' "$out" | jq -re '.payload.data' | base64 -d)" || die "SM payload malformed (fail-closed)"
  [ -n "$val" ] || die "SM secret empty (fail-closed)"
  printf '%s' "$val"
}

# ── PREFLIGHT (all non-mutating; abort here leaves the current Hub untouched) ──
[ -r "$DOCKER_CONFIG_PATH/config.json" ] || die "DOCKER_CONFIG not readable: $DOCKER_CONFIG_PATH (fail-closed)"
command -v docker-credential-gcr >/dev/null 2>&1 || die "docker-credential-gcr helper missing (fail-closed)"
GCP_PROJECT="$(_project)" || die "cannot resolve GCP project (fail-closed)"
TOKEN="$(_mint_token)"
POSTGRES_PASSWORD="$(_sm_fetch "$(_md secret-postgres-password)" "$TOKEN")"
HUB_API_TOKEN="$(_sm_fetch "$(_md secret-hub-api-token)" "$TOKEN")"
OIS_GH_API_TOKEN="$(_sm_fetch "$(_md secret-gh-api-token)" "$TOKEN")"
HUB_ADMIN_TOKEN="$(_sm_fetch "$(_md secret-hub-admin-token)" "$TOKEN")"
OIS_REPO_EVENT_BRIDGE_REPOS="$(_md repo-event-bridge-repos)" || die "metadata repo-event-bridge-repos missing (fail-closed)"
# authenticated exact-digest pull — proves pullability + makes the exact bytes LOCAL
# (critical for boot-fallback whose last-good may have been GC'd). Uses the gcr-helper.
tmo "$TMO_PULL" docker pull "$D_TARGET" >/dev/null 2>&1 || die "exact-digest pull failed: ${D_TARGET##*@} (fail-closed)"
reconcile_image_present "$D_TARGET"
log "preflight OK for ${D_TARGET##*@} — token+secrets+pull verified; current Hub still running"

# ── MUTATE: remove current Hub, launch the exact digest, reconcile ──
tmo "$TMO_DOCKEROP" docker rm -f "$HUB_NAME" >/dev/null 2>&1 || true
reconcile_absent "$HUB_NAME"
tmo "$TMO_DOCKEROP" docker run -d --name "$HUB_NAME" --restart unless-stopped --network hub-net -p 8080:8080 \
  -e NODE_ENV=production -e PORT=8080 \
  -e "POSTGRES_CONNECTION_STRING=postgres://hub:${POSTGRES_PASSWORD}@${PG_NAME}:5432/hub" \
  -e "HUB_API_TOKEN=${HUB_API_TOKEN}" -e WATCHDOG_ENABLED=true \
  -e "HUB_ADMIN_TOKEN=${HUB_ADMIN_TOKEN}" \
  -e "OIS_GH_API_TOKEN=${OIS_GH_API_TOKEN}" \
  -e "OIS_REPO_EVENT_BRIDGE_REPOS=${OIS_REPO_EVENT_BRIDGE_REPOS}" \
  "$D_TARGET" >/dev/null 2>&1 || die "docker run failed for ${D_TARGET##*@} (fail-closed)"
reconcile_running_digest "$HUB_NAME" "$D_TARGET"
log "launched ${HUB_NAME} on ${D_TARGET##*@}"
