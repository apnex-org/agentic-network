#!/usr/bin/env bash
# hubfix0-controlled-roll.sh  (v7) — ROLL ONLY (BUILD + LIVE-VERIFY separate nodes).
# Run ONLY via the frozen fail-closed wrapper hubfix0-controlled-roll-wrapper.sh (captures
# PIPESTATUS, create-once trace, post-close third manifest). Run as terraform@ (operator).
# No set -e: control flow is EXPLICIT so a post-mutation failure routes to rollback.
# Byte-authoritative source = git blob (commit/path/sha in the companion); self-hash gate = defense-in-depth.
set -uo pipefail
umask 077

# ── REQUIRED inputs (BUILD receipt + cred proof + Decision + approval; strictly validated) ──
NEW_DIGEST="${NEW_DIGEST:?REQUIRED sha256 64hex build-node pushed digest}"
EXPECTED_SHA="${EXPECTED_SHA:?REQUIRED 40hex build source SHA == build-info.gitSha}"
EXPECTED_BUILT_AT="${EXPECTED_BUILT_AT:?REQUIRED build-info.builtAt in UTC YYYY-MM-DDTHH:MM:SSZ}"
EXPECTED_BUILD_INFO_SHA256="${EXPECTED_BUILD_INFO_SHA256:?REQUIRED sha256 of exact build-info.json bytes}"
APPROVED_SELF_SHA256="${APPROVED_SELF_SHA256:?REQUIRED steve-approved sha256 of THIS script exact bytes}"
BUILD_RECEIPT_REF="${BUILD_RECEIPT_REF:?REQUIRED durable ref of the BUILD receipt}"
BUILD_RECEIPT_SHA256="${BUILD_RECEIPT_SHA256:?REQUIRED sha256 of the BUILD receipt}"
CRED_PROOF_REF="${CRED_PROOF_REF:?REQUIRED durable ref of the fresh-exchange credential proof}"
CRED_PROOF_SHA256="${CRED_PROOF_SHA256:?REQUIRED sha256 of the credential proof}"
DECISION_REF="${DECISION_REF:?REQUIRED resolved Director Decision ref authorizing this prod roll}"
STATUS_OUT="${STATUS_OUT:?REQUIRED create-once terminal-status JSON path (set by the wrapper)}"

# ── FIXED contract constants (NOT overrideable; change requires re-review) ──
readonly OLD_DIGEST="sha256:6fe07049d2beef601c28d5d2ae385b750de0f1543728b785cd523b91f1ee5567"  # #629
readonly REG="australia-southeast1-docker.pkg.dev/labops-389703/cloud-run-source-deploy/hub"
readonly PROJECT="labops-389703"
readonly VM="hub-vm"
readonly ZONE="australia-southeast1-a"
readonly HEALTH_EXT="https://hub-api-5muxctm3ta-ts.a.run.app/health"
readonly POLL_TIMEOUT=180 POLL_INTERVAL=10 READBACK_TRIES=12 STOP_RETRIES=4
readonly CANON_LATEST="${REG}:latest"

WATCHTOWER_STOPPED=false; TAG_MUTATED=false; HUB_RECREATED=false; PREFLIGHT_DONE=false
OLD_SHA=""; PG0=""; FAIL=""

# ── HELPERS (ALL defined before any die-able validation — V6-5) ──
log(){ printf '[roll %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
rec(){ printf '[roll RECEIPT %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
SSH(){ gcloud compute ssh "$VM" --zone="$ZONE" --project "$PROJECT" --tunnel-through-iap --quiet "$@"; }
latest_digest(){ local d; d=$(gcloud artifacts docker images describe "$CANON_LATEST" --project "$PROJECT" --format='value(image_summary.digest)' 2>/dev/null); grep -qE '^sha256:[0-9a-f]{64}$' <<<"$d" && printf '%s' "$d"; }
tag_add(){ gcloud artifacts docker tags add "$REG@$1" "$CANON_LATEST" --project "$PROJECT" --quiet >/dev/null; }
readback_latest(){ local i got=""; for i in $(seq 1 "$READBACK_TRIES"); do got=$(latest_digest); [ "$got" = "$1" ] && { rec "AR latest readback == $got"; return 0; }; sleep 3; done; rec "AR latest readback FAIL last=$got want=$1"; return 1; }
hub_image_meta(){ SSH --command='curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/attributes/hub-image' 2>/dev/null; }
img_buildinfo(){ SSH --command="sudo bash -s '$REG' '$1'" <<'EOF' 2>/dev/null
set -uo pipefail; REG="$1"; D="$2"; export DOCKER_CONFIG=/var/lib/hub/docker-config
sudo -E docker pull "$REG@$D" >/dev/null 2>&1 || { echo ERR_PULL; exit 3; }
CID=$(sudo docker create "$REG@$D") || { echo ERR_CREATE; exit 3; }
trap 'sudo docker rm "$CID" >/dev/null 2>&1 || true' EXIT
F=$(mktemp); sudo docker cp "$CID:/repo/hub/build-info.json" - 2>/dev/null | tar -xO > "$F" 2>/dev/null
[ -s "$F" ] || { echo ERR_NOFILE; exit 3; }
printf '%s %s %s\n' "$(sha256sum "$F" | cut -d' ' -f1)" \
  "$(grep -o '"gitSha":"[0-9a-f]*"' "$F" | head -1 | cut -d'"' -f4)" \
  "$(grep -o '"builtAt":"[^"]*"'    "$F" | head -1 | cut -d'"' -f4)"
rm -f "$F"
EOF
}
running_repodigests(){ SSH --command='sudo bash -s' <<'EOF' 2>/dev/null
set -uo pipefail
IMG=$(sudo docker inspect ois-hub-prod --format '{{.Image}}') || exit 2
sudo docker image inspect "$IMG" --format '{{range .RepoDigests}}{{println .}}{{end}}'
EOF
}
repodigests_has(){ running_repodigests | grep -qx "$1"; }
pg_invariants(){ SSH --command='sudo bash -s' <<'EOF' 2>/dev/null
set -uo pipefail
ID=$(sudo docker inspect ois-postgres-prod --format '{{.Id}}') || exit 2
MNT=$(sudo docker inspect ois-postgres-prod --format '{{range .Mounts}}{{.Source}}->{{.Destination}} {{end}}')
H=$(sudo docker inspect ois-postgres-prod --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')
printf '%s|%s|%s\n' "$ID" "$MNT" "$H"
EOF
}
wt_running(){ SSH --command='sudo docker inspect watchtower-prod --format "{{.State.Running}}"' 2>/dev/null; }
stop_wt(){ SSH --command='sudo docker stop watchtower-prod >/dev/null 2>&1 || true' >/dev/null 2>&1; local s; s=$(wt_running); [ "$s" = "false" ] || { rec "watchtower stop FAILED Running=$s"; WATCHTOWER_STOPPED=false; return 1; }; WATCHTOWER_STOPPED=true; return 0; }
emergency_stop_retry(){ local i; for i in $(seq 1 "$STOP_RETRIES"); do stop_wt && { rec "emergency watchtower stop OK (try $i)"; return 0; }; sleep 2; done; rec "EMERGENCY watchtower stop UNPROVEN after $STOP_RETRIES tries Running=$(wt_running)"; return 1; }
health_local(){ SSH --command='curl -fsS -m 8 http://localhost:8080/health' 2>/dev/null; }
health_ext(){ curl -fsS -m 8 -H 'Cache-Control: no-cache' "${HEALTH_EXT}?cb=$(date -u +%s)$RANDOM" 2>/dev/null; }
sha_of(){ grep -o '"gitSha":"[0-9a-f]*"' <<<"$1" | head -1 | cut -d'"' -f4; }
recreate_hub(){ SSH --command="sudo bash -s '$REG' '$1' '$CANON_LATEST'" <<'EOF'
set -uo pipefail; REG="$1"; D="$2"; CANON="$3"; export DOCKER_CONFIG=/var/lib/hub/docker-config
HUB_IMAGE=$(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/attributes/hub-image)
[ "$HUB_IMAGE" = "$CANON" ] || { echo "META_DRIFT hub-image=$HUB_IMAGE != $CANON"; exit 6; }
docker pull "$REG@$D" || exit 4
docker tag "$REG@$D" "$HUB_IMAGE"
docker rm -f ois-hub-prod 2>/dev/null || true
google_metadata_script_runner startup || exit 5
EOF
}
verify(){ local deadline hl he shl she; deadline=$(( $(date +%s) + POLL_TIMEOUT )); while [ "$(date +%s)" -lt "$deadline" ]; do
    hl=$(health_local); he=$(health_ext); shl=$(sha_of "$hl"); she=$(sha_of "$he")
    if repodigests_has "$1" && [ "$shl" = "$2" ] && [ "$she" = "$2" ]; then rec "VERIFY OK RepoDigests contains $1 local=$shl ext=$she"; return 0; fi
    log "...not converged local=$shl ext=$she; sleep ${POLL_INTERVAL}s"; sleep "$POLL_INTERVAL"
  done; rec "VERIFY TIMEOUT local=$shl ext=$she"; return 1; }

# ── V6-5 fail-closed terminal status (JSON via jq; captured values; UNREAD-marked; return nonzero on write fail) ──
emit_status(){ # $1=disposition
  local fl="not-collected" rd="not-collected" pgn="not-collected" wtr="not-collected" reads_ok=true
  if [ "$PREFLIGHT_DONE" = "true" ]; then
    fl=$(latest_digest);       [ -n "$fl" ]  || { fl=UNREAD; reads_ok=false; }
    rd=$(running_repodigests | tr '\n' ' '); [ -n "$rd" ] || { rd=UNREAD; reads_ok=false; }
    pgn=$(pg_invariants);      [ -n "$pgn" ] || { pgn=UNREAD; reads_ok=false; }
    wtr=$(wt_running);         [ -n "$wtr" ] || { wtr=UNREAD; reads_ok=false; }
  fi
  command -v jq >/dev/null || { echo "[roll] FATAL: jq missing, cannot render terminal status" >&2; return 1; }
  jq -n \
    --arg disp "$1" --argjson ro "$reads_ok" --arg self "$SELF_SHA" \
    --arg nd "$NEW_DIGEST" --arg es "$EXPECTED_SHA" --arg eba "$EXPECTED_BUILT_AT" \
    --arg od "$OLD_DIGEST" --arg os "${OLD_SHA:-}" \
    --arg fl "$fl" --arg rd "$rd" --arg wts "$WATCHTOWER_STOPPED" --arg wtr "$wtr" \
    --arg pg0 "${PG0:-}" --arg pgn "$pgn" \
    --arg brr "$BUILD_RECEIPT_REF" --arg brs "$BUILD_RECEIPT_SHA256" \
    --arg cpr "$CRED_PROOF_REF" --arg cps "$CRED_PROOF_SHA256" --arg dr "$DECISION_REF" \
    '{node:"hubfix0-ROLL", disposition:$disp, terminal_reads_ok:$ro, script_self_sha256:$self,
      new_digest:$nd, expected_sha:$es, expected_built_at:$eba, old_digest:$od, old_sha:$os,
      final_latest:$fl, running_repodigests:$rd, watchtower_stopped:$wts, watchtower_running:$wtr,
      pg0:$pg0, pgN:$pgn, build_receipt:{ref:$brr,sha256:$brs}, cred_proof:{ref:$cpr,sha256:$cps},
      decision_ref:$dr}' > "$STATUS_OUT" || { echo "[roll] FATAL: terminal status write failed -- EVIDENCE INCOMPLETE" >&2; return 1; }
  rec "TERMINAL disposition=$1 reads_ok=$reads_ok status=$STATUS_OUT"
  return 0
}
die(){ log "FATAL: $*"; emit_status "preflight_or_fatal" || true; exit 1; }

# ── STATUS_OUT create-once ──
( set -o noclobber; : > "$STATUS_OUT" ) 2>/dev/null || { echo "FATAL: STATUS_OUT create-once failed: $STATUS_OUT" >&2; exit 1; }
command -v jq >/dev/null || die "jq required"

# ── SELF-HASH GATE before any GCP/SSH ──
SELF_SHA="$(sha256sum "${BASH_SOURCE[0]}" | cut -d' ' -f1)"
[ "$SELF_SHA" = "$APPROVED_SELF_SHA256" ] || die "self-hash $SELF_SHA != APPROVED_SELF_SHA256 $APPROVED_SELF_SHA256 -- refusing to run"

# ── strict input validation ──
grep -qE '^sha256:[0-9a-f]{64}$' <<<"$NEW_DIGEST" || die "NEW_DIGEST shape invalid"
grep -qE '^[0-9a-f]{40}$'        <<<"$EXPECTED_SHA" || die "EXPECTED_SHA shape invalid"
grep -qE '^[0-9a-f]{64}$'        <<<"$EXPECTED_BUILD_INFO_SHA256" || die "EXPECTED_BUILD_INFO_SHA256 shape invalid"
grep -qE '^[0-9a-f]{64}$'        <<<"$BUILD_RECEIPT_SHA256" || die "BUILD_RECEIPT_SHA256 shape invalid"
grep -qE '^[0-9a-f]{64}$'        <<<"$CRED_PROOF_SHA256" || die "CRED_PROOF_SHA256 shape invalid"
grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' <<<"$EXPECTED_BUILT_AT" || die "EXPECTED_BUILT_AT must be UTC YYYY-MM-DDTHH:MM:SSZ"
grep -qE '^[0-9]+$' <<<"$POLL_TIMEOUT$POLL_INTERVAL$READBACK_TRIES" || die "numeric bounds invalid"
[ -n "$BUILD_RECEIPT_REF" ] && [ -n "$CRED_PROOF_REF" ] && [ -n "$DECISION_REF" ] || die "missing BUILD/cred/decision ref"
[ "$NEW_DIGEST" != "$OLD_DIGEST" ] || die "NEW_DIGEST == OLD_DIGEST"
[ "$(gcloud config get-value account 2>/dev/null)" = "terraform@${PROJECT}.iam.gserviceaccount.com" ] || die "wrong active gcloud account"
[ "$(gcloud config get-value project 2>/dev/null)" = "$PROJECT" ] || die "wrong active gcloud project"
rec "INPUTS NEW=$NEW_DIGEST EXP_SHA=$EXPECTED_SHA BI_SHA=$EXPECTED_BUILD_INFO_SHA256 BUILD=$BUILD_RECEIPT_REF/$BUILD_RECEIPT_SHA256 CRED=$CRED_PROOF_REF/$CRED_PROOF_SHA256 DECISION=$DECISION_REF SELF=$SELF_SHA"

# ── PREFLIGHT (no mutation) ──
gcloud artifacts docker images describe "$REG@$NEW_DIGEST" --project "$PROJECT" >/dev/null || die "NEW_DIGEST not in AR"
gcloud artifacts docker images describe "$REG@$OLD_DIGEST" --project "$PROJECT" >/dev/null || die "OLD_DIGEST not in AR"
[ "$(latest_digest)" = "$OLD_DIGEST" ] || die "AR latest != OLD_DIGEST -- ABORT"
[ "$(hub_image_meta)" = "$CANON_LATEST" ] || die "VM hub-image metadata != $CANON_LATEST -- ABORT"
read BI_SHA BI_GIT BI_BAT <<<"$(img_buildinfo "$NEW_DIGEST" | tail -1)"
case "$BI_SHA" in ERR_*|'') die "NEW build-info extract failed: $BI_SHA";; esac
[ "$BI_GIT" = "$EXPECTED_SHA" ]               || die "NEW build-info.gitSha $BI_GIT != EXPECTED_SHA"
[ "$BI_BAT" = "$EXPECTED_BUILT_AT" ]          || die "NEW build-info.builtAt $BI_BAT != EXPECTED_BUILT_AT"
[ "$BI_SHA" = "$EXPECTED_BUILD_INFO_SHA256" ] || die "NEW build-info sha256 $BI_SHA != EXPECTED_BUILD_INFO_SHA256"
read O_SHA O_GIT O_BAT <<<"$(img_buildinfo "$OLD_DIGEST" | tail -1)"; OLD_SHA="$O_GIT"
grep -qE '^[0-9a-f]{40}$' <<<"$OLD_SHA" || die "could not derive OLD_SHA"
PG0=$(pg_invariants); case "$PG0" in *'|'*'|'*) : ;; *) die "postgres invariants unreadable";; esac
grep -qiE 'healthy|running' <<<"$PG0" || die "ois-postgres-prod not healthy pre-roll: $PG0"
repodigests_has "$REG@$OLD_DIGEST" || die "running Hub RepoDigests !contains OLD_DIGEST -- ABORT"
[ "$(sha_of "$(health_local)")" = "$OLD_SHA" ] || die "local health gitSha != OLD_SHA -- ABORT"
[ "$(sha_of "$(health_ext)")"  = "$OLD_SHA" ] || die "external health gitSha != OLD_SHA -- ABORT"
PREFLIGHT_DONE=true
rec "PREFLIGHT OK OLD_SHA=$OLD_SHA latest==OLD hub-image==CANON PG0=$PG0"

# ── FORWARD ──
forward(){
  stop_wt || { FAIL="stop-watchtower"; return 1; }
  TAG_MUTATED=true
  tag_add "$NEW_DIGEST" || { FAIL="tag-add-NEW"; return 1; }
  readback_latest "$NEW_DIGEST" || { FAIL="readback-NEW"; return 1; }
  recreate_hub "$NEW_DIGEST"; local rc=$?
  stop_wt || { FAIL="watchtower-restop-after-recreate"; return 1; }
  [ "$rc" -eq 0 ] || { FAIL="recreate-NEW-rc=$rc"; return 1; }
  HUB_RECREATED=true
  verify "$REG@$NEW_DIGEST" "$EXPECTED_SHA" || { FAIL="verify-NEW"; return 1; }
  [ "$(latest_digest)" = "$NEW_DIGEST" ] || { FAIL="final-latest-not-NEW"; return 1; }
  local PG1; PG1=$(pg_invariants); [ "$PG1" = "$PG0" ] || { FAIL="postgres-changed"; return 1; }
  return 0
}
if forward; then
  rec "ROLL SUCCESS Hub=$EXPECTED_SHA/$NEW_DIGEST WATCHTOWER_STOPPED=$WATCHTOWER_STOPPED"
  emit_status "roll_success" || exit 1
  exit 0
fi

# ── V6-4: emergency watchtower stop retry is the FIRST recovery action, BEFORE any failure-state reads ──
emergency_stop_retry || true
rec "FORWARD FAILED step=$FAIL WATCHTOWER_STOPPED=$WATCHTOWER_STOPPED TAG_MUTATED=$TAG_MUTATED HUB_RECREATED=$HUB_RECREATED latest=$(latest_digest) local=$(health_local) external=$(health_ext) PG=$(pg_invariants)"
if ! $TAG_MUTATED; then rec "no tag mutation (step=$FAIL): latest + Hub UNCHANGED"; emit_status "preflight_or_fatal" || true; exit 1; fi
log "AUTO-ROLLBACK -> OLD $OLD_SHA / $OLD_DIGEST"
RB_OK=true; RB_RC=0
if $RB_OK; then tag_add "$OLD_DIGEST"         || RB_OK=false; fi
if $RB_OK; then readback_latest "$OLD_DIGEST" || RB_OK=false; fi
if $RB_OK; then recreate_hub "$OLD_DIGEST"; RB_RC=$?; fi
stop_wt || RB_OK=false
[ "$RB_RC" -eq 0 ] || RB_OK=false
if $RB_OK; then verify "$REG@$OLD_DIGEST" "$OLD_SHA" || RB_OK=false; fi
if $RB_OK; then [ "$(latest_digest)" = "$OLD_DIGEST" ] || RB_OK=false; fi
PGR=$(pg_invariants)
if $RB_OK && [ "$PGR" = "$PG0" ] && [ "$WATCHTOWER_STOPPED" = "true" ]; then
  rec "ROLLBACK VERIFIED Hub=#629 $OLD_SHA/$OLD_DIGEST PG=$PGR(==PG0) WATCHTOWER_STOPPED=true"
  emit_status "rollback_verified" || exit 1
  exit 2
fi
rec "ROLLBACK NOT PROVEN RB_OK=$RB_OK RB_RC=$RB_RC PG==PG0:$([ "$PGR" = "$PG0" ] && echo yes || echo NO) WATCHTOWER_STOPPED=$WATCHTOWER_STOPPED -- CRITICAL. NO intentional Postgres mutation; PG0=$PG0 PGR=$PGR -- OPERATOR MUST ASSESS."
log "Manual recovery: operator: gcloud artifacts docker tags add $REG@$OLD_DIGEST $CANON_LATEST --project $PROJECT --quiet ; on $VM root: export DOCKER_CONFIG=/var/lib/hub/docker-config; docker pull $REG@$OLD_DIGEST; docker tag $REG@$OLD_DIGEST $CANON_LATEST; docker rm -f ois-hub-prod; google_metadata_script_runner startup; docker stop watchtower-prod ; verify local+external health gitSha==$OLD_SHA and RepoDigests contains $REG@$OLD_DIGEST and watchtower Running=false"
emit_status "rollback_unproven" || true
exit 3
